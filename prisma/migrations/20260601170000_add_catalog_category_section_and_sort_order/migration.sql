CREATE TYPE "CatalogCategorySection" AS ENUM ('ALCOHOL', 'DRINKS_FOOD', 'NONFOOD');

ALTER TABLE "CatalogCategory"
ADD COLUMN "section" "CatalogCategorySection" NOT NULL DEFAULT 'NONFOOD',
ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "CatalogCategory_parentId_sortOrder_idx"
ON "CatalogCategory"("parentId", "sortOrder");
