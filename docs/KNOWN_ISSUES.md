# Known Issues

| # | Severity | Issue | Plan |
|---|---|---|---|
| K-1 | ~~High~~ **Fixed** | The API image ran `npx prisma migrate deploy` without the Prisma CLI installed. | `prisma@6.19.3` moved to dependencies. Verified: the production bundle (`pnpm deploy --prod`) contains `prisma` 6.19.3. |
| K-2 | ~~High~~ **Fixed, verify on Render** | Behind the proxy the API saw one IP for everyone. | Configurable `TRUST_PROXY` (2 on Render), tested against spoofed headers. After deploy, confirm `/api/health` → `clientIp` is your own IP. |
| K-3 | **High (security)** | The Neon production branch holds seeded demo accounts with the seed password. | Reset the branch and run `db:bootstrap` **before** making the Render URL public |
| K-4 | Medium | Online presence is kept in API memory. It resets on restart or Render sleep and doesn't support more than one API instance. | Socket.IO Redis adapter when scaling |
| K-5 | Low | Admin "Online now" can read 0 for a few seconds after the admin's own socket connects (refreshes every 30s). | Push presence counts over the socket |
| K-6 | Low | Docker images are not build-tested in CI. | Add a GitHub Actions build job |
| K-7 | Low | Profile photos and logos are URLs, not uploads. | Phase 3 storage |
