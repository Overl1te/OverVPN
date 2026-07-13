#!/usr/bin/env bash
# Package runtime deploy files for slim installs (no full git clone).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-${ROOT}/dist/overvpn-deploy.tar.gz}"

mkdir -p "$(dirname "$OUT")"
tar -czf "$OUT" \
  -C "$ROOT" \
  .env.example \
  install.sh \
  deploy/docker-compose.yml \
  deploy/landing \
  deploy/sing-box \
  deploy/proxy

printf 'Created %s\n' "$OUT"
