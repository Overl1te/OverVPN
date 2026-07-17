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
INSTALL_COMPLETE_FILE="${APP_DIR}/.install.complete"
INSTALL_INPROGRESS_FILE="${APP_DIR}/.install.inprogress"
BIN_PATH="/usr/local/bin/${APP_NAME}"
NGINX_SITE="/etc/nginx/sites-available/${APP_NAME}"
NGINX_LINK="/etc/nginx/sites-enabled/${APP_NAME}"
LANDING_DIR="/var/www/${APP_NAME}"
CERTBOT_DEPLOY_HOOK="/etc/letsencrypt/renewal-hooks/deploy/${APP_NAME}-sync-vpn-certs.sh"
VPN_CERT_NAME="vpn-fullchain.pem"
VPN_KEY_NAME="vpn-privkey.pem"
VPN_CERT_HOST_DIR="${APP_DIR}/deploy/sing-box/certs"
VPN_CERT_CONTAINER_PATH="/var/lib/sing-box-certs/${VPN_CERT_NAME}"
VPN_KEY_CONTAINER_PATH="/var/lib/sing-box-certs/${VPN_KEY_NAME}"
REPO_URL="${OVERVPN_REPO_URL:-https://github.com/Overl1te/OverVPN.git}"
REPO_RAW_BASE="${OVERVPN_RAW_BASE:-https://raw.githubusercontent.com/Overl1te/OverVPN}"
DEFAULT_BRANCH="${OVERVPN_BRANCH:-master}"
DEFAULT_WEB_PORT="8000"
DEFAULT_IMAGE_TAG="${OVERVPN_IMAGE_TAG:-latest}"
GHCR_API_IMAGE="ghcr.io/overl1te/overvpn-api"
GHCR_WEB_IMAGE="ghcr.io/overl1te/overvpn-web"
GHCR_MTPROXY_IMAGE="ghcr.io/overl1te/overvpn-mtproxy"
DEFAULT_POSTGRES_IMAGE="postgres:18-alpine"
DEFAULT_REDIS_IMAGE="redis:8-alpine"
BUSYBOX_IMAGE="busybox:1.37"
CLI_LANG="${OVERVPN_CLI_LANG:-en}"

readonly SINGBOX_PROTOCOLS="HYSTERIA2,VLESS_REALITY,TROJAN,SHADOWSOCKS,WIREGUARD"
readonly XRAY_PROTOCOLS="VLESS_XHTTP_TLS,VLESS_GRPC_TLS,VLESS_TCP_TLS,TROJAN_TLS,SHADOWSOCKS_XRAY,WIREGUARD_XRAY"
readonly ALL_PROTOCOLS="${SINGBOX_PROTOCOLS},${XRAY_PROTOCOLS},MTPROXY"

# TUI drawing (MTProxyMax-style console screens)
readonly BOX_TL='╔' BOX_TR='╗' BOX_BL='╚' BOX_BR='╝'
readonly BOX_H='═' BOX_V='║' BOX_LT='╠' BOX_RT='╣'
readonly TUI_NC=$'\e[0m' TUI_BOLD=$'\e[1m' TUI_DIM=$'\e[2m'
readonly TUI_CYAN=$'\e[96m' TUI_GREEN=$'\e[92m' TUI_YELLOW=$'\e[93m'
readonly TUI_RED=$'\e[91m' TUI_BLUE=$'\e[94m' TUI_BRIGHT_CYAN=$'\e[1;96m'

tui_term_width() {
  local cols
  cols="$(tput cols 2>/dev/null || true)"
  if [[ -z "$cols" || ! "$cols" =~ ^[0-9]+$ ]]; then
    cols="${COLUMNS:-72}"
  fi
  if [[ "$cols" -gt 80 ]]; then
    cols=80
  elif [[ "$cols" -lt 48 ]]; then
    cols=48
  fi
  printf '%s' "$cols"
}

_tui_strlen() {
  local clean="$1"
  local esc=$'\033'
  clean="${clean//$'\\033'/$esc}"
  while [[ "$clean" == *"${esc}["* ]]; do
    local before="${clean%%${esc}\[*}"
    local rest="${clean#*${esc}\[}"
    local after="${rest#*m}"
    [[ "$rest" == "$after" ]] && break
    clean="${before}${after}"
  done
  printf '%s' "${#clean}"
}

_tui_repeat() {
  local char="$1" count="$2" str
  [[ "${count:-0}" -le 0 ]] 2>/dev/null && return 0
  printf -v str '%*s' "$count" ''
  printf '%s' "${str// /$char}"
}

clear_screen() {
  clear 2>/dev/null || printf '\033[2J\033[H'
}

draw_box_top() {
  local width="${1:-$(tui_term_width)}"
  local inner=$((width - 2))
  [[ "$inner" -lt 0 ]] && inner=0
  printf '%s%s%s%s%s\n' "$TUI_CYAN" "$BOX_TL" "$(_tui_repeat "$BOX_H" "$inner")" "$BOX_TR" "$TUI_NC"
}

draw_box_bottom() {
  local width="${1:-$(tui_term_width)}"
  local inner=$((width - 2))
  [[ "$inner" -lt 0 ]] && inner=0
  printf '%s%s%s%s%s\n' "$TUI_CYAN" "$BOX_BL" "$(_tui_repeat "$BOX_H" "$inner")" "$BOX_BR" "$TUI_NC"
}

draw_box_sep() {
  local width="${1:-$(tui_term_width)}"
  local inner=$((width - 2))
  [[ "$inner" -lt 0 ]] && inner=0
  printf '%s%s%s%s%s\n' "$TUI_CYAN" "$BOX_LT" "$(_tui_repeat "$BOX_H" "$inner")" "$BOX_RT" "$TUI_NC"
}

draw_box_line() {
  local text="$1" width="${2:-$(tui_term_width)}"
  local inner=$((width - 2))
  local text_len padding
  text_len="$(_tui_strlen "$text")"
  padding=$((inner - text_len - 1))
  [[ "$padding" -lt 0 ]] && padding=0
  printf '%s%s%s %s%s%s%s\n' "$TUI_CYAN" "$BOX_V" "$TUI_NC" "$text" "$(_tui_repeat ' ' "$padding")" "$TUI_CYAN" "$BOX_V$TUI_NC"
}

draw_box_empty() {
  draw_box_line "" "${1:-$(tui_term_width)}"
}

draw_box_center() {
  local text="$1" width="${2:-$(tui_term_width)}"
  local inner=$((width - 2))
  local text_len left_pad right_pad
  text_len="$(_tui_strlen "$text")"
  left_pad=$(( (inner - text_len) / 2 ))
  right_pad=$((inner - text_len - left_pad))
  [[ "$left_pad" -lt 0 ]] && left_pad=0
  [[ "$right_pad" -lt 0 ]] && right_pad=0
  printf '%s%s%s%s%s%s%s%s\n' \
    "$TUI_CYAN" "$BOX_V" "$TUI_NC" \
    "$(_tui_repeat ' ' "$left_pad")" "$text" "$(_tui_repeat ' ' "$right_pad")" \
    "$TUI_CYAN" "$BOX_V$TUI_NC"
}

show_banner() {
  local subtitle="${1:-}"
  printf '%s%s\n' "$TUI_BRIGHT_CYAN" "$TUI_BOLD"
  cat <<'EOF'
   ___                 __     ______  _   _
  / _ \__   _____ _ __ \ \   / /  _ \| \ | |
 | | | \ \ / / _ \ '__| \ \ / /| |_) |  \| |
 | |_| |\ V /  __/ |     \ V / |  __/| |\  |
  \___/  \_/ \___|_|      \_/  |_|   |_| \_|
EOF
  printf '%s' "$TUI_NC"
  if [[ -n "$subtitle" ]]; then
    printf '  %s%s%s\n\n' "$TUI_DIM" "$subtitle" "$TUI_NC"
  else
    printf '\n\n'
  fi
}

ui_prompt() {
  local label=$1
  local default=${2:-}
  local reply
  if [[ -n "$default" ]]; then
    read -r -p "$(printf '%s%s%s [%s]: ' "$TUI_CYAN" "$label" "$TUI_NC" "$default")" reply
    printf '%s' "${reply:-$default}"
  else
    read -r -p "$(printf '%s%s%s: ' "$TUI_CYAN" "$label" "$TUI_NC")" reply
    printf '%s' "$reply"
  fi
}

ui_choice() {
  local label=${1:-Choice}
  local default=${2:-}
  local reply
  if [[ -n "$default" ]]; then
    read -r -p "$(printf ' %s>%s %s [%s]: ' "$TUI_BRIGHT_CYAN" "$TUI_NC" "$label" "$default")" reply
    printf '%s' "${reply:-$default}"
  else
    read -r -p "$(printf ' %s>%s %s: ' "$TUI_BRIGHT_CYAN" "$TUI_NC" "$label")" reply
    printf '%s' "$reply"
  fi
}

ui_press_enter() {
  local msg
  msg="$(cli_t ui_press_enter)"
  read -r -p "$(printf ' %s%s%s' "$TUI_DIM" "$msg" "$TUI_NC")" _
}

# Arrow-key menu primitives (raw TTY; falls back to typed ui_choice)
# Result is stored in UI_SELECT_RESULT — never capture ui_select_menu via $()
# (that would redirect stdout and hide the TUI / break [[ -t 1 ]]).
UI_TTY_SAVED=""
UI_TTY_RAW=0
UI_MENU_HEADER=""
UI_SELECT_RESULT=""

ui_tty_save() {
  UI_TTY_SAVED=""
  UI_TTY_RAW=0
  if [[ -t 0 ]] && command -v stty >/dev/null 2>&1; then
    UI_TTY_SAVED="$(stty -g 2>/dev/null || true)"
  fi
}

ui_tty_restore() {
  if [[ "$UI_TTY_RAW" == "1" && -n "$UI_TTY_SAVED" ]]; then
    stty "$UI_TTY_SAVED" 2>/dev/null || true
  fi
  UI_TTY_RAW=0
}

ui_tty_enter_raw() {
  if [[ -z "$UI_TTY_SAVED" ]]; then
    return 1
  fi
  if ! stty -echo -icanon min 1 time 0 2>/dev/null; then
    return 1
  fi
  UI_TTY_RAW=1
  return 0
}

ui_arrows_available() {
  # Only stdin must be a TTY. Do not test stdout: callers must not wrap
  # ui_select_menu in $(), but even then -t 1 would falsely fail.
  [[ -t 0 ]] && command -v stty >/dev/null 2>&1
}

# Prints: up|down|enter|esc|digit|letter|…
ui_read_key() {
  local key rest
  IFS= read -r -n1 -s key || return 1
  if [[ "$key" == $'\e' ]]; then
    rest=""
    IFS= read -r -n1 -s -t 0.1 rest || true
    if [[ -z "$rest" ]]; then
      printf 'esc'
      return 0
    fi
    if [[ "$rest" == '[' ]]; then
      IFS= read -r -n1 -s -t 0.1 rest || true
      case "$rest" in
        A) printf 'up' ;;
        B) printf 'down' ;;
        C) printf 'right' ;;
        D) printf 'left' ;;
        *) printf 'unknown' ;;
      esac
      return 0
    fi
    printf 'esc'
    return 0
  fi
  if [[ -z "$key" || "$key" == $'\n' || "$key" == $'\r' ]]; then
    printf 'enter'
    return 0
  fi
  printf '%s' "$key"
}

# Typed (non-arrow) fallback used when TTY raw mode is unavailable.
# Sets UI_SELECT_RESULT.
ui_select_menu_typed() {
  local selected="$1"
  shift
  local -a items=("$@")
  local count=${#items[@]}
  local w key i val label
  local default_hint

  UI_SELECT_RESULT=""
  w="$(tui_term_width)"
  if [[ -n "${UI_MENU_HEADER:-}" ]] && declare -F "${UI_MENU_HEADER}" >/dev/null 2>&1; then
    clear_screen
    "${UI_MENU_HEADER}"
  fi
  for i in "${!items[@]}"; do
    label="${items[$i]#*|}"
    draw_box_line " ${TUI_BRIGHT_CYAN}[$((i + 1))]${TUI_NC} ${label}" "$w"
  done
  draw_box_empty "$w"
  draw_box_bottom "$w"
  default_hint="$((selected + 1))"
  key="$(ui_choice "$(cli_t ui_choice_label)" "$default_hint")"
  key="$(printf '%s' "$key" | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]')"
  if [[ "$key" =~ ^[0-9]+$ ]]; then
    # Prefer match by option value (e.g. main menu "0" = exit)
    for i in "${!items[@]}"; do
      val="${items[$i]%%|*}"
      if [[ "$val" == "$key" ]]; then
        UI_SELECT_RESULT="$val"
        return 0
      fi
    done
    i=$((key - 1))
    if [[ "$i" -ge 0 && "$i" -lt "$count" ]]; then
      UI_SELECT_RESULT="${items[$i]%%|*}"
      return 0
    fi
  fi
  for i in "${!items[@]}"; do
    val="${items[$i]%%|*}"
    if [[ "$val" == "$key" ]]; then
      UI_SELECT_RESULT="$val"
      return 0
    fi
  done
  UI_SELECT_RESULT="${items[$selected]%%|*}"
  return 0
}

ui_menu_alias_match() {
  local val="$1" lower="$2"
  [[ "$val" == "$lower" ]] && return 0
  [[ "$val" == "yes" && "$lower" == "y" ]] && return 0
  [[ "$val" == "no" && "$lower" == "n" ]] && return 0
  [[ "$val" == "skip" && "$lower" == "s" ]] && return 0
  [[ "$val" == "back" && "$lower" == "b" ]] && return 0
  [[ "$val" == "quit" && "$lower" == "q" ]] && return 0
  return 1
}

# ui_select_menu <default_index> "value|label" "value|label" ...
# Optional: set UI_MENU_HEADER to a function name drawn after clear_screen each redraw.
# Sets UI_SELECT_RESULT to the selected value. Do NOT wrap in $().
ui_select_menu() {
  local selected="${1:-0}"
  shift
  local -a items=("$@")
  local count=${#items[@]}
  local w key i val label prefix lower

  UI_SELECT_RESULT=""
  if [[ "$count" -eq 0 ]]; then
    return 1
  fi
  if [[ "$selected" -lt 0 ]]; then
    selected=0
  elif [[ "$selected" -ge "$count" ]]; then
    selected=$((count - 1))
  fi

  if ! ui_arrows_available; then
    ui_select_menu_typed "$selected" "${items[@]}"
    return $?
  fi

  ui_tty_save
  if ! ui_tty_enter_raw; then
    ui_tty_restore
    ui_select_menu_typed "$selected" "${items[@]}"
    return $?
  fi

  trap 'ui_tty_restore' EXIT
  trap 'ui_tty_restore; exit 130' INT
  trap 'ui_tty_restore; exit 143' TERM

  while true; do
    w="$(tui_term_width)"
    clear_screen
    if [[ -n "${UI_MENU_HEADER:-}" ]] && declare -F "${UI_MENU_HEADER}" >/dev/null 2>&1; then
      "${UI_MENU_HEADER}"
    fi
    for i in "${!items[@]}"; do
      label="${items[$i]#*|}"
      if [[ "$i" -eq "$selected" ]]; then
        prefix="${TUI_BRIGHT_CYAN}${TUI_BOLD}▸${TUI_NC} ${TUI_BRIGHT_CYAN}${TUI_BOLD}${label}${TUI_NC}"
      else
        prefix="  ${label}"
      fi
      draw_box_line " ${prefix}" "$w"
    done
    draw_box_empty "$w"
    draw_box_sep "$w"
    draw_box_center "${TUI_DIM}$(cli_t ui_nav_hint)${TUI_NC}" "$w"
    draw_box_bottom "$w"

    key="$(ui_read_key)" || key="enter"
    case "$key" in
      up|left)
        if [[ "$selected" -le 0 ]]; then
          selected=$((count - 1))
        else
          selected=$((selected - 1))
        fi
        ;;
      down|right)
        selected=$(( (selected + 1) % count ))
        ;;
      enter)
        ui_tty_restore
        trap - EXIT INT TERM
        UI_SELECT_RESULT="${items[$selected]%%|*}"
        return 0
        ;;
      esc) ;;
      [0-9])
        for i in "${!items[@]}"; do
          val="${items[$i]%%|*}"
          if [[ "$val" == "$key" ]]; then
            ui_tty_restore
            trap - EXIT INT TERM
            UI_SELECT_RESULT="$val"
            return 0
          fi
        done
        if [[ "$key" != "0" ]]; then
          i=$((key - 1))
          if [[ "$i" -ge 0 && "$i" -lt "$count" ]]; then
            ui_tty_restore
            trap - EXIT INT TERM
            UI_SELECT_RESULT="${items[$i]%%|*}"
            return 0
          fi
        fi
        ;;
      y|Y|n|N|s|S|q|Q|b|B)
        lower="$(printf '%s' "$key" | tr '[:upper:]' '[:lower:]')"
        for i in "${!items[@]}"; do
          val="${items[$i]%%|*}"
          if ui_menu_alias_match "$val" "$lower"; then
            ui_tty_restore
            trap - EXIT INT TERM
            UI_SELECT_RESULT="$val"
            return 0
          fi
        done
        ;;
    esac
  done
}

# ui_confirm <default y|n> [yes_label] [no_label]
# Returns 0 if yes, 1 if no. Uses UI_MENU_HEADER when set.
ui_confirm() {
  local default="${1:-y}"
  local yes_label="${2:-$(cli_t opt_yes)}"
  local no_label="${3:-$(cli_t opt_no)}"
  local idx=0
  default="$(printf '%s' "$default" | tr '[:upper:]' '[:lower:]')"
  if [[ "$default" == "n" || "$default" == "no" ]]; then
    idx=1
  fi
  ui_select_menu "$idx" "yes|${yes_label}" "no|${no_label}"
  [[ "$UI_SELECT_RESULT" == "yes" ]]
}

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

load_cli_lang() {
  if [[ -f "$INSTALL_CONF" ]]; then
    local saved
    saved="$(get_env_var CLI_LANG "$INSTALL_CONF" 2>/dev/null || true)"
    if [[ "$saved" == ru || "$saved" == en ]]; then
      CLI_LANG="$saved"
    fi
  fi
  if [[ -n "${OVERVPN_CLI_LANG:-}" ]]; then
    case "${OVERVPN_CLI_LANG,,}" in
      ru|ru_ru|ru-ru|russian) CLI_LANG=ru ;;
      en|english) CLI_LANG=en ;;
    esac
  fi
}

# Install UTF-8 locale bits so Cyrillic in our CLI renders correctly.
# Do NOT switch LANG/LC_ALL to Russian — apt/docker/system tools stay on the host default.
ensure_cyrillic_utf8() {
  local charmap
  charmap="$(locale charmap 2>/dev/null || true)"
  if locale -a 2>/dev/null | grep -qiE '^(C|POSIX|en_US|ru_RU)\.utf-?8$' \
    && [[ "${charmap,,}" == "utf-8" || "${charmap,,}" == "utf8" ]]; then
    return 0
  fi

  detect_os
  colorized_echo blue "$(cli_t ensuring_utf8_locale)"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get install -y locales language-pack-ru
  locale-gen C.UTF-8 2>/dev/null || true
  locale-gen en_US.UTF-8 2>/dev/null || true
  locale-gen ru_RU.UTF-8 2>/dev/null || true

  charmap="$(locale charmap 2>/dev/null || true)"
  if [[ "${charmap,,}" != "utf-8" && "${charmap,,}" != "utf8" ]]; then
    if locale -a 2>/dev/null | grep -qiE '^C\.utf-?8$'; then
      export LC_CTYPE=C.UTF-8
    elif locale -a 2>/dev/null | grep -qiE '^en_US\.utf-?8$'; then
      export LC_CTYPE=en_US.UTF-8
    fi
  fi
}

apply_cli_lang() {
  if [[ "$CLI_LANG" == ru ]]; then
    ensure_cyrillic_utf8
  fi
}

cli_t() {
  local key=$1
  shift
  if [[ "$CLI_LANG" == ru ]]; then
    case "$key" in
      must_be_root) printf '%s' "Эту команду нужно запускать от root (sudo)." ;;
      wizard_title) printf '%s' "Мастер установки" ;;
      wizard_subtitle) printf '%s' "Однонодовая панель · установка" ;;
      menu_subtitle) printf '%s' "Однонодовая панель · управление" ;;
      server_ip) printf 'IP сервера: %s' "$1" ;;
      answer_all) printf '%s' "Ответьте на все вопросы — дальше установка без участия." ;;
      depth_title) printf '%s' "Глубина настройки" ;;
      depth_simple) printf '%s' "Простая (все протоколы, рекомендуемые порты)" ;;
      depth_detailed) printf '%s' "Подробная (протоколы, порты, ядра)" ;;
      protocols_title) printf '%s' "Протоколы" ;;
      protocols_hint) printf '%s' "Выберите хотя бы один протокол. Вопросы сгруппированы по ядрам." ;;
      select_protocol) printf 'Включить %s?' "$1" ;;
      no_protocols) printf '%s' "Нужно выбрать хотя бы один протокол." ;;
      port_preset_title) printf '%s' "Набор портов" ;;
      port_standard) printf '%s' "Стандартные порты" ;;
      port_stealth) printf '%s' "Скрытые высокие порты" ;;
      prompt_protocol_port) printf 'Порт %s' "$1" ;;
      prompt_default_inbounds) printf '%s' "Создать входящие подключения по умолчанию?" ;;
      prompt_ufw) printf '%s' "Настроить UFW?" ;;
      summary_depth) printf 'Настройка:     %s' "$1" ;;
      summary_protocols) printf 'Протоколы:    %s' "$1" ;;
      summary_cores) printf 'Ядра:         %s' "$1" ;;
      summary_ports) printf 'Порты:        %s' "$1" ;;
      summary_defaults) printf 'Default inbounds: %s' "$1" ;;
      leave_empty_ip) printf 'Режим IP: http://%s:%s (без TLS).' "$1" "$2" ;;
      non_interactive_no_domain) printf '%s' "Неинтерактивный режим: установка без домена." ;;
      prompt_base_domain) printf '%s' "Базовый домен (например example.com)" ;;
      mode_ip_only) printf '%s' "Режим: только IP (без TLS)." ;;
      prompt_panel_host) printf 'Хост панели' ;;
      prompt_sub_host) printf 'Хост подписок или хост/путь' ;;
      prompt_vpn_host) printf 'Публичный VPN-хост' ;;
      prompt_email) printf 'Email для Let'\''s Encrypt' ;;
      summary_title) printf '%s' "Итого" ;;
      summary_site) printf 'Сайт:         https://%s' "$1" ;;
      summary_panel) printf 'Панель:       https://%s' "$1" ;;
      summary_sub) printf 'Подписки:     https://%s/api/sub/{TOKEN}' "$1" ;;
      summary_sub_path) printf 'Подписки:     https://%s%s/{TOKEN}' "$1" "$2" ;;
      summary_vpn) printf 'VPN-хост:     %s' "$1" ;;
      summary_email) printf 'Email:        %s' "$1" ;;
      summary_mode_ip) printf 'Режим:        IP-only (порт %s)' "$1" ;;
      summary_mtproxy_on) printf '%s' "MTProxy:      да (Telemt)" ;;
      summary_mtproxy_off) printf '%s' "MTProxy:      нет" ;;
      mtproxy_screen_title) printf '%s' "MTProxy (Telemt)" ;;
      mtproxy_screen_hint) printf '%s' "Опциональный Telegram MTProxy на Telemt (порты 10001–10016)." ;;
      mtproxy_opt_yes) printf '%s' "Установить MTProxy" ;;
      mtproxy_opt_no) printf '%s' "Пропустить MTProxy" ;;
      prompt_mtproxy) printf '%s' "Ставить MTProxy (Telemt)?" ;;
      dns_title) printf '%s' "DNS A-записи" ;;
      dns_hint) printf 'У регистратора DNS → A-записи → %s' "$1" ;;
      dns_point) printf '%s  →  %s' "$1" "$2" ;;
      dns_cloudflare) printf '%s' "Cloudflare: серая тучка (только DNS), пока нет сертификатов." ;;
      dns_firewall) printf '%s' "Откройте UDP/443 и TCP 80/443 в файрволе." ;;
      dns_prompt_hint) printf '%s' "Если записи уже созданы — выберите проверку. Пропуск часто ломает TLS." ;;
      prompt_dns_ready) printf '%s' "Проверить DNS сейчас?" ;;
      dns_skip) printf '%s' "Проверка DNS пропущена. Без верных A-записей сертификаты не выпустятся." ;;
      dns_wait_ok) printf '%s' "ОК — проверяем DNS сейчас…" ;;
      prompt_start_now) printf '%s' "Начать установку?" ;;
      aborted) printf '%s' "Отменено." ;;
      no_more_prompts) printf '%s' "Больше вопросов не будет. Можно пить чай." ;;
      ensuring_utf8_locale) printf '%s' "Устанавливаем поддержку UTF-8 для кириллицы в терминале…" ;;
      install_success_title) printf '%s' "Установка завершена" ;;
      install_success_site) printf 'Сайт:         https://%s' "$1" ;;
      install_success_panel) printf 'Панель:       %s' "$1" ;;
      install_success_login) printf 'Логин:        %s' "$1" ;;
      install_success_password) printf 'Пароль:       %s' "$1" ;;
      install_success_subs) printf 'Подписки:     %s/api/sub/{TOKEN}' "$1" ;;
      install_success_vpn) printf 'VPN-хост:     %s' "$1" ;;
      install_success_credentials) printf 'Учётные данные: %s' "$1" ;;
      install_success_manage) printf 'Меню: %s   ·   CLI: %s status | logs | update' "$1" "$1" ;;
      ui_press_enter) printf '%s' "Enter — продолжить…" ;;
      ui_choice_label) printf '%s' "Выбор" ;;
      ui_nav_hint) printf '%s' "↑/↓ — навигация · Enter — выбор" ;;
      opt_yes) printf '%s' "Да" ;;
      opt_no) printf '%s' "Нет" ;;
      lang_screen_title) printf '%s' "Язык / Language" ;;
      lang_opt_en) printf '%s' "English" ;;
      lang_opt_ru) printf '%s' "Русский" ;;
      mode_screen_title) printf '%s' "Режим установки" ;;
      mode_opt_domain) printf '%s' "С доменом (Nginx + Let'\''s Encrypt TLS)" ;;
      mode_opt_ip) printf 'Только IP — http://%s:%s (без TLS)' "$1" "$2" ;;
      hosts_screen_title) printf '%s' "Домены и почта" ;;
      hosts_base_hint) printf '%s' "Базовый домен для лендинга и TLS" ;;
      confirm_screen_title) printf '%s' "Подтверждение" ;;
      confirm_opt_yes) printf '%s' "Начать установку" ;;
      confirm_opt_no) printf '%s' "Отмена" ;;
      dns_opt_check) printf '%s' "Проверить DNS и продолжить" ;;
      dns_opt_skip) printf '%s' "Пропустить проверку DNS" ;;
      menu_title) printf '%s' "Главное меню" ;;
      menu_status) printf '%s' "Статус контейнеров" ;;
      menu_info) printf '%s' "Инфо / URL / логин" ;;
      menu_logs) printf '%s' "Логи" ;;
      menu_restart) printf '%s' "Перезапуск" ;;
      menu_update) printf '%s' "Обновление / проверка" ;;
      menu_edit) printf '%s' "Редактировать .env" ;;
      menu_nginx) printf '%s' "Обновить Nginx / сертификаты" ;;
      menu_cores) printf '%s' "Управление VPN-ядрами" ;;
      menu_uninstall) printf '%s' "Удалить OverVPN" ;;
      menu_exit) printf '%s' "Выход" ;;
      menu_update_check) printf '%s' "Только проверить обновления" ;;
      menu_update_apply) printf '%s' "Обновить сейчас" ;;
      menu_update_back) printf '%s' "Назад" ;;
      menu_not_installed_hint) printf '%s' "OverVPN ещё не установлен. Запустите: overvpn install" ;;
      menu_logs_hint) printf '%s' "Логи (Ctrl+C — назад). Сервис пусто = все:" ;;
      unsupported_os) printf '%s' "Неподдерживаемая ОС: /etc/os-release не найден." ;;
      os_warning) printf 'Внимание: проверено на Ubuntu/Debian. Обнаружено: %s.' "$1" ;;
      installing_packages) printf '%s' "Устанавливаем необходимые пакеты…" ;;
      docker_already) printf '%s' "Docker и Compose уже установлены." ;;
      installing_docker) printf '%s' "Устанавливаем Docker Engine + Compose…" ;;
      docker_compose_missing) printf '%s' "Плагин docker compose отсутствует после установки Docker." ;;
      docker_installed) printf '%s' "Docker установлен." ;;
      building_images) printf '%s' "Собираем образы локально (это может занять несколько минут)…" ;;
      pulling_images) printf '%s' "Скачиваем образы из GHCR…" ;;
      starting_containers) printf '%s' "Запускаем контейнеры…" ;;
      checking_api_image) printf '%s' "Проверяем, что API-образ содержит Xray…" ;;
      api_image_missing_xray) printf 'Образ %s не содержит Xray (нужен свежий GHCR или локальная сборка).\nПовторите: sudo overvpn install --build\nИли дождитесь publish образов после зелёного CI и сделайте: sudo overvpn update' "$1" ;;
      checking_mtproxy_image) printf '%s' "Проверяем, что MTProxy-образ содержит Telemt…" ;;
      mtproxy_image_missing) printf 'Образ %s не содержит Telemt.\nПовторите: sudo overvpn install --build' "$1" ;;
      building_mtproxy_image) printf '%s' "Собираем образ MTProxy (Telemt)…" ;;
      refreshing_core_config) printf '%s' "Обновляем bootstrap-конфиг VPN-ядра…" ;;
      installing_cli) printf 'Устанавливаем CLI в %s…' "$1" ;;
      cli_installed) printf 'CLI установлен. Команда: %s <command>' "$1" ;;
      invalid_hostname) printf 'Некорректный hostname: %s' "$1" ;;
      empty_host_endpoint) printf 'Пустой хост в endpoint: %s' "$1" ;;
      paths_not_supported) printf 'Пути для этого endpoint не поддерживаются (нужен поддомен): %s' "$1" ;;
      endpoint_example) printf 'Пример: panel.%s' "$1" ;;
      invalid_path_endpoint) printf 'Некорректный путь в endpoint: %s' "$1" ;;
      skipping_dns) printf '%s' "Проверка DNS пропущена." ;;
      waiting_dns) printf 'Ожидание DNS (до %s мин, каждые %s с)…' "$1" "$2" ;;
      dns_host_ok) printf '  ✓ %s → %s' "$1" "$2" ;;
      dns_host_wait) printf '  … %s → [%s] (нужен %s) [%s/%s]' "$1" "$2" "$3" "$4" "$5" ;;
      dns_none) printf '%s' "нет" ;;
      dns_looks_good) printf '%s' "DNS в порядке." ;;
      dns_timeout) printf '%s' "DNS не успел обновиться за отведённое время." ;;
      dns_timeout_hint) printf '%s' "Исправьте A-записи и запустите установку снова, либо используйте --skip-dns." ;;
      configuring_ufw) printf '%s' "Настраиваем файрвол UFW…" ;;
      landing_missing) printf 'Шаблоны лендинга не найдены в %s; пишем минимальные заглушки.' "$1" ;;
      installing_nginx) printf '%s' "Устанавливаем Nginx + Certbot…" ;;
      requesting_cert) printf 'Запрашиваем сертификат Let'\''s Encrypt для: %s' "$1" ;;
      cert_failed_install) printf '%s' "Не удалось выпустить сертификат во время установки." ;;
      cert_failed_hint) printf '%s' "Проверьте DNS (серая тучка в Cloudflare) и что все хосты указывают на этот сервер." ;;
      nginx_tls_ready) printf 'Nginx + TLS готовы для: %s' "$1" ;;
      no_install_conf_skip) printf 'Нет %s; пропускаем обновление nginx.' "$1" ;;
      incomplete_hosts_skip) printf '%s' "Неполные хосты в install.conf; пропускаем обновление nginx." ;;
      refreshing_nginx) printf '%s' "Обновляем сайт Nginx + сертификаты…" ;;
      nginx_refreshed) printf 'Nginx обновлён для: %s' "$1" ;;
      fetching_repo) printf 'Скачиваем OverVPN (%s) в %s…' "$1" "$2" ;;
      downloading_bundle) printf 'Скачиваем deploy-бандл (%s) в %s…' "$1" "$2" ;;
      missing_install_conf) printf 'Отсутствует %s' "$1" ;;
      certbot_missing) printf '%s' "certbot не установлен." ;;
      requesting_expand_cert) printf '%s' "Запрашиваем/расширяем сертификат Let'\''s Encrypt…" ;;
      cert_failed) printf '%s' "Не удалось выпустить сертификат." ;;
      cert_failed_hint2) printf '%s' "Проверьте DNS (серая тучка в Cloudflare), порт 80 и резолв хостов." ;;
      generating_env) printf '%s' "Генерируем секреты .env…" ;;
      waiting_api_health) printf '%s' "Ждём готовности API…" ;;
      api_ready) printf '%s' "API готов." ;;
      health_timeout) printf 'Таймаут проверки здоровья. Смотрите: %s logs' "$1" ;;
      unknown_option) printf 'Неизвестный параметр: %s' "$1" ;;
      already_installed) printf 'OverVPN уже установлен в %s.' "$1" ;;
      use_update_or_uninstall) printf 'Сначала выполните '\''%s update'\'' или '\''%s uninstall'\''.' "$1" "$1" ;;
      partial_install_found) printf 'Найдена незавершённая установка в %s (прошлый запуск оборвался).' "$1" ;;
      prompt_clean_partial) printf '%s' "Снести её и начать заново?" ;;
      partial_clean_title) printf '%s' "Незавершённая установка" ;;
      partial_install_cleaning) printf '%s' "Удаляем незавершённую установку…" ;;
      partial_aborted) printf '%s' "Ок, ничего не трогаем. Чтобы снести вручную: overvpn uninstall  (или тот же one-liner с @ uninstall)." ;;
      install_failed_recover) printf '%s' "Установка оборвалась, но файлы уже есть. Не сносите сервер — просто запустите установщик снова: он предложит подчистить и продолжить." ;;
      recover_uninstall_hint) printf '%s' 'Или сразу снести: sudo bash -c "$(curl -fsSL https://raw.githubusercontent.com/Overl1te/OverVPN/master/install.sh)" @ uninstall' ;;
      invalid_port) printf 'Некорректный --port: %s' "$1" ;;
      noninteractive_start) printf '%s' "Получены неинтерактивные флаги. Начинаем установку…" ;;
      creating_owner) printf '%s' "Создаём учётную запись владельца…" ;;
      creating_default_inbounds) printf '%s' "Создаём подключения по умолчанию…" ;;
      not_installed) printf '%s' "OverVPN не установлен." ;;
      started) printf '%s' "OverVPN запущен." ;;
      stopped) printf '%s' "OverVPN остановлен." ;;
      restarted) printf '%s' "OverVPN перезапущен." ;;
      updating) printf 'Обновляем OverVPN (%s)…' "$1" ;;
      update_complete) printf '%s' "Обновление завершено." ;;
      checking_updates) printf '%s' "Проверяем наличие обновлений…" ;;
      update_available) printf 'Доступно обновление: локальный %s → remote %s' "$1" "$2" ;;
      update_up_to_date) printf '%s' "Установлена актуальная версия образов." ;;
      update_check_hint) printf '%s' "Чтобы обновить: sudo overvpn update" ;;
      update_check_no_digest) printf '%s' "Не удалось получить digest образа (часто так с локальной сборкой). Смотрите статус в панели или выполните: sudo overvpn update" ;;
      update_check_local) printf 'Локальный:  %s' "$1" ;;
      update_check_remote) printf 'В реестре:  %s' "$1" ;;
      uninstall_warn) printf '%s' "Будут удалены контейнеры OverVPN, Docker-образы стека, /opt/overvpn, сайт nginx и CLI." ;;
      uninstall_title) printf '%s' "Удаление OverVPN" ;;
      prompt_wipe_volumes) printf '%s' "Удалить Docker volumes (БД/данные)?" ;;
      prompt_purge_certs) printf '%s' "Удалить сертификаты Let'\''s Encrypt для panel/sub/vpn?" ;;
      prompt_purge_nginx) printf '%s' "Удалить пакеты Nginx + Certbot из системы?" ;;
      removing_nginx_pkgs) printf '%s' "Удаляем пакеты Nginx и Certbot…" ;;
      nginx_pkgs_removed) printf '%s' "Пакеты Nginx и Certbot удалены." ;;
      fully_removed) printf '%s' "OverVPN полностью удалён." ;;
      nginx_left_installed) printf '%s' "Пакеты Nginx/Certbot оставлены (могут использоваться другими сайтами)." ;;
      nginx_remove_hint) printf '%s' "Удалить вручную при необходимости: apt-get remove -y nginx certbot python3-certbot-nginx" ;;
      reinstall) printf '%s' "Переустановка:" ;;
      restart_to_apply) printf 'Чтобы применить: %s restart' "$1" ;;
      bootstrap_finished) printf '%s' "Bootstrap завершён (пароль взят из .env)." ;;
      synced_domains) printf '%s' "Домены синхронизированы из .install.conf → .env и .credentials" ;;
      provide_base_domain) printf '%s' "Укажите --base-domain или задайте BASE_DOMAIN в .install.conf" ;;
      domains_updated) printf 'Домены обновлены. Выполните: %s config apply' "$1" ;;
      domain_mode_not_configured_refresh) printf '%s' "Режим домена не настроен; обновлять нечего." ;;
      nginx_site_refreshed) printf '%s' "Сайт Nginx обновлён (существующие сертификаты)." ;;
      domain_mode_not_configured) printf '%s' "Режим домена не настроен." ;;
      incomplete_host_list) printf '%s' "Неполный список хостов в .install.conf" ;;
      certs_issued) printf 'Сертификаты выпущены/расширены для: %s' "$1" ;;
      config_applied) printf '%s' "Конфигурация применена (sync + nginx + certs + containers)." ;;
      unknown_config_command) printf 'Неизвестная команда config: %s' "$1" ;;
      config_usage) printf 'Использование: %s config show|sync|set-domain|nginx|certs|apply' "$1" ;;
      unknown_command) printf 'Неизвестная команда: %s' "$1" ;;
      info_install_dir) printf 'Каталог установки:  %s' "$1" ;;
      info_panel_url) printf 'URL панели:    %s' "$1" ;;
      info_sub_base) printf 'База подписок: %s' "$1" ;;
      info_vpn_host) printf 'VPN-хост:     %s' "$1" ;;
      info_admin_user) printf 'Админ:        %s' "$1" ;;
      info_password) printf 'Пароль:       %s' "$1" ;;
      *) printf '%s' "$key" ;;
    esac
  else
    case "$key" in
      must_be_root) printf '%s' "This command must be run as root (use sudo)." ;;
      wizard_title) printf '%s' "Setup wizard" ;;
      wizard_subtitle) printf '%s' "Single-node panel · install" ;;
      menu_subtitle) printf '%s' "Single-node panel · manage" ;;
      server_ip) printf 'Server IP: %s' "$1" ;;
      answer_all) printf '%s' "Answer everything now — after that install runs unattended." ;;
      depth_title) printf '%s' "Setup depth" ;;
      depth_simple) printf '%s' "Simple (all protocols, recommended ports)" ;;
      depth_detailed) printf '%s' "Detailed (protocols, ports, cores)" ;;
      protocols_title) printf '%s' "Protocols" ;;
      protocols_hint) printf '%s' "Select at least one protocol. Prompts are grouped by core." ;;
      select_protocol) printf 'Enable %s?' "$1" ;;
      no_protocols) printf '%s' "At least one protocol must be selected." ;;
      port_preset_title) printf '%s' "Port preset" ;;
      port_standard) printf '%s' "Standard ports" ;;
      port_stealth) printf '%s' "Stealth high ports" ;;
      prompt_protocol_port) printf '%s port' "$1" ;;
      prompt_default_inbounds) printf '%s' "Create default inbounds?" ;;
      prompt_ufw) printf '%s' "Configure UFW?" ;;
      summary_depth) printf 'Setup:        %s' "$1" ;;
      summary_protocols) printf 'Protocols:    %s' "$1" ;;
      summary_cores) printf 'Cores:        %s' "$1" ;;
      summary_ports) printf 'Ports:        %s' "$1" ;;
      summary_defaults) printf 'Default inbounds: %s' "$1" ;;
      leave_empty_ip) printf 'IP mode: http://%s:%s (no TLS).' "$1" "$2" ;;
      non_interactive_no_domain) printf '%s' "Non-interactive mode: installing without domain." ;;
      prompt_base_domain) printf '%s' "Base domain (e.g. example.com)" ;;
      mode_ip_only) printf '%s' "Mode: IP-only (no TLS)." ;;
      prompt_panel_host) printf 'Panel host' ;;
      prompt_sub_host) printf 'Subscription host or host/path' ;;
      prompt_vpn_host) printf 'VPN public host' ;;
      prompt_email) printf 'Let'\''s Encrypt email' ;;
      summary_title) printf '%s' "Summary" ;;
      summary_site) printf 'Site:         https://%s' "$1" ;;
      summary_panel) printf 'Panel:        https://%s' "$1" ;;
      summary_sub) printf 'Subscription: https://%s/api/sub/{TOKEN}' "$1" ;;
      summary_sub_path) printf 'Subscription: https://%s%s/{TOKEN}' "$1" "$2" ;;
      summary_vpn) printf 'VPN host:     %s' "$1" ;;
      summary_email) printf 'Email:        %s' "$1" ;;
      summary_mode_ip) printf 'Mode:         IP-only (port %s)' "$1" ;;
      summary_mtproxy_on) printf '%s' "MTProxy:      yes (Telemt)" ;;
      summary_mtproxy_off) printf '%s' "MTProxy:      no" ;;
      mtproxy_screen_title) printf '%s' "MTProxy (Telemt)" ;;
      mtproxy_screen_hint) printf '%s' "Optional Telegram MTProxy via Telemt (ports 10001–10016)." ;;
      mtproxy_opt_yes) printf '%s' "Install MTProxy" ;;
      mtproxy_opt_no) printf '%s' "Skip MTProxy" ;;
      prompt_mtproxy) printf '%s' "Install MTProxy (Telemt)?" ;;
      dns_title) printf '%s' "DNS A records" ;;
      dns_hint) printf 'At your DNS provider → A records → %s' "$1" ;;
      dns_point) printf '%s  →  %s' "$1" "$2" ;;
      dns_cloudflare) printf '%s' "Cloudflare: grey cloud (DNS only) until certs are issued." ;;
      dns_firewall) printf '%s' "Also open UDP/443 and TCP 80/443 on the firewall." ;;
      dns_prompt_hint) printf '%s' "If records are already created — choose verify. Skipping usually breaks TLS." ;;
      prompt_dns_ready) printf '%s' "Check DNS now?" ;;
      dns_skip) printf '%s' "DNS check skipped. If records do not point here yet, certificate issuance will fail." ;;
      dns_wait_ok) printf '%s' "OK — verifying DNS now…" ;;
      prompt_start_now) printf '%s' "Start installation?" ;;
      aborted) printf '%s' "Aborted." ;;
      no_more_prompts) printf '%s' "No more prompts. You can go drink tea." ;;
      ensuring_utf8_locale) printf '%s' "Ensuring UTF-8 support for Cyrillic in the terminal..." ;;
      install_success_title) printf '%s' "Install complete" ;;
      install_success_site) printf 'Site:         https://%s' "$1" ;;
      install_success_panel) printf 'Panel:        %s' "$1" ;;
      install_success_login) printf 'Login:        %s' "$1" ;;
      install_success_password) printf 'Password:     %s' "$1" ;;
      install_success_subs) printf 'Subscriptions: %s/api/sub/{TOKEN}' "$1" ;;
      install_success_vpn) printf 'VPN host:     %s' "$1" ;;
      install_success_credentials) printf 'Credentials: %s' "$1" ;;
      install_success_manage) printf 'Menu: %s   ·   CLI: %s status | logs | update' "$1" "$1" ;;
      ui_press_enter) printf '%s' "Press Enter to continue…" ;;
      ui_choice_label) printf '%s' "Choice" ;;
      ui_nav_hint) printf '%s' "↑/↓ navigate · Enter select" ;;
      opt_yes) printf '%s' "Yes" ;;
      opt_no) printf '%s' "No" ;;
      lang_screen_title) printf '%s' "Language / Язык" ;;
      lang_opt_en) printf '%s' "English" ;;
      lang_opt_ru) printf '%s' "Русский" ;;
      mode_screen_title) printf '%s' "Install mode" ;;
      mode_opt_domain) printf '%s' "With domain (Nginx + Let'\''s Encrypt TLS)" ;;
      mode_opt_ip) printf 'IP-only — http://%s:%s (no TLS)' "$1" "$2" ;;
      hosts_screen_title) printf '%s' "Domains and email" ;;
      hosts_base_hint) printf '%s' "Base domain for landing page and TLS" ;;
      confirm_screen_title) printf '%s' "Confirm" ;;
      confirm_opt_yes) printf '%s' "Start installation" ;;
      confirm_opt_no) printf '%s' "Cancel" ;;
      dns_opt_check) printf '%s' "Verify DNS and continue" ;;
      dns_opt_skip) printf '%s' "Skip DNS verification" ;;
      menu_title) printf '%s' "Main menu" ;;
      menu_status) printf '%s' "Container status" ;;
      menu_info) printf '%s' "Info / URL / login" ;;
      menu_logs) printf '%s' "Logs" ;;
      menu_restart) printf '%s' "Restart" ;;
      menu_update) printf '%s' "Update / check" ;;
      menu_edit) printf '%s' "Edit .env" ;;
      menu_nginx) printf '%s' "Refresh Nginx / certificates" ;;
      menu_cores) printf '%s' "Manage VPN cores" ;;
      menu_uninstall) printf '%s' "Uninstall OverVPN" ;;
      menu_exit) printf '%s' "Exit" ;;
      menu_update_check) printf '%s' "Check for updates only" ;;
      menu_update_apply) printf '%s' "Update now" ;;
      menu_update_back) printf '%s' "Back" ;;
      menu_not_installed_hint) printf '%s' "OverVPN is not installed yet. Run: overvpn install" ;;
      menu_logs_hint) printf '%s' "Logs (Ctrl+C to return). Empty service = all:" ;;
      unsupported_os) printf '%s' "Unsupported OS: /etc/os-release not found." ;;
      os_warning) printf 'Warning: tested on Ubuntu/Debian. Detected: %s.' "$1" ;;
      installing_packages) printf '%s' "Installing required packages..." ;;
      docker_already) printf '%s' "Docker and Compose already installed." ;;
      installing_docker) printf '%s' "Installing Docker Engine + Compose..." ;;
      docker_compose_missing) printf '%s' "docker compose plugin is missing after Docker install." ;;
      docker_installed) printf '%s' "Docker installed." ;;
      building_images) printf '%s' "Building images locally (this can take several minutes)..." ;;
      pulling_images) printf '%s' "Pulling images from GHCR..." ;;
      starting_containers) printf '%s' "Starting containers..." ;;
      checking_api_image) printf '%s' "Checking that the API image includes Xray..." ;;
      api_image_missing_xray) printf 'Image %s is missing Xray (need a fresh GHCR publish or a local build).\nRetry with: sudo overvpn install --build\nOr wait for CI publish, then: sudo overvpn update' "$1" ;;
      checking_mtproxy_image) printf '%s' "Checking that the MTProxy image includes Telemt..." ;;
      mtproxy_image_missing) printf 'Image %s is missing Telemt.\nRetry with: sudo overvpn install --build' "$1" ;;
      building_mtproxy_image) printf '%s' "Building MTProxy (Telemt) image..." ;;
      refreshing_core_config) printf '%s' "Refreshing VPN core bootstrap config..." ;;
      installing_cli) printf 'Installing CLI to %s...' "$1" ;;
      cli_installed) printf 'CLI installed. Use: %s <command>' "$1" ;;
      invalid_hostname) printf 'Invalid hostname: %s' "$1" ;;
      empty_host_endpoint) printf 'Empty host in endpoint: %s' "$1" ;;
      paths_not_supported) printf 'Paths are not supported for this endpoint (use a subdomain): %s' "$1" ;;
      endpoint_example) printf 'Example: panel.%s' "$1" ;;
      invalid_path_endpoint) printf 'Invalid path in endpoint: %s' "$1" ;;
      skipping_dns) printf '%s' "Skipping DNS verification." ;;
      waiting_dns) printf 'Waiting for DNS (up to %s min, every %s s)…' "$1" "$2" ;;
      dns_host_ok) printf '  ✓ %s → %s' "$1" "$2" ;;
      dns_host_wait) printf '  … %s → [%s] (want %s) [%s/%s]' "$1" "$2" "$3" "$4" "$5" ;;
      dns_none) printf '%s' "none" ;;
      dns_looks_good) printf '%s' "DNS looks good." ;;
      dns_timeout) printf '%s' "DNS did not propagate in time." ;;
      dns_timeout_hint) printf '%s' "Fix A-records and re-run install, or use --skip-dns." ;;
      configuring_ufw) printf '%s' "Configuring UFW firewall..." ;;
      landing_missing) printf 'Landing templates missing at %s; writing minimal stubs.' "$1" ;;
      installing_nginx) printf '%s' "Installing Nginx + Certbot..." ;;
      requesting_cert) printf 'Requesting Let'\''s Encrypt certificate for: %s' "$1" ;;
      cert_failed_install) printf '%s' "Certificate issuance failed during install." ;;
      cert_failed_hint) printf '%s' "Check DNS (grey cloud on Cloudflare) and that all hosts resolve to this server." ;;
      nginx_tls_ready) printf 'Nginx + TLS ready for: %s' "$1" ;;
      no_install_conf_skip) printf 'No %s; skip nginx refresh.' "$1" ;;
      incomplete_hosts_skip) printf '%s' "Incomplete install.conf hosts; skip nginx refresh." ;;
      refreshing_nginx) printf '%s' "Refreshing Nginx site + certificates..." ;;
      nginx_refreshed) printf 'Nginx refreshed for: %s' "$1" ;;
      fetching_repo) printf 'Fetching OverVPN (%s) into %s...' "$1" "$2" ;;
      downloading_bundle) printf 'Downloading deploy bundle (%s) into %s...' "$1" "$2" ;;
      missing_install_conf) printf 'Missing %s' "$1" ;;
      certbot_missing) printf '%s' "certbot is not installed." ;;
      requesting_expand_cert) printf '%s' "Requesting/expanding Let'\''s Encrypt certificate..." ;;
      cert_failed) printf '%s' "Certificate issuance failed." ;;
      cert_failed_hint2) printf '%s' "Check DNS (grey cloud on Cloudflare), port 80, and host resolution." ;;
      generating_env) printf '%s' "Generating .env secrets..." ;;
      waiting_api_health) printf '%s' "Waiting for API health..." ;;
      api_ready) printf '%s' "API is ready." ;;
      health_timeout) printf 'Health check timed out. Check: %s logs' "$1" ;;
      unknown_option) printf 'Unknown option: %s' "$1" ;;
      already_installed) printf 'OverVPN already installed in %s.' "$1" ;;
      use_update_or_uninstall) printf 'Use '\''%s update'\'' or '\''%s uninstall'\'' first.' "$1" "$1" ;;
      partial_install_found) printf 'Found an incomplete install in %s (previous run aborted).' "$1" ;;
      prompt_clean_partial) printf '%s' "Wipe it and start fresh?" ;;
      partial_clean_title) printf '%s' "Incomplete install" ;;
      partial_install_cleaning) printf '%s' "Removing incomplete install..." ;;
      partial_aborted) printf '%s' "Left as-is. To remove manually: overvpn uninstall  (or the same one-liner with @ uninstall)." ;;
      install_failed_recover) printf '%s' "Install aborted, but files already exist. Do not wipe the server — re-run the installer; it will offer to clean up and continue." ;;
      recover_uninstall_hint) printf '%s' 'Or wipe now: sudo bash -c "$(curl -fsSL https://raw.githubusercontent.com/Overl1te/OverVPN/master/install.sh)" @ uninstall' ;;
      invalid_port) printf 'Invalid --port: %s' "$1" ;;
      noninteractive_start) printf '%s' "Non-interactive flags received. Starting install…" ;;
      creating_owner) printf '%s' "Creating owner account..." ;;
      creating_default_inbounds) printf '%s' "Creating default inbounds..." ;;
      not_installed) printf '%s' "OverVPN is not installed." ;;
      started) printf '%s' "OverVPN started." ;;
      stopped) printf '%s' "OverVPN stopped." ;;
      restarted) printf '%s' "OverVPN restarted." ;;
      updating) printf 'Updating OverVPN (%s)...' "$1" ;;
      update_complete) printf '%s' "Update complete." ;;
      checking_updates) printf '%s' "Checking for updates..." ;;
      update_available) printf 'Update available: local %s → remote %s' "$1" "$2" ;;
      update_up_to_date) printf '%s' "Images are up to date." ;;
      update_check_hint) printf '%s' "To apply: sudo overvpn update" ;;
      update_check_no_digest) printf '%s' "Could not resolve image digests (common with local --build). Check the panel or run: sudo overvpn update" ;;
      update_check_local) printf 'Local:   %s' "$1" ;;
      update_check_remote) printf 'Remote:  %s' "$1" ;;
      uninstall_warn) printf '%s' "This removes OverVPN containers, stack Docker images, /opt/overvpn, nginx site, and CLI." ;;
      uninstall_title) printf '%s' "Uninstall OverVPN" ;;
      prompt_wipe_volumes) printf '%s' "Delete Docker volumes (DB/data)?" ;;
      prompt_purge_certs) printf '%s' "Delete Let'\''s Encrypt certs for panel/sub/vpn hosts?" ;;
      prompt_purge_nginx) printf '%s' "Remove Nginx + Certbot packages from the system?" ;;
      removing_nginx_pkgs) printf '%s' "Removing Nginx and Certbot packages..." ;;
      nginx_pkgs_removed) printf '%s' "Nginx and Certbot packages removed." ;;
      fully_removed) printf '%s' "OverVPN fully removed." ;;
      nginx_left_installed) printf '%s' "Nginx/Certbot packages were left installed (shared with other sites)." ;;
      nginx_remove_hint) printf '%s' "Remove manually if needed: apt-get remove -y nginx certbot python3-certbot-nginx" ;;
      reinstall) printf '%s' "Reinstall:" ;;
      restart_to_apply) printf 'Restart to apply: %s restart' "$1" ;;
      bootstrap_finished) printf '%s' "Bootstrap finished (password taken from .env)." ;;
      synced_domains) printf '%s' "Synced domains from .install.conf → .env and .credentials" ;;
      provide_base_domain) printf '%s' "Provide --base-domain or set BASE_DOMAIN in .install.conf" ;;
      domains_updated) printf 'Domains updated. Run: %s config apply' "$1" ;;
      domain_mode_not_configured_refresh) printf '%s' "Domain mode is not configured; nothing to refresh." ;;
      nginx_site_refreshed) printf '%s' "Nginx site refreshed (existing certificates)." ;;
      domain_mode_not_configured) printf '%s' "Domain mode is not configured." ;;
      incomplete_host_list) printf '%s' "Incomplete host list in .install.conf" ;;
      certs_issued) printf 'Certificates issued/expanded for: %s' "$1" ;;
      config_applied) printf '%s' "Configuration applied (sync + nginx + certs + containers)." ;;
      unknown_config_command) printf 'Unknown config command: %s' "$1" ;;
      config_usage) printf 'Use: %s config show|sync|set-domain|nginx|certs|apply' "$1" ;;
      unknown_command) printf 'Unknown command: %s' "$1" ;;
      info_install_dir) printf 'Install dir:  %s' "$1" ;;
      info_panel_url) printf 'Panel URL:    %s' "$1" ;;
      info_sub_base) printf 'Sub base:     %s' "$1" ;;
      info_vpn_host) printf 'VPN host:     %s' "$1" ;;
      info_admin_user) printf 'Admin user:   %s' "$1" ;;
      info_password) printf 'Password:     %s' "$1" ;;
      *) printf '%s' "$key" ;;
    esac
  fi
}

prompt_wizard_language() {
  if [[ ! -t 0 ]]; then
    return
  fi
  local choice
  _prompt_wizard_language_header() {
    local w
    w="$(tui_term_width)"
    show_banner "$(cli_t wizard_subtitle)"
    draw_box_top "$w"
    draw_box_center "${TUI_BOLD}$(cli_t lang_screen_title)${TUI_NC}" "$w"
    draw_box_sep "$w"
    draw_box_empty "$w"
  }
  UI_MENU_HEADER=_prompt_wizard_language_header
  ui_select_menu 0 "en|$(cli_t lang_opt_en)" "ru|$(cli_t lang_opt_ru)"
  choice="$UI_SELECT_RESULT"
  unset UI_MENU_HEADER
  case "$choice" in
    ru)
      CLI_LANG=ru
      apply_cli_lang
      ;;
    *)
      CLI_LANG=en
      ;;
  esac
}

protocol_engine() {
  case "$1" in
    HYSTERIA2|VLESS_REALITY|TROJAN|SHADOWSOCKS|WIREGUARD) printf 'singbox' ;;
    VLESS_XHTTP_TLS|VLESS_GRPC_TLS|VLESS_TCP_TLS|TROJAN_TLS|SHADOWSOCKS_XRAY|WIREGUARD_XRAY) printf 'xray' ;;
    MTPROXY) printf 'mtproxy' ;;
    *) return 1 ;;
  esac
}

protocol_port_var() {
  case "$1" in
    HYSTERIA2) printf 'CFG_SING_BOX_UDP_PORT' ;;
    VLESS_REALITY) printf 'CFG_SING_BOX_TCP_PORT' ;;
    TROJAN) printf 'CFG_SING_BOX_TROJAN_PORT' ;;
    SHADOWSOCKS) printf 'CFG_SING_BOX_SS_PORT' ;;
    WIREGUARD) printf 'CFG_SING_BOX_WG_PORT' ;;
    VLESS_XHTTP_TLS) printf 'CFG_XRAY_LISTEN_PORT' ;;
    VLESS_GRPC_TLS) printf 'CFG_XRAY_GRPC_PORT' ;;
    VLESS_TCP_TLS) printf 'CFG_XRAY_TCP_TLS_PORT' ;;
    TROJAN_TLS) printf 'CFG_XRAY_TROJAN_PORT' ;;
    SHADOWSOCKS_XRAY) printf 'CFG_XRAY_SS_PORT' ;;
    WIREGUARD_XRAY) printf 'CFG_XRAY_WG_PORT' ;;
    MTPROXY) printf 'CFG_MTPROXY_PORT_MIN' ;;
    *) return 1 ;;
  esac
}

protocol_default_port() {
  local protocol=$1 preset=${2:-standard}
  if [[ "$preset" == "stealth" ]]; then
    case "$protocol" in
      HYSTERIA2) printf '34443' ;; VLESS_REALITY) printf '34444' ;;
      TROJAN) printf '34445' ;; SHADOWSOCKS) printf '34446' ;;
      WIREGUARD) printf '38443' ;; VLESS_XHTTP_TLS) printf '35443' ;;
      VLESS_GRPC_TLS) printf '35444' ;; VLESS_TCP_TLS) printf '35445' ;;
      TROJAN_TLS) printf '35446' ;; SHADOWSOCKS_XRAY) printf '35447' ;;
      WIREGUARD_XRAY) printf '39443' ;; MTPROXY) printf '36001' ;;
    esac
  else
    case "$protocol" in
      HYSTERIA2) printf '443' ;; VLESS_REALITY) printf '4443' ;;
      TROJAN) printf '8444' ;; SHADOWSOCKS) printf '8445' ;;
      WIREGUARD) printf '51820' ;; VLESS_XHTTP_TLS) printf '8443' ;;
      VLESS_GRPC_TLS) printf '8446' ;; VLESS_TCP_TLS) printf '8447' ;;
      TROJAN_TLS) printf '8448' ;; SHADOWSOCKS_XRAY) printf '8449' ;;
      WIREGUARD_XRAY) printf '51821' ;; MTPROXY) printf '10001' ;;
    esac
  fi
}

validate_protocol() {
  local wanted="${1^^}" protocol
  IFS=',' read -ra _protocols <<<"$ALL_PROTOCOLS"
  for protocol in "${_protocols[@]}"; do
    [[ "$wanted" == "$protocol" ]] && { printf '%s' "$protocol"; return 0; }
  done
  return 1
}

normalize_protocol_list() {
  local raw=$1 item normalized="" valid
  IFS=',' read -ra _requested <<<"$raw"
  for item in "${_requested[@]}"; do
    item="$(printf '%s' "$item" | tr -d '[:space:]')"
    [[ -z "$item" ]] && continue
    valid="$(validate_protocol "$item" 2>/dev/null || true)"
    if [[ -z "$valid" ]]; then
      colorized_echo red "Unknown protocol: $item" >&2
      exit 1
    fi
    [[ ",$normalized," == *",$valid,"* ]] || normalized="${normalized:+${normalized},}${valid}"
  done
  printf '%s' "$normalized"
}

derive_enabled_cores() {
  local protocol core cores=""
  IFS=',' read -ra _selected <<<"${CFG_ENABLED_PROTOCOLS:-}"
  for protocol in "${_selected[@]}"; do
    core="$(protocol_engine "$protocol")"
    [[ ",$cores," == *",$core,"* ]] || cores="${cores:+${cores},}${core}"
  done
  CFG_ENABLED_CORES="$cores"
  CFG_SING_BOX_ENABLED="false"
  CFG_XRAY_ENABLED="false"
  CFG_MTPROXY_ENABLED="false"
  [[ ",$cores," == *,singbox,* ]] && CFG_SING_BOX_ENABLED="true"
  [[ ",$cores," == *,xray,* ]] && CFG_XRAY_ENABLED="true"
  [[ ",$cores," == *,mtproxy,* ]] && CFG_MTPROXY_ENABLED="true"
}

set_protocol_port() {
  local protocol=$1 value=$2 var
  if [[ ! "$value" =~ ^[0-9]+$ ]] || ((value < 1 || value > 65535)); then
    colorized_echo red "$(cli_t invalid_port "$value")"
    exit 1
  fi
  var="$(protocol_port_var "$protocol")"
  printf -v "$var" '%s' "$value"
  if [[ "$protocol" == "MTPROXY" ]]; then
    CFG_MTPROXY_PORT_MAX="$((value + 15))"
    if ((CFG_MTPROXY_PORT_MAX > 65535)); then
      colorized_echo red "$(cli_t invalid_port "$value")"
      exit 1
    fi
  fi
}

initialize_protocol_config() {
  local protocol var
  CFG_INSTALL_DEPTH="${CFG_INSTALL_DEPTH:-simple}"
  CFG_CREATE_DEFAULT_INBOUNDS="${CFG_CREATE_DEFAULT_INBOUNDS:-true}"
  CFG_ENABLED_PROTOCOLS="${CFG_ENABLED_PROTOCOLS:-$ALL_PROTOCOLS}"
  for protocol in ${ALL_PROTOCOLS//,/ }; do
    var="$(protocol_port_var "$protocol")"
    if [[ -z "${!var:-}" ]]; then
      printf -v "$var" '%s' "$(protocol_default_port "$protocol" standard)"
    fi
  done
  CFG_MTPROXY_PORT_MAX="${CFG_MTPROXY_PORT_MAX:-10016}"
  derive_enabled_cores
}

protocols_for_cores() {
  local raw=$1 core result=""
  IFS=',' read -ra _cores <<<"${raw,,}"
  for core in "${_cores[@]}"; do
    core="$(printf '%s' "$core" | tr -d '[:space:]')"
    case "$core" in
      singbox) result="${result:+${result},}${SINGBOX_PROTOCOLS}" ;;
      xray) result="${result:+${result},}${XRAY_PROTOCOLS}" ;;
      mtproxy) result="${result:+${result},}MTPROXY" ;;
      *) colorized_echo red "Unknown core: $core" >&2; exit 1 ;;
    esac
  done
  printf '%s' "$result"
}

apply_port_overrides() {
  local raw=$1 pair key value protocol
  IFS=',' read -ra _ports <<<"$raw"
  for pair in "${_ports[@]}"; do
    if [[ "$pair" != *=* ]]; then
      colorized_echo red "Invalid --ports entry: $pair (expected PROTOCOL=PORT)"
      exit 1
    fi
    key="${pair%%=*}"
    value="${pair#*=}"
    protocol="$(validate_protocol "$key" 2>/dev/null || true)"
    if [[ -z "$protocol" ]]; then
      colorized_echo red "Unknown protocol port key: $key"
      exit 1
    fi
    set_protocol_port "$protocol" "$value"
  done
}

prompt_install_depth() {
  [[ "${CFG_DEPTH_SKIP_PROMPT:-false}" == "true" ]] && return
  UI_MENU_HEADER=""
  ui_select_menu 0 \
    "simple|$(cli_t depth_simple)" \
    "detailed|$(cli_t depth_detailed)"
  CFG_INSTALL_DEPTH="$UI_SELECT_RESULT"
}

prompt_detailed_protocols() {
  local protocol selected="" heading
  for heading in "SING_BOX:${SINGBOX_PROTOCOLS}" "XRAY:${XRAY_PROTOCOLS}" "MTPROXY:MTPROXY"; do
    colorized_echo cyan "${heading%%:*}"
    IFS=',' read -ra _group <<<"${heading#*:}"
    for protocol in "${_group[@]}"; do
      if ui_confirm y "$(cli_t select_protocol "${heading%%:*} / $protocol") — $(cli_t opt_yes)" "$(cli_t opt_no)"; then
        selected="${selected:+${selected},}${protocol}"
      fi
    done
  done
  if [[ -z "$selected" ]]; then
    colorized_echo red "$(cli_t no_protocols)"
    prompt_detailed_protocols
    return
  fi
  CFG_ENABLED_PROTOCOLS="$selected"
  derive_enabled_cores
}

prompt_detailed_ports() {
  local protocol var value
  ui_select_menu 0 \
    "standard|$(cli_t port_standard)" \
    "stealth|$(cli_t port_stealth)"
  CFG_PORT_PRESET="$UI_SELECT_RESULT"
  IFS=',' read -ra _selected <<<"$CFG_ENABLED_PROTOCOLS"
  for protocol in "${_selected[@]}"; do
    var="$(protocol_port_var "$protocol")"
    value="$(ui_prompt "$(cli_t prompt_protocol_port "$protocol")" "$(protocol_default_port "$protocol" "$CFG_PORT_PRESET")")"
    set_protocol_port "$protocol" "$value"
  done
  if ui_confirm y "$(cli_t prompt_default_inbounds) — $(cli_t opt_yes)" "$(cli_t opt_no)"; then
    CFG_CREATE_DEFAULT_INBOUNDS="true"
  else
    CFG_CREATE_DEFAULT_INBOUNDS="false"
  fi
  if [[ "${CFG_UFW_DECIDED:-false}" != "true" ]]; then
    if ui_confirm y "$(cli_t prompt_ufw) — $(cli_t opt_yes)" "$(cli_t opt_no)"; then
      CFG_USE_UFW="true"
    else
      CFG_USE_UFW="false"
    fi
    CFG_UFW_DECIDED="true"
  fi
}

prompt_detailed_install() {
  if [[ "${CFG_DETAILED_SKIP_PROMPTS:-false}" == "true" ]]; then
    return
  fi
  prompt_detailed_protocols
  prompt_detailed_ports
}

prompt_install_mode() {
  local ip=$1
  local choice
  _prompt_install_mode_header() {
    local w
    w="$(tui_term_width)"
    show_banner "$(cli_t wizard_subtitle)"
    draw_box_top "$w"
    draw_box_center "${TUI_BOLD}$(cli_t mode_screen_title)${TUI_NC}" "$w"
    draw_box_sep "$w"
    draw_box_line " $(cli_t server_ip "$ip")" "$w"
    draw_box_line " $(cli_t answer_all)" "$w"
    draw_box_sep "$w"
    draw_box_empty "$w"
  }
  UI_MENU_HEADER=_prompt_install_mode_header
  ui_select_menu 0 \
    "domain|$(cli_t mode_opt_domain)" \
    "ip|$(cli_t mode_opt_ip "$ip" "$DEFAULT_WEB_PORT")"
  choice="$UI_SELECT_RESULT"
  unset UI_MENU_HEADER
  case "$choice" in
    ip) CFG_MODE="ip" ;;
    *) CFG_MODE="domain" ;;
  esac
}

prompt_install_hosts() {
  local base=$1
  local w panel sub vpn email
  w="$(tui_term_width)"
  clear_screen
  show_banner "$(cli_t wizard_subtitle)"
  draw_box_top "$w"
  draw_box_center "${TUI_BOLD}$(cli_t hosts_screen_title)${TUI_NC}" "$w"
  draw_box_sep "$w"
  draw_box_line " $(cli_t summary_site "$base")" "$w"
  draw_box_empty "$w"
  draw_box_bottom "$w"
  echo

  panel="$(ui_prompt "$(cli_t prompt_panel_host)" "panel.${base}")"
  panel="$(printf '%s' "$panel" | tr -d '[:space:]')"
  parse_endpoint "$panel" false
  CFG_PANEL_HOST="$PARSE_HOST"

  sub="$(ui_prompt "$(cli_t prompt_sub_host)" "sub.${base}")"
  sub="$(printf '%s' "$sub" | tr -d '[:space:]')"
  parse_endpoint "$sub" true
  CFG_SUB_HOST="$PARSE_HOST"
  CFG_SUB_PATH="$PARSE_PATH"

  vpn="$(ui_prompt "$(cli_t prompt_vpn_host)" "vpn.${base}")"
  vpn="$(printf '%s' "$vpn" | tr -d '[:space:]')"
  parse_endpoint "$vpn" false
  CFG_VPN_HOST="$PARSE_HOST"

  email="$(ui_prompt "$(cli_t prompt_email)" "admin@${base}")"
  CFG_EMAIL="$(printf '%s' "$email" | tr -d '[:space:]')"
}

prompt_install_dns_screen() {
  local ip=$1
  shift
  local hosts=("$@")
  local choice host
  _prompt_install_dns_header() {
    local w host
    w="$(tui_term_width)"
    show_banner "$(cli_t wizard_subtitle)"
    draw_box_top "$w"
    draw_box_center "${TUI_BOLD}$(cli_t dns_title)${TUI_NC}" "$w"
    draw_box_sep "$w"
    draw_box_line " $(cli_t dns_hint "$ip")" "$w"
    draw_box_empty "$w"
    for host in "${hosts[@]}"; do
      draw_box_line " $(cli_t dns_point "$host" "$ip")" "$w"
    done
    draw_box_empty "$w"
    draw_box_line " $(cli_t dns_cloudflare)" "$w"
    draw_box_line " $(cli_t dns_firewall)" "$w"
    draw_box_sep "$w"
    draw_box_line " $(cli_t dns_prompt_hint)" "$w"
    draw_box_empty "$w"
  }
  UI_MENU_HEADER=_prompt_install_dns_header
  ui_select_menu 0 \
    "check|$(cli_t dns_opt_check)" \
    "skip|$(cli_t dns_opt_skip)"
  choice="$UI_SELECT_RESULT"
  unset UI_MENU_HEADER
  case "$choice" in
    skip)
      CFG_SKIP_DNS="true"
      CFG_DNS_HANDLED="true"
      colorized_echo yellow "$(cli_t dns_skip)"
      sleep 1
      ;;
    *)
      CFG_SKIP_DNS="false"
      colorized_echo green "$(cli_t dns_wait_ok)"
      echo
      wait_for_dns "$ip" "${hosts[@]}"
      CFG_DNS_HANDLED="true"
      sleep 1
      ;;
  esac
}

sync_simple_protocol_config() {
  CFG_ENABLED_PROTOCOLS="${SINGBOX_PROTOCOLS},${XRAY_PROTOCOLS}"
  if [[ "${CFG_MTPROXY_ENABLED:-true}" == "true" ]]; then
    CFG_ENABLED_PROTOCOLS+=",MTPROXY"
  fi
  derive_enabled_cores
}

selected_ports_summary() {
  local protocol var result=""
  IFS=',' read -ra _selected <<<"${CFG_ENABLED_PROTOCOLS:-}"
  for protocol in "${_selected[@]}"; do
    var="$(protocol_port_var "$protocol")"
    result+="${result:+, }${protocol}=${!var}"
  done
  printf '%s' "$result"
}

prompt_install_confirm() {
  local ip=$1
  local choice
  _prompt_install_confirm_header() {
    local w
    w="$(tui_term_width)"
    show_banner "$(cli_t wizard_subtitle)"
    draw_box_top "$w"
    draw_box_center "${TUI_BOLD}$(cli_t confirm_screen_title)${TUI_NC}" "$w"
    draw_box_sep "$w"
    draw_box_line " $(cli_t server_ip "$ip")" "$w"
    if [[ "$CFG_MODE" == "domain" ]]; then
      draw_box_line " $(cli_t summary_site "$CFG_BASE_DOMAIN")" "$w"
      draw_box_line " $(cli_t summary_panel "$CFG_PANEL_HOST")" "$w"
      if [[ -n "$CFG_SUB_PATH" ]]; then
        draw_box_line " $(cli_t summary_sub_path "$CFG_SUB_HOST" "$CFG_SUB_PATH")" "$w"
      else
        draw_box_line " $(cli_t summary_sub "$CFG_SUB_HOST")" "$w"
      fi
      draw_box_line " $(cli_t summary_vpn "$CFG_VPN_HOST")" "$w"
      draw_box_line " $(cli_t summary_email "$CFG_EMAIL")" "$w"
      if [[ "$CFG_SKIP_DNS" == "true" ]]; then
        draw_box_line " DNS:          skip" "$w"
      else
        draw_box_line " DNS:          ok" "$w"
      fi
    else
      draw_box_line " $(cli_t summary_mode_ip "$DEFAULT_WEB_PORT")" "$w"
      draw_box_line " $(cli_t leave_empty_ip "$ip" "$DEFAULT_WEB_PORT")" "$w"
    fi
    draw_box_line " $(cli_t summary_depth "${CFG_INSTALL_DEPTH:-simple}")" "$w"
    draw_box_line " $(cli_t summary_cores "${CFG_ENABLED_CORES:-singbox,xray,mtproxy}")" "$w"
    if [[ "${CFG_INSTALL_DEPTH:-simple}" == "detailed" ]]; then
      local protocol var
      IFS=',' read -ra _summary_protocols <<<"$CFG_ENABLED_PROTOCOLS"
      for protocol in "${_summary_protocols[@]}"; do
        var="$(protocol_port_var "$protocol")"
        draw_box_line " ${protocol}: ${!var}" "$w"
      done
      draw_box_line " $(cli_t summary_defaults "$CFG_CREATE_DEFAULT_INBOUNDS")" "$w"
    fi
    if [[ "${CFG_MTPROXY_ENABLED:-true}" == "true" ]]; then
      draw_box_line " $(cli_t summary_mtproxy_on)" "$w"
    else
      draw_box_line " $(cli_t summary_mtproxy_off)" "$w"
    fi
    draw_box_sep "$w"
    draw_box_empty "$w"
  }
  UI_MENU_HEADER=_prompt_install_confirm_header
  ui_select_menu 0 \
    "yes|${TUI_GREEN}$(cli_t confirm_opt_yes)${TUI_NC}" \
    "no|${TUI_RED}$(cli_t confirm_opt_no)${TUI_NC}"
  choice="$UI_SELECT_RESULT"
  unset UI_MENU_HEADER
  case "$choice" in
    no)
      colorized_echo red "$(cli_t aborted)"
      exit 1
      ;;
    *)
      clear_screen
      show_banner "$(cli_t wizard_subtitle)"
      colorized_echo green "$(cli_t no_more_prompts)"
      echo
      ;;
  esac
}

prompt_install_mtproxy() {
  if [[ "${CFG_MTPROXY_SKIP_PROMPT:-}" == "true" ]]; then
    return
  fi
  local choice
  _prompt_install_mtproxy_header() {
    local w
    w="$(tui_term_width)"
    show_banner "$(cli_t wizard_subtitle)"
    draw_box_top "$w"
    draw_box_center "${TUI_BOLD}$(cli_t mtproxy_screen_title)${TUI_NC}" "$w"
    draw_box_sep "$w"
    draw_box_line " $(cli_t mtproxy_screen_hint)" "$w"
    draw_box_empty "$w"
  }
  UI_MENU_HEADER=_prompt_install_mtproxy_header
  ui_select_menu 0 \
    "yes|$(cli_t mtproxy_opt_yes)" \
    "no|$(cli_t mtproxy_opt_no)"
  choice="$UI_SELECT_RESULT"
  unset UI_MENU_HEADER
  case "$choice" in
    no) CFG_MTPROXY_ENABLED="false" ;;
    *) CFG_MTPROXY_ENABLED="true" ;;
  esac
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
  CFG_DNS_HANDLED="false"
  CFG_MTPROXY_ENABLED="${CFG_MTPROXY_ENABLED:-true}"

  prompt_wizard_language
  initialize_protocol_config

  if [[ ! -t 0 ]]; then
    colorized_echo yellow "$(cli_t non_interactive_no_domain)"
    return
  fi

  prompt_install_depth
  prompt_install_mode "$ip"

  if [[ "$CFG_MODE" == "ip" ]]; then
    colorized_echo green "$(cli_t mode_ip_only)"
    if [[ "$CFG_INSTALL_DEPTH" == "detailed" ]]; then
      prompt_detailed_install
    else
      prompt_install_mtproxy
      sync_simple_protocol_config
    fi
    prompt_install_confirm "$ip"
    return
  fi

  local w base
  w="$(tui_term_width)"
  while true; do
    clear_screen
    show_banner "$(cli_t wizard_subtitle)"
    draw_box_top "$w"
    draw_box_center "${TUI_BOLD}$(cli_t hosts_screen_title)${TUI_NC}" "$w"
    draw_box_sep "$w"
    draw_box_line " $(cli_t hosts_base_hint)" "$w"
    draw_box_line " $(cli_t server_ip "$ip")" "$w"
    draw_box_empty "$w"
    draw_box_bottom "$w"
    echo
    base="$(ui_prompt "$(cli_t prompt_base_domain)")"
    base="$(printf '%s' "$base" | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]')"
    if [[ -z "$base" ]]; then
      colorized_echo yellow "$(cli_t mode_opt_ip "$ip" "$DEFAULT_WEB_PORT")"
      sleep 1
      CFG_MODE="ip"
      if [[ "$CFG_INSTALL_DEPTH" == "detailed" ]]; then
        prompt_detailed_install
      else
        prompt_install_mtproxy
        sync_simple_protocol_config
      fi
      prompt_install_confirm "$ip"
      return
    fi
    if [[ "$base" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ ]]; then
      break
    fi
    colorized_echo red "$(cli_t invalid_hostname "$base")"
    sleep 1
  done

  CFG_BASE_DOMAIN="$base"
  CFG_MODE="domain"
  prompt_install_hosts "$base"

  local -a dns_hosts=()
  mapfile -t dns_hosts < <(unique_hosts "$CFG_BASE_DOMAIN" "$CFG_PANEL_HOST" "$CFG_SUB_HOST" "$CFG_VPN_HOST")
  prompt_install_dns_screen "$ip" "${dns_hosts[@]}"
  if [[ "$CFG_INSTALL_DEPTH" == "detailed" ]]; then
    prompt_detailed_install
  else
    prompt_install_mtproxy
    sync_simple_protocol_config
  fi
  prompt_install_confirm "$ip"
}

check_root() {
  if [[ "$(id -u)" -ne 0 ]]; then
    colorized_echo red "$(cli_t must_be_root)"
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
    colorized_echo red "$(cli_t unsupported_os)"
    exit 1
  fi

  case "$OS_ID" in
    ubuntu|debian) ;;
    *)
      if [[ "$OS_LIKE" != *debian* && "$OS_LIKE" != *ubuntu* ]]; then
        colorized_echo yellow "$(cli_t os_warning "${PRETTY_NAME:-$OS_ID}")"
      fi
      ;;
  esac
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1
}

install_packages() {
  detect_os
  colorized_echo blue "$(cli_t installing_packages)"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get install -y ca-certificates curl git openssl ufw dnsutils
}

ensure_docker() {
  if need_cmd docker && docker compose version >/dev/null 2>&1; then
    colorized_echo green "$(cli_t docker_already)"
    systemctl enable --now docker >/dev/null 2>&1 || true
    return
  fi

  colorized_echo blue "$(cli_t installing_docker)"
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
  if ! docker compose version >/dev/null 2>&1; then
    colorized_echo red "$(cli_t docker_compose_missing)"
    exit 1
  fi
  colorized_echo green "$(cli_t docker_installed)"
}

compose() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

# Remove app + dependency images pulled/built for this install.
# Safe to call when some refs are missing or still shared by other containers.
remove_overvpn_images() {
  local images=()
  local img

  if [[ -f "$ENV_FILE" ]]; then
    img="$(get_env_var API_IMAGE "$ENV_FILE" 2>/dev/null || true)"
    [[ -n "$img" ]] && images+=("$img")
    img="$(get_env_var WEB_IMAGE "$ENV_FILE" 2>/dev/null || true)"
    [[ -n "$img" ]] && images+=("$img")
    img="$(get_env_var POSTGRES_IMAGE "$ENV_FILE" 2>/dev/null || true)"
    [[ -n "$img" ]] && images+=("$img")
    img="$(get_env_var REDIS_IMAGE "$ENV_FILE" 2>/dev/null || true)"
    [[ -n "$img" ]] && images+=("$img")
    img="$(get_env_var MTPROXY_IMAGE "$ENV_FILE" 2>/dev/null || true)"
    [[ -n "$img" ]] && images+=("$img")
  fi

  images+=(
    "${GHCR_API_IMAGE}:latest"
    "${GHCR_WEB_IMAGE}:latest"
    "${GHCR_MTPROXY_IMAGE}:latest"
    "$DEFAULT_POSTGRES_IMAGE"
    "$DEFAULT_REDIS_IMAGE"
    "$BUSYBOX_IMAGE"
  )

  while IFS= read -r img; do
    [[ -n "$img" && "$img" != *":<none>" ]] && images+=("$img")
  done < <(
    docker images --format '{{.Repository}}:{{.Tag}}' 2>/dev/null \
      | grep -E '^(ghcr\.io/overl1te/overvpn-|overvpn/)' || true
  )

  printf '%s\n' "${images[@]}" | awk 'NF && !seen[$0]++' | while IFS= read -r img; do
    docker rmi -f "$img" >/dev/null 2>&1 || true
  done
}

api_image_ref() {
  local image
  image="$(get_env_var API_IMAGE "$ENV_FILE" 2>/dev/null || true)"
  if [[ -z "$image" ]]; then
    image="ghcr.io/overl1te/overvpn-api:latest"
  fi
  printf '%s\n' "$image"
}

mtproxy_image_ref() {
  local image
  image="$(get_env_var MTPROXY_IMAGE "$ENV_FILE" 2>/dev/null || true)"
  if [[ -z "$image" ]]; then
    image="${GHCR_MTPROXY_IMAGE}:latest"
  fi
  printf '%s\n' "$image"
}

mtproxy_enabled() {
  local value
  value="$(get_env_var MTPROXY_ENABLED "$ENV_FILE" 2>/dev/null || true)"
  case "${value:-true}" in
    true|1|yes|YES|True) return 0 ;;
    *) return 1 ;;
  esac
}

assert_api_image_has_xray() {
  local image=$1
  colorized_echo blue "$(cli_t checking_api_image)"
  if ! docker run --rm --entrypoint /bin/sh "$image" -c \
    'test -x /usr/local/bin/xray && test -x /usr/local/bin/xray-entrypoint && test -f "${XRAY_LOCATION_ASSET:-/usr/local/share/xray}/geoip.dat"'; then
    colorized_echo red "$(cli_t api_image_missing_xray "$image")"
    exit 1
  fi
}

assert_mtproxy_image() {
  local image=$1
  colorized_echo blue "$(cli_t checking_mtproxy_image)"
  if ! docker run --rm --entrypoint /bin/sh "$image" -c \
    'test -x /usr/local/bin/telemt && test -f /opt/overvpn-mtproxy/supervisor.py && command -v python3 >/dev/null'; then
    colorized_echo red "$(cli_t mtproxy_image_missing "$image")"
    exit 1
  fi
}

core_enabled() {
  local core=$1 key value
  case "$core" in
    singbox) key="SING_BOX_ENABLED" ;;
    xray) key="XRAY_ENABLED" ;;
    mtproxy) key="MTPROXY_ENABLED" ;;
    *) return 1 ;;
  esac
  value="$(get_env_var "$key" "$ENV_FILE" 2>/dev/null || true)"
  [[ "${value,,}" == "true" || "$value" == "1" || "${value,,}" == "yes" ]]
}

compose_up() {
  local do_build=${1:-false}
  local enable_mtproxy="false"
  if mtproxy_enabled; then
    enable_mtproxy="true"
  fi

  if [[ "$enable_mtproxy" == "true" ]]; then
    colorized_echo blue "$(cli_t building_mtproxy_image)"
    compose build core-mtproxy
    assert_mtproxy_image "$(mtproxy_image_ref)"
  fi

  if [[ "$do_build" == "true" ]]; then
    colorized_echo blue "$(cli_t building_images)"
    compose up -d --build
  else
    colorized_echo blue "$(cli_t pulling_images)"
    # Avoid failing when MTProxy GHCR image is not published yet.
    COMPOSE_PROFILES= compose pull
    if core_enabled xray; then
      assert_api_image_has_xray "$(api_image_ref)"
    fi
    colorized_echo blue "$(cli_t starting_containers)"
    compose up -d --pull missing
  fi
  # Oneshot init does not re-run on plain `up`; force it so management APIs are present.
  colorized_echo blue "$(cli_t refreshing_core_config)"
  if core_enabled singbox; then
    compose up -d --force-recreate --no-deps core-config-init
    compose up -d --force-recreate --no-deps core
  fi
  if core_enabled xray; then
    compose up -d --force-recreate --no-deps core-xray-config-init
    compose up -d --force-recreate --no-deps core-xray
  fi
  if [[ "$enable_mtproxy" == "true" ]]; then
    compose up -d --force-recreate --no-deps core-mtproxy-config-init
    compose up -d --force-recreate --no-deps core-mtproxy
  fi
}

image_repo_digest() {
  local image=$1
  docker image inspect --format '{{index .RepoDigests 0}}' "$image" 2>/dev/null \
    | sed -n 's/.*@\(sha256:[0-9a-f]*\)$/\1/p' || true
}

remote_image_digest() {
  local image=$1
  docker buildx imagetools inspect "$image" --format '{{.Manifest.Digest}}' 2>/dev/null \
    || docker manifest inspect "$image" 2>/dev/null \
      | sed -n 's/.*"digest"[[:space:]]*:[[:space:]]*"\(sha256:[0-9a-f]*\)".*/\1/p' \
      | head -n1 \
    || true
}

cmd_check_update() {
  check_root
  is_installed || { colorized_echo red "$(cli_t not_installed)"; exit 1; }

  colorized_echo blue "$(cli_t checking_updates)"
  local image local_digest remote_digest
  image="$(api_image_ref)"
  if ! docker image inspect "$image" >/dev/null 2>&1; then
    colorized_echo yellow "$(cli_t update_check_no_digest)"
    exit 0
  fi
  local_digest="$(image_repo_digest "$image")"
  remote_digest="$(remote_image_digest "$image" | tr -d '"' | tr -d '\r' | head -n1)"

  if [[ -z "$local_digest" || -z "$remote_digest" ]]; then
    colorized_echo yellow "$(cli_t update_check_no_digest)"
    [[ -n "$local_digest" ]] && colorized_echo blue "$(cli_t update_check_local "$local_digest")"
    [[ -n "$remote_digest" ]] && colorized_echo blue "$(cli_t update_check_remote "$remote_digest")"
    exit 0
  fi

  colorized_echo blue "$(cli_t update_check_local "$local_digest")"
  colorized_echo blue "$(cli_t update_check_remote "$remote_digest")"
  if [[ "$local_digest" == "$remote_digest" ]]; then
    colorized_echo green "$(cli_t update_up_to_date)"
    exit 0
  fi
  colorized_echo yellow "$(cli_t update_available "$local_digest" "$remote_digest")"
  colorized_echo yellow "$(cli_t update_check_hint)"
  exit 2
}

# Finished install (safe for up/down/update).
is_install_complete() {
  # A crashed mid-install must never look "complete".
  if [[ -f "$INSTALL_INPROGRESS_FILE" ]]; then
    return 1
  fi
  if [[ -f "$INSTALL_COMPLETE_FILE" && -f "$ENV_FILE" && -f "$COMPOSE_FILE" ]]; then
    return 0
  fi
  # Legacy installs created before install markers existed.
  if [[ -x "$BIN_PATH" && -f "$ENV_FILE" && -f "$COMPOSE_FILE" && -f "$CREDENTIALS_FILE" ]]; then
    return 0
  fi
  return 1
}

is_installed() {
  is_install_complete
}

has_partial_install() {
  if is_install_complete; then
    return 1
  fi
  [[ -d "$APP_DIR" || -e "$BIN_PATH" || -e "$NGINX_SITE" || -e "$NGINX_LINK" || -f "$INSTALL_INPROGRESS_FILE" ]]
}

mark_install_inprogress() {
  mkdir -p "$APP_DIR"
  rm -f "$INSTALL_COMPLETE_FILE"
  date -u +%Y-%m-%dT%H:%M:%SZ >"$INSTALL_INPROGRESS_FILE"
}

mark_install_complete() {
  mkdir -p "$APP_DIR"
  rm -f "$INSTALL_INPROGRESS_FILE"
  date -u +%Y-%m-%dT%H:%M:%SZ >"$INSTALL_COMPLETE_FILE"
}

cleanup_partial_install() {
  colorized_echo yellow "$(cli_t partial_install_cleaning)"
  if [[ -f "$COMPOSE_FILE" && -f "$ENV_FILE" ]]; then
    compose down -v --remove-orphans --rmi all >/dev/null 2>&1 || true
  else
    docker ps -aq --filter "name=overvpn-" 2>/dev/null | xargs -r docker rm -f || true
    docker network ls -q --filter "name=overvpn" 2>/dev/null | xargs -r docker network rm || true
    docker volume ls -q --filter "name=overvpn" 2>/dev/null | xargs -r docker volume rm || true
  fi
  remove_overvpn_images
  remove_nginx_site
  rm -rf "$APP_DIR"
  rm -f "$BIN_PATH"
}

ensure_clean_for_install() {
  if is_install_complete; then
    colorized_echo yellow "$(cli_t already_installed "$APP_DIR")"
    colorized_echo yellow "$(cli_t use_update_or_uninstall "$APP_NAME")"
    exit 1
  fi
  if ! has_partial_install; then
    return 0
  fi
  colorized_echo yellow "$(cli_t partial_install_found "$APP_DIR")"
  if [[ -t 0 ]]; then
    _ensure_clean_partial_header() {
      local w
      w="$(tui_term_width)"
      show_banner "$(cli_t wizard_subtitle)"
      draw_box_top "$w"
      draw_box_center "${TUI_BOLD}$(cli_t partial_clean_title)${TUI_NC}" "$w"
      draw_box_sep "$w"
      draw_box_line " $(cli_t partial_install_found "$APP_DIR")" "$w"
      draw_box_line " $(cli_t prompt_clean_partial)" "$w"
      draw_box_empty "$w"
    }
    UI_MENU_HEADER=_ensure_clean_partial_header
    if ! ui_confirm y; then
      unset UI_MENU_HEADER
      colorized_echo yellow "$(cli_t partial_aborted)"
      exit 1
    fi
    unset UI_MENU_HEADER
  fi
  cleanup_partial_install
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
  colorized_echo blue "$(cli_t installing_cli "$BIN_PATH")"
  if [[ -f "$source_script" ]]; then
    install -m 755 "$source_script" "$BIN_PATH"
  else
    curl -fsSL "${REPO_RAW_BASE}/${DEFAULT_BRANCH}/install.sh" -o "$BIN_PATH"
    chmod 755 "$BIN_PATH"
  fi
  colorized_echo green "$(cli_t cli_installed "$APP_NAME")"
}

validate_hostname() {
  local host=$1
  if [[ ! "$host" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ ]]; then
    colorized_echo red "$(cli_t invalid_hostname "$host")"
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
    colorized_echo red "$(cli_t empty_host_endpoint "$1")"
    exit 1
  fi
  validate_hostname "$host"

  if [[ -n "$path" && "$allow_path" != "true" ]]; then
    colorized_echo red "$(cli_t paths_not_supported "$1")"
    colorized_echo yellow "$(cli_t endpoint_example "${CFG_BASE_DOMAIN:-example.com}")"
    exit 1
  fi

  if [[ -n "$path" && ! "$path" =~ ^(/[a-z0-9._~-]+)+$ ]]; then
    colorized_echo red "$(cli_t invalid_path_endpoint "$1")"
    exit 1
  fi

  PARSE_HOST="$host"
  PARSE_PATH="$path"
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
  colorized_echo yellow "$(cli_t dns_title)"
  colorized_echo yellow "════════════════════════════════════════"
  colorized_echo yellow "$(cli_t dns_hint "$ip")"
  echo
  local host
  for host in "${hosts[@]}"; do
    printf '  %-40s A    %s\n' "$host" "$ip"
  done
  echo
  colorized_echo yellow "$(cli_t dns_cloudflare)"
  colorized_echo cyan "$(cli_t dns_firewall)"
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
    colorized_echo yellow "$(cli_t skipping_dns)"
    return 0
  fi

  colorized_echo blue "$(cli_t waiting_dns "$((tries * sleep_s / 60))" "$sleep_s")"

  for ((i = 1; i <= tries; i++)); do
    local all_ok=true
    for host in "${hosts[@]}"; do
      resolved="$(resolve_host_ips "$host" | tr '\n' ' ')"
      if printf '%s' "$resolved" | grep -qw "$ip"; then
        colorized_echo green "$(cli_t dns_host_ok "$host" "$ip")"
      else
        all_ok=false
        colorized_echo yellow "$(cli_t dns_host_wait "$host" "${resolved:-$(cli_t dns_none)}" "$ip" "$i" "$tries")"
      fi
    done

    if [[ "$all_ok" == true ]]; then
      colorized_echo green "$(cli_t dns_looks_good)"
      return 0
    fi
    sleep "$sleep_s"
  done

  colorized_echo red "$(cli_t dns_timeout)"
  colorized_echo yellow "$(cli_t dns_timeout_hint)"
  exit 1
}

configure_firewall() {
  local with_nginx=$1
  local web_port=$2

  if ! need_cmd ufw; then
    return
  fi

  colorized_echo blue "$(cli_t configuring_ufw)"
  ufw allow OpenSSH >/dev/null 2>&1 || true
  local protocol var port transport
  local enabled_protocols="${CFG_ENABLED_PROTOCOLS:-$(get_env_var ENABLED_PROTOCOLS "$INSTALL_CONF" 2>/dev/null || true)}"
  for protocol in ${enabled_protocols//,/ }; do
    var="$(protocol_port_var "$protocol" 2>/dev/null || true)"
    [[ -z "$var" ]] && continue
    port="${!var:-$(get_env_var "${var#CFG_}" "$ENV_FILE" 2>/dev/null || true)}"
    [[ -z "$port" ]] && continue
    transport="tcp"
    case "$protocol" in HYSTERIA2|WIREGUARD|WIREGUARD_XRAY) transport="udp" ;; esac
    if [[ "$protocol" == "MTPROXY" ]]; then
      ufw allow "${port}:$(get_env_var MTPROXY_PORT_MAX "$ENV_FILE")/tcp" >/dev/null 2>&1 || true
    else
      ufw allow "${port}/${transport}" >/dev/null 2>&1 || true
    fi
  done

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
  mkdir -p "$LANDING_DIR/assets"
  local src="${APP_DIR}/deploy/landing"
  if [[ -d "$src" ]]; then
    cp -f "$src/index.html" "$LANDING_DIR/index.html"
    cp -f "$src/sub.html" "$LANDING_DIR/sub.html"
    cp -f "$src/vpn.html" "$LANDING_DIR/vpn.html"
    if [[ -f "$src/assets/logo.png" ]]; then
      cp -f "$src/assets/logo.png" "$LANDING_DIR/assets/logo.png"
    fi
  else
    colorized_echo yellow "$(cli_t landing_missing "$src")"
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
  local acme_http_port
  acme_http_port="$(get_env_var SING_BOX_ACME_HTTP_PORT "$ENV_FILE" 2>/dev/null || echo 8081)"

  if [[ "$mode" == "https" ]]; then
    conf+="server {
    listen 80;
    listen [::]:80;
    server_name ${hosts[*]};
    access_log off;
    # Forward ACME HTTP-01 to sing-box (alt port when nginx owns :80).
    location ^~ /.well-known/acme-challenge/ {
        proxy_pass http://127.0.0.1:${acme_http_port};
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
    location / {
        return 301 https://\$host\$request_uri;
    }
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
    location ^~ /assets/ {
        try_files \$uri =404;
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
    root ${LANDING_DIR};
    location = / {
        try_files /sub.html =404;
    }
    location ^~ /assets/ {
        try_files \$uri =404;
    }
    location / {
        return 404;
    }
"
    else
      # VPN public host: browsers → landing. VPN clients use other ports (not Nginx :80/:443).
      if [[ -n "$base_domain" ]]; then
        conf+="
    location / {
        return 301 ${proto}://${base_domain}/;
    }
"
      else
        conf+="
    root ${LANDING_DIR};
    location = / {
        try_files /vpn.html =404;
    }
    location ^~ /assets/ {
        try_files \$uri =404;
    }
    location / {
        return 404;
    }
"
      fi
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

  colorized_echo blue "$(cli_t installing_nginx)"
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

  colorized_echo blue "$(cli_t requesting_cert "${hosts[*]}")"
  certbot --nginx \
    "${cert_args[@]}" \
    --non-interactive \
    --agree-tos \
    --email "$email" \
    --redirect \
    --no-eff-email \
    --cert-name "$panel_host" \
    --expand || {
      colorized_echo red "$(cli_t cert_failed_install)"
      colorized_echo yellow "$(cli_t cert_failed_hint)"
      colorized_echo yellow "$(cli_t install_failed_recover)"
      colorized_echo cyan "$(cli_t recover_uninstall_hint)"
      exit 1
    }

  write_nginx_site "$base_domain" "$panel_host" "$sub_host" "$sub_path" "$vpn_host" "https"
  nginx -t
  systemctl reload nginx
  sync_vpn_tls_certs "$panel_host"
  colorized_echo green "$(cli_t nginx_tls_ready "${hosts[*]}")"
}

# Re-apply nginx + expand LE certs from .install.conf (safe for existing installs).
refresh_nginx() {
  if [[ ! -f "$INSTALL_CONF" ]]; then
    colorized_echo yellow "$(cli_t no_install_conf_skip "$INSTALL_CONF")"
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
    colorized_echo yellow "$(cli_t incomplete_hosts_skip)"
    return 0
  fi
  if [[ -z "$email" ]]; then
    email="admin@${base_domain:-${panel_host}}"
  fi

  colorized_echo blue "$(cli_t refreshing_nginx)"
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
  sync_vpn_tls_certs "$panel_host"
  colorized_echo green "$(cli_t nginx_refreshed "${hosts[*]}")"
}

remove_nginx_site() {
  rm -f "$NGINX_LINK" "$NGINX_SITE"
  rm -rf "$LANDING_DIR"
  rm -f "$CERTBOT_DEPLOY_HOOK"
  if need_cmd nginx; then
    nginx -t >/dev/null 2>&1 && systemctl reload nginx || true
  fi
}

# Copy Certbot leaf+chain into the sing-box certs bind-mount and point panel defaults at them.
# When Nginx owns :80/:443, sing-box ACME cannot complete HTTP-01 without a challenge proxy,
# and TLS-ALPN cannot bind TCP 443 — FILES TLS from the install certificate just works.
sync_vpn_tls_certs() {
  local panel_host=$1
  local live_dir="/etc/letsencrypt/live/${panel_host}"
  local fullchain="${live_dir}/fullchain.pem"
  local privkey="${live_dir}/privkey.pem"

  if [[ ! -f "$fullchain" || ! -f "$privkey" ]]; then
    colorized_echo yellow "LE cert missing at ${live_dir}; skip VPN TLS sync"
    return 0
  fi

  mkdir -p "$VPN_CERT_HOST_DIR"
  cp -f "$fullchain" "${VPN_CERT_HOST_DIR}/${VPN_CERT_NAME}"
  cp -f "$privkey" "${VPN_CERT_HOST_DIR}/${VPN_KEY_NAME}"
  chown 1000:1000 "${VPN_CERT_HOST_DIR}/${VPN_CERT_NAME}" "${VPN_CERT_HOST_DIR}/${VPN_KEY_NAME}" 2>/dev/null || true
  chmod 640 "${VPN_CERT_HOST_DIR}/${VPN_CERT_NAME}" "${VPN_CERT_HOST_DIR}/${VPN_KEY_NAME}"

  if [[ -f "$ENV_FILE" ]]; then
    set_env_var "VPN_TLS_CERTIFICATE_PATH" "$VPN_CERT_CONTAINER_PATH"
    set_env_var "VPN_TLS_KEY_PATH" "$VPN_KEY_CONTAINER_PATH"
  fi

  install_vpn_tls_renew_hook "$panel_host"
  colorized_echo green "VPN TLS certs synced for FILES inbound defaults (${VPN_CERT_HOST_DIR})"
}

install_vpn_tls_renew_hook() {
  local panel_host=$1
  mkdir -p "$(dirname "$CERTBOT_DEPLOY_HOOK")"
  cat >"$CERTBOT_DEPLOY_HOOK" <<EOF
#!/bin/bash
set -euo pipefail
LIVE="/etc/letsencrypt/live/${panel_host}"
DST="${VPN_CERT_HOST_DIR}"
if [[ -f "\$LIVE/fullchain.pem" && -f "\$LIVE/privkey.pem" ]]; then
  mkdir -p "\$DST"
  cp -f "\$LIVE/fullchain.pem" "\$DST/${VPN_CERT_NAME}"
  cp -f "\$LIVE/privkey.pem" "\$DST/${VPN_KEY_NAME}"
  chown 1000:1000 "\$DST/${VPN_CERT_NAME}" "\$DST/${VPN_KEY_NAME}" 2>/dev/null || true
  chmod 640 "\$DST/${VPN_CERT_NAME}" "\$DST/${VPN_KEY_NAME}"
fi
EOF
  chmod 755 "$CERTBOT_DEPLOY_HOOK"
}


fetch_repo() {
  local branch=$1
  colorized_echo blue "$(cli_t fetching_repo "$branch" "$APP_DIR")"
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
  colorized_echo blue "$(cli_t downloading_bundle "$branch" "$APP_DIR")"
  mkdir -p \
    "$APP_DIR/deploy/landing/assets" \
    "$APP_DIR/deploy/sing-box/certs" \
    "$APP_DIR/deploy/xray/certs" \
    "$APP_DIR/deploy/mtproxy" \
    "$APP_DIR/deploy/proxy"

  local -a files=(
    ".env.example"
    "deploy/docker-compose.yml"
    "deploy/landing/index.html"
    "deploy/landing/sub.html"
    "deploy/landing/vpn.html"
    "deploy/landing/assets/logo.png"
    "deploy/sing-box/bootstrap-config.sh"
    "deploy/sing-box/config.json"
    "deploy/sing-box/entrypoint.sh"
    "deploy/sing-box/certs/.gitkeep"
    "deploy/xray/bootstrap-config.sh"
    "deploy/xray/config.json"
    "deploy/xray/entrypoint.sh"
    "deploy/xray/certs/.gitkeep"
    "deploy/mtproxy/bootstrap-config.sh"
    "deploy/mtproxy/config.json"
    "deploy/mtproxy/entrypoint.sh"
    "deploy/mtproxy/supervisor.py"
    "deploy/mtproxy/Dockerfile"
    "deploy/proxy/nginx.reverse-proxy.conf.example"
  )

  local rel
  for rel in "${files[@]}"; do
    fetch_raw_file "$branch" "$rel" "${APP_DIR}/${rel}"
  done

  chmod 755 \
    "${APP_DIR}/deploy/sing-box/entrypoint.sh" \
    "${APP_DIR}/deploy/sing-box/bootstrap-config.sh" \
    "${APP_DIR}/deploy/xray/entrypoint.sh" \
    "${APP_DIR}/deploy/xray/bootstrap-config.sh" \
    "${APP_DIR}/deploy/mtproxy/entrypoint.sh" \
    "${APP_DIR}/deploy/mtproxy/bootstrap-config.sh"

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
    colorized_echo red "$(cli_t missing_install_conf "$INSTALL_CONF")"
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
    set_env_var "VPN_TLS_CERTIFICATE_PATH" "$VPN_CERT_CONTAINER_PATH"
    set_env_var "VPN_TLS_KEY_PATH" "$VPN_KEY_CONTAINER_PATH"
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
    colorized_echo red "$(cli_t certbot_missing)"
    exit 1
  fi

  colorized_echo blue "$(cli_t requesting_expand_cert)"
  if ! certbot certonly --nginx \
    "${cert_args[@]}" \
    --non-interactive \
    --agree-tos \
    --email "$email" \
    --no-eff-email \
    --cert-name "$panel_host" \
    --expand \
    --keep-until-expiring; then
    colorized_echo red "$(cli_t cert_failed)"
    colorized_echo yellow "$(cli_t cert_failed_hint2)"
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

  colorized_echo blue "$(cli_t generating_env)"
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
  initialize_protocol_config
  set_env_var "SING_BOX_UDP_PORT" "$CFG_SING_BOX_UDP_PORT"
  set_env_var "SING_BOX_TCP_PORT" "$CFG_SING_BOX_TCP_PORT"
  set_env_var "SING_BOX_TROJAN_PORT" "$CFG_SING_BOX_TROJAN_PORT"
  set_env_var "SING_BOX_SS_PORT" "$CFG_SING_BOX_SS_PORT"
  set_env_var "SING_BOX_WG_PORT" "$CFG_SING_BOX_WG_PORT"
  set_env_var "XRAY_LISTEN_PORT" "$CFG_XRAY_LISTEN_PORT"
  set_env_var "XRAY_GRPC_PORT" "$CFG_XRAY_GRPC_PORT"
  set_env_var "XRAY_TCP_TLS_PORT" "$CFG_XRAY_TCP_TLS_PORT"
  set_env_var "XRAY_TROJAN_PORT" "$CFG_XRAY_TROJAN_PORT"
  set_env_var "XRAY_SS_PORT" "$CFG_XRAY_SS_PORT"
  set_env_var "XRAY_WG_PORT" "$CFG_XRAY_WG_PORT"
  set_env_var "MTPROXY_PORT_MIN" "$CFG_MTPROXY_PORT_MIN"
  set_env_var "MTPROXY_PORT_MAX" "$CFG_MTPROXY_PORT_MAX"
  set_env_var "SING_BOX_ENABLED" "$CFG_SING_BOX_ENABLED"
  set_env_var "XRAY_ENABLED" "$CFG_XRAY_ENABLED"
  set_env_var "MTPROXY_ENABLED" "$CFG_MTPROXY_ENABLED"
  set_env_var "CREATE_DEFAULT_INBOUNDS" "$CFG_CREATE_DEFAULT_INBOUNDS"
  set_env_var "UFW_ENABLED" "${CFG_USE_UFW:-true}"
  set_env_var "ENABLED_PROTOCOLS" "$CFG_ENABLED_PROTOCOLS"
  set_env_var "COMPOSE_PROFILES" "$CFG_ENABLED_CORES"
  set_env_var "MTPROXY_IMAGE" "${GHCR_MTPROXY_IMAGE}:${image_tag}"
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
      [[ "$CFG_XRAY_LISTEN_PORT" == "8443" ]] && CFG_XRAY_LISTEN_PORT="9443"
      [[ "$CFG_XRAY_GRPC_PORT" == "8446" ]] && CFG_XRAY_GRPC_PORT="9446"
      [[ "$CFG_XRAY_TCP_TLS_PORT" == "8447" ]] && CFG_XRAY_TCP_TLS_PORT="9447"
      [[ "$CFG_XRAY_TROJAN_PORT" == "8448" ]] && CFG_XRAY_TROJAN_PORT="9448"
      [[ "$CFG_XRAY_SS_PORT" == "8449" ]] && CFG_XRAY_SS_PORT="9449"
      set_env_var "XRAY_LISTEN_PORT" "$CFG_XRAY_LISTEN_PORT"
      set_env_var "XRAY_GRPC_PORT" "$CFG_XRAY_GRPC_PORT"
      set_env_var "XRAY_TCP_TLS_PORT" "$CFG_XRAY_TCP_TLS_PORT"
      set_env_var "XRAY_TROJAN_PORT" "$CFG_XRAY_TROJAN_PORT"
      set_env_var "XRAY_SS_PORT" "$CFG_XRAY_SS_PORT"
      set_env_var "VPN_TLS_CERTIFICATE_PATH" "$VPN_CERT_CONTAINER_PATH"
      set_env_var "VPN_TLS_KEY_PATH" "$VPN_KEY_CONTAINER_PATH"
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
INSTALL_DEPTH=${CFG_INSTALL_DEPTH:-simple}
ENABLED_PROTOCOLS=${CFG_ENABLED_PROTOCOLS}
ENABLED_CORES=${CFG_ENABLED_CORES}
CREATE_DEFAULT_INBOUNDS=${CFG_CREATE_DEFAULT_INBOUNDS}
UFW_ENABLED=${CFG_USE_UFW:-true}
SING_BOX_ENABLED=${CFG_SING_BOX_ENABLED}
XRAY_ENABLED=${CFG_XRAY_ENABLED}
MTPROXY_ENABLED=${CFG_MTPROXY_ENABLED:-true}
CLI_LANG=${CLI_LANG}
EOF
  apply_deploy_permissions
}

wait_for_health() {
  local url=$1
  local tries=${2:-60}
  local i
  colorized_echo blue "$(cli_t waiting_api_health)"
  for ((i = 1; i <= tries; i++)); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      colorized_echo green "$(cli_t api_ready)"
      return 0
    fi
    sleep 2
  done
  colorized_echo yellow "$(cli_t health_timeout "$APP_NAME")"
  return 1
}

bootstrap_default_inbounds() {
  [[ "$(get_env_var CREATE_DEFAULT_INBOUNDS "$ENV_FILE" 2>/dev/null || true)" == "true" ]] || return 0
  colorized_echo blue "$(cli_t creating_default_inbounds)"
  compose exec -T \
    -e "BOOTSTRAP_ADMIN_USER=$(get_env_var BOOTSTRAP_ADMIN_USER "$ENV_FILE")" \
    -e "BOOTSTRAP_ADMIN_PASSWORD=$(get_env_var BOOTSTRAP_ADMIN_PASSWORD "$ENV_FILE")" \
    -e "ENABLED_PROTOCOLS=$(get_env_var ENABLED_PROTOCOLS "$ENV_FILE")" \
    api node apps/api/dist/scripts/bootstrap-default-inbounds.js
}

print_success() {
  local web_port=$1
  local user pass panel_url sub_url vpn_host base_domain
  local w

  user="$(get_env_var BOOTSTRAP_ADMIN_USER "$CREDENTIALS_FILE")"
  pass="$(get_env_var BOOTSTRAP_ADMIN_PASSWORD "$CREDENTIALS_FILE")"
  panel_url="$(get_env_var PANEL_URL "$CREDENTIALS_FILE")"
  sub_url="$(get_env_var SUB_PUBLIC_BASE_URL "$CREDENTIALS_FILE")"
  vpn_host="$(get_env_var VPN_PUBLIC_HOST "$CREDENTIALS_FILE")"
  base_domain="$(get_env_var BASE_DOMAIN "$CREDENTIALS_FILE" 2>/dev/null || true)"
  w="$(tui_term_width)"

  if [[ -t 1 ]]; then
    clear_screen
    show_banner "$(cli_t menu_subtitle)"
  else
    echo
  fi

  draw_box_top "$w"
  draw_box_center "${TUI_GREEN}${TUI_BOLD}$(cli_t install_success_title)${TUI_NC}" "$w"
  draw_box_sep "$w"
  draw_box_empty "$w"
  if [[ -n "$base_domain" ]]; then
    draw_box_line " $(cli_t install_success_site "$base_domain")" "$w"
  fi
  draw_box_line " $(cli_t install_success_panel "$panel_url")" "$w"
  draw_box_line " $(cli_t install_success_login "$user")" "$w"
  draw_box_line " $(cli_t install_success_password "$pass")" "$w"
  draw_box_line " $(cli_t install_success_subs "$sub_url")" "$w"
  if [[ -n "$vpn_host" ]]; then
    draw_box_line " $(cli_t install_success_vpn "$vpn_host")" "$w"
  fi
  draw_box_empty "$w"
  draw_box_sep "$w"
  draw_box_line " $(cli_t install_success_credentials "$CREDENTIALS_FILE")" "$w"
  draw_box_line " $(cli_t install_success_manage "$APP_NAME")" "$w"
  draw_box_empty "$w"
  draw_box_bottom "$w"
  echo
  : "${web_port}"
}

usage() {
  cat <<EOF
OverVPN management script

Usage:
  ${APP_NAME}                      Interactive console menu (TTY)
  ${APP_NAME} menu                 Same as bare command
  ${APP_NAME} install [options]
  ${APP_NAME} up | down | restart | status | logs [service] | update | check-update | uninstall
  ${APP_NAME} enable-core <singbox|xray|mtproxy>
  ${APP_NAME} disable-core <singbox|xray|mtproxy>
  ${APP_NAME} info | edit | bootstrap | nginx | config | install-script

Config (domains, nginx, certificates):
  ${APP_NAME} config show
  ${APP_NAME} config sync
  ${APP_NAME} config set-domain [--base-domain <host>] [--panel <host>] [--subscription <spec>] [--vpn-host <host>] [--email <email>]
  ${APP_NAME} config nginx
  ${APP_NAME} config certs
  ${APP_NAME} config apply

Install wizard (console screens):
  language → simple/detailed → install mode → domains/email → DNS → protocols/ports → confirm
  Then runs unattended (packages, Docker, images, Nginx/TLS).

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
  --simple                 Use all protocols on Sing-box and Xray
  --detailed               Enable detailed protocol/core configuration
  --protocols <list>       Comma-separated protocol enum names (case-insensitive)
  --cores <list>           singbox,xray,mtproxy; enables all protocols for each core
  --ports <pairs>          Comma-separated PROTOCOL=PORT pairs
  --create-default-inbounds
                           Request default inbounds after bootstrap (default)
  --no-default-inbounds    Do not request default inbounds
  --with-mtproxy           Enable MTProxy / Telemt (default)
  --without-mtproxy        Skip MTProxy / Telemt
  --skip-dns               Do not wait for DNS before issuing certificates
  --no-nginx               Skip Nginx/TLS
  --no-ufw                 Do not touch UFW
  -h, --help               Show help

Default install downloads only deploy files (no full git clone).
Use --build to clone the repository and build images locally.

One-liner:
  $(install_oneliner)
EOF
}

cmd_install() {
  check_root
  detect_os

  local web_port="$DEFAULT_WEB_PORT" branch="$DEFAULT_BRANCH"
  local image_tag="$DEFAULT_IMAGE_TAG" do_build="false"
  local with_nginx="auto" use_ufw="true"
  local flag_base="" flag_panel="" flag_sub="" flag_vpn="" flag_email=""
  local flag_mtproxy="" flag_depth="" flag_protocols="" flag_cores="" flag_ports=""
  CFG_SKIP_DNS="false"
  CFG_DNS_HANDLED="false"
  CFG_MTPROXY_ENABLED="true"
  CFG_CREATE_DEFAULT_INBOUNDS="true"
  CFG_USE_UFW="true"

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
      --simple) flag_depth="simple"; shift ;;
      --detailed) flag_depth="detailed"; shift ;;
      --protocols) flag_protocols="${2:-}"; shift 2 ;;
      --cores) flag_cores="${2:-}"; shift 2 ;;
      --ports) flag_ports="${2:-}"; shift 2 ;;
      --create-default-inbounds) CFG_CREATE_DEFAULT_INBOUNDS="true"; shift ;;
      --no-default-inbounds) CFG_CREATE_DEFAULT_INBOUNDS="false"; shift ;;
      --with-mtproxy) flag_mtproxy="true"; shift ;;
      --without-mtproxy) flag_mtproxy="false"; shift ;;
      --skip-dns) CFG_SKIP_DNS="true"; shift ;;
      --no-nginx) with_nginx="false"; shift ;;
      --no-ufw) use_ufw="false"; CFG_USE_UFW="false"; CFG_UFW_DECIDED="true"; shift ;;
      -h|--help) usage; exit 0 ;;
      *) colorized_echo red "$(cli_t unknown_option "$1")"; usage; exit 1 ;;
    esac
  done

  ensure_clean_for_install

  if [[ ! "$web_port" =~ ^[0-9]+$ ]] || [[ "$web_port" -lt 1 || "$web_port" -gt 65535 ]]; then
    colorized_echo red "$(cli_t invalid_port "$web_port")"
    exit 1
  fi

  CFG_BASE_DOMAIN=""
  CFG_PANEL_HOST=""
  CFG_SUB_HOST=""
  CFG_SUB_PATH=""
  CFG_VPN_HOST=""
  CFG_EMAIL=""
  CFG_MODE="ip"
  CFG_INSTALL_DEPTH="${flag_depth:-simple}"
  initialize_protocol_config
  if [[ -n "$flag_depth" || -n "$flag_protocols" || -n "$flag_cores" || -n "$flag_ports" ]]; then
    CFG_DEPTH_SKIP_PROMPT="true"
  fi
  if [[ -n "$flag_protocols" ]]; then
    CFG_ENABLED_PROTOCOLS="$(normalize_protocol_list "$flag_protocols")"
    [[ -n "$CFG_ENABLED_PROTOCOLS" ]] || { colorized_echo red "$(cli_t no_protocols)"; exit 1; }
    CFG_INSTALL_DEPTH="detailed"
    CFG_DETAILED_SKIP_PROMPTS="true"
    derive_enabled_cores
  elif [[ -n "$flag_cores" ]]; then
    CFG_ENABLED_PROTOCOLS="$(protocols_for_cores "$flag_cores")"
    CFG_INSTALL_DEPTH="detailed"
    CFG_DETAILED_SKIP_PROMPTS="true"
    derive_enabled_cores
  fi
  [[ -n "$flag_ports" ]] && apply_port_overrides "$flag_ports"
  if [[ -n "$flag_mtproxy" ]]; then
    CFG_MTPROXY_ENABLED="$flag_mtproxy"
    CFG_MTPROXY_SKIP_PROMPT="true"
    if [[ "$flag_mtproxy" == "true" && ",$CFG_ENABLED_PROTOCOLS," != *,MTPROXY,* ]]; then
      CFG_ENABLED_PROTOCOLS="${CFG_ENABLED_PROTOCOLS:+${CFG_ENABLED_PROTOCOLS},}MTPROXY"
    elif [[ "$flag_mtproxy" == "false" ]]; then
      CFG_ENABLED_PROTOCOLS="$(printf '%s' "$CFG_ENABLED_PROTOCOLS" | sed -E 's/(^|,)MTPROXY(,|$)/\1/; s/,,+/,/g; s/^,//; s/,$//')"
    fi
    derive_enabled_cores
  fi

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
    colorized_echo green "$(cli_t noninteractive_start)"
  else
    prompt_install_endpoints
    if [[ -n "$flag_email" ]]; then
      CFG_EMAIL="$flag_email"
    fi
  fi

  use_ufw="${CFG_USE_UFW:-$use_ufw}"

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

  # Interactive wizard already waited (or skipped) on the DNS screen.
  # Non-interactive --base-domain installs still wait here unless --skip-dns.
  if [[ "$CFG_MODE" == "domain" && "$with_nginx" == "true" && "${CFG_DNS_HANDLED:-false}" != "true" ]]; then
    mapfile -t dns_hosts < <(unique_hosts "$CFG_BASE_DOMAIN" "$CFG_PANEL_HOST" "$CFG_SUB_HOST" "$CFG_VPN_HOST")
    wait_for_dns "$ip" "${dns_hosts[@]}"
  fi

  deploy_source "$branch" "$do_build"
  mark_install_inprogress
  # Install CLI early so a failed mid-install still leaves `overvpn uninstall` usable.
  install_cli "${APP_DIR}/install.sh"
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

  colorized_echo blue "$(cli_t creating_owner)"
  compose --profile tools run --rm bootstrap-admin
  bootstrap_default_inbounds

  install_cli "${APP_DIR}/install.sh"
  apply_deploy_permissions
  mark_install_complete
  print_success "$web_port"
}

enabled_profiles_from_env() {
  local profiles=""
  core_enabled singbox && profiles="singbox"
  core_enabled xray && profiles="${profiles:+${profiles},}xray"
  core_enabled mtproxy && profiles="${profiles:+${profiles},}mtproxy"
  printf '%s' "$profiles"
}

core_protocols() {
  case "$1" in
    singbox) printf '%s' "$SINGBOX_PROTOCOLS" ;;
    xray) printf '%s' "$XRAY_PROTOCOLS" ;;
    mtproxy) printf 'MTPROXY' ;;
  esac
}

update_core_protocol_lists() {
  local core=$1 enabled=$2 current protocol result=""
  current="$(get_env_var ENABLED_PROTOCOLS "$ENV_FILE" 2>/dev/null || true)"
  [[ -z "$current" ]] && current="$(get_env_var ENABLED_PROTOCOLS "$INSTALL_CONF" 2>/dev/null || true)"
  if [[ "$enabled" == "true" ]]; then
    current="${current:+${current},}$(core_protocols "$core")"
    current="$(normalize_protocol_list "$current")"
  else
    IFS=',' read -ra _current_protocols <<<"$current"
    for protocol in "${_current_protocols[@]}"; do
      [[ "$(protocol_engine "$protocol" 2>/dev/null || true)" == "$core" ]] && continue
      result="${result:+${result},}${protocol}"
    done
    current="$result"
  fi
  set_env_var "ENABLED_PROTOCOLS" "$current"
  set_install_conf_var "ENABLED_PROTOCOLS" "$current"
}

cmd_enable_core() {
  check_root
  is_installed || { colorized_echo red "$(cli_t not_installed)"; exit 1; }
  local core="${1,,}" key
  case "$core" in
    singbox) key="SING_BOX_ENABLED" ;;
    xray) key="XRAY_ENABLED" ;;
    mtproxy) key="MTPROXY_ENABLED" ;;
    *) colorized_echo red "Core must be singbox, xray, or mtproxy"; exit 1 ;;
  esac
  set_env_var "$key" "true"
  update_core_protocol_lists "$core" true
  set_install_conf_var "$key" "true"
  set_env_var "COMPOSE_PROFILES" "$(enabled_profiles_from_env)"
  set_install_conf_var "ENABLED_CORES" "$(enabled_profiles_from_env)"
  CFG_ENABLED_PROTOCOLS="$(get_env_var ENABLED_PROTOCOLS "$ENV_FILE")"
  if [[ "$(get_env_var UFW_ENABLED "$INSTALL_CONF" 2>/dev/null || true)" != "false" ]]; then
    configure_firewall false "$(get_env_var WEB_PORT "$ENV_FILE")"
  fi
  case "$core" in
    singbox) compose up -d core-config-init core ;;
    xray) compose up -d core-xray-config-init core-xray ;;
    mtproxy) compose up -d core-mtproxy-config-init core-mtproxy ;;
  esac
  colorized_echo green "Core enabled: $core"
}

cmd_disable_core() {
  check_root
  is_installed || { colorized_echo red "$(cli_t not_installed)"; exit 1; }
  local core="${1,,}" key services
  case "$core" in
    singbox) key="SING_BOX_ENABLED"; services="core core-config-init" ;;
    xray) key="XRAY_ENABLED"; services="core-xray core-xray-config-init" ;;
    mtproxy) key="MTPROXY_ENABLED"; services="core-mtproxy core-mtproxy-config-init" ;;
    *) colorized_echo red "Core must be singbox, xray, or mtproxy"; exit 1 ;;
  esac
  colorized_echo yellow "Disable/remove inbounds for $core in the admin panel before disabling this core."
  compose stop $services >/dev/null 2>&1 || true
  compose rm -f $services >/dev/null 2>&1 || true
  set_env_var "$key" "false"
  update_core_protocol_lists "$core" false
  set_install_conf_var "$key" "false"
  set_env_var "COMPOSE_PROFILES" "$(enabled_profiles_from_env)"
  set_install_conf_var "ENABLED_CORES" "$(enabled_profiles_from_env)"
  colorized_echo green "Core disabled: $core"
}

cmd_up() {
  check_root
  is_installed || { colorized_echo red "$(cli_t not_installed)"; exit 1; }
  compose up -d
  colorized_echo green "$(cli_t started)"
}

cmd_down() {
  check_root
  is_installed || { colorized_echo red "$(cli_t not_installed)"; exit 1; }
  compose down
  colorized_echo green "$(cli_t stopped)"
}

cmd_restart() {
  check_root
  is_installed || { colorized_echo red "$(cli_t not_installed)"; exit 1; }
  compose restart
  colorized_echo green "$(cli_t restarted)"
}

cmd_status() {
  check_root
  is_installed || { colorized_echo red "$(cli_t not_installed)"; exit 1; }
  compose ps
}

cmd_logs() {
  check_root
  is_installed || { colorized_echo red "$(cli_t not_installed)"; exit 1; }
  if [[ $# -gt 0 ]]; then
    compose logs -f --tail=200 "$@"
  else
    compose logs -f --tail=200
  fi
}

cmd_update() {
  check_root
  is_installed || { colorized_echo red "$(cli_t not_installed)"; exit 1; }

  local do_build="false" image_tag=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --build) do_build="true"; shift ;;
      --tag|--version) image_tag="${2:-}"; shift 2 ;;
      *) colorized_echo red "$(cli_t unknown_option "$1")"; exit 1 ;;
    esac
  done

  local branch="$DEFAULT_BRANCH"
  if [[ "$do_build" == "true" || -d "$APP_DIR/.git" ]]; then
    branch="$(git -C "$APP_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "$DEFAULT_BRANCH")"
  fi

  colorized_echo blue "$(cli_t updating "$branch")"
  deploy_source "$branch" "$do_build"
  install_cli "${APP_DIR}/install.sh"
  sync_domains_from_install_conf

  if [[ -n "$image_tag" ]]; then
    set_env_var "API_IMAGE" "${GHCR_API_IMAGE}:${image_tag}"
    set_env_var "WEB_IMAGE" "${GHCR_WEB_IMAGE}:${image_tag}"
    set_env_var "MTPROXY_IMAGE" "${GHCR_MTPROXY_IMAGE}:${image_tag}"
  fi

  compose_up "$do_build"
  refresh_nginx
  apply_deploy_permissions
  wait_for_health "http://127.0.0.1:$(get_env_var WEB_PORT)/api/health" || true
  colorized_echo green "$(cli_t update_complete)"
}

install_oneliner() {
  printf 'sudo bash -c "$(curl -fsSL %s/%s/install.sh)" @ install' "$REPO_RAW_BASE" "$DEFAULT_BRANCH"
}

cmd_uninstall() {
  check_root

  local wipe="y"
  local purge_certs="y"
  local purge_nginx="n"
  if [[ -t 0 ]]; then
    _cmd_uninstall_header() {
      local w
      w="$(tui_term_width)"
      show_banner "$(cli_t menu_subtitle)"
      draw_box_top "$w"
      draw_box_center "${TUI_BOLD}$(cli_t uninstall_title)${TUI_NC}" "$w"
      draw_box_sep "$w"
      draw_box_line " $(cli_t uninstall_warn)" "$w"
      draw_box_line " ${_uninstall_prompt_msg}" "$w"
      draw_box_empty "$w"
    }
    local _uninstall_prompt_msg
    _uninstall_prompt_msg="$(cli_t prompt_wipe_volumes)"
    UI_MENU_HEADER=_cmd_uninstall_header
    if ui_confirm y; then wipe="y"; else wipe="n"; fi
    _uninstall_prompt_msg="$(cli_t prompt_purge_certs)"
    if ui_confirm y; then purge_certs="y"; else purge_certs="n"; fi
    _uninstall_prompt_msg="$(cli_t prompt_purge_nginx)"
    if ui_confirm n; then purge_nginx="y"; else purge_nginx="n"; fi
    unset UI_MENU_HEADER
  else
    colorized_echo yellow "$(cli_t uninstall_warn)"
  fi

  if [[ -f "$COMPOSE_FILE" && -f "$ENV_FILE" ]]; then
    if [[ "${wipe,,}" == "y" || "${wipe,,}" == "yes" ]]; then
      compose down -v --remove-orphans --rmi all || true
    else
      compose down --remove-orphans --rmi all || true
    fi
  else
    # Best-effort if compose files are already gone
    docker ps -aq --filter "name=overvpn-" | xargs -r docker rm -f || true
    docker network ls -q --filter "name=overvpn" | xargs -r docker network rm || true
    if [[ "${wipe,,}" == "y" || "${wipe,,}" == "yes" ]]; then
      docker volume ls -q --filter "name=overvpn" | xargs -r docker volume rm || true
    fi
  fi

  # Drop app + dependency images (postgres/redis/busybox and any leftover tags)
  remove_overvpn_images

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

  if [[ "${purge_nginx,,}" == "y" || "${purge_nginx,,}" == "yes" ]]; then
    colorized_echo blue "$(cli_t removing_nginx_pkgs)"
    if need_cmd systemctl; then
      systemctl stop nginx 2>/dev/null || true
      systemctl disable nginx 2>/dev/null || true
    fi
    export DEBIAN_FRONTEND=noninteractive
    apt-get remove -y nginx certbot python3-certbot-nginx 2>/dev/null || true
    apt-get autoremove -y 2>/dev/null || true
    colorized_echo green "$(cli_t nginx_pkgs_removed)"
  fi

  colorized_echo green "$(cli_t fully_removed)"
  if [[ "${purge_nginx,,}" != "y" && "${purge_nginx,,}" != "yes" ]]; then
    colorized_echo yellow "$(cli_t nginx_left_installed)"
    colorized_echo yellow "$(cli_t nginx_remove_hint)"
  fi
  colorized_echo yellow "$(cli_t reinstall)"
  colorized_echo cyan "  $(install_oneliner)"
}

cmd_info() {
  check_root
  is_installed || { colorized_echo red "$(cli_t not_installed)"; exit 1; }

  echo "$(cli_t info_install_dir "$APP_DIR")"
  if [[ -f "$CREDENTIALS_FILE" ]]; then
    echo "$(cli_t info_panel_url "$(get_env_var PANEL_URL "$CREDENTIALS_FILE")")"
    echo "$(cli_t info_sub_base "$(get_env_var SUB_PUBLIC_BASE_URL "$CREDENTIALS_FILE")")"
    echo "$(cli_t info_vpn_host "$(get_env_var VPN_PUBLIC_HOST "$CREDENTIALS_FILE")")"
    echo "$(cli_t info_admin_user "$(get_env_var BOOTSTRAP_ADMIN_USER "$CREDENTIALS_FILE")")"
    echo "$(cli_t info_password "$(get_env_var BOOTSTRAP_ADMIN_PASSWORD "$CREDENTIALS_FILE")")"
  fi
  compose ps
}

cmd_edit() {
  check_root
  is_installed || { colorized_echo red "$(cli_t not_installed)"; exit 1; }
  "${EDITOR:-nano}" "$ENV_FILE"
  colorized_echo yellow "$(cli_t restart_to_apply "$APP_NAME")"
}

cmd_bootstrap() {
  check_root
  is_installed || { colorized_echo red "$(cli_t not_installed)"; exit 1; }
  compose --profile tools run --rm bootstrap-admin
  bootstrap_default_inbounds
  colorized_echo green "$(cli_t bootstrap_finished)"
}

cmd_nginx() {
  check_root
  is_installed || { colorized_echo red "$(cli_t not_installed)"; exit 1; }
  refresh_nginx
}

cmd_config_show() {
  check_root
  is_installed || { colorized_echo red "$(cli_t not_installed)"; exit 1; }

  echo "Install dir: ${APP_DIR}"
  echo "Install mode: $(cat "$INSTALL_MODE_FILE" 2>/dev/null || echo unknown)"
  echo
  if [[ -f "$INSTALL_CONF" ]]; then
    echo "=== .install.conf (nginx/certs source of truth) ==="
    cat "$INSTALL_CONF"
    echo
  else
    colorized_echo yellow "$(cli_t missing_install_conf "$INSTALL_CONF")"
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
  is_installed || { colorized_echo red "$(cli_t not_installed)"; exit 1; }
  sync_domains_from_install_conf
  colorized_echo green "$(cli_t synced_domains)"
}

cmd_config_set_domain() {
  check_root
  is_installed || { colorized_echo red "$(cli_t not_installed)"; exit 1; }
  [[ -f "$INSTALL_CONF" ]] || { colorized_echo red "$(cli_t missing_install_conf "$INSTALL_CONF")"; exit 1; }

  local flag_base="" flag_panel="" flag_sub="" flag_vpn="" flag_email=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --base-domain) flag_base="${2:-}"; shift 2 ;;
      --panel) flag_panel="${2:-}"; shift 2 ;;
      --subscription) flag_sub="${2:-}"; shift 2 ;;
      --vpn-host) flag_vpn="${2:-}"; shift 2 ;;
      --email) flag_email="${2:-}"; shift 2 ;;
      *) colorized_echo red "$(cli_t unknown_option "$1")"; exit 1 ;;
    esac
  done

  read_install_hosts
  local base="${flag_base:-$INSTALL_BASE_DOMAIN}"
  local panel="${flag_panel:-$INSTALL_PANEL_HOST}"
  local sub_spec="${flag_sub:-}"
  local vpn="${flag_vpn:-$INSTALL_VPN_HOST}"
  local email="${flag_email:-$INSTALL_EMAIL}"

  if [[ -z "$base" ]]; then
    colorized_echo red "$(cli_t provide_base_domain)"
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
  colorized_echo green "$(cli_t domains_updated "$APP_NAME")"
}

cmd_config_nginx() {
  check_root
  is_installed || { colorized_echo red "$(cli_t not_installed)"; exit 1; }
  read_install_hosts
  if [[ "$INSTALL_MODE" != "domain" ]]; then
    colorized_echo yellow "$(cli_t domain_mode_not_configured_refresh)"
    return 0
  fi
  install_landing_files
  write_nginx_site "$INSTALL_BASE_DOMAIN" "$INSTALL_PANEL_HOST" "$INSTALL_SUB_HOST" "$INSTALL_SUB_PATH" "$INSTALL_VPN_HOST" "https"
  ln -sfn "$NGINX_SITE" "$NGINX_LINK"
  nginx -t
  systemctl reload nginx
  colorized_echo green "$(cli_t nginx_site_refreshed)"
}

cmd_config_certs() {
  check_root
  is_installed || { colorized_echo red "$(cli_t not_installed)"; exit 1; }
  read_install_hosts
  if [[ "$INSTALL_MODE" != "domain" ]]; then
    colorized_echo yellow "$(cli_t domain_mode_not_configured)"
    return 0
  fi
  if [[ -z "$INSTALL_PANEL_HOST" || -z "$INSTALL_SUB_HOST" || -z "$INSTALL_VPN_HOST" ]]; then
    colorized_echo red "$(cli_t incomplete_host_list)"
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
  colorized_echo green "$(cli_t certs_issued "${hosts[*]}")"
}

cmd_config_apply() {
  check_root
  is_installed || { colorized_echo red "$(cli_t not_installed)"; exit 1; }
  sync_domains_from_install_conf
  refresh_nginx
  compose_up false
  wait_for_health "http://127.0.0.1:$(get_env_var WEB_PORT)/api/health" || true
  colorized_echo green "$(cli_t config_applied)"
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
      colorized_echo red "$(cli_t unknown_config_command "$subcmd")"
      echo "$(cli_t config_usage "$APP_NAME")"
      exit 1
      ;;
  esac
}

cmd_install_script() {
  check_root
  install_cli "${BASH_SOURCE[0]}"
}

menu_run_action() {
  echo
  set +e
  "$@"
  set -e
  echo
  ui_press_enter
}

show_update_submenu() {
  local choice
  _show_update_submenu_header() {
    local w
    w="$(tui_term_width)"
    show_banner "$(cli_t menu_subtitle)"
    draw_box_top "$w"
    draw_box_center "${TUI_BOLD}$(cli_t menu_update)${TUI_NC}" "$w"
    draw_box_sep "$w"
    draw_box_empty "$w"
  }
  while true; do
    UI_MENU_HEADER=_show_update_submenu_header
    ui_select_menu 2 \
      "1|$(cli_t menu_update_check)" \
      "2|$(cli_t menu_update_apply)" \
      "0|$(cli_t menu_update_back)"
    choice="$UI_SELECT_RESULT"
    unset UI_MENU_HEADER
    case "$choice" in
      1)
        echo
        set +e
        cmd_check_update
        set -e
        echo
        ui_press_enter
        ;;
      2)
        menu_run_action cmd_update
        ;;
      0) return ;;
    esac
  done
}

show_cores_submenu() {
  local choice core
  while true; do
    ui_select_menu 2 \
      "enable|enable-core" \
      "disable|disable-core" \
      "back|$(cli_t menu_update_back)"
    choice="$UI_SELECT_RESULT"
    case "$choice" in
      enable|disable)
        core="$(ui_prompt "singbox | xray | mtproxy")"
        if [[ "$choice" == "enable" ]]; then
          menu_run_action cmd_enable_core "$core"
        else
          menu_run_action cmd_disable_core "$core"
        fi
        ;;
      back) return ;;
    esac
  done
}

show_main_menu() {
  check_root
  local w choice svc
  w="$(tui_term_width)"

  if ! is_installed; then
    clear_screen
    show_banner "$(cli_t menu_subtitle)"
    draw_box_top "$w"
    draw_box_center "${TUI_BOLD}$(cli_t menu_title)${TUI_NC}" "$w"
    draw_box_sep "$w"
    draw_box_line " $(cli_t menu_not_installed_hint)" "$w"
    draw_box_bottom "$w"
    echo
    return 1
  fi

  _show_main_menu_header() {
    local w
    w="$(tui_term_width)"
    show_banner "$(cli_t menu_subtitle)"
    draw_box_top "$w"
    draw_box_center "${TUI_BOLD}$(cli_t menu_title)${TUI_NC}" "$w"
    draw_box_sep "$w"
    draw_box_empty "$w"
  }

  while true; do
    UI_MENU_HEADER=_show_main_menu_header
    ui_select_menu 9 \
      "1|$(cli_t menu_status)" \
      "2|$(cli_t menu_info)" \
      "3|$(cli_t menu_logs)" \
      "4|$(cli_t menu_restart)" \
      "5|$(cli_t menu_update)" \
      "6|$(cli_t menu_edit)" \
      "7|$(cli_t menu_nginx)" \
      "8|$(cli_t menu_cores)" \
      "9|${TUI_RED}$(cli_t menu_uninstall)${TUI_NC}" \
      "0|$(cli_t menu_exit)"
    choice="$UI_SELECT_RESULT"
    unset UI_MENU_HEADER
    case "$choice" in
      1) menu_run_action cmd_status ;;
      2) menu_run_action cmd_info ;;
      3)
        echo
        colorized_echo cyan "$(cli_t menu_logs_hint)"
        svc="$(ui_prompt "service" "")"
        echo
        set +e
        if [[ -n "$svc" ]]; then
          cmd_logs "$svc"
        else
          cmd_logs
        fi
        set -e
        echo
        ui_press_enter
        ;;
      4) menu_run_action cmd_restart ;;
      5) show_update_submenu ;;
      6) menu_run_action cmd_edit ;;
      7) menu_run_action cmd_nginx ;;
      8) show_cores_submenu ;;
      9)
        cmd_uninstall
        exit 0
        ;;
      0)
        echo
        exit 0
        ;;
    esac
  done
}

main() {
  load_cli_lang
  apply_cli_lang

  if [[ "${1:-}" == "@" ]]; then
    shift
  fi

  local cmd=${1:-}
  if [[ -n "$cmd" ]]; then
    shift
  fi

  case "$cmd" in
    install) cmd_install "$@" ;;
    enable-core) cmd_enable_core "${1:-}" ;;
    disable-core) cmd_disable_core "${1:-}" ;;
    up|start) cmd_up ;;
    down|stop) cmd_down ;;
    restart) cmd_restart ;;
    status|ps) cmd_status ;;
    logs) cmd_logs "$@" ;;
    update) cmd_update "$@" ;;
    check-update|check-updates) cmd_check_update ;;
    uninstall|remove) cmd_uninstall ;;
    info) cmd_info ;;
    edit|edit-env) cmd_edit ;;
    bootstrap|bootstrap-admin) cmd_bootstrap ;;
    nginx|refresh-nginx) cmd_nginx ;;
    config) cmd_config "$@" ;;
    install-script) cmd_install_script ;;
    menu) show_main_menu ;;
    -h|--help|help) usage ;;
    "")
      if [[ -t 0 && -t 1 ]]; then
        show_main_menu
      else
        usage
      fi
      ;;
    *)
      colorized_echo red "$(cli_t unknown_command "$cmd")"
      usage
      exit 1
      ;;
  esac
}

main "$@"
