# FG One — API Reference (Milestone 1)

Base URL: `/api` (same origin via the Next.js proxy, or `http://localhost:4000/api` directly).

* **Auth:** httpOnly `fg_session` cookie set by `POST /auth/login` or `POST /auth/accept-invitation`. Every endpoint requires it unless it's marked 🌐 public.
* **Errors:** `{ statusCode, message, issues?: [{ path, message }] }`. `400` is a validation error. `401` means no or expired session. `403` means missing permission or a cross-origin write. `404` means not found or not visible to you, including other tenants' data. `409` is a conflict. `429` means rate-limited.
* **Validation:** request bodies use the zod schemas in `packages/shared/src/schemas.ts`.
* **CSRF:** non-GET requests with an `Origin` header must come from `WEB_ORIGIN`.

## Auth
| Method | Path | Notes |
|---|---|---|
| 🌐 POST | `/auth/login` | `{ email, password }`. Limit 10/min. Locks for 15 min after 5 failures. Generic error message. |
| POST | `/auth/logout` | Deletes the server session |
| GET | `/auth/me` | `{ user, permissions, role, preferences, organization{branding, settings} }` |
| 🌐 POST | `/auth/forgot-password` | `{ email }`. Always returns 200 (no enumeration). Limit 5 per 15 min. |
| 🌐 POST | `/auth/reset-password` | `{ token, password }`. Single use, 30-min expiry. Signs out all sessions. |
| POST | `/auth/change-password` | `{ currentPassword, newPassword }`. Signs out other sessions. |
| 🌐 GET | `/auth/invitations/:token` | Validates an invite: `{ email, firstName, organization }` |
| 🌐 POST | `/auth/accept-invitation` | `{ token, password }`. Activates the account, auto-joins default channels and starts a session. |

## Me
| Method | Path | Body |
|---|---|---|
| PATCH | `/me/profile` | `updateProfileSchema` (names, bio, phone, pronouns, timezone, avatarUrl/Color, birthday, showBirthday) |
| PATCH | `/me/preferences` | `{ theme?, accent?, sidebarCollapsed?, dashboardWidgets? }` |
| PUT | `/me/status` | `{ presence, emoji?, text?, expiry: never\|30m\|1h\|4h\|today }`. Broadcasts `presence:updated`. |

## Employees
| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/employees?q&departmentId&status&page&pageSize` | `employees.read` | Non-admins only see ACTIVE users and no private fields |
| GET | `/employees/:id` | `employees.read` | Includes manager and direct reports |
| POST | `/employees` | `employees.manage` | `createEmployeeSchema`. Enforces the domain allow-list and role rank. Returns `{ employee, inviteUrl, inviteExpiresAt }`. |
| PATCH | `/employees/:id` | `employees.manage` | Rank rules. You can't change your own role. |
| POST | `/employees/:id/deactivate` | `employees.manage` | Revokes sessions and invitations and disconnects sockets |
| POST | `/employees/:id/activate` | `employees.manage` | |
| POST | `/employees/:id/invite` | `employees.manage` | Re-issues the invite and revokes earlier links |

## Departments · Roles · Organization
| Method | Path | Permission |
|---|---|---|
| GET | `/departments` | any |
| POST / PATCH / DELETE | `/departments[/:id]` | `departments.manage` |
| GET | `/roles` | any (`assignable` flag per role) |
| 🌐 GET | `/public/branding` | Login-page branding for `DEFAULT_ORG_SLUG` |
| GET | `/organization` | any |
| PATCH | `/organization` | `settings.manage`. `{ name?, logoUrl?, primaryColor?, secondaryColor?, settings?: deep-partial }`, deep-merged and re-validated. |

## Dashboard · Analytics · Search · Audit
| Method | Path | Permission |
|---|---|---|
| GET | `/dashboard` | any. Workday, team, announcements, holidays, celebrations, recent chats, unread total, org stats. |
| GET | `/admin/overview` | `analytics.view`. Status counts, departments, roles, 14-day message activity, 6-month joiners, recent audit. |
| GET | `/search?q=` | any. People, channels (public or member) and messages (member channels only). |
| GET | `/audit-logs?q&entityType&page` | `audit.read` |
| 🌐 GET | `/health` | DB connectivity |

## Chat
| Method | Path | Rules |
|---|---|---|
| GET | `/channels` | My channels and DMs with `unread`, `lastMessage`, participants |
| GET | `/channels/browse` | Public channels with `isMember` |
| POST | `/channels` | `channels.create`. `{ name, description?, visibility, memberIds[] }`. The creator becomes ADMIN. |
| POST | `/dm` | `{ userIds[] }` (1–8). Returns the existing DM for the same participant set if there is one. |
| GET | `/channels/:id` | Members and `canManage`. Private or DM channels return 404 to non-members. |
| PATCH | `/channels/:id` | Channel admin or `channels.manage` |
| POST | `/channels/:id/join` · `/leave` | Public only. Default channels can't be left. |
| POST | `/channels/:id/members` | Public: any member. Private: admins only. |
| DELETE | `/channels/:id/members/:userId` | Admin, or yourself. The last admin is protected. |
| PATCH | `/channels/:id/members/:userId` | `{ role }`. Admins only. |
| GET | `/channels/:id/messages?before&limit&parentId` | Cursor pagination (newest first per page) |
| POST | `/channels/:id/messages` | `{ body, parentId?, clientId? }`. Members only. |
| POST | `/channels/:id/read` | Marks the channel read |
| PATCH | `/messages/:id` | Author only |
| DELETE | `/messages/:id` | Author or channel admin (audited). Soft delete. |
| POST | `/messages/:id/reactions` | `{ emoji }` toggle |

## WebSocket (Socket.IO, path `/socket.io/`)
The session cookie is authenticated at handshake. The server assigns rooms: `org:<id>`, `user:<id>`, `channel:<id>`.

| Event (server → client) | Payload |
|---|---|
| `presence:online` | `{ userIds }` snapshot on connect |
| `presence:updated` | `{ userId, online?, presence?, statusEmoji?, statusText?, statusExpiresAt? }` |
| `message:new` / `message:updated` | `ChatMessage` |
| `channel:updated` / `channel:removed` | `{ channelId }` |
| `typing` | `{ channelId, userId, name, typing }` |

| Event (client → server) | Payload |
|---|---|
| `typing` | `{ channelId, typing }`. Ignored unless the socket is in that channel room. |
