ALTER TABLE "CatalogCategory"
ADD COLUMN "path" TEXT NOT NULL DEFAULT '',
ADD COLUMN "depth" INTEGER NOT NULL DEFAULT 1;

WITH RECURSIVE category_tree AS (
  SELECT
    "id",
    "parentId",
    ('/' || "id"::text || '/') AS "path",
    1 AS "depth"
  FROM "CatalogCategory"
  WHERE "parentId" IS NULL

  UNION ALL

  SELECT
    child."id",
    child."parentId",
    (category_tree."path" || child."id"::text || '/') AS "path",
    category_tree."depth" + 1 AS "depth"
  FROM "CatalogCategory" child
  JOIN category_tree ON child."parentId" = category_tree."id"
)
UPDATE "CatalogCategory" category
SET
  "path" = category_tree."path",
  "depth" = category_tree."depth"
FROM category_tree
WHERE category."id" = category_tree."id";

UPDATE "CatalogCategory"
SET "path" = ('/' || "id"::text || '/'), "depth" = 1
WHERE "path" = '';

CREATE INDEX "CatalogCategory_path_idx" ON "CatalogCategory"("path");
CREATE INDEX "CatalogCategory_depth_idx" ON "CatalogCategory"("depth");
