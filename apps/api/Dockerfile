FROM --platform=$BUILDPLATFORM golang:1.25-alpine AS singbox-build

ARG TARGETOS
ARG TARGETARCH
ARG SING_BOX_VERSION=v1.13.14
ARG SING_BOX_COMMIT=25a600db24f7680ad9806ce5427bd0ab8afe1114

RUN apk add --no-cache build-base git
WORKDIR /source
RUN git clone --branch "${SING_BOX_VERSION}" --depth 1 https://github.com/SagerNet/sing-box.git . \
    && test "$(git rev-parse HEAD)" = "${SING_BOX_COMMIT}"
RUN export CGO_ENABLED=0 GOOS="${TARGETOS:-linux}" GOARCH="${TARGETARCH:-amd64}" \
    && export TAGS="$(cat release/DEFAULT_BUILD_TAGS_OTHERS),with_v2ray_api" \
    && export VERSION="$(go run ./cmd/internal/read_tag)" \
    && export LDFLAGS_SHARED="$(cat release/LDFLAGS)" \
    && go build -trimpath -tags "$TAGS" \
      -o /out/sing-box \
      -ldflags "-X \"github.com/sagernet/sing-box/constant.Version=$VERSION\" $LDFLAGS_SHARED -s -w -buildid=" \
      ./cmd/sing-box

FROM alpine:3.22 AS xray-build

ARG TARGETARCH
ARG XRAY_VERSION=v26.6.27

# CI prefetches the zip onto the runner host (buildkit container often times out on GitHub).
# Local/dev builds without the cache file fall back to curl with retries.
COPY .docker-cache/xray/ /prefetch/xray/
RUN apk add --no-cache ca-certificates curl unzip \
    && mkdir -p /out \
    && case "${TARGETARCH:-amd64}" in \
         amd64) XRAY_ARCH=64 ;; \
         arm64) XRAY_ARCH=arm64-v8a ;; \
         arm) XRAY_ARCH=arm32-v7a ;; \
         *) echo "Unsupported TARGETARCH=${TARGETARCH}" >&2; exit 1 ;; \
       esac \
    && PREFETCH="/prefetch/xray/Xray-linux-${XRAY_ARCH}.zip" \
    && if [ -f "$PREFETCH" ] && [ -s "$PREFETCH" ]; then \
         echo "Using prefetched Xray zip: ${PREFETCH}"; \
         cp "$PREFETCH" /tmp/xray.zip; \
       else \
         echo "Prefetch miss — downloading Xray ${XRAY_VERSION} (${XRAY_ARCH})"; \
         curl -fsSL \
           --retry 8 \
           --retry-all-errors \
           --retry-delay 5 \
           --connect-timeout 30 \
           --max-time 600 \
           "https://github.com/XTLS/Xray-core/releases/download/${XRAY_VERSION}/Xray-linux-${XRAY_ARCH}.zip" \
           -o /tmp/xray.zip; \
       fi \
    && unzip -q /tmp/xray.zip -d /tmp/xray \
    && install -m 755 /tmp/xray/xray /out/xray \
    && install -m 644 /tmp/xray/geoip.dat /out/geoip.dat \
    && install -m 644 /tmp/xray/geosite.dat /out/geosite.dat \
    && rm -rf /tmp/xray /tmp/xray.zip

FROM node:24-bookworm-slim AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable
WORKDIR /workspace

FROM base AS dependencies

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/agent/package.json apps/agent/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile --filter @overvpn/api...

FROM dependencies AS build

COPY tsconfig.base.json turbo.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"
RUN pnpm --filter @overvpn/api prisma:generate \
    && pnpm --filter @overvpn/shared build \
    && pnpm --filter @overvpn/api build

FROM base AS runtime

ARG OVERVPN_GIT_SHA=
ENV OVERVPN_GIT_SHA="${OVERVPN_GIT_SHA}"
ENV NODE_ENV="production"
ENV HOST="0.0.0.0"
ENV PORT="3000"
RUN apt-get update \
    && apt-get install --yes --no-install-recommends dumb-init postgresql-client \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build --chown=node:node /workspace/package.json /workspace/pnpm-lock.yaml /workspace/pnpm-workspace.yaml ./
COPY --from=build --chown=node:node /workspace/node_modules ./node_modules
COPY --from=build --chown=node:node /workspace/packages/shared ./packages/shared
COPY --from=build --chown=node:node /workspace/apps/api ./apps/api
COPY --from=singbox-build /out/sing-box /usr/local/bin/sing-box
COPY --chmod=755 deploy/sing-box/entrypoint.sh /usr/local/bin/sing-box-entrypoint
COPY --from=xray-build /out/xray /usr/local/bin/xray
COPY --from=xray-build /out/geoip.dat /usr/local/share/xray/geoip.dat
COPY --from=xray-build /out/geosite.dat /usr/local/share/xray/geosite.dat
COPY --chmod=755 deploy/xray/entrypoint.sh /usr/local/bin/xray-entrypoint
ENV XRAY_LOCATION_ASSET=/usr/local/share/xray

USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health/ready').then((response) => { if (!response.ok) process.exit(1) }).catch(() => process.exit(1))"]
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "apps/api/dist/main.js"]
