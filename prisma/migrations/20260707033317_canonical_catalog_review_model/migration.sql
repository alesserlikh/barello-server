-- CreateEnum
CREATE TYPE "ProductCatalogStatus" AS ENUM ('DRAFT', 'NEEDS_REVIEW', 'CONFIRMED', 'HIDDEN', 'MERGED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CatalogImportRowValidationStatus" AS ENUM ('RAW', 'NORMALIZED', 'MATCHED', 'VALIDATED', 'NEEDS_REVIEW', 'EDITED', 'REVALIDATED', 'APPROVED', 'READY_TO_PUBLISH', 'PUBLISHED', 'CONFLICT', 'IGNORED', 'FAILED');

-- CreateEnum
CREATE TYPE "CatalogValidationIssueEntityType" AS ENUM ('IMPORT', 'RAW_ROW', 'NORMALIZED_ROW', 'PRODUCT', 'SUPPLIER_PRODUCT', 'OFFER');

-- CreateEnum
CREATE TYPE "CatalogPublishBatchStatus" AS ENUM ('CREATED', 'RUNNING', 'PUBLISHED', 'PARTIALLY_PUBLISHED', 'FAILED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "confirmedAt" TIMESTAMP(3),
ADD COLUMN     "hiddenAt" TIMESTAMP(3),
ADD COLUMN     "isConfirmed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isHidden" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "mergedIntoProductId" UUID,
ADD COLUMN     "status" "ProductCatalogStatus" NOT NULL DEFAULT 'NEEDS_REVIEW';

-- AlterTable
ALTER TABLE "SupplierPriceImportRow" ADD COLUMN     "adminCorrectionPayload" JSONB,
ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "publishedAt" TIMESTAMP(3),
ADD COLUMN     "validationStatus" "CatalogImportRowValidationStatus" NOT NULL DEFAULT 'RAW';

-- AlterTable
ALTER TABLE "SupplierProduct" ADD COLUMN     "sourceImportId" UUID,
ADD COLUMN     "sourceImportRowId" UUID,
ADD COLUMN     "supplierNameAlias" TEXT;

-- CreateTable
CREATE TABLE "CatalogNormalizedRow" (
    "id" UUID NOT NULL,
    "importId" UUID NOT NULL,
    "rawRowId" UUID NOT NULL,
    "supplierId" UUID NOT NULL,
    "status" "CatalogImportRowValidationStatus" NOT NULL DEFAULT 'NORMALIZED',
    "normalizedName" TEXT,
    "canonicalName" TEXT,
    "russianName" TEXT,
    "categoryId" UUID,
    "categoryName" TEXT,
    "article" TEXT,
    "supplierSku" TEXT,
    "barcode" TEXT,
    "brand" TEXT,
    "producer" TEXT,
    "manufacturer" TEXT,
    "country" TEXT,
    "region" TEXT,
    "vintage" INTEGER,
    "alcoholPercent" DECIMAL(5,2),
    "volume" DECIMAL(12,3),
    "volumeUnit" TEXT,
    "packageSize" DECIMAL(12,3),
    "packageSizeUnit" TEXT,
    "description" TEXT,
    "imageFileId" UUID,
    "price" DECIMAL(12,2),
    "currency" TEXT,
    "stockAvailable" DECIMAL(12,3),
    "availability" TEXT,
    "matchedProductId" UUID,
    "matchedProductVariantId" UUID,
    "matchedSupplierProductId" UUID,
    "confidence" DECIMAL(5,2),
    "normalizedPayload" JSONB,
    "adminCorrectionPayload" JSONB,
    "approvedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogNormalizedRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogMatchCandidate" (
    "id" UUID NOT NULL,
    "importId" UUID NOT NULL,
    "rawRowId" UUID,
    "normalizedRowId" UUID,
    "productId" UUID NOT NULL,
    "productVariantId" UUID,
    "supplierProductId" UUID,
    "score" DECIMAL(5,2) NOT NULL,
    "reason" TEXT,
    "signalsJson" JSONB,
    "selectedByAdmin" BOOLEAN NOT NULL DEFAULT false,
    "rejectedByAdmin" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogMatchCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogValidationIssue" (
    "id" UUID NOT NULL,
    "importId" UUID,
    "rawRowId" UUID,
    "normalizedRowId" UUID,
    "supplierId" UUID,
    "productId" UUID,
    "supplierProductId" UUID,
    "offerId" UUID,
    "entityType" "CatalogValidationIssueEntityType" NOT NULL,
    "type" TEXT NOT NULL,
    "severity" "PriceImportIssueSeverity" NOT NULL DEFAULT 'WARNING',
    "status" "PriceImportIssueStatus" NOT NULL DEFAULT 'OPEN',
    "fieldName" TEXT,
    "message" TEXT NOT NULL,
    "sourceValue" JSONB,
    "catalogValue" JSONB,
    "detailsJson" JSONB,
    "suggestedAction" TEXT,
    "resolutionJson" JSONB,
    "resolvedByUserId" UUID,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogValidationIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogPublishBatch" (
    "id" UUID NOT NULL,
    "importId" UUID NOT NULL,
    "supplierId" UUID NOT NULL,
    "status" "CatalogPublishBatchStatus" NOT NULL DEFAULT 'CREATED',
    "requestedByUserId" UUID,
    "summaryJson" JSONB,
    "errorText" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogPublishBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CatalogNormalizedRow_supplierId_idx" ON "CatalogNormalizedRow"("supplierId");

-- CreateIndex
CREATE INDEX "CatalogNormalizedRow_status_idx" ON "CatalogNormalizedRow"("status");

-- CreateIndex
CREATE INDEX "CatalogNormalizedRow_categoryId_idx" ON "CatalogNormalizedRow"("categoryId");

-- CreateIndex
CREATE INDEX "CatalogNormalizedRow_barcode_idx" ON "CatalogNormalizedRow"("barcode");

-- CreateIndex
CREATE INDEX "CatalogNormalizedRow_article_idx" ON "CatalogNormalizedRow"("article");

-- CreateIndex
CREATE INDEX "CatalogNormalizedRow_supplierSku_idx" ON "CatalogNormalizedRow"("supplierSku");

-- CreateIndex
CREATE INDEX "CatalogNormalizedRow_matchedProductId_idx" ON "CatalogNormalizedRow"("matchedProductId");

-- CreateIndex
CREATE INDEX "CatalogNormalizedRow_matchedProductVariantId_idx" ON "CatalogNormalizedRow"("matchedProductVariantId");

-- CreateIndex
CREATE INDEX "CatalogNormalizedRow_matchedSupplierProductId_idx" ON "CatalogNormalizedRow"("matchedSupplierProductId");

-- CreateIndex
CREATE INDEX "CatalogNormalizedRow_approvedAt_idx" ON "CatalogNormalizedRow"("approvedAt");

-- CreateIndex
CREATE INDEX "CatalogNormalizedRow_publishedAt_idx" ON "CatalogNormalizedRow"("publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogNormalizedRow_importId_rawRowId_key" ON "CatalogNormalizedRow"("importId", "rawRowId");

-- CreateIndex
CREATE INDEX "CatalogMatchCandidate_importId_idx" ON "CatalogMatchCandidate"("importId");

-- CreateIndex
CREATE INDEX "CatalogMatchCandidate_rawRowId_idx" ON "CatalogMatchCandidate"("rawRowId");

-- CreateIndex
CREATE INDEX "CatalogMatchCandidate_normalizedRowId_idx" ON "CatalogMatchCandidate"("normalizedRowId");

-- CreateIndex
CREATE INDEX "CatalogMatchCandidate_productId_idx" ON "CatalogMatchCandidate"("productId");

-- CreateIndex
CREATE INDEX "CatalogMatchCandidate_productVariantId_idx" ON "CatalogMatchCandidate"("productVariantId");

-- CreateIndex
CREATE INDEX "CatalogMatchCandidate_supplierProductId_idx" ON "CatalogMatchCandidate"("supplierProductId");

-- CreateIndex
CREATE INDEX "CatalogMatchCandidate_selectedByAdmin_idx" ON "CatalogMatchCandidate"("selectedByAdmin");

-- CreateIndex
CREATE INDEX "CatalogMatchCandidate_rejectedByAdmin_idx" ON "CatalogMatchCandidate"("rejectedByAdmin");

-- CreateIndex
CREATE INDEX "CatalogValidationIssue_importId_idx" ON "CatalogValidationIssue"("importId");

-- CreateIndex
CREATE INDEX "CatalogValidationIssue_rawRowId_idx" ON "CatalogValidationIssue"("rawRowId");

-- CreateIndex
CREATE INDEX "CatalogValidationIssue_normalizedRowId_idx" ON "CatalogValidationIssue"("normalizedRowId");

-- CreateIndex
CREATE INDEX "CatalogValidationIssue_supplierId_idx" ON "CatalogValidationIssue"("supplierId");

-- CreateIndex
CREATE INDEX "CatalogValidationIssue_productId_idx" ON "CatalogValidationIssue"("productId");

-- CreateIndex
CREATE INDEX "CatalogValidationIssue_supplierProductId_idx" ON "CatalogValidationIssue"("supplierProductId");

-- CreateIndex
CREATE INDEX "CatalogValidationIssue_offerId_idx" ON "CatalogValidationIssue"("offerId");

-- CreateIndex
CREATE INDEX "CatalogValidationIssue_entityType_idx" ON "CatalogValidationIssue"("entityType");

-- CreateIndex
CREATE INDEX "CatalogValidationIssue_severity_status_idx" ON "CatalogValidationIssue"("severity", "status");

-- CreateIndex
CREATE INDEX "CatalogValidationIssue_type_idx" ON "CatalogValidationIssue"("type");

-- CreateIndex
CREATE INDEX "CatalogPublishBatch_importId_idx" ON "CatalogPublishBatch"("importId");

-- CreateIndex
CREATE INDEX "CatalogPublishBatch_supplierId_idx" ON "CatalogPublishBatch"("supplierId");

-- CreateIndex
CREATE INDEX "CatalogPublishBatch_status_idx" ON "CatalogPublishBatch"("status");

-- CreateIndex
CREATE INDEX "CatalogPublishBatch_requestedByUserId_idx" ON "CatalogPublishBatch"("requestedByUserId");

-- CreateIndex
CREATE INDEX "CatalogPublishBatch_createdAt_idx" ON "CatalogPublishBatch"("createdAt");

-- CreateIndex
CREATE INDEX "Product_status_idx" ON "Product"("status");

-- CreateIndex
CREATE INDEX "Product_isHidden_idx" ON "Product"("isHidden");

-- CreateIndex
CREATE INDEX "Product_isConfirmed_idx" ON "Product"("isConfirmed");

-- CreateIndex
CREATE INDEX "Product_mergedIntoProductId_idx" ON "Product"("mergedIntoProductId");

-- CreateIndex
CREATE INDEX "SupplierPriceImportRow_validationStatus_idx" ON "SupplierPriceImportRow"("validationStatus");

-- CreateIndex
CREATE INDEX "SupplierPriceImportRow_approvedAt_idx" ON "SupplierPriceImportRow"("approvedAt");

-- CreateIndex
CREATE INDEX "SupplierPriceImportRow_publishedAt_idx" ON "SupplierPriceImportRow"("publishedAt");

-- CreateIndex
CREATE INDEX "SupplierProduct_sourceImportId_idx" ON "SupplierProduct"("sourceImportId");

-- CreateIndex
CREATE INDEX "SupplierProduct_sourceImportRowId_idx" ON "SupplierProduct"("sourceImportRowId");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_mergedIntoProductId_fkey" FOREIGN KEY ("mergedIntoProductId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierProduct" ADD CONSTRAINT "SupplierProduct_sourceImportId_fkey" FOREIGN KEY ("sourceImportId") REFERENCES "SupplierPriceImport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierProduct" ADD CONSTRAINT "SupplierProduct_sourceImportRowId_fkey" FOREIGN KEY ("sourceImportRowId") REFERENCES "SupplierPriceImportRow"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogNormalizedRow" ADD CONSTRAINT "CatalogNormalizedRow_importId_fkey" FOREIGN KEY ("importId") REFERENCES "SupplierPriceImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogNormalizedRow" ADD CONSTRAINT "CatalogNormalizedRow_rawRowId_fkey" FOREIGN KEY ("rawRowId") REFERENCES "SupplierPriceImportRow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogNormalizedRow" ADD CONSTRAINT "CatalogNormalizedRow_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogNormalizedRow" ADD CONSTRAINT "CatalogNormalizedRow_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "CatalogCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogNormalizedRow" ADD CONSTRAINT "CatalogNormalizedRow_imageFileId_fkey" FOREIGN KEY ("imageFileId") REFERENCES "FileAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogNormalizedRow" ADD CONSTRAINT "CatalogNormalizedRow_matchedProductId_fkey" FOREIGN KEY ("matchedProductId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogNormalizedRow" ADD CONSTRAINT "CatalogNormalizedRow_matchedProductVariantId_fkey" FOREIGN KEY ("matchedProductVariantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogNormalizedRow" ADD CONSTRAINT "CatalogNormalizedRow_matchedSupplierProductId_fkey" FOREIGN KEY ("matchedSupplierProductId") REFERENCES "SupplierProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogMatchCandidate" ADD CONSTRAINT "CatalogMatchCandidate_importId_fkey" FOREIGN KEY ("importId") REFERENCES "SupplierPriceImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogMatchCandidate" ADD CONSTRAINT "CatalogMatchCandidate_rawRowId_fkey" FOREIGN KEY ("rawRowId") REFERENCES "SupplierPriceImportRow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogMatchCandidate" ADD CONSTRAINT "CatalogMatchCandidate_normalizedRowId_fkey" FOREIGN KEY ("normalizedRowId") REFERENCES "CatalogNormalizedRow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogMatchCandidate" ADD CONSTRAINT "CatalogMatchCandidate_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogMatchCandidate" ADD CONSTRAINT "CatalogMatchCandidate_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogMatchCandidate" ADD CONSTRAINT "CatalogMatchCandidate_supplierProductId_fkey" FOREIGN KEY ("supplierProductId") REFERENCES "SupplierProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogValidationIssue" ADD CONSTRAINT "CatalogValidationIssue_importId_fkey" FOREIGN KEY ("importId") REFERENCES "SupplierPriceImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogValidationIssue" ADD CONSTRAINT "CatalogValidationIssue_rawRowId_fkey" FOREIGN KEY ("rawRowId") REFERENCES "SupplierPriceImportRow"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogValidationIssue" ADD CONSTRAINT "CatalogValidationIssue_normalizedRowId_fkey" FOREIGN KEY ("normalizedRowId") REFERENCES "CatalogNormalizedRow"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogValidationIssue" ADD CONSTRAINT "CatalogValidationIssue_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogValidationIssue" ADD CONSTRAINT "CatalogValidationIssue_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogValidationIssue" ADD CONSTRAINT "CatalogValidationIssue_supplierProductId_fkey" FOREIGN KEY ("supplierProductId") REFERENCES "SupplierProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogValidationIssue" ADD CONSTRAINT "CatalogValidationIssue_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogPublishBatch" ADD CONSTRAINT "CatalogPublishBatch_importId_fkey" FOREIGN KEY ("importId") REFERENCES "SupplierPriceImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogPublishBatch" ADD CONSTRAINT "CatalogPublishBatch_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
