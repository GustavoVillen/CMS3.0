# Skills y Capacidades del Sistema

## 1. Capacidades funcionales centrales
GPMS combina gestión técnica, control documental y automatización operativa. Sus capacidades observadas pueden agruparse en los siguientes skills funcionales.

## 2. Skill: Registro técnico estructurado
### Qué hace
- modela entidades operativas en tablas consistentes;
- estandariza formularios por dominio;
- mantiene IDs funcionales trazables.

### Valor
- reduce registro libre no controlado;
- mejora consistencia entre operación y auditoría.

## 3. Skill: Planificación de mantenimiento
### Qué hace
- programa tareas por fecha y/o por horas;
- proyecta próximos vencimientos;
- vincula la tarea con una OT abierta.

### Capacidades específicas
- `TaskID` como ancla funcional;
- soporte de backlog y vencimientos;
- sincronización con horas reales desde reporte diario.

## 4. Skill: Ejecución controlada de órdenes de trabajo
### Qué hace
- crea OT preventivas y correctivas;
- valida cierres críticos;
- obliga evidencia y verificación en escenarios sensibles.

### Valor
- traslada reglas del procedimiento al sistema;
- disminuye cierres incompletos.

## 5. Skill: Gestión de defectos y riesgo operacional
### Qué hace
- registra fallas con criticidad;
- actualiza estado operativo del activo;
- habilita o bloquea diferimientos según contexto.

### Capacidad distintiva
- integración de barreras y NO-GO dentro del mismo flujo técnico.

## 6. Skill: Automatizaciones inteligentes
### Automatizaciones observadas
- sincronización de `OT_ID` abierta en `MAINTENANCE_PLAN`;
- sincronización de estados visibles;
- actualización de horas/proyecciones por reporte diario;
- cierre cruzado de defecto/diferimiento al cerrar OT;
- consumo y reposición de repuestos;
- generación automática de IDs;
- generación automática de PDFs.

## 7. Skill: Validación de datos
### Reglas relevantes
- login solo para usuarios activos;
- escritura restringida por rol y scope;
- bloqueo de diferimiento si `Declarado_NoGo`;
- validación de cierre de OT crítica con evidencia y verificador;
- whitelisting de carpetas de upload;
- unicidad de `TaskID` en inspecciones.

## 8. Skill: Trazabilidad operativa
### Elementos trazables
- `TaskID -> OT_ID`;
- `OT_ID -> Defecto_ID`;
- `Defecto_ID -> RCA_ID / Deferral_ID`;
- links PDF/evidencia en Drive;
- `_AUDIT_LOG`;
- `_STOCK_MOVEMENTS`.

## 9. Skill: Gestión documental
### Qué hace
- sube archivos a carpetas aprobadas;
- genera documentos y PDFs institucionales;
- relaciona evidencia con registros operativos;
- aprovecha manuales y checklists como documentos vivos.

### Limitación
El control documental es fuerte a nivel conceptual, pero el repositorio observado muestra duplicados y nombres no siempre normalizados.

## 10. Skill: Asistencia basada en IA
### Capacidades observadas
- chat técnico general;
- wizard RCA;
- wizard de defectos;
- entrevista de barreras;
- evaluación IA de diferimientos;
- insights y resumen ejecutivo en reporte diario.

### Datos usados
- manual corporativo;
- estructura de base de datos;
- historial de conversación;
- payload contextual del módulo invocante.

## 11. Skill: Escalabilidad funcional
### Lo que ya soporta
- alta de nuevas embarcaciones y activos;
- nuevas tareas de mantenimiento e inspección;
- nuevas tablas via `ensureHeaders`;
- múltiples dominios funcionales dentro de una sola app.

### Restricciones
- escalabilidad técnica limitada por el monolito Apps Script + Sheets;
- alto acoplamiento a nombres de columnas y IDs del entorno.

## 12. Skill: Seguridad y permisos
### Capacidades implementadas
- autenticación interna por `USER_ID`;
- hash de contraseña;
- permisos por rol;
- scopes por activo/embarcación/unidad;
- control de escritura por tabla;
- uploads restringidos a carpetas aprobadas.

## 13. Capacidad de regeneración y migración
El sistema ya expresa varias reglas de negocio de forma explícita en código, por lo que es un buen candidato para regeneración mediante Antigravity si se preservan:

- nombres de entidades y campos clave;
- workflows cross-module;
- jerarquía documental;
- criterios de permisos;
- catálogo de estados visibles y canónicos.

## 14. Matriz resumida de capacidades
| Capacidad | Estado actual | Observación |
|---|---|---|
| Gestión de activos | Alta | Bien integrada con SFI |
| Planificación | Alta | Fuerte acoplamiento a Sheet |
| OT | Alta | Buen nivel de validaciones |
| Defectos y diferimientos | Alta | Muy buen valor operativo |
| RCA/CAPA | Media-Alta | IA agregada, aún monolítica |
| Repuestos | Media-Alta | Bien acoplada a OT |
| Documentación | Alta | PDF/Drive operativos |
| Seguridad | Media | correcta, pero mejorable |
| Escalabilidad | Media-Baja | limitada por arquitectura |
