# Funcionalidades y Módulos

## 1. Inventario / Gestión de Activos
### Descripción
Gestiona el inventario SFI de equipos, criticidad, metadatos técnicos y condición operativa.

### Entradas
- datos del activo;
- embarcación;
- SFI;
- criticidad;
- atributos Ex/certificación.

### Salidas
- registro persistido en `ASSETS`;
- estado operativo actualizado;
- asociación con plan y defectos.

### Procesos
- alta/edición de activo;
- normalización SFI;
- referencia a catálogo SFI;
- reconciliación de estado según defectos abiertos.

### Archivos involucrados
- `DB.js`
- `Script.html`
- `Styles.html`

## 2. Planificación de Mantenimiento
### Descripción
Administra el `MAINTENANCE_PLAN`, con tareas por fecha y/o horas, responsable, evidencia requerida y próximos vencimientos.

### Entradas
- `TaskID`, `SFI`, `VesselName`;
- `Frecuencia_HS`, `Frecuencia_Meses`;
- fechas/horas de última ejecución;
- estado manual/calculado.

### Salidas
- plan maestro persistido;
- vinculación con OT abierta (`OT_ID`);
- backlog de tareas y vencimientos.

### Procesos
- alta/edición de tarea;
- generación/sincronización de IDs;
- cálculo o sincronización de vencimientos;
- sincronización con OTs.

### Archivos involucrados
- `DB.js`
- `Script.html`

## 3. Órdenes de Trabajo
### Descripción
Permite planificar, ejecutar, diferir y cerrar intervenciones sobre activos.

### Entradas
- Task de origen o activo objetivo;
- prioridad;
- criticidad;
- datos de ejecución y cierre;
- evidencia técnica.

### Salidas
- registro `WORK_ORDERS`;
- PDF apertura/cierre/diferimiento;
- actualización de plan maestro, activos y defectos relacionados.

### Procesos
- creación OT preventiva/correctiva;
- validación de cierre crítico;
- carga de repuestos consumidos;
- actualización de última ejecución en plan maestro.

### Archivos involucrados
- `DB.js`
- `Script.html`
- `Code.js`

## 4. Inspecciones
### Descripción
Gestiona tareas periódicas de inspección y su histórico de ejecución.

### Entradas
- definición de tarea inspección;
- frecuencia;
- checklist;
- resultado y evidencia.

### Salidas
- `INSPECTIONS`;
- `INSPECTIONS_LOG`;
- posible OT asociada si hay falla.

### Procesos
- creación de plan de inspecciones;
- autoasignación `TaskID`;
- cálculo `FREQS/FREQM`;
- actualización de próxima revisión.

### Archivos involucrados
- `DB.js`
- `Script.html`

## 5. Defectos
### Descripción
Registra fallas técnicas, síntomas, acciones inmediatas y vínculo con OT, RCA y diferimientos.

### Entradas
- embarcación;
- SFI;
- clasificación A/B/C;
- descripción de síntoma;
- estado operativo;
- medidas compensatorias;
- evidencia.

### Salidas
- `DEFECT_LOG`;
- PDF de defecto;
- actualización de `ASSETS.Status`;
- disparo de RCA/OT si corresponde.

### Procesos
- análisis de recurrencia;
- integración con IA de defectos;
- barreras asociadas;
- sincronización con inventario y OT.

### Archivos involucrados
- `DB.js`
- `Script.html`
- `AI.js`

## 6. Reportes diarios
### Descripción
Consolida datos operacionales diarios, horas, consumos, hallazgos y resumen ejecutivo.

### Entradas
- fecha/hora;
- embarcación;
- horas MP/MG;
- condiciones operativas;
- consumos;
- anomalías.

### Salidas
- `DAILY_REPORTS`;
- PDF diario;
- insights IA;
- actualización de índice de horas para mantenimiento.

### Procesos
- guardado profundo del reporte;
- resumen ejecutivo;
- mantenimiento predictivo básico mediante insights.

### Archivos involucrados
- `DB.js`
- `Script.html`
- `AI.js`

## 7. Checklists
### Descripción
Incluye listas de inspección y documentos de control pre-transferencia y de operación.

### Entradas
- links a checklist Drive;
- archivos/documentos asociados.

### Salidas
- referencias en `INSPECTIONS`, OTs y otros módulos;
- evidencia documental en `Check Lists/`.

### Procesos
- carga de links o uploads;
- apertura directa de documentos;
- uso como evidencia o base operativa.

### Archivos involucrados
- `Script.html`
- `DB.js`
- carpetas `Check Lists/CHKLST`, `Check Lists/OT`, `Check Lists/DAILY_REPORTS`.

## 8. Gestión documental
### Descripción
El sistema no solo guarda datos: genera y relaciona documentos controlados y evidencias.

### Entradas
- datos del proceso técnico;
- uploads locales;
- documentos en Drive.

### Salidas
- PDFs institucionales;
- links persistidos en tablas;
- trazabilidad documental.

### Procesos
- generación en Google Docs;
- exportación a PDF;
- guardado en carpetas aprobadas.

### Archivos involucrados
- `DB.js`
- `Code.js`
- `Check Lists/`

## 9. Evidencia fotográfica
### Descripción
Permite adjuntar fotos, evidencias técnicas y documentos a defectos, OTs y reportes.

### Entradas
- archivos locales;
- selección desde Google Drive/Picker.

### Salidas
- URLs en columnas de evidencia;
- archivo almacenado en Drive.

### Procesos
- upload base64 -> Drive;
- persistencia de URL en registro correspondiente.

### Archivos involucrados
- `Script.html`
- `DB.js`

## 10. Gestión de repuestos
### Descripción
Controla stock crítico, pedidos, recepción y consumo por OT.

### Entradas
- SKU y stock;
- mínimos, safety stock y ROP;
- pedidos y recepciones;
- consumo durante mantenimiento.

### Salidas
- `SPARES`, `SPARE_ORDERS`, `_STOCK_MOVEMENTS` actualizados;
- estados de stock;
- PDFs de solicitud/recepción.

### Procesos
- cálculo de estado de repuesto;
- descuento por consumo;
- ingreso automático al recibir pedido.

### Archivos involucrados
- `DB.js`
- `Script.html`

## 11. Gestión de proveedores
### Descripción
Administra proveedores críticos, evaluación post-job y no conformidades.

### Entradas
- alta de proveedor;
- evaluación de desempeño;
- NC detectadas.

### Salidas
- tablas de proveedor y evaluación actualizadas;
- historial de cumplimiento.

### Procesos
- registro de proveedor;
- scoring;
- seguimiento de desvíos.

### Archivos involucrados
- `DB.js`
- `Script.html`
- `SetupDB.js`

## 12. Certificados
### Descripción
Controla documentación certificatoria por embarcación y sus vencimientos.

### Entradas
- certificado;
- fecha de emisión;
- fecha de vencimiento;
- PDF/link.

### Salidas
- `CERTIFICATES` con `Estado_Visible`;
- snapshot de vencimientos en dashboard.

### Procesos
- alta/edición de certificado;
- cálculo de próximo vencimiento/vencido.

### Archivos involucrados
- `DB.js`
- `Script.html`

## 13. Integración con IA
### Descripción
La IA es una capacidad transversal del sistema, no un módulo aislado.

### Entradas
- prompts del usuario;
- historial conversacional;
- manual corporativo;
- contexto de tablas;
- payloads de defecto/OT/reporte diario.

### Salidas
- RCA sugerido;
- diagnóstico inicial;
- entrevista de barreras;
- evaluación de diferimiento;
- resumen ejecutivo e insights.

### Procesos
- llamada a Gemini;
- recuperación de contexto;
- parseo robusto de respuestas JSON.

### Archivos involucrados
- `AI.js`
- `Script.html`
- `DB.js`

## 14. Resumen de módulos por archivos
| Módulo | Backend | Frontend | Documentos/Evidencia |
|---|---|---|---|
| Activos | `DB.js` | `Script.html`, `Styles.html` | `Manual/SFI Codes.gsheet` |
| Plan mantenimiento | `DB.js` | `Script.html` | `MERCURIO_MANUAL2.0.txt` |
| OT | `DB.js` | `Script.html` | `Check Lists/OT` |
| Inspecciones | `DB.js` | `Script.html` | `Check Lists/CHKLST` |
| Defectos | `DB.js`, `AI.js` | `Script.html` | `Check Lists/DEFECTOS` |
| Reporte diario | `DB.js`, `AI.js` | `Script.html` | `Check Lists/DAILY_REPORTS` |
| Repuestos | `DB.js` | `Script.html` | `Check Lists/ORD` |
| Proveedores | `DB.js`, `SetupDB.js` | `Script.html` | hojas auxiliares |
