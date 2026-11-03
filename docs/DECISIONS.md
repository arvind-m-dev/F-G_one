# Decisions

| ID | Date | Decision | Why |
|---|---|---|---|
| D-1 | 2 Nov 2026 | Separate NestJS API + Next.js web, proxied on one origin | Server-side authorization, reusable API, first-party httpOnly session cookies |
| D-2 | 2 Nov 2026 | Opaque server sessions, not JWT | Instant revocation on logout, deactivation and reset |
| D-3 | 2 Nov 2026 | `organizationId` on all company data; tenant comes from the session only | SaaS-ready without a rewrite |
| D-4 | 3 Nov 2026 | Employee portal at `/app`, Admin portal at `/admin`, same services and permissions. Old routes 308-redirect. | PRD §3. A clear separation of everyday and administrative work. |
| D-5 | 3 Nov 2026 | No emojis in UI chrome. Presence and reactions use Lucide icons. Reactions are a fixed set validated by the API. | PRD §6.5. Consistent visuals and no arbitrary strings stored as reactions. Users can still type emoji in their own messages. |
| D-6 | 3 Nov 2026 | **Open:** the PRD's roles (CEO, Admin, Developer, QA, Employee) vs the current roles (Super Admin, Admin/HR, Manager, Employee). Current roles kept until decided. | Permissions are already data-driven (`Role.permissions`), so new roles are a seed and migration change, not a code rewrite. |
| D-7 | 3 Nov 2026 | **Open:** object storage provider for attachments (Cloudflare R2, Backblaze B2, S3, or Neon object storage) | Render's disk is ephemeral (PRD §8.5, §23.1) |
| D-8 | 3 Nov 2026 | Geist as the UI typeface | PRD §6.4 option. Crisp at small sizes, with a matching mono. |
| D-9 | 3 Nov 2026 | Recent sign-in accounts are kept in `localStorage` (email, name, avatar colour only) | PRD §5.2: device-local, never passwords, removable |
