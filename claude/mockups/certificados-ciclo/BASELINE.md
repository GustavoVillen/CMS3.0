# Checkpoint — Preview certificados-ciclo V1 (barra del ciclo de clase)

- Fecha: 2026-09-18
- Aprobado por Gustavo: "proceder. Solo al Localhost". NO subido a v3 ni al VPS.
- Tag git del estado previo: `CMS_UI_BASELINE_CERT_CICLO` → 8b3b7b2 (los archivos tocados estaban limpios).

## Archivos modificados
- `apps/api/src/tenant/certificates/certificates-service.ts` — el listado devuelve `classCycle` por certificado
- `apps/web-modern/src/pages/Certificates.tsx` — columnas Buque · Certificado · Ciclo de clase · Situación hoy, filtros y buscador
- `apps/web-modern/src/lib/i18n.tsx` — claves `cert.cycle.*`

## Archivos nuevos
- `apps/api/src/tenant/certificates/class-cycle.ts`
- `apps/web-modern/src/components/ClassCycleBar.tsx`

## VOLVER

    git checkout CMS_UI_BASELINE_CERT_CICLO -- apps/api/src/tenant/certificates/certificates-service.ts apps/web-modern/src/pages/Certificates.tsx apps/web-modern/src/lib/i18n.tsx
    rm apps/api/src/tenant/certificates/class-cycle.ts apps/web-modern/src/components/ClassCycleBar.tsx

Antes, mirar `git diff CMS_UI_BASELINE_CERT_CICLO -- <archivo>` por si otra sesión tocó esos archivos después.

---

# Segunda tanda — fechas de inspección en el certificado (18-sep, plan aprobado)

Estado previo copiado en `backup-pre-fechas/` (mismas rutas que en el repo).

## Archivos modificados en esta tanda
- `prisma/schema.prisma` — 9 columnas nuevas nullable en `Certificate` (base local con db push)
- `apps/api/src/tenant/certificates/certificates-service.ts`, `class-cycle.ts`
- `apps/api/src/tenant/work-orders/work-orders-service.ts`
- `apps/api/src/tenant/maintenance-plans/maintenance-plans-service.ts`
- `apps/api/src/tenant/daily-reports/daily-report-integration-service.ts`
- `apps/web-modern/src/pages/Certificates.tsx`, `components/ClassCycleBar.tsx`, `lib/i18n.tsx`
- `HISTORY.txt` (entrada 2026-09-18)

## Archivo nuevo
- `scripts/backfill-class-survey-dates.ts` (se corrió en la base LOCAL: 31 certificados)

## VOLVER (sólo esta tanda)
Copiar cada archivo de `backup-pre-fechas/` sobre su ruta, borrar el script nuevo y quitar la
entrada de HISTORY.txt. Las 9 columnas quedan en la base local sin uso (nullable, inofensivas);
para sacarlas: restaurar schema.prisma y `pnpm db:push`.

---

# Tercera tanda — franja del ciclo de clase en el Dashboard (18-sep)

- `apps/web-modern/src/pages/Dashboard.tsx` estaba limpio en git: VOLVER = `git checkout -- apps/web-modern/src/pages/Dashboard.tsx`
- `ClassCycleStrip` agregado al final de `components/ClassCycleBar.tsx` + clave `cert.cycle.open` en i18n.
