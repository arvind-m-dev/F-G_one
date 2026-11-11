# FG One — API Reference (Milestone 1)

Base URL: `/api` (same origin via the Next.js proxy, or `http://localhost:4000/api` directly).

* **Auth:** httpOnly `fg_session` cookie set by `POST /auth/login` or `POST /auth/accept-invitation`. Every endpoint requires it unless it's marked 🌐 public.
* **Errors:** `{ statusCode, message, issues?: [{ path, message }] }`. `400` is a validation error. `401` means no or expired session. `403` means missing permission or a cross-origin write. `404` means not found or not visible to you, including other tenants' data. `409` is a conflict. `429` means rate-limited.
* **Validation:** request bodies use the zod schemas in `packages/shared/src/schemas.ts`.
* **CSRF:** non-GET requests with an `Origin` header must come from `WEB_ORIGIN`.

## Auth
| Method | Path | Notes |
|---|---|---|
| 🌐 POST | `/auth/login` | `{ email, password }`. Limit 10/min. Locks for 15 min after 5 failures. Generic error message. Returns `{ ok, mfaRequired }`. With `mfaRequired: true` the cookie is a 10-minute half session that can only call `/auth/mfa/verify` and `/auth/logout`; everything else returns 401 `code: MFA_REQUIRED`. |
| 🌐 POST | `/auth/mfa/verify` | `{ code }`: a 6-digit authenticator code or a recovery code. Replaces the half session with a new full session (new token). A code is never accepted twice. Five wrong codes discard the half session (401). Each failure is audited as `auth.mfa_failed`. |
| 🌐 GET | `/auth/demo-accounts` | **Demo only, removed at go-live.** `{ enabled, accounts: [{ email, name, role, avatarColor }] }`. `enabled` is false (and `accounts` empty) unless `DEMO_PASSWORDLESS_LOGIN` is on; lists only the `DEMO_MFA_EMAILS` accounts of the caller's workspace. |
| 🌐 POST | `/auth/demo-login` | **Demo only, removed at go-live.** `{ email }`: signs in an allow-listed demo account with no password or 2FA. Limit 10/min. Audited `auth.demo_login`. Returns 404 when the feature is off, the email is not allow-listed, or the account is not an active internal account. Never starts in production (boot-check). |
| POST | `/auth/logout` | Deletes the server session and closes its live connections |
| GET | `/auth/me` | `{ user, permissions, grants, role, preferences, organization{branding, settings} }`. `grants` maps permission → widest scope (e.g. `{"attendance.view":"TEAM"}`). `permissions` are the legacy flat keys derived from it. Also `isSuperAdmin`, `accountType` (`INTERNAL` or `CLIENT`), `mfaEnabled` and `superAdminNeedsMfa` (holds the flag, but the authority is off until two-step verification is on). |
| 🌐 POST | `/auth/forgot-password` | `{ email }`. Always returns 200 (no enumeration). Limit 5 per 15 min. Not linked from the web app: passwords are reset by an admin. |
| 🌐 POST | `/auth/reset-password` | `{ token, password }`. Single use, 30-min expiry. Signs out all sessions. |
| POST | `/auth/change-password` | `{ currentPassword, newPassword }`. 403 unless self-service passwords are on or the account has a temporary password. Signs out other sessions and closes their live connections. |
| POST | `/auth/reauth` | `{ password, code? }`. `code` is required when two-step verification is on. Marks the session as recently authenticated. Limit 10 per 15 min. Failures are audited as `auth.reauth_failed`. |
| GET | `/auth/mfa` | `{ enabled, enabledAt, recoveryCodesLeft, required }`. `required` is true for Super Admins. |
| POST | `/auth/mfa/setup` | 🔒 recent auth. Starts enrolment: `{ secret, otpauthUrl, qrSvg }`. Nothing changes until a code is confirmed. 409 if already on. |
| POST | `/auth/mfa/enable` | `{ code }`. Confirms the first code and turns it on. Returns `{ recoveryCodes }` (10, shown once). Signs out other devices. |
| POST | `/auth/mfa/disable` | 🔒 recent auth. 403 for Super Admins. |
| POST | `/auth/mfa/recovery-codes` | 🔒 recent auth. Replaces the recovery codes and returns the new ones once. |
| GET | `/auth/sessions` | Your signed-in devices: `{ id, ip, userAgent, createdAt, lastSeenAt, expiresAt, current }[]` |
| POST | `/auth/sessions/:id/revoke` | Signs out one of your other devices and closes its live connection. 404 for anyone else's session. |
| POST | `/auth/sessions/revoke-others` | Signs out every other device. Returns `{ count }`. |

🔒 **recent auth** (`@RequireRecentAuth`, 10 minutes): the session must have signed in or called `/auth/reauth` within the window, otherwise 403 with `code: REAUTH_REQUIRED`. The web app then asks for the password (and code) and retries.
| 🌐 GET | `/auth/invitations/:token` | Validates an invite: `{ email, firstName, organization }` |
| 🌐 POST | `/auth/accept-invitation` | `{ token, password }`. Activates the account, auto-joins default channels and starts a session. |

## Me
| Method | Path | Body |
|---|---|---|
| PATCH | `/me/profile` | `updateProfileSchema` (names, bio, phone, pronouns, timezone, avatarUrl/Color, birthday, showBirthday) |
| PATCH | `/me/preferences` | `{ theme?, accent?, sidebarCollapsed?, dashboardWidgets? }` |
| PUT | `/me/status` | `{ presence, emoji?, text?, expiry: never\|30m\|1h\|4h\|today }`. Broadcasts `presence:updated`. |

## Employees
| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/employees?q&departmentId&status&page&pageSize` | `employees.read` | Non-admins only see ACTIVE users and no private fields |
| GET | `/employees/:id` | `employees.read` | Includes manager and direct reports |
| POST | `/employees` | `employees.manage` | `createEmployeeSchema` (includes a temporary `password`). Enforces the domain allow-list and role rank. Creates an ACTIVE account. It must change the password at first sign-in only when `settings.auth.selfServicePassword` is on. Returns `{ employee }`. |
| PATCH | `/employees/:id` | `employees.manage` | Rank rules. You can't change your own role. |
| POST | `/employees/:id/deactivate` | `employees.manage` | Revokes sessions and invitations and disconnects sockets |
| POST | `/employees/:id/activate` | `employees.manage` | |
| GET | `/employees/:id/overview` | `employees.manage` | Everything about one person: `employee`, `access` (roles, overrides, grants), `account` (status, MFA, last sign-in), `attendance` (30 days, null without `attendance.view`), `leave`, `sessions`, `activity` (50 audit entries, null without `audit.read`). Super Admins can open anyone, others only lower rank; other tenants 404. Never includes password hashes or MFA secrets. |
| POST | `/employees/:id/email` | `employees.manage` + recent sign-in | `{ email }`. Company domain, globally unique (409). Same rank rules; not your own. Signs them out everywhere. Audited `employee.email_changed` with from/to. |
| POST | `/employees/:id/password` | `employees.manage` + recent sign-in | `{ password }`. Sets a new password (shown once to hand over), signs the employee out everywhere and activates an account still waiting for a password. With `selfServicePassword` on it is temporary and must be changed at next sign-in. Rank and Super Admin checks as editing. Not for your own account. Audited `employee.password_set`. |

Account lifecycle and access (Phase 3), all `employees.manage` with rank and Super Admin checks, never on yourself, other tenants 404:

| Method | Path | Notes |
|---|---|---|
| POST | `/employees/:id/suspend` | 🔒 recent auth. `{ reason? }`. From ACTIVE or INVITED. Signs out, closes sockets. |
| POST | `/employees/:id/unsuspend` | Back to ACTIVE (INVITED without a password). |
| POST | `/employees/:id/archive` | 🔒 recent auth. Only from DEACTIVATED. |
| POST | `/employees/:id/restore` | ARCHIVED → DEACTIVATED. |
| GET | `/employees/:id/access` | `{ roleId, extraRoleIds, overrides, grants, editable, readOnlyReason, ... }` |
| PUT | `/employees/:id/access` | 🔒 recent auth. `{ roleId?, extraRoleIds[], overrides[{permission, effect, scope?}] }`. Ceiling rules (`packages/shared/src/access.ts`). Audited with a diff. |

`POST /employees` also takes `extraRoleIds` and `overrides` (created in one transaction). The `status` filter accepts SUSPENDED and ARCHIVED; ALL leaves out archived.

Super Admins (Phase 3): `GET /super-admins` adds `activeCount`, `pendingCount` and per person `email`, `mfaEnabled`, `authorityActive`. `POST /super-admins/invitations/check { token }` lets the nominee see their nomination without accepting (404 otherwise). Lowering `settings.security.superAdminLimit` below the current count returns 409. `GET /admin/overview` includes `access` (account counts, locked, admins without two-step verification, Super Admins vs limit).

Admin device controls (Phase 2c), with the same rank and Super Admin authority checks as editing:

| Method | Path | Notes |
|---|---|---|
| GET | `/employees/:id/sessions` | `employees.manage`. The employee's signed-in devices. |
| POST | `/employees/:id/sessions/revoke` | `employees.manage` + 🔒 recent auth. Signs them out everywhere and closes their live connections. Audited as `employee.sessions_revoked`. |

## Departments · Roles · Organization
| Method | Path | Permission |
|---|---|---|
| GET | `/departments` | any |
| POST / PATCH / DELETE | `/departments[/:id]` | `departments.manage` |
| GET | `/roles` | any. Each role has `grants[{permission, scope}]`, derived `permissions`, `assignable`, `archivedAt`, `color`, `icon`. The response also carries `catalog` (permission catalogue with supported scopes, labels, help and `sensitive`), `modules` and `scopeLabels`. |
| 🌐 GET | `/public/branding` | Login-page branding for `DEFAULT_ORG_SLUG`: `name`, `logoUrl`, colours, `tagline`, `defaultTheme`, and `selfServicePassword` (the company password policy, so the forgot-password page offers an email reset only where it works). |
| GET | `/organization` | any |
| PATCH | `/organization` | `settings.manage`. `{ name?, logoUrl?, primaryColor?, secondaryColor?, settings?: deep-partial }`, deep-merged and re-validated. |

## Super Admins (Phase 2b, 2c)
Super Admin is an authority flag (`User.isSuperAdmin`), not a role. Every route below except `accept` requires it (`@RequireSuperAdmin`); anyone else gets 403. **The authority is active only while two-step verification is on**; a flagged user without it gets 403 `code: MFA_SETUP_REQUIRED`. Every mutating route also needs 🔒 recent auth. Other tenants' records return 404. Sensitive actions take the caller's current `password`; a wrong password returns 403 and is audited as `superadmin.reauth_failed`. Concurrent changes run in SERIALIZABLE transactions, and a conflict returns 409.

| Method | Path | Notes |
|---|---|---|
| GET | `/super-admins` | `{ limit, hardLimit, used, superAdmins[], pending[] }`. `used` = active Super Admins + pending invitations. |
| POST | `/super-admins/invitations` | `{ userId, password }`. The nominee must be an active internal user. Returns 409 when `used >= limit`. Emails a 72-hour link and returns `{ id, expiresAt, url }`. The link only works for the nominee, signed in, with their own password. |
| POST | `/super-admins/invitations/:id/revoke` | Frees the slot |
| POST | `/super-admins/invitations/accept` | **Nominee** (any signed-in internal user): `{ token, password }`. Returns 404 for anyone else's, used, revoked or expired links. Returns 403 `MFA_SETUP_REQUIRED` until the nominee has two-step verification on. The limit is re-checked. |
| POST | `/super-admins/:userId/remove` | `{ password }`. Returns 403 when targeting yourself and 409 for the last active Super Admin. Takes effect on the target's next request. |

Related rules:
* Only a Super Admin can edit, deactivate or re-issue the invite of a Super Admin account.
* Deactivating a Super Admin requires removing the authority first.
* `POST /employees/:id/invite` now applies the same rank and Super Admin checks as editing. This closes a gap where HR could obtain the activation link for a pending higher-rank account.
* Changing `settings.security` (`superAdminLimit`, 1–4) requires a Super Admin.
* **Client accounts** (`accountType = CLIENT`) are denied on every route except `GET /auth/me`, `POST /auth/logout` and `POST /auth/change-password` (`@ClientAllowed`), and they cannot open a realtime socket.

## Dashboard · Analytics · Search · Audit
| Method | Path | Permission |
|---|---|---|
| GET | `/dashboard` | any. Workday, team, announcements, holidays, celebrations, recent chats, unread total, org stats. |
| GET | `/admin/overview` | `analytics.view`. Status counts, departments, roles, 14-day message activity, 6-month joiners, recent audit. |
| GET | `/search?q=` | any. People, channels (public or member) and messages (member channels only). |
| GET | `/audit-logs?q&entityType&page` | `audit.read` |
| 🌐 GET | `/health` | DB connectivity |

## Attendance
Days use the organization's time zone (`settings.attendance.timezone`). Every transition is validated on the server.

| Method | Path | Rules |
|---|---|---|
| GET | `/attendance/today` | Policy (incl. `multipleSessions`, `checkInMode`, `autoCheckOut`), `isWorkingDay` (holidays and special working days applied), `onLeave` (approved full-day leave) and the current record: an open shift started within 24h (may be yesterday's night shift), else today's record, else a night shift that ended today. Records include `autoCheckedIn`, `autoCheckOutReason` (`workday_end`/`max_shift`/`idle`), `breaks[].kind` (`BREAK`/`AWAY`), `breakMinutes`, `awayMinutes`, `workedMinutes`. |
| POST | `/attendance/check-in` | `{ location: WFO\|WFH\|ON_DUTY, remarks? }`. Allowed locations follow policy. 409 if already checked in. After checking out today: 409, unless `multipleSessions` is on or the shift was closed automatically; then the day's record reopens and the gap is stored as an `AWAY` interval. |
| POST | `/attendance/auto-check-in` | `{ checkedIn, today }`. Checks in with `autoCheckInLocation` only when `checkInMode` is `auto`, it's a working day, you're not on full-day leave, it's between 2 hours before workday start and workday end, and you haven't checked in today. |
| POST | `/attendance/activity` | Activity heartbeat for the idle rule; updates `lastActiveAt` on the open shift at most once a minute. |
| POST | `/attendance/break/start` · `/break/end` | Only while checked in. Returns 409 for a double start. |
| POST | `/attendance/check-out` | `{ remarks? }`. Closes any open break. |

**Automatic check-out** (`settings.attendance.autoCheckOut`, each rule off at 0): `afterWorkdayEndHours` (only for sessions that started before the workday ended), `maxShiftHours`, `idleMinutes` (closes at the last activity; not while on a break). Rules measure the current session; the first to fire wins. It runs lazily on attendance reads and every 5 minutes, notifies the person, and marks the record.
| GET | `/attendance/me?from&to` | History and summary (default last 30 days) |
| GET | `/attendance/board?date` | `attendance.view_all` (everyone) or `attendance.view_team` (direct reports) |
| GET | `/attendance/users/:id?from&to` | Same scope rules |
| GET | `/attendance/export?from&to` | CSV download. Formula-injection safe. Audited. |

## Announcements
| Method | Path | Rules |
|---|---|---|
| GET | `/announcements?category&q&include` | Company-wide plus your department. Managers can pass `include=all`, which adds expired ones. |
| GET | `/announcements/:id` | Includes `acknowledgedAt`, `ackCount`, `audience` |
| POST | `/announcements/:id/ack` | Idempotent |
| GET | `/announcements/:id/acks` | `announcements.manage`: confirmed and pending lists |
| POST / PATCH / DELETE | `/announcements[/:id]` | `announcements.manage`. Publishing notifies the audience. Audited. |

## Holidays
| Method | Path | Rules |
|---|---|---|
| GET | `/holidays?year=` | Everyone in the organization |
| POST / PATCH / DELETE | `/holidays[/:id]` | `holidays.manage`. `{ name, date, type: MANDATORY\|COMPANY\|OPTIONAL\|SPECIAL_WORKING_DAY, description? }`. Audited. |

## Leave
Working days follow `attendance.workingDays`. Public and company holidays don't count, and special working days do.

| Method | Path | Rules |
|---|---|---|
| GET | `/leave/types?include=all` | Active types (HR can include hidden ones) |
| POST / PATCH | `/leave/types[/:id]` | `employees.manage` |
| GET | `/leave/balances?userId=` | Yours. Managers can see reports, HR anyone. Pending days are held from the balance. |
| POST | `/leave/preview` | `{ typeId, startDate, endDate, halfDay }` returns `{ days, calendarDays, workingDays, weekends, holidays[{date,name}], sandwichDays }`. `days` is what the request uses: working days, plus days off inside the range when `leave.countDaysOffInside` is on. |
| POST | `/leave/requests` | Validates the type, half-day policy, non-working ranges, overlap (409) and balance (400). Notifies the manager, or HR if there is none. If nobody else can approve (the only admin, no manager), it is approved automatically. |
| POST | `/leave/requests/record` | `employees.manage`. `{ userId, typeId, startDate, endDate, halfDay?, reason? }`: records leave for someone else, any date, same checks; created `APPROVED` with you as approver. 400 for yourself, 404 for other tenants. Notifies the employee (link `/app/leave`) and their manager (`/app/leave?tab=team`). Audited `leave.recorded`. |
| GET | `/leave/requests/summary` | `employees.manage`. `{ date, pending, approved, declined, cancelled, outToday, startingSoon }` for your organization. `outToday` and `startingSoon` (next 7 days) count approved requests in the organization time zone. |
| GET | `/leave/requests?scope=mine\|approvals\|all&status=` | `approvals` covers your direct reports (`leave.approve`), or everyone for HR. `all` is HR only. |
| POST | `/leave/requests/:id/decision` | `{ decision: APPROVED\|REJECTED, note? }`. Manager of the requester or HR, never yourself. 409 if already decided. Audited and notified. |
| POST | `/leave/requests/:id/cancel` | Your own pending or future approved leave |
| GET | `/leave/calendar?month=YYYY-MM` | Approved leave for your department and reports (HR also sees pending). Reasons only for HR and yourself. |
| GET | `/approvals/count` | `{ canApprove, leave, corrections, total }` |

## Attendance corrections
| Method | Path | Rules |
|---|---|---|
| POST | `/attendance/corrections` | `{ date, checkIn, checkOut?, location, reason }`. Today or up to 60 days back, one pending per day. |
| GET | `/attendance/corrections?scope=mine\|approvals` | |
| POST | `/attendance/corrections/:id/decision` | Manager (`attendance.view_team`) of the requester or HR. Approval writes the record in the organization's time zone. Audited. |

## Notifications
| Method | Path | Notes |
|---|---|---|
| GET | `/notifications?filter=all\|unread\|mentions` | Includes `unread` total |
| GET | `/notifications/unread-count` | |
| POST | `/notifications/read` | `{ ids? , all? }`. Only your own. |

Created for DMs (grouped per conversation while unread), `@firstname` mentions of channel members, thread replies to the original author, and announcements. Each type can be turned off in `preferences.notifications`.

## Chat
| Method | Path | Rules |
|---|---|---|
| GET | `/channels` | My channels and DMs with `unread`, `lastMessage`, participants |
| GET | `/channels/browse` | Public channels with `isMember` |
| POST | `/channels` | `channels.create`. `{ name, description?, visibility, memberIds[] }`. The creator becomes ADMIN. |
| POST | `/dm` | `{ userIds[] }` (1–8). Returns the existing DM for the same participant set if there is one. |
| GET | `/channels/:id` | Members and `canManage`. Private or DM channels return 404 to non-members. |
| PATCH | `/channels/:id` | Channel admin or `channels.manage` |
| POST | `/channels/:id/join` · `/leave` | Public only. Default channels can't be left. |
| POST | `/channels/:id/members` | Public: any member. Private: admins only. |
| DELETE | `/channels/:id/members/:userId` | Admin, or yourself. The last admin is protected. |
| PATCH | `/channels/:id/members/:userId` | `{ role }`. Admins only. |
| GET | `/channels/:id/messages?before&limit&parentId` | Cursor pagination (newest first per page) |
| POST | `/channels/:id/messages` | `{ body, parentId?, clientId? }`. Members only. |
| POST | `/channels/:id/read` | Marks the channel read |
| GET | `/messages/:id` | Members only (used to reopen a thread from a link) |
| PATCH | `/messages/:id` | Author only |
| DELETE | `/messages/:id` | Author or channel admin (audited). Soft delete. |
| POST | `/messages/:id/reactions` | `{ emoji }` toggle |

## WebSocket (Socket.IO, path `/socket.io/`)
The session cookie is authenticated at handshake. The server assigns rooms: `org:<id>`, `user:<id>`, `channel:<id>`.

| Event (server → client) | Payload |
|---|---|
| `presence:online` | `{ userIds }` snapshot on connect |
| `presence:updated` | `{ userId, online?, presence?, statusEmoji?, statusText?, statusExpiresAt? }` |
| `message:new` / `message:updated` | `ChatMessage` |
| `channel:updated` / `channel:removed` | `{ channelId }` |
| `typing` | `{ channelId, userId, name, typing }` |
| `notification:new` | `{ id, type, title, body, link }`, to that user only |
| `attendance:changed` | `{ userId }` |
| `announcements:changed` | `{}` |

| Event (client → server) | Payload |
|---|---|
| `typing` | `{ channelId, typing }`. Ignored unless the socket is in that channel room. |
