-- Phase 1 domain alignment. This migration intentionally follows the applied Phase 0 migration.

-- Roles keep their persisted meaning while adopting the product vocabulary.
ALTER TYPE "AdminRole" RENAME VALUE 'AUDITOR' TO 'READONLY';

-- Replace enums whose Phase 0 values cannot be removed in place.
ALTER TABLE "users" ALTER COLUMN "status" DROP DEFAULT;
ALTER TYPE "UserStatus" RENAME TO "UserStatus_phase0";
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED', 'EXPIRED', 'LIMITED');
ALTER TABLE "users"
  ALTER COLUMN "status" TYPE "UserStatus"
  USING (
    CASE "status"::text
      WHEN 'PENDING' THEN 'ACTIVE'
      WHEN 'SUSPENDED' THEN 'DISABLED'
      ELSE "status"::text
    END
  )::"UserStatus";
DROP TYPE "UserStatus_phase0";
ALTER TABLE "users" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';

ALTER TYPE "InboundProtocol" RENAME TO "InboundProtocol_phase0";
CREATE TYPE "InboundProtocol" AS ENUM (
  'HYSTERIA2',
  'VLESS_REALITY',
  'TROJAN',
  'SHADOWSOCKS'
);
ALTER TABLE "inbounds"
  ALTER COLUMN "protocol" TYPE "InboundProtocol"
  USING (
    CASE "protocol"::text
      WHEN 'VLESS' THEN 'VLESS_REALITY'
      WHEN 'VMESS' THEN 'VLESS_REALITY'
      WHEN 'WIREGUARD' THEN 'HYSTERIA2'
      ELSE "protocol"::text
    END
  )::"InboundProtocol";
DROP TYPE "InboundProtocol_phase0";

CREATE TYPE "ResetStrategy" AS ENUM ('NO_RESET', 'DAILY', 'MONTHLY', 'YEARLY');

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ADMIN_REFRESH';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ADMIN_TOTP_ENABLE';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ADMIN_TOTP_CONFIRM';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ADMIN_TOTP_DISABLE';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'USER_DELETE';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'USER_ENABLE';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'USER_RESET_TRAFFIC';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'USER_EXTEND';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'USER_SET_PLAN';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'USER_ROTATE_SUB';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PLAN_DELETE';

-- Administrator authentication state.
DROP INDEX "admin_users_role_isActive_idx";
ALTER TABLE "admin_users" RENAME COLUMN "isActive" TO "active";
ALTER TABLE "admin_users"
  ADD COLUMN "pendingTotpSecretEncrypted" TEXT,
  ADD COLUMN "totpSecretEncrypted" TEXT;
CREATE INDEX "admin_users_role_active_idx" ON "admin_users"("role", "active");

ALTER TABLE "refresh_tokens"
  ADD COLUMN "revocationReason" VARCHAR(64),
  ADD COLUMN "ipAddress" VARCHAR(64),
  ADD COLUMN "userAgent" VARCHAR(512);

-- VPN user domain.
DROP INDEX "users_planId_idx";
DROP INDEX "users_status_expiresAt_idx";
DROP INDEX "users_deletedAt_idx";
ALTER TABLE "users" DROP CONSTRAINT "users_deviceLimit_check";
ALTER TABLE "users" DROP CONSTRAINT "users_trafficLimitBytes_check";

ALTER TABLE "users"
  RENAME COLUMN "expiresAt" TO "expireAt";
ALTER TABLE "users"
  RENAME COLUMN "trafficLimitBytes" TO "dataLimitBytes";
ALTER TABLE "users"
  RENAME COLUMN "notes" TO "note";

ALTER TABLE "users"
  ADD COLUMN "identity" VARCHAR(128),
  ADD COLUMN "statusReason" VARCHAR(32),
  ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "usedUploadBytes" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "usedDownloadBytes" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "resetStrategy" "ResetStrategy" NOT NULL DEFAULT 'NO_RESET',
  ADD COLUMN "nextResetAt" TIMESTAMPTZ(3),
  ADD COLUMN "ipLimit" INTEGER,
  ADD COLUMN "speedLimitBps" BIGINT,
  ADD COLUMN "subToken" VARCHAR(64),
  ADD COLUMN "needsApply" BOOLEAN NOT NULL DEFAULT true;

UPDATE "users"
SET
  "identity" = "username",
  "statusReason" = CASE
    WHEN "status" = 'DISABLED' THEN 'manual'
    WHEN "status" = 'EXPIRED' THEN 'expired'
    ELSE NULL
  END;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
UPDATE "users"
SET "subToken" = rtrim(
  translate(encode(gen_random_bytes(32), 'base64'), '+/', '-_'),
  '='
);

ALTER TABLE "users"
  ALTER COLUMN "identity" SET NOT NULL,
  ALTER COLUMN "subToken" SET NOT NULL,
  ALTER COLUMN "deviceLimit" DROP DEFAULT,
  ALTER COLUMN "deviceLimit" DROP NOT NULL,
  DROP COLUMN "displayName",
  DROP COLUMN "locale";

CREATE UNIQUE INDEX "users_identity_key" ON "users"("identity");
CREATE UNIQUE INDEX "users_subToken_key" ON "users"("subToken");
CREATE INDEX "users_planId_deletedAt_idx" ON "users"("planId", "deletedAt");
CREATE INDEX "users_status_expireAt_idx" ON "users"("status", "expireAt");
CREATE INDEX "users_tags_idx" ON "users" USING GIN ("tags");
CREATE INDEX "users_deletedAt_createdAt_idx" ON "users"("deletedAt", "createdAt");

ALTER TABLE "users"
  ADD CONSTRAINT "users_status_reason_check" CHECK (
    ("status" = 'ACTIVE' AND "statusReason" IS NULL)
    OR ("status" = 'DISABLED' AND "statusReason" = 'manual')
    OR ("status" = 'EXPIRED' AND "statusReason" = 'expired')
    OR ("status" = 'LIMITED' AND "statusReason" IN ('quota', 'device', 'ip'))
  ),
  ADD CONSTRAINT "users_data_limit_check" CHECK (
    "dataLimitBytes" IS NULL OR "dataLimitBytes" >= 0
  ),
  ADD CONSTRAINT "users_used_upload_check" CHECK ("usedUploadBytes" >= 0),
  ADD CONSTRAINT "users_used_download_check" CHECK ("usedDownloadBytes" >= 0),
  ADD CONSTRAINT "users_device_limit_check" CHECK (
    "deviceLimit" IS NULL OR "deviceLimit" > 0
  ),
  ADD CONSTRAINT "users_ip_limit_check" CHECK (
    "ipLimit" IS NULL OR "ipLimit" > 0
  ),
  ADD CONSTRAINT "users_speed_limit_check" CHECK (
    "speedLimitBps" IS NULL OR "speedLimitBps" >= 0
  );

-- Plan defaults and normalized plan_inbounds are the source for new-user defaults.
ALTER TABLE "plans" DROP CONSTRAINT "plans_deviceLimit_check";
ALTER TABLE "plans" DROP CONSTRAINT "plans_durationDays_check";
ALTER TABLE "plans" DROP CONSTRAINT "plans_trafficLimitBytes_check";
ALTER TABLE "plans"
  RENAME COLUMN "durationDays" TO "defaultExpiryDays";
ALTER TABLE "plans"
  RENAME COLUMN "trafficLimitBytes" TO "defaultDataLimitBytes";
ALTER TABLE "plans"
  RENAME COLUMN "deviceLimit" TO "defaultDeviceLimit";
ALTER TABLE "plans"
  ADD COLUMN "defaultIpLimit" INTEGER,
  ADD COLUMN "defaultSpeedLimitBps" BIGINT,
  ADD COLUMN "defaultResetStrategy" "ResetStrategy" NOT NULL DEFAULT 'NO_RESET';
ALTER TABLE "plans"
  ALTER COLUMN "defaultDeviceLimit" DROP DEFAULT,
  ALTER COLUMN "defaultDeviceLimit" DROP NOT NULL;
ALTER TABLE "plans"
  ADD CONSTRAINT "plans_default_device_limit_check" CHECK (
    "defaultDeviceLimit" IS NULL OR "defaultDeviceLimit" > 0
  ),
  ADD CONSTRAINT "plans_default_ip_limit_check" CHECK (
    "defaultIpLimit" IS NULL OR "defaultIpLimit" > 0
  ),
  ADD CONSTRAINT "plans_default_expiry_days_check" CHECK (
    "defaultExpiryDays" IS NULL OR "defaultExpiryDays" > 0
  ),
  ADD CONSTRAINT "plans_default_data_limit_check" CHECK (
    "defaultDataLimitBytes" IS NULL OR "defaultDataLimitBytes" >= 0
  ),
  ADD CONSTRAINT "plans_default_speed_limit_check" CHECK (
    "defaultSpeedLimitBps" IS NULL OR "defaultSpeedLimitBps" >= 0
  );

-- Pending core changes are durable records, not claims that Phase 2 applied them.
ALTER TABLE "core_apply_records"
  ALTER COLUMN "configRevision" DROP NOT NULL,
  ALTER COLUMN "configChecksum" DROP NOT NULL,
  ADD COLUMN "resourceType" VARCHAR(100),
  ADD COLUMN "resourceId" VARCHAR(255),
  ADD COLUMN "operation" VARCHAR(100);
CREATE INDEX "core_apply_records_resourceType_resourceId_status_idx"
  ON "core_apply_records"("resourceType", "resourceId", "status");

-- Audit events are append-only. Actor rows with audit history cannot be deleted.
ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_actorAdminId_fkey";
ALTER TABLE "audit_logs"
  ADD CONSTRAINT "audit_logs_actorAdminId_fkey"
  FOREIGN KEY ("actorAdminId") REFERENCES "admin_users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION prevent_audit_log_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "audit_logs_immutable"
BEFORE UPDATE OR DELETE ON "audit_logs"
FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation();
