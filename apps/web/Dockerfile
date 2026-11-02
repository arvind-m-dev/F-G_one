FROM node:22-alpine AS build
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile --filter @fg/web... \
 && pnpm --filter @fg/shared build \
 && pnpm --filter @fg/web build

FROM node:22-alpine
ENV NODE_ENV=production
COPY --from=build /repo /repo
WORKDIR /repo/apps/web
USER node
EXPOSE 3000
CMD ["node_modules/.bin/next", "start", "-p", "3000"]
