ALTER TABLE "CatalogCategory"
ADD COLUMN "code" TEXT;

UPDATE "CatalogCategory"
SET "code" = 'catalog-category-' || SUBSTRING("id"::text, 1, 8)
WHERE "code" IS NULL;

CREATE UNIQUE INDEX "CatalogCategory_code_key"
ON "CatalogCategory"("code");
