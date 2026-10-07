# Pre-vetting Shell — MAO 01 (oct 2026)

Meta: responder la parte de mantenimiento del checklist pre-vetting de Shell para MAO 01
(remolcador) con evidencia del CMS3, en una carpeta PDF impresa (índice punto por punto +
evidencias detrás). Si falta un plan: proponerlo y cargarlo.

Estado 05-oct: diagnóstico hecho sobre la base LOCAL (producción no se pudo leer: permiso
denegado). Falta: confirmar contra producción, aprobar planes, cargarlos, armar carpeta, imprimir.

## Diagnóstico (base local)

MAO 01: 71 equipos, 196 planes activos, 708 OT cerradas, 13 defectos.
142 planes borrados por admin@mercurio.com entre 21-jun y 09-sep (consolidación). Entre ellos:
Mantenimiento anual de extintores (M01-EXTINT, M01-3-003), Servicio anual de balsas (M01-3-004/005),
detección mensual/trimestral (M01-DET-HUMO-01/02/S01), motobomba portátil (M01-MBBA-PORT-01/02),
CO2 control mensual (M01-CO2-01), inspección periódica de clase (M01-0-002),
prueba de válvula de seguridad del compresor (M01-COMP-NK40-11).

### Cubierto
- Plan de mantenimiento + registros (OT cerradas).
- Certificado de Clase RINA (CERT-M01-026, vence 15-03-2029) — sin archivo adjunto.
- Elementos de elevación: certificación SWL anual.
- Malacate de pluma: prueba anual.
- Tubería de embarque de combustible: prueba hidráulica anual con certificado.
- Detección de incendio: inspección anual.
- Bomba de incendio principal: prueba anual.
- Amarre: inspección antes de cada maniobra + 3/6/12 meses.

### Vencido o que va a llamar la atención
- Clase INTERMEDIA: vencida 15-03-2026, sin fecha de realización cargada.
- Bomba incendio emergencia: prueba de presión 6 meses con fecha centinela 2000.
- Bomba incendio principal (recorridos), purificadora, ventiladores: fechas 2000.
- Radar Babor servicio 6m (vencido 18-06), Radar Estribor magnetrón (vencido, sin horas).
- VHF Babor y Estribor (vencidos), tablero eléctrico instrumental (vencido 23-02),
  filtro hidráulico de gobierno (16-03), inspecciones mensuales casco y máquinas (01-08).
- Inspección estructural de espacios internos (coff/piques/tanques): nunca ejecutada.

### Sin plan
Extintores, balsas (x2), motobomba de incendio portátil, CO2 inspección anual,
prueba de detectores con aerosol y pistola de calor, mangueras de incendio, medición de
espesores, horas de magnetrón (radares sin horómetro), luces de navegación + alarma de luz
quemada (no hay equipo), luces portátiles del convoy, bomba neumática portátil de derrame,
instrumentos de medición / detector de gases (calibración).

## Planes propuestos (pendiente de aprobación)

| Equipo | Tarea | Frec. | Tipo | Depto |
|---|---|---|---|---|
| Extintores Portátiles y Semiportátiles | Inspección visual (presión, precinto, ubicación) | 1 m | INSPECTION | CUBIERTA |
| Extintores Portátiles y Semiportátiles | Control y recarga anual por empresa habilitada, con certificado | 12 m | MAINTENANCE | PROVEEDOR |
| Balsa Salvavidas Babor / Estribor | Servicio anual en estación habilitada, con certificado | 12 m | INSPECTION | PROVEEDOR |
| Balsa Salvavidas Babor / Estribor | Renovación de la unidad de liberación hidrostática | 24 m | MAINTENANCE | CUBIERTA |
| Motobomba de Incendio EGA Portátil | Prueba de arranque y descarga con manguera | 1 m | INSPECTION | CUBIERTA |
| Motobomba de Incendio EGA Portátil | Cambio de aceite, combustible y filtros | 6 m | MAINTENANCE | MAQUINAS |
| Sistema Fijo de CO2 | Inspección anual por empresa habilitada (pesaje de botellones), con certificado | 12 m | INSPECTION | PROVEEDOR |
| Sistema de Deteccion de Incendio | Prueba de la totalidad de detectores con aerosol de humo y pistola de calor, zonas identificadas en central | 3 m | INSPECTION | MAQUINAS |
| Bomba de Incendio Principal | Prueba de presión de mangueras y lanzas de incendio | 12 m | INSPECTION | CUBIERTA |
| Radar de Babor / Estribor | Service anual por proveedor: certificado con fecha de cambio de magnetrón y horas | 12 m | INSPECTION | PROVEEDOR |
| Inspeccion de Sociedad Clasificadora | Medición de espesores de casco refrendada por la Clase | 60 m | INSPECTION | PROVEEDOR |
| NUEVO: Luces de navegación | Prueba de luces y de la alarma de luz quemada | 1 m | INSPECTION | CUBIERTA |
| NUEVO: Luces portátiles del convoy | Prueba de funcionamiento y baterías | 1 m | INSPECTION | CUBIERTA |
| NUEVO: Bomba neumática portátil de derrames | Prueba de funcionamiento | 3 m | INSPECTION | CUBIERTA |
| NUEVO: Detector de gases / instrumentos de medición | Calibración por empresa habilitada, con certificado | 12 m | INSPECTION | PROVEEDOR |

## Pendientes de definir
1. Acceso a producción (lectura para diagnóstico/evidencias, escritura para cargar planes).
2. Si los planes borrados de extintores/balsas/detección/motobomba fueron a propósito.
3. Impresora y cantidad de copias.

## Hecho 05-oct (producción)
- Respaldo previo: VPS /root/backups-cms3/prevetting-m01-antes-20261005-2041.sql.gz (Asset + MaintenancePlan).
- Repuestos (deletedAt=null, audit MaintenancePlan.restored): M01-3-003, 3-004, 3-005, DET-HUMO-02 (retitulado: totalidad con aerosol y pistola de calor), DET-HUMO-03, DET-HUMO-04, MBBA-PORT-01.
- NO repuestos a propósito: mensuales de detección, CO2, extintores y luces de navegación (ya están en los checklists mensuales M01-1-003 / M01-6-002). Radar: ya tenía plan de magnetrón (RADAR-xx-02).
- Equipos nuevos: M01-LUC-CONV, M01-BBA-DERR, M01-DET-GAS.
- Planes nuevos (pendientes desde 05-oct): BALSA-BR/ER-HRU, CO2-ANUAL, MANG-INC-01, 0-ESPES, LUC-CONV-01, BBA-DERR-01, DET-GAS-01.
- MAO 01: 155 -> 170 planes activos.
- Carpeta: MisDocs/MAO01/Vetting/Pre-vetting Shell 2026-10 (índice 26 pág, 39 evidencias, carpeta completa 119 pág).
- Pendiente: 13 registros a completar (lista en la última hoja del índice); regenerar la carpeta cuando se carguen.

## Resto de la flota (05-oct, producción)
Respaldo: VPS /root/backups-cms3/prevetting-flota-antes-20261005-2109.sql.gz
- MAO 02: 247 -> 259. Repuesto equipo CO2 + prueba hidráulica de botellones; equipos nuevos Extintores, Balsas, luces convoy, bomba derrames, detector de gases; 11 planes nuevos (incluye prueba mensual de motobomba portátil).
- LATERE: 345 -> 357. Mismos equipos nuevos; 12 planes nuevos (incluye análisis de espumígeno: tiene bomba de espuma).
- DON CHICUETO: 383 -> 408. EXCEPCIÓN a "sólo la planilla" pedida por Gustavo: 16 planes y 4 equipos repuestos (balsas, extintores, elevación, tubería, detección, CO2, espacios internos, bomba incendio emergencia, magnetrón, amarre) + 4 equipos y 9 planes nuevos (incluye luces de navegación: DCH no tiene inspección mensual de cubierta).
- Carpetas: MisDocs/<MAO02|LTE|DCH>/Vetting/Pre-vetting Shell 2026-10. Pendientes: MAO 02 12, LATERE 33, DON CHICUETO 37.

## MAO 01 con formularios oficiales (05-oct)
- Carpeta regenerada: índice en documento controlado (sin código REGI: el SGS no tiene formulario de pre-vetting) + por tarea el formulario PLAN DE MANTENIMIENTO y su última OT REGI-MAN-02.4. 65 evidencias, 184 páginas. Se dejaron de usar los informes "Plan e historial".
- Corregido sfiGroupNumber de los 36 planes nuevos de la flota (300 -> 3, etc.).
- LOTO, permiso, riesgo y RCM completados con los servicios del botón "Sugerir" en 9 planes de M01 que los tenían vacíos.
- Pendiente: el formulario Plan de Mantenimiento muestra "Embarcacion M01" (código, no nombre). Las otras 3 carpetas siguen en el formato anterior.

## Auditoría de la carpeta MAO 01 (05/06-oct)
Respaldo previo: VPS /root/backups-cms3/prevetting-fechas-antes-20261006-0007.dump (MaintenancePlan, WorkLog, WorkOrder).
- 512 de los 520 registros WL-DR del 01/07/2026 (un reporte diario creó 520 en 1 s) pasaron a la fecha de su OT; 8 sin OT quedaron (sólo M01-6-002 en la carpeta, ya no se imprime).
- 25 planes alineados con su última OT (fechas 2000, fecha 01/07 artificial, o OT más nueva). 22 con OT más vieja que el plan se respetan: las OT viejas tienen fecha de LOTE mensual (117 el 20/11/2025, 55 el 11/05/2026...).
- Gustavo confirmó planilla en TUB-COMB-01, ELEV-02, DET-HUMO-03, MBBA-PORT-02: se registró la ejecución con quickClosePlan (AUTO_WO -> sólo WorkLog, sin OT). En el índice la OT figura como "OT anterior".
- 16 OT históricas completadas con lo que el sistema hereda del plan (tipo, áreas, sistema, tarea concluida, descripción, LOTO, riesgo).
- Horas estimadas cargadas en 11 planes; área deducida del responsable en 3.
- Código: 50c465b (plan: nombre del buque), 5738c6f (OT sin "00:00 - 00:00"), 732d2ab (plan: última ejecución = OT más reciente), 632ff58 (pie OT con nombre), 87f7ce6 (scripts/prevetting-carpeta.ts). Producción y demo actualizadas.
- Queda: "Admin Mercurio" como generador/firma en 16 OT históricas (decisión de Gustavo); 14 registros a completar.
