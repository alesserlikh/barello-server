-- CreateEnum
CREATE TYPE "PriceImportIssueSeverity" AS ENUM ('INFO', 'WARNING', 'ERROR', 'CRITICAL');

-- CreateEnum
CREATE TYPE "PriceImportIssueStatus" AS ENUM ('OPEN', 'RESOLVED', 'IGNORED');

-- CreateEnum
CREATE TYPE "SupplierProductAliasType" AS ENUM ('SUPPLIER_ARTICLE', 'SUPPLIER_SKU', 'SUPPLIER_CODE_7', 'BARCODE', 'LEGACY_ARTICLE', 'GENERATED_KEY');

-- CreateEnum
CREATE TYPE "ProductCandidateStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'MERGED');

-- CreateEnum
CREATE TYPE "SupplierImportImageMatchStatus" AS ENUM ('PENDING', 'MATCHED', 'CONFIRMED', 'REJECTED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PriceImportRowMappingStatus" ADD VALUE 'IGNORED';
ALTER TYPE "PriceImportRowMappingStatus" ADD VALUE 'PARSED';
ALTER TYPE "PriceImportRowMappingStatus" ADD VALUE 'LOW_CONFIDENCE';
ALTER TYPE "PriceImportRowMappingStatus" ADD VALUE 'CANDIDATE';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PriceImportStatus" ADD VALUE 'UPLOADED';
ALTER TYPE "PriceImportStatus" ADD VALUE 'QUEUED';
ALTER TYPE "PriceImportStatus" ADD VALUE 'PARSED';
ALTER TYPE "PriceImportStatus" ADD VALUE 'HAS_ISSUES';
ALTER TYPE "PriceImportStatus" ADD VALUE 'READY_TO_PUBLISH';
ALTER TYPE "PriceImportStatus" ADD VALUE 'PUBLISHED';
ALTER TYPE "PriceImportStatus" ADD VALUE 'CANCELLED';

-- DropForeignKey
ALTER TABLE "SupplierProduct" DROP CONSTRAINT "SupplierProduct_productVariantId_fkey";

-- DropIndex
DROP INDEX "SupplierProduct_supplierId_productId_key";

-- AlterTable
ALTER TABLE "Offer" ADD COLUMN     "basePrice" DECIMAL(12,2),
ADD COLUMN     "deliveryDaysMax" INTEGER,
ADD COLUMN     "deliveryDaysMin" INTEGER,
ADD COLUMN     "discountPrice" DECIMAL(12,2),
ADD COLUMN     "effectivePrice" DECIMAL(12,2),
ADD COLUMN     "isCurrent" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "missingFromLatestPrice" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "packQty" DECIMAL(12,3),
ADD COLUMN     "rawPayload" JSONB,
ADD COLUMN     "sourceImportId" UUID,
ADD COLUMN     "sourceImportRowId" UUID,
ADD COLUMN     "stockAvailable" DECIMAL(12,3),
ADD COLUMN     "stockPayload" JSONB,
ADD COLUMN     "stockReserved" DECIMAL(12,3),
ADD COLUMN     "stockTotal" DECIMAL(12,3);

-- AlterTable
ALTER TABLE "SupplierPriceImport" ADD COLUMN     "criticalIssuesCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "errorText" TEXT,
ADD COLUMN     "fileHash" TEXT,
ADD COLUMN     "issuesCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "matchedRows" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "originalFileName" TEXT,
ADD COLUMN     "parsedRows" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "previousImportId" UUID,
ADD COLUMN     "priceDate" DATE,
ADD COLUMN     "profileId" UUID,
ADD COLUMN     "publishedAt" TIMESTAMP(3),
ADD COLUMN     "summaryJson" JSONB;

-- AlterTable
ALTER TABLE "SupplierPriceImportRow" ADD COLUMN     "identityKey" TEXT,
ADD COLUMN     "mappedProductVariantId" UUID,
ADD COLUMN     "mappedSupplierProductId" UUID,
ADD COLUMN     "mappingConfidence" DECIMAL(5,2),
ADD COLUMN     "normalizedName" TEXT,
ADD COLUMN     "normalizedPayload" JSONB,
ADD COLUMN     "rowIndex" INTEGER,
ADD COLUMN     "rowType" TEXT,
ADD COLUMN     "sheetName" TEXT,
ADD COLUMN     "sourceArticle" TEXT,
ADD COLUMN     "sourceBarcode" TEXT,
ADD COLUMN     "sourceSku" TEXT;

-- Backfill default variants before SupplierProduct.productVariantId becomes required.
INSERT INTO "ProductVariant" (
    "id",
    "productId",
    "volume",
    "volumeUnit",
    "packageSize",
    "packageSizeUnit",
    "isDefault",
    "createdAt",
    "updatedAt"
)
SELECT
    (
      substr(md5(p."id"::text || ':default-variant'), 1, 8) || '-' ||
      substr(md5(p."id"::text || ':default-variant'), 9, 4) || '-' ||
      '4' || substr(md5(p."id"::text || ':default-variant'), 14, 3) || '-' ||
      '8' || substr(md5(p."id"::text || ':default-variant'), 18, 3) || '-' ||
      substr(md5(p."id"::text || ':default-variant'), 21, 12)
    )::uuid,
    p."id",
    p."packageVolume",
    p."packageVolumeUnit",
    p."packageQuantity",
    CASE WHEN p."packageQuantity" IS NULL THEN NULL ELSE 'PCS' END,
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "Product" p
WHERE NOT EXISTS (
    SELECT 1 FROM "ProductVariant" pv WHERE pv."productId" = p."id"
);

UPDATE "SupplierProduct" sp
SET "productVariantId" = (
    SELECT candidate."id"
    FROM "ProductVariant" candidate
    WHERE candidate."productId" = sp."productId"
    ORDER BY candidate."isDefault" DESC, candidate."createdAt" ASC, candidate."id" ASC
    LIMIT 1
)
WHERE sp."productVariantId" IS NULL;

-- AlterTable
ALTER TABLE "SupplierProduct" ALTER COLUMN "productVariantId" SET NOT NULL;

-- CreateTable
CREATE TABLE "SupplierImportProfile" (
    "id" UUID NOT NULL,
    "supplierId" UUID,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "sourceFormat" "PriceImportSourceFormat" NOT NULL DEFAULT 'XLSX',
    "rulesJson" JSONB NOT NULL,
    "createdByUserId" UUID,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierImportProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierPriceImportIssue" (
    "id" UUID NOT NULL,
    "importId" UUID NOT NULL,
    "rowId" UUID,
    "supplierId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "severity" "PriceImportIssueSeverity" NOT NULL DEFAULT 'WARNING',
    "status" "PriceImportIssueStatus" NOT NULL DEFAULT 'OPEN',
    "fieldName" TEXT,
    "message" TEXT NOT NULL,
    "supplierValue" JSONB,
    "catalogValue" JSONB,
    "detailsJson" JSONB,
    "suggestedAction" TEXT,
    "resolutionJson" JSONB,
    "resolvedByUserId" UUID,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierPriceImportIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierProductAlias" (
    "id" UUID NOT NULL,
    "supplierId" UUID NOT NULL,
    "supplierProductId" UUID,
    "aliasType" "SupplierProductAliasType" NOT NULL,
    "rawValue" TEXT NOT NULL,
    "normalizedValue" TEXT NOT NULL,
    "sourceImportId" UUID,
    "sourceImportRowId" UUID,
    "confidence" DECIMAL(5,2),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierProductAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductCandidate" (
    "id" UUID NOT NULL,
    "supplierId" UUID NOT NULL,
    "importId" UUID,
    "importRowId" UUID,
    "matchedProductId" UUID,
    "matchedProductVariantId" UUID,
    "matchedSupplierProductId" UUID,
    "status" "ProductCandidateStatus" NOT NULL DEFAULT 'PENDING',
    "confidence" DECIMAL(5,2),
    "identityKey" TEXT,
    "normalizedName" TEXT NOT NULL,
    "categoryName" TEXT,
    "producerName" TEXT,
    "barcode" TEXT,
    "supplierArticle" TEXT,
    "volumeMl" INTEGER,
    "vintage" INTEGER,
    "payloadJson" JSONB,
    "resolutionJson" JSONB,
    "resolvedByUserId" UUID,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierImportImageMatch" (
    "id" UUID NOT NULL,
    "supplierId" UUID NOT NULL,
    "importId" UUID,
    "importRowId" UUID,
    "fileAssetId" UUID NOT NULL,
    "originalFileName" TEXT NOT NULL,
    "normalizedFileName" TEXT NOT NULL,
    "matchedProductId" UUID,
    "matchedProductVariantId" UUID,
    "confidence" DECIMAL(5,2),
    "status" "SupplierImportImageMatchStatus" NOT NULL DEFAULT 'PENDING',
    "matchReason" TEXT,
    "detailsJson" JSONB,
    "confirmedByUserId" UUID,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierImportImageMatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupplierImportProfile_supplierId_idx" ON "SupplierImportProfile"("supplierId");

-- CreateIndex
CREATE INDEX "SupplierImportProfile_code_isActive_idx" ON "SupplierImportProfile"("code", "isActive");

-- CreateIndex
CREATE INDEX "SupplierImportProfile_isDefault_idx" ON "SupplierImportProfile"("isDefault");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierImportProfile_supplierId_code_version_key" ON "SupplierImportProfile"("supplierId", "code", "version");

-- CreateIndex
CREATE INDEX "SupplierPriceImportIssue_importId_idx" ON "SupplierPriceImportIssue"("importId");

-- CreateIndex
CREATE INDEX "SupplierPriceImportIssue_rowId_idx" ON "SupplierPriceImportIssue"("rowId");

-- CreateIndex
CREATE INDEX "SupplierPriceImportIssue_supplierId_idx" ON "SupplierPriceImportIssue"("supplierId");

-- CreateIndex
CREATE INDEX "SupplierPriceImportIssue_severity_status_idx" ON "SupplierPriceImportIssue"("severity", "status");

-- CreateIndex
CREATE INDEX "SupplierPriceImportIssue_type_idx" ON "SupplierPriceImportIssue"("type");

-- CreateIndex
CREATE INDEX "SupplierProductAlias_supplierProductId_idx" ON "SupplierProductAlias"("supplierProductId");

-- CreateIndex
CREATE INDEX "SupplierProductAlias_sourceImportId_idx" ON "SupplierProductAlias"("sourceImportId");

-- CreateIndex
CREATE INDEX "SupplierProductAlias_sourceImportRowId_idx" ON "SupplierProductAlias"("sourceImportRowId");

-- CreateIndex
CREATE INDEX "SupplierProductAlias_isActive_idx" ON "SupplierProductAlias"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierProductAlias_supplierId_aliasType_normalizedValue_key" ON "SupplierProductAlias"("supplierId", "aliasType", "normalizedValue");

-- CreateIndex
CREATE INDEX "ProductCandidate_supplierId_idx" ON "ProductCandidate"("supplierId");

-- CreateIndex
CREATE INDEX "ProductCandidate_importId_idx" ON "ProductCandidate"("importId");

-- CreateIndex
CREATE INDEX "ProductCandidate_importRowId_idx" ON "ProductCandidate"("importRowId");

-- CreateIndex
CREATE INDEX "ProductCandidate_matchedProductId_idx" ON "ProductCandidate"("matchedProductId");

-- CreateIndex
CREATE INDEX "ProductCandidate_matchedProductVariantId_idx" ON "ProductCandidate"("matchedProductVariantId");

-- CreateIndex
CREATE INDEX "ProductCandidate_matchedSupplierProductId_idx" ON "ProductCandidate"("matchedSupplierProductId");

-- CreateIndex
CREATE INDEX "ProductCandidate_status_idx" ON "ProductCandidate"("status");

-- CreateIndex
CREATE INDEX "ProductCandidate_identityKey_idx" ON "ProductCandidate"("identityKey");

-- CreateIndex
CREATE INDEX "ProductCandidate_barcode_idx" ON "ProductCandidate"("barcode");

-- CreateIndex
CREATE INDEX "SupplierImportImageMatch_supplierId_idx" ON "SupplierImportImageMatch"("supplierId");

-- CreateIndex
CREATE INDEX "SupplierImportImageMatch_importId_idx" ON "SupplierImportImageMatch"("importId");

-- CreateIndex
CREATE INDEX "SupplierImportImageMatch_importRowId_idx" ON "SupplierImportImageMatch"("importRowId");

-- CreateIndex
CREATE INDEX "SupplierImportImageMatch_fileAssetId_idx" ON "SupplierImportImageMatch"("fileAssetId");

-- CreateIndex
CREATE INDEX "SupplierImportImageMatch_matchedProductId_idx" ON "SupplierImportImageMatch"("matchedProductId");

-- CreateIndex
CREATE INDEX "SupplierImportImageMatch_matchedProductVariantId_idx" ON "SupplierImportImageMatch"("matchedProductVariantId");

-- CreateIndex
CREATE INDEX "SupplierImportImageMatch_status_idx" ON "SupplierImportImageMatch"("status");

-- CreateIndex
CREATE INDEX "SupplierImportImageMatch_normalizedFileName_idx" ON "SupplierImportImageMatch"("normalizedFileName");

-- CreateIndex
CREATE INDEX "Offer_sourceImportId_idx" ON "Offer"("sourceImportId");

-- CreateIndex
CREATE INDEX "Offer_sourceImportRowId_idx" ON "Offer"("sourceImportRowId");

-- CreateIndex
CREATE INDEX "Offer_isCurrent_idx" ON "Offer"("isCurrent");

-- CreateIndex
CREATE INDEX "Offer_missingFromLatestPrice_idx" ON "Offer"("missingFromLatestPrice");

-- CreateIndex
CREATE INDEX "Offer_effectivePrice_idx" ON "Offer"("effectivePrice");

-- CreateIndex
CREATE INDEX "SupplierPriceImport_fileAssetId_idx" ON "SupplierPriceImport"("fileAssetId");

-- CreateIndex
CREATE INDEX "SupplierPriceImport_profileId_idx" ON "SupplierPriceImport"("profileId");

-- CreateIndex
CREATE INDEX "SupplierPriceImport_previousImportId_idx" ON "SupplierPriceImport"("previousImportId");

-- CreateIndex
CREATE INDEX "SupplierPriceImport_fileHash_idx" ON "SupplierPriceImport"("fileHash");

-- CreateIndex
CREATE INDEX "SupplierPriceImport_publishedAt_idx" ON "SupplierPriceImport"("publishedAt");

-- CreateIndex
CREATE INDEX "SupplierPriceImportRow_sheetName_rowIndex_idx" ON "SupplierPriceImportRow"("sheetName", "rowIndex");

-- CreateIndex
CREATE INDEX "SupplierPriceImportRow_mappedProductVariantId_idx" ON "SupplierPriceImportRow"("mappedProductVariantId");

-- CreateIndex
CREATE INDEX "SupplierPriceImportRow_mappedSupplierProductId_idx" ON "SupplierPriceImportRow"("mappedSupplierProductId");

-- CreateIndex
CREATE INDEX "SupplierPriceImportRow_identityKey_idx" ON "SupplierPriceImportRow"("identityKey");

-- CreateIndex
CREATE INDEX "SupplierPriceImportRow_sourceBarcode_idx" ON "SupplierPriceImportRow"("sourceBarcode");

-- CreateIndex
CREATE INDEX "SupplierPriceImportRow_sourceArticle_idx" ON "SupplierPriceImportRow"("sourceArticle");

-- CreateIndex
CREATE INDEX "SupplierProduct_supplierId_supplierSku_idx" ON "SupplierProduct"("supplierId", "supplierSku");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierProduct_supplierId_productId_productVariantId_key" ON "SupplierProduct"("supplierId", "productId", "productVariantId");

-- AddForeignKey
ALTER TABLE "SupplierImportProfile" ADD CONSTRAINT "SupplierImportProfile_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPriceImport" ADD CONSTRAINT "SupplierPriceImport_fileAssetId_fkey" FOREIGN KEY ("fileAssetId") REFERENCES "FileAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPriceImport" ADD CONSTRAINT "SupplierPriceImport_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "SupplierImportProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPriceImport" ADD CONSTRAINT "SupplierPriceImport_previousImportId_fkey" FOREIGN KEY ("previousImportId") REFERENCES "SupplierPriceImport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPriceImportRow" ADD CONSTRAINT "SupplierPriceImportRow_mappedProductVariantId_fkey" FOREIGN KEY ("mappedProductVariantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPriceImportRow" ADD CONSTRAINT "SupplierPriceImportRow_mappedSupplierProductId_fkey" FOREIGN KEY ("mappedSupplierProductId") REFERENCES "SupplierProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPriceImportIssue" ADD CONSTRAINT "SupplierPriceImportIssue_importId_fkey" FOREIGN KEY ("importId") REFERENCES "SupplierPriceImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPriceImportIssue" ADD CONSTRAINT "SupplierPriceImportIssue_rowId_fkey" FOREIGN KEY ("rowId") REFERENCES "SupplierPriceImportRow"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPriceImportIssue" ADD CONSTRAINT "SupplierPriceImportIssue_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierProduct" ADD CONSTRAINT "SupplierProduct_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierProductAlias" ADD CONSTRAINT "SupplierProductAlias_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierProductAlias" ADD CONSTRAINT "SupplierProductAlias_supplierProductId_fkey" FOREIGN KEY ("supplierProductId") REFERENCES "SupplierProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierProductAlias" ADD CONSTRAINT "SupplierProductAlias_sourceImportId_fkey" FOREIGN KEY ("sourceImportId") REFERENCES "SupplierPriceImport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierProductAlias" ADD CONSTRAINT "SupplierProductAlias_sourceImportRowId_fkey" FOREIGN KEY ("sourceImportRowId") REFERENCES "SupplierPriceImportRow"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_sourceImportId_fkey" FOREIGN KEY ("sourceImportId") REFERENCES "SupplierPriceImport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_sourceImportRowId_fkey" FOREIGN KEY ("sourceImportRowId") REFERENCES "SupplierPriceImportRow"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCandidate" ADD CONSTRAINT "ProductCandidate_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCandidate" ADD CONSTRAINT "ProductCandidate_importId_fkey" FOREIGN KEY ("importId") REFERENCES "SupplierPriceImport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCandidate" ADD CONSTRAINT "ProductCandidate_importRowId_fkey" FOREIGN KEY ("importRowId") REFERENCES "SupplierPriceImportRow"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCandidate" ADD CONSTRAINT "ProductCandidate_matchedProductId_fkey" FOREIGN KEY ("matchedProductId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCandidate" ADD CONSTRAINT "ProductCandidate_matchedProductVariantId_fkey" FOREIGN KEY ("matchedProductVariantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCandidate" ADD CONSTRAINT "ProductCandidate_matchedSupplierProductId_fkey" FOREIGN KEY ("matchedSupplierProductId") REFERENCES "SupplierProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierImportImageMatch" ADD CONSTRAINT "SupplierImportImageMatch_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierImportImageMatch" ADD CONSTRAINT "SupplierImportImageMatch_importId_fkey" FOREIGN KEY ("importId") REFERENCES "SupplierPriceImport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierImportImageMatch" ADD CONSTRAINT "SupplierImportImageMatch_importRowId_fkey" FOREIGN KEY ("importRowId") REFERENCES "SupplierPriceImportRow"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierImportImageMatch" ADD CONSTRAINT "SupplierImportImageMatch_fileAssetId_fkey" FOREIGN KEY ("fileAssetId") REFERENCES "FileAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierImportImageMatch" ADD CONSTRAINT "SupplierImportImageMatch_matchedProductId_fkey" FOREIGN KEY ("matchedProductId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierImportImageMatch" ADD CONSTRAINT "SupplierImportImageMatch_matchedProductVariantId_fkey" FOREIGN KEY ("matchedProductVariantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
