# 01 — Architecture Snapshot

> Generado: 2026-04-15
> Modo: INSPECCIÓN SOLAMENTE — sin modificaciones al código.
> Fuente: análisis del repositorio real + `00-charter.md` + `source-spec-full.md`.

---

# 1. Stack técnico detectado

| Área | Tecnología |
|---|---|
| **Lenguaje** | TypeScript (Node.js 20+) |
| **Framework backend** | HTTP nativo de Node.js (`http` module). Sin Express ni Hono (Hono está en `package.json` pero **no se usa en producción**). |
| **ORM** | Prisma v7.7.0 con adaptador PostgreSQL |
| **Base de datos** | PostgreSQL (Docker Compose en dev) |
| **Package manager** | pnpm v9.15.0 (workspace monorepo) |
| **Scheduler / jobs** | In-process: `setTimeout` + `setInterval`. Sin Bull, BullMQ, RabbitMQ, ni ningún queue externo. |
| **Testing stack** | No existe ningún framework de testing activo. Sin Jest, Vitest, ni archivos `.test.ts`. Tipado fuerte vía TypeScript + ESLint. |
| **UI framework** | React 19 + Vite 8 + React Router 7 |
| **UI styling** | Tailwind CSS v4 (dark theme industrial) |
| **UI charts** | Recharts v3 |
| **UI icons** | Lucide React |
| **AI / LLM** | Anthropic Claude (`@anthropic-ai/sdk` v0.89) como principal; Google Generative AI como fallback |
| **Excel** | exceljs v4 |

---

# 2. Módulos existentes detectados

## Backend — Tenant (`apps/api/src/tenant/`)

| Módulo | Qué hace | ¿Reutilizable para PMS? |
|---|---|---|
| `assets` | Registro físico de equipos por buque | **SÍ — es el Equipment Register del PMS** |
| `maintenance-plans` | Planes preventivos con triggers (HOURS, MONTHS, CONDITION, EVENT) | **SÍ — base del PMS, se debe extender, no duplicar** |
| `work-orders` | Órdenes de trabajo con ciclo de vida completo | **SÍ — reutilizar, posiblemente extender estados** |
| `inspections` | Inspecciones externas/regulatorias con resultado y logs | PARCIAL — existe pero semánticamente distinto al PMS |
| `inspection-logs` | Hallazgos detallados de inspecciones | PARCIAL — similar a findings del PMS |
| `defects` | Defectos de equipos con ciclo de vida | **SÍ — equivalente a findings correctivos** |
| `deferrals` | Postergaciones con flujo de aprobación | **SÍ — reutilizable para deferrals de WO/plan** |
| `rca` | Análisis de causa raíz | SÍ (calidad) |
| `capa` | Acciones correctivas/preventivas | SÍ (calidad) |
| `certificates` | Certificados de cumplimiento con tracking de vencimiento | SÍ (compliance) |
| `daily-reports` | Reportes operativos diarios (horas motor, GPS, fuel) | SÍ — fuente de running hours para PMS |
| `spares` | Inventario de repuestos con stock mínimo y punto de reorden | **SÍ — ya existe, no duplicar** |
| `spare-orders` | Órdenes de compra de repuestos | **SÍ — ya existe** |
| `stock-movements` | Movimientos de inventario (RECEIPT, ISSUE, ADJUSTMENT, TRANSFER) | **SÍ — ya existe** |
| `providers` | Proveedores de repuestos y servicios | SÍ |
| `provider-evaluations` | Evaluaciones de desempeño de proveedores | SÍ |
| `provider-nonconformities` | No conformidades de proveedores | SÍ |
| `ai-insights` | Insights determinísticos automáticos | **SÍ — extender con reglas PMS** |
| `ai-documents` | Base de conocimiento versionada para el Copiloto | SÍ |
| `copiloto` | Chat IA con streaming SSE y composición de contexto | **SÍ — extender con capabilities PMS** |
| `domain-events` | Log append-only de cambios | **SÍ — usar para trazabilidad PMS** |
| `excel` | Import/export two-phase con preview y confirmación | **SÍ — extender con módulos PMS** |
| `attachments` | Adjuntos (archivos/evidencias) ligados a entidades | **SÍ — extender target enum para nuevas entidades** |
| `auth` | Login/sesión de usuario tenant | No tocar |
| `bootstrap` | Resolución pública del tenant por slug/dominio | No tocar |
| `i18n` | Internacionalización (es, en, pt) | No tocar |
| `invitations` | Invitaciones de usuarios | No tocar |

## Backend — Platform (`apps/api/src/platform/`)

| Módulo | Qué hace |
|---|---|
| `auth` | Login de super-admin (PlatformUser) |
| `tenants` | Gestión de tenants (solo super-admin) |
| `users` | Gestión de usuarios de plataforma |
| `prompts` | Gobernanza de prompts IA (versionados, publicados) |
| `audit` | Log de auditoría a nivel plataforma |
| `tenancy` | Resolución de tenant por header/dominio |
| `data` | Prisma client y fixtures de desarrollo |
| `home` | Landing page |

---

# 3. Seguridad y autorización

## Patrón de auth

- Dual-layer: **Platform** (super-admin) y **Tenant** (usuario operativo).
- Tokens opacos almacenados en mapas en memoria (`Map<token, session>`).
- Sin JWT. Sin Redis. **Single-instance deployment assumption** — si se escala horizontalmente, las sesiones se pierden.
- Refresh tokens sí persisten en BD (`RefreshToken` model).

## Patrón de roles (TenantRole)

```
TENANT_ADMIN
MAINTENANCE_MANAGER
TECHNICIAN_OPERATOR
INSPECTOR_COMPLIANCE
PROCUREMENT_STORE
AUDITOR_READONLY
```

No existe un `VESSEL_MASTER`, `CHIEF_ENGINEER`, ni ningún rol específico PMS. Los roles actuales **sí cubren las necesidades PMS** sin necesidad de nuevos roles (MAINTENANCE_MANAGER + TECHNICIAN_OPERATOR + INSPECTOR_COMPLIANCE cubren el flujo completo).

## Patrón de tenancy

- Tenant resuelto por header `X-Tenant-Slug` o dominio custom (`TenantDomain`).
- **Todo query filtra por `tenantId`** en el primer nivel.
- Usuarios no-admin filtran además por `assignedVesselCodes[]` en su `TenantMembership`.

## Patrón de filtros backend

```
tenantId (siempre)
  └─ vesselCode (si aplica)
       └─ role-scoped vessel codes (si no es admin)
            └─ deletedAt: null (soft delete siempre)
```

## Fail-closed / riesgos detectados

- El sistema es generalmente fail-closed: si no hay sesión válida → 401.
- Riesgo real: sesiones en memoria se pierden al reiniciar el proceso. Afecta UX, no seguridad.
- No se detectan filtros de row-level security en PostgreSQL; la seguridad es 100% aplicación. Si un bug omite el `tenantId` en un query, podría haber cross-tenant leak. Riesgo bajo pero real.
- No se usa ningún RBAC externo. Todo es código manual en cada service.

---

# 4. Modelo de datos actual

## Entidades principales (30+ modelos)

### Auth & Tenancy
`Tenant`, `TenantDomain`, `TenantSetting`, `TenantMembership`, `User`, `UserInvitation`, `PlatformUser`, `PlatformSession`, `RefreshToken`, `AuditEvent`

### Operacional core
`Vessel`, `Asset`, `MaintenancePlan`, `WorkOrder`, `Defect`, `Deferral`, `RcaRecord`, `CapaRecord`

### Compliance & Operaciones
`Inspection`, `InspectionLog`, `Certificate`, `DailyReport`

### Procurement & Stock
`Provider`, `Spare`, `SpareOrder`, `StockMovement`, `ProviderEvaluation`, `ProviderNonconformity`

### Infraestructura & IA
`Attachment`, `DomainEvent`, `PromptTemplate`, `AiDocument`, `AiDocumentVersion`, `AiInsight`

## Relaciones relevantes

```
Tenant → Vessel (1:N)
Vessel → Asset (1:N)
Asset → MaintenancePlan (1:N)
MaintenancePlan → WorkOrder (1:N, via maintenancePlanId opcional)
WorkOrder → Defect (1:N, via workOrderId)
Defect → Deferral (polimórfico via sourceType=DEFECT)
Defect → RcaRecord (1:N)
RcaRecord → CapaRecord (via sourceType=RCA)
Inspection → InspectionLog (1:N)
Vessel → DailyReport (1:N) ← fuente de running hours
Vessel → Spare (1:N)
Spare → StockMovement (1:N)
SpareOrder → Provider (N:1)
```

## Naming conventions

- IDs: cuid() en todos los modelos.
- Tenant-scoped: `tenantId` + `vesselCode` en casi todas las tablas operacionales.
- Audit fields estándar: `createdAt`, `createdByUserId`, `updatedAt`, `updatedByUserId`, `deletedAt`, `deletedByUserId`.
- Unique keys compuestos: generalmente `(tenantId, vesselCode, entityCode)`.
- Codigos de negocio: `assetCode`, `workOrderCode`, `defectCode`, `taskCode`, `maintenancePlanCode`, etc.
- Enums: SCREAMING_SNAKE_CASE para status, UPPER_CASE para tipos.

## Entidades que mapean a conceptos PMS

| Entidad actual | Concepto PMS equivalente |
|---|---|
| `Asset` | Equipment Register |
| `MaintenancePlan` | Maintenance Plan (instancia por equipo) |
| `WorkOrder` | Work Order |
| `Defect` | Finding / Corrective Finding |
| `InspectionLog` | Inspection Finding |
| `Spare` | Spare Part (inventario) |
| `DailyReport.engineHoursMain` | Running Hours source |
| `AiInsight` | Automated alerts / KPI triggers |
| `DomainEvent` | Audit trail / change log |

## Lo que NO existe aún (requerido por PMS spec)

- `EquipmentClass` — Clase de equipo reutilizable con templates de tareas.
- `TaskMaster` — Biblioteca maestra de tareas (con taskType MAINTENANCE/INSPECTION).
- `ClassTaskTemplate` — Puente clase ↔ tarea.
- `SfiCode` / `System` — Jerarquía funcional / SFI (solo existe `sfiCode: String?` libre en `Asset`).
- `WorkExecution` / `WorkLog` — Registro de ejecución y horas reales por WO.
- `RunningHoursLog` — Log de horas de motor para trigger HOURS (actualmente disperso en `DailyReport`).
- `PlanAuditRecord` — Resultado de auditoría de planes.
- Campo `woGenerationMode` en `MaintenancePlan` (AUTOMATIC/SEMI_AUTOMATIC/MANUAL).
- Campo `taskType` en `MaintenancePlan` (MAINTENANCE/INSPECTION separados explícitamente).

---

# 5. Inventario / assets / findings / work / reports / AI

## Qué existe y es reutilizable

- **Assets**: modelo completo con criticality (A/B/C), status, SFI code, manufacturer, serial, fechas. Listo para PMS.
- **MaintenancePlan**: triggers HOURS/MONTHS/CONDITION/EVENT, `lastExecutionDate`, `nextDueDate`, `nextDueHours`. Falta: `woGenerationMode`, `taskType`, `leadTime`, `responsibleRole` explícito.
- **WorkOrder**: estados PLANNED/IN_PROGRESS/ON_HOLD/DEFERRED/CLOSED/CANCELLED. Falta: PENDING_APPROVAL, OPEN (diferente de PLANNED), COMPLETED (diferente de CLOSED).
- **Spares + StockMovements**: inventario funcional con stock actual, mínimo, punto de reorden. Las `StockMovement` referencian WOs.
- **AiInsight + insight-generator**: motor determinístico que ya corre cada 6h. Agregar reglas PMS es directo.
- **Copiloto**: composición de contexto con capabilities configurables por prompt. Fácil de extender.
- **PromptTemplate**: gobernanza por capability + locale + version. Listo para nuevos capabilities PMS.
- **Attachment**: soporte para evidencias. Extender `AttachmentTarget` enum.
- **DomainEvent**: trazabilidad append-only. Reutilizar sin cambios.
- **Excel import/export**: módulo two-phase con permisos por módulo. Extender con nuevas entidades PMS.

## Qué no conviene duplicar

- No crear un segundo sistema de inventario de repuestos.
- No crear un segundo sistema de notificaciones/alertas paralelo a `AiInsight`.
- No crear un segundo sistema de adjuntos.
- No crear un segundo scheduler; usar el `setInterval` in-process.
- No crear roles nuevos si los existentes cubren el flujo.

---

# 6. Scheduler / automatismos / eventos

## Jobs existentes

| Job | Frecuencia | Qué hace |
|---|---|---|
| `insight-generator` | 30s post-arranque, luego cada 6h | Evalúa reglas determinísticas para todos los tenants activos y upserta `AiInsight` |

No hay más jobs. Sin queues externas.

## Lógica del scheduler

```typescript
// server.ts (in-process)
setTimeout(() => runInsightScheduler(), 30_000)
setInterval(() => runInsightScheduler(), 6 * 60 * 60 * 1_000)
```

El scheduler itera por tenant y llama `generateInsightsForTenant(tenantId)`. El procesamiento de cada tenant es secuencial (no paralelo). Falla de un tenant no detiene los demás.

## Posibilidades de integración PMS

El PMS necesita un **calendar trigger runner** diario que:
1. Evalúe planes con `nextDueDate <= today + leadTime`.
2. Genere WOs automáticos si `woGenerationMode = AUTOMATIC`.
3. Recalcule `nextDueDate` tras completar un WO.
4. Chequee duplicados antes de crear (anti-duplication).

**Esto encaja perfectamente en el mismo `setInterval` in-process.** Se puede agregar un segundo job al loop diario sin cambiar la infraestructura.

## Hooks / automatismos detectados

- No existen webhooks ni event-driven automation más allá del insight generator.
- `DomainEvent` es append-only — no dispara nada. Es solo auditoría.

---

# 7. UI y patrones de frontend

## Tablas

- Componente `DataTable` centralizado.
- **Click en fila → abre modal de edición** (regla del proyecto, registrada en CLAUDE.md).
- Sin botón "Editar" en la fila.
- Acciones secundarias permitidas como botones en fila (ej. "Eliminar").

## Forms / modals

- Modals/drawers para crear/editar (no páginas separadas para la mayoría de entidades).
- Formularios controlados con React state local.
- Sin react-hook-form ni Zod detectados — validaciones manuales.

## Dashboards

- Dashboard principal con KPIs operativos (horas, trabajo pendiente, defectos abiertos).
- Recharts para gráficos.
- No existe aún un dashboard específico PMS con PM compliance rate ni fleet KPIs.

## Componentes reutilizables detectados

| Componente | Qué hace |
|---|---|
| `DataTable` | Tabla genérica con click-to-edit |
| `PageHeader` | Título de página + breadcrumbs |
| `Layout` | Shell principal tenant (sidebar + header) |
| `PlatformLayout` | Shell super-admin |
| `Sidebar` | Navegación con 16+ items |
| `Header` | Barra superior (usuario, tenant, locale) |
| `ExcelPanel` | Interfaz import/export Excel |
| `CopilotoPanel` | Chat IA (SSE streaming) |

## Patrones de navegación

- React Router 7 con rutas planas (`/maintenance-plans`, `/work-orders`, etc.).
- `RequireAuth` / `RequirePlatformAuth` como guards de ruta.
- Contextos: `useAuth()` para tenant, `usePlatformAuth()` para platform.
- i18n via `useI18n()` context.
- Estado en localStorage: `gpms_token`, `gpms_tenant_slug`.

---

# 8. Rutas o carpetas sensibles que no conviene tocar

| Ruta | Por qué no tocar |
|---|---|
| `apps/api/src/tenant/auth/` | Login, sesiones, contraseñas |
| `apps/api/src/platform/auth/` | Login de super-admin |
| `apps/api/src/platform/tenancy/` | Resolución de tenant por dominio |
| `apps/api/src/tenant/bootstrap/` | Arranque público del tenant |
| `apps/api/src/platform/data/prisma-client.ts` | Singleton de Prisma; tocar puede romper toda la app |
| `apps/api/src/server.ts` | Servidor HTTP central (1250+ líneas). Solo agregar rutas, nunca refactorizar el core |
| `apps/web-modern/src/lib/auth.tsx` | Contexto de auth del tenant |
| `apps/web-modern/src/lib/platform-auth.tsx` | Contexto de auth de plataforma |
| `apps/web-modern/src/components/Layout.tsx` | Shell global con sidebar |
| `apps/web-modern/src/components/Sidebar.tsx` | Navegación global. Solo agregar items, sin reestructurar |
| `apps/web-modern/src/index.css` | Variables de design system (colores, fuentes) |
| `prisma/schema.prisma` — tablas auth/platform | `Tenant`, `User`, `TenantMembership`, `PlatformUser` — no renombrar campos, no cambiar tipos |
| `apps/api/src/tenant/i18n/` | Sistema de internacionalización |

---

# 9. Riesgos de contradicción

## Duplicaciones semánticas potenciales

| Concepto PMS spec | Entidad existente | Riesgo |
|---|---|---|
| "Equipment" | `Asset` | **ALTO** — si se crea `Equipment` como modelo nuevo se duplica completamente |
| "Equipment Register" | `assets` module | ALTO — mismo riesgo |
| "Finding" | `Defect` + `InspectionLog` | MEDIO — "finding" es ambiguo: puede ser un defecto o un hallazgo de inspección |
| "Task" | `MaintenancePlan` | MEDIO — un `TaskMaster` es una plantilla de plan, no un plan ni una WO |
| "Inventory item" | `Spare` | ALTO — no crear `InventoryItem` paralelo |
| "Running hours" | `DailyReport.engineHoursMain` | MEDIO — si se crea `RunningHoursLog` separado, se duplican los datos |
| "Unit" / "Ship" | `Vessel` | BAJO — nomenclatura diferente, mismo concepto |

## Nombres que podrían entrar en conflicto

- `taskCode` ya existe en `MaintenancePlan` — un `TaskMaster` también necesitaría `taskCode`. Cuidado con colisión de unique keys.
- `inspectionCode` en `Inspection` — si el PMS agrega inspecciones de mantenimiento (distintas de las regulatorias), ambas usarían ese namespace.
- `WorkOrderStatus` ya tiene 6 valores. El spec pide PENDING_APPROVAL y OPEN (diferente de PLANNED). **Es un cambio de enum que requiere migración y revisión de toda la lógica de filtros.**
- El campo `responsible` en `MaintenancePlan` es `String?` libre. El spec pide `responsibleRole` tipado. Son campos distintos pero podrían confundirse.

## Decisiones que no se pueden tomar a ciegas

1. **¿`TaskMaster` es por tenant o global?** El spec dice "biblioteca reutilizable" — podría ser global (sin tenantId) o por tenant. La arquitectura actual no tiene entidades globales (sin tenantId).
2. **¿`EquipmentClass` es global o por tenant?** Mismo dilema. Si es global, es la primera entidad sin `tenantId` del sistema.
3. **¿Cómo se manejan las running hours?** `DailyReport` ya las registra, pero no como log acumulativo ni como serie temporal consultable para triggers HOURS. Necesita decisión de diseño.
4. **WorkOrder con `PENDING_APPROVAL`**: si se agrega este estado, todos los queries existentes que filtran por estado necesitan revisión.
5. **¿Los `MaintenancePlan` existentes son de tipo MAINTENANCE o INSPECTION?** El campo `taskType` no existe. Si se agrega, ¿cómo se categorizan los planes ya creados? Sin migración de datos explícita, quedarían con valor nulo.
6. **¿La `Inspection` existente (SAFETY/TECHNICAL/REGULATORY/CLASS) coexiste con inspecciones generadas por PMS?** O ¿son conceptos completamente distintos? El spec dice que inspección ≠ mantenimiento, pero el modelo actual es para inspecciones externas/de terceros.

---

# 10. Propuesta mínima de integración

## Qué reutilizar sin cambios

- `Vessel` — es la flota. No tocar.
- `Asset` — es el equipment register. No crear `Equipment`.
- `MaintenancePlan` — extender, no duplicar.
- `WorkOrder` — extender estados y campos, no crear `PMSWorkOrder` paralelo.
- `Spare`, `SpareOrder`, `StockMovement` — inventario ya funcional. No duplicar.
- `Defect` — es el finding correctivo del PMS.
- `Deferral` — ya modela postergaciones con aprobación. Reutilizar.
- `AiInsight` + `insight-generator` — agregar reglas PMS al motor existente.
- `PromptTemplate` — agregar capabilities PMS (`pms_task_classifier`, `equipment_enrollment_assistant`, `plan_auditor`).
- `Attachment` — extender enum `AttachmentTarget` con nuevas entidades.
- `DomainEvent` — reutilizar sin cambios.
- `DataTable`, `PageHeader`, `Layout`, `Sidebar` — UI shell reutilizable.
- Scheduler in-process — agregar calendar trigger runner al mismo loop.

## Qué crear (modelos nuevos)

| Entidad nueva | Justificación |
|---|---|
| `EquipmentClass` | No existe. Catálogo de clases reutilizables. Decidir si global o por tenant. |
| `TaskMaster` | No existe. Biblioteca de tareas con `taskType` (MAINTENANCE/INSPECTION). |
| `ClassTaskTemplate` | No existe. Puente clase ↔ tarea con frecuencias por defecto. |
| `WorkExecution` | No existe. Registro de ejecución real por WO (horas, técnico, cierre). |
| `RunningHoursLog` | No existe como entidad consultable. Actualmente disperso en `DailyReport`. |

## Qué extender (campos o enums en modelos existentes)

| Modelo | Extensión propuesta |
|---|---|
| `MaintenancePlan` | Agregar: `taskMasterId?`, `taskType`, `woGenerationMode`, `leadTimeDays`, `responsibleRole` |
| `WorkOrder` | Extender enum `WorkOrderStatus` con PENDING_APPROVAL, OPEN, COMPLETED |
| `Asset` | Agregar: `equipmentClassId?` (FK a `EquipmentClass`) |
| `Attachment.AttachmentTarget` | Agregar entradas para nuevas entidades PMS |
| `AiInsight.InsightType` | Agregar: `critical_asset_without_plan`, `pm_compliance_below_threshold` |
| `PromptCapability` | Agregar capabilities PMS |

## Qué NO tocar

- Auth completo (tenant + platform).
- Tenancy resolution.
- RBAC y roles (no agregar roles nuevos).
- Layout, Sidebar estructura principal, design system.
- `Defect`, `RcaRecord`, `CapaRecord`, `Inspection` (compliance externa) — coexisten con PMS.
- `DomainEvent` — solo append, nunca modificar.
- `DailyReport` — fuente de datos, no transformar.

## Por qué esta propuesta es compatible

- Agrega modelos nuevos sin romper los existentes.
- Extiende `MaintenancePlan` y `WorkOrder` con campos opcionales (nullable) primero, migrables sin downtime.
- No crea un RBAC paralelo.
- No crea un scheduler nuevo.
- No crea un módulo de inventario paralelo.
- Reutiliza el motor de insights ya en producción.
- Las nuevas páginas de UI siguen los mismos patrones (DataTable + click-to-edit + PageHeader).

---

# 11. Dudas bloqueantes reales

Las siguientes son genuinamente bloqueantes antes de escribir código:

**1. ¿`EquipmentClass` y `TaskMaster` son globales (sin `tenantId`) o por tenant?**
Si son globales, es la primera ruptura del patrón "todo tiene tenantId" en el sistema. Si son por tenant, cada empresa define sus propias clases y el catálogo no se comparte entre tenants. Esta decisión afecta el modelo de datos, los seeds y la UI de administración.

**2. ¿Cómo se sourcea la running hour para triggers HOURS?**
`DailyReport.engineHoursMain` registra horas por día por buque, pero no por equipo. Si el trigger HOURS se necesita por equipo individual (ej. bomba de achique vs. motor principal), `DailyReport` no alcanza. ¿Se crea `RunningHoursLog` por equipo, o el sistema simplifica asumiendo horas de motor = horas del buque?

**3. ¿`WorkOrderStatus` se amplía o se crea un enum paralelo?**
Agregar PENDING_APPROVAL y OPEN al enum existente requiere una migración que afecta todos los módulos que filtran/muestran WOs. Es seguro hacerlo, pero necesita ser una decisión explícita, no una adición silenciosa.

**4. ¿Cómo coexisten `Inspection` (external/regulatory) y las inspecciones generadas por planes PMS?**
El modelo actual de `Inspection` es para inspecciones de terceros (SAFETY, REGULATORY, CLASS). Los planes PMS de tipo INSPECTION generarían WOs de tipo INSPECTION, no registros en `Inspection`. ¿Esto es correcto, o necesita una integración más directa?

**5. ¿Los `MaintenancePlan` existentes en producción son MAINTENANCE o INSPECTION?**
Si hay datos reales, agregar `taskType` como `NOT NULL` requiere un valor de migración por defecto. Si son todos MAINTENANCE, es simple. Si hay mezcla, se necesita revisión manual.
