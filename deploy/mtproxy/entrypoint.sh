#!/bin/sh
set -eu

export MTPROXY_CONFIG_PATH="${MTPROXY_CONFIG_PATH:-/var/lib/mtproxy/config.json}"
export MTPROXY_RELOAD_REQUEST_PATH="${MTPROXY_RELOAD_REQUEST_PATH:-/var/lib/overvpn/mtproxy-reload/request}"
export MTPROXY_RELOAD_ACK_PATH="${MTPROXY_RELOAD_ACK_PATH:-/var/lib/overvpn/mtproxy-reload/ack}"
export MTPROXY_PID_PATH="${MTPROXY_PID_PATH:-/var/lib/overvpn/mtproxy-reload/mtproxy.pid}"
export MTPROXY_HEARTBEAT_PATH="${MTPROXY_HEARTBEAT_PATH:-/var/lib/overvpn/mtproxy-reload/heartbeat}"
export MTPROXY_WORK_DIR="${MTPROXY_WORK_DIR:-/var/lib/mtproxy-work}"
export TELEMT_BIN="${TELEMT_BIN:-/usr/local/bin/telemt}"

mkdir -p "$(dirname "$MTPROXY_PID_PATH")" "$(dirname "$MTPROXY_HEARTBEAT_PATH")" "$MTPROXY_WORK_DIR"

exec python3 /opt/overvpn-mtproxy/supervisor.py
