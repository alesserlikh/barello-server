-- Keep authentication lookups stable after switching to compact E.164 storage.
UPDATE "User"
SET "phone" = CASE
  WHEN regexp_replace("phone", '[^0-9]', '', 'g') ~ '^8[0-9]{10}$'
    THEN '+7' || substring(regexp_replace("phone", '[^0-9]', '', 'g') FROM 2)
  ELSE '+' || regexp_replace("phone", '[^0-9]', '', 'g')
END
WHERE "phone" IS NOT NULL;

UPDATE "RegistrationDraft"
SET "phone" = CASE
  WHEN regexp_replace("phone", '[^0-9]', '', 'g') ~ '^8[0-9]{10}$'
    THEN '+7' || substring(regexp_replace("phone", '[^0-9]', '', 'g') FROM 2)
  ELSE '+' || regexp_replace("phone", '[^0-9]', '', 'g')
END
WHERE "phone" IS NOT NULL;

UPDATE "VerificationCode"
SET "target" = CASE
  WHEN regexp_replace("target", '[^0-9]', '', 'g') ~ '^8[0-9]{10}$'
    THEN '+7' || substring(regexp_replace("target", '[^0-9]', '', 'g') FROM 2)
  ELSE '+' || regexp_replace("target", '[^0-9]', '', 'g')
END
WHERE regexp_replace("target", '[^0-9]', '', 'g') ~ '^(7[0-9]{10}|8[0-9]{10}|375[0-9]{9}|374[0-9]{8}|995[0-9]{9})$';

UPDATE "Supplier"
SET "phone" = CASE
  WHEN regexp_replace("phone", '[^0-9]', '', 'g') ~ '^8[0-9]{10}$'
    THEN '+7' || substring(regexp_replace("phone", '[^0-9]', '', 'g') FROM 2)
  ELSE '+' || regexp_replace("phone", '[^0-9]', '', 'g')
END
WHERE "phone" IS NOT NULL
  AND regexp_replace("phone", '[^0-9]', '', 'g') ~ '^(7[0-9]{10}|8[0-9]{10}|375[0-9]{9}|374[0-9]{8}|995[0-9]{9})$';
