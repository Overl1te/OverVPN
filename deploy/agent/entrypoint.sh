#!/bin/sh
set -eu

mkdir -p \
  "$(dirname "${SING_BOX_CONFIG_PATH:-/var/lib/sing-box/config.json}")" \
  "$(dirname "${SING_BOX_RELOAD_REQUEST_PATH:-/var/lib/overvpn/reload/request}")" \
  "$(dirname "${XRAY_CONFIG_PATH:-/var/lib/xray/config.json}")" \
  "$(dirname "${XRAY_RELOAD_REQUEST_PATH:-/var/lib/overvpn/xray-reload/request}")" \
  "$(dirname "${MTPROXY_CONFIG_PATH:-/var/lib/mtproxy/config.json}")" \
  "$(dirname "${MTPROXY_RELOAD_REQUEST_PATH:-/var/lib/overvpn/mtproxy-reload/request}")" \
  "$(dirname "${AGENT_STATE_PATH:-/var/lib/overvpn/agent/state.json}")"

exec "$@"
