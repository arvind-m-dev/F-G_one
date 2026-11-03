# FG One — Database Design

PostgreSQL 16, managed with Prisma (`apps/api/prisma/schema.prisma`). Migrations live in `apps/api/prisma/migrations` and are applied with `pnpm db:migrate` (dev) or `pnpm --filter @fg/api prisma:deploy` (prod).

**Conventions**
* `cuid` string IDs, plus `createdAt` and `updatedAt`.
* Every company-owned row has an `organizationId` and indexes lead with it.
* Date-only fields (`joinedAt`, `birthday`, `Holiday.date`) use `@db.Date` (UTC midnight).
* Secrets are never stored raw. Session, invite and reset tokens are SHA-256 hashes, and passwords use Argon2id.
* Soft delete is used where history matters (`Message.deletedAt`, `User.status=DEACTIVATED`).

## Implemented (Milestone 1)

```
Organization 1─* Department, Role, User, Session, Invitation, AuditLog, Holiday, Announcement, Channel, Message
User *─1 Role, *─1 Department, *─1 User (manager)
Channel 1─* ChannelMember *─1 User
Channel 1─* Message 1─* Message (thread replies), 1─* MessageReaction
```

| Model | Purpose | Key fields / constraints |
|---|---|---|
| **Organization** | Tenant | `slug` unique, `primaryColor`, `secondaryColor`, `logoUrl`, `settings` JSON (validated by `organizationSettingsSchema`), `status` |
| **Department** | Org structure | unique `(organizationId, name)`, `headId`, `color` |
| **Role** | Permission bundle | unique `(organizationId, key)`, `permissions text[]`, `rank`, `isSystem` |
| **User** | Employee profile & identity | `email` globally unique (resolves the tenant at login), `status INVITED/ACTIVE/DEACTIVATED`, `passwordHash`, `roleId`, `departmentId`, `managerId`, profile fields, `preferences` JSON, **presence** (`presence`, `statusEmoji`, `statusText`, `statusExpiresAt`, kept separate from attendance), lockout (`failedLogins`, `lockedUntil`), unique `(organizationId, employeeCode)` |
| **Session** | Server-side session | `tokenHash` unique, `expiresAt`, `ip`, `userAgent`, `organizationId` |
| **Invitation** | Onboarding | `tokenHash` unique, `expiresAt` (7 days), `acceptedAt`, `revokedAt` |
| **PasswordResetToken** | Reset flow | `tokenHash` unique, `expiresAt` (30 min), `usedAt` |
| **AuditLog** | Sensitive-action trail | `actorId`, `action`, `entityType`, `entityId`, `metadata` JSON, `ip`; index `(organizationId, createdAt)` |
| **Holiday** | Company calendar | `date`, `type MANDATORY/OPTIONAL`; unique `(organizationId, date, name)` |
| **Announcement** | Company/department notices | `departmentId` (null = company-wide), `priority`, `pinned`, `publishedAt`, `expiresAt` |
| **Channel** | Public/private channel or DM | `type PUBLIC/PRIVATE/DIRECT`, unique `(organizationId, name)`, unique `(organizationId, directKey)` for de-duplicated DMs, `isDefault`, `lastMessageAt` |
| **ChannelMember** | Membership & read state | PK `(channelId, userId)`, `role ADMIN/MEMBER`, `lastReadAt` (unread counts), `muted` |
| **Message** | Chat message | `parentId` (threads), `editedAt`, `deletedAt`; index `(channelId, createdAt)` |
| **MessageReaction** | Emoji reactions | PK `(messageId, userId, emoji)` |

## Added (features round)
| Model | Purpose | Key fields / constraints |
|---|---|---|
| **AttendanceRecord** | One per user per organization-local day | unique `(userId, date)`, `location WFO/WFH/ON_DUTY`, `checkInAt`, `checkOutAt`, `late`, remarks |
| **AttendanceBreak** | Breaks within a record | `startAt`, `endAt` (open while on a break) |
| **AnnouncementAck** | Read confirmations | PK `(announcementId, userId)` |
| **Notification** | In-app inbox | `type`, `title`, `body`, `link`, `groupKey` + `count` (merged while unread), `readAt` |
| Announcement (changed) | | adds `category`, `requireAck` |

| **LeaveType** | Kinds of leave | unique `(organizationId, code)`, `annualAllowance` (0 = unlimited), `paid`, `active` |
| **LeaveRequest** | Leave | `startDate`, `endDate`, `halfDay`, `days` (working days), `status PENDING/APPROVED/REJECTED/CANCELLED`, `approverId`, `decisionNote` |
| **AttendanceCorrection** | Fix a day | `date`, `checkIn`/`checkOut` (local HH:MM), `location`, `reason`, `status`, `reviewerId` |
| HolidayType (changed) | | adds `COMPANY`, `SPECIAL_WORKING_DAY` |

Migration `…_attendance_announcements_notifications` also adds the new Home widgets to existing organizations' defaults.

## Added (Super Admin Phase 2a: permission engine)
* `Role` gains `color`, `icon`, `templateKey` and `archivedAt`. `Role.permissions` is **deprecated**: it is no longer read or written and is dropped in Phase 4.
* `RoleGrant { roleId, permission, scope }` is unique per (role, permission). `permission` is a key from `PERMISSION_CATALOG` in `@fg/shared`.
* `UserRole { userId, roleId, assignedById }` holds additional roles on top of `User.roleId`.
* `UserPermissionOverride { organizationId, userId, permission, effect ALLOW|DENY, scope?, reason, grantedById }` is unique per (user, permission).
* Enums: `PermissionScope` (CLIENT, OWN, ASSIGNED, PROJECT, TEAM, DEPARTMENT, ORG; the declaration order is the widening order) and `OverrideEffect`.
* Migration `20261103091117_permission_engine` backfills `RoleGrant` from `Role.permissions` using `LEGACY_PERMISSION_MAP`, keeping the widest scope. It was verified on the dev database: 8 of 8 roles round-trip to identical permissions.

## Added (Super Admin Phase 2b: authority)
* `User.isSuperAdmin` (bool) is the system authority, changed only by `/super-admins` and the operator CLIs. `User.accountType` is `INTERNAL | CLIENT`.
* `UserStatus` adds `SUSPENDED` (reversible) and `ARCHIVED`. Only `ACTIVE` users can sign in or keep a session.
* `SuperAdminInvitation { organizationId, userId (nominee), invitedById, tokenHash, expiresAt, acceptedAt, revokedAt }`
* `settings.security.superAdminLimit` (1–4, default 4) in the organization settings JSON
* Migration `20261103095255_super_admin_authority` sets `isSuperAdmin` for every holder of the old `super_admin` role, then renames that role to the assignable **Administrator** (`administrator`, rank 90, grants unchanged). Verified on the dev database: 2 of 2 former Super Admins were flagged.

## Planned models (added by later milestones, no changes to existing tables)

| Milestone | Models |
|---|---|
| M2 Attendance | ~~AttendanceRecord~~ (done); `AttendanceCorrection(status, reason, reviewerId)`; `DailyUpdate(orgId, userId, date, completed, inProgress, blockers, tomorrow, notes)` unique `(userId, date)`; `DailyUpdateComment` |
| M3 Files & notifications | `FileObject(orgId, ownerId, storageKey, mime, size, sha256, scanStatus)`; `MessageAttachment`; `PinnedMessage`; `Notification(orgId, userId, type, payload, readAt)`; `NotificationPreference`; `SavedItem` |
| M4 HRMS | `LeaveType`, `LeavePolicy`, `LeaveBalance(userId, typeId, year, allotted, used)`, `LeaveRequest(status, approverId, halfDay)`; `AnnouncementAck`; `Document(categoryId, visibility, fileId)`, `DocumentCategory`, `DocumentPermission`; `Campaign(kind BANNER/HIRING/EVENT…, startsAt, endsAt, targetDepartmentIds, imageFileId)`, `CampaignImpression` and `CampaignClick` (aggregated daily, no per-user tracking unless consented); `Recognition`, `Event`, `Poll`, `PollOption`, `PollVote` |
| M5 AI | `AiProviderConfig(orgId, provider, model, encryptedKey, enabled)`, `AiUsage(orgId, userId, feature, inputTokens, outputTokens, costMicros, latencyMs, status)`, `AiSummary(scope INDIVIDUAL/DEPARTMENT/WEEKLY/COMPANY, status DRAFT/APPROVED/PUBLISHED, content, reviewerId)`, `DocumentChunk(embedding vector)` (pgvector) |
| SaaS | `OrganizationDomain`, `Plan`, `Subscription`, `TenantAdmin` |

## Seed data

`pnpm db:seed` (development only, refuses `NODE_ENV=production`) creates:

* **Futurist Global** with 6 departments, 4 system roles, 16 active employees, 1 pending invite, 6 channels with conversations, 2 DMs, holidays and announcements.
* **Acme Test Co**, a second tenant with one admin, used for manual isolation checks.

All seeded accounts use `SEED_PASSWORD` from `apps/api/.env`.

## Backups

See `docs/DEPLOYMENT.md#backups`.
