#!/usr/bin/env python3
"""MTProxy supervisor: render Telemt configs and reload on shared-volume request."""

from __future__ import annotations

import json
import os
import re
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

CONFIG_PATH = Path(os.environ.get("MTPROXY_CONFIG_PATH", "/var/lib/mtproxy/config.json"))
REQUEST_PATH = Path(
    os.environ.get(
        "MTPROXY_RELOAD_REQUEST_PATH", "/var/lib/overvpn/mtproxy-reload/request"
    )
)
ACK_PATH = Path(
    os.environ.get("MTPROXY_RELOAD_ACK_PATH", "/var/lib/overvpn/mtproxy-reload/ack")
)
PID_PATH = Path(
    os.environ.get("MTPROXY_PID_PATH", "/var/lib/overvpn/mtproxy-reload/mtproxy.pid")
)
HEARTBEAT_PATH = Path(
    os.environ.get(
        "MTPROXY_HEARTBEAT_PATH", "/var/lib/overvpn/mtproxy-reload/heartbeat"
    )
)
RUNTIME_STATS_PATH = Path(
    os.environ.get(
        "MTPROXY_RUNTIME_STATS_PATH",
        "/var/lib/overvpn/mtproxy-reload/runtime-stats.json",
    )
)
WORK_DIR = Path(os.environ.get("MTPROXY_WORK_DIR", "/var/lib/mtproxy-work"))
TELEMT_BIN = Path(os.environ.get("TELEMT_BIN", "/usr/local/bin/telemt"))
POLL_SECONDS = float(os.environ.get("MTPROXY_RELOAD_POLL_SECONDS", "0.2"))
SETTLE_SECONDS = float(os.environ.get("MTPROXY_RELOAD_SETTLE_SECONDS", "1"))
STATS_POLL_SECONDS = float(os.environ.get("MTPROXY_STATS_POLL_SECONDS", "5"))
DEFAULT_TLS_DOMAIN = os.environ.get("MTPROXY_DEFAULT_TLS_DOMAIN", "duckduckgo.com")
HEARTBEAT_MAX_AGE_SECONDS = float(
    os.environ.get("MTPROXY_HEARTBEAT_MAX_AGE_SECONDS", "15")
)


def env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


# Middle-End transport is required for media on non-Premium accounts.
USE_MIDDLE_PROXY = env_bool("MTPROXY_USE_MIDDLE_PROXY", True)

SAFE_TAG = re.compile(r"[^A-Za-z0-9._-]+")
children: list[subprocess.Popen[Any]] = []
# Parallel metadata for children (api ports / tags) used for runtime stats.
children_meta: list[dict[str, Any]] = []
stopping = False
last_stats_at = 0.0


def log(message: str) -> None:
    print(f"[mtproxy-supervisor] {message}", flush=True)


def write_pid() -> None:
    PID_PATH.parent.mkdir(parents=True, exist_ok=True)
    PID_PATH.write_text(f"{os.getpid()}\n", encoding="utf-8")


def write_heartbeat() -> None:
    """Shared-volume liveness for the API (separate PID namespace — cannot use kill -0)."""
    HEARTBEAT_PATH.parent.mkdir(parents=True, exist_ok=True)
    HEARTBEAT_PATH.write_text(f"{time.time():.3f}\n", encoding="utf-8")


def stop_children() -> None:
    global children, children_meta
    for proc in children:
        if proc.poll() is None:
            proc.terminate()
    deadline = time.time() + 5
    for proc in children:
        remaining = max(0.0, deadline - time.time())
        try:
            proc.wait(timeout=remaining)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=2)
    children = []
    children_meta = []


def toml_string(value: str) -> str:
    escaped = (
        value.replace("\\", "\\\\")
        .replace('"', '\\"')
        .replace("\n", "\\n")
        .replace("\r", "\\r")
        .replace("\t", "\\t")
    )
    return f'"{escaped}"'


def write_inbound_config(inbound: dict[str, Any], target: Path) -> int | None:
    mode = str(inbound.get("secretMode") or "SECURE").upper()
    tls_domain_raw = inbound.get("tlsDomain")
    tls_domain = (
        str(tls_domain_raw).strip()
        if tls_domain_raw and str(tls_domain_raw).strip()
        else DEFAULT_TLS_DOMAIN
    )
    users = inbound.get("users") or []
    users_lines: list[str] = []
    ip_limit_lines: list[str] = []
    for user in users:
        if not isinstance(user, dict):
            continue
        name = str(user.get("name") or "user").strip() or "user"
        secret = str(user.get("secret") or "").strip().lower()
        if not re.fullmatch(r"[0-9a-f]{32}", secret):
            raise RuntimeError(
                f"invalid MTProxy secret for user {name!r}: expected 32 hex chars"
            )
        users_lines.append(f"{toml_string(name)} = {toml_string(secret)}")
        max_ips = user.get("maxUniqueIps")
        if isinstance(max_ips, bool):
            continue
        if isinstance(max_ips, (int, float)) and int(max_ips) > 0:
            ip_limit_lines.append(f"{toml_string(name)} = {int(max_ips)}")
    if not users_lines:
        raise RuntimeError("MTProxy inbound has no users; assign a user before apply")
    users_block = "\n".join(users_lines)
    ip_limits_block = (
        f"\n[access.user_max_unique_ips]\n{chr(10).join(ip_limit_lines)}\n"
        if ip_limit_lines
        else ""
    )
    classic = "true" if mode == "CLASSIC" else "false"
    secure = "true" if mode == "SECURE" else "false"
    tls = "true" if mode == "TLS" else "false"
    use_middle = "true" if USE_MIDDLE_PROXY else "false"
    # Mask/TLS front needs a writable cache dir; keep it under the inbound work tree.
    front_dir = f"{SAFE_TAG.sub('_', str(inbound.get('tag') or 'inbound'))}-tlsfront"
    # Avoid binding [::] — many VPS images have IPv6 disabled and Telemt exits on fail.
    listen_host = str(inbound.get("listenHost") or "0.0.0.0")
    listen_port = int(inbound["listenPort"])
    data_path = str(target.parent / f"{SAFE_TAG.sub('_', str(inbound.get('tag') or 'inbound'))}-data")
    api_port_raw = inbound.get("apiPort")
    api_port: int | None = None
    if isinstance(api_port_raw, (int, float)) and not isinstance(api_port_raw, bool):
        candidate = int(api_port_raw)
        if 1 <= candidate <= 65_535:
            api_port = candidate
    api_block = (
        f"""[server.api]
enabled = true
listen = {toml_string(f"127.0.0.1:{api_port}")}
whitelist = ["127.0.0.1/32", "::1/128"]
read_only = true
"""
        if api_port is not None
        else """[server.api]
enabled = false
"""
    )
    censorship = (
        f"""[censorship]
tls_domain = {toml_string(tls_domain)}
mask = true
tls_emulation = true
tls_front_dir = {toml_string(front_dir)}
"""
        if mode == "TLS"
        else f"""[censorship]
tls_domain = {toml_string(tls_domain)}
mask = false
"""
    )
    content = f"""# Generated by OverVPN — do not edit
[general]
fast_mode = true
use_middle_proxy = {use_middle}
log_level = "normal"
data_path = {toml_string(data_path)}

[general.modes]
classic = {classic}
secure = {secure}
tls = {tls}

[network]
ipv4 = true
ipv6 = false
prefer = 4
stun_use = false

[server]
port = {listen_port}
listen_addr_ipv4 = {toml_string(listen_host)}

{api_block}
[[server.listeners]]
ip = {toml_string(listen_host)}

[timeouts]
client_handshake = 15
tg_connect = 10
client_keepalive = 60
client_ack = 300

{censorship}
[access.users]
{users_block}
{ip_limits_block}"""
    target.write_text(content, encoding="utf-8")
    return api_port


def _tail_text(path: Path, limit: int = 1200) -> str:
    try:
        data = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""
    data = data.strip()
    if len(data) <= limit:
        return data
    return data[-limit:]


def start_children() -> None:
    global children, children_meta
    stop_children()
    WORK_DIR.mkdir(parents=True, exist_ok=True)
    raw = CONFIG_PATH.read_text(encoding="utf-8")
    parsed = json.loads(raw)
    inbounds = parsed.get("inbounds") or []
    if not isinstance(inbounds, list):
        raise RuntimeError("config.inbounds must be an array")

    if not TELEMT_BIN.is_file():
        raise RuntimeError(f"telemt binary not found at {TELEMT_BIN}")
    if not os.access(TELEMT_BIN, os.X_OK):
        raise RuntimeError(f"telemt binary is not executable: {TELEMT_BIN}")

    started: list[subprocess.Popen[Any]] = []
    started_meta: list[dict[str, Any]] = []
    for index, inbound in enumerate(inbounds):
        if not isinstance(inbound, dict):
            raise RuntimeError("inbound entry must be an object")
        tag = SAFE_TAG.sub("_", str(inbound.get("tag") or f"inbound{index}"))
        users = inbound.get("users") or []
        if not isinstance(users, list) or len(users) == 0:
            log(f"skip {tag}: no users assigned yet")
            continue
        conf_path = WORK_DIR / f"{tag}.toml"
        api_port = write_inbound_config(inbound, conf_path)
        data_dir = WORK_DIR / f"{tag}-data"
        front_dir = WORK_DIR / f"{tag}-tlsfront"
        data_dir.mkdir(parents=True, exist_ok=True)
        front_dir.mkdir(parents=True, exist_ok=True)
        log_path = WORK_DIR / f"{tag}.log"
        log_file = open(log_path, "ab", buffering=0)
        proc = subprocess.Popen(
            [
                str(TELEMT_BIN),
                "--data-path",
                str(data_dir),
                str(conf_path),
            ],
            cwd=str(WORK_DIR),
            stdout=log_file,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
        started.append(proc)
        started_meta.append(
            {
                "tag": tag,
                "api_port": api_port,
                "listen_port": inbound.get("listenPort"),
            }
        )
        log(
            f"started {tag} pid={proc.pid} port={inbound.get('listenPort')} "
            f"middle_proxy={USE_MIDDLE_PROXY} api_port={api_port}"
        )

    time.sleep(SETTLE_SECONDS)
    for proc, meta in zip(started, started_meta):
        if proc.poll() is not None:
            log_path = WORK_DIR / f"{meta['tag']}.log"
            tail = _tail_text(log_path)
            stop_children_list(started)
            detail = f"mtproxy child {meta['tag']} exited early with code {proc.returncode}"
            if tail:
                detail = f"{detail}; log: {tail}"
            raise RuntimeError(detail)
    children = started
    children_meta = started_meta
    if not children:
        log("no MTProxy inbounds with users; supervisor idle")
        write_runtime_stats([])
    else:
        refresh_runtime_stats()


def stop_children_list(procs: list[subprocess.Popen[Any]]) -> None:
    for proc in procs:
        if proc.poll() is None:
            proc.terminate()
    for proc in procs:
        try:
            proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            proc.kill()


def write_ack(request_id: str, request_hash: str, status: str, message: str) -> None:
    ACK_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = ACK_PATH.with_suffix(f".tmp.{os.getpid()}")
    tmp.write_text(
        f"id={request_id}\nhash={request_hash}\nstatus={status}\nmessage={message}\n",
        encoding="utf-8",
    )
    tmp.replace(ACK_PATH)


def handle_signal(signum: int, _frame: Any) -> None:
    global stopping
    stopping = True
    log(f"received signal {signum}; shutting down")
    stop_children()
    try:
        PID_PATH.unlink(missing_ok=True)
        HEARTBEAT_PATH.unlink(missing_ok=True)
    except OSError:
        pass
    sys.exit(0)


def parse_request(path: Path) -> tuple[str, str]:
    request_id = ""
    request_hash = ""
    for line in path.read_text(encoding="utf-8").splitlines():
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        if key == "id":
            request_id = value
        elif key == "hash":
            request_hash = value
    return request_id, request_hash


def fetch_telemt_json(url: str, timeout: float = 1.5) -> Any:
    request = urllib.request.Request(url, method="GET")
    with urllib.request.urlopen(request, timeout=timeout) as response:
        body = response.read().decode("utf-8")
    parsed = json.loads(body)
    if isinstance(parsed, dict) and parsed.get("ok") is True:
        return parsed.get("data")
    return parsed


def write_runtime_stats(inbounds: list[dict[str, Any]]) -> None:
    payload = {
        "version": 1,
        "capturedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "useMiddleProxy": USE_MIDDLE_PROXY,
        "inbounds": inbounds,
    }
    RUNTIME_STATS_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = RUNTIME_STATS_PATH.with_suffix(f".tmp.{os.getpid()}")
    tmp.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    tmp.replace(RUNTIME_STATS_PATH)


def refresh_runtime_stats() -> None:
    global last_stats_at
    inbounds_out: list[dict[str, Any]] = []
    for meta in children_meta:
        tag = str(meta.get("tag") or "")
        api_port = meta.get("api_port")
        users_out: list[dict[str, Any]] = []
        warning: str | None = None
        if not isinstance(api_port, int):
            warning = "api-disabled"
        else:
            try:
                users_data = fetch_telemt_json(
                    f"http://127.0.0.1:{api_port}/v1/users"
                )
                active_by_user: dict[str, list[str]] = {}
                try:
                    active_data = fetch_telemt_json(
                        f"http://127.0.0.1:{api_port}/v1/stats/users/active-ips"
                    )
                    if isinstance(active_data, list):
                        for row in active_data:
                            if not isinstance(row, dict):
                                continue
                            username = str(row.get("username") or "").strip()
                            ips = row.get("active_ips") or []
                            if username and isinstance(ips, list):
                                active_by_user[username] = [
                                    str(ip) for ip in ips if ip
                                ]
                except (urllib.error.URLError, TimeoutError, ValueError, OSError):
                    # Older Telemt builds may lack this endpoint.
                    pass

                if isinstance(users_data, list):
                    for row in users_data:
                        if not isinstance(row, dict):
                            continue
                        username = str(row.get("username") or "").strip()
                        if not username:
                            continue
                        current_connections = row.get("current_connections") or 0
                        try:
                            connections = int(current_connections)
                        except (TypeError, ValueError):
                            connections = 0
                        total_octets = row.get("total_octets") or 0
                        try:
                            octets = int(total_octets)
                        except (TypeError, ValueError):
                            octets = 0
                        ips = active_by_user.get(username) or []
                        users_out.append(
                            {
                                "username": username,
                                "currentConnections": max(0, connections),
                                "totalOctets": max(0, octets),
                                "activeIps": ips,
                            }
                        )
            except (urllib.error.URLError, TimeoutError, ValueError, OSError) as exc:
                warning = f"stats-unavailable:{exc}"
        entry: dict[str, Any] = {
            "tag": tag,
            "listenPort": meta.get("listen_port"),
            "apiPort": api_port,
            "users": users_out,
        }
        if warning:
            entry["warning"] = warning
        inbounds_out.append(entry)
    write_runtime_stats(inbounds_out)
    last_stats_at = time.time()


def main() -> None:
    signal.signal(signal.SIGTERM, handle_signal)
    signal.signal(signal.SIGINT, handle_signal)
    REQUEST_PATH.parent.mkdir(parents=True, exist_ok=True)
    try:
        REQUEST_PATH.unlink(missing_ok=True)
        ACK_PATH.unlink(missing_ok=True)
    except OSError:
        pass

    write_pid()
    write_heartbeat()
    log(f"use_middle_proxy={USE_MIDDLE_PROXY}")
    start_children()
    last_request_id = ""

    while not stopping:
        write_heartbeat()
        for proc in list(children):
            if proc.poll() is not None:
                log(f"child pid={proc.pid} exited with {proc.returncode}")
                stop_children()
                sys.exit(1)

        if REQUEST_PATH.is_file():
            try:
                request_id, request_hash = parse_request(REQUEST_PATH)
            except OSError:
                request_id, request_hash = "", ""
            if request_id and request_id != last_request_id:
                status = "error"
                message = "invalid-request"
                if re.fullmatch(r"[0-9a-f]{64}", request_hash or ""):
                    try:
                        start_children()
                        status = "ok"
                        message = "restarted"
                    except Exception as exc:  # noqa: BLE001
                        message = f"restart-failed:{exc}"
                        try:
                            start_children()
                        except Exception:
                            pass
                else:
                    message = "invalid-hash"
                write_ack(request_id, request_hash, status, message)
                last_request_id = request_id
                write_heartbeat()

        if children and (time.time() - last_stats_at) >= STATS_POLL_SECONDS:
            try:
                refresh_runtime_stats()
            except Exception as exc:  # noqa: BLE001
                log(f"runtime stats refresh failed: {exc}")

        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001
        log(f"fatal: {exc}")
        stop_children()
        sys.exit(1)
