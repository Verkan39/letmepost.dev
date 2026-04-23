# letmepost.dev

Open-source social media publishing API for developers and AI-agent builders.

See [`PRODUCT.md`](./PRODUCT.md) for product positioning and [`TECH.md`](./TECH.md) for the tech stack.

## Workspace layout

```
apps/
  api/         # Hono HTTP server — the core product
  dashboard/   # Next.js account dashboard (later)
  web/         # Astro + Starlight landing + docs (later)
packages/
  schemas/     # Zod — single source of truth for validation, types, OpenAPI
  config-tsconfig/
  config-eslint/
```

## Development

```bash
pnpm install
pnpm dev        # run all apps in dev
pnpm test       # run tests
pnpm typecheck  # typecheck everything
```
