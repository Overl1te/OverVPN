#!/bin/sh
set -eu

SHARED="${AMNEZIAWG_SHARED_DIR:-/shared}"
CONFIG="${SHARED}/config.json"

mkdir -p /reload /state "$SHARED" /work

if [ ! -s "$CONFIG" ]; then
  cat >"$CONFIG" <<'EOF'
{
  "version": 1,
  "inbounds": []
}
EOF
  echo "Wrote bootstrap AmneziaWG config"
fi

chmod 600 "$CONFIG"
chown -R 0:0 "$SHARED" /reload /state /work 2>/dev/null || true
