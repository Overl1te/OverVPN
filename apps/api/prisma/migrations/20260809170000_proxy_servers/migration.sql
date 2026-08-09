-- Multi-node: ProxyServer + Inbound.proxyServerId (breaking; fresh install expected).

CREATE TYPE "ProxyServerStatus" AS ENUM ('PENDING', 'ONLINE', 'OFFLINE', 'ERROR', 'DISABLED');

CREATE TABLE "proxy_servers" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "status" "ProxyServerStatus" NOT NULL DEFAULT 'PENDING',
    "agentBaseUrl" VARCHAR(512),
    "installTokenHash" VARCHAR(128),
    "installTokenExpiresAt" TIMESTAMPTZ(3),
    "nodeTokenHash" VARCHAR(128),
    "publicHost" VARCHAR(255),
    "enabledEngines" JSONB NOT NULL DEFAULT '[]',
    "enabledProtocols" JSONB NOT NULL DEFAULT '[]',
    "capabilities" JSONB NOT NULL DEFAULT '{}',
    "lastSeenAt" TIMESTAMPTZ(3),
    "lastError" TEXT,
    "heartbeatIntervalSec" INTEGER NOT NULL DEFAULT 20,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "isLocal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "proxy_servers_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "proxy_servers_status_lastSeenAt_idx" ON "proxy_servers"("status", "lastSeenAt");
CREATE INDEX "proxy_servers_isLocal_idx" ON "proxy_servers"("isLocal");

CREATE TABLE "proxy_core_state" (
    "proxyServerId" UUID NOT NULL,
    "engine" "CoreEngine" NOT NULL,
    "desiredRevision" INTEGER NOT NULL DEFAULT 0,
    "appliedRevision" INTEGER NOT NULL DEFAULT 0,
    "appliedConfigHash" CHAR(64),
    "configPath" VARCHAR(512) NOT NULL,
    "lastApplyRecordId" UUID,
    "appliedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "proxy_core_state_pkey" PRIMARY KEY ("proxyServerId","engine")
);

ALTER TABLE "proxy_core_state" ADD CONSTRAINT "proxy_core_state_proxyServerId_fkey" FOREIGN KEY ("proxyServerId") REFERENCES "proxy_servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed a local placeholder so existing inbound rows (if any) can be reattached; wipe installs start empty.
INSERT INTO "proxy_servers" ("id", "name", "status", "isLocal", "updatedAt")
VALUES ('00000000-0000-4000-8000-000000000001', 'local', 'PENDING', true, CURRENT_TIMESTAMP);

ALTER TABLE "inbounds" DROP CONSTRAINT IF EXISTS "inbounds_tag_key";
DROP INDEX IF EXISTS "inbounds_listenHost_listenPort_idx";
DROP INDEX IF EXISTS "inbounds_tag_key";

ALTER TABLE "inbounds" ADD COLUMN "proxyServerId" UUID;

UPDATE "inbounds" SET "proxyServerId" = '00000000-0000-4000-8000-000000000001' WHERE "proxyServerId" IS NULL;

ALTER TABLE "inbounds" ALTER COLUMN "proxyServerId" SET NOT NULL;

ALTER TABLE "inbounds" ADD CONSTRAINT "inbounds_proxyServerId_fkey" FOREIGN KEY ("proxyServerId") REFERENCES "proxy_servers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "inbounds_proxyServerId_tag_key" ON "inbounds"("proxyServerId", "tag");
CREATE UNIQUE INDEX "inbounds_proxyServerId_listenHost_listenPort_key" ON "inbounds"("proxyServerId", "listenHost", "listenPort");
CREATE INDEX "inbounds_proxyServerId_enabled_idx" ON "inbounds"("proxyServerId", "enabled");

ALTER TABLE "core_apply_records" ADD COLUMN "proxyServerId" UUID;
ALTER TABLE "core_apply_records" ADD CONSTRAINT "core_apply_records_proxyServerId_fkey" FOREIGN KEY ("proxyServerId") REFERENCES "proxy_servers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "core_apply_records_proxyServerId_status_createdAt_idx" ON "core_apply_records"("proxyServerId", "status", "createdAt");
