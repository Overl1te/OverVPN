#!/usr/bin/env bash
# OverVPN installer & management CLI (Marzban-style).
# Usage:
#   sudo bash -c "$(curl -fsSL https://raw.githubusercontent.com/Overl1te/OverVPN/master/install.sh)" @ install
#   overvpn up|down|restart|status|logs|update|uninstall|info|edit|bootstrap

set -euo pipefail

APP_NAME="overvpn"
INSTALL_DIR="/opt"
APP_DIR="${INSTALL_DIR}/${APP_NAME}"
ENV_FILE="${APP_DIR}/.env"
COMPOSE_FILE="${APP_DIR}/deploy/docker-compose.yml"
CREDENTIALS_FILE="${APP_DIR}/.credentials"
INSTALL_CONF="${APP_DIR}/.install.conf"
INSTALL_MODE_FILE="${APP_DIR}/.install.mode"
BIN_PATH="/usr/local/bin/${APP_NAME}"
NGINX_SITE="/etc/nginx/sites-available/${APP_NAME}"
NGINX_LINK="/etc/nginx/sites-enabled/${APP_NAME}"
LANDING_DIR="/var/www/${APP_NAME}"
REPO_URL="${OVERVPN_REPO_URL:-https://github.com/Overl1te/OverVPN.git}"
REPO_RAW_BASE="${OVERVPN_RAW_BASE:-https://raw.githubusercontent.com/Overl1te/OverVPN}"
DEFAULT_BRANCH="${OVERVPN_BRANCH:-master}"
DEFAULT_WEB_PORT="8000"
DEFAULT_IMAGE_TAG="${OVERVPN_IMAGE_TAG:-latest}"
GHCR_API_IMAGE="ghcr.io/overl1te/overvpn-api"
GHCR_WEB_IMAGE="ghcr.io/overl1te/overvpn-web"

colorized_echo() {
  local color=$1
  shift
  local text="$*"
  case "$color" in
    red) printf '\e[91m%s\e[0m\n' "$text" ;;
    green) printf '\e[92m%s\e[0m\n' "$text" ;;
    yellow) printf '\e[93m%s\e[0m\n' "$text" ;;
    blue) printf '\e[94m%s\e[0m\n' "$text" ;;
    cyan) printf '\e[96m%s\e[0m\n' "$text" ;;
    *) printf '%s\n' "$text" ;;
  esac
}

check_root() {
  if [[ "$(id -u)" -ne 0 ]]; then
    colorized_echo red "This command must be run as root (use sudo)."
    exit 1
  fi
}

detect_os() {
  if [[ -f /etc/os-release ]]; then
    # shellcheck disable=SC1091
    . /etc/os-release
    OS_ID="${ID:-unknown}"
    OS_LIKE="${ID_LIKE:-}"
  else
    colorized_echo red "Unsupported OS: /etc/os-release not found."
    exit 1
  fi

  case "$OS_ID" in
    ubuntu|debian) ;;
    *)
      if [[ "$OS_LIKE" != *debian* && "$OS_LIKE" != *ubuntu* ]]; then
        colorized_echo yellow "Warning: tested on Ubuntu/Debian. Detected: ${PRETTY_NAME:-$OS_ID}."
      fi
      ;;
  esac
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1
}

install_packages() {
  detect_os
  colorized_echo blue "Installing required packages..."
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get install -y ca-certificates curl git openssl ufw dnsutils
}

ensure_docker() {
  if need_cmd docker && docker compose version >/dev/null 2>&1; then
    colorized_echo green "Docker and Compose already installed."
    systemctl enable --now docker >/dev/null 2>&1 || true
    return
  fi

  colorized_echo blue "Installing Docker Engine + Compose..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
  if ! docker compose version >/dev/null 2>&1; then
    colorized_echo red "docker compose plugin is missing after Docker install."
    exit 1
  fi
  colorized_echo green "Docker installed."
}

compose() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

compose_up() {
  local do_build=${1:-false}
  if [[ "$do_build" == "true" ]]; then
    colorized_echo blue "Building images locally (this can take several minutes)..."
    compose up -d --build
  else
    colorized_echo blue "Pulling images from GHCR..."
    compose pull
    colorized_echo blue "Starting containers..."
    compose up -d --pull missing
  fi
  # Oneshot init does not re-run on plain `up`; force it so management APIs are present.
  colorized_echo blue "Refreshing VPN core bootstrap config..."
  compose up -d --force-recreate --no-deps core-config-init
  compose up -d --force-recreate --no-deps core
}

is_installed() {
  [[ -d "$APP_DIR" && -f "$ENV_FILE" && -f "$COMPOSE_FILE" ]]
}

rand_hex() {
  openssl rand -hex "${1:-32}"
}

rand_password() {
  openssl rand -base64 36 | tr -d '\n' | tr '+/' 'Aa'
}

public_ip() {
  local ip=""
  ip="$(curl -4 -fsS --max-time 5 https://api.ipify.org 2>/dev/null || true)"
  if [[ -z "$ip" ]]; then
    ip="$(curl -4 -fsS --max-time 5 https://ifconfig.me 2>/dev/null || true)"
  fi
  if [[ -z "$ip" ]]; then
    ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  fi
  printf '%s' "${ip:-127.0.0.1}"
}

set_env_var() {
  local key=$1
  local value=$2
  local file=${3:-$ENV_FILE}
  local escaped
  escaped="$(printf '%s' "$value" | sed -e 's/[\/&]/\\&/g')"
  if grep -qE "^${key}=" "$file"; then
    sed -i -E "s|^${key}=.*|${key}=${escaped}|" "$file"
  else
    printf '%s=%s\n' "$key" "$value" >>"$file"
  fi
}

get_env_var() {
  local key=$1
  local file=${2:-$ENV_FILE}
  grep -E "^${key}=" "$file" | head -n1 | cut -d= -f2-
}

install_cli() {
  local source_script=$1
  colorized_echo blue "Installing CLI to ${BIN_PATH}..."
  if [[ -f "$source_script" ]]; then
    install -m 755 "$source_script" "$BIN_PATH"
  else
    curl -fsSL "${REPO_RAW_BASE}/${DEFAULT_BRANCH}/install.sh" -o "$BIN_PATH"
    chmod 755 "$BIN_PATH"
  fi
  colorized_echo green "CLI installed. Use: ${APP_NAME} <command>"
}

validate_hostname() {
  local host=$1
  if [[ ! "$host" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ ]]; then
    colorized_echo red "Invalid hostname: ${host}"
    exit 1
  fi
}

# Parse "host", "host/path", "https://host/path" → PARSE_HOST, PARSE_PATH ("/sub" or "")
parse_endpoint() {
  local raw=$1
  local allow_path=${2:-true}
  raw="$(printf '%s' "$raw" | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]')"
  raw="${raw#http://}"
  raw="${raw#https://}"
  raw="${raw%%\?*}"
  raw="${raw%%\#*}"
  raw="${raw%/}"

  local host path=""
  if [[ "$raw" == */* ]]; then
    host="${raw%%/*}"
    path="/${raw#*/}"
    path="$(printf '%s' "$path" | sed -E 's#/+#/#g; s#/$##')"
  else
    host="$raw"
  fi

  if [[ -z "$host" ]]; then
    colorized_echo red "Empty host in endpoint: $1"
    exit 1
  fi
  validate_hostname "$host"

  if [[ -n "$path" && "$allow_path" != "true" ]]; then
    colorized_echo red "Paths are not supported for this endpoint (use a subdomain): $1"
    colorized_echo yellow "Example: panel.${CFG_BASE_DOMAIN:-example.com}"
    exit 1
  fi

  if [[ -n "$path" && ! "$path" =~ ^(/[a-z0-9._~-]+)+$ ]]; then
    colorized_echo red "Invalid path in endpoint: $1"
    exit 1
  fi

  PARSE_HOST="$host"
  PARSE_PATH="$path"
}

prompt_install_endpoints() {
  local ip
  ip="$(public_ip)"
  CFG_BASE_DOMAIN=""
  CFG_PANEL_HOST=""
  CFG_SUB_HOST=""
  CFG_SUB_PATH=""
  CFG_VPN_HOST=""
  CFG_EMAIL=""
  CFG_MODE="ip"
  CFG_SKIP_DNS="false"

  echo
  colorized_echo cyan "════════════════════════════════════════"
  colorized_echo cyan " OverVPN — setup wizard"
  colorized_echo cyan "════════════════════════════════════════"
  colorized_echo cyan "Server IP: ${ip}"
  colorized_echo yellow "Answer everything now — after that install runs unattended."
  echo
  colorized_echo yellow "Leave base domain empty to use http://${ip}:${DEFAULT_WEB_PORT} (no TLS)."
  echo

  if [[ ! -t 0 ]]; then
    colorized_echo yellow "Non-interactive mode: installing without domain."
    return
  fi

  local base panel sub vpn email dns_ready
  read -r -p "1) Base domain (e.g. example.com): " base
  base="$(printf '%s' "$base" | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]')"
  if [[ -z "$base" ]]; then
    echo
    colorized_echo green "Mode: IP-only (no TLS). Starting install…"
    echo
    return
  fi
  validate_hostname "$base"
  CFG_BASE_DOMAIN="$base"
  CFG_MODE="domain"

  read -r -p "2) Panel host [panel.${base}]: " panel
  panel="$(printf '%s' "${panel:-panel.${base}}" | tr -d '[:space:]')"
  parse_endpoint "$panel" false
  CFG_PANEL_HOST="$PARSE_HOST"

  read -r -p "3) Subscription host or host/path [sub.${base}]: " sub
  sub="$(printf '%s' "${sub:-sub.${base}}" | tr -d '[:space:]')"
  parse_endpoint "$sub" true
  CFG_SUB_HOST="$PARSE_HOST"
  CFG_SUB_PATH="$PARSE_PATH"

  read -r -p "4) VPN public host [vpn.${base}]: " vpn
  vpn="$(printf '%s' "${vpn:-vpn.${base}}" | tr -d '[:space:]')"
  parse_endpoint "$vpn" false
  CFG_VPN_HOST="$PARSE_HOST"

  read -r -p "5) Let's Encrypt email [admin@${base}]: " email
  CFG_EMAIL="$(printf '%s' "${email:-admin@${base}}" | tr -d '[:space:]')"

  local -a dns_hosts=()
  mapfile -t dns_hosts < <(unique_hosts "$CFG_BASE_DOMAIN" "$CFG_PANEL_HOST" "$CFG_SUB_HOST" "$CFG_VPN_HOST")

  echo
  colorized_echo green "Summary:"
  colorized_echo cyan "  Site:         https://${CFG_BASE_DOMAIN}"
  colorized_echo cyan "  Panel:        https://${CFG_PANEL_HOST}"
  if [[ -n "$CFG_SUB_PATH" ]]; then
    colorized_echo cyan "  Subscription: https://${CFG_SUB_HOST}${CFG_SUB_PATH}/{TOKEN}"
  else
    colorized_echo cyan "  Subscription: https://${CFG_SUB_HOST}/api/sub/{TOKEN}"
  fi
  colorized_echo cyan "  VPN host:     ${CFG_VPN_HOST}"
  colorized_echo cyan "  Email:        ${CFG_EMAIL}"
  echo

  show_dns_instructions "$ip" "${dns_hosts[@]}"

  read -r -p "6) DNS A-records already created? [Y=wait for them / s=skip check]: " dns_ready
  dns_ready="$(printf '%s' "${dns_ready:-y}" | tr '[:upper:]' '[:lower:]')"
  if [[ "$dns_ready" == "s" || "$dns_ready" == "skip" ]]; then
    CFG_SKIP_DNS="true"
    colorized_echo yellow "DNS check will be skipped (certbot may fail)."
  else
    CFG_SKIP_DNS="false"
    colorized_echo green "OK — installer will wait for DNS, then continue without more questions."
  fi

  echo
  read -r -p "7) Start installation now? [Y/n]: " start_now
  start_now="$(printf '%s' "${start_now:-y}" | tr '[:upper:]' '[:lower:]')"
  if [[ "$start_now" != "y" && "$start_now" != "yes" ]]; then
    colorized_echo red "Aborted."
    exit 1
  fi

  echo
  colorized_echo green "No more prompts. You can go drink tea ☕"
  echo
}

unique_hosts() {
  local -A seen=()
  local host
  for host in "$@"; do
    [[ -z "$host" ]] && continue
    if [[ -z "${seen[$host]+x}" ]]; then
      seen[$host]=1
      printf '%s\n' "$host"
    fi
  done
}

show_dns_instructions() {
  local ip=$1
  shift
  local hosts=("$@")

  echo
  colorized_echo yellow "════════════════════════════════════════"
  colorized_echo yellow " Create these DNS A records"
  colorized_echo yellow "════════════════════════════════════════"
  colorized_echo yellow "At your DNS provider → A records → ${ip}"
  echo
  local host
  for host in "${hosts[@]}"; do
    printf '  %-40s A    %s\n' "$host" "$ip"
  done
  echo
  colorized_echo yellow "Cloudflare: grey cloud (DNS only) until certs are issued."
  colorized_echo cyan "Also open UDP/443 (and 80/443 TCP) on the firewall."
  echo
}

resolve_host_ips() {
  local host=$1
  if need_cmd dig; then
    dig +short A "$host" 2>/dev/null | grep -E '^[0-9.]+$' || true
  elif need_cmd getent; then
    getent ahostsv4 "$host" 2>/dev/null | awk '{print $1}' | sort -u || true
  else
    python3 - <<PY 2>/dev/null || true
import socket
try:
  print("\n".join(sorted({i[4][0] for i in socket.getaddrinfo("$host", None, socket.AF_INET)})))
except Exception:
  pass
PY
  fi
}

# Auto-poll DNS until all hosts point at $ip (no interactive prompts).
wait_for_dns() {
  local ip=$1
  shift
  local hosts=("$@")
  local host resolved
  local tries="${DNS_WAIT_TRIES:-60}"
  local sleep_s="${DNS_WAIT_SLEEP:-15}"
  local i

  if [[ "${CFG_SKIP_DNS:-false}" == "true" ]]; then
    colorized_echo yellow "Skipping DNS verification."
    return 0
  fi

  colorized_echo blue "Waiting for DNS (up to $((tries * sleep_s / 60)) min, every ${sleep_s}s)…"

  for ((i = 1; i <= tries; i++)); do
    local all_ok=true
    for host in "${hosts[@]}"; do
      resolved="$(resolve_host_ips "$host" | tr '\n' ' ')"
      if printf '%s' "$resolved" | grep -qw "$ip"; then
        colorized_echo green "  ✓ ${host} → ${ip}"
      else
        all_ok=false
        colorized_echo yellow "  … ${host} → [${resolved:-none}] (want ${ip}) [${i}/${tries}]"
      fi
    done

    if [[ "$all_ok" == true ]]; then
      colorized_echo green "DNS looks good."
      return 0
    fi
    sleep "$sleep_s"
  done

  colorized_echo red "DNS did not propagate in time."
  colorized_echo yellow "Fix A-records and re-run install, or use --skip-dns."
  exit 1
}

configure_firewall() {
  local with_nginx=$1
  local web_port=$2

  if ! need_cmd ufw; then
    return
  fi

  colorized_echo blue "Configuring UFW firewall..."
  ufw allow OpenSSH >/dev/null 2>&1 || true
  ufw allow 443/udp >/dev/null 2>&1 || true

  if [[ "$with_nginx" == "true" ]]; then
    ufw allow 80/tcp >/dev/null 2>&1 || true
    ufw allow 443/tcp >/dev/null 2>&1 || true
  else
    ufw allow "${web_port}/tcp" >/dev/null 2>&1 || true
    ufw allow 80/tcp >/dev/null 2>&1 || true
    ufw allow 443/tcp >/dev/null 2>&1 || true
  fi

  if ufw status | grep -qi inactive; then
    echo "y" | ufw enable >/dev/null 2>&1 || true
  fi
}

nginx_proxy_headers() {
  local proto=$1
  cat <<EOF
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto ${proto};
        proxy_set_header X-Request-ID \$request_id;
        proxy_connect_timeout 5s;
        proxy_read_timeout 60s;
EOF
}

install_landing_files() {
  mkdir -p "$LANDING_DIR"
  local src="${APP_DIR}/deploy/landing"
  if [[ -d "$src" ]]; then
    cp -f "$src/index.html" "$LANDING_DIR/index.html"
    cp -f "$src/sub.html" "$LANDING_DIR/sub.html"
    cp -f "$src/vpn.html" "$LANDING_DIR/vpn.html"
  else
    colorized_echo yellow "Landing templates missing at ${src}; writing minimal stubs."
    printf '%s\n' '<!doctype html><html><body><h1>OverVPN</h1></body></html>' >"$LANDING_DIR/index.html"
    printf '%s\n' '<!doctype html><html><body><p>Subscription host. Use /api/sub/TOKEN</p></body></html>' >"$LANDING_DIR/sub.html"
    printf '%s\n' '<!doctype html><html><body><p>OK</p></body></html>' >"$LANDING_DIR/vpn.html"
  fi
  chmod -R a+rX "$LANDING_DIR"
}

# Write nginx site. Args: base_domain panel_host sub_host sub_path vpn_host mode(http|https)
write_nginx_site() {
  local base_domain=$1
  local panel_host=$2
  local sub_host=$3
  local sub_path=$4
  local vpn_host=$5
  local mode=$6
  local -a hosts=()
  mapfile -t hosts < <(unique_hosts "$base_domain" "$panel_host" "$sub_host" "$vpn_host")

  local conf=""
  local host

  if [[ "$mode" == "https" ]]; then
    conf+="server {
    listen 80;
    listen [::]:80;
    server_name ${hosts[*]};
    access_log off;
    return 301 https://\$host\$request_uri;
}
"
  fi

  for host in "${hosts[@]}"; do
    if [[ "$mode" == "https" ]]; then
      conf+="
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name ${host};

    ssl_certificate /etc/letsencrypt/live/${panel_host}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${panel_host}/privkey.pem;
"
      if [[ -f /etc/letsencrypt/options-ssl-nginx.conf ]]; then
        conf+="    include /etc/letsencrypt/options-ssl-nginx.conf;
"
      else
        conf+="    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;
"
      fi
      if [[ -f /etc/letsencrypt/ssl-dhparams.pem ]]; then
        conf+="    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
"
      fi
      conf+="
    add_header Strict-Transport-Security \"max-age=31536000; includeSubDomains\" always;
    add_header X-Content-Type-Options \"nosniff\" always;
    add_header Referrer-Policy \"strict-origin-when-cross-origin\" always;
"
      local proto="https"
    else
      conf+="
server {
    listen 80;
    listen [::]:80;
    server_name ${host};
"
      local proto="\$scheme"
    fi

    # Subscription custom path rewrite on subscription host
    if [[ "$host" == "$sub_host" && -n "$sub_path" ]]; then
      conf+="
    location ^~ ${sub_path}/ {
        access_log off;
        rewrite ^${sub_path}/(.*)\$ /api/sub/\$1 break;
        proxy_pass http://127.0.0.1:8080;
$(nginx_proxy_headers "$proto")
    }
"
    fi

    # Native API subscription path on panel + subscription hosts
    if [[ "$host" == "$panel_host" || "$host" == "$sub_host" ]]; then
      conf+="
    location ^~ /api/sub/ {
        access_log off;
        proxy_pass http://127.0.0.1:8080;
$(nginx_proxy_headers "$proto")
    }
"
    fi

    if [[ -n "$base_domain" && "$host" == "$base_domain" ]]; then
      conf+="
    root ${LANDING_DIR};
    location = / {
        try_files /index.html =404;
    }
    location / {
        return 404;
    }
"
    elif [[ "$host" == "$panel_host" ]]; then
      conf+="
    location / {
        proxy_pass http://127.0.0.1:8080;
$(nginx_proxy_headers "$proto")
    }
"
    elif [[ "$host" == "$sub_host" ]]; then
      conf+="
    location = / {
        root ${LANDING_DIR};
        try_files /sub.html =404;
    }
    location / {
        return 404;
    }
"
    else
      # VPN public host: lightweight decoy page (not the admin panel)
      conf+="
    location = / {
        root ${LANDING_DIR};
        try_files /vpn.html =404;
    }
    location / {
        return 404;
    }
"
    fi

    conf+="}
"
  done

  printf '%s\n' "$conf" >"$NGINX_SITE"
}

install_nginx() {
  local base_domain=$1
  local panel_host=$2
  local sub_host=$3
  local sub_path=$4
  local vpn_host=$5
  local email=$6

  colorized_echo blue "Installing Nginx + Certbot..."
  export DEBIAN_FRONTEND=noninteractive
  apt-get install -y nginx certbot python3-certbot-nginx

  install_landing_files
  rm -f /etc/nginx/sites-enabled/default
  write_nginx_site "$base_domain" "$panel_host" "$sub_host" "$sub_path" "$vpn_host" "http"
  ln -sfn "$NGINX_SITE" "$NGINX_LINK"
  nginx -t
  systemctl enable --now nginx
  systemctl reload nginx

  local -a hosts=()
  local -a cert_args=()
  mapfile -t hosts < <(unique_hosts "$base_domain" "$panel_host" "$sub_host" "$vpn_host")
  local host
  for host in "${hosts[@]}"; do
    cert_args+=(-d "$host")
  done

  colorized_echo blue "Requesting Let's Encrypt certificate for: ${hosts[*]}"
  certbot --nginx \
    "${cert_args[@]}" \
    --non-interactive \
    --agree-tos \
    --email "$email" \
    --redirect \
    --no-eff-email \
    --cert-name "$panel_host" \
    --expand || {
      colorized_echo red "Certificate issuance failed during install."
      colorized_echo yellow "Check DNS (grey cloud on Cloudflare) and that all hosts resolve to this server."
      exit 1
    }

  write_nginx_site "$base_domain" "$panel_host" "$sub_host" "$sub_path" "$vpn_host" "https"
  nginx -t
  systemctl reload nginx
  colorized_echo green "Nginx + TLS ready for: ${hosts[*]}"
}

# Re-apply nginx + expand LE certs from .install.conf (safe for existing installs).
refresh_nginx() {
  if [[ ! -f "$INSTALL_CONF" ]]; then
    colorized_echo yellow "No ${INSTALL_CONF}; skip nginx refresh."
    return 0
  fi
  local mode panel_host sub_host sub_path vpn_host base_domain email
  mode="$(get_env_var MODE "$INSTALL_CONF" 2>/dev/null || true)"
  if [[ "$mode" != "domain" ]]; then
    return 0
  fi
  base_domain="$(get_env_var BASE_DOMAIN "$INSTALL_CONF" 2>/dev/null || true)"
  panel_host="$(get_env_var PANEL_HOST "$INSTALL_CONF" 2>/dev/null || true)"
  sub_host="$(get_env_var SUB_HOST "$INSTALL_CONF" 2>/dev/null || true)"
  sub_path="$(get_env_var SUB_PATH "$INSTALL_CONF" 2>/dev/null || true)"
  vpn_host="$(get_env_var VPN_HOST "$INSTALL_CONF" 2>/dev/null || true)"
  email="$(get_env_var EMAIL "$INSTALL_CONF" 2>/dev/null || true)"
  if [[ -z "$panel_host" || -z "$sub_host" || -z "$vpn_host" ]]; then
    colorized_echo yellow "Incomplete install.conf hosts; skip nginx refresh."
    return 0
  fi
  if [[ -z "$email" ]]; then
    email="admin@${base_domain:-${panel_host}}"
  fi

  colorized_echo blue "Refreshing Nginx site + certificates..."
  install_landing_files

  local -a hosts=()
  local -a cert_args=()
  mapfile -t hosts < <(unique_hosts "$base_domain" "$panel_host" "$sub_host" "$vpn_host")
  local host
  for host in "${hosts[@]}"; do
    cert_args+=(-d "$host")
  done

  # Expand existing cert to include apex/base when missing.
  issue_certificates_strict "$email" "$panel_host" "${cert_args[@]}"

  write_nginx_site "$base_domain" "$panel_host" "$sub_host" "$sub_path" "$vpn_host" "https"
  ln -sfn "$NGINX_SITE" "$NGINX_LINK"
  nginx -t
  systemctl reload nginx
  colorized_echo green "Nginx refreshed for: ${hosts[*]}"
}

remove_nginx_site() {
  rm -f "$NGINX_LINK" "$NGINX_SITE"
  rm -rf "$LANDING_DIR"
  if need_cmd nginx; then
    nginx -t >/dev/null 2>&1 && systemctl reload nginx || true
  fi
}

fetch_repo() {
  local branch=$1
  colorized_echo blue "Fetching OverVPN (${branch}) into ${APP_DIR}..."
  mkdir -p "$(dirname "$APP_DIR")"

  if [[ -d "$APP_DIR/.git" ]]; then
    git -C "$APP_DIR" fetch --depth 1 origin "$branch"
    git -C "$APP_DIR" checkout -B "$branch" "origin/${branch}"
    git -C "$APP_DIR" reset --hard "origin/${branch}"
  else
    rm -rf "$APP_DIR"
    git clone --depth 1 --branch "$branch" "$REPO_URL" "$APP_DIR"
  fi
}

fetch_raw_file() {
  local branch=$1
  local rel=$2
  local dest=$3
  mkdir -p "$(dirname "$dest")"
  curl -fsSL "${REPO_RAW_BASE}/${branch}/${rel}" -o "$dest"
}

fetch_deploy_bundle() {
  local branch=$1
  colorized_echo blue "Downloading deploy bundle (${branch}) into ${APP_DIR}..."
  mkdir -p "$APP_DIR/deploy/landing" "$APP_DIR/deploy/sing-box/certs" "$APP_DIR/deploy/proxy"

  local -a files=(
    ".env.example"
    "deploy/docker-compose.yml"
    "deploy/landing/index.html"
    "deploy/landing/sub.html"
    "deploy/landing/vpn.html"
    "deploy/sing-box/bootstrap-config.sh"
    "deploy/sing-box/config.json"
    "deploy/sing-box/entrypoint.sh"
    "deploy/sing-box/certs/.gitkeep"
    "deploy/proxy/nginx.reverse-proxy.conf.example"
  )

  local rel
  for rel in "${files[@]}"; do
    fetch_raw_file "$branch" "$rel" "${APP_DIR}/${rel}"
  done

  fetch_raw_file "$branch" "install.sh" "${APP_DIR}/install.sh"
  chmod 755 "${APP_DIR}/install.sh"
  printf 'slim\n' >"$INSTALL_MODE_FILE"
}

deploy_source() {
  local branch=$1
  local do_build=$2

  if [[ "$do_build" == "true" ]]; then
    fetch_repo "$branch"
    printf 'git\n' >"$INSTALL_MODE_FILE"
  elif [[ -d "$APP_DIR/.git" ]]; then
    fetch_repo "$branch"
    printf 'git\n' >"$INSTALL_MODE_FILE"
  else
    fetch_deploy_bundle "$branch"
  fi
  apply_deploy_permissions
}

apply_deploy_permissions() {
  if [[ ! -d "$APP_DIR" ]]; then
    return 0
  fi
  chmod -R a+rX "$APP_DIR"
  [[ -f "$ENV_FILE" ]] && chmod a+r "$ENV_FILE"
  [[ -f "$CREDENTIALS_FILE" ]] && chmod a+r "$CREDENTIALS_FILE"
  [[ -f "$INSTALL_CONF" ]] && chmod a+r "$INSTALL_CONF"
  [[ -f "${APP_DIR}/install.sh" ]] && chmod a+rX "${APP_DIR}/install.sh"
}

set_install_conf_var() {
  local key=$1
  local value=$2
  local escaped
  escaped="$(printf '%s' "$value" | sed -e 's/[\/&]/\\&/g')"
  if grep -qE "^${key}=" "$INSTALL_CONF"; then
    sed -i -E "s|^${key}=.*|${key}=${escaped}|" "$INSTALL_CONF"
  else
    printf '%s=%s\n' "$key" "$value" >>"$INSTALL_CONF"
  fi
}

sync_domains_from_install_conf() {
  if [[ ! -f "$INSTALL_CONF" ]]; then
    colorized_echo red "Missing ${INSTALL_CONF}"
    exit 1
  fi

  local mode base_domain panel_host sub_host sub_path vpn_host
  mode="$(get_env_var MODE "$INSTALL_CONF")"
  base_domain="$(get_env_var BASE_DOMAIN "$INSTALL_CONF")"
  panel_host="$(get_env_var PANEL_HOST "$INSTALL_CONF")"
  sub_host="$(get_env_var SUB_HOST "$INSTALL_CONF")"
  sub_path="$(get_env_var SUB_PATH "$INSTALL_CONF")"
  vpn_host="$(get_env_var VPN_HOST "$INSTALL_CONF")"

  local panel_url sub_url ip web_port
  ip="$(public_ip)"
  web_port="$(get_env_var WEB_PORT "$ENV_FILE" 2>/dev/null || echo "$DEFAULT_WEB_PORT")"

  if [[ "$mode" == "domain" ]]; then
    panel_url="https://${panel_host}"
    if [[ -n "$sub_path" ]]; then
      sub_url="https://${sub_host}${sub_path}"
    else
      sub_url="https://${sub_host}"
    fi
    set_env_var "CORS_ORIGINS" "$panel_url"
    set_env_var "SUB_PUBLIC_BASE_URL" "$sub_url"
    set_env_var "VPN_PUBLIC_HOST" "$vpn_host"
    set_env_var "AUTH_COOKIE_SECURE" "true"
    set_env_var "WEB_BIND_ADDRESS" "127.0.0.1"
    set_env_var "WEB_PORT" "8080"
    set_env_var "SING_BOX_ACME_HTTP_PORT" "8081"
    set_env_var "SING_BOX_ACME_TLS_PORT" "8443"
  else
    panel_url="http://${ip}:${web_port}"
    sub_url="$panel_url"
    set_env_var "CORS_ORIGINS" "$panel_url"
    set_env_var "SUB_PUBLIC_BASE_URL" "$sub_url"
    set_env_var "VPN_PUBLIC_HOST" "$ip"
    set_env_var "AUTH_COOKIE_SECURE" "false"
  fi

  if [[ -f "$CREDENTIALS_FILE" ]]; then
    set_env_var "PANEL_URL" "$panel_url" "$CREDENTIALS_FILE"
    set_env_var "SUB_PUBLIC_BASE_URL" "$sub_url" "$CREDENTIALS_FILE"
    set_env_var "VPN_PUBLIC_HOST" "${vpn_host:-$ip}" "$CREDENTIALS_FILE"
    set_env_var "BASE_DOMAIN" "${base_domain}" "$CREDENTIALS_FILE"
  fi

  apply_deploy_permissions
}

issue_certificates_strict() {
  local email=$1
  local panel_host=$2
  shift 2
  local -a cert_args=("$@")

  if ! need_cmd certbot; then
    colorized_echo red "certbot is not installed."
    exit 1
  fi

  colorized_echo blue "Requesting/expanding Let's Encrypt certificate..."
  if ! certbot certonly --nginx \
    "${cert_args[@]}" \
    --non-interactive \
    --agree-tos \
    --email "$email" \
    --no-eff-email \
    --cert-name "$panel_host" \
    --expand \
    --keep-until-expiring; then
    colorized_echo red "Certificate issuance failed."
    colorized_echo yellow "Check DNS (grey cloud on Cloudflare), port 80, and host resolution."
    exit 1
  fi
}

read_install_hosts() {
  INSTALL_MODE="$(get_env_var MODE "$INSTALL_CONF" 2>/dev/null || true)"
  INSTALL_BASE_DOMAIN="$(get_env_var BASE_DOMAIN "$INSTALL_CONF" 2>/dev/null || true)"
  INSTALL_PANEL_HOST="$(get_env_var PANEL_HOST "$INSTALL_CONF" 2>/dev/null || true)"
  INSTALL_SUB_HOST="$(get_env_var SUB_HOST "$INSTALL_CONF" 2>/dev/null || true)"
  INSTALL_SUB_PATH="$(get_env_var SUB_PATH "$INSTALL_CONF" 2>/dev/null || true)"
  INSTALL_VPN_HOST="$(get_env_var VPN_HOST "$INSTALL_CONF" 2>/dev/null || true)"
  INSTALL_EMAIL="$(get_env_var EMAIL "$INSTALL_CONF" 2>/dev/null || true)"
}

generate_env() {
  local web_port=$1
  local with_nginx=$2
  local image_tag=$3
  local ip
  ip="$(public_ip)"

  colorized_echo blue "Generating .env secrets..."
  cp "$APP_DIR/.env.example" "$ENV_FILE"

  local pg_pass redis_pass jwt_secret master_key clash_secret admin_pass admin_user
  pg_pass="$(rand_hex 32)"
  redis_pass="$(rand_hex 32)"
  jwt_secret="$(rand_hex 32)"
  master_key="$(rand_hex 32)"
  clash_secret="$(rand_hex 32)"
  admin_pass="$(rand_password)"
  admin_user="owner"

  set_env_var "POSTGRES_PASSWORD" "$pg_pass"
  set_env_var "DATABASE_URL" "postgresql://overvpn:${pg_pass}@postgres:5432/overvpn?schema=public"
  set_env_var "REDIS_PASSWORD" "$redis_pass"
  set_env_var "REDIS_URL" "redis://:${redis_pass}@redis:6379/0"
  set_env_var "JWT_ACCESS_SECRET" "$jwt_secret"
  set_env_var "SECRETS_MASTER_KEY" "$master_key"
  set_env_var "SING_BOX_CLASH_API_SECRET" "$clash_secret"
  set_env_var "BOOTSTRAP_ADMIN_USER" "$admin_user"
  set_env_var "BOOTSTRAP_ADMIN_PASSWORD" "$admin_pass"
  set_env_var "SWAGGER_ENABLED" "false"
  set_env_var "SING_BOX_UDP_PORT" "443"
  set_env_var "API_IMAGE" "${GHCR_API_IMAGE}:${image_tag}"
  set_env_var "WEB_IMAGE" "${GHCR_WEB_IMAGE}:${image_tag}"

  local panel_url sub_url
  if [[ "${CFG_MODE}" == "domain" ]]; then
    panel_url="https://${CFG_PANEL_HOST}"
    if [[ -n "${CFG_SUB_PATH}" ]]; then
      sub_url="https://${CFG_SUB_HOST}${CFG_SUB_PATH}"
    else
      sub_url="https://${CFG_SUB_HOST}"
    fi
    set_env_var "CORS_ORIGINS" "$panel_url"
    set_env_var "SUB_PUBLIC_BASE_URL" "$sub_url"
    set_env_var "VPN_PUBLIC_HOST" "${CFG_VPN_HOST}"
    set_env_var "AUTH_COOKIE_SECURE" "true"
    set_env_var "WEB_BIND_ADDRESS" "127.0.0.1"
    set_env_var "WEB_PORT" "8080"
    if [[ "$with_nginx" == "true" ]]; then
      set_env_var "SING_BOX_ACME_HTTP_PORT" "8081"
      set_env_var "SING_BOX_ACME_TLS_PORT" "8443"
    fi
  else
    panel_url="http://${ip}:${web_port}"
    sub_url="$panel_url"
    set_env_var "CORS_ORIGINS" "$panel_url"
    set_env_var "SUB_PUBLIC_BASE_URL" "$sub_url"
    set_env_var "VPN_PUBLIC_HOST" "$ip"
    set_env_var "AUTH_COOKIE_SECURE" "false"
    set_env_var "WEB_BIND_ADDRESS" "0.0.0.0"
    set_env_var "WEB_PORT" "$web_port"
  fi

  umask 077
  cat >"$CREDENTIALS_FILE" <<EOF
BOOTSTRAP_ADMIN_USER=${admin_user}
BOOTSTRAP_ADMIN_PASSWORD=${admin_pass}
PANEL_IP=${ip}
PANEL_URL=${panel_url}
SUB_PUBLIC_BASE_URL=${sub_url}
VPN_PUBLIC_HOST=$(get_env_var VPN_PUBLIC_HOST "$ENV_FILE")
BASE_DOMAIN=${CFG_BASE_DOMAIN:-}
WEB_PORT=${web_port}
CREATED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF

  cat >"$INSTALL_CONF" <<EOF
MODE=${CFG_MODE}
BASE_DOMAIN=${CFG_BASE_DOMAIN:-}
PANEL_HOST=${CFG_PANEL_HOST:-}
SUB_HOST=${CFG_SUB_HOST:-}
SUB_PATH=${CFG_SUB_PATH:-}
VPN_HOST=${CFG_VPN_HOST:-}
EMAIL=${CFG_EMAIL:-}
EOF
  apply_deploy_permissions
}

wait_for_health() {
  local url=$1
  local tries=${2:-60}
  local i
  colorized_echo blue "Waiting for API health..."
  for ((i = 1; i <= tries; i++)); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      colorized_echo green "API is ready."
      return 0
    fi
    sleep 2
  done
  colorized_echo yellow "Health check timed out. Check: ${APP_NAME} logs"
  return 1
}

print_success() {
  local web_port=$1
  local ip user pass panel_url sub_url vpn_host base_domain

  ip="$(get_env_var PANEL_IP "$CREDENTIALS_FILE" 2>/dev/null || public_ip)"
  user="$(get_env_var BOOTSTRAP_ADMIN_USER "$CREDENTIALS_FILE")"
  pass="$(get_env_var BOOTSTRAP_ADMIN_PASSWORD "$CREDENTIALS_FILE")"
  panel_url="$(get_env_var PANEL_URL "$CREDENTIALS_FILE")"
  sub_url="$(get_env_var SUB_PUBLIC_BASE_URL "$CREDENTIALS_FILE")"
  vpn_host="$(get_env_var VPN_PUBLIC_HOST "$CREDENTIALS_FILE")"
  base_domain="$(get_env_var BASE_DOMAIN "$CREDENTIALS_FILE" 2>/dev/null || true)"

  echo
  colorized_echo green "╔══════════════════════════════════════════════╗"
  colorized_echo green "║         OverVPN installed successfully       ║"
  colorized_echo green "╚══════════════════════════════════════════════╝"
  echo
  if [[ -n "$base_domain" ]]; then
    colorized_echo cyan  "Site:         https://${base_domain}"
  fi
  colorized_echo cyan  "Panel:        ${panel_url}"
  colorized_echo cyan  "Login:        ${user}"
  colorized_echo cyan  "Password:     ${pass}"
  colorized_echo cyan  "Subscriptions:${sub_url}/api/sub/{TOKEN}  (root / on sub host is only a stub)"
  if [[ -n "$vpn_host" ]]; then
    colorized_echo cyan  "VPN host:     ${vpn_host}  (default publicHost for new inbounds)"
  fi
  echo
  colorized_echo yellow "Credentials: ${CREDENTIALS_FILE}"
  colorized_echo yellow "Manage with: ${APP_NAME} status | logs | config | update | restart"
  echo
}

usage() {
  cat <<EOF
OverVPN management script

Usage:
  ${APP_NAME} install [options]
  ${APP_NAME} up | down | restart | status | logs [service] | update | uninstall
  ${APP_NAME} info | edit | bootstrap | nginx | config | install-script

Config (domains, nginx, certificates):
  ${APP_NAME} config show
  ${APP_NAME} config sync
  ${APP_NAME} config set-domain [--base-domain <host>] [--panel <host>] [--subscription <spec>] [--vpn-host <host>] [--email <email>]
  ${APP_NAME} config nginx
  ${APP_NAME} config certs
  ${APP_NAME} config apply

Install asks interactively:
  1) base domain (public landing page + TLS)
  2) panel host (subdomain; no path — SPA)
  3) subscription host or host/path
  4) VPN public host
  5) Let's Encrypt email
Then prints DNS A-records to create and waits before issuing certificates.

Options:
  --base-domain <host>     Skip base-domain prompt
  --panel <host>           Panel hostname
  --subscription <spec>    Host or host/path for public subscription URLs
  --vpn-host <host>        VPN public hostname
  --email <email>          Let's Encrypt email
  --port <port>            Panel port without domain (default: ${DEFAULT_WEB_PORT})
  --branch <name>          Git branch (default: ${DEFAULT_BRANCH})
  --tag <tag>              GHCR image tag (default: ${DEFAULT_IMAGE_TAG})
  --build                  Build images locally instead of pulling from GHCR
  --skip-dns               Do not wait for DNS before issuing certificates
  --no-nginx               Skip Nginx/TLS
  --no-ufw                 Do not touch UFW
  -h, --help               Show help

Wizard asks all questions first (domains + DNS), then runs unattended.

Default install downloads only deploy files (no full git clone).
Use --build to clone the repository and build images locally.

One-liner:
  sudo bash -c "\$(curl -fsSL ${REPO_RAW_BASE}/${DEFAULT_BRANCH}/install.sh)" @ install
EOF
}

cmd_install() {
  check_root
  detect_os

  local web_port="$DEFAULT_WEB_PORT" branch="$DEFAULT_BRANCH"
  local image_tag="$DEFAULT_IMAGE_TAG" do_build="false"
  local with_nginx="auto" use_ufw="true"
  local flag_base="" flag_panel="" flag_sub="" flag_vpn="" flag_email=""
  CFG_SKIP_DNS="false"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --base-domain) flag_base="${2:-}"; shift 2 ;;
      --panel) flag_panel="${2:-}"; shift 2 ;;
      --subscription) flag_sub="${2:-}"; shift 2 ;;
      --vpn-host) flag_vpn="${2:-}"; shift 2 ;;
      --email) flag_email="${2:-}"; shift 2 ;;
      --port) web_port="${2:-}"; shift 2 ;;
      --branch) branch="${2:-}"; shift 2 ;;
      --tag|--version) image_tag="${2:-}"; shift 2 ;;
      --build) do_build="true"; shift ;;
      --skip-dns) CFG_SKIP_DNS="true"; shift ;;
      --no-nginx) with_nginx="false"; shift ;;
      --no-ufw) use_ufw="false"; shift ;;
      -h|--help) usage; exit 0 ;;
      *) colorized_echo red "Unknown option: $1"; usage; exit 1 ;;
    esac
  done

  if is_installed; then
    colorized_echo yellow "OverVPN already installed in ${APP_DIR}."
    colorized_echo yellow "Use '${APP_NAME} update' or '${APP_NAME} uninstall' first."
    exit 1
  fi

  if [[ ! "$web_port" =~ ^[0-9]+$ ]] || [[ "$web_port" -lt 1 || "$web_port" -gt 65535 ]]; then
    colorized_echo red "Invalid --port: ${web_port}"
    exit 1
  fi

  CFG_BASE_DOMAIN=""
  CFG_PANEL_HOST=""
  CFG_SUB_HOST=""
  CFG_SUB_PATH=""
  CFG_VPN_HOST=""
  CFG_EMAIL=""
  CFG_MODE="ip"

  # Collect ALL answers first — then run unattended.
  if [[ -n "$flag_base" ]]; then
    validate_hostname "$flag_base"
    CFG_BASE_DOMAIN="$flag_base"
    CFG_MODE="domain"
    parse_endpoint "${flag_panel:-panel.${flag_base}}" false
    CFG_PANEL_HOST="$PARSE_HOST"
    parse_endpoint "${flag_sub:-sub.${flag_base}}" true
    CFG_SUB_HOST="$PARSE_HOST"
    CFG_SUB_PATH="$PARSE_PATH"
    parse_endpoint "${flag_vpn:-vpn.${flag_base}}" false
    CFG_VPN_HOST="$PARSE_HOST"
    CFG_EMAIL="${flag_email:-admin@${flag_base}}"
    colorized_echo green "Non-interactive flags received. Starting install…"
  else
    prompt_install_endpoints
    if [[ -n "$flag_email" ]]; then
      CFG_EMAIL="$flag_email"
    fi
  fi

  if [[ "$with_nginx" == "auto" ]]; then
    if [[ "$CFG_MODE" == "domain" ]]; then
      with_nginx="true"
    else
      with_nginx="false"
    fi
  fi

  install_packages
  ensure_docker

  local ip
  ip="$(public_ip)"
  local -a dns_hosts=()

  if [[ "$CFG_MODE" == "domain" && "$with_nginx" == "true" ]]; then
    mapfile -t dns_hosts < <(unique_hosts "$CFG_BASE_DOMAIN" "$CFG_PANEL_HOST" "$CFG_SUB_HOST" "$CFG_VPN_HOST")
    wait_for_dns "$ip" "${dns_hosts[@]}"
  fi

  deploy_source "$branch" "$do_build"
  generate_env "$web_port" "$with_nginx" "$image_tag"

  if [[ "$use_ufw" == "true" ]]; then
    configure_firewall "$with_nginx" "$web_port"
  fi

  compose_up "$do_build"

  local health_port
  health_port="$(get_env_var WEB_PORT)"
  wait_for_health "http://127.0.0.1:${health_port}/api/health" || true

  if [[ "$CFG_MODE" == "domain" && "$with_nginx" == "true" ]]; then
    install_nginx "$CFG_BASE_DOMAIN" "$CFG_PANEL_HOST" "$CFG_SUB_HOST" "$CFG_SUB_PATH" "$CFG_VPN_HOST" "$CFG_EMAIL"
  fi

  colorized_echo blue "Creating owner account..."
  compose --profile tools run --rm bootstrap-admin

  install_cli "${APP_DIR}/install.sh"
  apply_deploy_permissions
  print_success "$web_port"
}

cmd_up() {
  check_root
  is_installed || { colorized_echo red "OverVPN is not installed."; exit 1; }
  compose up -d
  colorized_echo green "OverVPN started."
}

cmd_down() {
  check_root
  is_installed || { colorized_echo red "OverVPN is not installed."; exit 1; }
  compose down
  colorized_echo green "OverVPN stopped."
}

cmd_restart() {
  check_root
  is_installed || { colorized_echo red "OverVPN is not installed."; exit 1; }
  compose restart
  colorized_echo green "OverVPN restarted."
}

cmd_status() {
  check_root
  is_installed || { colorized_echo red "OverVPN is not installed."; exit 1; }
  compose ps
}

cmd_logs() {
  check_root
  is_installed || { colorized_echo red "OverVPN is not installed."; exit 1; }
  if [[ $# -gt 0 ]]; then
    compose logs -f --tail=200 "$@"
  else
    compose logs -f --tail=200
  fi
}

cmd_update() {
  check_root
  is_installed || { colorized_echo red "OverVPN is not installed."; exit 1; }

  local do_build="false" image_tag=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --build) do_build="true"; shift ;;
      --tag|--version) image_tag="${2:-}"; shift 2 ;;
      *) colorized_echo red "Unknown option: $1"; exit 1 ;;
    esac
  done

  local branch="$DEFAULT_BRANCH"
  if [[ "$do_build" == "true" || -d "$APP_DIR/.git" ]]; then
    branch="$(git -C "$APP_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "$DEFAULT_BRANCH")"
  fi

  colorized_echo blue "Updating OverVPN (${branch})..."
  deploy_source "$branch" "$do_build"
  install_cli "${APP_DIR}/install.sh"
  sync_domains_from_install_conf

  if [[ -n "$image_tag" ]]; then
    set_env_var "API_IMAGE" "${GHCR_API_IMAGE}:${image_tag}"
    set_env_var "WEB_IMAGE" "${GHCR_WEB_IMAGE}:${image_tag}"
  fi

  compose_up "$do_build"
  refresh_nginx
  apply_deploy_permissions
  wait_for_health "http://127.0.0.1:$(get_env_var WEB_PORT)/api/health" || true
  colorized_echo green "Update complete."
}

cmd_uninstall() {
  check_root

  local wipe="y"
  local purge_certs="y"
  colorized_echo yellow "This removes OverVPN containers, /opt/overvpn, nginx site, and CLI."
  if [[ -t 0 ]]; then
    read -r -p "Delete Docker volumes (DB/data)? [Y/n] " wipe
    wipe="${wipe:-y}"
    read -r -p "Delete Let's Encrypt certs for panel/sub/vpn hosts? [Y/n] " purge_certs
    purge_certs="${purge_certs:-y}"
  fi

  if [[ -f "$COMPOSE_FILE" && -f "$ENV_FILE" ]]; then
    if [[ "${wipe,,}" == "y" || "${wipe,,}" == "yes" ]]; then
      compose down -v --remove-orphans || true
    else
      compose down --remove-orphans || true
    fi
  else
    # Best-effort if compose files are already gone
    docker ps -aq --filter "name=overvpn-" | xargs -r docker rm -f || true
    docker network ls -q --filter "name=overvpn" | xargs -r docker network rm || true
    if [[ "${wipe,,}" == "y" || "${wipe,,}" == "yes" ]]; then
      docker volume ls -q --filter "name=overvpn" | xargs -r docker volume rm || true
    fi
  fi

  # Drop local/GHCR app images used by this stack
  docker images --format '{{.Repository}}:{{.Tag}}' \
    | grep -E '^(ghcr\.io/overl1te/overvpn-|overvpn/)' \
    | xargs -r docker rmi -f || true

  local panel_host=""
  if [[ -f "$INSTALL_CONF" ]]; then
    panel_host="$(get_env_var PANEL_HOST "$INSTALL_CONF" || true)"
  fi

  remove_nginx_site

  if [[ "${purge_certs,,}" == "y" || "${purge_certs,,}" == "yes" ]]; then
    if [[ -n "$panel_host" ]] && need_cmd certbot; then
      certbot delete --cert-name "$panel_host" --non-interactive 2>/dev/null || true
    fi
    # leftover live dirs if certbot delete failed
    if [[ -n "$panel_host" && -d "/etc/letsencrypt/live/${panel_host}" ]]; then
      rm -rf "/etc/letsencrypt/live/${panel_host}" \
        "/etc/letsencrypt/archive/${panel_host}" \
        "/etc/letsencrypt/renewal/${panel_host}.conf" || true
    fi
  fi

  rm -rf "$APP_DIR"
  rm -f "$BIN_PATH"

  colorized_echo green "OverVPN fully removed."
  colorized_echo yellow "Nginx/Docker packages left installed (shared). Remove manually if needed:"
  colorized_echo yellow "  apt-get remove -y nginx certbot python3-certbot-nginx"
  colorized_echo yellow "Reinstall: curl … install.sh @ install"
}

cmd_info() {
  check_root
  is_installed || { colorized_echo red "OverVPN is not installed."; exit 1; }

  echo "Install dir:  ${APP_DIR}"
  if [[ -f "$CREDENTIALS_FILE" ]]; then
    echo "Panel URL:    $(get_env_var PANEL_URL "$CREDENTIALS_FILE")"
    echo "Sub base:     $(get_env_var SUB_PUBLIC_BASE_URL "$CREDENTIALS_FILE")"
    echo "VPN host:     $(get_env_var VPN_PUBLIC_HOST "$CREDENTIALS_FILE")"
    echo "Admin user:   $(get_env_var BOOTSTRAP_ADMIN_USER "$CREDENTIALS_FILE")"
    echo "Password:     $(get_env_var BOOTSTRAP_ADMIN_PASSWORD "$CREDENTIALS_FILE")"
  fi
  compose ps
}

cmd_edit() {
  check_root
  is_installed || { colorized_echo red "OverVPN is not installed."; exit 1; }
  "${EDITOR:-nano}" "$ENV_FILE"
  colorized_echo yellow "Restart to apply: ${APP_NAME} restart"
}

cmd_bootstrap() {
  check_root
  is_installed || { colorized_echo red "OverVPN is not installed."; exit 1; }
  compose --profile tools run --rm bootstrap-admin
  colorized_echo green "Bootstrap finished (password taken from .env)."
}

cmd_nginx() {
  check_root
  is_installed || { colorized_echo red "OverVPN is not installed."; exit 1; }
  refresh_nginx
}

cmd_config_show() {
  check_root
  is_installed || { colorized_echo red "OverVPN is not installed."; exit 1; }

  echo "Install dir: ${APP_DIR}"
  echo "Install mode: $(cat "$INSTALL_MODE_FILE" 2>/dev/null || echo unknown)"
  echo
  if [[ -f "$INSTALL_CONF" ]]; then
    echo "=== .install.conf (nginx/certs source of truth) ==="
    cat "$INSTALL_CONF"
    echo
  else
    colorized_echo yellow "Missing ${INSTALL_CONF}"
  fi
  echo "=== runtime .env ==="
  echo "CORS_ORIGINS=$(get_env_var CORS_ORIGINS)"
  echo "SUB_PUBLIC_BASE_URL=$(get_env_var SUB_PUBLIC_BASE_URL)"
  echo "VPN_PUBLIC_HOST=$(get_env_var VPN_PUBLIC_HOST)"
  echo "WEB_PORT=$(get_env_var WEB_PORT)"
  if [[ -f "$CREDENTIALS_FILE" ]]; then
    echo
    echo "=== .credentials ==="
    echo "PANEL_URL=$(get_env_var PANEL_URL "$CREDENTIALS_FILE")"
    echo "SUB_PUBLIC_BASE_URL=$(get_env_var SUB_PUBLIC_BASE_URL "$CREDENTIALS_FILE")"
    echo "VPN_PUBLIC_HOST=$(get_env_var VPN_PUBLIC_HOST "$CREDENTIALS_FILE")"
    echo "BASE_DOMAIN=$(get_env_var BASE_DOMAIN "$CREDENTIALS_FILE")"
  fi
}

cmd_config_sync() {
  check_root
  is_installed || { colorized_echo red "OverVPN is not installed."; exit 1; }
  sync_domains_from_install_conf
  colorized_echo green "Synced domains from .install.conf → .env and .credentials"
}

cmd_config_set_domain() {
  check_root
  is_installed || { colorized_echo red "OverVPN is not installed."; exit 1; }
  [[ -f "$INSTALL_CONF" ]] || { colorized_echo red "Missing ${INSTALL_CONF}"; exit 1; }

  local flag_base="" flag_panel="" flag_sub="" flag_vpn="" flag_email=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --base-domain) flag_base="${2:-}"; shift 2 ;;
      --panel) flag_panel="${2:-}"; shift 2 ;;
      --subscription) flag_sub="${2:-}"; shift 2 ;;
      --vpn-host) flag_vpn="${2:-}"; shift 2 ;;
      --email) flag_email="${2:-}"; shift 2 ;;
      *) colorized_echo red "Unknown option: $1"; exit 1 ;;
    esac
  done

  read_install_hosts
  local base="${flag_base:-$INSTALL_BASE_DOMAIN}"
  local panel="${flag_panel:-$INSTALL_PANEL_HOST}"
  local sub_spec="${flag_sub:-}"
  local vpn="${flag_vpn:-$INSTALL_VPN_HOST}"
  local email="${flag_email:-$INSTALL_EMAIL}"

  if [[ -z "$base" ]]; then
    colorized_echo red "Provide --base-domain or set BASE_DOMAIN in .install.conf"
    exit 1
  fi

  validate_hostname "$base"
  if [[ -z "$panel" ]]; then
    panel="panel.${base}"
  fi
  validate_hostname "$panel"

  if [[ -z "$sub_spec" ]]; then
    if [[ -n "$INSTALL_SUB_PATH" ]]; then
      sub_spec="${INSTALL_SUB_HOST}${INSTALL_SUB_PATH}"
    else
      sub_spec="sub.${base}"
    fi
  fi
  parse_endpoint "$sub_spec" true
  local sub_host="$PARSE_HOST"
  local sub_path="$PARSE_PATH"
  validate_hostname "$sub_host"

  if [[ -z "$vpn" ]]; then
    vpn="vpn.${base}"
  fi
  validate_hostname "$vpn"

  if [[ -z "$email" ]]; then
    email="admin@${base}"
  fi

  set_install_conf_var "MODE" "domain"
  set_install_conf_var "BASE_DOMAIN" "$base"
  set_install_conf_var "PANEL_HOST" "$panel"
  set_install_conf_var "SUB_HOST" "$sub_host"
  set_install_conf_var "SUB_PATH" "$sub_path"
  set_install_conf_var "VPN_HOST" "$vpn"
  set_install_conf_var "EMAIL" "$email"

  sync_domains_from_install_conf
  colorized_echo green "Domains updated. Run: ${APP_NAME} config apply"
}

cmd_config_nginx() {
  check_root
  is_installed || { colorized_echo red "OverVPN is not installed."; exit 1; }
  read_install_hosts
  if [[ "$INSTALL_MODE" != "domain" ]]; then
    colorized_echo yellow "Domain mode is not configured; nothing to refresh."
    return 0
  fi
  install_landing_files
  write_nginx_site "$INSTALL_BASE_DOMAIN" "$INSTALL_PANEL_HOST" "$INSTALL_SUB_HOST" "$INSTALL_SUB_PATH" "$INSTALL_VPN_HOST" "https"
  ln -sfn "$NGINX_SITE" "$NGINX_LINK"
  nginx -t
  systemctl reload nginx
  colorized_echo green "Nginx site refreshed (existing certificates)."
}

cmd_config_certs() {
  check_root
  is_installed || { colorized_echo red "OverVPN is not installed."; exit 1; }
  read_install_hosts
  if [[ "$INSTALL_MODE" != "domain" ]]; then
    colorized_echo yellow "Domain mode is not configured."
    return 0
  fi
  if [[ -z "$INSTALL_PANEL_HOST" || -z "$INSTALL_SUB_HOST" || -z "$INSTALL_VPN_HOST" ]]; then
    colorized_echo red "Incomplete host list in .install.conf"
    exit 1
  fi
  local email="${INSTALL_EMAIL:-admin@${INSTALL_BASE_DOMAIN:-$INSTALL_PANEL_HOST}}"
  local -a hosts=()
  local -a cert_args=()
  mapfile -t hosts < <(unique_hosts "$INSTALL_BASE_DOMAIN" "$INSTALL_PANEL_HOST" "$INSTALL_SUB_HOST" "$INSTALL_VPN_HOST")
  local host
  for host in "${hosts[@]}"; do
    cert_args+=(-d "$host")
  done
  issue_certificates_strict "$email" "$INSTALL_PANEL_HOST" "${cert_args[@]}"
  colorized_echo green "Certificates issued/expanded for: ${hosts[*]}"
}

cmd_config_apply() {
  check_root
  is_installed || { colorized_echo red "OverVPN is not installed."; exit 1; }
  sync_domains_from_install_conf
  refresh_nginx
  compose_up false
  wait_for_health "http://127.0.0.1:$(get_env_var WEB_PORT)/api/health" || true
  colorized_echo green "Configuration applied (sync + nginx + certs + containers)."
}

cmd_config() {
  local subcmd=${1:-show}
  if [[ -n "$subcmd" ]]; then
    shift
  fi
  case "$subcmd" in
    show) cmd_config_show ;;
    sync) cmd_config_sync ;;
    set-domain) cmd_config_set_domain "$@" ;;
    nginx) cmd_config_nginx ;;
    certs) cmd_config_certs ;;
    apply) cmd_config_apply ;;
    *)
      colorized_echo red "Unknown config command: ${subcmd}"
      echo "Use: ${APP_NAME} config show|sync|set-domain|nginx|certs|apply"
      exit 1
      ;;
  esac
}

cmd_install_script() {
  check_root
  install_cli "${BASH_SOURCE[0]}"
}

main() {
  if [[ "${1:-}" == "@" ]]; then
    shift
  fi

  local cmd=${1:-}
  if [[ -n "$cmd" ]]; then
    shift
  fi

  case "$cmd" in
    install) cmd_install "$@" ;;
    up|start) cmd_up ;;
    down|stop) cmd_down ;;
    restart) cmd_restart ;;
    status|ps) cmd_status ;;
    logs) cmd_logs "$@" ;;
    update) cmd_update "$@" ;;
    uninstall|remove) cmd_uninstall ;;
    info) cmd_info ;;
    edit|edit-env) cmd_edit ;;
    bootstrap|bootstrap-admin) cmd_bootstrap ;;
    nginx|refresh-nginx) cmd_nginx ;;
    config) cmd_config "$@" ;;
    install-script) cmd_install_script ;;
    ""|-h|--help|help) usage ;;
    *)
      colorized_echo red "Unknown command: ${cmd}"
      usage
      exit 1
      ;;
  esac
}

main "$@"
