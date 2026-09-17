# Checkpoint CMS_UI_BASELINE — rediseño Nueva OT

- Fecha: 2026-09-14
- Preview aprobado: **V2** (`preview-v2.html`)
- Rama: `fix/fase-0-bloqueantes`
- Tag git: `CMS_UI_BASELINE` → commit `5487bc1326ccd856b58fa5e531c335d3498ac780`

## Trabajo previo del usuario (NO tocar en un rollback)
- `claude/plans/CONTEXTO.md` (modificado)
- `claude/mockups/` (sin versionar)
- `scripts/_tmp-backup-dch-estado-previo.json`, `scripts/_tmp-backup-dch-mbba-port-02.json`, `scripts/_tmp-backup-dch-solo-planilla.json`
- `tad-tramite-software.png`

## Archivos que toca la implementación (estaban limpios = iguales al tag)
- `apps/web-modern/src/components/NewWorkOrderWizard.tsx`
- `apps/web-modern/src/components/CreateWorkOrderModal.tsx`
- `apps/web-modern/src/lib/i18n.tsx`

## Archivos nuevos creados por la implementación
- Ninguno dentro de la app. Sólo material del preview en `claude/mockups/nueva-ot/` (preview-v1/v2/v3, este archivo).

## Estado verificado tras implementar V2 (2026-09-14)
- `git diff CMS_UI_BASELINE --stat -- apps/` → sólo los 3 archivos de arriba.
- Lógica de CreateWorkOrderModal (líneas de estado/handlers/onSave) sin cambios: los hunks son imports, props, helpers nuevos y el render.

## Implementación Preview V4 — Nueva SS (2026-09-14)
- Snapshot previo (V2 aplicado): tag `CMS_UI_V2_APPLIED` → `76711b3a…` (git stash create, no toca el working tree).
- Modificados además: `apps/web-modern/src/pages/Dashboard.tsx`
- **Archivo NUEVO creado:** `apps/web-modern/src/components/NewServiceRequestWizard.tsx` (en VOLVER-CERO se borra)

## Implementación Preview V7 — Completar la OT (2026-09-14)
- Snapshot previo (V2+V4 aplicados): tag `CMS_UI_V4_APPLIED` → `54791465…` (sólo tracked; el untracked propio es NewServiceRequestWizard.tsx).
- Modificados además: `apps/web-modern/src/pages/WorkOrders.tsx`
- Archivo nuevo `apps/web-modern/src/lib/wo-just-created.ts` → reemplazado en V8 por `lib/just-created.ts` (ya no existe).

## Implementación Preview V8 — Completar la SS (2026-09-14)
- Snapshot previo (V2+V4+V7 aplicados): tag `CMS_UI_V7_APPLIED` → `03967575…` (sólo tracked).
- Modificados además: `apps/web-modern/src/pages/ServiceRequests.tsx`
- **Archivos NUEVOS creados:** `apps/web-modern/src/components/GuideKit.tsx`, `apps/web-modern/src/lib/just-created.ts` (en VOLVER-CERO se borran)

## Implementación Preview V9 — más datos resaltados en la OT (2026-09-14)
- Snapshot previo (V2+V4+V7+V8 aplicados): tag `CMS_UI_V8_APPLIED` → `e902a858…` (sólo tracked).
- Modificado: `apps/web-modern/src/pages/WorkOrders.tsx` (sin archivos nuevos).

## Implementación Preview V11 — Horas de equipos (2026-09-14)
- Snapshot previo (V2..V9 aplicados): tag `CMS_UI_V9_APPLIED` → `e5ef8d30…` (sólo tracked).
- Modificados: `apps/web-modern/src/components/AssetHoursGrid.tsx`, `apps/web-modern/src/components/AssetHoursQuickModal.tsx`, `i18n.tsx` (sin archivos nuevos).

## Implementación Preview V12 — Lista de OT /work-orders (2026-09-14)
- Snapshot previo (V2..V11 aplicados): tag `CMS_UI_V11_APPLIED` → `33b31b01…` (sólo tracked).
- Modificados: `apps/web-modern/src/pages/WorkOrders.tsx`, `apps/web-modern/src/components/DataTable.tsx` (prop opcional `rowClassName`), `i18n.tsx` (sin archivos nuevos).

## Implementación Preview V13 — Lista de SS /service-requests (2026-09-14)
- Snapshot previo (V2..V12 aplicados): tag `CMS_UI_V12_APPLIED` → `70756a7d…` (sólo tracked).
- Modificados: `apps/web-modern/src/pages/ServiceRequests.tsx`, `i18n.tsx` (sin archivos nuevos).
- Volver sólo a antes de V13: `git checkout CMS_UI_V12_APPLIED -- apps/web-modern/src/pages/ServiceRequests.tsx apps/web-modern/src/lib/i18n.tsx`

## Permiso "Cargar y editar análisis de laboratorio" (fluid.manage) — 2026-09-14 (no es UI; pedido directo, opción 2)
- Snapshot previo: tag `CMS_UI_V13_APPLIED` → `64acfaa7…`.
- Modificados: `apps/api/src/tenant/auth/role-permissions.ts`, `apps/api/src/tenant/fluid-analyses/fluid-analyses-service.ts`, `apps/web-modern/src/pages/Dashboard.tsx`, `apps/web-modern/src/pages/FluidAnalyses.tsx`, `i18n.tsx`.
- Pendiente del usuario: tildarlo en Equipo → Permisos (Superintendente, Capitán/JM, Tripulante) en local y VPS.

## Implementación Preview V15 — Ventana del plan de mantenimiento (2026-09-14)
- Snapshot previo (V2..V13 + fluid.manage): tag `CMS_UI_PRE_V15` → `651f6d3c…` (sólo tracked).
- Modificados: `apps/web-modern/src/pages/MaintenancePlans.tsx` (render de MaintenancePlanModal), `i18n.tsx` (sin archivos nuevos).
- Volver sólo a antes de V15: `git checkout CMS_UI_PRE_V15 -- apps/web-modern/src/pages/MaintenancePlans.tsx apps/web-modern/src/lib/i18n.tsx`

## Implementación Preview V16 — Reportar / Diferir / Historial del plan (2026-09-14)
- Snapshot previo (V2..V15 + fluid.manage): tag `CMS_UI_V15_APPLIED` → `471ff79b…` (sólo tracked).
- Modificados: `apps/web-modern/src/pages/MaintenancePlans.tsx` (ExecutionModal, PostponeModal), `apps/web-modern/src/components/PlanHistoryModal.tsx`, `i18n.tsx` (sin archivos nuevos).
- NO se agregó el botón "Diferir" (la ventana sigue sin acceso). Decisión del usuario (opción 1): se deja así; los diferimientos van por el módulo Diferimientos.
- Volver sólo a antes de V16: `git checkout CMS_UI_V15_APPLIED -- apps/web-modern/src/pages/MaintenancePlans.tsx apps/web-modern/src/components/PlanHistoryModal.tsx apps/web-modern/src/lib/i18n.tsx`

## Implementación Preview V17b — Plan de muestreo en la ventana del plan (2026-09-15)
- Snapshot previo (V2..V16 + fluid.manage): tag `CMS_UI_V16_APPLIED` → `9f5f5d6e…` (sólo tracked).
- Modificados: `apps/web-modern/src/pages/MaintenancePlans.tsx`, `i18n.tsx` (sin archivos nuevos).
- Volver sólo a antes de V17b: `git checkout CMS_UI_V16_APPLIED -- apps/web-modern/src/pages/MaintenancePlans.tsx apps/web-modern/src/lib/i18n.tsx`

## Implementación Preview V18 (Muestreos y Análisis) + V19 (Nuevo permiso de trabajo) — 2026-09-15
- Snapshot previo (V2..V17b + fluid.manage): tag `CMS_UI_V17_APPLIED` → `c09b4b39…` (sólo tracked).
- Modificados: `apps/web-modern/src/pages/FluidAnalyses.tsx` (página/lista), `apps/web-modern/src/pages/Permits.tsx` (alta: origen, OT, tipo, formulario), `i18n.tsx` (sin archivos nuevos).
- Volver sólo a antes de V18/V19: `git checkout CMS_UI_V17_APPLIED -- apps/web-modern/src/pages/FluidAnalyses.tsx apps/web-modern/src/pages/Permits.tsx apps/web-modern/src/lib/i18n.tsx`

## Implementación Preview V20 — Detalle de la muestra (2026-09-15)
- Snapshot previo (V2..V19 + fluid.manage): tag `CMS_UI_V19_APPLIED` → `0c99b4f2…` (sólo tracked).
- Modificados: `apps/web-modern/src/pages/FluidAnalyses.tsx` (SampleDetailModal, ParametersTable, AiInsightCard, ParamSelector), `i18n.tsx` (sin archivos nuevos).
- Volver sólo a antes de V20: `git checkout CMS_UI_V19_APPLIED -- apps/web-modern/src/pages/FluidAnalyses.tsx apps/web-modern/src/lib/i18n.tsx`

## Implementación Preview V21 — Defectos (listado + ventana guiada) (2026-09-15)
- Snapshot previo (V2..V20 + fluid.manage): tag `CMS_UI_V20_APPLIED` → `6fb5bb26…` (sólo tracked).
- Modificados: `apps/web-modern/src/pages/Defects.tsx` (DefectsPage, DefectModal), `i18n.tsx` (sin archivos nuevos).
- Volver sólo a antes de V21: `git checkout CMS_UI_V20_APPLIED -- apps/web-modern/src/pages/Defects.tsx apps/web-modern/src/lib/i18n.tsx`

## Implementación Preview V22 — Permisos (listado + ventana del permiso) (2026-09-15)
- Snapshot previo (V2..V21 + fluid.manage): tag `CMS_UI_V21_APPLIED` → `50198c7a…` (sólo tracked).
- Modificados: `apps/web-modern/src/pages/Permits.tsx` (PermitsPage, render de PermitModal para permiso existente; el alta V19 sin cambios), `i18n.tsx` (sin archivos nuevos).
- Variante "como está hoy": sin participantes obligatorios nuevos ni checklist en la app.
- Volver sólo a antes de V22: `git checkout CMS_UI_V21_APPLIED -- apps/web-modern/src/pages/Permits.tsx apps/web-modern/src/lib/i18n.tsx`

## Implementación Preview V23 — Equipos, Repuestos y Proveedores (2026-09-15)
- Snapshot previo (V2..V22 + fluid.manage): tag `CMS_UI_V22_APPLIED` → `e03ac166…` (sólo tracked).
- Modificados: `apps/web-modern/src/pages/Assets.tsx` (AssetsPage, render de AssetModal, DeleteAssetModal, props de AssetMaintenancePlans), `apps/web-modern/src/pages/Spares.tsx`, `apps/web-modern/src/pages/Providers.tsx`, `i18n.tsx` (sin archivos nuevos, sin backend).
- No se agregó "Alta simple" de repuestos (el alta pasa por la recepción a propósito, para evitar duplicados) ni "Pedido en curso" (la lista de pedidos no trae el repuesto).
- Volver sólo a antes de V23: `git checkout CMS_UI_V22_APPLIED -- apps/web-modern/src/pages/Assets.tsx apps/web-modern/src/pages/Spares.tsx apps/web-modern/src/pages/Providers.tsx apps/web-modern/src/lib/i18n.tsx`

## Implementación Preview V24 — Campos a completar resaltados (2026-09-15)
- Snapshot previo (V2..V23 + fluid.manage): tag `CMS_UI_V23_APPLIED` → `31d3827f…` (sólo tracked).
- Modificados: CreateWorkOrderModal.tsx, NewServiceRequestWizard.tsx, MaintenancePlans.tsx (plan + ExecutionModal), FluidAnalyses.tsx, fluid-analyses/FluidBatchUploadModal.tsx, Permits.tsx, Defects.tsx, Assets.tsx, Spares.tsx, Providers.tsx, spares/SpareReceiptModal.tsx, i18n.tsx (sin archivos nuevos).
- Volver sólo a antes de V24: `git checkout CMS_UI_V23_APPLIED -- apps/web-modern/src`

## Implementación Preview V25 — Ctrl+Z / Ctrl+Y en toda la app (2026-09-15)
- Snapshot previo: tag `CMS_UI_V24_APPLIED` (commit local `b1c3035` + V24).
- Modificados: `apps/web-modern/src/main.tsx`, `App.tsx`, `lib/api.ts` (vacía el historial al guardar), `i18n.tsx`.
- **Archivos NUEVOS:** `apps/web-modern/src/lib/undo-manager.ts`, `apps/web-modern/src/components/UndoToastHost.tsx`.
- Volver sólo a antes de V25: `git checkout CMS_UI_V24_APPLIED -- apps/web-modern/src/main.tsx apps/web-modern/src/App.tsx apps/web-modern/src/lib/api.ts apps/web-modern/src/lib/i18n.tsx` y borrar los 2 archivos nuevos.

## Implementación Preview V26 — Especificación de Varada guiada + arreglos (2026-09-15)
- Snapshot previo: tag `CMS_UI_V25_APPLIED`.
- Modificados: `apps/web-modern/src/pages/DrydockSpecs.tsx`, `i18n.tsx`, `apps/api/src/tenant/pms/drydock-specs-service.ts`, `apps/api/src/tenant/pms/drydock-spec-items-service.ts` (sin archivos nuevos, sin schema).
- Reglas nuevas (aprobadas con el preview): aprobar sólo con todos los trabajos decididos; enviada/en revisión sólo tierra edita; tomar para revisar exige drydock.approve; decidir sólo en revisión; comentarios con nombre.
- Volver sólo a antes de V26: `git checkout CMS_UI_V25_APPLIED -- apps/web-modern/src/pages/DrydockSpecs.tsx apps/web-modern/src/lib/i18n.tsx apps/api/src/tenant/pms/drydock-specs-service.ts apps/api/src/tenant/pms/drydock-spec-items-service.ts`

## Implementación Preview V27 — Lista del Plan de Mantenimiento (2026-09-15)
- Snapshot previo: tag `CMS_UI_V26_APPLIED`.
- Modificados: `apps/web-modern/src/pages/MaintenancePlans.tsx` (sólo MaintenancePlansPage y helpers de lista), `i18n.tsx`, `apps/api/src/tenant/pms/maintenance-router.ts` (la lista agrega `hasAcceptanceCriteria`).
- Planilla y Matriz siguen ocultas (decisión previa del usuario): el selector de vista es Lista / Calendario (Gantt).
- Volver sólo a antes de V27: `git checkout CMS_UI_V26_APPLIED -- apps/web-modern/src/pages/MaintenancePlans.tsx apps/web-modern/src/lib/i18n.tsx apps/api/src/tenant/pms/maintenance-router.ts`

## Implementación Preview V28 (variante C) — Flujo de la muestra en un renglón (2026-09-15)
- Snapshot previo: tag `CMS_UI_V27_APPLIED`.
- Modificados: `apps/web-modern/src/pages/MaintenancePlans.tsx` (bloque "Qué pasa con la muestra" del plan de muestreo), `i18n.tsx` (2 claves).
- Volver sólo a antes de V28: `git checkout CMS_UI_V27_APPLIED -- apps/web-modern/src/pages/MaintenancePlans.tsx apps/web-modern/src/lib/i18n.tsx`

## Arreglo SS (sin preview, commit b82c1d6) — tablero de Solicitudes de Servicio
- `apps/web-modern/src/pages/ServiceRequests.tsx`: las tarjetas y las etapas reemplazan el filtro de estado que llega del Dashboard (antes se cruzaban y la columna quedaba vacía).

## Implementación Preview V29 — Registrar avances (2026-09-15, commit 9ac327a, tag CMS_UI_V29_APPLIED)
- Snapshot previo: tag `CMS_UI_V28B_APPLIED`.
- Modificados: `mobile/ProgressNoteSheet.tsx` (reescrito), `mobile/MobileWorkOrders.tsx`, `pages/WorkOrders.tsx` (panel de avances + lista), `components/MobileLayout.tsx` (botón rápido), `components/AssetHoursGrid.tsx` (ConfirmDialog pasa a compartido), `main.tsx`, `i18n.tsx`; API: `work-order-progress-ai.ts` (descuento automático apagado), `work-order-progress-notes-service.ts`, `pms/maintenance-router.ts` (detect-spares / confirm-spares).
- Nuevos: `lib/progress-outbox.ts` (avances guardados en el teléfono, IndexedDB `cms3-outbox`), `components/ConfirmDialog.tsx`.
- Volver sólo a antes de V29: `git checkout CMS_UI_V28B_APPLIED -- apps/web-modern/src/mobile/ProgressNoteSheet.tsx apps/web-modern/src/mobile/MobileWorkOrders.tsx apps/web-modern/src/pages/WorkOrders.tsx apps/web-modern/src/components/MobileLayout.tsx apps/web-modern/src/components/AssetHoursGrid.tsx apps/web-modern/src/main.tsx apps/web-modern/src/lib/i18n.tsx apps/api/src/tenant/work-orders/work-order-progress-ai.ts apps/api/src/tenant/work-orders/work-order-progress-notes-service.ts apps/api/src/tenant/pms/maintenance-router.ts && rm apps/web-modern/src/lib/progress-outbox.ts apps/web-modern/src/components/ConfirmDialog.tsx`

## VOLVER-CERO
```
git checkout CMS_UI_BASELINE -- apps/web-modern/src/components/fluid-analyses/FluidBatchUploadModal.tsx apps/web-modern/src/components/spares/SpareReceiptModal.tsx apps/web-modern/src/pages/Assets.tsx apps/web-modern/src/pages/Spares.tsx apps/web-modern/src/pages/Providers.tsx apps/web-modern/src/pages/Defects.tsx apps/web-modern/src/pages/Permits.tsx apps/web-modern/src/components/PlanHistoryModal.tsx apps/web-modern/src/pages/MaintenancePlans.tsx apps/web-modern/src/pages/FluidAnalyses.tsx apps/api/src/tenant/auth/role-permissions.ts apps/api/src/tenant/fluid-analyses/fluid-analyses-service.ts apps/web-modern/src/components/DataTable.tsx apps/web-modern/src/components/NewWorkOrderWizard.tsx apps/web-modern/src/components/CreateWorkOrderModal.tsx apps/web-modern/src/lib/i18n.tsx apps/web-modern/src/pages/Dashboard.tsx apps/web-modern/src/pages/WorkOrders.tsx apps/web-modern/src/pages/ServiceRequests.tsx apps/web-modern/src/components/AssetHoursGrid.tsx apps/web-modern/src/components/AssetHoursQuickModal.tsx apps/web-modern/src/mobile/ProgressNoteSheet.tsx apps/web-modern/src/mobile/MobileWorkOrders.tsx apps/web-modern/src/components/MobileLayout.tsx apps/web-modern/src/main.tsx apps/api/src/tenant/work-orders/work-order-progress-ai.ts apps/api/src/tenant/work-orders/work-order-progress-notes-service.ts apps/api/src/tenant/pms/maintenance-router.ts
rm apps/web-modern/src/components/NewServiceRequestWizard.tsx apps/web-modern/src/components/GuideKit.tsx apps/web-modern/src/lib/just-created.ts apps/web-modern/src/lib/progress-outbox.ts apps/web-modern/src/components/ConfirmDialog.tsx
git diff CMS_UI_BASELINE --stat -- apps/   # debe quedar vacío
git status --porcelain -- apps/            # sin ?? propios
```

## Implementación Preview V30 — App a bordo (Capitán / Jefe de Máquinas) (2026-09-15)
- Snapshot previo: tag `CMS_UI_V30_PRE` → `9ac327a` (árbol de apps/ limpio).
- Decisiones del usuario: exigir todos los datos para enviar; dejar "Lo que mandaste"; consumo sin OT permitido; el Capitán/JM entra directo desde el celular. Fotos en check list: otra etapa.
- Modificados: `apps/web-modern/src/App.tsx` (ruta `/abordo` + OnboardEntry), `apps/web-modern/src/lib/i18n.tsx` (226 claves `ob.*`), `apps/api/src/tenant/approvals/approvals-service.ts` (listMySubmissions), `apps/api/src/tenant/pms/pms-router.ts` (GET /app/pms/approvals/mine).
- **Archivos NUEVOS:** `apps/web-modern/src/onboard/` (OnboardApp, OnboardPlans, OnboardNewWorkOrder, OnboardHours, OnboardPermit, OnboardChecklist, OnboardSpares, ui, shared, entry).
- Sin schema, sin permisos nuevos. La vista /m de la tripulación no se tocó.
- Volver sólo a antes de V30: `git checkout CMS_UI_V30_PRE -- apps/web-modern/src/App.tsx apps/web-modern/src/lib/i18n.tsx apps/api/src/tenant/approvals/approvals-service.ts apps/api/src/tenant/pms/pms-router.ts && rm -r apps/web-modern/src/onboard`

## Implementación Preview V31 — Agenda de mantenimiento en el celular (2026-09-15)
- Snapshot previo: tag `CMS_UI_V31_PRE` → `259ec64`. Aplicado en `fe5874f` (tag `CMS_UI_V31_APPLIED`).
- Decisiones del usuario: la agenda REEMPLAZA la lista de "vencidos / por vencer"; horizonte 6 meses + todo lo vencido; sólo el buque elegido; vista calendario (V32) descartada.
- Modificados: `apps/web-modern/src/onboard/OnboardPlans.tsx` (agenda + AgendaRow), `apps/web-modern/src/pages/MaintenanceGantt.tsx` (usa la regla compartida), `i18n.tsx` (14 claves `ob.ag.*`; se borraron 5 `ob.plans.*` sin uso).
- **Archivo NUEVO:** `apps/web-modern/src/lib/maintenance-window.ts` — la regla de la ventana, compartida entre el Gantt del escritorio y la agenda del celular.
- ⚠ El commit lo hizo el IDE del usuario barriendo el árbol (había otra sesión trabajando en paralelo, commit `b346248` sobre ProgressFlow). Verificado que `fe5874f` contiene exactamente los 4 archivos de la agenda.
- Volver sólo a antes de V31: `git checkout CMS_UI_V31_PRE -- apps/web-modern/src/onboard/OnboardPlans.tsx apps/web-modern/src/pages/MaintenanceGantt.tsx apps/web-modern/src/lib/i18n.tsx && rm apps/web-modern/src/lib/maintenance-window.ts`

## Implementación Preview V33 — La muestra en tres pasos (2026-09-15)
- Snapshot previo: tag `CMS_UI_V33_PRE`. Commits: `b030e17` + `38b420b` + `2c14a3f`.
- Modificados: `components/ProgressFlow.tsx` (lista los pedidos AUTORIZADOS que llevan muestras + hoja de ruta plegable), `i18n.tsx` (31 claves `ss.samp.*`).
- **Archivo NUEVO:** `components/service-requests/SampleStepsBox.tsx`.
- Sin schema ni permisos: usa lab-samples (PUT), /start y /complete, que ya existían.
- Volver: `git checkout CMS_UI_V33_PRE -- apps/web-modern/src/components/ProgressFlow.tsx apps/web-modern/src/lib/i18n.tsx && rm apps/web-modern/src/components/service-requests/SampleStepsBox.tsx`

## Implementación Preview V34 — El agente de voz de la app a bordo (2026-09-16)
- Snapshot previo: tag `CMS_UI_V34_PRE` → `2c14a3f`. Commits: `600d3e6`, `189cba9`, `72c0b89`, `7179da6`.
- Modificados: `onboard/OnboardApp.tsx` (el botón va arriba de todo), `components/CopilotoPanel.tsx` (usa las funciones compartidas), `i18n.tsx` (17 claves `ob.agent.*`), `apps/api/src/tenant/copiloto/copiloto-service.ts` (modo "agent": una pregunta por vez, opciones numeradas siempre, sin markdown, sin hablar en pasado).
- **Archivos NUEVOS:** `onboard/OnboardAgent.tsx`, `lib/copilot-blocks.ts` (parseo de opciones y bloques, compartido PC/celular).
- Verificado en la demo: "toma de muestra del motor" → 5 motores como botones → plan M02-MP-BR-18 → confirmación → WO-M02-26-0464 con criterio/LOTO/riesgo del plan y SS-9 a CONDOR.
- Volver: `git checkout CMS_UI_V34_PRE -- apps/web-modern/src/onboard/OnboardApp.tsx apps/web-modern/src/components/CopilotoPanel.tsx apps/web-modern/src/lib/i18n.tsx apps/api/src/tenant/copiloto/copiloto-service.ts && rm apps/web-modern/src/onboard/OnboardAgent.tsx apps/web-modern/src/lib/copilot-blocks.ts`

## Implementación Previews V35 y V36 — Tercerizado con taller + orden del inicio (2026-09-16)
- Snapshot previo: tag `CMS_UI_V35_PRE` → `96f5a23`.
- **V35 (Tercerizado):** al abrir la OT desde un plan que NO trae taller, marcar "Tercerizado" pide proveedor + tipo de solicitud, y el backend abre la SS en la MISMA transacción que la OT (una SS por taller, igual que los planes de área PROVEEDOR). El cliente no crea la SS: sólo manda `providerId` + `purchaseRequestKinds`; el bucle que ya existía la manda a aprobar junto con la OT.
- **V36 (inicio, variante B elegida):** Planes para abrir + Horómetros lado a lado y grandes; Registrar avance de ancho completo; "Lo demás" (Nueva OT/SS, Permiso, Check list, Repuestos) chico y en gris. Nueva OT/SS deja de ser el botón celeste (decisión de Gustavo).
- Modificados: `onboard/shared.tsx` (nuevo `ProviderFields` compartido + `SR_KINDS`), `onboard/OnboardNewWorkOrder.tsx` (usa el compartido; se le quitó el bloque inline y el fetch de proveedores), `onboard/OnboardPlans.tsx` (bloque del taller + payload), `onboard/OnboardApp.tsx` (los tres niveles), `lib/i18n.tsx` (2 claves: `ob.home.rest`, `ob.plans.srNote`), `apps/api/src/tenant/maintenance-plans/maintenance-plans-service.ts` (`providerId` + `purchaseRequestKinds` en `OpenFormalWorkOrderInput`; el taller manual entra a `providerRequests` con `manual: true`, así hereda proveedor de la OT, exclusión del express, creación de SS y auditoría).
- Sin schema, sin permisos nuevos, sin endpoints nuevos.
- Verificado en la base local con `openFormalWorkOrder` en proceso: OT-M02-26-0470 con `providerId` del taller elegido + SS-13-M02-2026 DRAFT con `purchaseRequestKinds ["NORMAL","AFECTA SERVICIO"]`; sin taller → 0 SS; taller inexistente → `PROVIDER_NOT_FOUND`. Todo borrado después (hard delete) y `executionStatus` del plan restaurado.
- Volver: `git checkout CMS_UI_V35_PRE -- apps/web-modern/src/onboard/ apps/web-modern/src/lib/i18n.tsx apps/api/src/tenant/maintenance-plans/maintenance-plans-service.ts`

## Implementación Preview V37 — Ubicación = dónde está el buque (2026-09-16)
- Snapshot previo: tag `CMS_UI_V37_PRE` → `5100433`.
- El campo Ubicación del celular pedía "¿Dónde se hace el trabajo?" y ofrecía Sala de máquinas / Cubierta principal / Puente / Proa / Popa — lugares de a bordo. El recuadro del formulario REGI-MAN-02.3 es la ubicación GEOGRÁFICA del buque (así está cargado en producción: "Puerto Guyrati, km 1574 Río Paraguay"; el escritorio sugiere "Ciudad / Km…").
- Modificados: `onboard/OnboardPlans.tsx` (`LocationField`: se van los 5 botones, entra la aclaración), `lib/i18n.tsx` (`ob.locationPh` cambia a un ejemplo de ciudad/puerto/km; nueva `ob.locationHint`; se borran las 5 claves `ob.loc.*`, sin uso).
- Un solo componente ⇒ arregla las dos pantallas que piden el dato (abrir OT desde el plan y OT nueva). Escritorio y copiloto ya lo trataban bien.
- Datos ya cargados mal, NO tocados (decisión de Gustavo): OT-M01-26-0565 "PROA" y OT-M01-26-0564 "PROA BABOR".
- Volver: `git checkout CMS_UI_V37_PRE -- apps/web-modern/src/onboard/OnboardPlans.tsx apps/web-modern/src/lib/i18n.tsx`

## Implementación Preview V38 — Repuestos por categoría (2026-09-16)
- Snapshot previo: tag `CMS_UI_V38_PRE` → `1921f1b`.
- Consumo de repuestos abre por CATEGORÍA: buscador fijo arriba (busca en todo el pañol) + un botón por tipo con su cantidad + "Ver todos". Dentro de una categoría, botón para volver a los tipos.
- **El trabajo se pregunta al final** (decisión de Gustavo, 2026-09-16): al tocar "Descontar N" aparece la lista de OT abiertas / consumo general, y elegir una guarda.
- **Bug corregido de paso:** la pantalla pedía `/app/pms/spares` sin buque, así que quien ve toda la flota (Capitán, admin) veía los 620 repuestos de los 34 buques y el descuento fallaba al guardar (el backend valida `{spareId, vesselCode}` → SPARE_NOT_FOUND). Ahora pide `?vesselCode=<elegido>`.
- **Agrupado de categorías (sólo visual):** el catálogo tiene la misma categoría escrita de varias formas. `categoryKey()` ignora mayúsculas, tildes y el plural; la etiqueta es la forma más usada (a igual uso, la que lleva tilde). Verificado con los datos reales: M01 41 categorías escritas → 34 botones, M02 24 → 22 (junta Manguera(s), Sensor(es), Eléctrico/Electrico, Bomba(s), Correa(s), Rodamiento(s), Electrónico/Electronico). NO toca el catálogo.
- Queda pendiente (datos, decisión de Gustavo): emprolijar `Spare.category` desde la PC — "FILTROS DE COMBUSTIBLE" vs "Filtro", "Liquido Refrigerante" vs "Refrigerante", "Repuesto".
- Modificados: `onboard/OnboardSpares.tsx`, `lib/i18n.tsx` (8 claves `ob.spares.*` nuevas).
- Sin backend, sin schema, sin permisos.
- Volver: `git checkout CMS_UI_V38_PRE -- apps/web-modern/src/onboard/OnboardSpares.tsx apps/web-modern/src/lib/i18n.tsx`

## Implementación Preview V39 — "¿Para qué trabajo?": primero el equipo (2026-09-16)
- Snapshot previo: tag `CMS_UI_V39_PRE` → `f00e3ab`.
- El último paso del consumo de repuestos mostraba TODAS las OT abiertas del buque en una lista plana (en LTE son 33 en 11 equipos, con 4 motores principales repitiendo la misma tarea). Ahora: equipos con OT abierta → tareas de ese equipo.
- Con UN solo equipo se saltea el paso (igual que `OpenWorkOrdersList` cuando hay un solo grupo). "Consumo general del buque" se muestra en la lista de equipos y también en ese caso de un solo equipo — si no, quedaría inalcanzable.
- Estado por orden (Abierta / Vencida / Diferida): mismo criterio que `WoStatusChip` de la PC, repintado acá porque en el celular ningún texto baja de 13px.
- Modificados: `components/service-requests/OpenWorkOrdersPicker.tsx` (se EXPORTA `groupByAsset`, sin cambiar su comportamiento), `onboard/OnboardSpares.tsx`, `lib/i18n.tsx` (6 claves).
- Sin backend, sin schema, sin permisos. El Registro de Avance no se tocó.
- Volver: `git checkout CMS_UI_V39_PRE -- apps/web-modern/src/onboard/OnboardSpares.tsx apps/web-modern/src/lib/i18n.tsx apps/web-modern/src/components/service-requests/OpenWorkOrdersPicker.tsx`

## Implementación Preview V40 — Defectos en el celular (2026-09-16)
- Snapshot previo: tag `CMS_UI_V40_PRE` → `f183caa`.
- Tres pantallas: contar qué pasó (texto/dictado/foto) → "esto entendí" (la IA propone equipo, descripción, clasificación, gravedad, estado del equipo y acción inmediata; todo editable) → "¿cómo se repara?" (Crear la OT · Ya se reparó · Lo dejo abierto).
- **No agrega endpoints ni reglas:** usa `voice-report-parse` y `analyze-photo` (ya en uso en la vista de tripulación) y el alta/PATCH/close de defectos. Permiso existente `defect.write` para mostrar el botón.
- **Crear la OT** reutiliza `OnboardNewWorkOrder` con un `prefill` nuevo (equipo, descripción, tipo CORRECTIVO_NO_PROGRAMADO, plazo = gravedad) y un `onCreated` que vincula el defecto a la orden y lo cierra con `def.verify.closedIntoWo` — mismo comportamiento que el escritorio.
- **Ya se reparó**: RESUELTO + close con la constancia (mismas 4 opciones que la PC). El backend EXIGE `closeNotes`: verificado que sin constancia devuelve VALIDATION_ERROR.
- ⚠ **La IA devuelve `immediateAction` como LISTA**, no como texto (verificado contra Claude en la base local). Se normaliza con `asText()` → viñetas. Sin esto la pantalla rompía.
- Verificado en la base local con los services en proceso: parse de un relato real (identificó "Motor Principal Babor", severity HIGH, estado DEGRADED), alta DEF-M02-26-0007, cierre con constancia (fija revisión de eficacia a 30 días) y rechazo sin constancia. Todo borrado después (hard delete).
- Modificados: `onboard/OnboardApp.tsx` (vista + botón), `onboard/OnboardNewWorkOrder.tsx` (`NewWoPrefill` + `onCreated`, sin cambiar el alta normal), `lib/i18n.tsx` (48 claves `ob.def.*` / `ob.tile.defect*`).
- **Archivo NUEVO:** `onboard/OnboardDefect.tsx`.
- Volver: `git checkout CMS_UI_V40_PRE -- apps/web-modern/src/onboard/OnboardApp.tsx apps/web-modern/src/onboard/OnboardNewWorkOrder.tsx apps/web-modern/src/lib/i18n.tsx && rm apps/web-modern/src/onboard/OnboardDefect.tsx`
