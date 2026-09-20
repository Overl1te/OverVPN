#!/usr/bin/env python3
"""AmneziaWG 2.0 supervisor: render awg-quick configs and reload on request."""

from __future__ import annotations

import hashlib
import json
import os
import re
import signal
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

CONFIG_PATH = Path(os.environ.get("AMNEZIAWG_CONFIG_PATH", "/var/lib/amneziawg/config.json"))
REQUEST_PATH = Path(
    os.environ.get(
        "AMNEZIAWG_RELOAD_REQUEST_PATH", "/var/lib/overvpn/amneziawg-reload/request"
    )
)
ACK_PATH = Path(
    os.environ.get("AMNEZIAWG_RELOAD_ACK_PATH", "/var/lib/overvpn/amneziawg-reload/ack")
)
PID_PATH = Path(
    os.environ.get("AMNEZIAWG_PID_PATH", "/var/lib/overvpn/amneziawg-reload/amneziawg.pid")
)
HEARTBEAT_PATH = Path(
    os.environ.get(
        "AMNEZIAWG_HEARTBEAT_PATH", "/var/lib/overvpn/amneziawg-reload/heartbeat"
    )
)
RUNTIME_STATS_PATH = Path(
    os.environ.get(
        "AMNEZIAWG_RUNTIME_STATS_PATH",
        "/var/lib/overvpn/amneziawg-reload/runtime-stats.json",
    )
)
WORK_DIR = Path(os.environ.get("AMNEZIAWG_WORK_DIR", "/var/lib/amneziawg-work"))
STATE_PATH = WORK_DIR / "ifaces.json"
POLL_SECONDS = float(os.environ.get("AMNEZIAWG_RELOAD_POLL_SECONDS", "0.2"))
STATS_POLL_SECONDS = float(os.environ.get("AMNEZIAWG_STATS_POLL_SECONDS", "5"))
AWG_BIN = os.environ.get("AWG_BIN", "/usr/local/bin/awg")
AWG_QUICK = os.environ.get("AWG_QUICK_BIN", "/usr/local/bin/awg-quick")

stopping = False
last_stats_at = 0.0


def log(message: str) -> None:
    print(f"[amneziawg-supervisor] {message}", flush=True)


def write_pid() -> None:
    PID_PATH.parent.mkdir(parents=True, exist_ok=True)
    PID_PATH.write_text(f"{os.getpid()}\n", encoding="utf-8")


def write_heartbeat() -> None:
    HEARTBEAT_PATH.parent.mkdir(parents=True, exist_ok=True)
    HEARTBEAT_PATH.write_text(f"{time.time():.3f}\n", encoding="utf-8")


def handle_signal(_signum: int, _frame: Any) -> None:
    global stopping
    stopping = True


def iface_name(tag: str) -> str:
    digest = hashlib.sha256(tag.encode("utf-8")).hexdigest()[:8]
    return f"awg{digest}"


def default_outbound() -> str:
    try:
        completed = subprocess.run(
            ["ip", "route", "show", "default"],
            check=False,
            capture_output=True,
            text=True,
            timeout=5,
        )
        for token in completed.stdout.split():
            if token.startswith("eth") or token.startswith("en") or token.startswith("ens"):
                return token
            if token in {"dev"}:
                continue
        parts = completed.stdout.split()
        if "dev" in parts:
            idx = parts.index("dev")
            if idx + 1 < len(parts):
                return parts[idx + 1]
    except (OSError, subprocess.TimeoutExpired):
        pass
    return "eth0"


def conf_path(iface: str) -> Path:
    return WORK_DIR / f"{iface}.conf"


def load_state() -> dict[str, Any]:
    if not STATE_PATH.is_file():
        return {"ifaces": {}}
    try:
        parsed = json.loads(STATE_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"ifaces": {}}
    ifaces = parsed.get("ifaces") if isinstance(parsed, dict) else {}
    return {"ifaces": ifaces if isinstance(ifaces, dict) else {}}


def save_state(state: dict[str, Any]) -> None:
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    STATE_PATH.write_text(json.dumps(state), encoding="utf-8")


def run_awg_quick(action: str, path: Path) -> None:
    env = os.environ.copy()
    env["WG_QUICK_USERSPACE_IMPLEMENTATION"] = env.get(
        "WG_QUICK_USERSPACE_IMPLEMENTATION", "/usr/local/bin/amneziawg-go"
    )
    completed = subprocess.run(
        ["bash", AWG_QUICK, action, str(path)],
        check=False,
        capture_output=True,
        text=True,
        timeout=30,
        env=env,
    )
    if completed.returncode != 0 and action == "up":
        raise RuntimeError(
            f"awg-quick {action} {path.name} failed: {completed.stderr.strip() or completed.stdout.strip()}"
        )
    if completed.returncode != 0:
        log(f"awg-quick {action} {path.name}: {completed.stderr.strip()}")


def render_conf(inbound: dict[str, Any], iface: str, outbound: str) -> str:
    address = str(inbound.get("address") or "10.67.0.1/24")
    listen_port = int(inbound["listenPort"])
    private_key = str(inbound["privateKey"])
    mtu = int(inbound.get("mtu") or 1420)
    network = address.split("/")[0].rsplit(".", 1)[0] + ".0/24" if "/" in address else "10.67.0.0/24"
    lines = [
        "[Interface]",
        f"PrivateKey = {private_key}",
        f"Address = {address}",
        f"ListenPort = {listen_port}",
        f"MTU = {mtu}",
        f"Jc = {int(inbound.get('jc') or 4)}",
        f"Jmin = {int(inbound.get('jmin') or 40)}",
        f"Jmax = {int(inbound.get('jmax') or 70)}",
        f"S1 = {int(inbound.get('s1') or 0)}",
        f"S2 = {int(inbound.get('s2') or 0)}",
        f"S3 = {int(inbound.get('s3') or 0)}",
        f"S4 = {int(inbound.get('s4') or 0)}",
        f"H1 = {inbound.get('h1')}",
        f"H2 = {inbound.get('h2')}",
        f"H3 = {inbound.get('h3')}",
        f"H4 = {inbound.get('h4')}",
        f"I1 = {inbound.get('i1') or '<r 128>'}",
    ]
    for key in ("i2", "i3", "i4", "i5"):
        value = inbound.get(key)
        if isinstance(value, str) and value.strip():
            lines.append(f"{key.upper()} = {value.strip()}")
    lines.extend(
        [
            f"PostUp = iptables -A FORWARD -i {iface} -j ACCEPT; iptables -A FORWARD -o {iface} -j ACCEPT; iptables -t nat -A POSTROUTING -s {network} -o {outbound} -j MASQUERADE",
            f"PostDown = iptables -D FORWARD -i {iface} -j ACCEPT; iptables -D FORWARD -o {iface} -j ACCEPT; iptables -t nat -D POSTROUTING -s {network} -o {outbound} -j MASQUERADE",
        ]
    )
    peers = inbound.get("peers") or []
    for peer in peers:
        if not isinstance(peer, dict):
            continue
        public_key = str(peer.get("publicKey") or "").strip()
        if not public_key:
            continue
        allowed = peer.get("allowedIps") or []
        allowed_line = ", ".join(str(item) for item in allowed if item) or "0.0.0.0/32"
        lines.extend(["", "[Peer]", f"PublicKey = {public_key}", f"AllowedIPs = {allowed_line}"])
    return "\n".join(lines) + "\n"


def apply_config() -> dict[str, dict[str, Any]]:
    raw = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    if not isinstance(raw, dict) or raw.get("version") != 1:
        raise RuntimeError("invalid AmneziaWG config root")
    inbounds = raw.get("inbounds") or []
    if not isinstance(inbounds, list):
        raise RuntimeError("config.inbounds must be an array")
    outbound = default_outbound()
    WORK_DIR.mkdir(parents=True, exist_ok=True)
    desired: dict[str, dict[str, Any]] = {}
    for inbound in inbounds:
        if not isinstance(inbound, dict):
            continue
        tag = str(inbound.get("tag") or "").strip()
        if not tag:
            continue
        iface = iface_name(tag)
        path = conf_path(iface)
        path.write_text(render_conf(inbound, iface, outbound), encoding="utf-8")
        os.chmod(path, 0o600)
        desired[iface] = {
            "tag": tag,
            "listenPort": inbound.get("listenPort"),
            "path": str(path),
            "peers": inbound.get("peers") or [],
        }
    previous = load_state()["ifaces"]
    for iface, meta in previous.items():
        if iface not in desired:
            run_awg_quick("down", Path(meta["path"]))
    for iface, meta in desired.items():
        path = Path(meta["path"])
        if iface in previous:
            run_awg_quick("down", path)
        run_awg_quick("up", path)
    save_state({"ifaces": desired})
    return desired


def write_ack(request_id: str, request_hash: str, status: str, message: str) -> None:
    ACK_PATH.parent.mkdir(parents=True, exist_ok=True)
    ACK_PATH.write_text(
        f"id={request_id}\nhash={request_hash}\nstatus={status}\nmessage={message}\n",
        encoding="utf-8",
    )


def parse_request(path: Path) -> tuple[str, str]:
    data = {"id": "", "hash": ""}
    for line in path.read_text(encoding="utf-8").splitlines():
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        data[key.strip()] = value.strip()
    return data.get("id", ""), data.get("hash", "")


def refresh_runtime_stats(ifaces: dict[str, dict[str, Any]]) -> None:
    inbounds_out: list[dict[str, Any]] = []
    for iface, meta in ifaces.items():
        peers_meta = {
            str(peer.get("publicKey")): str(peer.get("userId") or "")
            for peer in (meta.get("peers") or [])
            if isinstance(peer, dict)
        }
        peers_out: list[dict[str, Any]] = []
        try:
            dump = subprocess.run(
                [AWG_BIN, "show", iface, "dump"],
                check=False,
                capture_output=True,
                text=True,
                timeout=5,
            )
            lines = dump.stdout.splitlines()
            for line in lines[1:]:
                parts = line.split("\t")
                if len(parts) < 8:
                    continue
                public_key, _preshared, endpoint, _allowed, handshake, rx, tx, _keep = parts[:8]
                peers_out.append(
                    {
                        "publicKey": public_key,
                        "userId": peers_meta.get(public_key) or None,
                        "endpoint": endpoint if endpoint != "(none)" else None,
                        "lastHandshakeEpoch": int(handshake) if handshake.isdigit() and int(handshake) > 0 else None,
                        "rxBytes": int(rx) if rx.isdigit() else 0,
                        "txBytes": int(tx) if tx.isdigit() else 0,
                    }
                )
        except (OSError, subprocess.TimeoutExpired, ValueError) as exc:
            log(f"stats {iface}: {exc}")
        inbounds_out.append(
            {
                "tag": meta.get("tag"),
                "listenPort": meta.get("listenPort"),
                "peers": peers_out,
            }
        )
    RUNTIME_STATS_PATH.parent.mkdir(parents=True, exist_ok=True)
    RUNTIME_STATS_PATH.write_text(
        json.dumps(
            {
                "version": 1,
                "capturedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "inbounds": inbounds_out,
            }
        ),
        encoding="utf-8",
    )


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
    ifaces: dict[str, dict[str, Any]] = {}
    try:
        ifaces = apply_config()
    except Exception as exc:  # noqa: BLE001
        log(f"initial apply failed: {exc}")
    last_request_id = ""
    global last_stats_at
    while not stopping:
        write_heartbeat()
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
                        ifaces = apply_config()
                        status = "ok"
                        message = "restarted"
                    except Exception as exc:  # noqa: BLE001
                        message = f"restart-failed:{exc}"
                else:
                    message = "invalid-hash"
                write_ack(request_id, request_hash, status, message)
                last_request_id = request_id
                write_heartbeat()
        if ifaces and (time.time() - last_stats_at) >= STATS_POLL_SECONDS:
            try:
                refresh_runtime_stats(ifaces)
                last_stats_at = time.time()
            except Exception as exc:  # noqa: BLE001
                log(f"runtime stats refresh failed: {exc}")
        time.sleep(POLL_SECONDS)
    for iface, meta in load_state()["ifaces"].items():
        run_awg_quick("down", Path(meta["path"]))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001
        log(f"fatal: {exc}")
        sys.exit(1)
