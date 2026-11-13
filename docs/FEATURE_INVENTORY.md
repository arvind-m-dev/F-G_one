# Feature Inventory

✅ working and tested · 🟡 partial · ⬜ not built. Only working features appear in the UI.

## Employee portal (`/app`)
| Module | Status | Notes |
|---|---|---|
| Workspace Home | ✅ | Greeting (updates with the time of day, also when you return to an open tab) with personal summary, day timeline (company working hours), quick actions, needs-your-attention, editorial announcements, team pulse, holidays, celebrations, company snapshot. Customize: reorder, hide, restore. |
| Chat: channels, DMs, groups | ✅ | Public and private channels, 1:1 and group DMs, browse/join/leave, members and channel admins, rename/topic |
| Chat: messages | ✅ | Realtime delivery, threads, icon reactions, edit/delete with permissions, copy text/link, typing, unread (read only when seen, "New messages" line, jump to latest), infinite history, optimistic send with retry, per-conversation drafts, @mention autocomplete |
| Chat: rich composer, attachments, link previews, mute, pin/save, search filters | ⬜ | Phase 3 |
| Presence & custom status | ✅ | 13 icon presets, custom text, expiry, live updates |
| Directory & profiles | ✅ | List/grid, department filter, search, reporting line |
| My profile | ✅ | Name, display name, pronouns, phone, timezone, avatar colour/photo URL, birthday privacy, password change |
| Settings | ✅ | Theme, accent, text size, sidebar, density, Enter-to-send, time format |
| Security (Settings) | ✅ | Two-step verification (authenticator app, QR code, 10 recovery codes shown once, replace codes, turn off unless Super Admin), signed-in devices with sign out one or all others, confirm-it-is-you dialog for sensitive actions. Sign-in asks for the code when it is on. |
| Top bar | ✅ | Search, admin portal switch, notifications, theme and an account menu (name, email, role, status, profile, preferences, sign out). On phones: search, notifications and the account menu. |
| ⌘K command palette | ✅ | People, channels, messages, navigation, theme |
| Attendance | ✅ | Check in with Office/Home/Client site and a note, start/end breaks, check out (confirmed), live worked time and a day bar, late flag from policy, history with 7/30/90-day summary. Managers see their direct reports, HR/Admin see everyone. Times use the organization's time zone. Night shifts check out after midnight (the shift counts for the day it started). Company options: reminder or automatic check-in on opening FG One, checking in more than once a day (split shifts), and automatic check-out (hours after the workday, longest shift, minutes with no activity) with a notification and "Auto check-in/out" labels. |
| Announcements | ✅ | Editorial feed, categories, search, reader, "I've read this" confirmations, banner for pending confirmations |
| Notifications inbox | ✅ | Bell with unread count. DMs (grouped per conversation), @mentions, thread replies, announcements. Filters, mark read, per-type settings, live toasts. |
| Getting started checklist | ✅ | Real progress, dismissible |
| Leave | ✅ | Balances per type and leave year, request with live working-day count (weekends and holidays excluded, half days), overlap and balance checks, cancel, "Who's away" month calendar (colleagues see dates only, never reasons). Past dates are allowed (forgot to apply). HR can record leave on someone's behalf (approved straight away, notified). |
| Holidays | ✅ | Year view by month, next-holiday banner, categories: public, company, optional, special working day |
| Approvals | ✅ | For managers (direct reports) and HR: leave and attendance corrections, approve/decline with note, badge count |
| Attendance corrections | ✅ | "Fix a day" or per-day "Request correction"; applied in the organization's time zone when approved; status shown on the Attendance page |
| Work: projects and tasks | ✅ | `/app/work`. **My work**: your next two weeks as one plan lane (each open task on the days the planner gives it; work that will finish late is striped), workload meter, quick add, tasks grouped Late / Due today / This week / Later. **Board** (drag a card or use its status button), **Timeline** (planned bar per task against its due date), **Projects** (short code, lead, people, target date, progress; project page with board, list, timeline and team load). Task panel opened by `?task=`: status, owner, dates, size, priority, kind, details, links (pull requests), comments, history. Personal tasks are seen by their owner and the owner's manager. |
| Work: ask for more time | ✅ | The owner of a task cannot change a date someone else set. "Ask for more time" shows what the plan says (work due, days available, realistic finish date, colleagues with room) and sends a request to move the date or hand the task over. The project lead (else the manager, else company-wide planners) decides on the Approvals page; nothing changes until then. |
| Work: team load and daily report | ✅ | **Team load** (managers and project leads): each person's work against their working days for the next ten working days (weekends, holidays and approved leave removed), who will finish late, and proposals to even things out (hand unstarted work to someone with room, or the earliest date the plan can meet) applied with one click. **Daily report**: finished, started, overdue, likely late, by person, for any day, with "Copy as text". Rule-based, no AI key needed. |
| Work: GitHub sync (pull requests, issues), Gmail, AI assistant through an MCP connector | ⬜ | Planned. Tasks carry manual links to pull requests today. |
| Calendar, Ideas, Knowledge Base | ⬜ | Planned |

## Admin portal (`/admin`)
| Module | Status |
|---|---|
| Overview | ✅ Team composition, accounts waiting for a password, admin activity, conversation activity, roles, holidays, announcements |
| Employees | ✅ Add with a work email and a password (domain-restricted) and a copyable sign-in message; employee page with overview, employment and access, attendance, leave, devices and activity; change email, set a new password (shown once), sign out everywhere, suspend/lift, deactivate/reactivate, archive/restore, per-person Access (extra roles, allow/block exceptions, live preview). Four-step add-employee wizard. Passwords are never viewable. |
| Departments | ✅ CRUD, head, colour |
| Super Admins | ✅ List, limit, nominate (one-time link), withdraw, remove; nominee acceptance page with two-step verification check |
| Roles & permissions | 🟡 Read-only matrix. Editing is planned. |
| System settings | ✅ Branding, modules, home defaults, navigation, attendance and leave policy values, allowed domains, session length |
| Audit logs | ✅ Search and filter |
| Attendance monitoring | ✅ Live board by day, filters (office, home, client site, on a break, checked out, not checked in, on leave, late), CSV export of the last 30 days (formula-safe) |
| Announcements management | ✅ Publish, edit, delete, target a department, pin, expiry, ask for confirmation, see who has and hasn't confirmed |
| Leave management | ✅ All requests by status, decide, company calendar (including pending), leave types (allowance, paid, colour, hide) |
| Holiday management | ✅ Add, edit and remove with categories |
| Channel management, reports | ⬜ |

## Platform
| Capability | Status |
|---|---|
| Session auth, invites, reset, lockout, CSRF origin check, rate limiting | ✅ (rate limiting uses the real client IP via `TRUST_PROXY`; verify on Render) |
| Recent accounts on login (device-local) | ✅ |
| Organization isolation | ✅ tested |
| Permission engine (scoped grants, extra roles, ALLOW/DENY overrides, resolved per request) | ✅ backend only; the role editor UI arrives in Phase 4 |
| Super Admin authority (flag, limit 1–4, nominate/accept/remove, last-admin protection) | ✅ API and tests; the Super Admins page arrives in Phase 3. Employees list shows a Super Admin badge. |
| Admin device controls (list an employee's devices, sign them out everywhere) | ✅ Devices tab on the employee page. |
| Super Admin requires two-step verification | ✅ Authority is paused until it is on; Settings → Security explains this to the Super Admin. |
| Client accounts default-denied; suspended and archived statuses | ✅ enforced; client portal (5b) and suspend actions (3) not built |
| Realtime with reconnection | ✅ Socket.IO with automatic reconnect and an indicator in the rail |
| Work permission (`work.manage` at Team or Company reach; granted to Manager, Admin / HR and Administrator) and the `tasks` module switch | ✅ |
| File storage, email notifications | ⬜ |
