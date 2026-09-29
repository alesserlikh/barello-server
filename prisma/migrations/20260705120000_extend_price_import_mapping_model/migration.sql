-- CreateEnum
CREATE TYPE "SupplierPriceImportKind" AS ENUM ('PRICE_WITH_OFFERS', 'PRODUCT_MASTER', 'STOCK_ONLY', 'IMAGE_PACKAGE');

-- AlterTable
ALTER TABLE "SupplierPriceImport" ADD COLUMN     "detectedProfileJson" JSONB,
ADD COLUMN     "importKind" "SupplierPriceImportKind" NOT NULL DEFAULT 'PRICE_WITH_OFFERS',
ADD COLUMN     "mappingConfigJson" JSONB,
ADD COLUMN     "parserVersion" TEXT,
ADD COLUMN     "profileSnapshotJson" JSONB;

-- AlterTable
ALTER TABLE "SupplierPriceImportRow" ADD COLUMN     "rowHash" TEXT;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "alcoholPercent" DECIMAL(5,2),
ADD COLUMN     "brand" TEXT,
ADD COLUMN     "color" TEXT,
ADD COLUMN     "country" TEXT,
ADD COLUMN     "grapeSorts" JSONB,
ADD COLUMN     "producer" TEXT,
ADD COLUMN     "region" TEXT,
ADD COLUMN     "sugar" TEXT,
ADD COLUMN     "vintage" INTEGER;

-- Backfill
UPDATE "Product"
SET "vintage" = "manufacturedYear"
WHERE "vintage" IS NULL AND "manufacturedYear" IS NOT NULL;

-- CreateIndex
CREATE INDEX "SupplierPriceImport_importKind_idx" ON "SupplierPriceImport"("importKind");

-- CreateIndex
CREATE INDEX "SupplierPriceImportRow_rowHash_idx" ON "SupplierPriceImportRow"("rowHash");
