# Checkpoint — rediseño Avances de OT (Seguimiento)

- Fecha: 2026-10-21
- Prototipo aprobado: `avances-ot-v1.html` (PROCEDER de Gustavo)
- Rama: `fix/fase-0-bloqueantes`
- Tag git: `CMS_UI_AVANCES_BEFORE` → commit `dbde35d`
- Decidido por defecto (no contestó): la lista de Avances dentro del formulario de la OT queda
  como estaba; la hoja de ruta de la SS no cambia en el celular.

## Qué pasó con los archivos compartidos
Mientras se implementaba, otra sesión trabajaba en el mismo árbol (Falta SS, commit `fa27bfd`)
y al commitear se llevó dos partes de este cambio:
- las 32 claves `av.*` de `apps/web-modern/src/lib/i18n.tsx`;
- en `apps/web-modern/src/pages/Approvals.tsx`, la línea que carga `WoProgressWindow` (lazy).
El resto va en el commit propio de este rediseño (ver abajo).

## Archivos de este rediseño
- NUEVO `apps/web-modern/src/components/work-orders/WoProgressWindow.tsx` (la ventana)
- `apps/web-modern/src/mobile/ProgressNoteSheet.tsx` (la lógica pasa al hook `useProgressComposer`; la hoja no cambia)
- `apps/web-modern/src/pages/Approvals.tsx` (usa `WoProgressWindow` en lugar de `WorkOrderProgressModal`)
- `apps/web-modern/src/lib/i18n.tsx` (claves `av.*`, entraron en `fa27bfd`)
- `WorkOrders.tsx` NO se tocó: `WorkOrderProgressModal` sigue ahí, sin uso desde Seguimiento.

## VOLVER
1. `git revert <commit de este rediseño>` (vuelve la hoja y quita la ventana nueva).
2. En `Approvals.tsx`, volver la línea del lazy a
   `const WorkOrderProgressModal = React.lazy(() => import("./WorkOrders").then(m => ({ default: m.WorkOrderProgressModal })));`
   (el revert del paso 1 ya devuelve el uso con `title`/`subtitle`).
3. Borrar las claves `av.*` de `i18n.tsx` (opcional: sin uso no rompen nada).
Commitear y, si ya está en el VPS, volver a desplegar.
