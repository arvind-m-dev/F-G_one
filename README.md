# FG One — Futurist Global Employee Workspace

One workspace for chat, people, and HR at Futurist Global. It combines a Slack-style messaging layout with a personal dashboard, behind secure invite-only, role-based access.

> **Status:** Milestone 1 and the PRD v3.0 UI redesign (Phases 0–1: design system, Employee `/app` and Admin `/admin` portals) are complete and tested. See [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) and [docs/FEATURE_INVENTORY.md](docs/FEATURE_INVENTORY.md).

## What works today

| Area | Features |
|---|---|
| **Auth** | Company-email login, Argon2id password hashing, opaque httpOnly server sessions, logout, forgot/reset password (30-min single-use tokens), invitation onboarding (7-day single-use links), account lockout, deactivation that ends every session, change password |
| **Roles** | Super Admin · Admin/HR · Manager · Employee. Permission-based guards on every API, plus rank rules so nobody can escalate privileges. |
| **Multi-tenancy ready** | `organizationId` on every company-owned row. The tenant comes from the session only. Automated cross-tenant isolation tests. |
| **Workspace shell** | Collapsible sidebar (remembered per user) with channels and DMs, mobile drawer, ⌘K global search (people, channels, messages), quick actions, status picker, theme switch, account menu, page transitions |
| **Dashboard** | Greeting & profile, live clock + workday progress (from company policy), team availability with live presence, announcements (with modal), holidays, birthdays & work anniversaries ("send wishes" opens a DM), recent conversations with unread counts, quick actions, company snapshot. Drag-and-drop reordering and show/hide, saved per user. |
| **Presence** | 13 emoji statuses, custom message, auto-expiry, live updates over WebSocket. Kept separate from attendance. |
| **Chat** | Public/private channels, 1:1 and group DMs, threads, emoji reactions, edit/delete with permissions, typing indicators, unread counters, optimistic sending, infinite history, member management with channel admins, join/leave, rename/topic |
| **Attendance** | Check in (office, home, client site), breaks, check out, history and summaries. Team board for managers, live admin board with filters and CSV export. |
| **Announcements** | Editorial feed with categories and read confirmations. Admins publish, target, pin, set expiry and track readers. |
| **Notifications** | Inbox for DMs, @mentions, replies and announcements, with per-type settings |
| **People** | Directory (grid/list, search, department filter), profile pages with reporting line, editable own profile (avatar colour/photo URL, bio, pronouns, timezone, birthday privacy) |
| **Admin** | Live analytics (charts), employee management (invite with copyable link, edit, re-invite, deactivate/reactivate), departments CRUD, roles & permission matrix, company settings (branding & colours with live preview, modules, dashboard defaults, navigation, attendance & leave policy, allowed domains, session length), audit log |
| **Design** | Tailwind v4 design tokens, runtime white-label colours, light/dark/system themes, personal accent colour, Motion micro-interactions, skeletons, empty and error states, toasts, accessible Radix primitives, reduced-motion support, responsive down to phones |

## Tech stack
Next.js 15 · React 19 · TypeScript · Tailwind CSS v4 · Radix UI (shadcn-style components) · Motion · TanStack Query · Socket.IO · NestJS 11 · Prisma 6 · PostgreSQL 16 · Zod (shared contracts) · Jest + Supertest · Vitest + Testing Library · Playwright

## Repository layout

```
fg-one/
├─ apps/
│  ├─ api/                 NestJS backend
│  │  ├─ prisma/           schema.prisma, migrations/, seed.ts, bootstrap.ts
│  │  ├─ src/
│  │  │  ├─ auth/          login, sessions, invites, reset, SessionGuard (RBAC)
│  │  │  ├─ employees/     CRUD, invitations, safe serialization
│  │  │  ├─ departments/ roles/ organization/ me/ dashboard/ search/ audit/
│  │  │  ├─ chat/          channels, DMs, messages, reactions
│  │  │  ├─ realtime/      Socket.IO gateway (presence, typing, fan-out)
│  │  │  ├─ mail/          SMTP (console fallback in dev)
│  │  │  └─ common/        env validation, zod pipe, CSRF origin check
│  │  └─ test/             e2e tests (real Postgres)
│  └─ web/                 Next.js frontend
│     ├─ src/app/(auth)/        login, forgot/reset password, invite
│     ├─ src/app/(workspace)/   home, chat, people, profile, admin/*
│     ├─ src/components/        ui/, layout/, dashboard/, chat/, admin/
│     ├─ src/lib/               api client, session, realtime, presence store
│     └─ e2e/                   Playwright specs
├─ packages/shared/        zod schemas, permissions, presence, settings (used by both apps)
└─ docs/                   ARCHITECTURE · DATABASE · API · DEPLOYMENT
```

## Getting started

Prerequisites: Node 22+, pnpm 10+, and PostgreSQL 16 (local, Docker, or managed).

**1. Start Postgres and Mailpit.** If you already have Postgres, skip this and create a database instead.

```bash
docker compose up -d postgres mailpit
```

**2. Install dependencies.**

```bash
pnpm install
```

**3. Configure the environment.**

```bash
cp apps/api/.env.example apps/api/.env
```

```bash
cp apps/web/.env.example apps/web/.env.local
```

Then edit `apps/api/.env`: set `DATABASE_URL`, choose a `SEED_PASSWORD` (10+ chars), and optionally set `SMTP_URL=smtp://localhost:1025` for Mailpit.

**4. Build the shared package, migrate and seed demo data.**

```bash
pnpm --filter @fg/shared build
```

```bash
pnpm db:migrate
```

```bash
pnpm db:seed
```

**5. Run the API (port 4000) and the web app (port 3000).**

```bash
pnpm dev
```

Open http://localhost:3000 (the Employee portal is at `/app`, the Admin portal at `/admin`) and sign in with any seeded account using your `SEED_PASSWORD`:

| Email | Role |
|---|---|
| `admin@futuristglobal.com` | Super Admin |
| `hr@futuristglobal.com` | Admin / HR |
| `manager@futuristglobal.com` | Manager |
| `employee@futuristglobal.com` | Employee |

Without `SMTP_URL`, invitation and reset emails are printed in the API console. Admins also get the invite link directly in the UI.

## Testing

API unit and e2e tests use the separate `fgone_test` database. They need `TEST_DATABASE_URL`, or the default from `apps/api/test/setup-env.ts`.

```bash
DATABASE_URL=postgresql://fgone:PASSWORD@localhost:5432/fgone_test pnpm --filter @fg/api prisma:deploy
```

```bash
pnpm --filter @fg/api test
```

Web unit tests:

```bash
pnpm --filter @fg/web test
```

The end-to-end tests drive two browsers against the running, seeded dev stack:

```bash
E2E_PASSWORD=<SEED_PASSWORD> pnpm --filter @fg/web test:e2e
```

Run the API with `LOGIN_RATE_LIMIT_PER_MIN=1000` while running e2e, because the suite signs in many times from one IP. Reseed between runs (`pnpm db:seed`) because the tests change data.

## Documentation
* [Architecture, multi-tenancy, AI design, navigation, journeys, roadmap](docs/ARCHITECTURE.md)
* [Database design (current + planned models)](docs/DATABASE.md)
* [API reference + WebSocket events](docs/API.md)
* [Deployment, configuration, backups, go-live checklist](docs/DEPLOYMENT.md)
* [UX, navigation & performance](docs/UX_AND_PERFORMANCE.md)
* [Design system](docs/DESIGN_SYSTEM.md) · [UI components](docs/UI_COMPONENTS.md) · [UI audit](docs/UI_AUDIT.md)
* [Implementation plan](docs/IMPLEMENTATION_PLAN.md) · [Progress](docs/IMPLEMENTATION_PROGRESS.md) · [Decisions](docs/DECISIONS.md) · [Known issues](docs/KNOWN_ISSUES.md) · [Changelog](docs/CHANGELOG.md)
