-- CreateEnum
CREATE TYPE "PermissionScope" AS ENUM ('CLIENT', 'OWN', 'ASSIGNED', 'PROJECT', 'TEAM', 'DEPARTMENT', 'ORG');

-- CreateEnum
CREATE TYPE "OverrideEffect" AS ENUM ('ALLOW', 'DENY');

-- AlterTable
ALTER TABLE "Role" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "color" TEXT,
ADD COLUMN     "icon" TEXT,
ADD COLUMN     "templateKey" TEXT;

-- CreateTable
CREATE TABLE "RoleGrant" (
    "id" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "permission" TEXT NOT NULL,
    "scope" "PermissionScope" NOT NULL,

    CONSTRAINT "RoleGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserRole" (
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "assignedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("userId","roleId")
);

-- CreateTable
CREATE TABLE "UserPermissionOverride" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "permission" TEXT NOT NULL,
    "effect" "OverrideEffect" NOT NULL,
    "scope" "PermissionScope",
    "reason" TEXT,
    "grantedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserPermissionOverride_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RoleGrant_roleId_permission_key" ON "RoleGrant"("roleId", "permission");

-- CreateIndex
CREATE INDEX "UserRole_roleId_idx" ON "UserRole"("roleId");

-- CreateIndex
CREATE INDEX "UserPermissionOverride_organizationId_idx" ON "UserPermissionOverride"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "UserPermissionOverride_userId_permission_key" ON "UserPermissionOverride"("userId", "permission");

-- AddForeignKey
ALTER TABLE "RoleGrant" ADD CONSTRAINT "RoleGrant_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPermissionOverride" ADD CONSTRAINT "UserPermissionOverride_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPermissionOverride" ADD CONSTRAINT "UserPermissionOverride_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: legacy Role.permissions -> RoleGrant (widest scope per permission).
-- Mapping generated from LEGACY_PERMISSION_MAP in @fg/shared/authz.ts.
WITH map(legacy, permission, scope) AS (VALUES
  ('employees.read', 'employees.view', 'ORG'),
  ('employees.manage', 'employees.create', 'ORG'),
  ('employees.manage', 'employees.edit', 'ORG'),
  ('employees.manage', 'employees.deactivate', 'ORG'),
  ('departments.manage', 'departments.manage', 'ORG'),
  ('roles.manage', 'roles.manage', 'ORG'),
  ('settings.manage', 'settings.configure', 'ORG'),
  ('audit.read', 'audit.view', 'ORG'),
  ('analytics.view', 'dashboard.view_org', 'ORG'),
  ('announcements.manage', 'announcements.publish', 'ORG'),
  ('holidays.manage', 'calendar.manage_holidays', 'ORG'),
  ('channels.create', 'chat.create_channel', 'ORG'),
  ('channels.manage', 'chat.manage', 'ORG'),
  ('attendance.view_team', 'attendance.view', 'TEAM'),
  ('attendance.view_all', 'attendance.view', 'ORG'),
  ('leave.approve', 'leave.approve', 'TEAM'),
  ('updates.view_team', 'updates.view', 'TEAM'),
  ('updates.view_all', 'updates.view', 'ORG'),
  ('campaigns.manage', 'campaigns.manage', 'ORG'),
  ('documents.manage', 'documents.manage', 'ORG'),
  ('ai.use', 'ai.use', 'ORG'),
  ('ai.manage', 'ai.configure', 'ORG')
), wanted AS (
  SELECT r."id" AS role_id, m.permission, m.scope::"PermissionScope" AS scope
  FROM "Role" r CROSS JOIN LATERAL unnest(r."permissions") AS p(legacy)
  JOIN map m ON m.legacy = p.legacy
)
INSERT INTO "RoleGrant" ("id", "roleId", "permission", "scope")
SELECT DISTINCT ON (role_id, permission)
  md5(role_id || permission), role_id, permission, scope
FROM wanted
ORDER BY role_id, permission, scope DESC;
