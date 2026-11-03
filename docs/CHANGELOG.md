# Changelog

## Unreleased: Super Admin control panel (branch `super-admin`)
### Added (Phase 1, docs only)
- `AUTH_AND_RBAC.md` (current-state audit), `SUPER_ADMIN_ARCHITECTURE.md` (target design), `SUPER_ADMIN_IMPLEMENTATION_PLAN.md` (phases 2a–8). No code changes.
### Added (Phase 2a, permission engine)
- Scoped permission grants per role (`RoleGrant`), additional roles per user (`UserRole`) and per-user ALLOW/DENY overrides. Explicit deny always wins; default deny.
- Permission catalogue with modules, actions, supported scopes, plain-language help and sensitive flags (`@fg/shared` `authz.ts`).
- `/auth/me` returns `grants`; `/roles` returns grants and the catalogue.
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
