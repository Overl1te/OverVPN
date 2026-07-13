#!/usr/bin/env bash
# Ensure Node.js 24 is available for self-hosted CI.
# Prefers an existing v24 on PATH, otherwise installs once into $HOME/.local/node
# (persists across jobs on self-hosted runners — avoids re-downloading ~280MB via setup-node).
set -euo pipefail

NODE_MAJOR="${OVERVPN_NODE_MAJOR:-24}"
# Pin a known-good 24.x; override with OVERVPN_NODE_VERSION=v24.x.y if needed.
NODE_VERSION="${OVERVPN_NODE_VERSION:-}"
PREFIX="${OVERVPN_NODE_PREFIX:-${HOME}/.local/node}"
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64 | amd64) NODE_ARCH="x64" ;;
  aarch64 | arm64) NODE_ARCH="arm64" ;;
  *)
    echo "::error::Unsupported architecture: ${ARCH}"
    exit 1
    ;;
esac

node_major() {
  local bin="${1:-node}"
  "$bin" -p 'process.versions.node.split(".")[0]' 2>/dev/null || true
}

use_prefix() {
  if [[ -n "${GITHUB_PATH:-}" ]]; then
    echo "${PREFIX}/bin" >>"$GITHUB_PATH"
  else
    export PATH="${PREFIX}/bin:${PATH}"
  fi
}

resolve_version() {
  if [[ -n "$NODE_VERSION" ]]; then
    echo "$NODE_VERSION"
    return 0
  fi
  if command -v jq >/dev/null 2>&1; then
    local resolved
    resolved="$(curl -fsSL https://nodejs.org/dist/index.json | jq -r --arg major "$NODE_MAJOR" '[.[] | select(.version | test("^v" + $major + "\\."))][0].version')"
    if [[ -n "$resolved" && "$resolved" != "null" ]]; then
      echo "$resolved"
      return 0
    fi
  fi
  # Fallback: first matching line from dist index without jq
  local fallback
  fallback="$(curl -fsSL https://nodejs.org/dist/index.tab | awk -v major="$NODE_MAJOR" 'NR>1 && $1 ~ ("^v" major "\\.") { print $1; exit }')"
  if [[ -n "$fallback" ]]; then
    echo "$fallback"
    return 0
  fi
  return 1
}

if command -v node >/dev/null 2>&1 && [[ "$(node_major node)" == "$NODE_MAJOR" ]]; then
  echo "Using existing $(node -v) at $(command -v node)"
  exit 0
fi

if [[ -x "${PREFIX}/bin/node" ]] && [[ "$(node_major "${PREFIX}/bin/node")" == "$NODE_MAJOR" ]]; then
  use_prefix
  echo "Using cached $(${PREFIX}/bin/node -v) at ${PREFIX}"
  exit 0
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "::error::curl is required to download Node.js"
  exit 1
fi

VERSION="$(resolve_version)" || {
  echo "::error::Could not resolve latest Node.js ${NODE_MAJOR} from nodejs.org"
  exit 1
}

URL="https://nodejs.org/dist/${VERSION}/node-${VERSION}-linux-${NODE_ARCH}.tar.xz"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "Downloading ${URL}..."
curl -fsSL --retry 5 --retry-delay 2 --retry-all-errors -o "${TMP}/node.tar.xz" "$URL"

mkdir -p "${HOME}/.local"
rm -rf "$PREFIX"
tar -xJf "${TMP}/node.tar.xz" -C "$TMP"
mv "${TMP}/node-${VERSION}-linux-${NODE_ARCH}" "$PREFIX"

use_prefix
echo "Installed $(${PREFIX}/bin/node -v) to ${PREFIX}"
${PREFIX}/bin/node -v
${PREFIX}/bin/npm -v
