#!/bin/sh
set -eu

state_dir="$(dirname "${AGENT_STATE_PATH:-/var/lib/overvpn/agent/state.json}")"
singbox_config_dir="$(dirname "${SING_BOX_CONFIG_PATH:-/var/lib/sing-box/config.json}")"
singbox_reload_dir="$(dirname "${SING_BOX_RELOAD_REQUEST_PATH:-/var/lib/overvpn/reload/request}")"
xray_config_dir="$(dirname "${XRAY_CONFIG_PATH:-/var/lib/xray/config.json}")"
xray_reload_dir="$(dirname "${XRAY_RELOAD_REQUEST_PATH:-/var/lib/overvpn/xray-reload/request}")"
mtproxy_config_dir="$(dirname "${MTPROXY_CONFIG_PATH:-/var/lib/mtproxy/config.json}")"
mtproxy_reload_dir="$(dirname "${MTPROXY_RELOAD_REQUEST_PATH:-/var/lib/overvpn/mtproxy-reload/request}")"

mkdir -p \
  "$singbox_config_dir" \
  "$singbox_reload_dir" \
  "$xray_config_dir" \
  "$xray_reload_dir" \
  "$mtproxy_config_dir" \
  "$mtproxy_reload_dir" \
  "$state_dir"

# Named volumes are often root-owned on first create; agent prefers to run as `node`.
# Chown every writable mount so both root fallback and node drop can apply configs.
if [ "$(id -u)" = "0" ]; then
  # Drop to node only when volumes are writable as node. Without CAP_CHOWN,
  # chown is a no-op under cap_drop:ALL and runuser would EACCES on state/config.
  can_drop=0
  if chown -R node:node \
    "$state_dir" \
    "$singbox_config_dir" \
    "$singbox_reload_dir" \
    "$xray_config_dir" \
    "$xray_reload_dir" \
    "$mtproxy_config_dir" \
    "$mtproxy_reload_dir" \
    2>/dev/null \
    && runuser -u node -- sh -c "touch '${state_dir}/.write-test' && rm -f '${state_dir}/.write-test'" >/dev/null 2>&1; then
    can_drop=1
  fi

  if [ "$can_drop" = "1" ]; then
    # Prefer dropping privileges. runuser needs CAP_SETGID for supplementary groups
    # and fails with "cannot set groups" on some hosts. setpriv needs CAP_SETUID and
    # fails under Docker `no-new-privileges` / `cap_drop: ALL` — probe before exec
    # so we can fall back to root instead of crash-looping (exit 127).
    if command -v runuser >/dev/null 2>&1 && runuser -u node -- true >/dev/null 2>&1; then
      exec runuser -u node -- "$@"
    fi
    if command -v setpriv >/dev/null 2>&1 \
      && setpriv --reuid=1000 --regid=1000 --clear-groups -- true >/dev/null 2>&1; then
      exec setpriv --reuid=1000 --regid=1000 --clear-groups -- "$@"
    fi
  fi
  # Root fallback: volumes may still be node-owned from cores/init — make writable.
  chmod -R u+rwX \
    "$state_dir" \
    "$singbox_config_dir" \
    "$singbox_reload_dir" \
    "$xray_config_dir" \
    "$xray_reload_dir" \
    "$mtproxy_config_dir" \
    "$mtproxy_reload_dir" \
    2>/dev/null || true
  exec "$@"
fi

exec "$@"
