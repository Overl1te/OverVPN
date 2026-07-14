-- AlterTable
ALTER TABLE "plans" ADD COLUMN "subscriptionTitleTemplate" VARCHAR(200),
ADD COLUMN "subscriptionAnnounce" VARCHAR(500),
ADD COLUMN "subscriptionSupportUrl" VARCHAR(2048),
ADD COLUMN "subscriptionWebPageUrl" VARCHAR(2048);

-- AlterTable
ALTER TABLE "inbounds" ADD COLUMN "displayNameTemplate" VARCHAR(200);
