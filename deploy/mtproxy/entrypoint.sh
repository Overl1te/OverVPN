#!/bin/sh
set -eu

export MTPROXY_CONFIG_PATH="${MTPROXY_CONFIG_PATH:-/var/lib/mtproxy/config.json}"
export MTPROXY_RELOAD_REQUEST_PATH="${MTPROXY_RELOAD_REQUEST_PATH:-/var/lib/overvpn/mtproxy-reload/request}"
export MTPROXY_RELOAD_ACK_PATH="${MTPROXY_RELOAD_ACK_PATH:-/var/lib/overvpn/mtproxy-reload/ack}"
export MTPROXY_PID_PATH="${MTPROXY_PID_PATH:-/var/lib/overvpn/mtproxy-reload/mtproxy.pid}"
export MTPROXY_WORK_DIR="${MTPROXY_WORK_DIR:-/var/lib/mtproxy-work}"
export MTPROXY_SRC="${MTPROXY_SRC:-/opt/mtprotoproxy}"

mkdir -p "$(dirname "$MTPROXY_PID_PATH")" "$MTPROXY_WORK_DIR"

exec python3 /opt/overvpn-mtproxy/supervisor.py
