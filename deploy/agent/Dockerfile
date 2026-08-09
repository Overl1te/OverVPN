FROM node:24-bookworm-slim AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable
WORKDIR /workspace

FROM base AS build

# Workspace package.json stubs keep the lockfile happy; only agent+shared are installed/built.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/agent/package.json apps/agent/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile --filter @overvpn/agent...

COPY tsconfig.base.json turbo.json ./
COPY packages/shared packages/shared
COPY apps/agent apps/agent
RUN pnpm --filter @overvpn/shared build \
    && pnpm --filter @overvpn/agent build \
    && pnpm --filter @overvpn/agent deploy --prod --legacy /out

FROM node:24-bookworm-slim AS runtime

ARG OVERVPN_GIT_SHA=
ENV OVERVPN_GIT_SHA="${OVERVPN_GIT_SHA}"
ENV NODE_ENV="production"
ENV AGENT_LISTEN="0.0.0.0:7700"
ENV AGENT_STATE_PATH="/var/lib/overvpn/agent/state.json"

RUN apt-get update \
    && apt-get install --yes --no-install-recommends dumb-init ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /app \
    && chown node:node /app

WORKDIR /app
COPY --from=build --chown=node:node /out/ ./
COPY --chmod=755 deploy/agent/entrypoint.sh /usr/local/bin/overvpn-agent-entrypoint

USER node
EXPOSE 7700
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:7700/health').then((response) => { if (!response.ok) process.exit(1) }).catch(() => process.exit(1))"]
ENTRYPOINT ["dumb-init", "--", "overvpn-agent-entrypoint"]
CMD ["node", "dist/main.js"]
