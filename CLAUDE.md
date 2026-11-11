# FG One — instructions for Claude

FG One is Futurist Global's internal workspace (chat, attendance, leave, announcements, HR admin). The product spec is the PRD v3.0 (see `docs/IMPLEMENTATION_PLAN.md` for phases). Read `docs/FEATURE_INVENTORY.md` first to see what exists.

## Stack and layout
- pnpm monorepo. `apps/web` is Next.js 15 / React 19 / Tailwind v4 / TanStack Query / Motion. `apps/api` is NestJS 11 / Prisma 6 / PostgreSQL / Socket.IO. `packages/shared` holds zod contracts, permissions, presence and settings used by both apps.
- Work hub (projects, tasks, planner): API in `apps/api/src/work/` (`planner.ts` is pure and unit-tested), UI in `apps/web/src/components/work/` and `apps/web/src/app/app/work/`, data hooks in `apps/web/src/lib/work.ts`.
- Web pages: `apps/web/src/app/app/*` (Employee portal `/app`) and `apps/web/src/app/admin/*` (Admin portal `/admin`). Shared shell: `components/shell/workspace-shell.tsx`.
- API modules: `apps/api/src/<feature>/` (controller + service). Schema: `apps/api/prisma/schema.prisma`.

## Run locally
```bash
pnpm install && pnpm --filter @fg/shared build && pnpm --filter @fg/api prisma:generate
```
```bash
pnpm --filter @fg/api prisma:deploy && pnpm db:seed
```
```bash
pnpm dev
```
Web runs on http://localhost:3000 and the API on :4000. Demo logins are `admin@` (Super Admin flag + Administrator role), `hr@`, `manager@` and `employee@futuristglobal.com`, using `SEED_PASSWORD` from `apps/api/.env`. After changing `packages/shared`, rebuild it (`pnpm --filter @fg/shared build`).

## Tests (run before every commit)
```bash
pnpm --filter @fg/api test
```
```bash
pnpm --filter @fg/web test
```
```bash
pnpm -r typecheck
```
End-to-end tests need the stack running, the API started with `LOGIN_RATE_LIMIT_PER_MIN=1000`, and a fresh seed:
```bash
E2E_PASSWORD=<SEED_PASSWORD> pnpm --filter @fg/web test:e2e
```
For the Super Admin browser test, seed with `SEED_E2E_TOTP=<base32 secret>` and pass the same value as `E2E_TOTP_SECRET` (otherwise that test is skipped).
API tests use the `fgone_test` database (local Postgres: `brew services start postgresql@16`). `apps/api/.env` may point at Neon: never run `prisma migrate` or the seed against it from a feature branch; pass a local `DATABASE_URL` instead. Apply new migrations to it too:
```bash
DATABASE_URL=postgresql://fgone:<pw>@localhost:5432/fgone_test pnpm --filter @fg/api prisma:deploy
```

## Rules (follow these)
- **Security:** every company-owned row has `organizationId`. Take the tenant only from `auth.organizationId`, never from the request. Check permissions on the server with `@RequirePermissions` plus resource checks in services. Return 404 for other tenants' data. Audit sensitive admin actions (`AuditService.log`).
- **Contracts:** request bodies are validated with zod schemas in `packages/shared/src/schemas.ts` through `ZodPipe`. The web forms reuse the same schemas.
- **Backend first:** Prisma model → service with permission checks → controller → e2e test in `apps/api/test/` → UI.
- **No placeholders:** a feature appears in navigation only when it works end-to-end. Every button does something real.
- **UI:** follow `docs/DESIGN_SYSTEM.md`. Use Lucide icons only, **no emojis** in the UI. Use design tokens, not raw colours. Compose each page for its job rather than a generic "stat cards + table". Write plain-language labels a non-technical person understands. Include loading, empty and error states, and make it responsive (phone, tablet, desktop). Support light and dark.
- **State:** keep filters, tabs and open panels in the URL (`useUrlState`). Use `PageHeader` (it sets the browser title) and breadcrumbs on nested pages. Use `isPending`, not `isLoading`, before reading query data.
- **Attendance and leave** use the organization's time zone (`settings.attendance.timezone`).
- **Docs:** update `docs/FEATURE_INVENTORY.md`, `docs/API.md`, `docs/DATABASE.md`, `docs/CHANGELOG.md` and `docs/IMPLEMENTATION_PROGRESS.md` with each feature. Never mark planned work as done.
- **Git:** work on a feature branch and open a PR to `main`. Pushing to `main` redeploys Render. Never commit `.env` files or secrets.

## Open decisions (ask the user before building what depends on them)
- **D-6 roles: resolved.** Dynamic roles plus a Super Admin authority flag. Follow `docs/SUPER_ADMIN_ARCHITECTURE.md` and the phase order in `docs/SUPER_ADMIN_IMPLEMENTATION_PLAN.md` (one phase per PR or session).
- **D-7 file storage** for attachments: Cloudflare R2, Backblaze B2, AWS S3 or Neon. Render's disk is wiped on every deploy.

## Not built yet (PRD)
Chat attachments, rich composer and link previews (SSRF-safe) (need D-7). Work hub follow-ups: GitHub sync, Gmail, MCP connector for each person's Claude, message-to-task. Calendar. Ideas & Suggestions. Knowledge Base. Email notifications (Resend). Reports. A custom roles editor (Phase 4). A shift model (night shifts are flagged late).

## Before go-live
Run `pnpm --filter @fg/api db:reset-org` against Neon to remove demo data. It's a dry run unless `CONFIRM_RESET` is set. See `docs/DEPLOY_RENDER_NEON.md` §4.
