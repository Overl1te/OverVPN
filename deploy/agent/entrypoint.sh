#!/bin/sh
set -eu

state_dir="$(dirname "${AGENT_STATE_PATH:-/var/lib/overvpn/agent/state.json}")"

mkdir -p \
  "$(dirname "${SING_BOX_CONFIG_PATH:-/var/lib/sing-box/config.json}")" \
  "$(dirname "${SING_BOX_RELOAD_REQUEST_PATH:-/var/lib/overvpn/reload/request}")" \
  "$(dirname "${XRAY_CONFIG_PATH:-/var/lib/xray/config.json}")" \
  "$(dirname "${XRAY_RELOAD_REQUEST_PATH:-/var/lib/overvpn/xray-reload/request}")" \
  "$(dirname "${MTPROXY_CONFIG_PATH:-/var/lib/mtproxy/config.json}")" \
  "$(dirname "${MTPROXY_RELOAD_REQUEST_PATH:-/var/lib/overvpn/mtproxy-reload/request}")" \
  "$state_dir"

# Named volumes are root-owned on first create; agent runs as `node` and must write state.
if [ "$(id -u)" = "0" ]; then
  chown -R node:node "$state_dir" 2>/dev/null || true
  # Reload request dirs must be writable for apply push.
  chown -R node:node \
    "$(dirname "${SING_BOX_RELOAD_REQUEST_PATH:-/var/lib/overvpn/reload/request}")" \
    "$(dirname "${XRAY_RELOAD_REQUEST_PATH:-/var/lib/overvpn/xray-reload/request}")" \
    "$(dirname "${MTPROXY_RELOAD_REQUEST_PATH:-/var/lib/overvpn/mtproxy-reload/request}")" \
    2>/dev/null || true
  exec runuser -u node -- "$@"
fi

exec "$@"
