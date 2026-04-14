---
name: GPMS monorepo stack
description: Key tech, ports, workspace layout, and dev commands for the pms-saas-workspace monorepo
type: project
---

**Monorepo:** pnpm workspaces — `apps/*`, `packages/*`

**Backend:** `apps/api` — plain Node.js `http.createServer`, TypeScript, Prisma 6. Port 3105.
- Dev: `pnpm dev:api` (tsx watch)
- No CORS middleware — frontend is served from the same origin by the backend.

**Frontend (temporary):** `apps/web-legacy` — TypeScript + esbuild IIFE bundle.
- Bundle: `public/bundle.js` (27 KB minified)
- Dev: `pnpm --filter @pms-saas/web-legacy dev` (esbuild --watch)
- Accessed at: `http://localhost:3105/ui`

**Shared packages:** `packages/shared-types`, `packages/i18n`, `packages/config`

**Database:** PostgreSQL on port 5433 (Docker). Prisma schema at `prisma/schema.prisma`.
- `pnpm db:up` → start Docker
- `pnpm db:migrate` → run migrations
- `pnpm db:seed` → seed data

**Docs source of truth:** `docs_saas/` — all approved, must be read before implementing any block.
**History log:** `HISTORY.txt` — mandatory to update after each block completion.

**How to apply:** Use these commands and ports when debugging or running the project locally.
