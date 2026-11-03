# Changelog

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
