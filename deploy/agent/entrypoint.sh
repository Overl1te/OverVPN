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

# Named volumes are root-owned on first create; agent prefers to run as `node`.
if [ "$(id -u)" = "0" ]; then
  chown -R node:node "$state_dir" 2>/dev/null || true
  chown -R node:node \
    "$(dirname "${SING_BOX_RELOAD_REQUEST_PATH:-/var/lib/overvpn/reload/request}")" \
    "$(dirname "${XRAY_RELOAD_REQUEST_PATH:-/var/lib/overvpn/xray-reload/request}")" \
    "$(dirname "${MTPROXY_RELOAD_REQUEST_PATH:-/var/lib/overvpn/mtproxy-reload/request}")" \
    2>/dev/null || true

  # Prefer dropping privileges. runuser needs CAP_SETGID for supplementary groups
  # and fails with "cannot set groups" on some hosts — fall back to setpriv / root.
  if command -v runuser >/dev/null 2>&1 && runuser -u node -- true >/dev/null 2>&1; then
    exec runuser -u node -- "$@"
  fi
  if command -v setpriv >/dev/null 2>&1; then
    exec setpriv --reuid=1000 --regid=1000 --clear-groups -- "$@"
  fi
  exec "$@"
fi

exec "$@"
