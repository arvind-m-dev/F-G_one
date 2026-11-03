# Super Admin & Dynamic Permissions: architecture

Status: **design (Phase 1)**. Nothing in this document is implemented yet unless it is marked so. The current state is in `AUTH_AND_RBAC.md`.

Principles:
* **Extend, don't duplicate.** Keep `User`, `Role`, `Session`, `Invitation` and `AuditLog`.
* **Backend first, default deny.**
* **Super Admin is an authority flag, not a role.**

---

## 1. Authority layers

```
┌──────────────────────────────────────────────────────────────┐
│ Platform operator (deployment shell / DB access)             │  bootstrap + recovery CLIs only
├──────────────────────────────────────────────────────────────┤
│ Super Admin  (User.isSuperAdmin, 1..limit per org, MFA req.) │  all modules, all scopes
├──────────────────────────────────────────────────────────────┤
│ Roles (dynamic, per org) → grants {permission, scope}        │  primary + additional roles
│   + user overrides (ALLOW within ceiling / DENY wins)        │
├──────────────────────────────────────────────────────────────┤
│ Resource rules (ownership, membership, project, client)      │  enforced in services via scope filters
└──────────────────────────────────────────────────────────────┘
```

* `isSuperAdmin` lives on `User`. It can be changed **only** by the dedicated Super Admin endpoints (invite, accept, deactivate). Each requires MFA plus recent re-auth and is audited. It can never be changed through employee or role editing.
* **Limit:** `settings.security.superAdminLimit` defaults to 4, and 4 is also the hard cap in code. A new invite is rejected when `active + pending invites >= limit`.
* **Last-admin protection:** deactivating, suspending or demoting a Super Admin is rejected when they are the last *active* one. This is checked in a serializable transaction so two Super Admins can't remove each other at the same time.
* A Super Admin cannot change their own authority (self-target is rejected), and cannot edit audit logs. Nobody can, through the app.

## 2. Permission model

### 2.1 Catalogue (code-defined, in `packages/shared/src/permissions.ts`)
Permissions are `module.action` and declare which scopes they support. Modules and actions are code (they need enforcement code); **roles and their grants are data**. That is what makes roles UI-manageable without code changes.

```ts
// illustrative shape
{ key: 'tasks.view',   module: 'tasks', action: 'view',   scopes: ['OWN','ASSIGNED','PROJECT','TEAM','DEPARTMENT','ORG'], label, help }
{ key: 'tasks.create', module: 'tasks', action: 'create', scopes: ['PROJECT','ORG'] }
{ key: 'roles.manage', module: 'admin', action: 'manage', scopes: ['ORG'], sensitive: true }
```

Modules:
* dashboard, chat, employees, attendance, leave, projects, tasks, calendar, announcements, documents, reports and admin (users, roles, settings, audit)
* existing ones: holidays, channels, updates, campaigns and ai

Actions are view, create, edit, delete, publish, approve, assign, manage, export, archive, invite and configure, and are defined only where they are meaningful for a module.

### 2.2 Scopes
`OWN < ASSIGNED < PROJECT < TEAM < DEPARTMENT < ORG`, plus `CLIENT` for client accounts. The client scope is restricted to the client's projects and to client-visible records only.
* `TEAM` means the user's direct reports (from `User.managerId`). Indirect reports may be added later as a separate decision, because it widens existing access.
* `PROJECT` means projects where the user is a `ProjectMember`.
* `DEPARTMENT` means the user's department.
* For each permission, a grant at a wider scope implies the narrower ones.

### 2.3 Storage
```
Role            (+ color, icon, templateKey, archivedAt; keep isSystem; rank → deprecated)
RoleGrant       { roleId, permission, scope }           @@unique([roleId, permission])
UserRole        { userId, roleId }                      additional roles (primary stays User.roleId)
UserPermissionOverride { userId, permission, effect: ALLOW|DENY, scope?, reason, grantedById }
```
`Role.permissions String[]` is migrated into `RoleGrant` rows and then dropped. Old keys map to new key and scope pairs, for example `attendance.view_team` → `attendance.view@TEAM` and `attendance.view_all` → `attendance.view@ORG`.

### 2.4 Resolution (deterministic)
```
if !session valid or user.status != ACTIVE or org != ACTIVE      → deny all
if user.isSuperAdmin                                              → every permission @ORG
grants = primary role ∪ additional roles (archived roles ignored)
for each permission: scope = max(scope across grants)
apply overrides: DENY → remove permission (explicit deny wins over every role)
                 ALLOW → add, but only up to the granter's own ceiling at grant time
if user.accountType == CLIENT → intersect with CLIENT_ALLOWED set, scope forced to CLIENT
else                                                              → result (default deny)
```
The result is computed **per request**, as today, so changes apply immediately without a logout. A short-lived in-process cache keyed by `(userId, authzVersion)` is allowed. `Organization.authzVersion` is bumped on any role or grant change, and `User.authzVersion` on assignment or override changes. Sockets are disconnected on suspension or deactivation, and channel rooms are re-checked on role change.

### 2.5 Escalation rules (replace `rank`)
1. Holding `roles.manage` lets you edit roles, but **only grant permission and scope pairs you hold yourself** (the ceiling rule).
2. You cannot edit a role you are assigned to, or your own overrides or roles. Super Admins are exempt from the first restriction but still cannot change their own authority.
3. Assigning a role to a user requires `users.assign_role` **and** that the role's grants are within your ceiling.
4. Permissions marked `sensitive` (`roles.manage`, `users.manage`, `settings.configure`, `audit.view`) can be granted only by a Super Admin.
5. Clients can never receive internal-only permissions; the API rejects it and so does the UI.

### 2.6 Enforcement API (NestJS)
*Implemented in Phase 2a as plain functions in `apps/api/src/common/authz.ts` (`scopeOf`, `userScopeWhere`, `usersWithLegacyPermission`); the rest arrives with the modules that need it.*
* `@RequirePermission('tasks.view')` on the route. The guard rejects the request when the user has no grant at any scope.
* `AuthzService.scope(auth, 'tasks.view')` returns a scope or null. `AuthzService.where(auth, 'tasks.view', 'task')` returns a Prisma `where` fragment for that scope. **Every list, search, export and report** query uses it, which is how search and exports respect permissions.
* `AuthzService.assert(auth, 'tasks.edit', record)` handles single-record checks (ownership, membership, client visibility).
* Existing `@RequirePermissions(PERMISSIONS.X)` call sites keep working through a compatibility map during migration and are converted module by module.

## 3. Accounts

* `User.accountType`: `INTERNAL | CLIENT`. Administrator is a role, not a type. Super Admin is the flag.
* `UserStatus`: `INVITED | ACTIVE | SUSPENDED | DEACTIVATED | ARCHIVED`. Suspension is reversible. Deactivation is soft, and history (attendance, leave, messages, audit) is kept. Archiving hides the user from pickers.
* The invitation status shown in the UI is **derived**: Draft (no invite sent), Invited, Expired, Revoked, Accepted. "Pending verification" is the window between opening the link and finishing setup, including MFA for Super Admins.
* Client users belong to a `ClientOrganization` and get access through `ClientProjectAccess`. They are excluded from the employee directory, presence, internal channels, global search and attendance. They have their own portal at `/client`.

## 4. MFA, re-auth and sessions

* **TOTP (RFC 6238)** using a small vetted library (`otplib`), compatible with any authenticator app.
  * The secret is encrypted at rest with AES-256-GCM using `MFA_ENCRYPTION_KEY`, an environment secret that is never sent to the frontend.
  * There are 10 single-use recovery codes, hashed with argon2.
* MFA is **required** for Super Admins: activation is blocked until it is enrolled. The org can require it for everyone else through `settings.security.requireMfa: none|admins|all`.
* **Login:**
  1. A correct password creates a session with `mfaPending=true`. Only `/auth/mfa/*` and `/auth/logout` are allowed.
  2. A valid code clears the flag.
  3. Failed codes count toward the lockout.
* **Re-auth:** `Session.reauthAt`. `@RequireRecentAuth(10 min)` covers:
  * Super Admin changes, role grants and overrides
  * suspend, deactivate and revoke sessions
  * security settings and data exports

  The UI prompts for a password or TOTP and retries.
* **Sessions:** `/me/sessions` lists them (device, IP, last seen) and can revoke one or all others. Admins can revoke a user's sessions. Password reset, suspension, deactivation and Super Admin removal revoke all sessions and sockets.

## 5. Bootstrap and recovery (operator CLIs, never HTTP)

* `pnpm --filter @fg/api superadmin:bootstrap`
  * Runs only when the org has **no** Super Admin and `Organization.bootstrappedAt` is null; otherwise it exits with "already initialized". This makes it idempotent and closed after first success.
  * Requires `CONFIRM_BOOTSTRAP=<org slug>`.
  * It sends and prints a 24-hour single-use invite.
  * On acceptance the user sets a password, enrolls MFA and confirms one code. Only then are `isSuperAdmin=true` and `bootstrappedAt` set.
  * There is no default password, and none is ever printed.
* `pnpm --filter @fg/api superadmin:recover --email`
  * For lockouts: it issues a recovery invite that resets the password and MFA for an **existing** Super Admin, or for the named active internal user when **zero** active Super Admins remain.
  * Requires `CONFIRM_RECOVERY=<slug>`.
  * Audited as `superadmin.recovered`, and all other Super Admins are emailed.
  * Shell or DB access is the trust boundary; the same access could already modify the database.

## 6. Projects, clients, work (Phase 5 data)
```
ClientOrganization { name, status, notes }        ClientContact = User(accountType CLIENT, clientOrgId)
Project { code @@unique(org,code), name, description, clientOrgId?, managerId, status(enum + custom label), priority,
          category, startDate, targetDate, clientVisible flags json, archivedAt }
ProjectMember { projectId, userId, role label }
ProjectMilestone { projectId, name, dueDate, completedAt, clientVisible }
ProjectUpdate { projectId, authorId, body, kind: INTERNAL|CLIENT, publishedAt, progressOverride? }
Task { projectId?, title, description, status(TODO|IN_PROGRESS|BLOCKED|IN_REVIEW|DONE), priority, assigneeId, reporterId,
       dueDate, completedAt, clientVisible }
```
**Progress** is computed, never invented: `done tasks / non-cancelled tasks`. When a project has milestones but no tasks, it is `completed milestones / milestones`. An authorized manual value can be posted as a `ProjectUpdate.progressOverride`, shown with its author and time and labelled "manual". Clients see only `CLIENT` updates, milestones with `clientVisible` set, and the computed or published progress.

## 7. Calendar, content, notifications
* `CalendarEvent` has type, all-day or timed, visibility (ORG, DEPARTMENT, PROJECT, TEAM or PRIVATE), participants and reminders. Holidays stay in `Holiday`, extended with region, `departmentIds` and partial-day. Both are merged into one calendar feed, with ICS export.
* Announcements gain an `audience` json (everyone, employees, roleIds, departmentIds, projectIds, clientOrgIds), a draft-and-preview step and `clientVisible`. Reads are filtered by audience in the service.
* Notifications reuse the existing inbox and preferences. New kinds are role change, project and task assignment, events and client publications. Org defaults go in settings.

## 8. Audit and security centre
* Add `outcome` (`SUCCESS|DENIED|FAILED`), `userAgent` and `actorType` to `AuditLog`. Failed logins for known users are recorded; unknown emails go to the app log only, with no tenant to attribute them to.
* **Append-only at the DB level:** a Postgres trigger rejects `UPDATE` and `DELETE` on `AuditLog` unless the transaction sets `fg.audit_purge = on`. Only `db:reset-org` sets it.
* Every permission denial on a sensitive route is logged as `DENIED`, with rate-limited aggregation.
* The UI provides a timeline with filters (actor, action, entity, outcome, date), login history per user, and permission history per role and user from the audit metadata diff.

## 9. Admin portal UI (summary; details in the plan)
The control panel is `/admin`, recomposed with the PRD's sections. A section appears only when its module exists and the viewer holds a permission in it. Signature pieces:
* the Permission Studio (module × action matrix with a scope picker per cell, compare, clone, reset to template, unsaved-change guard, plain-language help)
* the account creation wizard (type-specific steps, inherited permission preview, overrides, summary)
* user detail drawers with action menus
* the Super Admins page (limit meter, invites, MFA status)
* the audit timeline

## 10. Decisions taken here, and what still needs the user
| # | Decision | Default taken |
|---|---|---|
| D-6 | Roles | **Resolved by this PRD:** dynamic roles with the 10 templates. Existing users are mapped as follows: `super_admin` → isSuperAdmin + Administrator, `hr_admin` → HR Manager, `manager` → Team Lead (with leave approval for the team), `employee` → Employee. |
| D-7 | File storage | **Still open.** It blocks profile pictures, attachments, documents and project files. Everything else proceeds. |
| D-10 | MFA method | TOTP plus recovery codes. WebAuthn is later. |
| D-11 | Email delivery | The existing SMTP transport. Production needs `SMTP_URL`, otherwise invites are only logged. |
| D-12 | Client portal | Same app at `/client`, same cookie auth, separate shell. |
