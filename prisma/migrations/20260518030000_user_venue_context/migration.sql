-- CreateEnum
CREATE TYPE "VenueStatus" AS ENUM ('ACTIVE', 'BLOCKED', 'DELETED');

-- AlterTable
ALTER TABLE "User"
ADD COLUMN "activeVenueId" UUID,
ADD COLUMN "defaultVenueId" UUID;

-- AlterTable
ALTER TABLE "Venue"
ADD COLUMN "venueStatus" "VenueStatus" NOT NULL DEFAULT 'ACTIVE';

-- Backfill venueStatus from the legacy isActive flag.
UPDATE "Venue"
SET "venueStatus" = CASE
  WHEN "isActive" THEN 'ACTIVE'::"VenueStatus"
  ELSE 'BLOCKED'::"VenueStatus"
END;

-- CreateIndex
CREATE INDEX "User_activeVenueId_idx" ON "User"("activeVenueId");

-- CreateIndex
CREATE INDEX "User_defaultVenueId_idx" ON "User"("defaultVenueId");

-- CreateIndex
CREATE INDEX "Venue_venueStatus_idx" ON "Venue"("venueStatus");

-- AddForeignKey
ALTER TABLE "User"
ADD CONSTRAINT "User_activeVenueId_fkey"
FOREIGN KEY ("activeVenueId") REFERENCES "Venue"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User"
ADD CONSTRAINT "User_defaultVenueId_fkey"
FOREIGN KEY ("defaultVenueId") REFERENCES "Venue"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
