# OverVPN MTProxy runtime: Telemt binary + thin Python supervisor.
# Telemt upstream image: https://hub.docker.com/r/whn0thacked/telemt-docker
# (static musl binary from https://github.com/telemt/telemt/releases)

FROM whn0thacked/telemt-docker:latest AS telemt

FROM python:3.12-alpine

RUN apk add --no-cache dumb-init \
    && addgroup -g 1000 overvpn \
    && adduser -D -u 1000 -G overvpn overvpn

COPY --from=telemt /usr/local/bin/telemt /usr/local/bin/telemt
COPY --chmod=755 entrypoint.sh /entrypoint/mtproxy-entrypoint.sh
COPY supervisor.py /opt/overvpn-mtproxy/supervisor.py

ENV TELEMT_BIN=/usr/local/bin/telemt \
    MTPROXY_CONFIG_PATH=/var/lib/mtproxy/config.json \
    MTPROXY_RELOAD_REQUEST_PATH=/var/lib/overvpn/mtproxy-reload/request \
    MTPROXY_RELOAD_ACK_PATH=/var/lib/overvpn/mtproxy-reload/ack \
    MTPROXY_PID_PATH=/var/lib/overvpn/mtproxy-reload/mtproxy.pid \
    MTPROXY_WORK_DIR=/var/lib/mtproxy-work

USER overvpn
WORKDIR /tmp

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["/bin/sh", "/entrypoint/mtproxy-entrypoint.sh"]
