# OverVPN AmneziaWG 2.0 runtime: amneziawg-go + awg-quick supervisor.

FROM golang:1.24-alpine AS build
RUN apk add --no-cache git make gcc musl-dev linux-headers bash
WORKDIR /src
RUN git clone --depth 1 https://github.com/amnezia-vpn/amneziawg-go.git .
RUN go build -trimpath -ldflags="-s -w" -o /out/amneziawg-go .
WORKDIR /tools
RUN git clone --depth 1 https://github.com/amnezia-vpn/amneziawg-tools.git .
WORKDIR /tools/src
RUN make && mkdir -p /out && cp wg /out/awg && cp wg-quick/linux.bash /out/awg-quick

FROM alpine:3.21
RUN apk add --no-cache bash dumb-init iproute2 iptables python3 \
    && chmod 755 /usr/bin/python3
COPY --from=build /out/amneziawg-go /usr/local/bin/amneziawg-go
COPY --from=build /out/awg /usr/local/bin/awg
COPY --from=build /out/awg-quick /usr/local/bin/awg-quick
RUN chmod 755 /usr/local/bin/amneziawg-go /usr/local/bin/awg /usr/local/bin/awg-quick \
    && sed -i 's|wg |awg |g' /usr/local/bin/awg-quick || true
COPY --chmod=755 entrypoint.sh /entrypoint/amneziawg-entrypoint.sh
COPY supervisor.py /opt/overvpn-amneziawg/supervisor.py

ENV AMNEZIAWG_CONFIG_PATH=/var/lib/amneziawg/config.json \
    AMNEZIAWG_RELOAD_REQUEST_PATH=/var/lib/overvpn/amneziawg-reload/request \
    AMNEZIAWG_RELOAD_ACK_PATH=/var/lib/overvpn/amneziawg-reload/ack \
    AMNEZIAWG_PID_PATH=/var/lib/overvpn/amneziawg-reload/amneziawg.pid \
    AMNEZIAWG_HEARTBEAT_PATH=/var/lib/overvpn/amneziawg-reload/heartbeat \
    AMNEZIAWG_RUNTIME_STATS_PATH=/var/lib/overvpn/amneziawg-reload/runtime-stats.json \
    AMNEZIAWG_WORK_DIR=/var/lib/amneziawg-work \
    WG_QUICK_USERSPACE_IMPLEMENTATION=/usr/local/bin/amneziawg-go

WORKDIR /tmp
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["/bin/sh", "/entrypoint/amneziawg-entrypoint.sh"]
