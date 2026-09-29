DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ContentAuthorType') THEN
    CREATE TYPE "ContentAuthorType" AS ENUM ('ADMIN', 'SUPPLIER');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ContentBannerLabel') THEN
    CREATE TYPE "ContentBannerLabel" AS ENUM ('NEW');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "ContentStory" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "authorType" "ContentAuthorType" NOT NULL,
    "adminAuthorName" TEXT,
    "supplierId" UUID,
    "fileAssetId" UUID NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentStory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "HomeBannerContent" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "title" VARCHAR(20) NOT NULL,
    "label" "ContentBannerLabel" NOT NULL DEFAULT 'NEW',
    "bodyText" TEXT NOT NULL,
    "lead" TEXT NOT NULL,
    "cta" TEXT NOT NULL,
    "fileAssetId" UUID NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HomeBannerContent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ContentStory_authorType_isActive_sortOrder_idx" ON "ContentStory"("authorType", "isActive", "sortOrder");
CREATE INDEX IF NOT EXISTS "ContentStory_supplierId_idx" ON "ContentStory"("supplierId");
CREATE INDEX IF NOT EXISTS "ContentStory_fileAssetId_idx" ON "ContentStory"("fileAssetId");
CREATE INDEX IF NOT EXISTS "HomeBannerContent_isActive_sortOrder_idx" ON "HomeBannerContent"("isActive", "sortOrder");
CREATE INDEX IF NOT EXISTS "HomeBannerContent_fileAssetId_idx" ON "HomeBannerContent"("fileAssetId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ContentStory_supplierId_fkey') THEN
    ALTER TABLE "ContentStory"
      ADD CONSTRAINT "ContentStory_supplierId_fkey"
      FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ContentStory_fileAssetId_fkey') THEN
    ALTER TABLE "ContentStory"
      ADD CONSTRAINT "ContentStory_fileAssetId_fkey"
      FOREIGN KEY ("fileAssetId") REFERENCES "FileAsset"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'HomeBannerContent_fileAssetId_fkey') THEN
    ALTER TABLE "HomeBannerContent"
      ADD CONSTRAINT "HomeBannerContent_fileAssetId_fkey"
      FOREIGN KEY ("fileAssetId") REFERENCES "FileAsset"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
