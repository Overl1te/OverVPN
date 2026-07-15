#!/bin/sh
# Seeds an empty MTProxy config before the supervisor starts.
set -eu

SHARED="${MTPROXY_SHARED_DIR:-/shared}"
CONFIG="${SHARED}/config.json"

mkdir -p /reload /state "$SHARED" /work

if [ ! -s "$CONFIG" ]; then
  cat >"$CONFIG" <<'EOF'
{
  "version": 1,
  "inbounds": []
}
EOF
  echo "Wrote bootstrap MTProxy config"
fi

chmod 600 "$CONFIG"
chown -R 1000:1000 "$SHARED" /reload /state /work 2>/dev/null || true
