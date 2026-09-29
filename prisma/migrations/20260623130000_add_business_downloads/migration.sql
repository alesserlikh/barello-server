CREATE TYPE "BusinessDownloadPurpose" AS ENUM ('MENU', 'STOCK', 'SALES', 'ANALYTICS');
CREATE TYPE "BusinessDownloadStatus" AS ENUM ('UPLOADED', 'PROCESSING', 'DONE', 'FAILED');

CREATE TABLE "BusinessDownload" (
    "id" UUID NOT NULL,
    "venueId" UUID NOT NULL,
    "fileAssetId" UUID NOT NULL,
    "uploadedByUserId" UUID NOT NULL,
    "purpose" "BusinessDownloadPurpose" NOT NULL,
    "status" "BusinessDownloadStatus" NOT NULL DEFAULT 'UPLOADED',
    "processingError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BusinessDownload_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BusinessDownload_fileAssetId_key"
ON "BusinessDownload"("fileAssetId");
CREATE INDEX "BusinessDownload_venueId_createdAt_idx"
ON "BusinessDownload"("venueId", "createdAt");
CREATE INDEX "BusinessDownload_uploadedByUserId_idx"
ON "BusinessDownload"("uploadedByUserId");
CREATE INDEX "BusinessDownload_status_idx"
ON "BusinessDownload"("status");

ALTER TABLE "BusinessDownload"
ADD CONSTRAINT "BusinessDownload_venueId_fkey"
FOREIGN KEY ("venueId") REFERENCES "Venue"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BusinessDownload"
ADD CONSTRAINT "BusinessDownload_fileAssetId_fkey"
FOREIGN KEY ("fileAssetId") REFERENCES "FileAsset"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BusinessDownload"
ADD CONSTRAINT "BusinessDownload_uploadedByUserId_fkey"
FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;