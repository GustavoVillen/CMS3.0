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

**Database:** PostgreSQL on port **5434** (Docker). Prisma schema at `prisma/schema.prisma`.
- IMPORTANT: native Windows PostgreSQL 18 (service `postgresql-x64-18`) owns port 5433. Docker was moved to 5434 to avoid conflict.
- IMPORTANT: @prisma/client must be v7.7.0 in apps/api (to match adapter-pg@7 peer dep). Prisma generate must be run with `pnpm --filter @pms-saas/api exec prisma generate --schema ../../prisma/schema.prisma`, then copy .prisma/client to the 54p6... pnpm instance.
- `pnpm db:up` → start Docker
- `pnpm db:migrate` → run migrations
- `pnpm db:seed` → seed data

**Docs source of truth:** `docs_saas/` — all approved, must be read before implementing any block.
**History log:** `HISTORY.txt` — mandatory to update after each block completion.

**How to apply:** Use these commands and ports when debugging or running the project locally.
