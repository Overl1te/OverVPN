#!/bin/sh
# Ensures Xray has a usable seed config with Stats API before the core starts.
set -eu

SHARED="${XRAY_SHARED_DIR:-/shared}"
API_LISTEN="${XRAY_API_LISTEN:-0.0.0.0:10085}"
CONFIG="${SHARED}/config.json"

mkdir -p /reload /state "$SHARED"

json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

write_bootstrap() {
  listen_json="$(json_escape "$API_LISTEN")"
  cat >"$CONFIG" <<EOF
{
  "log": {
    "loglevel": "warning"
  },
  "stats": {},
  "api": {
    "tag": "api",
    "listen": "${listen_json}",
    "services": ["StatsService"]
  },
  "policy": {
    "levels": {
      "0": {
        "statsUserUplink": true,
        "statsUserDownlink": true,
        "statsUserOnline": true
      }
    },
    "system": {
      "statsInboundUplink": true,
      "statsInboundDownlink": true,
      "statsOutboundUplink": true,
      "statsOutboundDownlink": true
    }
  },
  "inbounds": [],
  "outbounds": [
    {
      "protocol": "freedom",
      "tag": "direct"
    },
    {
      "protocol": "blackhole",
      "tag": "blocked"
    },
    {
      "protocol": "freedom",
      "tag": "api"
    }
  ],
  "routing": {
    "rules": [
      {
        "inboundTag": ["api"],
        "outboundTag": "api"
      },
      {
        "ip": ["geoip:private"],
        "outboundTag": "blocked"
      }
    ]
  }
}
EOF
}

needs_bootstrap=0
if [ ! -s "$CONFIG" ]; then
  needs_bootstrap=1
elif ! grep -q '"StatsService"' "$CONFIG"; then
  needs_bootstrap=1
elif ! grep -q '"api"' "$CONFIG"; then
  needs_bootstrap=1
fi

if [ "$needs_bootstrap" -eq 1 ]; then
  write_bootstrap
  echo "Wrote bootstrap Xray config with Stats API"
fi

chmod 600 "$CONFIG"
chown -R 1000:1000 "$SHARED" /reload /state
