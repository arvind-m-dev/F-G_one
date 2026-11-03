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
| ⌘K command palette | ✅ | People, channels, messages, navigation, theme |
| Attendance | ✅ | Check in with Office/Home/Client site and a note, start/end breaks, check out (confirmed), live worked time and a day bar, late flag from policy, history with 7/30/90-day summary. Managers see their direct reports, HR/Admin see everyone. Times use the organization's time zone. |
| Announcements | ✅ | Editorial feed, categories, search, reader, "I've read this" confirmations, banner for pending confirmations |
| Notifications inbox | ✅ | Bell with unread count. DMs (grouped per conversation), @mentions, thread replies, announcements. Filters, mark read, per-type settings, live toasts. |
| Getting started checklist | ✅ | Real progress, dismissible |
| My Work, Calendar, Leave, Ideas, Knowledge Base | ⬜ | Planned |

## Admin portal (`/admin`)
| Module | Status |
|---|---|
| Overview | ✅ Team composition, invitations waiting (re-issue link), admin activity, conversation activity, roles, holidays, announcements |
| Employees | ✅ Invite (domain-restricted, copyable link), edit, role and manager, deactivate/reactivate, re-invite |
| Departments | ✅ CRUD, head, colour |
| Roles & permissions | 🟡 Read-only matrix. Editing is planned. |
| System settings | ✅ Branding, modules, home defaults, navigation, attendance and leave policy values, allowed domains, session length |
| Audit logs | ✅ Search and filter |
| Attendance monitoring | ✅ Live board by day, filters (office, home, client site, on a break, checked out, not checked in, late), CSV export of the last 30 days (formula-safe) |
| Announcements management | ✅ Publish, edit, delete, target a department, pin, expiry, ask for confirmation, see who has and hasn't confirmed |
| Channel, leave, holiday and task management, reports | ⬜ |

## Platform
| Capability | Status |
|---|---|
| Session auth, invites, reset, lockout, CSRF origin check, rate limiting | ✅ (rate limiting uses the real client IP via `TRUST_PROXY`; verify on Render) |
| Recent accounts on login (device-local) | ✅ |
| Organization isolation | ✅ tested |
| Realtime with reconnection | ✅ Socket.IO with automatic reconnect and an indicator in the rail |
| File storage, email notifications, notification inbox | ⬜ |
