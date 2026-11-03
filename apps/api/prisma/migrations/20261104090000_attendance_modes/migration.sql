-- CreateEnum
CREATE TYPE "AttendanceBreakKind" AS ENUM ('BREAK', 'AWAY');

-- AlterTable
ALTER TABLE "AttendanceBreak" ADD COLUMN "kind" "AttendanceBreakKind" NOT NULL DEFAULT 'BREAK';

-- AlterTable
ALTER TABLE "AttendanceRecord" ADD COLUMN "autoCheckedIn" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "autoCheckOutReason" TEXT,
ADD COLUMN "lastActiveAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "AttendanceRecord_organizationId_checkOutAt_idx" ON "AttendanceRecord"("organizationId", "checkOutAt");
