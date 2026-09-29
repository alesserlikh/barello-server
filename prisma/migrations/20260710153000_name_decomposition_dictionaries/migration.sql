-- CreateEnum
CREATE TYPE "NameDictionaryKind" AS ENUM ('CATEGORY_PREFIX', 'FEATURE', 'TRADE_TERM', 'BRAND');

-- CreateEnum
CREATE TYPE "NameTranslationSource" AS ENUM ('SUPPLIER_FILE', 'MODERATOR', 'GENERATED');

-- AlterTable
ALTER TABLE "Product" ADD COLUMN "alcoholPercentMax" DECIMAL(5,2),
ADD COLUMN "features" JSONB;

-- CreateTable
CREATE TABLE "CatalogNameDictionaryEntry" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "kind" "NameDictionaryKind" NOT NULL,
    "pattern" TEXT NOT NULL,
    "normalizedPattern" TEXT NOT NULL,
    "payloadJson" JSONB NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogNameDictionaryEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductNameTranslation" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "normalizedRu" TEXT NOT NULL,
    "ruName" TEXT NOT NULL,
    "enName" TEXT NOT NULL,
    "source" "NameTranslationSource" NOT NULL,
    "confidence" DECIMAL(5,2) NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductNameTranslation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CatalogNameDictionaryEntry_kind_normalizedPattern_key" ON "CatalogNameDictionaryEntry"("kind", "normalizedPattern");

-- CreateIndex
CREATE INDEX "CatalogNameDictionaryEntry_kind_isActive_idx" ON "CatalogNameDictionaryEntry"("kind", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "ProductNameTranslation_normalizedRu_key" ON "ProductNameTranslation"("normalizedRu");

-- CreateIndex
CREATE INDEX "ProductNameTranslation_source_idx" ON "ProductNameTranslation"("source");
