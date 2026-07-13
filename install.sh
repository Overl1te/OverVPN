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
BIN_PATH="/usr/local/bin/${APP_NAME}"
NGINX_SITE="/etc/nginx/sites-available/${APP_NAME}"
NGINX_LINK="/etc/nginx/sites-enabled/${APP_NAME}"
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

  echo
  colorized_echo cyan "════════════════════════════════════════"
  colorized_echo cyan " OverVPN — domain setup"
  colorized_echo cyan "════════════════════════════════════════"
  colorized_echo cyan "Server IP: ${ip}"
  echo
  colorized_echo yellow "Leave base domain empty to use http://${ip}:${DEFAULT_WEB_PORT} (no TLS)."
  echo

  if [[ ! -t 0 ]]; then
    colorized_echo yellow "Non-interactive mode: installing without domain."
    return
  fi

  local base panel sub vpn email
  read -r -p "1) Base domain (e.g. example.com): " base
  base="$(printf '%s' "$base" | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]')"
  if [[ -z "$base" ]]; then
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

  echo
  colorized_echo green "Summary:"
  colorized_echo cyan "  Panel:        https://${CFG_PANEL_HOST}"
  if [[ -n "$CFG_SUB_PATH" ]]; then
    colorized_echo cyan "  Subscription: https://${CFG_SUB_HOST}${CFG_SUB_PATH}/{TOKEN}"
  else
    colorized_echo cyan "  Subscription: https://${CFG_SUB_HOST}/api/sub/{TOKEN}"
  fi
  colorized_echo cyan "  VPN host:     ${CFG_VPN_HOST}  (A-record for client endpoints)"
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
  colorized_echo yellow " DNS — create these records now"
  colorized_echo yellow "════════════════════════════════════════"
  colorized_echo yellow "At your DNS provider (Cloudflare, Namecheap, Reg.ru, …)"
  colorized_echo yellow "create A records pointing to: ${ip}"
  echo
  local host
  for host in "${hosts[@]}"; do
    printf '  %-40s A    %s\n' "$host" "$ip"
  done
  echo
  colorized_echo yellow "If you use Cloudflare: DNS only (grey cloud), not proxied,"
  colorized_echo yellow "until certificates are issued — or use Full (strict) later."
  echo
  colorized_echo cyan "Also open UDP/443 on the firewall/security group for VPN traffic."
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

wait_for_dns() {
  local ip=$1
  shift
  local hosts=("$@")
  local host resolved attempt

  show_dns_instructions "$ip" "${hosts[@]}"

  if [[ ! -t 0 ]]; then
    colorized_echo yellow "Non-interactive: skipping DNS wait."
    return
  fi

  while true; do
    read -r -p "Press Enter after DNS is configured (or type skip): " answer
    if [[ "${answer,,}" == "skip" ]]; then
      colorized_echo yellow "Skipping DNS verification (certificates may fail)."
      return
    fi

    local all_ok=true
    for host in "${hosts[@]}"; do
      resolved="$(resolve_host_ips "$host" | tr '\n' ' ')"
      if printf '%s' "$resolved" | grep -qw "$ip"; then
        colorized_echo green "  ✓ ${host} → ${ip}"
      else
        all_ok=false
        colorized_echo red "  ✗ ${host} resolves to [${resolved:-none}], expected ${ip}"
      fi
    done

    if [[ "$all_ok" == true ]]; then
      colorized_echo green "DNS looks good."
      return
    fi

    colorized_echo yellow "Propagation can take a few minutes. Fix records and try again."
  done
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

# Write nginx site for listed hosts. Args: panel_host sub_host sub_path vpn_host mode(http|https)
write_nginx_site() {
  local panel_host=$1
  local sub_host=$2
  local sub_path=$3
  local vpn_host=$4
  local mode=$5
  local -a hosts=()
  mapfile -t hosts < <(unique_hosts "$panel_host" "$sub_host" "$vpn_host")

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

    # Always expose native API subscription path on hosts that serve HTTP
    if [[ "$host" == "$panel_host" || "$host" == "$sub_host" ]]; then
      conf+="
    location ^~ /api/sub/ {
        access_log off;
        proxy_pass http://127.0.0.1:8080;
$(nginx_proxy_headers "$proto")
    }
"
    fi

    if [[ "$host" == "$panel_host" ]]; then
      conf+="
    location / {
        proxy_pass http://127.0.0.1:8080;
$(nginx_proxy_headers "$proto")
    }
"
    elif [[ "$host" == "$sub_host" ]]; then
      # Subscription-only host without panel UI
      conf+="
    location / {
        return 404;
    }
"
    else
      # VPN host: optional HTTPS decoy (no panel)
      conf+="
    location / {
        default_type text/plain;
        return 204;
    }
"
    fi

    conf+="}
"
  done

  printf '%s\n' "$conf" >"$NGINX_SITE"
}

install_nginx() {
  local panel_host=$1
  local sub_host=$2
  local sub_path=$3
  local vpn_host=$4
  local email=$5

  colorized_echo blue "Installing Nginx + Certbot..."
  export DEBIAN_FRONTEND=noninteractive
  apt-get install -y nginx certbot python3-certbot-nginx

  rm -f /etc/nginx/sites-enabled/default
  write_nginx_site "$panel_host" "$sub_host" "$sub_path" "$vpn_host" "http"
  ln -sfn "$NGINX_SITE" "$NGINX_LINK"
  nginx -t
  systemctl enable --now nginx
  systemctl reload nginx

  local -a hosts=()
  local -a cert_args=()
  mapfile -t hosts < <(unique_hosts "$panel_host" "$sub_host" "$vpn_host")
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
    --cert-name "$panel_host"

  write_nginx_site "$panel_host" "$sub_host" "$sub_path" "$vpn_host" "https"
  nginx -t
  systemctl reload nginx
  colorized_echo green "Nginx + TLS ready for: ${hosts[*]}"
}

remove_nginx_site() {
  rm -f "$NGINX_LINK" "$NGINX_SITE"
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

generate_env() {
  local web_port=$1
  local with_nginx=$2
  local image_tag=$3
  local ip
  ip="$(public_ip)"

  colorized_echo blue "Generating .env secrets..."
  cp "$APP_DIR/.env.example" "$ENV_FILE"
  chmod 600 "$ENV_FILE"

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
VPN_PUBLIC_HOST=${CFG_VPN_HOST:-}
BASE_DOMAIN=${CFG_BASE_DOMAIN:-}
WEB_PORT=${web_port}
CREATED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF
  chmod 600 "$CREDENTIALS_FILE"

  cat >"$INSTALL_CONF" <<EOF
MODE=${CFG_MODE}
BASE_DOMAIN=${CFG_BASE_DOMAIN:-}
PANEL_HOST=${CFG_PANEL_HOST:-}
SUB_HOST=${CFG_SUB_HOST:-}
SUB_PATH=${CFG_SUB_PATH:-}
VPN_HOST=${CFG_VPN_HOST:-}
EMAIL=${CFG_EMAIL:-}
EOF
  chmod 600 "$INSTALL_CONF"
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
  local ip user pass panel_url sub_url vpn_host

  ip="$(get_env_var PANEL_IP "$CREDENTIALS_FILE" 2>/dev/null || public_ip)"
  user="$(get_env_var BOOTSTRAP_ADMIN_USER "$CREDENTIALS_FILE")"
  pass="$(get_env_var BOOTSTRAP_ADMIN_PASSWORD "$CREDENTIALS_FILE")"
  panel_url="$(get_env_var PANEL_URL "$CREDENTIALS_FILE")"
  sub_url="$(get_env_var SUB_PUBLIC_BASE_URL "$CREDENTIALS_FILE")"
  vpn_host="$(get_env_var VPN_PUBLIC_HOST "$CREDENTIALS_FILE")"

  echo
  colorized_echo green "╔══════════════════════════════════════════════╗"
  colorized_echo green "║         OverVPN installed successfully       ║"
  colorized_echo green "╚══════════════════════════════════════════════╝"
  echo
  colorized_echo cyan  "Panel:        ${panel_url}"
  colorized_echo cyan  "Login:        ${user}"
  colorized_echo cyan  "Password:     ${pass}"
  colorized_echo cyan  "Subscriptions:${sub_url}/… (or /api/sub/… if no custom path)"
  if [[ -n "$vpn_host" ]]; then
    colorized_echo cyan  "VPN host:     ${vpn_host}  (use as public host in Inbounds)"
  fi
  echo
  colorized_echo yellow "Credentials: ${CREDENTIALS_FILE}"
  colorized_echo yellow "Manage with: ${APP_NAME} status | logs | update | restart"
  echo
}

usage() {
  cat <<EOF
OverVPN management script

Usage:
  ${APP_NAME} install [options]
  ${APP_NAME} up | down | restart | status | logs [service] | update | uninstall
  ${APP_NAME} info | edit | bootstrap | install-script

Install asks interactively:
  1) base domain
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
  --no-nginx               Skip Nginx/TLS
  --no-ufw                 Do not touch UFW
  -h, --help               Show help

Default install pulls prebuilt images from:
  ${GHCR_API_IMAGE}:${DEFAULT_IMAGE_TAG}
  ${GHCR_WEB_IMAGE}:${DEFAULT_IMAGE_TAG}

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
    mapfile -t dns_hosts < <(unique_hosts "$CFG_PANEL_HOST" "$CFG_SUB_HOST" "$CFG_VPN_HOST")
    wait_for_dns "$ip" "${dns_hosts[@]}"
  fi

  fetch_repo "$branch"
  generate_env "$web_port" "$with_nginx" "$image_tag"

  if [[ "$use_ufw" == "true" ]]; then
    configure_firewall "$with_nginx" "$web_port"
  fi

  compose_up "$do_build"

  local health_port
  health_port="$(get_env_var WEB_PORT)"
  wait_for_health "http://127.0.0.1:${health_port}/api/health" || true

  if [[ "$CFG_MODE" == "domain" && "$with_nginx" == "true" ]]; then
    install_nginx "$CFG_PANEL_HOST" "$CFG_SUB_HOST" "$CFG_SUB_PATH" "$CFG_VPN_HOST" "$CFG_EMAIL"
  fi

  colorized_echo blue "Creating owner account..."
  compose --profile tools run --rm bootstrap-admin

  install_cli "${APP_DIR}/install.sh"
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

  local branch
  branch="$(git -C "$APP_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "$DEFAULT_BRANCH")"

  colorized_echo blue "Updating OverVPN (${branch})..."
  fetch_repo "$branch"
  install_cli "${APP_DIR}/install.sh"

  if [[ -n "$image_tag" ]]; then
    set_env_var "API_IMAGE" "${GHCR_API_IMAGE}:${image_tag}"
    set_env_var "WEB_IMAGE" "${GHCR_WEB_IMAGE}:${image_tag}"
  fi

  compose_up "$do_build"
  wait_for_health "http://127.0.0.1:$(get_env_var WEB_PORT)/api/health" || true
  colorized_echo green "Update complete."
}

cmd_uninstall() {
  check_root
  is_installed || { colorized_echo red "OverVPN is not installed."; exit 1; }

  local wipe="n"
  colorized_echo yellow "This will stop containers and remove ${APP_DIR}."
  if [[ -t 0 ]]; then
    read -r -p "Also delete Docker volumes (DB/data)? [y/N] " wipe
  fi
  compose down
  if [[ "${wipe,,}" == "y" || "${wipe,,}" == "yes" ]]; then
    compose down -v || true
  fi
  remove_nginx_site
  rm -rf "$APP_DIR"
  rm -f "$BIN_PATH"
  colorized_echo green "OverVPN uninstalled."
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
