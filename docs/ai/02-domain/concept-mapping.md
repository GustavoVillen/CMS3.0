# 02 — Concept Mapping: PMS vs. Arquitectura Existente

> Generado: 2026-04-15
> Modo: DOCUMENTACIÓN SOLAMENTE — sin modificaciones al código.
> Fuente: análisis del repo real (`01-architecture-snapshot.md`) + `00-charter.md` + `source-spec-full.md`.

---

# 1. Mapping de conceptos PMS a entidades/módulos existentes

| PMS Concept | Existing Entity / Module / Pattern | Reuse / Extend / New | Riesgo de duplicación | Comentario |
|---|---|---|---|---|
| **Vessel** | `Vessel` (model) + `vessels` module | **Reutilizar tal cual** | Ninguno | Modelo completo con IMO, type, dimensiones, status. Es la misma entidad. |
| **System / SFI** | Campo `sfiCode: String?` en `Asset` | **Nuevo** (entidad separada) | Bajo | Solo existe como string libre. El PMS necesita jerarquía funcional navegable. Crear `System` o `SfiNode` es nuevo. |
| **Equipment / Asset físico** | `Asset` (model) + `assets` module | **Reutilizar tal cual** | **CRÍTICO** — llamarlo `Equipment` crea duplicado semántico | `Asset` ya tiene: criticality (A/B/C), status, SFI code, manufacturer, serial, fechas. Mapeo 1:1. No crear `Equipment`. |
| **Equipment Class** | No existe | **Nuevo** | Bajo | No hay catálogo de clases. Debe crearse `EquipmentClass`. Decisión pendiente: global vs. por tenant (ver Sección 5). |
| **Task Master** | No existe | **Nuevo** | Medio | `MaintenancePlan` es una instancia por equipo, no una plantilla reutilizable. `TaskMaster` es la biblioteca maestra. Son conceptos distintos. |
| **Class Task Template** | No existe | **Nuevo** | Bajo | Puente entre `EquipmentClass` y `TaskMaster`. No existe en ninguna forma actualmente. |
| **Maintenance Plan** (instancia por equipo) | `MaintenancePlan` (model) + `maintenance-plans` module | **Extender** | Alto — confusión entre plan existente y concepto PMS | Tiene: triggers (HOURS/MONTHS/CONDITION/EVENT), lastExecutionDate, nextDueDate. Falta: `taskType`, `woGenerationMode` (DUE_ONLY/AUTO_WO/APPROVAL_WO), `leadTimeDays`, `taskMasterId`. |
| **Inspection Plan** (plan tipo inspección) | `MaintenancePlan` con campo ausente `taskType=INSPECTION` | **Extender** | **ALTO** — coexiste con `Inspection` (entidad distinta para inspecciones externas/regulatorias) | En el repo, `Inspection` = inspección externa (SAFETY/REGULATORY/CLASS). Los planes de inspección operativa viven en `MaintenancePlan`. Son semánticamente distintos. Ver Sección 5. |
| **Due Item** | No existe como entidad | **Nuevo** (o virtual) | Bajo | Actividad vencida/exigible antes de convertirse en WO. El spec lo distingue explícitamente de WO. Puede modelarse como vista/query sobre `MaintenancePlan` donde `nextDueDate <= today + leadTime`, o como entidad `DueItem`. |
| **Work Order** | `WorkOrder` (model) + `work-orders` module | **Extender** | Medio — estados y semántica difieren en parte | Tiene: PLANNED/IN_PROGRESS/ON_HOLD/DEFERRED/CLOSED/CANCELLED. Falta: PENDING_APPROVAL, OPEN (semánticamente diferente de PLANNED), COMPLETED (diferente de CLOSED). Tipo: ya tiene PREVENTIVE/CORRECTIVE/INSPECTION. |
| **Execution / Work Log** | No existe como entidad | **Nuevo** | Bajo | `WorkOrder` tiene `closeNotes: String?` pero no un registro estructurado de ejecución. Crear `WorkExecution` o `WorkLog` con horas reales, técnico, hallazgos, consumos, resultado. |
| **Finding** (hallazgo de inspección operativa) | `InspectionLog` (entradas de inspecciones externas) / `Defect` (defecto de equipo) | **Nuevo** (entidad propia) o **extender Defect** | **ALTO** — "finding" es ambiguo en el repo actual | Ver Sección 5 — análisis completo. |
| **Defect** (deficiencia de equipo) | `Defect` (model) + `defects` module | **Reutilizar** | Alto por naming — en el repo ya existe | En el repo, `Defect` = deficiencia de equipo con severidad, estado y acciones. Es el finding correctivo del PMS Nivel 2-3. No duplicar. |
| **Deferral / Deferment** | `Deferral` (model) + `deferrals` module | **Reutilizar tal cual** | Bajo | Modelo maduro con flujo de aprobación: REQUESTED→UNDER_REVIEW→APPROVED/REJECTED→ACTIVE→EXPIRED/CLOSED. Soporta `sourceType` polimórfico (DEFECT/WORK_ORDER/MAINTENANCE_PLAN). |
| **Spare** | `Spare` (model) + `spares` module | **Reutilizar** / extender relaciones | **CRÍTICO** si se duplica | Ya tiene: SKU, criticality, stock actual/mínimo/reorder, manufacturer, unit. No crear módulo paralelo. Extender con FK a `TaskMaster` / `EquipmentClass` para sugerencias. |
| **Consumable** | `Spare` con `category: String?` libre | **Extender** (campo `isConsumable` o subcategoría) | Bajo | El spec distingue Spares vs. Consumables. Actualmente no hay separación. Un campo `itemType: SPARE | CONSUMABLE` en `Spare` es la extensión mínima. |
| **Stock Movement** | `StockMovement` (model) + módulo | **Reutilizar tal cual** | Ninguno | Soporta RECEIPT/ISSUE/ADJUSTMENT/TRANSFER con referencia polimórfica. Ya linkea a WO. Extender `MovementRefType` con nuevos tipos si es necesario. |
| **Spare Usage (por WO/Execution)** | `StockMovement` con `referenceType=WORK_ORDER` | **Reutilizar** | Bajo | El vínculo WO→spare usage ya existe vía `StockMovement`. Falta: repuestos sugeridos por tarea (viene de `TaskMaster`). |
| **Instrument / Calibration Tool** | No existe | **Nuevo** | Ninguno | El repo no tiene catálogo de instrumentos de medición. Crear `Instrument` con: code, type, serialNumber, calibrationDate, calibrationDueDate, status. |
| **Calibration / Verification** | No existe como entidad | **Nuevo** | Bajo | El spec pide alertas de calibración vencida. Puede ser simplemente un estado calculado sobre `Instrument.calibrationDueDate`, o una entidad `CalibrationRecord` si se requiere historial. |
| **Daily Report** | `DailyReport` (model) + módulo | **Reutilizar tal cual** | Ninguno | Ya tiene `engineHoursMain`, `generatorHours`, position, fuel. Es la fuente natural de running hours a nivel buque. |
| **Running Hours Log** (por equipo) | No existe. `DailyReport.engineHoursMain` es por buque, no por equipo | **Nuevo** | Bajo | Si los triggers HOURS se aplican por equipo individual (ej. bomba separada del motor principal), `DailyReport` no es suficiente. Crear `RunningHoursLog` con: `assetId`, `vesselCode`, `hours`, `recordedAt`. Si el sistema asume horas buque = horas equipo, no hace falta. **Decisión pendiente.** |
| **Risk Assessment** | No existe como entidad | **Nuevo** (o descartar) | Bajo | El spec lo menciona tangencialmente. No hay `RiskAssessment` en el repo. Si el PMS lo requiere, es nuevo. Si se posterga, `Defect.operationalState` (NORMAL/DEGRADED/RESTRICTED/NO_GO) cubre riesgo operativo básico. |
| **RCA** | `RcaRecord` (model) + `rca` module | **Reutilizar tal cual** | Ninguno | Completo: DRAFT→UNDER_ANALYSIS→COMPLETED→APPROVED→CLOSED. Metodologías: FIVE_WHYS/FISHBONE/FTA/BARRIER_ANALYSIS. Vinculable a Defect o WorkOrder. |
| **CAPA** | `CapaRecord` (model) + `capa` module | **Reutilizar tal cual** | Ninguno | Completo: OPEN→IN_PROGRESS→PENDING_VERIFICATION→CLOSED/CANCELLED. sourceType polimórfico: RCA/DEFECT/WORK_ORDER/INSPECTION. |
| **Dashboard KPI** | Dashboard parcial en `web-modern` | **Extender** (nueva página PMS) | Bajo | Existe dashboard general. No tiene: PM compliance rate, inspection compliance, due items overdue, critical assets without plan. Crear `/pms-dashboard` como ruta nueva. |
| **AI Skill (asistencia IA)** | `copiloto` module + `PromptTemplate` + `PromptCapability` enum | **Extender** | Bajo | Ya existe infraestructura AI: streaming Copiloto, prompts versionados por capability. Agregar capabilities: `pms_equipment_enrollment`, `pms_task_classifier`, `pms_closure_enhancer`, `pms_plan_auditor`, `pms_spare_suggester`. |
| **AI Insight / Alert automática** | `AiInsight` + `insight-generator` + `InsightType` enum | **Extender** | Bajo | Motor determinístico ya corre cada 6h. Agregar reglas: `critical_asset_without_plan`, `pm_compliance_below_threshold`, `instrument_calibration_expired`. |
| **Inspection Checklist Template** | No existe | **Nuevo** | Bajo | El spec define `InspectionTemplateMaster` con checklist items estructurados. La entidad `Inspection` del repo es para resultados de inspecciones externas, no para plantillas ejecutables. |
| **Inspection Execution** | `Inspection` (model) en el repo — PARCIALMENTE | **Nuevo** o **extender** | **ALTO** — colisión de nombres | Ver Sección 5. |
| **SFI / System Hierarchy** | `sfiCode: String?` en `Asset` (no navegable) | **Nuevo** | Bajo | Una jerarquía SFI navegable requiere una entidad `System` o `SfiNode` con parent/child. El campo actual es solo un código libre. |

---

# 2. Conceptos ya resueltos por la arquitectura actual

Los siguientes conceptos **ya existen y no deben duplicarse bajo ninguna circunstancia**:

### Entidades plenamente resueltas

- **Vessel** — `Vessel`. Completo para PMS.
- **Asset / Equipment** — `Asset`. Con criticality, SFI code, manufacturer, serial, status, fechas. No crear `Equipment`.
- **Maintenance Plan (instancia)** — `MaintenancePlan`. Triggers, frecuencias, last/next dates. Extender, no duplicar.
- **Work Order** — `WorkOrder`. Ciclo de vida, tipos, prioridades. Extender estados, no duplicar.
- **Defect** — `Defect`. Finding correctivo con severidad, estado, acciones. Reutilizar.
- **Deferral / Deferment** — `Deferral`. Flujo de aprobación maduro y polimórfico.
- **RCA** — `RcaRecord`. Completo, no tocar.
- **CAPA** — `CapaRecord`. Completo, no tocar.
- **Spare** — `Spare`. Inventario funcional con stock mínimo y punto de reorden.
- **Stock Movement** — `StockMovement`. Movimientos con referencia polimórfica a WO/defect/etc.
- **Spare Order** — `SpareOrder`. Proceso completo de compra.
- **Provider** — `Provider`. Incluye evaluaciones y no conformidades.
- **Certificate** — `Certificate`. Con tracking de vencimiento.
- **Daily Report** — `DailyReport`. Fuente de running hours por buque.
- **Attachment** — `Attachment`. Sistema de evidencias ya funcional. Extender el enum `AttachmentTarget`.
- **Domain Event** — `DomainEvent`. Trazabilidad append-only. Reutilizar sin cambios.
- **Audit Event** — `AuditEvent`. Auditoría a nivel plataforma/tenant.
- **AI Insight** — `AiInsight`. Motor determinístico con 18 tipos. Extender, no duplicar.
- **AI Document / Knowledge Base** — `AiDocument` + `AiDocumentVersion`. Reutilizar.
- **Copiloto / AI Chat** — `copiloto` module. Extender con nuevas capabilities.
- **Prompt Template** — `PromptTemplate`. Gobernanza de prompts por capability+locale+version.
- **Excel Import/Export** — módulo `excel`. Two-phase con permisos. Extender con nuevas entidades.
- **Auth, RBAC, Tenancy** — No tocar. Los 6 roles actuales cubren el flujo PMS.

### Patrones de infraestructura ya resueltos

- **Multi-tenancy**: `tenantId` en todas las entidades operacionales.
- **Vessel scope**: `vesselCode` con filtro por `assignedVesselCodes[]` en membresía.
- **Soft delete**: `deletedAt` estándar en todos los modelos principales.
- **Audit fields**: `createdAt/By`, `updatedAt/By`, `deletedAt/By` en todos los modelos.
- **Scheduler in-process**: `setInterval` + `setTimeout` en `server.ts`. Reutilizar para calendario PMS.
- **Unique codes**: `(tenantId, vesselCode, entityCode)` como clave de negocio.

---

# 3. Conceptos que deben extenderse

Lo que existe pero necesita extensión mínima para satisfacer el PMS:

### `MaintenancePlan` — extensión de campos

Faltan:

| Campo | Tipo sugerido | Para qué |
|---|---|---|
| `taskMasterId` | `String?` FK | Vínculo a la biblioteca maestra de tareas |
| `taskType` | Enum `MAINTENANCE \| INSPECTION` | Separar mantenimiento de inspección (charter regla 12) |
| `woGenerationMode` | Enum `DUE_ONLY \| AUTO_WO \| APPROVAL_WO` | Controlar si genera due item, WO automática o WO pendiente de aprobación |
| `leadTimeDays` | `Int?` | Cuántos días antes avisar el vencimiento |
| `responsibleRole` | Enum `TenantRole?` | Rol sugerido responsable (hoy es `responsible: String?` libre) |

Los campos existentes (`triggerType`, `frequencyHours`, `frequencyMonths`, `lastExecutionDate`, `nextDueDate`) son correctos y no deben cambiar.

### `WorkOrder` — extensión de estados y campos

El enum `WorkOrderStatus` actual: `PLANNED | IN_PROGRESS | ON_HOLD | DEFERRED | CLOSED | CANCELLED`

Falta para PMS:
- `PENDING_APPROVAL` — WOs generadas en modo APPROVAL_WO antes de ser aprobadas.
- `OPEN` — WO aprobada y activa pero no iniciada (semánticamente distinto de PLANNED).
- `COMPLETED` — Ejecutada pero aún no cerrada formalmente (distinto de CLOSED).

> **Nota**: Agregar valores a un enum existente en Prisma + PostgreSQL requiere migración. Es seguro pero afecta todos los módulos que leen/filtran por este enum. Debe ser una decisión explícita.

Campos adicionales que podrían ser útiles:
- `dueItemId: String?` — Referencia al `DueItem` que originó la WO (si se modela como entidad).
- `maintenancePlanId` ya existe y es `String?` — bien.

### `Asset` — extensión de relaciones

| Campo | Tipo sugerido | Para qué |
|---|---|---|
| `equipmentClassId` | `String?` FK | Vínculo a `EquipmentClass` para heredar tasks templates |
| `systemId` | `String?` FK | Vínculo a nodo de jerarquía SFI navegable (si se crea `System`) |

El campo `sfiCode: String?` existente puede mantenerse para compatibilidad, pero `systemId` permitiría navegación por árbol SFI.

### `Spare` — extensión mínima

| Campo | Tipo sugerido | Para qué |
|---|---|---|
| `itemType` | Enum `SPARE \| CONSUMABLE` | Separar repuestos identificables de consumibles (aceite, grasa, etc.) |

La categorización actual (`category: String?` libre) no permite filtrar estructuralmente.

### `AttachmentTarget` enum — extensión

Agregar valores para las nuevas entidades PMS que se creen (ej. `INSPECTION_EXECUTION`, `WORK_EXECUTION`, `FINDING`, `INSTRUMENT`).

### `AiInsight.InsightType` enum — extensión

Agregar:
- `critical_asset_without_plan` — Equipo crítico sin ningún plan activo.
- `pm_compliance_below_threshold` — Compliance de PM por buque por debajo del umbral configurable.
- `instrument_calibration_expired` — Instrumento usado activamente con calibración vencida.
- `due_item_overdue_no_wo` — Due item vencido sin WO generada (si se modela DueItem).

### `PromptCapability` enum — extensión

Agregar capabilities PMS:
- `pms_equipment_enrollment` — Skill A: alta asistida de equipo.
- `pms_task_classifier` — Skill B: clasificar tarea como MAINTENANCE o INSPECTION.
- `pms_closure_enhancer` — Skill C: mejorar notas de cierre técnico.
- `pms_plan_auditor` — Skill D: auditar gaps en planes por equipo.
- `pms_spare_suggester` — Skill E: sugerir repuestos por clase/tarea/equipo.

### `MovementRefType` enum — extensión (posible)

Si los `WorkExecution` (registros de ejecución de WO) consumen stock directamente, agregar `WORK_EXECUTION` al enum. Actualmente: `SPARE_ORDER | WORK_ORDER | DEFECT | ADJUSTMENT`.

---

# 4. Conceptos realmente nuevos

Solo lo que genuinamente falta en el repositorio:

| Concepto nuevo | Justificación de "nuevo" | Complejidad estimada |
|---|---|---|
| **`EquipmentClass`** | No existe ningún catálogo de clases de equipo | Baja (catálogo simple) |
| **`System` / `SfiNode`** | Solo existe `sfiCode: String?` libre en `Asset`. Una jerarquía navegable no existe | Media (árbol padre-hijo) |
| **`TaskMaster`** | No existe biblioteca de tareas reutilizables. `MaintenancePlan` es instancia, no plantilla | Media |
| **`ClassTaskTemplate`** | Puente entre `EquipmentClass` y `TaskMaster`. No existe en ninguna forma | Baja (tabla de relación con frecuencias por defecto) |
| **`DueItem`** | El concepto de "actividad exigible antes de convertirse en WO" no existe como entidad. Hoy se infiere de `MaintenancePlan.nextDueDate` | Media (decisión: entidad o virtual) |
| **`WorkExecution`** | No hay registro estructurado de ejecución por WO. Solo `closeNotes: String?` | Media |
| **`RunningHoursLog`** | `DailyReport` registra horas por buque, no por equipo individual | Baja-Media (depende de decisión de granularidad) |
| **`Instrument`** | No hay catálogo de instrumentos de medición/calibración | Baja (catálogo simple) |
| **`InspectionTemplateMaster`** | La entidad `Inspection` del repo es para resultados de inspecciones externas. Una plantilla ejecutable con checklist estructurado no existe | Alta (entidad con items, criterios, límites) |
| **`InspectionChecklistItem`** | Sub-entidad de `InspectionTemplateMaster` con: tipo respuesta, valores límite, instrumento requerido, evidencia | Alta |
| **`InspectionExecution`** | Instancia ejecutada de una plantilla. Distinta de `Inspection` del repo (que es inspección externa) | Alta |
| **`InspectionExecutionItem`** | Resultado por ítem del checklist (lectura, pass/fail, observación) | Media |
| **`Finding`** (PMS) | Hallazgo operativo derivado de inspección PMS. Ver Sección 5 | Media (decisión: ¿es `Defect`?) |
| **`TaskSpare`** / relación Task-Spare | Repuestos sugeridos por `TaskMaster` o `EquipmentClass`. No existe | Baja (tabla de relación) |
| **`RiskAssessment`** | No existe. El spec lo menciona pero no es core. `Defect.operationalState` cubre riesgo básico | Posponer |

---

# 5. Riesgos de naming y semántica

Esta sección documenta los conflictos más importantes entre la nomenclatura del repo y los conceptos PMS.

---

## 5.1 Asset vs. Equipment

| | Repo | PMS spec |
|---|---|---|
| Nombre | `Asset` | "Equipment" o "Equipment Register" |
| Semántica | Equipo físico instalado en un buque | Igual |
| Conflicto | Ningún conflicto real — la semántica es idéntica | |

**Decisión**: Usar `Asset` en todo el código. No crear `Equipment`. Si la UI muestra "Equipment Register", es solo una etiqueta de presentación.

> **Riesgo real**: Si alguien crea un modelo `Equipment` separado creyendo que `Asset` es "algo diferente", se duplica toda la funcionalidad de registro de equipos. Documentar explícitamente que `Asset` = Equipment en el contexto GPMS.

---

## 5.2 Defect vs. Finding

Este es el conflicto semántico más complejo del sistema.

| | Repo | PMS spec |
|---|---|---|
| `Defect` | Deficiencia de equipo detectada por cualquier medio. Tiene severidad, estado, operational state, acciones correctivas. | Finding de nivel 2-3 (deficiencia que requiere intervención o condición crítica) |
| `InspectionLog` | Hallazgo de una inspección **externa/regulatoria** (InspectionLogEntryType: FINDING/ACTION/NOTE) | No equivale al finding PMS — es de inspecciones de terceros |
| `Finding` (PMS spec) | Hallazgo de una inspección **operativa interna** del plan PMS. Puede ser nivel 1 (observación menor), nivel 2 o nivel 3 | No existe como entidad separada |

**Análisis**:
- `Defect` es suficiente para Findings de nivel 2 y 3 del PMS (los que requieren intervención).
- El Finding de nivel 1 (observación menor, sin WO) es más liviano que un `Defect` completo. Sin embargo, modelarlo como `Defect` con severidad LOW + status OPEN funciona operativamente.
- Crear una entidad `Finding` separada implicaría duplicar parcialmente `Defect`.

**Recomendación**: Reutilizar `Defect` como finding operativo del PMS. Agregar al `Defect` una FK opcional a `InspectionExecutionId` para trazabilidad de origen.

**Riesgo de NO hacer esto**: Si se crea `Finding` como entidad nueva, habrá dos módulos para registrar deficiencias de equipo (`Defect` y `Finding`), lo que generará confusión operativa permanente.

---

## 5.3 Deferral vs. Deferment

| | Repo | PMS spec |
|---|---|---|
| Nombre | `Deferral` | "Deferment" o "Deferral" |
| Semántica | Postergación formal con flujo de aprobación | Igual |
| `sourceType` | `DEFECT | WORK_ORDER | MAINTENANCE_PLAN` | Mismo alcance |

**Conflicto**: Ninguno. Solo nomenclatura ligeramente diferente.
**Decisión**: Usar `Deferral` en todo el código.

---

## 5.4 MaintenancePlan existente vs. PMS Plan esperado

Este es el segundo conflicto más relevante.

| Aspecto | MaintenancePlan actual | PMS Plan esperado |
|---|---|---|
| Instancia | Por equipo (`assetId`) | Por equipo — igual |
| Triggers | HOURS/MONTHS/CONDITION/EVENT | CALENDAR/RUNNING_HOURS/CONDITION/EVENT — casi igual |
| Task type | No existe campo `taskType` | MAINTENANCE vs. INSPECTION — **diferencia crítica** |
| WO generation mode | No existe | DUE_ONLY/AUTO_WO/APPROVAL_WO — **diferencia crítica** |
| Relación con TaskMaster | No existe | Derivado de `TaskMaster` vía `ClassTaskTemplate` — **diferencia crítica** |
| Semántica base | Igual | Igual |

**Conclusión**: El modelo `MaintenancePlan` es la base correcta pero necesita extensión. Los campos faltantes son todos `nullable` en primera instancia, lo que permite migración sin romper datos existentes.

> **Trampa a evitar**: Crear `PmsMaintenancePlan` separado. Sería exactamente lo que el charter prohíbe.

> **Trampa a evitar**: Renombrar `triggerType` de MONTHS → CALENDAR. El spec usa "CALENDAR" pero MONTHS es más preciso para lo que ya está implementado. No renombrar sin necesidad real.

---

## 5.5 WorkOrder existente vs. semántica Corrective/Preventive del PMS

| Aspecto | WorkOrder actual | PMS spec |
|---|---|---|
| `type` | `PREVENTIVE \| CORRECTIVE \| INSPECTION` | Igual semánticamente |
| Estados | PLANNED/IN_PROGRESS/ON_HOLD/DEFERRED/CLOSED/CANCELLED | Falta: PENDING_APPROVAL, OPEN (post-aprobación), COMPLETED (pre-cierre formal) |
| Origen | Manual o desde `maintenancePlanId` | Automático (AUTO_WO), semi-automático (APPROVAL_WO), manual — mismo concepto |
| Anti-duplicación | No implementada | Obligatoria según spec |

**Conclusión**: La entidad `WorkOrder` es correcta. Los estados faltantes son los más críticos. La anti-duplicación es lógica de servicio, no de modelo.

---

## 5.6 Inspection existente vs. Inspection PMS

Esta es la colisión de nombres más peligrosa del sistema.

| | `Inspection` en el repo | Inspección PMS (operativa) |
|---|---|---|
| Tipos | SAFETY/TECHNICAL/REGULATORY/CLASS | Template-driven, por plan de mantenimiento |
| Quién la realiza | Inspector externo / autoridad / clase | Tripulación / técnico interno |
| Propósito | Cumplimiento regulatorio, clase, seguridad | Verificación operativa planificada |
| Modelo | Resultado con `InspectionLog` (hallazgos) | Checklist estructurado con items, lecturas, límites |
| Relación con WO | Vía `CapaSourceType.INSPECTION` | Genera Finding → puede generar Corrective WO |

**Conflicto real**: Las entidades se llaman igual pero son conceptualmente distintas.

**Opciones**:
1. Crear `InspectionTemplate`, `InspectionExecution`, `InspectionExecutionItem` como entidades nuevas (con prefijo para no colisionar).
2. Agregar un `type` discriminador a `Inspection` para distinguir REGULATORY vs. OPERATIONAL.

**Recomendación**: Opción 1 — entidades nuevas con nombres distintos (`PmsInspection*` o simplemente `InspectionTemplate`, `InspectionExecution`). Son semánticamente distintas y forzarlas a convivir en el mismo modelo sería un error de diseño.

---

## 5.7 Roles PMS vs. Roles existentes

El spec menciona: Super Admin, Company Admin, Superintendent, Captain, Chief Engineer, Vessel User.

Los roles actuales son: `TENANT_ADMIN`, `MAINTENANCE_MANAGER`, `TECHNICIAN_OPERATOR`, `INSPECTOR_COMPLIANCE`, `PROCUREMENT_STORE`, `AUDITOR_READONLY`.

**Mapping práctico**:

| Rol PMS spec | Rol actual equivalente |
|---|---|
| Super Admin | `PlatformRole.SUPERADMIN` |
| Company Admin | `TENANT_ADMIN` |
| Superintendent | `MAINTENANCE_MANAGER` |
| Captain | No existe (pero `MAINTENANCE_MANAGER` o `TENANT_ADMIN` cubre sus acciones) |
| Chief Engineer | `MAINTENANCE_MANAGER` |
| Vessel User / Technical User | `TECHNICIAN_OPERATOR` |

**Conclusión**: No crear roles nuevos. El mapeo es aceptable para la mayoría de flujos. Si en el futuro se necesita distinguir Captain de Chief Engineer con permisos distintos, se podrá extender el enum. Por ahora: no cambiar.

---

# 6. Recomendación mínima de integración

Para cada concepto importante, la decisión justificada:

| Concepto | Decisión | Justificación |
|---|---|---|
| **Vessel** | Reutilizar tal cual | Idéntico. No hay gap. |
| **System / SFI** | Crear `System` (nuevo, optional FK en Asset) | El campo actual es string libre. PMS necesita jerarquía navegable. Creación no invasiva: FK nullable. |
| **Equipment / Asset** | Reutilizar `Asset` | Semántica idéntica. Agregar FK `equipmentClassId` nullable. |
| **Equipment Class** | Crear `EquipmentClass` | No existe. Decidir primero: global vs. por tenant (bloqueante). |
| **Task Master** | Crear `TaskMaster` | No existe. Biblioteca de tareas reutilizables. |
| **Class Task Template** | Crear `ClassTaskTemplate` | No existe. Tabla de relación con frecuencias por defecto. |
| **Maintenance Plan** | Extender `MaintenancePlan` | Base correcta. Agregar: `taskMasterId?`, `taskType`, `woGenerationMode`, `leadTimeDays`. Campos nullable = migración segura. |
| **Inspection Plan** | Extender `MaintenancePlan` con `taskType=INSPECTION` | No crear un plan separado. El `woGenerationMode=DUE_ONLY` evita que genere WO automática. |
| **Due Item** | Modelar como vista derivada de `MaintenancePlan` primero | Empezar sin entidad física. Query: `where nextDueDate <= today + leadTimeDays AND status != INACTIVE`. Crear entidad `DueItem` solo si el flujo lo requiere para estadísticas o tracking independiente. |
| **Work Order** | Extender `WorkOrder` | Agregar estados faltantes. No crear `PmsWorkOrder`. |
| **Execution / Work Log** | Crear `WorkExecution` | No existe. Registro estructurado de lo realizado. |
| **Finding** | Reutilizar `Defect` con FK opcional a `InspectionExecutionId` | Evitar duplicación semántica. `Defect` ya cubre la funcionalidad. |
| **Inspection (PMS operativa)** | Crear `InspectionTemplate` + `InspectionExecution` + items | Nombres distintos de la entidad `Inspection` existente (que es para inspecciones externas). Son semánticamente distintas. |
| **Instrument** | Crear `Instrument` | No existe. Catálogo simple. |
| **Calibration** | Columnas en `Instrument` + alerta via `AiInsight` | No necesita entidad de historial en primera fase. |
| **Daily Report** | Reutilizar tal cual | Fuente de running hours por buque. |
| **Running Hours Log** | Decisión pendiente (bloqueante) | Si granularidad = por buque: usar `DailyReport`. Si = por equipo: crear `RunningHoursLog`. |
| **Risk Assessment** | Posponer | `Defect.operationalState` cubre el riesgo operativo básico. Crear si hay demanda real. |
| **RCA** | Reutilizar `RcaRecord` | Completo. No tocar. |
| **CAPA** | Reutilizar `CapaRecord` | Completo. No tocar. |
| **Deferral** | Reutilizar `Deferral` | Completo. No tocar. |
| **Spare** | Reutilizar `Spare` + extender relaciones | Agregar `itemType` (SPARE/CONSUMABLE). Crear tabla `TaskSpare` para sugerencias. |
| **Stock Movement** | Reutilizar `StockMovement` | Completo. Extender `MovementRefType` si es necesario. |
| **Dashboard KPI** | Crear nueva ruta `/pms-dashboard` | No reemplazar el dashboard existente. Nueva página con KPIs PMS específicos. |
| **AI Skill** | Extender `PromptCapability` enum + nuevos prompts | Infraestructura ya existe. 5 capabilities nuevas. |
| **AI Insight** | Extender `InsightType` + nuevas reglas en `insight-generator` | Motor ya en producción. Agregar 3-4 reglas PMS. |
| **Attachment** | Extender enum `AttachmentTarget` | Agregar targets para nuevas entidades. |
| **Domain Event** | Reutilizar sin cambios | Append-only. Emitir eventos de las nuevas entidades. |
| **Excel** | Extender módulo con nuevas entidades | Two-phase ya funciona. Agregar módulos PMS. |
| **Auth / RBAC / Tenancy** | No tocar | Los 6 roles cubren todos los flujos. |
| **Scheduler** | Extender con calendar trigger runner | Agregar segundo job al `setInterval` in-process existente. |
