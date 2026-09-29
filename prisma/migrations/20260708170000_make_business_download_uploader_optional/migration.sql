ALTER TABLE "BusinessDownload"
DROP CONSTRAINT IF EXISTS "BusinessDownload_uploadedByUserId_fkey";

ALTER TABLE "BusinessDownload"
ALTER COLUMN "uploadedByUserId" DROP NOT NULL;

ALTER TABLE "BusinessDownload"
ADD CONSTRAINT "BusinessDownload_uploadedByUserId_fkey"
FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
