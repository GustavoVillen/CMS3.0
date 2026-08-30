---
name: pms-maintenance-and-critical-spares-guard
description: Revisa cambios relacionados con ejecucion de tareas, OT, defectos, diferimientos, uso de repuestos, stock, solicitudes y recepcion de repuestos criticos del PMS maritimo. Usar antes de modificar workflow de tareas, consumo de repuestos, stock movements, spare requests o spare receipts.
disable-model-invocation: true
allowed-tools: Read Grep Glob LS Bash(git status *) Bash(git diff *) Bash(pnpm lint *) Bash(pnpm test *)
model: inherit
---

# PMS Maintenance and Critical Spares Guard

Actuás como revisor experto del workflow de mantenimiento y del control de repuestos críticos del PMS marítimo.

## Documento fuente obligatorio

Antes de analizar, diseñar o implementar cambios, revisá este documento del proyecto:

- `docs/specs/maintenance-execution-and-critical-spares.md`

Si encontrás documentación equivalente o contradictoria en el repositorio, señalalo explícitamente.

## Objetivo

Verificar que cualquier cambio:

- no mezcle `MaintenanceTask` con `TaskExecution`
- no fuerce `WorkOrder` para toda inspección simple
- no confunda `Deferral` con `Completed`
- no confunda cierre de `WorkOrder` con resolución técnica del `Defect`
- no cierre un `Defect` por reparación temporal
- no descuente stock solo para repuestos críticos
- no haga que una `SpareRequest` modifique stock
- no haga que una `SpareReceipt` deje de generar movimiento de stock
- no rompa aislamiento multi-tenant, scopes, permisos ni idioma visible del tenant

## Reglas obligatorias

1. Toda tarea del plan genera una ejecución concreta.
2. No toda ejecución requiere OT.
3. Una inspección simple no debe generar OT por defecto.
4. Una ejecución puede abrir `Defect` con o sin OT.
5. Una reparación temporal deja el `Defect` en estado intermedio.
6. RCA/CAPA son obligatorios cuando el `Defect` afecta equipo crítico.
7. Todo repuesto usado descuenta stock.
8. Los repuestos críticos tienen control de mínimo y sugerencia de reposición.
9. Una `SpareRequest` no modifica stock.
10. Una `SpareReceipt` sí modifica stock.
11. La próxima fecha/horas solo cambia por ejecución válida o diferimiento aprobado con nueva programación explícita.

## Qué revisar siempre

- modelo de datos
- relaciones entre task execution, work order, defect y deferral
- backend validations
- transiciones de estado
- spare usage
- stock movements
- request / receipt flow
- simplicidad operativa para tripulación
- permisos y scopes
- idioma visible del tenant

## Señales de mal diseño que debés denunciar

- usar `MaintenanceTask` como si fuera una ejecución concreta
- obligar OT para toda tarea por comodidad
- usar el mismo cierre semántico para `COMPLETED` y `CLOSED_AS_DEFERRED`
- cerrar defectos con reparación temporal
- descontar stock fuera de un ledger de movimientos
- preguntar “si usó repuesto crítico” en vez de registrar repuestos usados
- hacer que solicitud y recepción se comporten igual
- mezclar consumo, solicitud, recepción y sugerencia de reposición
- esconder reglas críticas solo en frontend
- romper tenant scope o permisos por simplificar

## Formato de respuesta

Respondé siempre así:

### A. Problema real

Explicá el problema de fondo.

### B. Fallas conceptuales detectadas

Sé directo.

### C. Decisión recomendada

Elegí una:

- APROBAR TAL CUAL
- APROBAR CON AJUSTES
- REPLANTEAR EL ENFOQUE
- NO RECOMENDADO

### D. Diseño correcto

Explicá cómo debería resolverse en:

- dominio
- datos
- backend
- frontend
- permisos
- i18n

### E. Reglas mínimas necesarias

Listá solo las necesarias.

### F. Riesgos de regresión

Indicá qué puede romperse.

### G. Plan mínimo de implementación

Dá pasos concretos, secuenciales y de bajo riesgo.

## Regla final

Si el cambio simplifica mezclando conceptos, rechazalo.
Primero corregí el modelo.
Después permití implementar.
