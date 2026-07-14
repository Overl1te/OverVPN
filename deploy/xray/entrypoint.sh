#!/bin/sh
set -eu

CONFIG_PATH="${XRAY_CONFIG_PATH:-/var/lib/xray/config.json}"
REQUEST_PATH="${XRAY_RELOAD_REQUEST_PATH:-/var/lib/overvpn/xray-reload/request}"
ACK_PATH="${XRAY_RELOAD_ACK_PATH:-/var/lib/overvpn/xray-reload/ack}"
PID_PATH="${XRAY_PID_PATH:-/var/lib/overvpn/xray-reload/xray.pid}"
POLL_SECONDS="${XRAY_RELOAD_POLL_SECONDS:-0.2}"
SETTLE_SECONDS="${XRAY_RELOAD_SETTLE_SECONDS:-1}"

mkdir -p "$(dirname "$ACK_PATH")"
rm -f "$ACK_PATH" "$REQUEST_PATH"

start_child() {
  xray run -c "$CONFIG_PATH" &
  child_pid=$!
  printf '%s\n' "$child_pid" >"$PID_PATH"
}

stop_child() {
  if [ -n "${child_pid:-}" ]; then
    kill -TERM "$child_pid" 2>/dev/null || true
    wait "$child_pid" 2>/dev/null || true
  fi
  child_pid=''
}

restart_child() {
  stop_child
  start_child
  sleep "$SETTLE_SECONDS"
  kill -0 "$child_pid" 2>/dev/null
}

terminate() {
  stop_child
  rm -f "$PID_PATH"
  exit 0
}
trap terminate INT TERM

start_child

last_request_id=''
while true; do
  if ! kill -0 "$child_pid" 2>/dev/null; then
    wait "$child_pid" 2>/dev/null || true
    rm -f "$PID_PATH"
    exit 1
  fi

  if [ -r "$REQUEST_PATH" ]; then
    request_id=''
    request_hash=''
    while IFS='=' read -r key value; do
      case "$key" in
        id) request_id="$value" ;;
        hash) request_hash="$value" ;;
      esac
    done <"$REQUEST_PATH"

    if [ -n "$request_id" ] && [ "$request_id" != "$last_request_id" ]; then
      status='error'
      message='invalid-request'
      case "$request_hash" in
        *[!0-9a-f]*|'')
          message='invalid-hash'
          ;;
        *)
          if [ "${#request_hash}" -ne 64 ]; then
            message='invalid-hash'
          elif restart_child; then
            status='ok'
            message='restarted'
          else
            message='restart-failed'
            # Best-effort recover so the container stays up for the next attempt.
            start_child || true
          fi
          ;;
      esac

      ack_tmp="${ACK_PATH}.tmp.$$"
      {
        printf 'id=%s\n' "$request_id"
        printf 'hash=%s\n' "$request_hash"
        printf 'status=%s\n' "$status"
        printf 'message=%s\n' "$message"
      } >"$ack_tmp"
      mv -f "$ack_tmp" "$ACK_PATH"
      last_request_id="$request_id"
    fi
  fi
  sleep "$POLL_SECONDS"
done
