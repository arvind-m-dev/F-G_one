# Feature Inventory

✅ working and tested · 🟡 partial · ⬜ not built. Only working features appear in the UI.

## Employee portal (`/app`)
| Module | Status | Notes |
|---|---|---|
| Workspace Home | ✅ | Greeting with personal summary, day timeline (company working hours), quick actions, needs-your-attention, editorial announcements, team pulse, holidays, celebrations, company snapshot. Customize: reorder, hide, restore. |
| Chat: channels, DMs, groups | ✅ | Public and private channels, 1:1 and group DMs, browse/join/leave, members and channel admins, rename/topic |
| Chat: messages | ✅ | Realtime delivery, threads, icon reactions, edit/delete with permissions, copy text/link, typing, unread, infinite history, optimistic send |
| Chat: rich composer, attachments, link previews, mentions autocomplete, pin/save, search filters | ⬜ | Phase 3 |
| Presence & custom status | ✅ | 13 icon presets, custom text, expiry, live updates |
| Directory & profiles | ✅ | List/grid, department filter, search, reporting line |
| My profile | ✅ | Name, display name, pronouns, phone, timezone, avatar colour/photo URL, birthday privacy, password change |
| Settings | ✅ | Theme, accent, text size, sidebar, density, Enter-to-send, time format |
| Security (Settings) | ✅ | Two-step verification (authenticator app, QR code, 10 recovery codes shown once, replace codes, turn off unless Super Admin), signed-in devices with sign out one or all others, confirm-it-is-you dialog for sensitive actions. Sign-in asks for the code when it is on. |
| ⌘K command palette | ✅ | People, channels, messages, navigation, theme |
| Attendance | ✅ | Check in with Office/Home/Client site and a note, start/end breaks, check out (confirmed), live worked time and a day bar, late flag from policy, history with 7/30/90-day summary. Managers see their direct reports, HR/Admin see everyone. Times use the organization's time zone. |
| Announcements | ✅ | Editorial feed, categories, search, reader, "I've read this" confirmations, banner for pending confirmations |
| Notifications inbox | ✅ | Bell with unread count. DMs (grouped per conversation), @mentions, thread replies, announcements. Filters, mark read, per-type settings, live toasts. |
| Getting started checklist | ✅ | Real progress, dismissible |
| Leave | ✅ | Balances per type and leave year, request with live working-day count (weekends and holidays excluded, half days), overlap and balance checks, cancel, "Who's away" month calendar (colleagues see dates only, never reasons) |
| Holidays | ✅ | Year view by month, next-holiday banner, categories: public, company, optional, special working day |
| Approvals | ✅ | For managers (direct reports) and HR: leave and attendance corrections, approve/decline with note, badge count |
| Attendance corrections | ✅ | "Fix a day" or per-day "Request correction"; applied in the organization's time zone when approved; status shown on the Attendance page |
| My Work, Calendar, Ideas, Knowledge Base | ⬜ | Planned |

## Admin portal (`/admin`)
| Module | Status |
|---|---|
| Overview | ✅ Team composition, invitations waiting (re-issue link), admin activity, conversation activity, roles, holidays, announcements |
| Employees | ✅ Invite (domain-restricted, copyable link), edit, role and manager, deactivate/reactivate, re-invite |
| Departments | ✅ CRUD, head, colour |
| Roles & permissions | 🟡 Read-only matrix. Editing is planned. |
| System settings | ✅ Branding, modules, home defaults, navigation, attendance and leave policy values, allowed domains, session length |
| Audit logs | ✅ Search and filter |
| Attendance monitoring | ✅ Live board by day, filters (office, home, client site, on a break, checked out, not checked in, on leave, late), CSV export of the last 30 days (formula-safe) |
| Announcements management | ✅ Publish, edit, delete, target a department, pin, expiry, ask for confirmation, see who has and hasn't confirmed |
| Leave management | ✅ All requests by status, decide, company calendar (including pending), leave types (allowance, paid, colour, hide) |
| Holiday management | ✅ Add, edit and remove with categories |
| Channel and task management, reports | ⬜ |

## Platform
| Capability | Status |
|---|---|
| Session auth, invites, reset, lockout, CSRF origin check, rate limiting | ✅ (rate limiting uses the real client IP via `TRUST_PROXY`; verify on Render) |
| Recent accounts on login (device-local) | ✅ |
| Organization isolation | ✅ tested |
| Permission engine (scoped grants, extra roles, ALLOW/DENY overrides, resolved per request) | ✅ backend only; the role editor UI arrives in Phase 4 |
| Super Admin authority (flag, limit 1–4, nominate/accept/remove, last-admin protection) | ✅ API and tests; the Super Admins page arrives in Phase 3. Employees list shows a Super Admin badge. |
| Admin device controls (list an employee's devices, sign them out everywhere) | ✅ API and tests; the buttons arrive with the Phase 3 user management screens. |
| Super Admin requires two-step verification | ✅ Authority is paused until it is on; Settings → Security explains this to the Super Admin. |
| Client accounts default-denied; suspended and archived statuses | ✅ enforced; client portal (5b) and suspend actions (3) not built |
| Realtime with reconnection | ✅ Socket.IO with automatic reconnect and an indicator in the rail |
| File storage, email notifications, notification inbox | ⬜ |
