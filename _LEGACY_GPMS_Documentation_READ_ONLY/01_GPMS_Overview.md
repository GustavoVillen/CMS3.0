# GPMS / Mercurio PMS - Visión General

## 1. Resumen ejecutivo
GPMS es un sistema de gestión de mantenimiento planificado implementado sobre Google Apps Script, Google Sheets, Google Drive y una interfaz web HTML/CSS/JavaScript. En el código y en la documentación coexisten dos denominaciones:

- `GPMS (Gas Planned Maintenance System)` en documentos de adopción y manuales de usuario.
- `Mercurio PMS` en la interfaz, el backend y el manual maestro de mantenimiento.

Ambos nombres refieren al mismo ecosistema funcional.

## 2. Propósito y alcance
El sistema centraliza la gestión técnica y documental de mantenimiento de una flota fluvial, cubriendo:

- Inventario técnico de activos por embarcación y por SFI.
- Plan maestro de mantenimiento preventivo, correctivo y por condición.
- Órdenes de trabajo y cierre técnico con evidencia.
- Inspecciones periódicas y su historial.
- Registro de fallas, diferimientos, RCA y CAPA.
- Repuestos críticos, pedidos y recepción.
- Reporte diario operacional con horas, consumos, hallazgos e insights.
- Gestión documental y evidencia PDF/Drive.
- Evaluación asistida por IA para RCA, barreras y diferimientos.

El alcance operativo está alineado al manual `MERCURIO_MANUAL2.0` y a procedimientos `PROC-MAN-*`, con foco en trazabilidad, seguridad operacional, control documental y preparación de auditorías.

## 3. Usuarios objetivo
Los usuarios identificables por el sistema y la documentación son:

- Gerencia técnica.
- Superintendentes.
- Inspectores y usuarios de mantenimiento.
- Jefes de máquinas y capitanes.
- Auditores o perfiles de solo lectura.
- Administradores del sistema.

El control de acceso no depende solo de la cuenta Google: se administra mediante la tabla `_USERS`, con `USER_ID`, contraseña, rol, permisos y scopes de embarcación/activo/unidad.

## 4. Funcionalidades principales
### 4.1 Operación técnica
- Gestión de flota y activos.
- Identificación y clasificación de criticidad A/B/C.
- Programación de tareas por horas y/o meses.
- Seguimiento de vencimientos, backlog y estados visibles.
- Creación y seguimiento de órdenes de trabajo.

### 4.2 Control de fallas y riesgo
- Registro estructurado de defectos.
- Evaluación de barreras operativas.
- Gestión de diferimientos con restricciones NO-GO.
- RCA asistido por IA.
- Gestión CAPA.

### 4.3 Evidencia y trazabilidad
- Generación de PDFs operativos.
- Subida de archivos a Google Drive.
- Log de auditoría y movimientos de stock.
- Relación entre tareas, OTs, defectos, diferimientos e inspecciones.

### 4.4 Inteligencia operativa
- Asistente general Mercurio AI.
- Entrevistas guiadas para RCA y defectos.
- Evaluación IA de plazo/riesgo para diferimientos.
- Resúmenes ejecutivos e insights de mantenimiento en reportes diarios.

## 5. Beneficios operativos
- Unifica registros técnicos y documentales en un solo entorno.
- Reduce dispersión de hojas, documentos y PDFs aislados.
- Hace visible el backlog operacional en tiempo casi real.
- Refuerza el cumplimiento documental y la preparación SIRE/Inspection Ready.
- Facilita análisis asistidos por IA en defectos complejos.
- Mejora la trazabilidad entre evento, diagnóstico, acción, evidencia y cierre.

## 6. Tecnologías utilizadas
| Capa | Tecnología | Uso principal |
|---|---|---|
| Backend | Google Apps Script (V8) | Lógica de negocio, APIs, autenticación, generación documental |
| Base de datos | Google Sheets | Tablas transaccionales y maestras |
| Gestión documental | Google Drive / DocumentApp | Evidencias, PDFs, checklist y documentos controlados |
| Frontend | HTML5, CSS3, JavaScript | UI, dashboards, modales, formularios |
| Mapas | Leaflet + OpenStreetMap | Vista de recorrido / route view |
| IA | Gemini API | Asistente, RCA, defectos, barreras, insights |
| DevOps | clasp | Despliegue del proyecto GAS |

## 7. Integraciones con Google Workspace
- `Google Sheets` como persistencia principal.
- `Google Drive` como repositorio de evidencias y PDFs.
- `Google Docs` para generación de documentos y exportación PDF.
- `HtmlService` para servir la web app.
- `ScriptApp.getOAuthToken()` para integración con Google Picker.

## 8. Artefactos relevantes del repositorio
### Código fuente
- `pms-gas-webapp/Code.js`
- `pms-gas-webapp/DB.js`
- `pms-gas-webapp/AI.js`
- `pms-gas-webapp/SetupDB.js`
- `pms-gas-webapp/index.html`
- `pms-gas-webapp/Login.html`
- `pms-gas-webapp/Script.html`
- `pms-gas-webapp/Styles.html`

### Artefactos documentales
- `gpms_intro_email.md`
- `gpms_user_manual.md`
- `Manual/MERCURIO_MANUAL2.0.txt`
- `Manual/SFI Codes.gsheet`
- `Database/MERCURIO_PMS_DB_CORE.gsheet`
- `Check Lists/` con PDFs y checklists reales de operación.

## 9. Observaciones importantes para regeneración del sistema
- En el repositorio actual, `pms-gas-webapp/public/` existe pero está vacío; los archivos fuente reales están en `pms-gas-webapp/`.
- El sistema está fuertemente acoplado a IDs de Google Sheets, Drive y Docs configurados en código.
- La lógica de negocio está concentrada principalmente en `DB.js` y la lógica de UI en `Script.html`.
- La documentación histórica y el código no siempre coinciden 1:1, por lo que la regeneración debe tomar como fuente primaria el código y como fuente normativa el manual maestro.

## 10. Conclusión
GPMS es un PMS digital operativo construido para una organización con fuerte dependencia de trazabilidad documental, auditoría, criticidad técnica y evidencia de campo. Su arquitectura es pragmática y funcional, pero monolítica. Esto lo vuelve una buena base para evolución incremental o para una futura reimplementación en una plataforma más modular como Antigravity.
