# Authentication and RBAC: current state (audit, 3 Nov 2026)

This document describes **what is implemented today**. It was updated after Phase 2a. The target design is in `SUPER_ADMIN_ARCHITECTURE.md`.

## 1. Authentication

| Area | Implementation | File |
|---|---|---|
| Passwords | argon2id (`@node-rs/argon2`), with the policy taken from `settings.auth` | `apps/api/src/auth/password.ts` |
| Login | Email and password. The tenant is resolved from the globally unique email. | `auth.service.ts` `login` |
| Lockout | After `MAX_FAILED` failed attempts the account is locked for `LOCK_MINUTES`, and an `auth.locked` audit entry is written. | `auth.service.ts:42-55` |
| Rate limit | Login is limited per client IP to `LOGIN_RATE_LIMIT_PER_MIN` (default 10). `TRUST_PROXY` controls which IP is used. | `app.module.ts`, `common/env.ts` |
| Sessions | An opaque 32-byte token in the httpOnly, SameSite=Lax cookie `fg_session`. Only its sha256 is stored (`Session.tokenHash`). `lastSeenAt` is touched every few minutes. | `session.guard.ts`, `auth.service.ts:75` |
| Session validity | Checked on **every request**: the session must not be expired, the user must be `ACTIVE`, the org must be `ACTIVE`, and the session's org must match the user's org. Failing sessions are deleted. | `auth.service.ts:75-100` |
| CSRF | An Origin check on unsafe methods, plus SameSite=Lax. | `common/origin.middleware.ts` |
| Invitations | A single-use hashed token with an expiry and revocation. Accepting it sets the password and makes the user `ACTIVE`. | `auth.service.ts:155-185` |
| Password reset | A hashed single-use token. A reset **signs out all sessions**. | `auth.service.ts:128-140` |
| Change password | Requires the current password. | `auth.service.ts:143-152` |
| Mail | Sent over SMTP when `SMTP_URL` is set; otherwise logged to the console. | `mail/mail.service.ts` |

**Not implemented:** email verification separate from invitation acceptance, a login history view, and per-attempt failed password records (only the lock event is audited; failed MFA codes are). MFA, re-authentication and device sessions were added in Phase 2c (see the note in §2).

## 2. Authorization

> **Phase 2a (done):** the permission engine now sits underneath the model described below.
> * Role grants (`RoleGrant`, permission + scope), extra roles (`UserRole`) and per-user overrides (`UserPermissionOverride`) are resolved **per request** in `AuthService.validateSession` by `resolveGrants` (`packages/shared/src/authz.ts`):
>   * the union of non-archived roles, with the widest scope per permission
>   * ALLOW overrides added
>   * DENY overrides removed last
>   * extra roles from another tenant ignored
> * `auth.grants` carries the result. `auth.permissions` (the legacy keys) is derived from it with `legacyFromGrants`, so every existing check works unchanged.
> * Scoped checks use `apps/api/src/common/authz.ts`: `scopeOf` and `userScopeWhere` (ORG = organization, TEAM = direct reports, OWN = self). Attendance visibility uses it.
> * `hrUsers` resolves through the same engine (`usersWithLegacyPermission`).
>
> **Phase 2b (done):**
> * Super Admin is a flag (`User.isSuperAdmin`) with protected endpoints, a limit (1–4) that counts pending invites, last-admin protection in SERIALIZABLE transactions, password re-confirmation and audit.
> * The old `super_admin` role is now the ordinary **Administrator** role.
> * `isSuperAdmin` resolves to every catalogue permission at ORG.
> * Client accounts are default-denied on routes and sockets and are masked to CLIENT-scoped permissions.
> * `SUSPENDED` and `ARCHIVED` statuses block sign-in and sessions.
> * The invite re-issue escalation gap is closed.
>
> **Phase 2c (done):** two-step verification (TOTP plus recovery codes, encrypted secrets, no code reuse), half-signed-in sessions, `@RequireRecentAuth`, device list and sign-out for yourself and for admins, and socket disconnect on sign-out, revoke, password change or reset. Super Admin authority is dormant without MFA.
>
> The text below describes the legacy layer that still drives route guards.

* **Permission catalogue:** 20 flat strings in `packages/shared/src/permissions.ts`, for example `employees.manage` and `attendance.view_all`. There are no data scopes; scope is encoded in the name (`view_team` versus `view_all`).
* **Roles:** `Role` (per org) has `key`, `name`, `permissions String[]`, `rank` and `isSystem`. There are four seeded system roles: `super_admin` (rank 100, all permissions), `hr_admin` (75), `manager` (50) and `employee` (10). Each user has **one** role (`User.roleId`).
* **Enforcement:**
  * The global `SessionGuard` checks `@RequirePermissions(...)` against `role.permissions`. There are about 24 guarded routes.
  * Resource and scope checks happen in services, for example leave and attendance approvals (`common/approvals.ts`: HR approves anyone, a manager approves direct reports, nobody approves themselves) and channel membership.
  * Every query is filtered by `auth.organizationId`, and another tenant's data returns 404.
* **Escalation guard:** rank. You can only manage users of a lower rank and assign lower-rank roles (`employees.service.ts:86-95`). `super_admin` is special-cased by `roleKey === 'super_admin'` in 2 API places and 1 UI place.
* **Freshness:** the role is loaded with the session on every request, so a permission change applies on the next request with no logout needed. The open socket connection is **not** re-checked when a user is deactivated.
* **Roles UI:** `/admin/roles` is read-only, with 72 lines. There is no API to create, edit, duplicate or archive roles.

## 3. Audit
`AuditLog` has `actorId`, `action`, `entityType`, `entityId`, `metadata` json, `ip` and `createdAt`. About 30 actions are logged, including:
* auth: login, logout, locked, password reset and change, invitation accepted
* employee create, update, role change and (de)activation
* settings, departments, holidays, announcements, leave types, channel moderation, and attendance export and corrections

There are no update or delete endpoints. It is **not** append-only at the database level: Prisma or SQL can modify rows, and org deletion cascades. It has no `outcome` or `userAgent` fields.

## 4. Gaps against the Super Admin PRD

| PRD requirement | Status |
|---|---|
| Super Admin as a separate authority (1–4 accounts, last one protected) | **Done (Phase 2b), backend.** The UI arrives in Phase 3. |
| MFA, re-auth, session list and revoke, login history | **Done (Phase 2c)** except the login history view (Phase 7) |
| Secure bootstrap that closes after first use | Partial. `db:bootstrap` creates a Super Admin invite but can be re-run and does not require MFA. |
| Dynamic roles (create, edit, duplicate, archive, templates) | Data model and enforcement done (Phase 2a). There is no UI or API to edit yet (Phase 4). |
| Granular actions × modules × **data scopes**, explicit deny, user overrides | Engine done (Phase 2a). The catalogue covers today's modules with ORG and TEAM scopes; other scopes arrive with their modules. |
| Additional roles per user | Done in the engine (`UserRole`); not yet assignable in the UI |
| Account types (employee, client, admin), SUSPENDED and ARCHIVED statuses | Done in the data model and enforcement (Phase 2b). Suspend and archive actions arrive in Phase 3. |
| Clients, projects, tasks, milestones, calendar events | Missing (no models) |
| Announcement audience targeting (roles, departments, projects, clients) | Partial (category, expiry, acknowledgements; audience is everyone) |
| Reports with CSV | Partial (attendance CSV only) |
| Append-only audit, failed-login records, export auditing | Partial (`attendance.exported` is audited) |
