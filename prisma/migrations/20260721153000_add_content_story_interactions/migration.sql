CREATE TABLE IF NOT EXISTS "ContentStoryView" (
  "id" UUID NOT NULL,
  "storyId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ContentStoryView_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ContentStoryReaction" (
  "id" UUID NOT NULL,
  "storyId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "reaction" VARCHAR(24) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ContentStoryReaction_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ContentStoryReply" (
  "id" UUID NOT NULL,
  "storyId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "message" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ContentStoryReply_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ContentStoryView"
  ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

ALTER TABLE "ContentStoryReaction"
  ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

ALTER TABLE "ContentStoryReply"
  ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX IF NOT EXISTS "ContentStoryView_storyId_userId_key"
  ON "ContentStoryView"("storyId", "userId");

CREATE INDEX IF NOT EXISTS "ContentStoryView_userId_createdAt_idx"
  ON "ContentStoryView"("userId", "createdAt");

CREATE INDEX IF NOT EXISTS "ContentStoryReaction_storyId_createdAt_idx"
  ON "ContentStoryReaction"("storyId", "createdAt");

CREATE INDEX IF NOT EXISTS "ContentStoryReaction_userId_createdAt_idx"
  ON "ContentStoryReaction"("userId", "createdAt");

CREATE INDEX IF NOT EXISTS "ContentStoryReply_storyId_createdAt_idx"
  ON "ContentStoryReply"("storyId", "createdAt");

CREATE INDEX IF NOT EXISTS "ContentStoryReply_userId_createdAt_idx"
  ON "ContentStoryReply"("userId", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ContentStoryView_storyId_fkey'
  ) THEN
    ALTER TABLE "ContentStoryView"
      ADD CONSTRAINT "ContentStoryView_storyId_fkey"
      FOREIGN KEY ("storyId") REFERENCES "ContentStory"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ContentStoryView_userId_fkey'
  ) THEN
    ALTER TABLE "ContentStoryView"
      ADD CONSTRAINT "ContentStoryView_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ContentStoryReaction_storyId_fkey'
  ) THEN
    ALTER TABLE "ContentStoryReaction"
      ADD CONSTRAINT "ContentStoryReaction_storyId_fkey"
      FOREIGN KEY ("storyId") REFERENCES "ContentStory"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ContentStoryReaction_userId_fkey'
  ) THEN
    ALTER TABLE "ContentStoryReaction"
      ADD CONSTRAINT "ContentStoryReaction_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ContentStoryReply_storyId_fkey'
  ) THEN
    ALTER TABLE "ContentStoryReply"
      ADD CONSTRAINT "ContentStoryReply_storyId_fkey"
      FOREIGN KEY ("storyId") REFERENCES "ContentStory"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ContentStoryReply_userId_fkey'
  ) THEN
    ALTER TABLE "ContentStoryReply"
      ADD CONSTRAINT "ContentStoryReply_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
