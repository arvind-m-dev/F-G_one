# Known Issues

| # | Severity | Issue | Plan |
|---|---|---|---|
| K-1 | **High (deploy blocker)** | The API Docker image runs `npx prisma migrate deploy`, but the Prisma CLI is a dev dependency and isn't in the production image. `npx` would then download the latest Prisma (v8 pre-release) at boot. | Move `prisma@6.19.3` to dependencies before the Render go-live |
| K-2 | **High** | Behind the Next.js proxy the API sees the proxy's IP, so the login limit (10/min) and the global limit (300/min) are shared by the whole company. | Rate-limit on the forwarded client IP from the trusted proxy |
| K-3 | **High (security)** | The Neon production branch holds seeded demo accounts with the seed password. | Reset the branch and run `db:bootstrap` **before** making the Render URL public |
| K-4 | Medium | Online presence is kept in API memory. It resets on restart or Render sleep and doesn't support more than one API instance. | Socket.IO Redis adapter when scaling |
| K-5 | Low | Admin "Online now" can read 0 for a few seconds after the admin's own socket connects (refreshes every 30s). | Push presence counts over the socket |
| K-6 | Low | Docker images are not build-tested in CI. | Add a GitHub Actions build job |
| K-7 | Low | Profile photos and logos are URLs, not uploads. | Phase 3 storage |
