-- CreateEnum
CREATE TYPE "FacetType" AS ENUM ('CHIPS', 'MULTISELECT', 'RANGE', 'TOGGLE', 'BUCKET');

-- CreateEnum
CREATE TYPE "FacetLevel" AS ENUM ('PRODUCT', 'VARIANT', 'OFFER');

-- CreateEnum
CREATE TYPE "FacetScope" AS ENUM ('CATALOG', 'VENUE_STOCK', 'SUPPLIER_STOCK', 'ADMIN_CATALOG', 'PRICE_IMPORT', 'MENU', 'INVENTORY');

-- CreateEnum
CREATE TYPE "FacetOptionSource" AS ENUM ('STATIC', 'DYNAMIC');

-- AlterTable
ALTER TABLE "Product" ADD COLUMN "attributesJson" JSONB;

-- AlterTable
ALTER TABLE "ProductVariant" ADD COLUMN "packagingType" TEXT;

-- CreateTable
CREATE TABLE "FacetRegistryEntry" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "key" VARCHAR(80) NOT NULL,
    "label" TEXT NOT NULL,
    "type" "FacetType" NOT NULL,
    "level" "FacetLevel" NOT NULL,
    "scopes" "FacetScope"[] NOT NULL,
    "categoryId" UUID,
    "categoryScope" JSONB,
    "dataSource" TEXT NOT NULL,
    "optionSource" "FacetOptionSource" NOT NULL DEFAULT 'DYNAMIC',
    "minFillRate" DECIMAL(5,4) NOT NULL DEFAULT 0.05,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FacetRegistryEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacetOption" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "facetId" UUID NOT NULL,
    "value" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FacetOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserCatalogFilterPreset" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "scope" "FacetScope" NOT NULL,
    "name" TEXT NOT NULL,
    "query" JSONB NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserCatalogFilterPreset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FacetRegistryEntry_key_key" ON "FacetRegistryEntry"("key");

-- CreateIndex
CREATE INDEX "FacetRegistryEntry_isActive_sortOrder_idx" ON "FacetRegistryEntry"("isActive", "sortOrder");

-- CreateIndex
CREATE INDEX "FacetRegistryEntry_categoryId_idx" ON "FacetRegistryEntry"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "FacetOption_facetId_value_key" ON "FacetOption"("facetId", "value");

-- CreateIndex
CREATE INDEX "FacetOption_facetId_sortOrder_idx" ON "FacetOption"("facetId", "sortOrder");

-- CreateIndex
CREATE INDEX "FacetOption_isActive_idx" ON "FacetOption"("isActive");

-- CreateIndex
CREATE INDEX "UserCatalogFilterPreset_userId_scope_idx" ON "UserCatalogFilterPreset"("userId", "scope");

-- CreateIndex
CREATE INDEX "UserCatalogFilterPreset_isDefault_idx" ON "UserCatalogFilterPreset"("isDefault");

-- CreateIndex
CREATE INDEX "Product_attributesJson_idx" ON "Product" USING GIN ("attributesJson");

-- AddForeignKey
ALTER TABLE "FacetRegistryEntry" ADD CONSTRAINT "FacetRegistryEntry_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "CatalogCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacetOption" ADD CONSTRAINT "FacetOption_facetId_fkey" FOREIGN KEY ("facetId") REFERENCES "FacetRegistryEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserCatalogFilterPreset" ADD CONSTRAINT "UserCatalogFilterPreset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
