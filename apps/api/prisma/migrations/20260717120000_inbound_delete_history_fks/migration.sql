-- Allow destructive inbound delete: drop per-inbound history, keep daily usage totals.
ALTER TABLE "usage_daily" DROP CONSTRAINT "usage_daily_inboundId_fkey";
ALTER TABLE "usage_daily"
  ADD CONSTRAINT "usage_daily_inboundId_fkey"
  FOREIGN KEY ("inboundId") REFERENCES "inbounds"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "traffic_checkpoints" DROP CONSTRAINT "traffic_checkpoints_inboundId_fkey";
ALTER TABLE "traffic_checkpoints"
  ADD CONSTRAINT "traffic_checkpoints_inboundId_fkey"
  FOREIGN KEY ("inboundId") REFERENCES "inbounds"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "online_sessions" DROP CONSTRAINT "online_sessions_inboundId_fkey";
ALTER TABLE "online_sessions"
  ADD CONSTRAINT "online_sessions_inboundId_fkey"
  FOREIGN KEY ("inboundId") REFERENCES "inbounds"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
