-- CreateEnum
CREATE TYPE "MeasureKind" AS ENUM ('VOLUME', 'WEIGHT', 'COUNT');

-- AlterTable
ALTER TABLE "ProductVariant"
  ADD COLUMN "measureKind" "MeasureKind" NOT NULL DEFAULT 'VOLUME',
  ADD COLUMN "weightG" INTEGER,
  ADD COLUMN "unitCount" INTEGER,
  ADD COLUMN "rawValue" DECIMAL(12, 3),
  ADD COLUMN "rawUnit" TEXT,
  ADD COLUMN "setSize" INTEGER;
