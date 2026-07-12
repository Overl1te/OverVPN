-- Phase 7: persist backup artifact metadata for restore/download clients.
ALTER TABLE "backup_artifacts" ADD COLUMN IF NOT EXISTS "meta" JSONB;
