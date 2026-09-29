-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'PENDING_VENUE_CONFIRMATION', 'BLOCKED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AccessLevel" AS ENUM ('ADMIN', 'SENIOR_STAFF', 'LINE_STAFF');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('PENDING', 'ACTIVE', 'REJECTED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "DisplayRole" AS ENUM ('OWNER', 'ADMINISTRATOR', 'SENIOR_BARTENDER', 'LINE_BARTENDER', 'SOMMELIER', 'WAITER');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('TODO', 'IN_PROGRESS', 'DONE', 'CANCELED');

-- CreateEnum
CREATE TYPE "TaskPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "VerificationCodeType" AS ENUM ('LOGIN', 'REGISTER', 'RESET_PASSWORD');

-- CreateEnum
CREATE TYPE "SupplierSpecialConditionType" AS ENUM ('GLOBAL_DISCOUNT', 'PRODUCT_DISCOUNT', 'SPECIAL_PRICE', 'MOQ', 'DEFERRED_PAYMENT', 'DELIVERY_TERM');

-- CreateEnum
CREATE TYPE "PriceImportSourceFormat" AS ENUM ('XLSX', 'CSV', 'XML', 'API');

-- CreateEnum
CREATE TYPE "PriceImportStatus" AS ENUM ('PENDING', 'PROCESSING', 'PROCESSED', 'FAILED');

-- CreateEnum
CREATE TYPE "PriceImportRowMappingStatus" AS ENUM ('MATCHED', 'UNMATCHED', 'MANUAL_MATCHED', 'FAILED');

-- CreateEnum
CREATE TYPE "OfferAvailabilityLevel" AS ENUM ('IN_STOCK', 'LOW_STOCK', 'OUT_OF_STOCK');

-- CreateEnum
CREATE TYPE "ContractSupplierStatus" AS ENUM ('ACTIVE', 'PAUSED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "SponsoredPlacementType" AS ENUM ('CATEGORY_TOP', 'SEARCH_TOP', 'FEED_INLINE', 'BANNER');

-- CreateEnum
CREATE TYPE "CartStatus" AS ENUM ('ACTIVE', 'CONVERTED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "OrderBatchStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'PARTIALLY_SENT', 'COMPLETED', 'CANCELED');

-- CreateEnum
CREATE TYPE "SupplierOrderStatus" AS ENUM ('PENDING', 'ACCEPTED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'REJECTED', 'CANCELED');

-- CreateEnum
CREATE TYPE "SupplierOrderChannel" AS ENUM ('EMAIL', 'API', 'MANUAL');

-- CreateEnum
CREATE TYPE "SupplierOrderStatusActorType" AS ENUM ('SUPPLIER', 'SYSTEM');

-- CreateEnum
CREATE TYPE "DeliveryConfirmationDecision" AS ENUM ('ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "UnitType" AS ENUM ('KG', 'L', 'PCS', 'G', 'ML');

-- CreateEnum
CREATE TYPE "InventoryReservationReferenceType" AS ENUM ('ORDER', 'MANUAL');

-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('PURCHASE', 'CONSUMPTION', 'ADJUSTMENT', 'WRITE_OFF', 'RETURN', 'MANUAL_RECEIPT');

-- CreateEnum
CREATE TYPE "StockMovementReferenceType" AS ENUM ('ORDER', 'MENU', 'TECH_CARD', 'INVENTORY', 'MANUAL', 'SALES_IMPORT', 'INVENTORY_SESSION');

-- CreateEnum
CREATE TYPE "StockAlertType" AS ENUM ('MISSING_INGREDIENT', 'LOW_STOCK', 'MANUAL_WARNING');

-- CreateEnum
CREATE TYPE "MenuItemType" AS ENUM ('PRODUCT', 'DISH');

-- CreateEnum
CREATE TYPE "MenuItemTagType" AS ENUM ('MANUAL', 'AUTO');

-- CreateEnum
CREATE TYPE "InventorySessionStatus" AS ENUM ('IN_PROGRESS', 'SUBMITTED_FOR_REVIEW', 'CLOSED');

-- CreateEnum
CREATE TYPE "SalesImportStatus" AS ENUM ('PENDING', 'PROCESSING', 'PROCESSED', 'FAILED');

-- CreateEnum
CREATE TYPE "SalesImportSourceFormat" AS ENUM ('XLSX', 'CSV');

-- CreateEnum
CREATE TYPE "SalesReportRowMappingStatus" AS ENUM ('MATCHED', 'UNMATCHED', 'MANUAL_MATCHED');

-- CreateEnum
CREATE TYPE "AnalyticsPeriodType" AS ENUM ('DAY', 'WEEK', 'MONTH');

-- CreateEnum
CREATE TYPE "FileAssetType" AS ENUM ('IMAGE', 'VIDEO', 'DOCUMENT', 'SPREADSHEET', 'BANNER', 'OTHER');

-- CreateEnum
CREATE TYPE "AuditActorType" AS ENUM ('USER', 'SUPPLIER', 'SYSTEM');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "passwordHash" TEXT,
    "status" "UserStatus" NOT NULL,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserProfile" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "middleName" TEXT,
    "avatarFileId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserVenueMembership" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "venueId" UUID NOT NULL,
    "displayRole" "DisplayRole" NOT NULL,
    "accessLevel" "AccessLevel" NOT NULL,
    "membershipStatus" "MembershipStatus" NOT NULL,
    "joinedAt" TIMESTAMP(3),
    "confirmedByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserVenueMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserNote" (
    "id" UUID NOT NULL,
    "authorUserId" UUID NOT NULL,
    "venueId" UUID,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserNoteAccess" (
    "id" UUID NOT NULL,
    "noteId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserNoteAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserTask" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "TaskStatus" NOT NULL DEFAULT 'TODO',
    "priority" "TaskPriority" NOT NULL DEFAULT 'MEDIUM',
    "creatorUserId" UUID NOT NULL,
    "assigneeUserId" UUID NOT NULL,
    "venueId" UUID,
    "dueDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthSession" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationCode" (
    "id" UUID NOT NULL,
    "target" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" "VerificationCodeType" NOT NULL,
    "userId" UUID,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerificationCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Business" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "taxNumber" TEXT NOT NULL,
    "legalAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Business_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Venue" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "address" TEXT,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "phone" TEXT,
    "email" TEXT,
    "website" TEXT,
    "contactPersonName" TEXT,
    "seatsCount" INTEGER,
    "mainPhotoFileId" UUID,
    "showAdminContactsToSuppliers" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Venue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CuisineType" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CuisineType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VenueCuisineType" (
    "id" UUID NOT NULL,
    "venueId" UUID NOT NULL,
    "cuisineTypeId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VenueCuisineType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT,
    "address" TEXT,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "contactName" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "website" TEXT,
    "passwordHash" TEXT NOT NULL,
    "pinHash" TEXT,
    "mainPhotoFileId" UUID,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierCategory" (
    "id" UUID NOT NULL,
    "supplierId" UUID NOT NULL,
    "catalogCategoryId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierSpecialCondition" (
    "id" UUID NOT NULL,
    "supplierId" UUID NOT NULL,
    "venueId" UUID NOT NULL,
    "conditionType" "SupplierSpecialConditionType" NOT NULL,
    "valueJson" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierSpecialCondition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierPriceImport" (
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

    CONSTRAINT "SupplierPriceImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierPriceImportRow" (
    "id" UUID NOT NULL,
    "importId" UUID NOT NULL,
    "rawName" TEXT NOT NULL,
    "rawCategory" TEXT,
    "mappedProductId" UUID,
    "mappedOfferId" UUID,
    "mappingStatus" "PriceImportRowMappingStatus" NOT NULL,
    "rawPayload" JSONB,
    "errorText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierPriceImportRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogCategory" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "categoryId" UUID,
    "rawCategory" TEXT,
    "description" TEXT,
    "barcode" TEXT,
    "barcodeImageFileId" UUID,
    "article" TEXT,
    "manufacturer" TEXT,
    "manufacturedYear" INTEGER,
    "translatedName" TEXT,
    "packageVolume" DECIMAL(12,3),
    "packageVolumeUnit" TEXT,
    "packageQuantity" DECIMAL(12,3),
    "mainImageFileId" UUID,
    "promoVideoFileId" UUID,
    "isPromo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductVariant" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "volume" DECIMAL(12,3),
    "volumeUnit" TEXT,
    "packageSize" DECIMAL(12,3),
    "packageSizeUnit" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierProduct" (
    "id" UUID NOT NULL,
    "supplierId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "productVariantId" UUID,
    "supplierSku" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Offer" (
    "id" UUID NOT NULL,
    "supplierProductId" UUID NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'RUB',
    "unit" TEXT NOT NULL,
    "minOrderQty" DECIMAL(12,3),
    "availabilityLevel" "OfferAvailabilityLevel" NOT NULL DEFAULT 'IN_STOCK',
    "deliveryTerm" TEXT,
    "specialOfferText" TEXT,
    "specialConditionText" TEXT,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Offer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractSupplier" (
    "id" UUID NOT NULL,
    "venueId" UUID NOT NULL,
    "supplierId" UUID NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "status" "ContractSupplierStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContractSupplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserFavoriteProduct" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "venueId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserFavoriteProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogCategoryBanner" (
    "id" UUID NOT NULL,
    "catalogCategoryId" UUID NOT NULL,
    "supplierId" UUID,
    "fileAssetId" UUID NOT NULL,
    "title" TEXT,
    "linkUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogCategoryBanner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogBanner" (
    "id" UUID NOT NULL,
    "supplierId" UUID,
    "catalogCategoryId" UUID,
    "fileAssetId" UUID NOT NULL,
    "title" TEXT,
    "linkUrl" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogBanner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SponsoredProductPlacement" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "supplierId" UUID,
    "offerId" UUID,
    "placementType" "SponsoredPlacementType" NOT NULL,
    "catalogCategoryId" UUID,
    "searchKeyword" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SponsoredProductPlacement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogSearchSuggestion" (
    "id" UUID NOT NULL,
    "keyword" TEXT NOT NULL,
    "productId" UUID,
    "catalogCategoryId" UUID,
    "supplierId" UUID,
    "score" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogSearchSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cart" (
    "id" UUID NOT NULL,
    "venueId" UUID NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "status" "CartStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cart_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CartItem" (
    "id" UUID NOT NULL,
    "cartId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "productVariantId" UUID,
    "offerId" UUID NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unit" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CartItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderBatch" (
    "id" UUID NOT NULL,
    "venueId" UUID NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "cartId" UUID,
    "status" "OrderBatchStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierOrder" (
    "id" UUID NOT NULL,
    "orderBatchId" UUID NOT NULL,
    "venueId" UUID NOT NULL,
    "supplierId" UUID NOT NULL,
    "status" "SupplierOrderStatus" NOT NULL DEFAULT 'PENDING',
    "totalAmount" DECIMAL(12,2),
    "currency" TEXT NOT NULL DEFAULT 'RUB',
    "channel" "SupplierOrderChannel" NOT NULL DEFAULT 'EMAIL',
    "orderedAt" TIMESTAMP(3),
    "expectedDeliveryAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierOrderItem" (
    "id" UUID NOT NULL,
    "supplierOrderId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "productVariantId" UUID,
    "offerId" UUID NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "unit" TEXT NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierOrderStatusEvent" (
    "id" UUID NOT NULL,
    "supplierOrderId" UUID NOT NULL,
    "status" "SupplierOrderStatus" NOT NULL,
    "comment" TEXT,
    "actorType" "SupplierOrderStatusActorType" NOT NULL,
    "actorSupplierId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierOrderStatusEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderDeliveryConfirmation" (
    "id" UUID NOT NULL,
    "supplierOrderId" UUID NOT NULL,
    "confirmedByUserId" UUID NOT NULL,
    "decision" "DeliveryConfirmationDecision" NOT NULL,
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderDeliveryConfirmation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryItem" (
    "id" UUID NOT NULL,
    "venueId" UUID NOT NULL,
    "productId" UUID,
    "name" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unit" "UnitType" NOT NULL,
    "minThreshold" DECIMAL(12,3),
    "avgPrice" DECIMAL(12,2),
    "lastPurchasePrice" DECIMAL(12,2),
    "isOutOfStock" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryReservation" (
    "id" UUID NOT NULL,
    "venueId" UUID NOT NULL,
    "inventoryItemId" UUID NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unit" "UnitType" NOT NULL,
    "reason" TEXT,
    "referenceType" "InventoryReservationReferenceType",
    "referenceId" UUID,
    "reservedByUserId" UUID NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" UUID NOT NULL,
    "venueId" UUID NOT NULL,
    "inventoryItemId" UUID NOT NULL,
    "type" "StockMovementType" NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unit" "UnitType" NOT NULL,
    "price" DECIMAL(12,2),
    "referenceType" "StockMovementReferenceType",
    "referenceId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockAlert" (
    "id" UUID NOT NULL,
    "venueId" UUID NOT NULL,
    "inventoryItemId" UUID,
    "message" TEXT NOT NULL,
    "type" "StockAlertType" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StopListItem" (
    "id" UUID NOT NULL,
    "venueId" UUID NOT NULL,
    "menuItemId" UUID NOT NULL,
    "reason" TEXT,
    "isManual" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StopListItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MenuCategory" (
    "id" UUID NOT NULL,
    "venueId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MenuCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MenuItem" (
    "id" UUID NOT NULL,
    "venueId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "flavorProfile" TEXT,
    "type" "MenuItemType" NOT NULL,
    "productId" UUID,
    "price" DECIMAL(12,2) NOT NULL,
    "unit" TEXT NOT NULL,
    "calculatedCost" DECIMAL(12,2),
    "costCalculatedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MenuItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MenuItemTag" (
    "id" UUID NOT NULL,
    "menuItemId" UUID NOT NULL,
    "venueId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "tagType" "MenuItemTagType" NOT NULL,
    "isVenueShared" BOOLEAN NOT NULL DEFAULT false,
    "createdByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MenuItemTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MenuItemAnalog" (
    "id" UUID NOT NULL,
    "menuItemId" UUID NOT NULL,
    "analogMenuItemId" UUID NOT NULL,
    "assignedByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MenuItemAnalog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MenuItemPairingStat" (
    "id" UUID NOT NULL,
    "venueId" UUID NOT NULL,
    "menuItemId" UUID NOT NULL,
    "pairedMenuItemId" UUID NOT NULL,
    "pairingCount" INTEGER NOT NULL DEFAULT 0,
    "lastUpdatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MenuItemPairingStat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TechCard" (
    "id" UUID NOT NULL,
    "menuItemId" UUID NOT NULL,
    "outputQuantity" DECIMAL(12,3) NOT NULL,
    "outputUnit" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TechCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TechCardIngredient" (
    "id" UUID NOT NULL,
    "techCardId" UUID NOT NULL,
    "inventoryItemId" UUID NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unit" "UnitType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TechCardIngredient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventorySession" (
    "id" UUID NOT NULL,
    "venueId" UUID NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "status" "InventorySessionStatus" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventorySession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventorySessionItem" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "inventoryItemId" UUID NOT NULL,
    "expectedQty" DECIMAL(12,3) NOT NULL,
    "actualQty" DECIMAL(12,3),
    "expectedUnit" "UnitType" NOT NULL,
    "actualUnit" "UnitType",
    "differenceQty" DECIMAL(12,3),
    "differenceValue" DECIMAL(12,2),
    "note" TEXT,
    "countedByUserId" UUID,
    "countedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventorySessionItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnitConversionProfile" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "catalogUnit" TEXT,
    "inventoryBaseUnit" TEXT NOT NULL,
    "menuSaleUnit" TEXT,
    "inventoryInputUnit" TEXT,
    "baseToInputFactor" DECIMAL(18,6),
    "catalogToBaseFactor" DECIMAL(18,6),
    "menuToBaseFactor" DECIMAL(18,6),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UnitConversionProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesReportImport" (
    "id" UUID NOT NULL,
    "venueId" UUID NOT NULL,
    "fileAssetId" UUID NOT NULL,
    "status" "SalesImportStatus" NOT NULL DEFAULT 'PENDING',
    "sourceFormat" "SalesImportSourceFormat" NOT NULL,
    "uploadedByUserId" UUID NOT NULL,
    "periodStart" DATE,
    "periodEnd" DATE,
    "rowsCount" INTEGER NOT NULL DEFAULT 0,
    "processedRows" INTEGER NOT NULL DEFAULT 0,
    "failedRows" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesReportImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesReportRow" (
    "id" UUID NOT NULL,
    "importId" UUID NOT NULL,
    "venueId" UUID NOT NULL,
    "rawName" TEXT NOT NULL,
    "rawCategory" TEXT,
    "mappedMenuItemId" UUID,
    "quantity" DECIMAL(12,3) NOT NULL,
    "revenue" DECIMAL(12,2) NOT NULL,
    "costAmount" DECIMAL(12,2),
    "marginAmount" DECIMAL(12,2),
    "saleDate" DATE,
    "mappingStatus" "SalesReportRowMappingStatus" NOT NULL,
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesReportRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VenueAnalyticsSnapshot" (
    "id" UUID NOT NULL,
    "venueId" UUID NOT NULL,
    "periodType" "AnalyticsPeriodType" NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "stockValue" DECIMAL(12,2),
    "lowStockCount" INTEGER NOT NULL DEFAULT 0,
    "stopListCount" INTEGER NOT NULL DEFAULT 0,
    "purchaseAmount" DECIMAL(12,2),
    "salesRevenue" DECIMAL(12,2),
    "salesCost" DECIMAL(12,2),
    "salesMargin" DECIMAL(12,2),
    "writeOffAmount" DECIMAL(12,2),
    "inventoryDifference" DECIMAL(12,2),
    "priceGrowthCount" INTEGER NOT NULL DEFAULT 0,
    "topItemsJson" JSONB,
    "worstItemsJson" JSONB,
    "stopListItemsJson" JSONB,
    "pairingStatsJson" JSONB,
    "stockForecastJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VenueAnalyticsSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FileAsset" (
    "id" UUID NOT NULL,
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "type" "FileAssetType" NOT NULL,
    "uploadedByUserId" UUID,
    "uploadedBySupplierId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FileAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "actorType" "AuditActorType" NOT NULL,
    "actorUserId" UUID,
    "actorSupplierId" UUID,
    "entityType" TEXT NOT NULL,
    "entityId" UUID,
    "action" TEXT NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "UserProfile_userId_key" ON "UserProfile"("userId");

-- CreateIndex
CREATE INDEX "UserVenueMembership_venueId_idx" ON "UserVenueMembership"("venueId");

-- CreateIndex
CREATE INDEX "UserVenueMembership_confirmedByUserId_idx" ON "UserVenueMembership"("confirmedByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "UserVenueMembership_userId_venueId_key" ON "UserVenueMembership"("userId", "venueId");

-- CreateIndex
CREATE INDEX "UserNote_authorUserId_idx" ON "UserNote"("authorUserId");

-- CreateIndex
CREATE INDEX "UserNote_venueId_idx" ON "UserNote"("venueId");

-- CreateIndex
CREATE INDEX "UserNoteAccess_userId_idx" ON "UserNoteAccess"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserNoteAccess_noteId_userId_key" ON "UserNoteAccess"("noteId", "userId");

-- CreateIndex
CREATE INDEX "UserTask_creatorUserId_idx" ON "UserTask"("creatorUserId");

-- CreateIndex
CREATE INDEX "UserTask_assigneeUserId_idx" ON "UserTask"("assigneeUserId");

-- CreateIndex
CREATE INDEX "UserTask_venueId_idx" ON "UserTask"("venueId");

-- CreateIndex
CREATE INDEX "UserTask_status_idx" ON "UserTask"("status");

-- CreateIndex
CREATE INDEX "AuthSession_userId_idx" ON "AuthSession"("userId");

-- CreateIndex
CREATE INDEX "AuthSession_expiresAt_idx" ON "AuthSession"("expiresAt");

-- CreateIndex
CREATE INDEX "VerificationCode_userId_idx" ON "VerificationCode"("userId");

-- CreateIndex
CREATE INDEX "VerificationCode_target_type_idx" ON "VerificationCode"("target", "type");

-- CreateIndex
CREATE INDEX "VerificationCode_expiresAt_idx" ON "VerificationCode"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Business_taxNumber_key" ON "Business"("taxNumber");

-- CreateIndex
CREATE INDEX "Venue_businessId_idx" ON "Venue"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "CuisineType_name_key" ON "CuisineType"("name");

-- CreateIndex
CREATE INDEX "VenueCuisineType_cuisineTypeId_idx" ON "VenueCuisineType"("cuisineTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "VenueCuisineType_venueId_cuisineTypeId_key" ON "VenueCuisineType"("venueId", "cuisineTypeId");

-- CreateIndex
CREATE INDEX "SupplierCategory_catalogCategoryId_idx" ON "SupplierCategory"("catalogCategoryId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierCategory_supplierId_catalogCategoryId_key" ON "SupplierCategory"("supplierId", "catalogCategoryId");

-- CreateIndex
CREATE INDEX "SupplierSpecialCondition_supplierId_idx" ON "SupplierSpecialCondition"("supplierId");

-- CreateIndex
CREATE INDEX "SupplierSpecialCondition_venueId_idx" ON "SupplierSpecialCondition"("venueId");

-- CreateIndex
CREATE INDEX "SupplierSpecialCondition_conditionType_idx" ON "SupplierSpecialCondition"("conditionType");

-- CreateIndex
CREATE INDEX "SupplierPriceImport_supplierId_idx" ON "SupplierPriceImport"("supplierId");

-- CreateIndex
CREATE INDEX "SupplierPriceImport_status_idx" ON "SupplierPriceImport"("status");

-- CreateIndex
CREATE INDEX "SupplierPriceImportRow_importId_idx" ON "SupplierPriceImportRow"("importId");

-- CreateIndex
CREATE INDEX "SupplierPriceImportRow_mappedProductId_idx" ON "SupplierPriceImportRow"("mappedProductId");

-- CreateIndex
CREATE INDEX "SupplierPriceImportRow_mappedOfferId_idx" ON "SupplierPriceImportRow"("mappedOfferId");

-- CreateIndex
CREATE INDEX "SupplierPriceImportRow_mappingStatus_idx" ON "SupplierPriceImportRow"("mappingStatus");

-- CreateIndex
CREATE INDEX "CatalogCategory_parentId_idx" ON "CatalogCategory"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogCategory_name_parentId_key" ON "CatalogCategory"("name", "parentId");

-- CreateIndex
CREATE UNIQUE INDEX "Product_barcode_key" ON "Product"("barcode");

-- CreateIndex
CREATE INDEX "Product_categoryId_idx" ON "Product"("categoryId");

-- CreateIndex
CREATE INDEX "ProductVariant_productId_idx" ON "ProductVariant"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariant_productId_volume_volumeUnit_key" ON "ProductVariant"("productId", "volume", "volumeUnit");

-- CreateIndex
CREATE INDEX "SupplierProduct_productId_idx" ON "SupplierProduct"("productId");

-- CreateIndex
CREATE INDEX "SupplierProduct_productVariantId_idx" ON "SupplierProduct"("productVariantId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierProduct_supplierId_productId_key" ON "SupplierProduct"("supplierId", "productId");

-- CreateIndex
CREATE INDEX "Offer_supplierProductId_idx" ON "Offer"("supplierProductId");

-- CreateIndex
CREATE INDEX "Offer_isAvailable_idx" ON "Offer"("isAvailable");

-- CreateIndex
CREATE INDEX "Offer_price_idx" ON "Offer"("price");

-- CreateIndex
CREATE INDEX "ContractSupplier_supplierId_idx" ON "ContractSupplier"("supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "ContractSupplier_venueId_supplierId_key" ON "ContractSupplier"("venueId", "supplierId");

-- CreateIndex
CREATE INDEX "UserFavoriteProduct_productId_idx" ON "UserFavoriteProduct"("productId");

-- CreateIndex
CREATE INDEX "UserFavoriteProduct_venueId_idx" ON "UserFavoriteProduct"("venueId");

-- CreateIndex
CREATE UNIQUE INDEX "UserFavoriteProduct_userId_productId_venueId_key" ON "UserFavoriteProduct"("userId", "productId", "venueId");

-- CreateIndex
CREATE INDEX "CatalogCategoryBanner_catalogCategoryId_idx" ON "CatalogCategoryBanner"("catalogCategoryId");

-- CreateIndex
CREATE INDEX "CatalogCategoryBanner_supplierId_idx" ON "CatalogCategoryBanner"("supplierId");

-- CreateIndex
CREATE INDEX "CatalogBanner_supplierId_idx" ON "CatalogBanner"("supplierId");

-- CreateIndex
CREATE INDEX "CatalogBanner_catalogCategoryId_idx" ON "CatalogBanner"("catalogCategoryId");

-- CreateIndex
CREATE INDEX "CatalogBanner_position_idx" ON "CatalogBanner"("position");

-- CreateIndex
CREATE INDEX "SponsoredProductPlacement_productId_idx" ON "SponsoredProductPlacement"("productId");

-- CreateIndex
CREATE INDEX "SponsoredProductPlacement_supplierId_idx" ON "SponsoredProductPlacement"("supplierId");

-- CreateIndex
CREATE INDEX "SponsoredProductPlacement_offerId_idx" ON "SponsoredProductPlacement"("offerId");

-- CreateIndex
CREATE INDEX "SponsoredProductPlacement_catalogCategoryId_idx" ON "SponsoredProductPlacement"("catalogCategoryId");

-- CreateIndex
CREATE INDEX "SponsoredProductPlacement_placementType_position_idx" ON "SponsoredProductPlacement"("placementType", "position");

-- CreateIndex
CREATE INDEX "CatalogSearchSuggestion_keyword_idx" ON "CatalogSearchSuggestion"("keyword");

-- CreateIndex
CREATE INDEX "CatalogSearchSuggestion_productId_idx" ON "CatalogSearchSuggestion"("productId");

-- CreateIndex
CREATE INDEX "CatalogSearchSuggestion_catalogCategoryId_idx" ON "CatalogSearchSuggestion"("catalogCategoryId");

-- CreateIndex
CREATE INDEX "CatalogSearchSuggestion_supplierId_idx" ON "CatalogSearchSuggestion"("supplierId");

-- CreateIndex
CREATE INDEX "Cart_venueId_idx" ON "Cart"("venueId");

-- CreateIndex
CREATE INDEX "Cart_createdByUserId_idx" ON "Cart"("createdByUserId");

-- CreateIndex
CREATE INDEX "CartItem_cartId_idx" ON "CartItem"("cartId");

-- CreateIndex
CREATE INDEX "CartItem_productId_idx" ON "CartItem"("productId");

-- CreateIndex
CREATE INDEX "CartItem_productVariantId_idx" ON "CartItem"("productVariantId");

-- CreateIndex
CREATE INDEX "CartItem_offerId_idx" ON "CartItem"("offerId");

-- CreateIndex
CREATE INDEX "OrderBatch_venueId_idx" ON "OrderBatch"("venueId");

-- CreateIndex
CREATE INDEX "OrderBatch_createdByUserId_idx" ON "OrderBatch"("createdByUserId");

-- CreateIndex
CREATE INDEX "OrderBatch_cartId_idx" ON "OrderBatch"("cartId");

-- CreateIndex
CREATE INDEX "SupplierOrder_orderBatchId_idx" ON "SupplierOrder"("orderBatchId");

-- CreateIndex
CREATE INDEX "SupplierOrder_venueId_idx" ON "SupplierOrder"("venueId");

-- CreateIndex
CREATE INDEX "SupplierOrder_supplierId_idx" ON "SupplierOrder"("supplierId");

-- CreateIndex
CREATE INDEX "SupplierOrder_status_idx" ON "SupplierOrder"("status");

-- CreateIndex
CREATE INDEX "SupplierOrderItem_supplierOrderId_idx" ON "SupplierOrderItem"("supplierOrderId");

-- CreateIndex
CREATE INDEX "SupplierOrderItem_productId_idx" ON "SupplierOrderItem"("productId");

-- CreateIndex
CREATE INDEX "SupplierOrderItem_productVariantId_idx" ON "SupplierOrderItem"("productVariantId");

-- CreateIndex
CREATE INDEX "SupplierOrderItem_offerId_idx" ON "SupplierOrderItem"("offerId");

-- CreateIndex
CREATE INDEX "SupplierOrderStatusEvent_supplierOrderId_idx" ON "SupplierOrderStatusEvent"("supplierOrderId");

-- CreateIndex
CREATE INDEX "SupplierOrderStatusEvent_actorSupplierId_idx" ON "SupplierOrderStatusEvent"("actorSupplierId");

-- CreateIndex
CREATE INDEX "SupplierOrderStatusEvent_status_idx" ON "SupplierOrderStatusEvent"("status");

-- CreateIndex
CREATE INDEX "OrderDeliveryConfirmation_supplierOrderId_idx" ON "OrderDeliveryConfirmation"("supplierOrderId");

-- CreateIndex
CREATE INDEX "OrderDeliveryConfirmation_confirmedByUserId_idx" ON "OrderDeliveryConfirmation"("confirmedByUserId");

-- CreateIndex
CREATE INDEX "InventoryItem_venueId_idx" ON "InventoryItem"("venueId");

-- CreateIndex
CREATE INDEX "InventoryItem_productId_idx" ON "InventoryItem"("productId");

-- CreateIndex
CREATE INDEX "InventoryReservation_venueId_idx" ON "InventoryReservation"("venueId");

-- CreateIndex
CREATE INDEX "InventoryReservation_inventoryItemId_idx" ON "InventoryReservation"("inventoryItemId");

-- CreateIndex
CREATE INDEX "InventoryReservation_reservedByUserId_idx" ON "InventoryReservation"("reservedByUserId");

-- CreateIndex
CREATE INDEX "InventoryReservation_isActive_idx" ON "InventoryReservation"("isActive");

-- CreateIndex
CREATE INDEX "StockMovement_venueId_idx" ON "StockMovement"("venueId");

-- CreateIndex
CREATE INDEX "StockMovement_inventoryItemId_idx" ON "StockMovement"("inventoryItemId");

-- CreateIndex
CREATE INDEX "StockMovement_type_idx" ON "StockMovement"("type");

-- CreateIndex
CREATE INDEX "StockAlert_venueId_idx" ON "StockAlert"("venueId");

-- CreateIndex
CREATE INDEX "StockAlert_inventoryItemId_idx" ON "StockAlert"("inventoryItemId");

-- CreateIndex
CREATE INDEX "StockAlert_isActive_idx" ON "StockAlert"("isActive");

-- CreateIndex
CREATE INDEX "StopListItem_venueId_idx" ON "StopListItem"("venueId");

-- CreateIndex
CREATE INDEX "StopListItem_menuItemId_idx" ON "StopListItem"("menuItemId");

-- CreateIndex
CREATE INDEX "StopListItem_isActive_idx" ON "StopListItem"("isActive");

-- CreateIndex
CREATE INDEX "MenuCategory_venueId_idx" ON "MenuCategory"("venueId");

-- CreateIndex
CREATE INDEX "MenuItem_venueId_idx" ON "MenuItem"("venueId");

-- CreateIndex
CREATE INDEX "MenuItem_categoryId_idx" ON "MenuItem"("categoryId");

-- CreateIndex
CREATE INDEX "MenuItem_productId_idx" ON "MenuItem"("productId");

-- CreateIndex
CREATE INDEX "MenuItemTag_menuItemId_idx" ON "MenuItemTag"("menuItemId");

-- CreateIndex
CREATE INDEX "MenuItemTag_venueId_idx" ON "MenuItemTag"("venueId");

-- CreateIndex
CREATE INDEX "MenuItemTag_createdByUserId_idx" ON "MenuItemTag"("createdByUserId");

-- CreateIndex
CREATE INDEX "MenuItemAnalog_menuItemId_idx" ON "MenuItemAnalog"("menuItemId");

-- CreateIndex
CREATE INDEX "MenuItemAnalog_analogMenuItemId_idx" ON "MenuItemAnalog"("analogMenuItemId");

-- CreateIndex
CREATE INDEX "MenuItemAnalog_assignedByUserId_idx" ON "MenuItemAnalog"("assignedByUserId");

-- CreateIndex
CREATE INDEX "MenuItemPairingStat_venueId_idx" ON "MenuItemPairingStat"("venueId");

-- CreateIndex
CREATE INDEX "MenuItemPairingStat_menuItemId_idx" ON "MenuItemPairingStat"("menuItemId");

-- CreateIndex
CREATE INDEX "MenuItemPairingStat_pairedMenuItemId_idx" ON "MenuItemPairingStat"("pairedMenuItemId");

-- CreateIndex
CREATE UNIQUE INDEX "TechCard_menuItemId_key" ON "TechCard"("menuItemId");

-- CreateIndex
CREATE INDEX "TechCardIngredient_techCardId_idx" ON "TechCardIngredient"("techCardId");

-- CreateIndex
CREATE INDEX "TechCardIngredient_inventoryItemId_idx" ON "TechCardIngredient"("inventoryItemId");

-- CreateIndex
CREATE INDEX "InventorySession_venueId_idx" ON "InventorySession"("venueId");

-- CreateIndex
CREATE INDEX "InventorySession_createdByUserId_idx" ON "InventorySession"("createdByUserId");

-- CreateIndex
CREATE INDEX "InventorySession_status_idx" ON "InventorySession"("status");

-- CreateIndex
CREATE INDEX "InventorySessionItem_sessionId_idx" ON "InventorySessionItem"("sessionId");

-- CreateIndex
CREATE INDEX "InventorySessionItem_inventoryItemId_idx" ON "InventorySessionItem"("inventoryItemId");

-- CreateIndex
CREATE INDEX "InventorySessionItem_countedByUserId_idx" ON "InventorySessionItem"("countedByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "UnitConversionProfile_productId_key" ON "UnitConversionProfile"("productId");

-- CreateIndex
CREATE INDEX "SalesReportImport_venueId_idx" ON "SalesReportImport"("venueId");

-- CreateIndex
CREATE INDEX "SalesReportImport_uploadedByUserId_idx" ON "SalesReportImport"("uploadedByUserId");

-- CreateIndex
CREATE INDEX "SalesReportImport_status_idx" ON "SalesReportImport"("status");

-- CreateIndex
CREATE INDEX "SalesReportRow_importId_idx" ON "SalesReportRow"("importId");

-- CreateIndex
CREATE INDEX "SalesReportRow_venueId_idx" ON "SalesReportRow"("venueId");

-- CreateIndex
CREATE INDEX "SalesReportRow_mappedMenuItemId_idx" ON "SalesReportRow"("mappedMenuItemId");

-- CreateIndex
CREATE INDEX "SalesReportRow_mappingStatus_idx" ON "SalesReportRow"("mappingStatus");

-- CreateIndex
CREATE INDEX "VenueAnalyticsSnapshot_venueId_idx" ON "VenueAnalyticsSnapshot"("venueId");

-- CreateIndex
CREATE INDEX "VenueAnalyticsSnapshot_periodType_periodStart_periodEnd_idx" ON "VenueAnalyticsSnapshot"("periodType", "periodStart", "periodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "FileAsset_storageKey_key" ON "FileAsset"("storageKey");

-- CreateIndex
CREATE INDEX "FileAsset_uploadedByUserId_idx" ON "FileAsset"("uploadedByUserId");

-- CreateIndex
CREATE INDEX "FileAsset_uploadedBySupplierId_idx" ON "FileAsset"("uploadedBySupplierId");

-- CreateIndex
CREATE INDEX "AuditLog_actorUserId_idx" ON "AuditLog"("actorUserId");

-- CreateIndex
CREATE INDEX "AuditLog_actorSupplierId_idx" ON "AuditLog"("actorSupplierId");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- AddForeignKey
ALTER TABLE "UserProfile" ADD CONSTRAINT "UserProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserVenueMembership" ADD CONSTRAINT "UserVenueMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserVenueMembership" ADD CONSTRAINT "UserVenueMembership_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserVenueMembership" ADD CONSTRAINT "UserVenueMembership_confirmedByUserId_fkey" FOREIGN KEY ("confirmedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserNote" ADD CONSTRAINT "UserNote_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserNote" ADD CONSTRAINT "UserNote_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserNoteAccess" ADD CONSTRAINT "UserNoteAccess_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "UserNote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserNoteAccess" ADD CONSTRAINT "UserNoteAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserTask" ADD CONSTRAINT "UserTask_creatorUserId_fkey" FOREIGN KEY ("creatorUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserTask" ADD CONSTRAINT "UserTask_assigneeUserId_fkey" FOREIGN KEY ("assigneeUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserTask" ADD CONSTRAINT "UserTask_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationCode" ADD CONSTRAINT "VerificationCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Venue" ADD CONSTRAINT "Venue_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VenueCuisineType" ADD CONSTRAINT "VenueCuisineType_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VenueCuisineType" ADD CONSTRAINT "VenueCuisineType_cuisineTypeId_fkey" FOREIGN KEY ("cuisineTypeId") REFERENCES "CuisineType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierCategory" ADD CONSTRAINT "SupplierCategory_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierCategory" ADD CONSTRAINT "SupplierCategory_catalogCategoryId_fkey" FOREIGN KEY ("catalogCategoryId") REFERENCES "CatalogCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierSpecialCondition" ADD CONSTRAINT "SupplierSpecialCondition_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierSpecialCondition" ADD CONSTRAINT "SupplierSpecialCondition_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPriceImport" ADD CONSTRAINT "SupplierPriceImport_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPriceImportRow" ADD CONSTRAINT "SupplierPriceImportRow_importId_fkey" FOREIGN KEY ("importId") REFERENCES "SupplierPriceImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPriceImportRow" ADD CONSTRAINT "SupplierPriceImportRow_mappedProductId_fkey" FOREIGN KEY ("mappedProductId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPriceImportRow" ADD CONSTRAINT "SupplierPriceImportRow_mappedOfferId_fkey" FOREIGN KEY ("mappedOfferId") REFERENCES "Offer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogCategory" ADD CONSTRAINT "CatalogCategory_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "CatalogCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "CatalogCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierProduct" ADD CONSTRAINT "SupplierProduct_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierProduct" ADD CONSTRAINT "SupplierProduct_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierProduct" ADD CONSTRAINT "SupplierProduct_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_supplierProductId_fkey" FOREIGN KEY ("supplierProductId") REFERENCES "SupplierProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractSupplier" ADD CONSTRAINT "ContractSupplier_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractSupplier" ADD CONSTRAINT "ContractSupplier_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserFavoriteProduct" ADD CONSTRAINT "UserFavoriteProduct_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserFavoriteProduct" ADD CONSTRAINT "UserFavoriteProduct_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserFavoriteProduct" ADD CONSTRAINT "UserFavoriteProduct_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogCategoryBanner" ADD CONSTRAINT "CatalogCategoryBanner_catalogCategoryId_fkey" FOREIGN KEY ("catalogCategoryId") REFERENCES "CatalogCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogCategoryBanner" ADD CONSTRAINT "CatalogCategoryBanner_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogBanner" ADD CONSTRAINT "CatalogBanner_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogBanner" ADD CONSTRAINT "CatalogBanner_catalogCategoryId_fkey" FOREIGN KEY ("catalogCategoryId") REFERENCES "CatalogCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SponsoredProductPlacement" ADD CONSTRAINT "SponsoredProductPlacement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SponsoredProductPlacement" ADD CONSTRAINT "SponsoredProductPlacement_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SponsoredProductPlacement" ADD CONSTRAINT "SponsoredProductPlacement_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SponsoredProductPlacement" ADD CONSTRAINT "SponsoredProductPlacement_catalogCategoryId_fkey" FOREIGN KEY ("catalogCategoryId") REFERENCES "CatalogCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogSearchSuggestion" ADD CONSTRAINT "CatalogSearchSuggestion_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogSearchSuggestion" ADD CONSTRAINT "CatalogSearchSuggestion_catalogCategoryId_fkey" FOREIGN KEY ("catalogCategoryId") REFERENCES "CatalogCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogSearchSuggestion" ADD CONSTRAINT "CatalogSearchSuggestion_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cart" ADD CONSTRAINT "Cart_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cart" ADD CONSTRAINT "Cart_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "Cart"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderBatch" ADD CONSTRAINT "OrderBatch_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderBatch" ADD CONSTRAINT "OrderBatch_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderBatch" ADD CONSTRAINT "OrderBatch_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "Cart"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierOrder" ADD CONSTRAINT "SupplierOrder_orderBatchId_fkey" FOREIGN KEY ("orderBatchId") REFERENCES "OrderBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierOrder" ADD CONSTRAINT "SupplierOrder_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierOrder" ADD CONSTRAINT "SupplierOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierOrderItem" ADD CONSTRAINT "SupplierOrderItem_supplierOrderId_fkey" FOREIGN KEY ("supplierOrderId") REFERENCES "SupplierOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierOrderItem" ADD CONSTRAINT "SupplierOrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierOrderItem" ADD CONSTRAINT "SupplierOrderItem_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierOrderItem" ADD CONSTRAINT "SupplierOrderItem_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierOrderStatusEvent" ADD CONSTRAINT "SupplierOrderStatusEvent_supplierOrderId_fkey" FOREIGN KEY ("supplierOrderId") REFERENCES "SupplierOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierOrderStatusEvent" ADD CONSTRAINT "SupplierOrderStatusEvent_actorSupplierId_fkey" FOREIGN KEY ("actorSupplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderDeliveryConfirmation" ADD CONSTRAINT "OrderDeliveryConfirmation_supplierOrderId_fkey" FOREIGN KEY ("supplierOrderId") REFERENCES "SupplierOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderDeliveryConfirmation" ADD CONSTRAINT "OrderDeliveryConfirmation_confirmedByUserId_fkey" FOREIGN KEY ("confirmedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryReservation" ADD CONSTRAINT "InventoryReservation_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryReservation" ADD CONSTRAINT "InventoryReservation_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryReservation" ADD CONSTRAINT "InventoryReservation_reservedByUserId_fkey" FOREIGN KEY ("reservedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAlert" ADD CONSTRAINT "StockAlert_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAlert" ADD CONSTRAINT "StockAlert_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StopListItem" ADD CONSTRAINT "StopListItem_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StopListItem" ADD CONSTRAINT "StopListItem_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuCategory" ADD CONSTRAINT "MenuCategory_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuItem" ADD CONSTRAINT "MenuItem_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuItem" ADD CONSTRAINT "MenuItem_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "MenuCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuItem" ADD CONSTRAINT "MenuItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuItemTag" ADD CONSTRAINT "MenuItemTag_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuItemTag" ADD CONSTRAINT "MenuItemTag_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuItemTag" ADD CONSTRAINT "MenuItemTag_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuItemAnalog" ADD CONSTRAINT "MenuItemAnalog_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuItemAnalog" ADD CONSTRAINT "MenuItemAnalog_analogMenuItemId_fkey" FOREIGN KEY ("analogMenuItemId") REFERENCES "MenuItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuItemAnalog" ADD CONSTRAINT "MenuItemAnalog_assignedByUserId_fkey" FOREIGN KEY ("assignedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuItemPairingStat" ADD CONSTRAINT "MenuItemPairingStat_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuItemPairingStat" ADD CONSTRAINT "MenuItemPairingStat_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuItemPairingStat" ADD CONSTRAINT "MenuItemPairingStat_pairedMenuItemId_fkey" FOREIGN KEY ("pairedMenuItemId") REFERENCES "MenuItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechCard" ADD CONSTRAINT "TechCard_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechCardIngredient" ADD CONSTRAINT "TechCardIngredient_techCardId_fkey" FOREIGN KEY ("techCardId") REFERENCES "TechCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechCardIngredient" ADD CONSTRAINT "TechCardIngredient_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventorySession" ADD CONSTRAINT "InventorySession_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventorySession" ADD CONSTRAINT "InventorySession_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventorySessionItem" ADD CONSTRAINT "InventorySessionItem_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "InventorySession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventorySessionItem" ADD CONSTRAINT "InventorySessionItem_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventorySessionItem" ADD CONSTRAINT "InventorySessionItem_countedByUserId_fkey" FOREIGN KEY ("countedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitConversionProfile" ADD CONSTRAINT "UnitConversionProfile_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesReportImport" ADD CONSTRAINT "SalesReportImport_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesReportImport" ADD CONSTRAINT "SalesReportImport_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesReportRow" ADD CONSTRAINT "SalesReportRow_importId_fkey" FOREIGN KEY ("importId") REFERENCES "SalesReportImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesReportRow" ADD CONSTRAINT "SalesReportRow_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesReportRow" ADD CONSTRAINT "SalesReportRow_mappedMenuItemId_fkey" FOREIGN KEY ("mappedMenuItemId") REFERENCES "MenuItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VenueAnalyticsSnapshot" ADD CONSTRAINT "VenueAnalyticsSnapshot_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileAsset" ADD CONSTRAINT "FileAsset_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileAsset" ADD CONSTRAINT "FileAsset_uploadedBySupplierId_fkey" FOREIGN KEY ("uploadedBySupplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorSupplierId_fkey" FOREIGN KEY ("actorSupplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
