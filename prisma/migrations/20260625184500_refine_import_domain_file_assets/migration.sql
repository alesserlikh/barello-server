-- Canonical status for newly uploaded price/stock imports.
ALTER TABLE "SupplierPriceImport" ALTER COLUMN "status" SET DEFAULT 'UPLOADED';
ALTER TABLE "SupplierStockImport" ALTER COLUMN "status" SET DEFAULT 'UPLOADED';

UPDATE "SupplierPriceImport"
SET "status" = 'UPLOADED'
WHERE "status" = 'PENDING';

UPDATE "SupplierStockImport"
SET "status" = 'UPLOADED'
WHERE "status" = 'PENDING';

-- Product media fields are now first-class FileAsset relations.
CREATE INDEX IF NOT EXISTS "Product_barcodeImageFileId_idx" ON "Product"("barcodeImageFileId");
CREATE INDEX IF NOT EXISTS "Product_mainImageFileId_idx" ON "Product"("mainImageFileId");
CREATE INDEX IF NOT EXISTS "Product_promoVideoFileId_idx" ON "Product"("promoVideoFileId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Product_barcodeImageFileId_fkey') THEN
    ALTER TABLE "Product"
      ADD CONSTRAINT "Product_barcodeImageFileId_fkey"
      FOREIGN KEY ("barcodeImageFileId") REFERENCES "FileAsset"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Product_mainImageFileId_fkey') THEN
    ALTER TABLE "Product"
      ADD CONSTRAINT "Product_mainImageFileId_fkey"
      FOREIGN KEY ("mainImageFileId") REFERENCES "FileAsset"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Product_promoVideoFileId_fkey') THEN
    ALTER TABLE "Product"
      ADD CONSTRAINT "Product_promoVideoFileId_fkey"
      FOREIGN KEY ("promoVideoFileId") REFERENCES "FileAsset"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- PostgreSQL treats NULL values as distinct in a regular unique index.
-- These partial indexes make global profiles unique by code/version while
-- preserving supplier-specific versions.
CREATE UNIQUE INDEX IF NOT EXISTS "SupplierImportProfile_global_code_version_key"
  ON "SupplierImportProfile"("code", "version")
  WHERE "supplierId" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "SupplierImportProfile_supplier_code_version_key"
  ON "SupplierImportProfile"("supplierId", "code", "version")
  WHERE "supplierId" IS NOT NULL;
