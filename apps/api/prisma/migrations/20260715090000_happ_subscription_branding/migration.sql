-- AlterTable
ALTER TABLE "plans" ADD COLUMN "happProviderId" VARCHAR(128),
ADD COLUMN "subscriptionSubInfoText" VARCHAR(500),
ADD COLUMN "subscriptionSubInfoColor" VARCHAR(16),
ADD COLUMN "subscriptionSubInfoButtonText" VARCHAR(25),
ADD COLUMN "subscriptionSubInfoButtonLink" VARCHAR(2048),
ADD COLUMN "subscriptionSubExpireEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "subscriptionSubExpireButtonLink" VARCHAR(2048),
ADD COLUMN "subscriptionFallbackUrlTemplate" VARCHAR(2048),
ADD COLUMN "subscriptionColorProfile" TEXT;
