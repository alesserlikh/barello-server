ALTER TABLE "SupplierCatalogCategoryMapping"
RENAME TO "CatalogCategoryMapping";

ALTER TABLE "CatalogCategoryMapping"
RENAME CONSTRAINT "SupplierCatalogCategoryMapping_pkey"
TO "CatalogCategoryMapping_pkey";

ALTER TABLE "CatalogCategoryMapping"
RENAME CONSTRAINT "SupplierCatalogCategoryMapping_supplierId_fkey"
TO "CatalogCategoryMapping_supplierId_fkey";

ALTER TABLE "CatalogCategoryMapping"
RENAME CONSTRAINT "SupplierCatalogCategoryMapping_catalogCategoryId_fkey"
TO "CatalogCategoryMapping_catalogCategoryId_fkey";

ALTER INDEX "SupplierCatalogCategoryMapping_catalogCategoryId_idx"
RENAME TO "CatalogCategoryMapping_catalogCategoryId_idx";

DROP INDEX "SupplierCatalogCategoryMapping_supplierId_normalizedRawCategory_key";

ALTER TABLE "CatalogCategoryMapping"
ALTER COLUMN "supplierId" DROP NOT NULL;

CREATE INDEX "CatalogCategoryMapping_supplierId_normalizedRawCategory_idx"
ON "CatalogCategoryMapping"("supplierId", "normalizedRawCategory");

CREATE UNIQUE INDEX "CatalogCategoryMapping_normalizedRawCategory_global_key"
ON "CatalogCategoryMapping"("normalizedRawCategory")
WHERE "supplierId" IS NULL;

CREATE UNIQUE INDEX "CatalogCategoryMapping_supplierId_normalizedRawCategory_key"
ON "CatalogCategoryMapping"("supplierId", "normalizedRawCategory")
WHERE "supplierId" IS NOT NULL;
