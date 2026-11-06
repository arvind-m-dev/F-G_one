# Changelog

## Unreleased: code-review fixes (branch `fix/review-highs`)
### Security
- **Role authority now counts extra roles.** Who may manage (set password, edit, suspend, view the full profile of) a person was decided from their main role's rank only, so someone holding a higher role as an *extra* could be managed — and impersonated via a password reset — by a lower-ranked admin. The check now uses the highest rank they hold, main or extra.
- **Open-redirect after sign-in closed.** `?next=/.//evil.example` resolved to a same-origin path whose value (`//evil.example`) the browser then treated as another site. `safeNext` now rejects a resolved path that is protocol-relative.
- **Temp-password sessions can't open the live socket.** The Socket.IO handshake rejected client and two-step-pending sessions but not one owing a forced password change; it now does, so no messages are readable before sign-in completes.
### Fixed
- **Approving an attendance correction with no finish time no longer erases an existing check-out** — a correction that fixes only the check-in keeps the recorded check-out.
- **Idle auto check-out no longer fires the instant a long break ends.** Returning from a break counts as activity, so a break longer than the idle limit doesn't immediately close the shift (the setting is off by default).
- **Editing an employee's role then opening the Access editor no longer silently restores the old role** — editing details now invalidates the cached access draft.
- **Notification bell count no longer freezes after the inbox is opened once** — it follows the live unread-count poll once the inbox closes.
- **Signing in no longer briefly shows the previous person's cached data on a shared tab** — the query cache is cleared on a fresh sign-in.
### Changed
- **`pnpm db:seed` refuses a non-local database** (it deletes and recreates the demo orgs). `NODE_ENV` alone was the only guard; it now also checks the `DATABASE_URL` host and needs `SEED_ALLOW_REMOTE=yes` for anything that isn't localhost.
### Tests
- API 215 (added: HR cannot set the password of someone holding an Administrator extra role). Web safe-next covers the `/.//` and `/./\\` payloads.

## Unreleased: demo passwordless sign-in (branch `demo-passwordless-login`)
### Added
- **Demo "Sign in without a password"** (remove before go-live): with `DEMO_PASSWORDLESS_LOGIN=true` the login screen shows an underlined "Sign in without a password" link that signs in one of the `DEMO_MFA_EMAILS` accounts with no password and no two-step code. New `GET /auth/demo-accounts` (which accounts to offer) and `POST /auth/demo-login`.
- Guarded three ways: the feature flag, an explicit allow-list (`DEMO_MFA_EMAILS`, internal accounts only), and a production boot-check — the API refuses to start if the flag is set while `NODE_ENV=production`, the same guard as `MFA_BYPASS_LOCAL`. When the flag is off, both endpoints behave as if they do not exist (`demo-accounts` returns `enabled: false`; `demo-login` returns 404).
### Tests
- API 6 e2e (listing is allow-listed and tenant-scoped; one-click sign-in gives a full session; non-listed, other-tenant and unknown emails all 404).

## Unreleased: admin overview and leave counts (branch `admin-counts-demo-mfa`)
### Added
- **Overview "Attendance today"**: checked in of total, late count, split bar and tiles (working, on a break, checked out, on leave, not checked in) linking to the filtered attendance board, and who has not checked in yet.
- **Admin leave counts**: tiles for waiting for approval, out today, starting in 7 days, approved and declined. New `GET /leave/requests/summary`.
- People in recent administrative activity and in "Waiting for a password" open the person's admin page.
- **Demo two-step code** (remove before go-live): with `DEMO_MFA_CODE` (6 digits) and `DEMO_MFA_EMAILS` set, the listed accounts accept that code at sign-in and re-auth, and the sign-in screen shows it after a correct password. Other accounts are unaffected.
- `MFA_BYPASS_LOCAL=true` skips the two-step code at sign-in and re-auth in local development. The API refuses to start with it in production.

## Unreleased: Super Admin Phase 3, user management (branch `phase-3-user-management`)
### Added
- **Super Admins page** `/admin/super-admins`: limit and places used (change the limit), each Super Admin with two-step status and whether the authority works, pending nominations (withdraw), nominate with password and a one-time link, remove authority. Rules explained in plain language.
- **Nominee acceptance page** `/super-admin/accept?token=`: guides to two-step verification, confirms with password, handles invalid, used and expired links.
- **Overview "Access and security"**: accounts by status, admins without two-step verification, locked and suspended accounts, Super Admins vs limit.
- **Suspend / lift suspension** (reversible, signs out at once, optional reason) and **archive / restore** (from deactivated; hidden from lists and pickers).
- **Access section per person**: primary role, extra roles, allow/block exceptions with scope, live "what they can do" preview. Ceiling rules: nobody grants more than they hold, sensitive exceptions are Super Admin only, no self-changes, no changes to Super Admins.
- **Add-employee wizard**: Person, Access, Password, Review; created atomically.
- Seed creates an e2e Super Admin with two-step verification when `SEED_E2E_TOTP` is set (development only).
### Changed
- The last-admin rule counts only working Super Admins (with two-step verification and no temporary password).
- Lowering the Super Admin limit below the current number returns 409 and is audited (`superadmin.limit_changed`).
- The admin portal opens for anyone holding an admin page's permission (attendance, holidays, announcements too).
- An open tab goes to sign-in as soon as its session is revoked or the account is suspended.
### Tests
- API 204, web unit 15, Playwright 57.

## Unreleased: admin-managed access and QA hardening (branch `qa-hardening`)
### Changed
- **Admins give access.** Accounts are created only by admins, with a work email and a password to hand over. Invitations are gone (`POST /employees/:id/invite` removed).
- **Only admins set passwords by default** (`settings.auth.selfServicePassword`, off). People cannot change their own, forgot-password sends nothing and old reset links stop working. Turning the switch on (System settings → Auth) restores temporary passwords, the first-sign-in change and self-service reset.
- A temporary-password session can only see `/auth/me`, sign out and change the password, and holds no Super Admin authority.
### Added
- **Employee page** `/admin/employees/[id]`: overview, employment and access, attendance (30 days), leave, devices (sign out everywhere) and activity; change email, set a new password (shown once), deactivate and reactivate. Super Admins can open anyone, others only people below their rank. `GET /employees/:id/overview`, `POST /employees/:id/email`.
- **Phase 2d operator commands:** `superadmin:bootstrap` (first Super Admin with a one-time password; does nothing once one exists) and `superadmin:recover` (new temporary password, two-step verification cleared, sessions removed, audited, other Super Admins notified). See `ACCOUNT_PROVISIONING.md`.
- **Much richer demo seed:** 48 people in 10 departments, 60 days of attendance, 321 leave requests, 41 holidays, 15 announcements, 37 conversations and 326 messages. Deterministic.
### Fixed (QA pass across every area, about 75 issues)
- **Security and privacy:** announcement search ignored department targeting; removed private-channel members still got reply notifications with message previews; the online list and online count crossed organizations; open redirect after sign-in (`?next=`); `javascript:` logo and photo links; email reset bypassed admin-managed passwords; % and _ in searches matched everything.
- **Data integrity:** simultaneous leave requests, decisions and corrections could duplicate or overwrite each other (now one wins, others get 409); double taps opened two breaks; deleting a department silently deleted its announcements (now refused); turning one notification type off cleared the others; corrections could create never-ending shifts and left breaks outside corrected hours.
- **Time zones:** attendance, leave, holidays and the home timeline used the browser's day instead of the company's; status "until end of today" used the server's midnight; invalid time zones broke attendance for everyone.
- **Robustness:** impossible dates, unbounded ranges, unknown categories and non-member role changes returned 500; leave next year was checked against this year's balance; requests went to deactivated managers.
- **UI:** clicks right after switching pages were lost (page transition mounted the page twice); chat details and message actions were unreachable on phones and tablets; error states instead of endless loading skeletons; filters and tabs kept in the URL; emojis replaced with icons; invitation wording removed.
- Default channels can no longer be renamed through the API.
### Tests
- API 189 (was 98), web unit 10, Playwright 54 (was 18). New suites: `employee-360`, `superadmin-cli`, `qa-auth-admin`, `qa-attendance-leave`, `qa-chat-content`, `qa-followups`.

## Unreleased: Attendance modes, top bar (branch `top-bar`)
### Added
- Desktop top bar with search, admin portal switch, notifications, theme and an account menu (name, email, role, status, profile, preferences, sign out). Sign out is no longer inside the logo menu; the phone header has the same account menu.
- Attendance settings for admins: what happens on opening FG One without checking in (nothing, reminder, automatic check-in with a chosen location), checking in more than once a day, and automatic check-out by hours after the workday, longest shift or minutes with no activity.
- Reminder banner "You haven't checked in today" (hide for today), automatic check-in toast, activity heartbeat for the idle rule.
- "Auto check-in" and "Auto check-out" labels on the board and history; two new CSV columns.
- Admin portal → Leave → **Record leave**: HR records leave someone already took (any date). It's approved straight away, audited (`leave.recorded`), and the employee and their manager are notified.
- Leave calendar: thin lines instead of bars (top line in the person's colour, bottom line in the leave type's colour, dashed while pending). Days off are hatched, holidays tinted, off weekdays marked in the header; special working days show as normal days.
- Attendance on a weekly day off or holiday is labelled "Day-off work" (history, board, today) and counted in the summary (`dayOffWorked`). The board doesn't count anyone as "not checked in" on a day off.
- Leave requests show how the days add up: total days, working days, weekly days off and holidays by name. New leave setting "Count weekends and holidays inside a leave" (sandwich rule, off by default): days off between the first and last leave day count as leave; days off at the edges never do.
- `pnpm db:seed-fill`: tops up a partly seeded demo organization (leave types and requests, announcements, a correction, notifications, fixed-date holidays) without deleting anything. Dry run unless `CONFIRM_FILL=<org slug>`.
### Fixed
- Night shifts: check-out and breaks after midnight now find the shift that started yesterday instead of failing with "Check in first".
- The Home greeting, clock and day progress update on the minute and as soon as you return to the tab.
- A leave request from someone nobody else can approve (the only admin, with no manager) is approved automatically instead of waiting forever.
- Request time off shows a message instead of an empty list when no leave types are set up.

## Unreleased: Favicon and link previews (branch `brand-meta`)
### Added
- New favicon (`icon.svg`, a drawn "F." mark on the brand gradient) and an iOS home-screen icon (`apple-icon`).
- Open Graph and Twitter card tags with a generated 1200×630 share image (`opengraph-image`), so shared links unfurl in Google Chat, Slack and WhatsApp. `metadataBase` comes from `NEXT_PUBLIC_SITE_URL` or Vercel's production URL.
### Fixed
- The auth middleware no longer redirects `/opengraph-image` and `/apple-icon` to `/login`, so crawlers can fetch them.

## Unreleased: Admin-managed passwords (no email)
### Changed
- Adding an employee sets a temporary password instead of sending an invitation link. The account is active straight away, and the admin gets a ready-to-copy message with the sign-in link, email and password (shown once).
- "Forgot your password?" tells people to ask HR or their administrator. The email reset is no longer linked from the web app.
### Added
- Admins set a new password for an employee from the Employees list ("Set password", requires recent sign-in). It signs them out everywhere and is audited (`employee.password_set`).
- After signing in with an admin-set password, the employee must choose their own before using the workspace (`User.mustChangePassword`; the session has no permissions until then). The new password must differ from the temporary one.

## Unreleased: Dashboard day progress, leave calendar bars, loading states (branch `dashboard-day-progress`)
### Changed
- Dashboard "Today" is a progress bar of the workday built from today's attendance: worked time, breaks (with times on hover), the stretch before a late check-in and time left. Falls back to elapsed workday before check-in.
- Leave calendar draws each leave as one bar from its first to last day in the leave type's colour, stacked in lanes when people overlap, continuing across weeks. Pending requests are dashed. Adds a leave type legend.
- Centred dialogs no longer open off-screen (the position was applied twice). Tall dialogs scroll.
### Added
- Top-of-window progress bar on internal navigation and skeleton loading screens for the Employee and Admin portals.
- `apps/web/vercel.json` to host the web app on Vercel (API stays on Render; Socket.IO needs a long-running server).
- Demo seed: today's tea and lunch breaks for everyone checked in, and overlapping multi-day leaves around today.

## Unreleased: Super Admin control panel (branch `super-admin`)
### Added (Phase 1, docs only)
- `AUTH_AND_RBAC.md` (current-state audit), `SUPER_ADMIN_ARCHITECTURE.md` (target design), `SUPER_ADMIN_IMPLEMENTATION_PLAN.md` (phases 2a–8). No code changes.
### Added (Phase 2a, permission engine)
- Scoped permission grants per role (`RoleGrant`), additional roles per user (`UserRole`) and per-user ALLOW/DENY overrides. Explicit deny always wins; default deny.
- Permission catalogue with modules, actions, supported scopes, plain-language help and sensitive flags (`@fg/shared` `authz.ts`).
- `/auth/me` returns `grants`; `/roles` returns grants and the catalogue.
### Added (Phase 2b, Super Admin authority)
- Super Admin is a protected flag, not a role. Up to `settings.security.superAdminLimit` (max 4, pending invitations count). Nominate, accept (nominee signs in and confirms their password), revoke and remove endpoints, all password-confirmed and audited. The last active Super Admin cannot be removed, even by concurrent requests.
- Account types (internal, client) and the suspended and archived statuses. Client accounts are blocked from internal routes and the realtime socket.
### Added (Phase 2c, two-step verification, re-authentication and devices)
- Two-step verification with any authenticator app (TOTP, RFC 6238) and 10 single-use recovery codes. Settings → Security turns it on with a QR code, shows recovery codes once, replaces them, or turns it off.
- Sign-in asks for the code (or a recovery code) when it is on. The password-only half session can do nothing else, expires after 10 minutes, and is discarded after 5 wrong codes.
- Re-authentication for sensitive actions (`@RequireRecentAuth`, 10 minutes). The web app asks for the password and code, then retries.
- Signed-in devices in Settings → Security: sign out one device or all others. Admins can sign an employee out everywhere (`/employees/:id/sessions/revoke`).
- Signing out, revoking a session, changing or resetting a password and enabling two-step verification close the affected live (socket) connections.
### Security (Phase 2c)
- Super Admin authority is active only with two-step verification on. Accepting a nomination requires it, and a Super Admin cannot turn it off.
- Super Admin actions need a recent sign-in or re-authentication.
- Authenticator secrets are encrypted at rest. Each code can be used once, enforced with a conditional write so two simultaneous requests cannot both use it.
### Security
- Re-issuing an activation link now requires authority over the account. Before this, HR could obtain the link for a pending higher-rank account.
- Only Super Admins can manage Super Admin accounts or change security settings.
### Changed (Phase 2b)
- The **Super Admin role is renamed Administrator** (same permissions, assignable by Super Admins). Existing holders keep everything and gain the Super Admin flag.
### Changed
- Effective permissions are resolved per request from grants, so changes apply without signing out. Legacy permission checks are derived from grants with identical results for every existing role.
- Attendance visibility and HR recipient lookup use the new engine.
- `Role.permissions` column deprecated (no longer read or written).

## Unreleased: UI redesign (branch `ui-redesign`)
### Added (HR round)
- Leave: types with yearly allowances, balances, requests with working-day counting, overlap and balance checks, cancellation, manager/HR approvals, privacy-aware "Who's away" calendar, admin requests/calendar/types.
- Holidays: categories (public, company, optional, special working day), employee calendar, admin management.
- Attendance corrections: request, review, apply in the organization's time zone, audited.
- Approvals page with nav badge; leave shown on the attendance board.
- `db:reset-org` go-live script (dry run by default) and default leave types in `db:bootstrap`.

### Added (features round)
- Attendance: check-in/break/check-out with server-validated transitions, work location and notes, history with summaries, team board for managers, admin board with filters and CSV export. Times use the organization's time zone.
- Announcements: editorial feed, categories, read confirmations; admin publishing with targeting, pinning, expiry and confirmation tracking.
- Notifications: inbox with grouping, filters, read state, per-type preferences, live toasts.
- Getting started checklist, "?" help hints, friendly 404 and error pages.
- Refresh resilience: session cache restore, URL-kept state (filters, tabs, open threads), breadcrumbs, browser tab titles, re-sync on reconnect.
- Responsive: icon-only rail on tablets, five mobile tabs, card layouts for admin tables on phones.
- Configurable `LOGIN_RATE_LIMIT_PER_MIN` (default 10).

### Added
- Employee portal at `/app` and Admin portal at `/admin`, with a workspace switcher between them. Old routes redirect.
- Two-step sign-in with device-local recent accounts (choose, use another, remove).
- Personal Settings page: theme, accent palette, text size, sidebar, message density, Enter-to-send, 12/24-hour time.
- Chat conversation list with search, previews, timestamps and unread counts. Mobile single-view chat with back navigation.
- Message toolbar: copy text, copy link, reaction picker.
- Home "Customize" drawer (reorder within sections, hide, restore default).
- Seed channels from the PRD (development, qa-testing, project-updates, ideas, help-support, team-discussion).
- Docs: UI audit, design system, UI components, implementation plan, feature inventory, decisions, known issues, progress.

### Fixed
- API production image now includes the Prisma CLI, so migrations run on start instead of downloading an unpinned version.
- Rate limiting and audit IPs use the real visitor IP behind the Render + Next.js proxy chain (`TRUST_PROXY`, default 1, Render 2). `/api/health` reports `clientIp` for verification.

### Changed
- New design tokens (PRD palette), Geist typeface, chrome/canvas layering, redesigned dark theme.
- Home recomposed: greeting with personal summary, day timeline, attention list, editorial announcements, team pulse grouped by availability.
- Admin overview recomposed around team composition, pending invitations and recent activity.
- Directory is list-first, with department filter chips.
- Presence and reactions use Lucide icons. The API only accepts the approved reaction keys.

### Removed
- Emojis from UI chrome, presence, seeded statuses and messages.
- The top bar. Its functions moved into the rail.

## 0.1.0: Milestone 1 (2 Nov 2026)
- Foundation and hybrid workspace (see README).
