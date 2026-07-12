-- Phase 4 durable accounting, online-session enforcement, and system workers.
-- This migration follows all earlier phases and preserves their data.

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SYSTEM_USER_STATUS_CHANGE';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SYSTEM_TRAFFIC_RESET';
ALTER TYPE "CoreApplyTrigger" ADD VALUE IF NOT EXISTS 'ENFORCEMENT';

ALTER TABLE "users"
  ADD COLUMN "accountingEpoch" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "trafficResetAt" TIMESTAMPTZ(3);

ALTER TABLE "users"
  ADD CONSTRAINT "users_accounting_epoch_check" CHECK ("accountingEpoch" >= 0);

-- V2Ray user statistics are aggregate totals across all inbounds. Existing
-- per-inbound rows retain a deterministic scope while new rows use scopeKey=user.
ALTER TABLE "usage_daily"
  ALTER COLUMN "inboundId" DROP NOT NULL,
  ADD COLUMN "scopeKey" VARCHAR(128);

UPDATE "usage_daily"
SET "scopeKey" = 'inbound:' || "inboundId"::TEXT;

ALTER TABLE "usage_daily"
  ALTER COLUMN "scopeKey" SET NOT NULL;

DROP INDEX "usage_daily_userId_inboundId_day_key";
CREATE UNIQUE INDEX "usage_daily_userId_day_scopeKey_key"
  ON "usage_daily"("userId", "day", "scopeKey");

CREATE TABLE "traffic_cursors" (
  "statsKey" VARCHAR(128) NOT NULL,
  "userId" UUID NOT NULL,
  "lastUploadBytes" BIGINT NOT NULL,
  "lastDownloadBytes" BIGINT NOT NULL,
  "accountingEpoch" INTEGER NOT NULL,
  "generation" INTEGER NOT NULL DEFAULT 0,
  "lastSampleHash" CHAR(64) NOT NULL,
  "observedAt" TIMESTAMPTZ(3) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "traffic_cursors_pkey" PRIMARY KEY ("statsKey"),
  CONSTRAINT "traffic_cursors_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "traffic_cursors_last_upload_check" CHECK ("lastUploadBytes" >= 0),
  CONSTRAINT "traffic_cursors_last_download_check" CHECK ("lastDownloadBytes" >= 0),
  CONSTRAINT "traffic_cursors_accounting_epoch_check" CHECK ("accountingEpoch" >= 0),
  CONSTRAINT "traffic_cursors_generation_check" CHECK ("generation" >= 0)
);

CREATE UNIQUE INDEX "traffic_cursors_userId_key"
  ON "traffic_cursors"("userId");
CREATE INDEX "traffic_cursors_observedAt_idx"
  ON "traffic_cursors"("observedAt");

CREATE TABLE "traffic_deltas" (
  "id" BIGSERIAL NOT NULL,
  "userId" UUID NOT NULL,
  "uploadBytes" BIGINT NOT NULL,
  "downloadBytes" BIGINT NOT NULL,
  "observedAt" TIMESTAMPTZ(3) NOT NULL,
  "aggregatedAt" TIMESTAMPTZ(3),
  "source" "TrafficCheckpointSource" NOT NULL DEFAULT 'CORE_POLL',
  "generation" INTEGER NOT NULL,
  "sampleKey" CHAR(64) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "traffic_deltas_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "traffic_deltas_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "traffic_deltas_upload_check" CHECK ("uploadBytes" >= 0),
  CONSTRAINT "traffic_deltas_download_check" CHECK ("downloadBytes" >= 0),
  CONSTRAINT "traffic_deltas_positive_check"
    CHECK ("uploadBytes" > 0 OR "downloadBytes" > 0),
  CONSTRAINT "traffic_deltas_generation_check" CHECK ("generation" >= 0)
);

CREATE UNIQUE INDEX "traffic_deltas_sampleKey_key"
  ON "traffic_deltas"("sampleKey");
CREATE INDEX "traffic_deltas_aggregatedAt_id_idx"
  ON "traffic_deltas"("aggregatedAt", "id");
CREATE INDEX "traffic_deltas_aggregatedAt_observedAt_idx"
  ON "traffic_deltas"("aggregatedAt", "observedAt");
CREATE INDEX "traffic_deltas_userId_observedAt_idx"
  ON "traffic_deltas"("userId", "observedAt");
CREATE INDEX "traffic_deltas_unaggregated_idx"
  ON "traffic_deltas"("id") WHERE "aggregatedAt" IS NULL;

CREATE INDEX "online_sessions_disconnectedAt_lastSeenAt_idx"
  ON "online_sessions"("disconnectedAt", "lastSeenAt");
CREATE INDEX "online_sessions_ipAddress_disconnectedAt_idx"
  ON "online_sessions"("ipAddress", "disconnectedAt");
