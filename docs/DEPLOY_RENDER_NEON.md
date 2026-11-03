# Deploying FG One on Render + Neon

This guide puts FG One online using free tiers: **Neon** for PostgreSQL, **Render** for the API and web app (two Docker services from [`render.yaml`](../render.yaml)), and **Resend** (or any SMTP provider) for email.

```
Browser ──HTTPS──► fg-one-web (Render, Next.js) ──/api, /socket.io──► fg-one-api (Render, NestJS) ──► Neon Postgres
                                                                              └──SMTP──► Resend
```

The browser only talks to `fg-one-web`, which proxies `/api` and `/socket.io` to the API. Session cookies therefore stay first-party, exactly as in local development.

> **Why not Vercel?** The API is a long-running NestJS process with Socket.IO, which Vercel's serverless functions can't host, and Vercel rewrites don't proxy WebSockets. Keeping both apps on Render avoids both problems.

---

## 1. Create the database (Neon)

1. Sign up at [neon.tech](https://neon.tech) and create a project:
   * **Name:** `fg-one`
   * **Postgres version:** 16
   * **Region:** pick the one closest to your users, and use the matching Render region (`render.yaml` defaults to `singapore`, which pairs with Neon's AWS `ap-southeast-1`).
2. Create a database named `fgone` (or keep `neondb`).
3. Open **Connect**, switch **Connection pooling off**, and copy the connection string. It looks like:

   ```
   postgresql://USER:PASSWORD@ep-xxxx.ap-southeast-1.aws.neon.tech/fgone?sslmode=require
   ```

   Use the **direct (non-pooled)** string. The API runs `prisma migrate deploy` on every start, and Prisma migrations need a direct connection. A single API instance stays well within Neon's direct connection limit.

Keep this string private; it is the `DATABASE_URL` for the next steps.

---

## 2. Set up email (Resend)

Invitations and password resets are sent by email. Without SMTP the API only logs emails, but admins can still copy invite links from the admin UI.

1. Sign up at [resend.com](https://resend.com) (free: 3,000 emails/month, 100/day).
2. **Domains → Add domain:** add `futuristglobal.com` and create the DNS records it shows (SPF/MX and DKIM; DMARC recommended). Wait until the domain shows **Verified**. Unverified domains can't send, and missing DMARC sends mail to spam.
3. **API Keys → Create API key** with **Sending access**, restricted to that domain. Your `SMTP_URL` is:

   ```
   smtp://resend:RESEND_API_KEY@smtp.resend.com:587
   ```

   The username is literally `resend`. The sender (`MAIL_FROM`, default `no-reply@futuristglobal.com`) must be on the verified domain.

Microsoft 365 or any other SMTP provider works the same way; only `SMTP_URL` changes. If you invite more than 100 people on one day, invite in batches or copy the invite links from the admin UI.

---

## 3. Deploy on Render

1. Push this repository to GitHub (or GitLab).
2. In [Render](https://dashboard.render.com): **New → Blueprint**, select the repository. Render reads `render.yaml` and proposes two services: `fg-one-api` and `fg-one-web`.
3. Fill in the values it asks for:

   | Service | Variable | Value |
   |---|---|---|
   | fg-one-api | `DATABASE_URL` | Neon direct connection string from step 1 |
   | fg-one-api | `WEB_ORIGIN` | `https://fg-one-web.onrender.com` |
   | fg-one-api | `SMTP_URL` | From step 2 (leave empty to skip email for now) |
   | fg-one-web | `API_URL` | `https://fg-one-api.onrender.com` |

   Render usually gives each service the URL `https://<service-name>.onrender.com`. If a name is taken, Render adds a suffix. After the first deploy, check the real URLs on each service page, correct `WEB_ORIGIN` and `API_URL` if needed, and **redeploy both services**. The web service needs a rebuild because `API_URL` is baked into the Next.js build.

4. Wait for both deploys to go green. On start, the API applies all database migrations.
5. Check the API at `https://fg-one-api.onrender.com/api/health`. It should return `{"status":"ok",...}`.

---

## 4. Create the organization and first Super Admin

Production never uses the demo seed. Instead, run the bootstrap script **once from your own machine** against Neon (the production image doesn't include the TypeScript tooling):

```bash
pnpm install && pnpm --filter @fg/shared build
```

```bash
DATABASE_URL='postgresql://...neon.tech/fgone?sslmode=require' \
WEB_ORIGIN=https://fg-one-web.onrender.com \
ORG_NAME="Futurist Global" ORG_SLUG=futurist-global ORG_DOMAIN=futuristglobal.com \
ADMIN_EMAIL=it@futuristglobal.com ADMIN_FIRST=IT ADMIN_LAST=Admin \
pnpm --filter @fg/api db:bootstrap
```

It creates the organization, the system roles, `#general` and `#announcements`, the default leave types (Casual 12, Sick 8, Earned 15, Unpaid), and an invited Super Admin, then prints a **one-time invitation link**. Open it, set a password, and you're in. Invite everyone else from **Administration → Employees**.

`ORG_SLUG` must match `DEFAULT_ORG_SLUG` on the API (`futurist-global` by default).

### If the database already holds demo data
`db:bootstrap` refuses to touch an existing organization. To remove seeded demo accounts first, use the **reset** script. It deletes the organization and everything in it, then runs the bootstrap.

1. **Back up first:**

   ```bash
   pg_dump --format=custom --no-owner "$DATABASE_URL" > before-reset.dump
   ```

2. **Dry run:** shows the database host and what would be deleted, and changes nothing.

   ```bash
   DATABASE_URL='postgresql://...neon.tech/fgone?sslmode=require' ORG_SLUG=futurist-global pnpm --filter @fg/api db:reset-org
   ```

3. **Real run:** add `CONFIRM_RESET` with the same slug, plus the bootstrap values from above.

   ```bash
   DATABASE_URL='postgresql://...neon.tech/fgone?sslmode=require' ORG_SLUG=futurist-global CONFIRM_RESET=futurist-global \
   ORG_NAME="Futurist Global" ORG_DOMAIN=futuristglobal.com ADMIN_EMAIL=it@futuristglobal.com ADMIN_FIRST=IT ADMIN_LAST=Admin \
   WEB_ORIGIN=https://fg-one-web.onrender.com pnpm --filter @fg/api db:reset-org
   ```

Do this **before** sharing the public URL. The demo accounts share one known password.

---

## 5. Smoke test

- [ ] `/login` loads and shows the company name
- [ ] Sign in with the Super Admin account
- [ ] Invite a test employee; the email arrives (or copy the link from the admin UI)
- [ ] Open chat in two browsers: messages, typing indicators and status changes appear live
- [ ] Sign out, then use **Forgot password** and receive the reset email
- [ ] Open `https://<fg-one-web>/api/health` and check that `clientIp` is **your own public IP** (compare with any "what is my IP" site). If it shows a Render address instead, see the rate-limiting section below.

---

## Free-tier limits

| Limit | Effect | Fix |
|---|---|---|
| Render free services sleep after 15 minutes without traffic | First visit after a pause takes about 30–60 seconds. Open sockets disconnect while asleep. | Render **Starter** ($7/month per service) never sleeps. |
| Render free build machines have limited memory | `next build` can run out of memory. | Retry, or move `fg-one-web` to Starter. |
| Neon free scales to zero when idle | First query after a pause takes about a second. | Fine for this app. Neon **Launch** removes it and adds longer point-in-time restore. |
| Neon free has a short restore window | Not a real backup. | Add the nightly `pg_dump` from [DEPLOYMENT.md](DEPLOYMENT.md#backups). |
| One API instance only | Presence is tracked in memory. | Add the Redis adapter before scaling out (see [DEPLOYMENT.md](DEPLOYMENT.md#scaling-notes)). |

## Rate limiting behind the proxy

Requests reach the API as browser → Render edge → `fg-one-web` (Next.js) → Render edge → `fg-one-api`. The Next.js proxy passes `X-Forwarded-For` through unchanged (verified locally), so the API trusts **two** proxy hops. `render.yaml` sets `TRUST_PROXY=2`, which makes the API use the real visitor IP for rate limits and audit logs.

Check it with the `clientIp` step in the smoke test:

| `clientIp` shows | Meaning | Fix |
|---|---|---|
| Your public IP | Correct | — |
| A Render or private address | Too few hops trusted, so everyone shares one rate-limit bucket | Raise `TRUST_PROXY` by 1 on `fg-one-api` and redeploy |
| An address you can choose by sending your own `X-Forwarded-For` header | Too many hops trusted (spoofable) | Lower `TRUST_PROXY` by 1 |

## Going to production

1. Move both services to **Starter** so they never sleep.
2. Add a custom domain (e.g. `one.futuristglobal.com`) to `fg-one-web`, then set `WEB_ORIGIN` to it and redeploy the API.
3. With paid services, the web service can reach the API over Render's private network. Set `API_URL=http://fg-one-api:4000` and redeploy the web service. The API then no longer needs to be reached publicly.
4. Work through the go-live checklist in [DEPLOYMENT.md](DEPLOYMENT.md#security-checklist-for-go-live).
