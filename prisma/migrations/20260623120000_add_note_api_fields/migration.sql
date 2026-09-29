CREATE TYPE "NoteScope" AS ENUM ('PRIVATE', 'VENUE', 'BARELLO_TEAM');

ALTER TABLE "UserNote"
ADD COLUMN "scope" "NoteScope" NOT NULL DEFAULT 'PRIVATE';

UPDATE "UserNote"
SET "scope" = 'VENUE'
WHERE "venueId" IS NOT NULL;

ALTER TABLE "UserNoteAccess"
ADD COLUMN "readAt" TIMESTAMP(3);

CREATE INDEX "UserNote_scope_createdAt_idx"
ON "UserNote"("scope", "createdAt");