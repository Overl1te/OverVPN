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
# Agent (uid 1000) writes this volume. The AWG supervisor is root with
# cap_drop:ALL; compose grants DAC_OVERRIDE so it can still read/write 0600 files.
chown -R 1000:1000 "$SHARED" /reload /state /work 2>/dev/null || true
