---
name: web-legacy SPA shell
description: Frontend shell built in apps/web-legacy — mount point, auth pattern, page-adding recipe
type: project
---

SPA shell for `apps/web-legacy` built 2026-04-13.

**Why:** Temporary navigable frontend while the final React/Next app is not built yet.

**Mount point:** `http://localhost:3105/ui` (backend serves index.html for GET /ui/*).

**Dev credentials:**
- Tenant: `admin@demo.local` / `demo123` (tenant slug: `demo`)
- Platform (superadmin): `admin@localhost` / `admin123`

**Routing model:** All history pushes prefix with `/ui`; router strips prefix to get logical path.
- Tenant routes: `/app/login`, `/app/dashboard`, `/app/vessels`, etc.
- Platform routes: `/platform/login`, `/platform/tenants`, `/platform/users`, `/platform/prompts`

**Adding a new read-only TENANT page (no auth/shell/router changes needed):**
1. Create `src/pages/my-page.ts` exporting `async function pageMyPage(): Promise<void>`
2. Inside, call `renderTenantShell(t("nav.myKey"), "/app/my-page", htmlContent)`
3. Import + `registerRoute("/app/my-page", requireTenant(pageMyPage))` in `src/index.ts`

**Adding a new read-only PLATFORM page:**
- Same pattern but `renderPlatformShell` and `requirePlatform` guard.

**API client pattern:**
- Tenant calls: `api.vessels.list()` etc. — auto-stamps `X-Tenant-Slug` + `Authorization` headers.
- Platform calls: `api.platform.tenants.list()` etc. — uses `pms_platform_token`, no tenant header.
- Backend requires `APP_ALLOW_TENANT_HEADER_FALLBACK=true` (already set in .env.example).

**Build:**
- `pnpm --filter @pms-saas/web-legacy build` → `public/bundle.js` (esbuild IIFE)
- `pnpm --filter @pms-saas/web-legacy typecheck` → tsc --noEmit

**How to apply:** When adding pages or debugging frontend auth/routing issues, reference this pattern first.
