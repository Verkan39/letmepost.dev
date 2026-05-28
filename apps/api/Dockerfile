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
COPY apps/mcp/package.json apps/mcp/
COPY packages/schemas/package.json packages/schemas/
COPY packages/config-tsconfig/package.json packages/config-tsconfig/
RUN pnpm install --frozen-lockfile

# ─── 3. build ───────────────────────────────────────────────────────────────
FROM deps AS build
# turbo.json lives at the repo root and declares `build` with
# `dependsOn: ["^build"]` — so building the API also builds @letmepost/schemas
# (which it imports at runtime as compiled dist/, not TS source) and
# @letmepost/mcp (the api's /mcp route imports the autogen tool surface
# from there at runtime).
COPY turbo.json ./
COPY packages/config-tsconfig packages/config-tsconfig
COPY packages/schemas packages/schemas
COPY apps/mcp apps/mcp
COPY apps/api apps/api
# The api's prebuild hook reads the canonical OpenAPI spec from docs/ and
# fans it out into dist/routes/openapi.json so the hosted /mcp route can
# load it at runtime. Same source feeds apps/mcp's build hook.
COPY docs/api-reference docs/api-reference
RUN pnpm turbo run build --filter=@letmepost/api

# ─── 4. runner ──────────────────────────────────────────────────────────────
FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000

# Workspace + lockfile + every package.json — needed so `pnpm --filter` works
# in CMD without re-resolving the universe.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc* ./
COPY apps/api/package.json apps/api/
COPY apps/mcp/package.json apps/mcp/
COPY packages/schemas/package.json packages/schemas/
COPY packages/config-tsconfig/package.json packages/config-tsconfig/

# Production-only deps for @letmepost/api. `--prod=false` is needed because
# better-auth pulls in `kysely` as a peer that lives in devDependencies on
# the workspace root; pnpm prunes it otherwise. Tweak if image size matters.
RUN pnpm install --frozen-lockfile --prod

# Compiled output for the API, schemas, and the MCP autogen module. Runtime
# imports route through @letmepost/schemas → packages/schemas/dist and
# @letmepost/mcp/autogen → apps/mcp/dist/autogen.js.
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/packages/schemas/dist packages/schemas/dist
COPY --from=build /app/apps/mcp/dist apps/mcp/dist

# Migrations are read at runtime by `dist/db/migrate.js`.
COPY apps/api/drizzle apps/api/drizzle

# Sentry/OTel init loaded via `node --import ./instrument.mjs` in both
# start:api and start:worker. Lives outside dist/ because it must run
# before any application code (including the compiled server entrypoint).
COPY apps/api/instrument.mjs apps/api/instrument.mjs

EXPOSE 3000

# Default to the API process. The worker service overrides this in
# railway.json (start command field) — same image, different entrypoint.
CMD ["pnpm", "--filter", "@letmepost/api", "start:api"]
