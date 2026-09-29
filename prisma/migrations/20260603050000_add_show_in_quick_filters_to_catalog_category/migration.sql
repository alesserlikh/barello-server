ALTER TABLE "CatalogCategory"
ADD COLUMN "showInQuickFilters" BOOLEAN NOT NULL DEFAULT false;

UPDATE "CatalogCategory"
SET "showInQuickFilters" = false;
