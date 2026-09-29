ALTER TYPE "VerificationCodeType" ADD VALUE IF NOT EXISTS 'EMAIL_VERIFY';

ALTER TABLE "User"
ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);

UPDATE "User"
SET "emailVerifiedAt" = NOW()
WHERE "email" IS NOT NULL
  AND "emailVerifiedAt" IS NULL;
