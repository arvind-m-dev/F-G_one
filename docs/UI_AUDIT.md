# UI Audit (Phase 0)

Audit of the FG One codebase at commit `744da39` (Milestone 1), done before the UI redesign. It describes what existed, what the PRD v3.0 asks for, and what was changed.

## Repository at audit time
| Area | Finding |
|---|---|
| Structure | pnpm monorepo: `apps/web` (Next.js 15, React 19, Tailwind v4), `apps/api` (NestJS 11, Prisma 6, Socket.IO), `packages/shared` (zod contracts). |
| Routes | One workspace route group: `/home`, `/chat`, `/chat/[id]`, `/people`, `/people/[id]`, `/profile`, `/admin/*`. Admin pages lived inside the employee shell. |
| Auth UI | Split-screen login with a gradient marketing panel, plus forgot/reset/invite pages. Single-step email+password form. |
| Shell | Single sidebar mixing navigation, admin links, channels and DMs. A top bar held search, quick actions, status, theme and the account menu. |
| Home | Grid of nine boxed widget cards (welcome banner, clock, team, announcements, holidays, celebrations, recent chats, quick actions, stats), with drag-and-drop. |
| Chat | Sidebar channel list + conversation with threads, reactions, edit/delete, typing, unread counts. No dedicated conversation list with previews. |
| Admin | "Four stat cards + charts + table" overview, a table for employees, card grids for departments and roles. |
| Design | Indigo/sky brand, Inter + Plus Jakarta Sans, gradient-heavy cards, **emojis** for presence, reactions and celebrations. |
| Backend | Real APIs for everything shown. No attendance, tasks, calendar, files, notifications, ideas, knowledge base or announcement management yet. |
| Hosting | Render blueprint plus a Neon database (added by the team). |

## Gaps against PRD v3.0
| PRD requirement | Status before | Action in this pass |
|---|---|---|
| §2 Original visual identity, no generic dashboard | Template-like cards and stat rows | **Redesigned**: new layering model, typography and per-page compositions |
| §3 Separate Employee `/app` and Admin `/admin` portals | One mixed shell | **Done**: two portals sharing services, legacy routes redirect |
| §5.2 Recent email selection (device-local) | Missing | **Done**: two-step login with saved accounts and removal |
| §6 Design tokens, Geist/Inter, Lucide only, no emojis | Partial | **Done**: tokens per PRD, Geist, emojis removed from UI, presence and reactions |
| §6.3 Accent colours, light/dark/system | Partial | **Done**: approved accent palette, independent dark surfaces |
| §7 Workspace Home composition and customization | Card grid | **Redesigned**: greeting, day timeline, attention list, editorial announcements, team pulse; customize drawer with restore |
| §8.2 Three-area chat layout, mobile single view | Two areas | **Done**: rail, conversation list with previews, conversation, thread and details panels |
| §8.7 Contextual message actions | Partial | **Improved**: copy text, copy link, edit, delete, reactions, reply in a hover toolbar |
| §8.9 Icon-based reactions | Emojis | **Done**: fixed icon set, enforced by the API |
| §8.10 Presence and custom status | Emoji presets | **Done**: icon presets, suggestions, expiry |
| §8.12 / §18.1 Personal settings | Theme only | **Done**: theme, accent, text size, sidebar, density, Enter-to-send, time format |
| §17 Admin portal composition | Template overview | **Redesigned** overview: team composition, invitations waiting, admin activity, roles, holidays |
| §8.3–8.6, 8.8, 8.11, 9–16 | Not built | Planned (see `IMPLEMENTATION_PLAN.md`) |
| §4 Roles CEO / Developer / QA | Super Admin, Admin/HR, Manager, Employee | **Open decision**, see `DECISIONS.md` D-6 |

## Technical limitations noted
* Presence and online counts live in memory, so they reset on API restarts (Render free tier sleeps).
* No persistent file storage yet. Attachments need S3-compatible storage before files can be shared.
* Two production fixes are still pending: the Prisma CLI is missing from the API image, and the rate limiter sees the proxy's IP (see `KNOWN_ISSUES.md`).
