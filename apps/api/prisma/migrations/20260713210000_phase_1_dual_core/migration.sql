-- Dual-core foundation. Existing data belongs to the current sing-box engine.

CREATE TYPE "CoreEngine" AS ENUM ('SING_BOX', 'XRAY');

ALTER TYPE "InboundProtocol" ADD VALUE IF NOT EXISTS 'VLESS_XHTTP_TLS';
ALTER TYPE "CoreApplyStatus" ADD VALUE IF NOT EXISTS 'PARTIAL_SUCCEEDED';

-- Backfill existing inbounds before enforcing the engine invariant.
ALTER TABLE "inbounds"
  ADD COLUMN "engine" "CoreEngine";

UPDATE "inbounds"
SET "engine" = 'SING_BOX'
WHERE "engine" IS NULL;

ALTER TABLE "inbounds"
  ALTER COLUMN "engine" SET DEFAULT 'SING_BOX',
  ALTER COLUMN "engine" SET NOT NULL;

-- statsKey is only unique inside an engine. Preserve every existing cursor as
-- sing-box, then make both the primary and user uniqueness engine-aware.
ALTER TABLE "traffic_cursors"
  ADD COLUMN "engine" "CoreEngine";

UPDATE "traffic_cursors"
SET "engine" = 'SING_BOX'
WHERE "engine" IS NULL;

ALTER TABLE "traffic_cursors"
  ALTER COLUMN "engine" SET DEFAULT 'SING_BOX',
  ALTER COLUMN "engine" SET NOT NULL;

ALTER TABLE "traffic_cursors"
  DROP CONSTRAINT "traffic_cursors_pkey",
  ADD CONSTRAINT "traffic_cursors_pkey" PRIMARY KEY ("statsKey", "engine");

DROP INDEX "traffic_cursors_userId_key";
CREATE UNIQUE INDEX "traffic_cursors_userId_engine_key"
  ON "traffic_cursors"("userId", "engine");

-- Session rows are tagged for later cross-engine aggregation. Session keys
-- remain globally unique because the composite facade will prefix engine IDs.
ALTER TABLE "online_sessions"
  ADD COLUMN "engine" "CoreEngine";

UPDATE "online_sessions"
SET "engine" = 'SING_BOX'
WHERE "engine" IS NULL;

ALTER TABLE "online_sessions"
  ALTER COLUMN "engine" SET DEFAULT 'SING_BOX',
  ALTER COLUMN "engine" SET NOT NULL;

ALTER TABLE "core_apply_records"
  ADD COLUMN "engineResults" JSONB;
