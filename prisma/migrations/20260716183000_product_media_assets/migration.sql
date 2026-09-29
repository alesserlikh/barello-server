CREATE TABLE IF NOT EXISTS "ProductMediaAsset" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "productId" UUID NOT NULL,
    "fileAssetId" UUID NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductMediaAsset_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProductMediaAsset_fileAssetId_key" ON "ProductMediaAsset"("fileAssetId");
CREATE INDEX IF NOT EXISTS "ProductMediaAsset_productId_sortOrder_idx" ON "ProductMediaAsset"("productId", "sortOrder");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProductMediaAsset_productId_fkey') THEN
    ALTER TABLE "ProductMediaAsset"
      ADD CONSTRAINT "ProductMediaAsset_productId_fkey"
      FOREIGN KEY ("productId") REFERENCES "Product"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProductMediaAsset_fileAssetId_fkey') THEN
    ALTER TABLE "ProductMediaAsset"
      ADD CONSTRAINT "ProductMediaAsset_fileAssetId_fkey"
      FOREIGN KEY ("fileAssetId") REFERENCES "FileAsset"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
