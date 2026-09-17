# Checkpoint — Informe de salud del equipo (Preview V43)

- Fecha: 2026-09-17
- Preview aprobado: **V43** (`preview-v43.html`)
- Rama: `fix/fase-0-bloqueantes`
- Tag git: `CMS_UI_BASELINE_V43` → `61decf9fce15936b15a90e7e00eaef6e97b51c76` (`git stash create`, incluye el trabajo previo sin commitear)

## Archivos modificados
- `prisma/schema.prisma` (modelo nuevo `AssetHealthReport`; ya tenía cambios previos)
- `apps/api/src/tenant/auth/role-permissions.ts` (permisos `assetHealth.generate` / `assetHealth.view`)
- `apps/api/src/tenant/pms/assets-router.ts` (rutas `/health-reports`; ya tenía cambios previos)
- `apps/web-modern/src/pages/Assets.tsx` (botón en el encabezado de la ficha)
- `apps/web-modern/src/lib/i18n.tsx` (claves `asset.health.*`, `perm.assetHealth*`)

## Archivos NUEVOS (en VOLVER-CERO se borran)
- `apps/api/src/tenant/assets/asset-health-service.ts`
- `apps/api/src/tenant/pms/asset-health-pdf-service.ts`
- `apps/web-modern/src/components/assets/AssetHealthReportModal.tsx`

## Base de datos
- Tabla nueva `AssetHealthReport` (db push local). En VOLVER-CERO: quitar el modelo y `db push` (borra la tabla y sus informes).
- Informe de prueba guardado en local: Motor Principal #4 de LATERE (17/09/2026, Admin Mercurio).

## VOLVER-CERO
`git show CMS_UI_BASELINE_V43:<ruta> > <ruta>` por cada archivo modificado; borrar los nuevos. No usar reset/clean.
