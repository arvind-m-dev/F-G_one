# UX, Navigation & Performance

This covers how FG One handles loading, refreshes, navigation and plain-language help, what's implemented, and what's planned.

## 1. Loading & fetching

| Topic | How it works | Status |
|---|---|---|
| First load after sign-in | One `/auth/me` call loads the user, permissions and branding. Pages then fetch in parallel. Skeletons match each page's layout. | ✅ |
| Refresh (F5) | Recently fetched data is kept in **sessionStorage** (this tab only) and shown immediately, then refreshed in the background. Restored queries are marked stale so nothing old lingers. | ✅ |
| What is cached | `me`, dashboard, channels, messages, departments, roles, today's attendance, announcements, notifications. Search results and admin exports are never cached. | ✅ |
| Privacy | The cache is cleared on sign-out and when a session expires (401), and it's busted on breaking API changes (`CACHE_BUSTER`). | ✅ |
| Live updates | Socket.IO pushes messages, reactions, typing, presence, attendance changes, announcements and notifications. When the socket reconnects (for example after the server sleeps) it re-fetches channels, messages, notifications and attendance. | ✅ |
| Polling | Only light safety nets: dashboard 60s, attendance 60s, admin overview 30s, unread count 120s. | ✅ |
| Optimistic UI | Chat messages and preference saves update instantly. **Attendance updates only after the server confirms** (PRD §11.3). | ✅ |
| Route prefetch | Next.js prefetches linked pages in production. | ✅ |

### Measured (production build, local machine)
| Action | Time to content |
|---|---|
| Refresh Home with cached data | ~390 ms |
| Refresh Home with no cache | ~480 ms |
| Home → Chat list | ~140 ms |
| Open a channel (messages visible) | ~430 ms |
| Go to Attendance | ~110 ms |
| Go to Directory | ~380 ms |
| Open a deep link with filters | ~260 ms |

API (server-side, median): `/auth/me` 12 ms · `/dashboard` 43 ms · `/channels` 24 ms · `/attendance/today` 18 ms · `/attendance/board` 20 ms · `/announcements` 19 ms · `/notifications` 11 ms.

> On **Render free + Neon**, expect a 30–60 s first load after 15 idle minutes (service sleep) and about 50–150 ms extra per API call (network and Neon wake-up). Render Starter removes the sleep. See `DEPLOY_RENDER_NEON.md`.

## 2. Refresh keeps your place
State that matters lives in the **URL**, so it survives a refresh, works with Back/Forward and can be shared:

| Page | URL keeps |
|---|---|
| Chat | Open thread `?thread=`, details panel `?panel=details` |
| Directory | Search `?q=`, department `?dept=`, layout `?view=grid`, page |
| Attendance | Tab `?tab=team`, history period `?range=` |
| Team / admin attendance | Date `?date=`, filter `?show=`, person search `?q=` |
| Announcements | Category, search, open announcement `?open=` |
| Admin › Employees | Search, status, department, page, and `?invite=1` opens the invite form |
| Admin › Announcements | `?compose=1` opens the editor |

Per-user preferences (theme, sidebar, density, Home layout) are saved to the account. Remembered sign-in emails stay on the device.

## 3. Navigation
* **Two portals:** Employee (`/app`) and Admin (`/admin`), switchable from the workspace menu and the rail.
* **Breadcrumbs** on nested pages: Admin portal › page, Directory › person.
* **Browser tab titles** on every page, e.g. "Attendance · FG One". Home shows the unread count: "(3) Home · FG One".
* **Mobile:** bottom tabs (Home, Chat, Attendance, Directory, Me). Chat uses one screen at a time with a back button. The menu drawer holds everything else.
* **Tablet (768–1099px):** the rail is automatically icon-only.
* **Keyboard:** ⌘/Ctrl+K opens search and actions (check in, announcements, settings and more).
* **Not found** and **error** pages explain what happened and offer a way back.
* **Old links** (`/home`, `/chat`, …) redirect to the new portal routes.

## 4. Understandable for everyone
* Plain-language labels ("Check in", "Client site", "Ask people to confirm they read it"), not technical terms.
* **"?" hints** (`InfoHint`) explain concepts in place, for example status vs attendance.
* **Getting started checklist** on Home, built from real progress (checked in, status set, first message, profile). It can be dismissed and brought back from Settings → Help.
* **Empty states** say what will appear and what to do next.
* Confirmations for anything that can't be undone (check-out, delete, deactivate).
* Toasts confirm every action. Errors explain what to try next.

## 5. Planned
| Item | Why |
|---|---|
| "What's new" panel after updates | Help non-technical users discover features |
| Guided first-run tour (optional) | Point out the rail, status and check-in |
| Per-page help drawer | Short how-tos without leaving the page |
| Offline banner | Clear message when the network drops (realtime already reconnects) |
| Lighthouse budget in CI | Catch regressions in bundle size and load time |
| Image optimisation for uploads | Once file storage (D-7) is chosen |
