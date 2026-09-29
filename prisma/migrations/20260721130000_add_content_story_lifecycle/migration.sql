ALTER TABLE "ContentStory"
  ADD COLUMN IF NOT EXISTS "publishedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "ContentStory_isActive_expiresAt_sortOrder_idx"
  ON "ContentStory"("isActive", "expiresAt", "sortOrder");

UPDATE "ContentStory"
SET
  "publishedAt" = COALESCE("publishedAt", CURRENT_TIMESTAMP),
  "expiresAt" = COALESCE("expiresAt", CURRENT_TIMESTAMP + INTERVAL '24 hours')
WHERE "isActive" = true
  AND ("publishedAt" IS NULL OR "expiresAt" IS NULL);
