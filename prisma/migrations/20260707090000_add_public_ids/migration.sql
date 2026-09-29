CREATE OR REPLACE FUNCTION generate_public_id(entity_prefix text)
RETURNS varchar(8)
LANGUAGE plpgsql
AS $$
DECLARE
  alphabet constant text := '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  value text := entity_prefix;
  i integer := 0;
BEGIN
  IF entity_prefix !~ '^[0-9]$' THEN
    RAISE EXCEPTION 'entity_prefix must be a single digit';
  END IF;

  WHILE i < 7 LOOP
    value := value || substr(alphabet, floor(random() * length(alphabet))::integer + 1, 1);
    i := i + 1;
  END LOOP;

  RETURN value::varchar(8);
END;
$$;

ALTER TABLE "Product" ADD COLUMN "publicId" varchar(8);
ALTER TABLE "User" ADD COLUMN "publicId" varchar(8);
ALTER TABLE "Supplier" ADD COLUMN "publicId" varchar(8);
ALTER TABLE "Venue" ADD COLUMN "publicId" varchar(8);

DO $$
DECLARE
  row_id uuid;
  candidate varchar(8);
BEGIN
  FOR row_id IN SELECT "id" FROM "Product" WHERE "publicId" IS NULL LOOP
    LOOP
      candidate := generate_public_id('0'::text);
      EXIT WHEN NOT EXISTS (SELECT 1 FROM "Product" WHERE "publicId" = candidate);
    END LOOP;

    UPDATE "Product" SET "publicId" = candidate WHERE "id" = row_id;
  END LOOP;
END;
$$;

DO $$
DECLARE
  row_id uuid;
  candidate varchar(8);
BEGIN
  FOR row_id IN SELECT "id" FROM "User" WHERE "publicId" IS NULL LOOP
    LOOP
      candidate := generate_public_id('1'::text);
      EXIT WHEN NOT EXISTS (SELECT 1 FROM "User" WHERE "publicId" = candidate);
    END LOOP;

    UPDATE "User" SET "publicId" = candidate WHERE "id" = row_id;
  END LOOP;
END;
$$;

DO $$
DECLARE
  row_id uuid;
  candidate varchar(8);
BEGIN
  FOR row_id IN SELECT "id" FROM "Supplier" WHERE "publicId" IS NULL LOOP
    LOOP
      candidate := generate_public_id('2'::text);
      EXIT WHEN NOT EXISTS (SELECT 1 FROM "Supplier" WHERE "publicId" = candidate);
    END LOOP;

    UPDATE "Supplier" SET "publicId" = candidate WHERE "id" = row_id;
  END LOOP;
END;
$$;

DO $$
DECLARE
  row_id uuid;
  candidate varchar(8);
BEGIN
  FOR row_id IN SELECT "id" FROM "Venue" WHERE "publicId" IS NULL LOOP
    LOOP
      candidate := generate_public_id('3'::text);
      EXIT WHEN NOT EXISTS (SELECT 1 FROM "Venue" WHERE "publicId" = candidate);
    END LOOP;

    UPDATE "Venue" SET "publicId" = candidate WHERE "id" = row_id;
  END LOOP;
END;
$$;

ALTER TABLE "Product" ALTER COLUMN "publicId" SET NOT NULL;
ALTER TABLE "User" ALTER COLUMN "publicId" SET NOT NULL;
ALTER TABLE "Supplier" ALTER COLUMN "publicId" SET NOT NULL;
ALTER TABLE "Venue" ALTER COLUMN "publicId" SET NOT NULL;

ALTER TABLE "Product" ALTER COLUMN "publicId" SET DEFAULT generate_public_id('0'::text);
ALTER TABLE "User" ALTER COLUMN "publicId" SET DEFAULT generate_public_id('1'::text);
ALTER TABLE "Supplier" ALTER COLUMN "publicId" SET DEFAULT generate_public_id('2'::text);
ALTER TABLE "Venue" ALTER COLUMN "publicId" SET DEFAULT generate_public_id('3'::text);

CREATE UNIQUE INDEX "Product_publicId_key" ON "Product"("publicId");
CREATE UNIQUE INDEX "User_publicId_key" ON "User"("publicId");
CREATE UNIQUE INDEX "Supplier_publicId_key" ON "Supplier"("publicId");
CREATE UNIQUE INDEX "Venue_publicId_key" ON "Venue"("publicId");
