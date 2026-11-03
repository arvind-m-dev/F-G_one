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
| My Work, Calendar, Attendance, Announcements page, Ideas, Knowledge Base, Notifications | ⬜ | Phases 4–7 |

## Admin portal (`/admin`)
| Module | Status |
|---|---|
| Overview | ✅ Team composition, invitations waiting (re-issue link), admin activity, conversation activity, roles, holidays, announcements |
| Employees | ✅ Invite (domain-restricted, copyable link), edit, role and manager, deactivate/reactivate, re-invite |
| Departments | ✅ CRUD, head, colour |
| Roles & permissions | 🟡 Read-only matrix. Editing is planned. |
| System settings | ✅ Branding, modules, home defaults, navigation, attendance and leave policy values, allowed domains, session length |
| Audit logs | ✅ Search and filter |
| Channel, attendance, leave, holiday, announcement and task management, reports | ⬜ |

## Platform
| Capability | Status |
|---|---|
| Session auth, invites, reset, lockout, CSRF origin check, rate limiting | ✅ (rate limiting needs the proxy fix before production) |
| Recent accounts on login (device-local) | ✅ |
| Organization isolation | ✅ tested |
| Realtime with reconnection | ✅ Socket.IO with automatic reconnect and an indicator in the rail |
| File storage, email notifications, notification inbox | ⬜ |
