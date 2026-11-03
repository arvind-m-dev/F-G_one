# Super Admin Control Panel: implementation plan

The design is in `SUPER_ADMIN_ARCHITECTURE.md`. Each phase is **one PR** that is shippable on its own, follows the backend-first order, and closes with the standard gates:
* typecheck, unit tests, API e2e and Playwright
* updated docs
* no regressions in `/app` and `/admin`

Phases are sized so one Claude session can finish one phase without running out of context. Start a fresh session (or `/compact`) between phases and point it at this file plus `IMPLEMENTATION_PROGRESS.md`.

| Phase | Scope | Key acceptance tests | Size |
|---|---|---|---|
| **1 Audit & design** | `AUTH_AND_RBAC.md`, `SUPER_ADMIN_ARCHITECTURE.md`, this plan | Docs reviewed | **Done** |
| **2a Permission engine** | Catalogue v2 (module, action, scopes). `RoleGrant`, `UserRole` and `UserPermissionOverride` models. Migration of `Role.permissions` with old→new key mapping. `AuthzService` (`scope`, `where`, `assert`). Compatibility map for existing guards. `/auth/me` returns effective grants. | All 39 existing API e2e tests pass unchanged. Resolution unit tests (union, max scope, deny wins, client mask, archived role ignored). | **Done.** 7 unit + 6 e2e tests. The client mask moves to 2b, which adds `accountType`. |
| **2b Super Admin authority** | `User.isSuperAdmin`, `accountType`, and the SUSPENDED and ARCHIVED statuses. Limit setting. Last-admin protection in a serializable transaction. Super Admin invite, list, revoke and deactivate endpoints. Data migration from the `super_admin` role. Remove the `roleKey === 'super_admin'` special cases. | Limit enforced (5th invite rejected). Non-Super Admin gets 403 on every Super Admin endpoint. Last-admin removal rejected. Concurrent removal test. | **Done.** 10 e2e + 2 unit tests. Nominations are for existing active employees (create the account first). MFA at acceptance is added in 2c. |
| **2c MFA, re-auth, sessions** | TOTP enroll, verify and disable, plus recovery codes (`otplib`, AES-GCM secret, `MFA_ENCRYPTION_KEY`). `mfaPending` login step. `@RequireRecentAuth`. Session list and revoke (self and admin). Socket disconnect on revoke or suspend. | Super Admin cannot finish activation without MFA. Pending-MFA session limited to `/auth/mfa/*`. Revoked session gets 401 and its socket closes. | **Done.** 10 e2e + 8 unit + 1 Playwright test. TOTP is implemented in `auth/mfa.ts` (checked against the RFC 6238 vectors) instead of `otplib`. Super Admin authority stays dormant until MFA is on. |
| **2d Bootstrap & recovery CLIs** | `superadmin:bootstrap` (idempotent, closed after first success, `CONFIRM_BOOTSTRAP`). `superadmin:recover`. Update `db:reset-org` and `DEPLOY_RENDER_NEON.md`. `ACCOUNT_PROVISIONING.md`. | Second bootstrap run is a no-op. Recovery is audited and notifies the other Super Admins. | S |
| **3 User management** | Account creation wizard (type-specific steps, inherited-permission preview, overrides, summary). Derived invitation statuses. Resend, revoke, suspend, reactivate, deactivate, reset password and revoke sessions, with confirmation dialogs and audit entries. The control panel's new navigation and Overview are built here. | Suspended user gets 401 and the socket closes. A Manager cannot invite above their ceiling. | L |
| **4 Roles & Permission Studio** | Role CRUD (create, edit, duplicate, archive, reset to template, colour, icon). The 10 templates. Matrix UI with a scope picker per cell, compare two roles, clone, unsaved-change guard, help per permission. Ceiling and sensitive-permission rules. Permission history. | A custom role can be created, edited, duplicated and archived without code. The ceiling rule blocks escalation. Editing your own role is rejected. Grant changes apply on the next request. | L |
| **5a Projects & tasks** | Project, ProjectMember, Milestone, ProjectUpdate and Task models and APIs, all filtered by `AuthzService.where`. Admin project pages. Employee "My Work" (list and board). Computed progress. | Scope tests (OWN, ASSIGNED, PROJECT, ORG). Task search and exports are scoped. | L |
| **5b Clients** | ClientOrganization and client users. `ClientProjectAccess`. Publish-to-client workflow. `/client` portal shell (projects, milestones, updates). | **Client isolation suite:** a client gets 404 on internal endpoints, other clients' projects, directory, chat, attendance and search. Internal updates are never visible. Revoked access takes effect at once. | M |
| **6 Organization admin** | CalendarEvent and the unified calendar (company, department, project, holidays) with ICS export. Holiday region, departments and partial-day. Announcement audiences, draft and preview, client visibility. Employee profile tabs (overview, employment, attendance, leave, work, activity). Organization settings additions (date and time format, invitation settings, notification defaults). | Audience filtering tests. Calendar visibility tests. | L |
| **7 Reports & audit centre** | Reports (employees, attendance, leave, projects, tasks, accounts) with filters and CSV, all scoped. Audit `outcome`, `userAgent` and append-only trigger. Security centre (timeline, login history, failed logins, permission history). Export auditing. | Reports respect scopes. The trigger blocks UPDATE and DELETE. Every export writes an audit row. | M |
| **8 Verification** | Full acceptance checklist (PRD §22) as automated tests where possible. Responsive and theme pass. Security review (`/security-review`). Remaining docs: `PERMISSION_MATRIX.md`, `ROLE_MANAGEMENT.md`, `CLIENT_ACCESS_CONTROL.md`, `PROJECT_MANAGEMENT.md`, `SECURITY_AND_AUDIT.md`, `TESTING_STRATEGY.md`, `SUPER_ADMIN_MODULE.md`. | All checkboxes ticked with test references. | M |

## Dependencies and blockers
* **D-7 storage** blocks profile pictures, project files, announcement images and documents. Those items are deferred, not faked; every other phase proceeds without it.
* **Email:** invites and recovery need `SMTP_URL` in production. Without it, links are printed to the API log only.
* Phase 2a must land before anything else. Every later module is built on `AuthzService`.

## Migration safety
* Each phase's migration is additive first: add columns and tables, backfill, then switch reads, and drop only in a later phase.
* Run against `fgone_test` and a Neon **branch** before production.
* `db:reset-org` keeps working throughout.
* Existing users keep their effective access: the role mapping (`SUPER_ADMIN_ARCHITECTURE.md` §10) is tested for equivalence, so each old permission maps to a grant that allows the same routes.
