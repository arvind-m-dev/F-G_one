-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('INTERNAL', 'CLIENT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "UserStatus" ADD VALUE 'SUSPENDED';
ALTER TYPE "UserStatus" ADD VALUE 'ARCHIVED';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "accountType" "AccountType" NOT NULL DEFAULT 'INTERNAL',
ADD COLUMN     "isSuperAdmin" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "SuperAdminInvitation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "invitedById" TEXT,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SuperAdminInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SuperAdminInvitation_tokenHash_key" ON "SuperAdminInvitation"("tokenHash");

-- CreateIndex
CREATE INDEX "SuperAdminInvitation_organizationId_idx" ON "SuperAdminInvitation"("organizationId");

-- CreateIndex
CREATE INDEX "SuperAdminInvitation_userId_idx" ON "SuperAdminInvitation"("userId");

-- AddForeignKey
ALTER TABLE "SuperAdminInvitation" ADD CONSTRAINT "SuperAdminInvitation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuperAdminInvitation" ADD CONSTRAINT "SuperAdminInvitation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuperAdminInvitation" ADD CONSTRAINT "SuperAdminInvitation_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Data: Super Admin becomes an authority flag, not a role.
-- 1. Everyone holding the old `super_admin` role gets the flag.
UPDATE "User" u SET "isSuperAdmin" = true
FROM "Role" r WHERE u."roleId" = r."id" AND r."key" = 'super_admin';

-- 2. The role itself becomes the ordinary, assignable "Administrator" role (grants unchanged).
UPDATE "Role" SET "key" = 'administrator', "name" = 'Administrator',
  "description" = 'Runs company administration. Super Admin authority is separate.', "rank" = 90
WHERE "key" = 'super_admin'
  AND NOT EXISTS (SELECT 1 FROM "Role" r2 WHERE r2."organizationId" = "Role"."organizationId" AND r2."key" = 'administrator');
