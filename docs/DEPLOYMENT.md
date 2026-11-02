# FG One — Deployment, Configuration & Backups

## Components
| Service | Image / runtime | Port |
|---|---|---|
| `web` | Node 22, `next start` | 3000 |
| `api` | Node 22, `node dist/main.js` | 4000 (HTTP + WebSocket) |
| `postgres` | PostgreSQL 16 | 5432 |
| `mail` (dev) | Mailpit | 1025 SMTP / 8025 UI |
| `storage` (from M3) | MinIO or any S3-compatible service | 9000 |

Put a TLS reverse proxy (Caddy, nginx or a cloud load balancer) in front:

```
https://one.futuristglobal.com/            → web:3000
https://one.futuristglobal.com/api/*       → api:4000   (optional: or let Next proxy it)
https://one.futuristglobal.com/socket.io/* → api:4000   (WebSocket upgrade enabled)
```

## Environment variables

### `apps/api/.env`
| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `WEB_ORIGIN` | ✅ | Public web URL. Used in email links, CORS and the CSRF origin check. |
| `PORT` | | Default 4000 |
| `NODE_ENV` | | `production` in prod (enables strict rate limits; the seed script refuses to run) |
| `DEFAULT_ORG_SLUG` | | Organization served in single-company mode (`futurist-global`) |
| `SESSION_COOKIE_NAME` | | Default `fg_session` |
| `COOKIE_SECURE` | prod ✅ | `true` behind HTTPS |
| `SMTP_URL` | prod ✅ | e.g. `smtp://user:pass@smtp.office365.com:587`. When empty, emails are logged to the console (dev only). |
| `MAIL_FROM` | | Sender address |
| `SEED_PASSWORD` | dev | Password for seeded demo users |

### `apps/web/.env.local`
| Variable | Description |
|---|---|
| `API_URL` | Server-side proxy target, e.g. `http://api:4000`. Never exposed to the browser. |

No secrets are bundled into frontend code. `.env` files are git-ignored, and `.env.example` documents the keys.

## Local development

```bash
docker compose up -d postgres mailpit
```

```bash
pnpm install
```

```bash
cp apps/api/.env.example apps/api/.env && cp apps/web/.env.example apps/web/.env.local
```

Edit `apps/api/.env`: set `DATABASE_URL`, `SEED_PASSWORD` and `SMTP_URL=smtp://localhost:1025`. Then:

```bash
pnpm --filter @fg/shared build && pnpm db:migrate && pnpm db:seed
```

```bash
pnpm dev
```

## Production build

```bash
pnpm install --frozen-lockfile && pnpm build
```

```bash
pnpm --filter @fg/api prisma:deploy
```

```bash
docker compose -f docker-compose.yml --profile app up -d --build
```

> The Dockerfiles and `app` compose profile are provided but have **not yet been build-tested**; Docker was unavailable in the development sandbox. Verify them in CI before relying on them.

**Hosted option:** for a free-tier deployment on Render + Neon, see [DEPLOY_RENDER_NEON.md](DEPLOY_RENDER_NEON.md).

## Scaling notes
* The API is stateless except for Socket.IO presence counts. For more than one API instance, add `@socket.io/redis-adapter` and move the online-user registry to Redis, and enable sticky sessions or WebSocket-only transport at the load balancer.
* Sessions live in Postgres. A cleanup job for expired rows (`DELETE FROM "Session" WHERE "expiresAt" < now()`) runs fine as a daily cron.

## Backups
* **Nightly logical backup:**
  ```bash
  pg_dump --format=custom --no-owner "$DATABASE_URL" > fgone-$(date +%F).dump
  ```
  Keep 7 daily, 4 weekly and 12 monthly copies in a separate, encrypted bucket.
* **Point-in-time recovery:** enable WAL archiving or your managed provider's PITR (RDS, Cloud SQL, Neon, Supabase).
* **Restore drill (do it quarterly):**
  ```bash
  pg_restore --clean --no-owner -d "$RESTORE_URL" fgone-YYYY-MM-DD.dump
  ```
* **File storage (M3+):** enable bucket versioning and cross-region replication.

## Security checklist for go-live
- [ ] `COOKIE_SECURE=true`, HTTPS only, HSTS at the proxy
- [ ] `SMTP_URL` set. Invite links in admin UI responses remain the authorized fallback.
- [ ] Rotate the Postgres password. The DB isn't publicly reachable.
- [ ] Remove demo data and run no seed in prod. Create the first Super Admin with `pnpm --filter @fg/api db:bootstrap` (see `apps/api/prisma/bootstrap.ts`).
- [ ] Back up and test a restore
- [ ] Rate limits verified at the proxy as well as in the app
