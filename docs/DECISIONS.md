# Decisions

| ID | Date | Decision | Why |
|---|---|---|---|
| D-1 | 2 Nov 2026 | Separate NestJS API + Next.js web, proxied on one origin | Server-side authorization, reusable API, first-party httpOnly session cookies |
| D-2 | 2 Nov 2026 | Opaque server sessions, not JWT | Instant revocation on logout, deactivation and reset |
| D-3 | 2 Nov 2026 | `organizationId` on all company data; tenant comes from the session only | SaaS-ready without a rewrite |
| D-4 | 3 Nov 2026 | Employee portal at `/app`, Admin portal at `/admin`, same services and permissions. Old routes 308-redirect. | PRD §3. A clear separation of everyday and administrative work. |
| D-5 | 3 Nov 2026 | No emojis in UI chrome. Presence and reactions use Lucide icons. Reactions are a fixed set validated by the API. | PRD §6.5. Consistent visuals and no arbitrary strings stored as reactions. Users can still type emoji in their own messages. |
| D-6 | 3 Nov 2026 | **Resolved by the Super Admin PRD:** dynamic roles with 10 editable templates. Super Admin becomes an authority flag (`User.isSuperAdmin`, max 4), not a role. Existing roles map to Administrator, HR Manager, Team Lead and Employee. To be implemented in Phases 2a, 2b and 4. | Roles must be manageable without code; Super Admin must not be assignable through role editing. See `SUPER_ADMIN_ARCHITECTURE.md`. |
| D-7 | 3 Nov 2026 | **Open:** object storage provider for attachments (Cloudflare R2, Backblaze B2, S3, or Neon object storage) | Render's disk is ephemeral (PRD §8.5, §23.1) |
| D-8 | 3 Nov 2026 | Geist as the UI typeface | PRD §6.4 option. Crisp at small sizes, with a matching mono. |
| D-9 | 3 Nov 2026 | Recent sign-in accounts are kept in `localStorage` (email, name, avatar colour only) | PRD §5.2: device-local, never passwords, removable |
| D-10 | 3 Nov 2026 | MFA uses TOTP plus hashed recovery codes. It is required for Super Admins, and the org can require it for others. | Works with any authenticator app and needs no SMS cost or vendor. WebAuthn can be added later. |
| D-11 | 3 Nov 2026 | Permissions are `module.action` in code and carry a data scope (OWN → ORG, CLIENT). Roles and grants are data. Explicit deny wins. | Scopes are enforced by one `AuthzService` that also filters lists, search and exports. |
| D-12 | 3 Nov 2026 | The client portal is at `/client` in the same app, using the same session auth and a separate shell. | One codebase and auth stack. Isolation is enforced by the API, not by the deployment. |
