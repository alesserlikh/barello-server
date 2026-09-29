CREATE TYPE "VenuePhotoStatus" AS ENUM ('ACTIVE', 'REJECTED');

ALTER TABLE "VenuePhoto"
ADD COLUMN "status" "VenuePhotoStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN "rejectedAt" TIMESTAMP(3);

CREATE INDEX "VenuePhoto_status_idx" ON "VenuePhoto"("status");
