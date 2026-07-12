-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('OWNER', 'ADMIN', 'AUDITOR');

-- CreateEnum
CREATE TYPE "Locale" AS ENUM ('en', 'ru');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'EXPIRED', 'DISABLED');

-- CreateEnum
CREATE TYPE "PlanStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "InboundProtocol" AS ENUM ('VLESS', 'VMESS', 'TROJAN', 'SHADOWSOCKS', 'WIREGUARD');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "TrafficCheckpointSource" AS ENUM ('CORE_POLL', 'RECONCILIATION');

-- CreateEnum
CREATE TYPE "AuditOutcome" AS ENUM ('SUCCESS', 'FAILURE');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('ADMIN_LOGIN', 'ADMIN_LOGOUT', 'ADMIN_CREATE', 'ADMIN_UPDATE', 'USER_CREATE', 'USER_UPDATE', 'USER_DISABLE', 'PLAN_CREATE', 'PLAN_UPDATE', 'PLAN_ARCHIVE', 'INBOUND_CREATE', 'INBOUND_UPDATE', 'INBOUND_DISABLE', 'SYSTEM_CONFIG_UPDATE', 'CORE_APPLY', 'BACKUP_CREATE', 'BACKUP_RESTORE');

-- CreateEnum
CREATE TYPE "CoreApplyStatus" AS ENUM ('PENDING', 'APPLYING', 'SUCCEEDED', 'FAILED', 'ROLLED_BACK');

-- CreateEnum
CREATE TYPE "CoreApplyTrigger" AS ENUM ('MANUAL', 'SYSTEM_RECONCILIATION');

-- CreateEnum
CREATE TYPE "BackupKind" AS ENUM ('DATABASE', 'CORE_CONFIG', 'FULL');

-- CreateEnum
CREATE TYPE "BackupStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'DELETED');

-- CreateTable
CREATE TABLE "admin_users" (
    "id" UUID NOT NULL,
    "username" VARCHAR(64) NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "AdminRole" NOT NULL DEFAULT 'ADMIN',
    "locale" "Locale" NOT NULL DEFAULT 'en',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "adminUserId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "familyId" UUID NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),
    "replacedByTokenId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "username" VARCHAR(64) NOT NULL,
    "displayName" VARCHAR(128),
    "status" "UserStatus" NOT NULL DEFAULT 'PENDING',
    "locale" "Locale" NOT NULL DEFAULT 'en',
    "planId" UUID,
    "expiresAt" TIMESTAMPTZ(3),
    "trafficLimitBytes" BIGINT,
    "deviceLimit" INTEGER NOT NULL DEFAULT 1,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "disabledAt" TIMESTAMPTZ(3),
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plans" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "status" "PlanStatus" NOT NULL DEFAULT 'ACTIVE',
    "durationDays" INTEGER,
    "trafficLimitBytes" BIGINT,
    "deviceLimit" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "archivedAt" TIMESTAMPTZ(3),

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inbounds" (
    "id" UUID NOT NULL,
    "tag" VARCHAR(100) NOT NULL,
    "protocol" "InboundProtocol" NOT NULL,
    "listenHost" VARCHAR(255) NOT NULL DEFAULT '0.0.0.0',
    "listenPort" INTEGER NOT NULL,
    "publicHost" VARCHAR(255),
    "publicPort" INTEGER,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "disabledAt" TIMESTAMPTZ(3),

    CONSTRAINT "inbounds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_inbounds" (
    "planId" UUID NOT NULL,
    "inboundId" UUID NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "plan_inbounds_pkey" PRIMARY KEY ("planId","inboundId")
);

-- CreateTable
CREATE TABLE "user_inbound_assignments" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "inboundId" UUID NOT NULL,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "credentialData" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "disabledAt" TIMESTAMPTZ(3),

    CONSTRAINT "user_inbound_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_daily" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "inboundId" UUID NOT NULL,
    "day" DATE NOT NULL,
    "uploadBytes" BIGINT NOT NULL DEFAULT 0,
    "downloadBytes" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "usage_daily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "traffic_checkpoints" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "inboundId" UUID NOT NULL,
    "source" "TrafficCheckpointSource" NOT NULL DEFAULT 'CORE_POLL',
    "uploadBytes" BIGINT NOT NULL,
    "downloadBytes" BIGINT NOT NULL,
    "observedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "traffic_checkpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "online_sessions" (
    "id" UUID NOT NULL,
    "sessionKey" VARCHAR(255) NOT NULL,
    "userId" UUID NOT NULL,
    "inboundId" UUID NOT NULL,
    "ipAddress" VARCHAR(64),
    "deviceId" VARCHAR(255),
    "connectedAt" TIMESTAMPTZ(3) NOT NULL,
    "lastSeenAt" TIMESTAMPTZ(3) NOT NULL,
    "disconnectedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "online_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" BIGSERIAL NOT NULL,
    "actorAdminId" UUID,
    "action" "AuditAction" NOT NULL,
    "outcome" "AuditOutcome" NOT NULL DEFAULT 'SUCCESS',
    "resourceType" VARCHAR(100),
    "resourceId" VARCHAR(255),
    "requestId" VARCHAR(128),
    "ipAddress" VARCHAR(64),
    "details" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_config" (
    "key" VARCHAR(150) NOT NULL,
    "value" JSONB NOT NULL,
    "description" TEXT,
    "isSecret" BOOLEAN NOT NULL DEFAULT false,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "updatedByAdminId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "system_config_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "core_apply_records" (
    "id" UUID NOT NULL,
    "status" "CoreApplyStatus" NOT NULL DEFAULT 'PENDING',
    "trigger" "CoreApplyTrigger" NOT NULL DEFAULT 'MANUAL',
    "configRevision" INTEGER NOT NULL,
    "configChecksum" CHAR(64) NOT NULL,
    "initiatedByAdminId" UUID,
    "startedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "errorMessage" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "core_apply_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backup_artifacts" (
    "id" UUID NOT NULL,
    "kind" "BackupKind" NOT NULL,
    "status" "BackupStatus" NOT NULL DEFAULT 'PENDING',
    "storagePath" TEXT NOT NULL,
    "sizeBytes" BIGINT,
    "checksum" CHAR(64),
    "encrypted" BOOLEAN NOT NULL DEFAULT true,
    "createdByAdminId" UUID,
    "startedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "expiresAt" TIMESTAMPTZ(3),
    "errorMessage" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "backup_artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_username_key" ON "admin_users"("username");

-- CreateIndex
CREATE INDEX "admin_users_role_isActive_idx" ON "admin_users"("role", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_tokenHash_key" ON "refresh_tokens"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_replacedByTokenId_key" ON "refresh_tokens"("replacedByTokenId");

-- CreateIndex
CREATE INDEX "refresh_tokens_adminUserId_expiresAt_idx" ON "refresh_tokens"("adminUserId", "expiresAt");

-- CreateIndex
CREATE INDEX "refresh_tokens_familyId_idx" ON "refresh_tokens"("familyId");

-- CreateIndex
CREATE INDEX "refresh_tokens_revokedAt_idx" ON "refresh_tokens"("revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE INDEX "users_planId_idx" ON "users"("planId");

-- CreateIndex
CREATE INDEX "users_status_expiresAt_idx" ON "users"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "users_deletedAt_idx" ON "users"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "plans_name_key" ON "plans"("name");

-- CreateIndex
CREATE INDEX "plans_status_idx" ON "plans"("status");

-- CreateIndex
CREATE UNIQUE INDEX "inbounds_tag_key" ON "inbounds"("tag");

-- CreateIndex
CREATE INDEX "inbounds_enabled_protocol_idx" ON "inbounds"("enabled", "protocol");

-- CreateIndex
CREATE INDEX "inbounds_listenHost_listenPort_idx" ON "inbounds"("listenHost", "listenPort");

-- CreateIndex
CREATE INDEX "plan_inbounds_inboundId_idx" ON "plan_inbounds"("inboundId");

-- CreateIndex
CREATE INDEX "plan_inbounds_planId_enabled_priority_idx" ON "plan_inbounds"("planId", "enabled", "priority");

-- CreateIndex
CREATE INDEX "user_inbound_assignments_inboundId_status_idx" ON "user_inbound_assignments"("inboundId", "status");

-- CreateIndex
CREATE INDEX "user_inbound_assignments_userId_status_idx" ON "user_inbound_assignments"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "user_inbound_assignments_userId_inboundId_key" ON "user_inbound_assignments"("userId", "inboundId");

-- CreateIndex
CREATE INDEX "usage_daily_day_idx" ON "usage_daily"("day");

-- CreateIndex
CREATE INDEX "usage_daily_inboundId_day_idx" ON "usage_daily"("inboundId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "usage_daily_userId_inboundId_day_key" ON "usage_daily"("userId", "inboundId", "day");

-- CreateIndex
CREATE INDEX "traffic_checkpoints_userId_observedAt_idx" ON "traffic_checkpoints"("userId", "observedAt");

-- CreateIndex
CREATE INDEX "traffic_checkpoints_inboundId_observedAt_idx" ON "traffic_checkpoints"("inboundId", "observedAt");

-- CreateIndex
CREATE UNIQUE INDEX "online_sessions_sessionKey_key" ON "online_sessions"("sessionKey");

-- CreateIndex
CREATE INDEX "online_sessions_userId_disconnectedAt_lastSeenAt_idx" ON "online_sessions"("userId", "disconnectedAt", "lastSeenAt");

-- CreateIndex
CREATE INDEX "online_sessions_inboundId_disconnectedAt_lastSeenAt_idx" ON "online_sessions"("inboundId", "disconnectedAt", "lastSeenAt");

-- CreateIndex
CREATE INDEX "audit_logs_actorAdminId_createdAt_idx" ON "audit_logs"("actorAdminId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_action_createdAt_idx" ON "audit_logs"("action", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_resourceType_resourceId_idx" ON "audit_logs"("resourceType", "resourceId");

-- CreateIndex
CREATE INDEX "audit_logs_requestId_idx" ON "audit_logs"("requestId");

-- CreateIndex
CREATE INDEX "system_config_updatedByAdminId_idx" ON "system_config"("updatedByAdminId");

-- CreateIndex
CREATE INDEX "core_apply_records_status_createdAt_idx" ON "core_apply_records"("status", "createdAt");

-- CreateIndex
CREATE INDEX "core_apply_records_initiatedByAdminId_idx" ON "core_apply_records"("initiatedByAdminId");

-- CreateIndex
CREATE UNIQUE INDEX "backup_artifacts_storagePath_key" ON "backup_artifacts"("storagePath");

-- CreateIndex
CREATE INDEX "backup_artifacts_status_createdAt_idx" ON "backup_artifacts"("status", "createdAt");

-- CreateIndex
CREATE INDEX "backup_artifacts_kind_createdAt_idx" ON "backup_artifacts"("kind", "createdAt");

-- CreateIndex
CREATE INDEX "backup_artifacts_createdByAdminId_idx" ON "backup_artifacts"("createdByAdminId");

-- CreateIndex
CREATE INDEX "backup_artifacts_expiresAt_idx" ON "backup_artifacts"("expiresAt");

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_replacedByTokenId_fkey" FOREIGN KEY ("replacedByTokenId") REFERENCES "refresh_tokens"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_inbounds" ADD CONSTRAINT "plan_inbounds_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_inbounds" ADD CONSTRAINT "plan_inbounds_inboundId_fkey" FOREIGN KEY ("inboundId") REFERENCES "inbounds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_inbound_assignments" ADD CONSTRAINT "user_inbound_assignments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_inbound_assignments" ADD CONSTRAINT "user_inbound_assignments_inboundId_fkey" FOREIGN KEY ("inboundId") REFERENCES "inbounds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_daily" ADD CONSTRAINT "usage_daily_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_daily" ADD CONSTRAINT "usage_daily_inboundId_fkey" FOREIGN KEY ("inboundId") REFERENCES "inbounds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "traffic_checkpoints" ADD CONSTRAINT "traffic_checkpoints_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "traffic_checkpoints" ADD CONSTRAINT "traffic_checkpoints_inboundId_fkey" FOREIGN KEY ("inboundId") REFERENCES "inbounds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "online_sessions" ADD CONSTRAINT "online_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "online_sessions" ADD CONSTRAINT "online_sessions_inboundId_fkey" FOREIGN KEY ("inboundId") REFERENCES "inbounds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorAdminId_fkey" FOREIGN KEY ("actorAdminId") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "system_config" ADD CONSTRAINT "system_config_updatedByAdminId_fkey" FOREIGN KEY ("updatedByAdminId") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core_apply_records" ADD CONSTRAINT "core_apply_records_initiatedByAdminId_fkey" FOREIGN KEY ("initiatedByAdminId") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backup_artifacts" ADD CONSTRAINT "backup_artifacts_createdByAdminId_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Domain integrity checks not currently expressible in Prisma Schema Language
ALTER TABLE "users"
    ADD CONSTRAINT "users_deviceLimit_check" CHECK ("deviceLimit" > 0),
    ADD CONSTRAINT "users_trafficLimitBytes_check" CHECK ("trafficLimitBytes" IS NULL OR "trafficLimitBytes" >= 0);

ALTER TABLE "plans"
    ADD CONSTRAINT "plans_deviceLimit_check" CHECK ("deviceLimit" > 0),
    ADD CONSTRAINT "plans_durationDays_check" CHECK ("durationDays" IS NULL OR "durationDays" > 0),
    ADD CONSTRAINT "plans_trafficLimitBytes_check" CHECK ("trafficLimitBytes" IS NULL OR "trafficLimitBytes" >= 0);

ALTER TABLE "inbounds"
    ADD CONSTRAINT "inbounds_listenPort_check" CHECK ("listenPort" BETWEEN 1 AND 65535),
    ADD CONSTRAINT "inbounds_publicPort_check" CHECK ("publicPort" IS NULL OR "publicPort" BETWEEN 1 AND 65535);

ALTER TABLE "plan_inbounds"
    ADD CONSTRAINT "plan_inbounds_priority_check" CHECK ("priority" >= 0);

ALTER TABLE "usage_daily"
    ADD CONSTRAINT "usage_daily_uploadBytes_check" CHECK ("uploadBytes" >= 0),
    ADD CONSTRAINT "usage_daily_downloadBytes_check" CHECK ("downloadBytes" >= 0);

ALTER TABLE "traffic_checkpoints"
    ADD CONSTRAINT "traffic_checkpoints_uploadBytes_check" CHECK ("uploadBytes" >= 0),
    ADD CONSTRAINT "traffic_checkpoints_downloadBytes_check" CHECK ("downloadBytes" >= 0);

ALTER TABLE "system_config"
    ADD CONSTRAINT "system_config_revision_check" CHECK ("revision" > 0);

ALTER TABLE "core_apply_records"
    ADD CONSTRAINT "core_apply_records_configRevision_check" CHECK ("configRevision" > 0);

ALTER TABLE "backup_artifacts"
    ADD CONSTRAINT "backup_artifacts_sizeBytes_check" CHECK ("sizeBytes" IS NULL OR "sizeBytes" >= 0);
