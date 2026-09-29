-- CreateEnum
CREATE TYPE "UserAdminGroup" AS ENUM ('UNCLASSIFIED', 'REAL', 'TEST', 'INTERNAL_TEST');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "adminGroup" "UserAdminGroup" NOT NULL DEFAULT 'UNCLASSIFIED';
