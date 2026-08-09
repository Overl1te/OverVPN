# @overvpn/agent

Lightweight Fastify agent that runs on a **proxy node**. It exposes a local HTTP API for the panel (push apply/status/cores) and talks back to the panel (register, heartbeat, optional desired-state pull).

## Endpoints (Bearer `NODE_TOKEN`)

| Method | Path         | Notes                                       |
| ------ | ------------ | ------------------------------------------- |
| `GET`  | `/health`    | Public liveness                             |
| `GET`  | `/v1/status` | Engine probe + applied revision             |
| `POST` | `/v1/apply`  | Write core configs + reload handshake       |
| `POST` | `/v1/cores`  | Stub (`enable` / `disable` / `update`)      |
| `POST` | `/v1/reload` | Re-handshake reload for last applied hashes |

Request/response bodies use Zod contracts from `@overvpn/shared/schemas`.

## Environment

| Variable                 | Required          | Default                       | Purpose                                              |
| ------------------------ | ----------------- | ----------------------------- | ---------------------------------------------------- |
| `PANEL_URL`              | yes               | —                             | Panel base URL (e.g. `https://panel.example`)        |
| `NODE_ID`                | yes               | —                             | Proxy server UUID (`/api/agent/nodes/:id/...`)       |
| `NODE_TOKEN`             | one of token pair | —                             | Auth for local API + panel calls                     |
| `INSTALL_TOKEN`          | one of token pair | —                             | First-time register with panel                       |
| `AGENT_LISTEN`           | no                | `7700`                        | `PORT` or `HOST:PORT`                                |
| `AGENT_BASE_URL`         | for register      | —                             | Reachable agent URL sent at register                 |
| `AGENT_HOSTNAME`         | no                | OS hostname                   | Register/status hostname                             |
| `HEARTBEAT_INTERVAL_SEC` | no                | `20`                          | Panel heartbeat period                               |
| `PULL_DESIRED_ENABLED`   | no                | `true`                        | Pull desired state from panel                        |
| `SKIP_CORE_RELOAD`       | no                | `false`                       | Write configs but skip sidecar handshake (local/dev) |
| `AGENT_STATE_PATH`       | no                | `~/.overvpn/agent-state.json` | Persist node token after register                    |

Config/reload paths mirror the API defaults (`SING_BOX_*`, `XRAY_*`, `MTPROXY_*`).

Panel routes (per node):

- `POST /api/agent/nodes/:id/register`
- `POST /api/agent/nodes/:id/heartbeat`
- `GET /api/agent/nodes/:id/desired`
- `POST /api/agent/nodes/:id/stats`
- `POST /api/agent/nodes/:id/apply-result`

## Local run

```bash
pnpm --filter @overvpn/shared build
pnpm --filter @overvpn/agent build

# Mock panel — health still works; heartbeat errors are logged and ignored
set PANEL_URL=http://127.0.0.1:9
set NODE_ID=00000000-0000-4000-8000-000000000001
set NODE_TOKEN=dev-node-token-0123456789abcdef0123
set SKIP_CORE_RELOAD=true
set AGENT_LISTEN=7700
pnpm --filter @overvpn/agent start

curl http://127.0.0.1:7700/health
```

## Docker

```bash
docker compose -f deploy/docker-compose.proxy.yml --env-file .env up -d --build agent
```

Image build context is the repo root (`deploy/agent/Dockerfile`).
