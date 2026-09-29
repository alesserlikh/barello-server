-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('VENUE_STAFF', 'SUPPLIER_STAFF', 'UNIDENTIFIED');

-- CreateEnum
CREATE TYPE "RegistrationFlowType" AS ENUM ('DIRECT', 'INVITE_TOKEN');

-- CreateEnum
CREATE TYPE "RegistrationDraftStatus" AS ENUM ('IN_PROGRESS', 'READY_TO_CONFIRM', 'COMPLETED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "VenueOwnerStatus" AS ENUM ('OWNER_CONFIRMED', 'OWNER_MISSING');

-- CreateEnum
CREATE TYPE "StaffInvitationStatus" AS ENUM ('CREATED', 'SENT', 'ACCEPTED', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "CompanyType" AS ENUM ('VENUE', 'SUPPLIER');

-- CreateEnum
CREATE TYPE "CompanyModerationRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CompanyModerationRequestSource" AS ENUM ('REGISTRATION_NOT_FOUND');

-- AlterEnum
BEGIN;
CREATE TYPE "DisplayRole_new" AS ENUM ('OWNER', 'ADMINISTRATOR', 'BAR_MANAGER', 'SENIOR_BARTENDER', 'SOMMELIER', 'BARTENDER', 'WAITER');
ALTER TABLE "UserVenueMembership" ALTER COLUMN "displayRole" TYPE "DisplayRole_new" USING ("displayRole"::text::"DisplayRole_new");
ALTER TYPE "DisplayRole" RENAME TO "DisplayRole_old";
ALTER TYPE "DisplayRole_new" RENAME TO "DisplayRole";
DROP TYPE "public"."DisplayRole_old";
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "MembershipStatus_new" AS ENUM ('PENDING', 'ACTIVE', 'REJECTED', 'REVOKED');
ALTER TABLE "UserVenueMembership" ALTER COLUMN "membershipStatus" TYPE "MembershipStatus_new" USING ("membershipStatus"::text::"MembershipStatus_new");
ALTER TYPE "MembershipStatus" RENAME TO "MembershipStatus_old";
ALTER TYPE "MembershipStatus_new" RENAME TO "MembershipStatus";
DROP TYPE "public"."MembershipStatus_old";
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "UserStatus_new" AS ENUM ('UNIDENTIFIED', 'ACTIVE', 'BLOCKED');
ALTER TABLE "User" ALTER COLUMN "status" TYPE "UserStatus_new" USING ("status"::text::"UserStatus_new");
ALTER TYPE "UserStatus" RENAME TO "UserStatus_old";
ALTER TYPE "UserStatus_new" RENAME TO "UserStatus";
DROP TYPE "public"."UserStatus_old";
COMMIT;

-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN     "businessId" UUID;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "accountType" "AccountType" NOT NULL DEFAULT 'UNIDENTIFIED';

-- AlterTable
ALTER TABLE "Venue" ADD COLUMN     "ownerStatus" "VenueOwnerStatus";

-- CreateTable
CREATE TABLE "RegistrationDraft" (
    "id" UUID NOT NULL,
    "flowType" "RegistrationFlowType" NOT NULL,
    "status" "RegistrationDraftStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "userId" UUID,
    "fullName" TEXT,
    "phone" TEXT,
    "phoneOtpVerified" BOOLEAN NOT NULL DEFAULT false,
    "selectedAccountType" "AccountType",
    "venueRole" "DisplayRole",
    "supplierRole" TEXT,
    "supplierAccessLevel" "AccessLevel",
    "venueAccessLevel" "AccessLevel",
    "inn" TEXT,
    "companyExistsInBarello" BOOLEAN,
    "existingCompanyType" "CompanyType",
    "existingCompanyId" UUID,
    "externalCompanyConfirmed" BOOLEAN,
    "externalCompanyData" JSONB,
    "manualCompanyName" TEXT,
    "manualCompanyAddress" TEXT,
    "inviteToken" TEXT,
    "staffInvitationId" UUID,
    "venueId" UUID,
    "businessId" UUID,
    "invitedRole" "DisplayRole",
    "invitedAccessLevel" "AccessLevel",
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RegistrationDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffInvitation" (
    "id" UUID NOT NULL,
    "venueId" UUID NOT NULL,
    "inviterUserId" UUID NOT NULL,
    "invitedRole" "DisplayRole" NOT NULL,
    "invitedAccessLevel" "AccessLevel" NOT NULL,
    "status" "StaffInvitationStatus" NOT NULL DEFAULT 'CREATED',
    "currentTokenHash" TEXT NOT NULL,
    "inviteUrl" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedByUserId" UUID,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyModerationRequest" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "draftId" UUID NOT NULL,
    "businessId" UUID,
    "requestedCompanyType" "CompanyType" NOT NULL,
    "requestedVenueRole" "DisplayRole",
    "requestedAccessLevel" "AccessLevel",
    "inn" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "companyAddress" TEXT,
    "source" "CompanyModerationRequestSource" NOT NULL,
    "status" "CompanyModerationRequestStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyModerationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierMembership" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "supplierId" UUID NOT NULL,
    "displayRole" TEXT NOT NULL,
    "accessLevel" "AccessLevel" NOT NULL,
    "status" "MembershipStatus" NOT NULL,
    "joinedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierMembership_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RegistrationDraft_userId_idx" ON "RegistrationDraft"("userId");

-- CreateIndex
CREATE INDEX "RegistrationDraft_staffInvitationId_idx" ON "RegistrationDraft"("staffInvitationId");

-- CreateIndex
CREATE INDEX "RegistrationDraft_venueId_idx" ON "RegistrationDraft"("venueId");

-- CreateIndex
CREATE INDEX "RegistrationDraft_businessId_idx" ON "RegistrationDraft"("businessId");

-- CreateIndex
CREATE INDEX "RegistrationDraft_phone_idx" ON "RegistrationDraft"("phone");

-- CreateIndex
CREATE INDEX "RegistrationDraft_status_idx" ON "RegistrationDraft"("status");

-- CreateIndex
CREATE INDEX "RegistrationDraft_flowType_idx" ON "RegistrationDraft"("flowType");

-- CreateIndex
CREATE INDEX "RegistrationDraft_expiresAt_idx" ON "RegistrationDraft"("expiresAt");

-- CreateIndex
CREATE INDEX "StaffInvitation_venueId_idx" ON "StaffInvitation"("venueId");

-- CreateIndex
CREATE INDEX "StaffInvitation_inviterUserId_idx" ON "StaffInvitation"("inviterUserId");

-- CreateIndex
CREATE INDEX "StaffInvitation_acceptedByUserId_idx" ON "StaffInvitation"("acceptedByUserId");

-- CreateIndex
CREATE INDEX "StaffInvitation_status_idx" ON "StaffInvitation"("status");

-- CreateIndex
CREATE INDEX "StaffInvitation_expiresAt_idx" ON "StaffInvitation"("expiresAt");

-- CreateIndex
CREATE INDEX "CompanyModerationRequest_userId_idx" ON "CompanyModerationRequest"("userId");

-- CreateIndex
CREATE INDEX "CompanyModerationRequest_draftId_idx" ON "CompanyModerationRequest"("draftId");

-- CreateIndex
CREATE INDEX "CompanyModerationRequest_businessId_idx" ON "CompanyModerationRequest"("businessId");

-- CreateIndex
CREATE INDEX "CompanyModerationRequest_requestedCompanyType_idx" ON "CompanyModerationRequest"("requestedCompanyType");

-- CreateIndex
CREATE INDEX "CompanyModerationRequest_status_idx" ON "CompanyModerationRequest"("status");

-- CreateIndex
CREATE INDEX "SupplierMembership_supplierId_idx" ON "SupplierMembership"("supplierId");

-- CreateIndex
CREATE INDEX "SupplierMembership_status_idx" ON "SupplierMembership"("status");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierMembership_userId_supplierId_key" ON "SupplierMembership"("userId", "supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_businessId_key" ON "Supplier"("businessId");

-- CreateIndex
CREATE INDEX "Supplier_businessId_idx" ON "Supplier"("businessId");

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegistrationDraft" ADD CONSTRAINT "RegistrationDraft_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegistrationDraft" ADD CONSTRAINT "RegistrationDraft_staffInvitationId_fkey" FOREIGN KEY ("staffInvitationId") REFERENCES "StaffInvitation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegistrationDraft" ADD CONSTRAINT "RegistrationDraft_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegistrationDraft" ADD CONSTRAINT "RegistrationDraft_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffInvitation" ADD CONSTRAINT "StaffInvitation_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffInvitation" ADD CONSTRAINT "StaffInvitation_inviterUserId_fkey" FOREIGN KEY ("inviterUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffInvitation" ADD CONSTRAINT "StaffInvitation_acceptedByUserId_fkey" FOREIGN KEY ("acceptedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyModerationRequest" ADD CONSTRAINT "CompanyModerationRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyModerationRequest" ADD CONSTRAINT "CompanyModerationRequest_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "RegistrationDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyModerationRequest" ADD CONSTRAINT "CompanyModerationRequest_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierMembership" ADD CONSTRAINT "SupplierMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierMembership" ADD CONSTRAINT "SupplierMembership_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

