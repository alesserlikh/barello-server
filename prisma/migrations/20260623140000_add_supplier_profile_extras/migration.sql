CREATE TYPE "SupplierPlanStatus" AS ENUM ('ACTIVE', 'TRIAL', 'PAST_DUE', 'CANCELLED');

ALTER TABLE "Supplier"
ADD COLUMN "planName" TEXT,
ADD COLUMN "planStatus" "SupplierPlanStatus",
ADD COLUMN "promoBalance" DECIMAL(12,2);
