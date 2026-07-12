-- Phase 2 sing-box control plane. Existing Phase 0/1 rows are retained.

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'INBOUND_DELETE';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'INBOUND_ENABLE';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'INBOUND_ASSIGNMENT_ADD';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'INBOUND_ASSIGNMENT_REMOVE';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'INBOUND_CREDENTIAL_ROTATE';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'INBOUND_CREDENTIAL_REVEAL';
ALTER TYPE "CoreApplyTrigger" ADD VALUE IF NOT EXISTS 'MUTATION';

ALTER TABLE "users"
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "users"
  ADD CONSTRAINT "users_revision_check" CHECK ("revision" > 0);

ALTER TABLE "inbounds"
  ADD COLUMN "secretDataEncrypted" TEXT,
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "needsApply" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "inbounds"
  ADD CONSTRAINT "inbounds_revision_check" CHECK ("revision" > 0);

-- Remove any legacy secret-shaped values from the public JSON column. SQL migrations cannot
-- safely encrypt an unknown legacy payload without access to SECRETS_MASTER_KEY, so affected
-- secrets must be rotated through the API.
CREATE OR REPLACE FUNCTION phase2_scrub_public_json(value JSONB)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  result JSONB;
BEGIN
  IF jsonb_typeof(value) = 'object' THEN
    SELECT COALESCE(
      jsonb_object_agg(
        entry.key,
        CASE
          WHEN (
            entry.key !~* '(_path|Path)$'
            AND entry.key ~* '(password|secret|token|credential|private[_-]?key|api[_-]?key|mac[_-]?key)'
          )
          THEN '"[MIGRATION_REMOVED]"'::JSONB
          ELSE phase2_scrub_public_json(entry.value)
        END
      ),
      '{}'::JSONB
    )
    INTO result
    FROM jsonb_each(value) AS entry(key, value);
    RETURN result;
  ELSIF jsonb_typeof(value) = 'array' THEN
    SELECT COALESCE(jsonb_agg(phase2_scrub_public_json(item)), '[]'::JSONB)
    INTO result
    FROM jsonb_array_elements(value) AS items(item);
    RETURN result;
  END IF;
  RETURN value;
END;
$$;

UPDATE "inbounds"
SET "config" = phase2_scrub_public_json("config"::JSONB);

DROP FUNCTION phase2_scrub_public_json(JSONB);

ALTER TABLE "user_inbound_assignments"
  ADD COLUMN "credentialEncrypted" TEXT,
  ADD COLUMN "credentialName" VARCHAR(128),
  ADD COLUMN "credentialVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "rotatedAt" TIMESTAMPTZ(3);

-- Preserve assignment rows but force an explicit credential rotation. Keeping the former JSON
-- value would violate the encrypted-at-rest invariant.
UPDATE "user_inbound_assignments"
SET
  "credentialEncrypted" = 'legacy:rotation-required',
  "credentialName" = "userId"::TEXT,
  "credentialVersion" = 0;

ALTER TABLE "user_inbound_assignments"
  ALTER COLUMN "credentialEncrypted" SET NOT NULL,
  ALTER COLUMN "credentialName" SET NOT NULL,
  DROP COLUMN "credentialData";
ALTER TABLE "user_inbound_assignments"
  ADD CONSTRAINT "user_inbound_assignments_credential_version_check"
  CHECK ("credentialVersion" >= 0);

ALTER TABLE "core_apply_records"
  ADD COLUMN "reason" TEXT,
  ADD COLUMN "desiredHash" CHAR(64),
  ADD COLUMN "previousHash" CHAR(64),
  ADD COLUMN "configPath" TEXT,
  ADD COLUMN "diffSummary" JSONB,
  ADD COLUMN "appliedAt" TIMESTAMPTZ(3),
  ADD COLUMN "rollbackStartedAt" TIMESTAMPTZ(3),
  ADD COLUMN "rollbackCompletedAt" TIMESTAMPTZ(3),
  ADD COLUMN "rollbackOutcome" TEXT;

UPDATE "core_apply_records"
SET "desiredHash" = "configChecksum"
WHERE "configChecksum" IS NOT NULL;

CREATE INDEX "core_apply_records_desiredHash_idx"
  ON "core_apply_records"("desiredHash");

CREATE TABLE "core_state" (
  "id" VARCHAR(50) NOT NULL,
  "desiredRevision" INTEGER NOT NULL DEFAULT 0,
  "appliedRevision" INTEGER NOT NULL DEFAULT 0,
  "appliedConfigHash" CHAR(64),
  "configPath" TEXT NOT NULL,
  "lastApplyRecordId" UUID,
  "appliedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "core_state_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "core_state_desired_revision_check" CHECK ("desiredRevision" >= 0),
  CONSTRAINT "core_state_applied_revision_check" CHECK ("appliedRevision" >= 0)
);

INSERT INTO "core_state" (
  "id",
  "desiredRevision",
  "appliedRevision",
  "configPath"
)
VALUES ('sing-box', 0, 0, '/var/lib/sing-box/config.json')
ON CONFLICT ("id") DO NOTHING;
