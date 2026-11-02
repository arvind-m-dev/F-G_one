# FG One — System Architecture

FG One is Futurist Global's internal workspace. It combines Slack-style messaging, an employee dashboard, and HRMS features. It is built as a **single-company application today** with a **multi-tenant-ready core**, so it can later be offered as a white-label SaaS without a rewrite.

---

## 1. High-level architecture

```
                ┌──────────────────────────── Browser ────────────────────────────┐
                │ Next.js (React 19, Tailwind v4, Motion, TanStack Query, cmdk)    │
                │  • httpOnly session cookie (never readable by JS)                 │
                │  • Socket.IO client (same origin)                                 │
                └───────────────┬───────────────────────────────┬──────────────────┘
                                │ HTTPS  /api/*                  │ WSS  /socket.io/
                ┌───────────────▼───────────────────────────────▼──────────────────┐
                │ Next.js server (apps/web) — SSR shell, route gate, reverse proxy │
                └───────────────┬───────────────────────────────┬──────────────────┘
                                │                               │
                ┌───────────────▼───────────────────────────────▼──────────────────┐
                │ NestJS API (apps/api)                                             │
                │  Global guards: Throttler → SessionGuard (auth + RBAC)            │
                │  Middleware: Origin check (CSRF), Helmet, cookie-parser           │
                │  Modules: auth · employees · departments · roles · organization   │
                │           me (profile/status/prefs) · dashboard · chat · search    │
                │           audit · realtime gateway · mail                          │
                │  (next) attendance · leave · holidays · announcements · campaigns │
                │         documents · daily-updates · notifications · ai             │
                └──────┬───────────────────────┬──────────────────────┬────────────┘
                       │ Prisma                 │ SMTP                 │ (Phase 3+)
                ┌──────▼──────┐          ┌──────▼──────┐        ┌──────▼──────────┐
                │ PostgreSQL  │          │ Mail relay  │        │ S3-compatible   │
                │ (all data)  │          │ (Mailpit in │        │ storage (MinIO/ │
                └─────────────┘          │  dev)       │        │ AWS S3 / R2)    │
                                         └─────────────┘        └─────────────────┘
```

**Why this shape**

| Decision | Reason |
|---|---|
| Separate NestJS API instead of Next.js route handlers | Keeps the backend modular and testable, with server-side authorization that doesn't depend on the frontend. It can also be reused by mobile apps or integrations later. |
| Next.js proxies `/api` and `/socket.io` | The browser only talks to one origin. Session cookies stay first-party and `SameSite=Lax`, with no CORS and no tokens in JavaScript. In production a reverse proxy (Caddy or nginx) can route both paths directly instead. |
| Opaque server-side sessions, not JWT | Logout, deactivation and password reset revoke access immediately. Tokens are stored as SHA-256 hashes. |
| Zod contracts in `packages/shared` | One schema validates API input and powers web forms, so the two can't drift apart. |
| Socket.IO with server-assigned rooms | Clients never choose which rooms they join. The server joins them to `org:`, `user:` and `channel:` rooms after checking the session. |
| Prisma + plain PostgreSQL | Migrations are versioned in git, with no vendor lock-in. Any managed Postgres works. |

---

## 2. Multi-tenancy (SaaS-ready, single tenant today)

* Every company-owned table has an `organizationId` column (see `docs/DATABASE.md`).
* The tenant is derived **only** from the authenticated session (`session.organizationId`) and is never read from the request body, query or headers.
* Every service query filters by `auth.organizationId`. Any cross-entity reference, such as a manager, department, role or channel member, is checked against the same organization. A failed lookup returns 404 so other tenants' data doesn't leak even by existence.
* `session.organizationId` must equal `user.organizationId` (defence in depth).
* An automated test (`apps/api/test/app.e2e-spec.ts › tenant isolation`) runs a second organization (`Acme Test Co`) against Futurist Global data on every endpoint family.
* `DEFAULT_ORG_SLUG` selects the organization shown on the login screen. Future SaaS work will add a `domain → organization` lookup, tenant onboarding, subscription tables and optional Postgres row-level security as a second safety net. None of this changes existing tables.

**Prepared but not built yet:** tenant onboarding wizard, a tenant-admin console above Super Admin, billing/subscription (`Subscription`, `Plan`, `Invoice` tables), custom domains, and per-tenant storage buckets.

---

## 3. Authorization model

* **Permissions** are strings such as `employees.manage` (catalogue in `packages/shared/src/permissions.ts`).
* **Roles** are per-organization bundles of permissions with a numeric **rank**:

| Role | Rank | Highlights |
|---|---|---|
| Super Admin | 100 | Everything, including roles, settings, AI configuration |
| Admin / HR | 75 | People management, departments, announcements, holidays, analytics, audit, campaigns, documents |
| Manager | 50 | Team attendance/updates, leave approval, channel creation |
| Employee | 10 | Directory, chat, AI assistant |

* **Rank rules:** a user may only manage people whose rank is strictly lower than their own, and may only assign roles below their own rank. Super Admin is the exception. Nobody can change their own role or deactivate themselves.
* **Resource rules:** chat access requires channel membership. Public channels can be previewed and joined, while private channels and DMs return 404 to non-members. Message edits are author-only. Deletes are allowed for the author or a channel admin (moderation deletes are audited).
* `@RequirePermissions()` handles coarse checks. Services handle resource-level checks.

---

## 4. Module map and extensibility

Each feature is a self-contained slice:

```
packages/shared/src/<feature>.ts      zod contracts, enums, constants
apps/api/src/<feature>/               controller + service (+ gateway events)
apps/api/prisma/schema.prisma         models with organizationId
apps/web/src/app/(workspace)/<route>  pages
apps/web/src/components/<feature>/    UI
```

Cross-cutting hooks a new module plugs into:

* **Module toggle:** add a key to `MODULE_KEYS` (shared/settings.ts). It then appears in *Company settings → Modules* and can gate navigation and APIs.
* **Dashboard widget:** add a key to `WIDGET_KEYS` and register a component in `components/dashboard/widgets.tsx`. Ordering, show/hide and drag-and-drop work automatically.
* **Realtime:** emit through `RealtimeGateway.toUser / toChannel / emitPresence`.
* **Audit:** call `AuditService.log(auth, action, entityType, entityId, metadata)`.
* **Global search:** add a result group to `SearchController`. It must respect the caller's permissions.

---

## 5. AI architecture (Phase 5–6, designed now)

```
 web "Ask FG One" ─► POST /api/ai/ask ─► AiService
                                         ├─ PolicyGate: ai.use permission, module enabled, per-user/org quotas
                                         ├─ Retriever (permission-aware): calls existing domain services AS THE USER
                                         │     holidays · my attendance · my updates · announcements I can see ·
                                         │     documents I can read (pgvector embeddings, ACL-filtered)
                                         ├─ Redactor: strips data the caller cannot see; PII rules
                                         ├─ ProviderAdapter (interface) ─► Anthropic | OpenAI | Azure | local
                                         └─ UsageLedger: tokens, cost, latency, errors per org/user/feature
```

* **Provider-agnostic:** an `AiProvider` interface (`complete`, `embed`). API keys live encrypted in `AiProviderConfig` on the server and never reach the browser.
* **Permission-aware retrieval:** the model never queries the database directly. Tools call the same services the REST API uses, with the requesting user's `AuthContext`, so the AI can't see more than the user can.
* **Summaries** (individual, department and weekly digests) are stored in `AiSummary` with a status of `DRAFT → APPROVED → PUBLISHED`. Shared summaries require review and editing by an authorized person before publishing, and generation excludes private or restricted fields.
* **Monitoring:** an `AiUsage` row is written per call. Admins see cost and usage charts and can set monthly limits per organization or user. When a limit is hit, AI features are disabled gracefully.

---

## 6. Navigation structure

```
Sidebar (collapsible; drawer on mobile)
├─ Home                      personal dashboard (draggable widgets)
├─ Messages                  browse channels · unread badge
├─ People                    directory · profiles
├─ My profile                profile · appearance · password
├─ Administration            (visible per permission)
│   ├─ Overview              live analytics
│   ├─ Employees             invite · edit · deactivate · re-invite
│   ├─ Departments
│   ├─ Roles & access        permission matrix
│   ├─ Company settings      branding · modules · dashboard · policies · sign-in
│   └─ Audit log
├─ Channels                  # public / 🔒 private, unread counts, create, browse
└─ Direct messages           1:1 and group DMs with live presence

Top bar: ⌘K global search · + quick actions · status picker · theme · account menu
```

Planned additions slot into the same sidebar: Attendance, Daily updates, Leave & holidays, Announcements & noticeboard, Documents, Events, Polls, Tasks, Ask FG One.

---

## 7. User journeys

**Employee**
1. Receives an invitation link, sets a password (strength rules shown live), and lands on Home. They're auto-joined to #general and #announcements.
2. Sees a greeting, today's working hours, team availability, announcements, holidays, celebrations, recent chats and quick actions.
3. Sets a status (e.g. 🍽️ Lunch, clears in 1 hour). Colleagues see it instantly. Attendance isn't affected.
4. Chats in channels and DMs: reactions, threads, edits, typing indicators, unread counts.
5. Finds people through ⌘K or the directory, opens a profile and messages them. Customizes the dashboard by dragging widgets.

**Manager:** everything above, plus creating channels and groups and managing channel members and admins. Phase 2+ adds team attendance, daily updates and leave approvals.

**HR / Admin:** invites employees (domain-restricted, with a shareable link even without SMTP), assigns departments, managers and roles, deactivates leavers (all sessions end instantly), manages departments, monitors analytics and reviews the audit log.

**Super Admin:** everything above, plus company branding, colours, modules, dashboard defaults, attendance and leave policy, allowed domains and session length.

---

## 8. Roadmap

| Milestone | Scope | Status |
|---|---|---|
| **M1 Foundation + hybrid workspace** | Monorepo, schema & migrations, session auth, invites, reset, RBAC, tenant isolation, employee/department admin, company settings & branding, customizable dashboard, presence/status, real-time chat (channels, DMs, threads, reactions, edit/delete, typing, unread), ⌘K search, admin analytics, audit log, tests | ✅ **Done** |
| M2 Attendance & daily updates | Check-in/out with WFO/WFH/On-duty, correction requests, attendance dashboard & reports, structured daily updates, manager views, missing-update tracking | Next |
| M3 Files & notifications | S3 storage + signed URLs, chat attachments & image previews, pinned messages, notification centre + preferences, @mentions | |
| M4 HRMS & communication | Holiday admin, leave types/balances/approvals, team calendar, announcements with acknowledgement, campaigns & noticeboard carousel (targeting, scheduling, privacy-respecting analytics), documents library, recognition, events, polls | |
| M5 AI | Provider adapters, usage ledger, Ask FG One, daily/department/weekly summaries with review & publish | |
| M6 Polish & deploy | Advanced AI, custom roles UI, tasks, saved messages, accessibility audit, performance, security review, CI/CD, production deployment | |
