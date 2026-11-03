# Implementation Plan (PRD v3.0)

Sequenced to the PRD's phases and adapted to what already exists. Each phase ends with typecheck, unit, API e2e and Playwright runs, plus updates to `IMPLEMENTATION_PROGRESS.md` and `CHANGELOG.md`.

| Phase | Scope | Depends on | Status |
|---|---|---|---|
| 0 Discovery & audit | `UI_AUDIT.md`, `FEATURE_INVENTORY.md`, this plan | — | **Done** |
| 1 Foundation & design system | Tokens, Geist, Lucide-only icons, light/dark/system, accent palette, shell, `/app` + `/admin` portals, responsive navigation | 0 | **Done** |
| 2 Auth & portals | Two-step login with recent accounts **(done)**. Email verification, session list and "sign out other devices", role model decision (D-6), configurable permissions UI | 1 | Partly done |
| Pre-deploy fixes | Prisma CLI in the API image and client-IP rate limiting behind the proxy **(done)**. Production reset script **(done)**. | — | **Done** |
| UX & performance | Cache restore, URL state, breadcrumbs, titles, reconnect sync, 404/error pages, help hints, checklist **(done)**. Remaining items are listed in `UX_AND_PERFORMANCE.md` §5. | — | Mostly done |
| 3 Communication | Notification inbox and preferences **(done)**. Object storage (S3/R2) + attachments and image/PDF previews, rich composer (sanitized markdown subset), link previews (SSRF-safe server fetcher + cache), @mention autocomplete + notifications, pinned/saved messages, message search filters, notification inbox, chat settings (link previews, timestamps) | Storage provider decision (D-7) | Planned |
| 4 HR & attendance | Check-in/break/check-out, history, exports, team boards, corrections, leave types/balances/approvals, holiday admin **(done)**. Employee profile tabs (attendance, leave) and reports remain. | — | Mostly done |
| 5 Work management | Projects, tasks (statuses, priorities, estimates), list/kanban/calendar/timeline views, message-to-task, standups | 3 (message refs) | Planned |
| 6 Content | Announcements editor with categories, expiry, visibility and acknowledgements **(done)**. Ideas with votes, comments and follow. Knowledge base with categories, permissions and version history | 3 (attachments) | Planned |
| 7 Advanced | Notification preferences, email notifications (Resend), workspace defaults (date format, timezone), command palette actions (check-in, create task) | 3–6 | Planned |
| 8 QA & deploy | RBAC and security tests, file and realtime tests, accessibility pass, performance, Render + Neon production deploy, rollback runbook | all | Planned |

## Conventions
* Backend first for each feature: Prisma model with `organizationId` → service with permission checks → controller with zod contracts → e2e tests → UI.
* No placeholder buttons. A feature appears in navigation only when it works end-to-end.
* Every new admin action writes an audit log.
