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
BIN_PATH="/usr/local/bin/${APP_NAME}"
NGINX_SITE="/etc/nginx/sites-available/${APP_NAME}"
NGINX_LINK="/etc/nginx/sites-enabled/${APP_NAME}"
REPO_URL="${OVERVPN_REPO_URL:-https://github.com/Overl1te/OverVPN.git}"
REPO_RAW_BASE="${OVERVPN_RAW_BASE:-https://raw.githubusercontent.com/Overl1te/OverVPN}"
DEFAULT_BRANCH="${OVERVPN_BRANCH:-master}"
DEFAULT_WEB_PORT="8000"

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
  apt-get install -y ca-certificates curl git openssl ufw
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

prompt_domain() {
  local domain="" email=""
  local ip
  ip="$(public_ip)"

  echo
  colorized_echo cyan "Server IP: ${ip}"
  colorized_echo cyan "Point your domain A-record to this IP before continuing (for HTTPS)."
  echo

  if [[ -t 0 ]]; then
    read -r -p "Panel domain (e.g. vpn.example.com, empty = IP:${DEFAULT_WEB_PORT} without TLS): " domain
    domain="$(printf '%s' "$domain" | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]')"
    if [[ -n "$domain" ]]; then
      read -r -p "Let's Encrypt email [admin@${domain}]: " email
      email="$(printf '%s' "$email" | tr -d '[:space:]')"
      if [[ -z "$email" ]]; then
        email="admin@${domain}"
      fi
    fi
  fi

  PROMPT_DOMAIN="$domain"
  PROMPT_EMAIL="$email"
}

validate_domain() {
  local domain=$1
  if [[ ! "$domain" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ ]]; then
    colorized_echo red "Invalid domain: ${domain}"
    exit 1
  fi
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

write_nginx_http_bootstrap() {
  local domain=$1

  cat >"$NGINX_SITE" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${domain};

    location ^~ /api/sub/ {
        access_log off;
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Request-ID \$request_id;
        proxy_connect_timeout 5s;
        proxy_read_timeout 60s;
    }

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Request-ID \$request_id;
        proxy_connect_timeout 5s;
        proxy_read_timeout 60s;
    }
}
EOF
}

write_nginx_https() {
  local domain=$1

  cat >"$NGINX_SITE" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${domain};
    access_log off;
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name ${domain};

    ssl_certificate /etc/letsencrypt/live/${domain}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${domain}/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    location ^~ /api/sub/ {
        access_log off;
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Request-ID \$request_id;
        proxy_connect_timeout 5s;
        proxy_read_timeout 60s;
    }

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Request-ID \$request_id;
        proxy_connect_timeout 5s;
        proxy_read_timeout 60s;
    }
}
EOF
}

install_nginx() {
  local domain=$1
  local email=$2

  colorized_echo blue "Installing Nginx + Certbot for ${domain}..."
  export DEBIAN_FRONTEND=noninteractive
  apt-get install -y nginx certbot python3-certbot-nginx

  rm -f /etc/nginx/sites-enabled/default
  write_nginx_http_bootstrap "$domain"
  ln -sfn "$NGINX_SITE" "$NGINX_LINK"
  nginx -t
  systemctl enable --now nginx
  systemctl reload nginx

  colorized_echo blue "Requesting Let's Encrypt certificate..."
  certbot --nginx \
    -d "$domain" \
    --non-interactive \
    --agree-tos \
    --email "$email" \
    --redirect \
    --no-eff-email

  # Normalize to our HTTPS template (certbot may leave a mixed config)
  if [[ -f "/etc/letsencrypt/live/${domain}/fullchain.pem" ]]; then
    write_nginx_https "$domain"
    # options-ssl-nginx / dhparams may be missing on some certbot versions
    if [[ ! -f /etc/letsencrypt/options-ssl-nginx.conf ]]; then
      sed -i '/options-ssl-nginx.conf/d' "$NGINX_SITE"
    fi
    if [[ ! -f /etc/letsencrypt/ssl-dhparams.pem ]]; then
      sed -i '/ssl-dhparams.pem/d' "$NGINX_SITE"
    fi
    nginx -t
    systemctl reload nginx
  fi

  colorized_echo green "Nginx configured for https://${domain}"
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
  local domain=$1
  local web_port=$2
  local with_nginx=$3
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

  if [[ -n "$domain" ]]; then
    set_env_var "CORS_ORIGINS" "https://${domain}"
    set_env_var "SUB_PUBLIC_BASE_URL" "https://${domain}"
    set_env_var "AUTH_COOKIE_SECURE" "true"
    set_env_var "WEB_BIND_ADDRESS" "127.0.0.1"
    set_env_var "WEB_PORT" "8080"
    if [[ "$with_nginx" == "true" ]]; then
      # Avoid conflict with Nginx on 80/443 TCP
      set_env_var "SING_BOX_ACME_HTTP_PORT" "8081"
      set_env_var "SING_BOX_ACME_TLS_PORT" "8443"
    fi
  else
    set_env_var "CORS_ORIGINS" "http://${ip}:${web_port}"
    set_env_var "SUB_PUBLIC_BASE_URL" "http://${ip}:${web_port}"
    set_env_var "AUTH_COOKIE_SECURE" "false"
    set_env_var "WEB_BIND_ADDRESS" "0.0.0.0"
    set_env_var "WEB_PORT" "$web_port"
  fi

  umask 077
  cat >"$CREDENTIALS_FILE" <<EOF
BOOTSTRAP_ADMIN_USER=${admin_user}
BOOTSTRAP_ADMIN_PASSWORD=${admin_pass}
PANEL_IP=${ip}
PANEL_DOMAIN=${domain}
WEB_PORT=${web_port}
CREATED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF
  chmod 600 "$CREDENTIALS_FILE"
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
  local domain=$1
  local web_port=$2
  local ip user pass panel_url

  ip="$(get_env_var PANEL_IP "$CREDENTIALS_FILE" 2>/dev/null || public_ip)"
  user="$(get_env_var BOOTSTRAP_ADMIN_USER "$CREDENTIALS_FILE")"
  pass="$(get_env_var BOOTSTRAP_ADMIN_PASSWORD "$CREDENTIALS_FILE")"

  if [[ -n "$domain" ]]; then
    panel_url="https://${domain}"
  else
    panel_url="http://${ip}:${web_port}"
  fi

  echo
  colorized_echo green "╔══════════════════════════════════════════════╗"
  colorized_echo green "║         OverVPN installed successfully       ║"
  colorized_echo green "╚══════════════════════════════════════════════╝"
  echo
  colorized_echo cyan  "Panel:    ${panel_url}"
  colorized_echo cyan  "Login:    ${user}"
  colorized_echo cyan  "Password: ${pass}"
  echo
  colorized_echo yellow "Credentials saved to: ${CREDENTIALS_FILE}"
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

Install options:
  --domain <host>     Skip prompt; use this domain + Nginx/HTTPS
  --email <email>     Let's Encrypt email (default: admin@<domain>)
  --port <port>       Panel port without domain (default: ${DEFAULT_WEB_PORT})
  --branch <name>     Git branch/tag (default: ${DEFAULT_BRANCH})
  --no-nginx          With domain, skip Nginx (panel on 127.0.0.1:8080)
  --no-ufw            Do not touch UFW
  -h, --help          Show help

During install the script asks for a domain interactively.
Leave domain empty to publish the panel on http://IP:${DEFAULT_WEB_PORT}.

One-liner:
  sudo bash -c "\$(curl -fsSL ${REPO_RAW_BASE}/${DEFAULT_BRANCH}/install.sh)" @ install
EOF
}

cmd_install() {
  check_root
  detect_os

  local domain="" email="" web_port="$DEFAULT_WEB_PORT" branch="$DEFAULT_BRANCH"
  local with_nginx="auto" use_ufw="true" domain_from_flag="false"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --domain) domain="${2:-}"; domain_from_flag="true"; shift 2 ;;
      --email) email="${2:-}"; shift 2 ;;
      --port) web_port="${2:-}"; shift 2 ;;
      --branch|--version) branch="${2:-}"; shift 2 ;;
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

  if [[ "$domain_from_flag" != "true" ]]; then
    prompt_domain
    domain="$PROMPT_DOMAIN"
    if [[ -z "$email" ]]; then
      email="$PROMPT_EMAIL"
    fi
  fi

  domain="$(printf '%s' "$domain" | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]')"

  if [[ -n "$domain" ]]; then
    validate_domain "$domain"
    if [[ -z "$email" ]]; then
      email="admin@${domain}"
    fi
  fi

  if [[ "$with_nginx" == "auto" ]]; then
    if [[ -n "$domain" ]]; then
      with_nginx="true"
    else
      with_nginx="false"
    fi
  fi

  install_packages
  ensure_docker
  fetch_repo "$branch"
  generate_env "$domain" "$web_port" "$with_nginx"

  if [[ "$use_ufw" == "true" ]]; then
    configure_firewall "$with_nginx" "$web_port"
  fi

  colorized_echo blue "Building and starting containers (first run may take several minutes)..."
  compose up -d --build

  local health_port
  health_port="$(get_env_var WEB_PORT)"
  wait_for_health "http://127.0.0.1:${health_port}/api/health" || true

  if [[ -n "$domain" && "$with_nginx" == "true" ]]; then
    install_nginx "$domain" "$email"
  fi

  colorized_echo blue "Creating owner account..."
  compose --profile tools run --rm bootstrap-admin

  install_cli "${APP_DIR}/install.sh"
  print_success "$domain" "$web_port"
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

  local branch
  branch="$(git -C "$APP_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "$DEFAULT_BRANCH")"

  colorized_echo blue "Updating OverVPN (${branch})..."
  fetch_repo "$branch"
  install_cli "${APP_DIR}/install.sh"
  compose up -d --build
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

  local domain port ip user
  domain="$(get_env_var SUB_PUBLIC_BASE_URL)"
  port="$(get_env_var WEB_PORT)"
  ip="$(public_ip)"
  user="$(get_env_var BOOTSTRAP_ADMIN_USER)"

  echo "Install dir:  ${APP_DIR}"
  echo "Public URL:   ${domain}"
  echo "Web port:     ${port}"
  echo "Server IP:    ${ip}"
  echo "Admin user:   ${user}"
  if [[ -f "$CREDENTIALS_FILE" ]]; then
    echo "Credentials:  ${CREDENTIALS_FILE}"
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
    update) cmd_update ;;
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
