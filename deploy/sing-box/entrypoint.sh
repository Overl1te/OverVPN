#!/bin/sh
set -eu

CONFIG_PATH="${SING_BOX_CONFIG_PATH:-/var/lib/sing-box/config.json}"
REQUEST_PATH="${SING_BOX_RELOAD_REQUEST_PATH:-/var/lib/overvpn/reload/request}"
ACK_PATH="${SING_BOX_RELOAD_ACK_PATH:-/var/lib/overvpn/reload/ack}"
PID_PATH="${SING_BOX_PID_PATH:-/var/lib/overvpn/reload/sing-box.pid}"
POLL_SECONDS="${SING_BOX_RELOAD_POLL_SECONDS:-0.2}"
SETTLE_SECONDS="${SING_BOX_RELOAD_SETTLE_SECONDS:-1}"

mkdir -p "$(dirname "$ACK_PATH")"
rm -f "$ACK_PATH" "$REQUEST_PATH"

sing-box run -c "$CONFIG_PATH" &
child_pid=$!
printf '%s\n' "$child_pid" >"$PID_PATH"

terminate() {
  kill -TERM "$child_pid" 2>/dev/null || true
  wait "$child_pid" 2>/dev/null || true
}
trap terminate INT TERM

last_request_id=''
while kill -0 "$child_pid" 2>/dev/null; do
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
          elif kill -HUP "$child_pid" 2>/dev/null; then
            sleep "$SETTLE_SECONDS"
            if kill -0 "$child_pid" 2>/dev/null; then
              status='ok'
              message='reloaded'
            else
              message='child-exited-after-sighup'
            fi
          else
            message='sighup-failed'
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

rm -f "$PID_PATH"
wait "$child_pid"
