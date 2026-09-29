ALTER TABLE "UserVenueMembership" ADD COLUMN "publicId" varchar(8);

DO $$
DECLARE
  row_id uuid;
  candidate varchar(8);
BEGIN
  FOR row_id IN SELECT "id" FROM "UserVenueMembership" WHERE "publicId" IS NULL LOOP
    LOOP
      candidate := generate_public_id('4'::text);
      EXIT WHEN NOT EXISTS (SELECT 1 FROM "UserVenueMembership" WHERE "publicId" = candidate);
    END LOOP;

    UPDATE "UserVenueMembership" SET "publicId" = candidate WHERE "id" = row_id;
  END LOOP;
END;
$$;

ALTER TABLE "UserVenueMembership" ALTER COLUMN "publicId" SET NOT NULL;
ALTER TABLE "UserVenueMembership" ALTER COLUMN "publicId" SET DEFAULT generate_public_id('4'::text);

CREATE UNIQUE INDEX "UserVenueMembership_publicId_key" ON "UserVenueMembership"("publicId");
