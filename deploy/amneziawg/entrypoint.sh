#!/bin/sh
set -eu

if [ ! -c /dev/net/tun ]; then
  mkdir -p /dev/net
  mknod /dev/net/tun c 10 200 || true
fi

exec python3 /opt/overvpn-amneziawg/supervisor.py
