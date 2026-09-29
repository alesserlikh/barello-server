-- AlterTable
ALTER TABLE "Venue" ADD COLUMN "showPhoneInCard" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Supplier"
ADD COLUMN "showPhoneInCard" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "SupplierMembership"
ADD COLUMN "notifyByEmail" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "notifyByMessenger" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "messengerType" TEXT,
ADD COLUMN "messengerContact" TEXT;

-- AlterTable
ALTER TABLE "ContractSupplier" ADD COLUMN "isPreferred" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "VenuePhoto" (
    "id" UUID NOT NULL,
    "venueId" UUID NOT NULL,
    "fileAssetId" UUID NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VenuePhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierPhoto" (
    "id" UUID NOT NULL,
    "supplierId" UUID NOT NULL,
    "fileAssetId" UUID NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierStockImport" (
    "id" UUID NOT NULL,
    "supplierId" UUID NOT NULL,
    "fileAssetId" UUID NOT NULL,
    "sourceFormat" "PriceImportSourceFormat" NOT NULL,
    "status" "PriceImportStatus" NOT NULL DEFAULT 'PENDING',
    "rowsCount" INTEGER NOT NULL DEFAULT 0,
    "processedRows" INTEGER NOT NULL DEFAULT 0,
    "failedRows" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierStockImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierInventoryItem" (
    "id" UUID NOT NULL,
    "supplierId" UUID NOT NULL,
    "productId" UUID,
    "name" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unit" "UnitType" NOT NULL,
    "isOutOfStock" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierInventoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierRegionPresence" (
    "id" UUID NOT NULL,
    "supplierId" UUID NOT NULL,
    "regionCode" TEXT NOT NULL,
    "regionName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierRegionPresence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VenuePhoto_venueId_idx" ON "VenuePhoto"("venueId");

-- CreateIndex
CREATE INDEX "VenuePhoto_fileAssetId_idx" ON "VenuePhoto"("fileAssetId");

-- CreateIndex
CREATE INDEX "SupplierPhoto_supplierId_idx" ON "SupplierPhoto"("supplierId");

-- CreateIndex
CREATE INDEX "SupplierPhoto_fileAssetId_idx" ON "SupplierPhoto"("fileAssetId");

-- CreateIndex
CREATE INDEX "SupplierStockImport_supplierId_idx" ON "SupplierStockImport"("supplierId");

-- CreateIndex
CREATE INDEX "SupplierStockImport_status_idx" ON "SupplierStockImport"("status");

-- CreateIndex
CREATE INDEX "SupplierInventoryItem_supplierId_idx" ON "SupplierInventoryItem"("supplierId");

-- CreateIndex
CREATE INDEX "SupplierInventoryItem_productId_idx" ON "SupplierInventoryItem"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierRegionPresence_supplierId_regionCode_key" ON "SupplierRegionPresence"("supplierId", "regionCode");

-- CreateIndex
CREATE INDEX "SupplierRegionPresence_supplierId_idx" ON "SupplierRegionPresence"("supplierId");

-- AddForeignKey
ALTER TABLE "VenuePhoto" ADD CONSTRAINT "VenuePhoto_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VenuePhoto" ADD CONSTRAINT "VenuePhoto_fileAssetId_fkey" FOREIGN KEY ("fileAssetId") REFERENCES "FileAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPhoto" ADD CONSTRAINT "SupplierPhoto_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPhoto" ADD CONSTRAINT "SupplierPhoto_fileAssetId_fkey" FOREIGN KEY ("fileAssetId") REFERENCES "FileAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierStockImport" ADD CONSTRAINT "SupplierStockImport_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierStockImport" ADD CONSTRAINT "SupplierStockImport_fileAssetId_fkey" FOREIGN KEY ("fileAssetId") REFERENCES "FileAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierInventoryItem" ADD CONSTRAINT "SupplierInventoryItem_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierInventoryItem" ADD CONSTRAINT "SupplierInventoryItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierRegionPresence" ADD CONSTRAINT "SupplierRegionPresence_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
