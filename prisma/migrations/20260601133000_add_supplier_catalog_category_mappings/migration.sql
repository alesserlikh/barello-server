CREATE TABLE "SupplierCatalogCategoryMapping" (
    "id" UUID NOT NULL,
    "supplierId" UUID NOT NULL,
    "rawCategory" TEXT NOT NULL,
    "normalizedRawCategory" TEXT NOT NULL,
    "catalogCategoryId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierCatalogCategoryMapping_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SupplierCatalogCategoryMapping_supplierId_normalizedRawCategory_key"
ON "SupplierCatalogCategoryMapping"("supplierId", "normalizedRawCategory");

CREATE INDEX "SupplierCatalogCategoryMapping_catalogCategoryId_idx"
ON "SupplierCatalogCategoryMapping"("catalogCategoryId");

ALTER TABLE "SupplierCatalogCategoryMapping"
ADD CONSTRAINT "SupplierCatalogCategoryMapping_supplierId_fkey"
FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SupplierCatalogCategoryMapping"
ADD CONSTRAINT "SupplierCatalogCategoryMapping_catalogCategoryId_fkey"
FOREIGN KEY ("catalogCategoryId") REFERENCES "CatalogCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
