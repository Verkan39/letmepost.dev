# Multi-stage Dockerfile for `apps/api` in the letmepost.dev monorepo.
#
# Two services share this image on Railway, differing only by start command:
#   - api    → `pnpm --filter @letmepost/api start:api`     (migrate + serve)
#   - worker → `pnpm --filter @letmepost/api start:worker`  (BullMQ consumer)
#
# Stages:
#   1. base    — pnpm + Node, with corepack
#   2. deps    — fully populated node_modules across the workspace (cacheable)
#   3. build   — tsc-compiled `dist/` for @letmepost/api
#   4. runner  — slim runtime: prod node_modules + dist + drizzle migrations

# ─── 1. base ────────────────────────────────────────────────────────────────
FROM node:24-alpine AS base
RUN corepack enable
WORKDIR /app

# ─── 2. deps ────────────────────────────────────────────────────────────────
# Copy lockfile + every workspace package.json first so a source-only change
# doesn't bust the install cache.
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc* ./
COPY apps/api/package.json apps/api/
COPY packages/schemas/package.json packages/schemas/
COPY packages/config-tsconfig/package.json packages/config-tsconfig/
RUN pnpm install --frozen-lockfile

# ─── 3. build ───────────────────────────────────────────────────────────────
FROM deps AS build
COPY packages/config-tsconfig packages/config-tsconfig
COPY packages/schemas packages/schemas
COPY apps/api apps/api
RUN pnpm --filter @letmepost/api build

# ─── 4. runner ──────────────────────────────────────────────────────────────
FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000

# Workspace + lockfile + every package.json — needed so `pnpm --filter` works
# in CMD without re-resolving the universe.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc* ./
COPY apps/api/package.json apps/api/
COPY packages/schemas/package.json packages/schemas/
COPY packages/config-tsconfig/package.json packages/config-tsconfig/

# Production-only deps for @letmepost/api. `--prod=false` is needed because
# better-auth pulls in `kysely` as a peer that lives in devDependencies on
# the workspace root; pnpm prunes it otherwise. Tweak if image size matters.
RUN pnpm install --frozen-lockfile --prod

# Compiled output + the schemas source the API imports.
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/packages/schemas/src packages/schemas/src

# Migrations are read at runtime by `dist/db/migrate.js`.
COPY apps/api/drizzle apps/api/drizzle

EXPOSE 3000

# Default to the API process. The worker service overrides this in
# railway.json (start command field) — same image, different entrypoint.
CMD ["pnpm", "--filter", "@letmepost/api", "start:api"]
