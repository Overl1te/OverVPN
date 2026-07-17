#!/usr/bin/env bash
# Install a GitHub Actions self-hosted runner for OverVPN builds.
#
# Usage (on the build machine, as root):
#   curl -fsSL https://raw.githubusercontent.com/Overl1te/OverVPN/main/scripts/install-github-runner.sh | sudo bash
#   # or from a clone:
#   sudo ./scripts/install-github-runner.sh
#
# You need a registration token from:
#   Repo → Settings → Actions → Runners → New self-hosted runner
# Or create one via:
#   gh api -X POST repos/Overl1te/OverVPN/actions/runners/registration-token --jq .token

set -euo pipefail

REPO_URL="${OVERVPN_REPO_URL:-https://github.com/Overl1te/OverVPN}"
RUNNER_USER="${RUNNER_USER:-github-runner}"
RUNNER_HOME="${RUNNER_HOME:-/opt/actions-runner}"
RUNNER_LABELS="${RUNNER_LABELS:-overvpn,linux,x64}"
BUILDX_CACHE_DIR="${BUILDX_CACHE_DIR:-}" # optional legacy path; workflow uses ~/.cache
RUNNER_VERSION="${RUNNER_VERSION:-}" # empty = latest

color() {
  local c=$1; shift
  case "$c" in
    red) printf '\e[91m%s\e[0m\n' "$*" ;;
    green) printf '\e[92m%s\e[0m\n' "$*" ;;
    yellow) printf '\e[93m%s\e[0m\n' "$*" ;;
    blue) printf '\e[94m%s\e[0m\n' "$*" ;;
    cyan) printf '\e[96m%s\e[0m\n' "$*" ;;
    *) printf '%s\n' "$*" ;;
  esac
}

if [[ "$(id -u)" -ne 0 ]]; then
  color red "Run as root (sudo)."
  exit 1
fi

if [[ -f /etc/os-release ]]; then
  # shellcheck disable=SC1091
  . /etc/os-release
else
  color red "Unsupported OS."
  exit 1
fi

color blue "Installing packages..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl ca-certificates tar xz-utils jq git

if ! command -v docker >/dev/null 2>&1; then
  color blue "Installing Docker..."
  curl -fsSL https://get.docker.com | sh
fi
# buildx is required by CI publish (docker/setup-buildx-action / build-push-action)
if ! docker buildx version >/dev/null 2>&1; then
  color blue "Installing Docker Buildx plugin..."
  apt-get install -y docker-buildx-plugin || true
fi
if ! docker buildx version >/dev/null 2>&1; then
  color yellow "docker buildx still missing; CI will install it via setup-buildx-action."
fi
systemctl enable --now docker

# Node.js 24 for CI verify (workflow also caches under the runner user's ~/.local/node)
NODE_MAJOR=24
if ! command -v node >/dev/null 2>&1 || [[ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)" != "$NODE_MAJOR" ]]; then
  color blue "Installing Node.js ${NODE_MAJOR}..."
  NODE_VERSION="$(curl -fsSL https://nodejs.org/dist/index.json | jq -r --arg major "$NODE_MAJOR" '[.[] | select(.version | test("^v" + $major + "\\."))][0].version')"
  if [[ -z "$NODE_VERSION" || "$NODE_VERSION" == "null" ]]; then
    color red "Could not resolve Node.js ${NODE_MAJOR} from nodejs.org"
    exit 1
  fi
  curl -fsSL --retry 5 --retry-delay 2 -o /tmp/node.tar.xz \
    "https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-linux-x64.tar.xz"
  tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1
  rm -f /tmp/node.tar.xz
fi
color green "Node $(node -v) / npm $(npm -v)"

if ! id -u "$RUNNER_USER" >/dev/null 2>&1; then
  color blue "Creating user ${RUNNER_USER}..."
  useradd --system --create-home --home-dir "/home/${RUNNER_USER}" --shell /bin/bash "$RUNNER_USER"
fi
usermod -aG docker "$RUNNER_USER"

mkdir -p "$RUNNER_HOME"
# Optional shared cache dir (workflow prefers $HOME/.cache/overvpn-buildx)
if [[ -n "$BUILDX_CACHE_DIR" ]]; then
  mkdir -p "$BUILDX_CACHE_DIR"
  chmod 1777 "$BUILDX_CACHE_DIR"
fi
chown -R "${RUNNER_USER}:${RUNNER_USER}" "$RUNNER_HOME"

ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|amd64) RUNNER_ARCH="x64" ;;
  aarch64|arm64) RUNNER_ARCH="arm64" ;;
  *) color red "Unsupported arch: ${ARCH}"; exit 1 ;;
esac

if [[ -z "$RUNNER_VERSION" ]]; then
  RUNNER_VERSION="$(curl -fsSL https://api.github.com/repos/actions/runner/releases/latest | jq -r .tag_name | sed 's/^v//')"
fi

TGZ="actions-runner-linux-${RUNNER_ARCH}-${RUNNER_VERSION}.tar.gz"
URL="https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/${TGZ}"

color blue "Downloading runner v${RUNNER_VERSION} (${RUNNER_ARCH})..."
cd "$RUNNER_HOME"
if [[ ! -f ./config.sh ]]; then
  curl -fsSL -o "/tmp/${TGZ}" "$URL"
  sudo -u "$RUNNER_USER" tar xzf "/tmp/${TGZ}" -C "$RUNNER_HOME"
  rm -f "/tmp/${TGZ}"
else
  color yellow "Runner already extracted in ${RUNNER_HOME}"
fi

if [[ -f "${RUNNER_HOME}/.runner" ]]; then
  color yellow "Runner already configured. To reconfigure: sudo -u ${RUNNER_USER} ${RUNNER_HOME}/config.sh remove"
  color green "Service install (if needed): cd ${RUNNER_HOME} && ./svc.sh install ${RUNNER_USER} && ./svc.sh start"
  exit 0
fi

TOKEN="${RUNNER_TOKEN:-}"
if [[ -z "$TOKEN" ]]; then
  echo
  color yellow "Get a registration token:"
  color yellow "  ${REPO_URL}/settings/actions/runners/new"
  color yellow "Or: gh api -X POST repos/Overl1te/OverVPN/actions/runners/registration-token --jq .token"
  echo
  if [[ -t 0 ]]; then
    read -r -p "Registration token: " TOKEN
  fi
fi

if [[ -z "$TOKEN" ]]; then
  color red "RUNNER_TOKEN is required."
  exit 1
fi

color blue "Configuring runner..."
sudo -u "$RUNNER_USER" "$RUNNER_HOME/config.sh" \
  --unattended \
  --url "$REPO_URL" \
  --token "$TOKEN" \
  --name "${RUNNER_NAME:-$(hostname)-overvpn}" \
  --labels "$RUNNER_LABELS" \
  --work "_work" \
  --replace

color blue "Installing systemd service..."
cd "$RUNNER_HOME"
./svc.sh install "$RUNNER_USER"
./svc.sh start

color green "Self-hosted runner is up."
color cyan "Labels: ${RUNNER_LABELS}"
color cyan "Home:   ${RUNNER_HOME}"
color cyan "User:   ${RUNNER_USER}"
if [[ -n "$BUILDX_CACHE_DIR" ]]; then
  color cyan "Cache:  ${BUILDX_CACHE_DIR}"
fi
echo
color yellow "Check: systemctl status actions.runner.*.service"
color yellow "Or:    ${REPO_URL}/settings/actions/runners"
