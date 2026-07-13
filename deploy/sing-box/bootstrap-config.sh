#!/bin/sh
# Ensures sing-box has a usable seed config with Clash/V2Ray control APIs
# before the core process starts. Secrets come from compose env.
set -eu

SHARED="${SING_BOX_SHARED_DIR:-/shared}"
LISTEN="${SING_BOX_CLASH_API_LISTEN:-0.0.0.0:9090}"
SECRET="${SING_BOX_CLASH_API_SECRET:?SING_BOX_CLASH_API_SECRET is required}"
V2RAY_LISTEN="${SING_BOX_V2RAY_API_LISTEN:-0.0.0.0:8080}"
CONFIG="${SHARED}/config.json"

mkdir -p /reload /state "$SHARED"

json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

write_bootstrap() {
  secret_json="$(json_escape "$SECRET")"
  listen_json="$(json_escape "$LISTEN")"
  v2ray_json="$(json_escape "$V2RAY_LISTEN")"
  cat >"$CONFIG" <<EOF
{
  "log": {
    "disabled": false,
    "level": "info",
    "timestamp": true
  },
  "inbounds": [],
  "outbounds": [
    {
      "type": "direct",
      "tag": "direct"
    },
    {
      "type": "block",
      "tag": "block"
    }
  ],
  "route": {
    "final": "direct",
    "auto_detect_interface": true,
    "rules": [
      {
        "ip_is_private": true,
        "outbound": "block"
      }
    ]
  },
  "experimental": {
    "clash_api": {
      "external_controller": "${listen_json}",
      "secret": "${secret_json}",
      "access_control_allow_origin": [],
      "access_control_allow_private_network": false
    },
    "v2ray_api": {
      "listen": "${v2ray_json}",
      "stats": {
        "enabled": true,
        "inbounds": [],
        "outbounds": ["block", "direct"],
        "users": []
      }
    }
  }
}
EOF
}

# Empty seed: missing file, no clash_api, or empty inbounds with wrong secret.
needs_bootstrap=0
if [ ! -s "$CONFIG" ]; then
  needs_bootstrap=1
elif ! grep -q '"clash_api"' "$CONFIG"; then
  needs_bootstrap=1
elif ! grep -Fq "$SECRET" "$CONFIG"; then
  # Only rewrite when there are still no configured inbounds (fresh seed).
  if grep -qE '"inbounds"[[:space:]]*:[[:space:]]*\[[[:space:]]*\]' "$CONFIG"; then
    needs_bootstrap=1
  else
    echo "sing-box config secret differs from env; leaving applied config intact (re-apply from panel)" >&2
  fi
fi

if [ "$needs_bootstrap" -eq 1 ]; then
  write_bootstrap
  echo "Wrote bootstrap sing-box config with Clash/V2Ray APIs"
fi

chmod 600 "$CONFIG"
chown -R 1000:1000 "$SHARED" /reload /state
