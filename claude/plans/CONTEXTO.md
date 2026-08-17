# Alineación de los planes de mantenimiento con las planillas de a bordo

Dos buques del tenant `mercurio`: **LATERE (LTE)** — terminado — y
**DON CHICUETO (DCH)** — en curso. Mismos criterios en los dos.

---

# LATERE (LTE) — TERMINADO

**Objetivo:** que el plan cargado en el VPS (PlanB) refleje el plan en papel del buque
(PlanA = `MisDocs/LTE/Mantenimiento/PLAN DE MANT. LTE - JULIO.xlsx`, 12 hojas, ~341 tareas).

## Por qué hizo falta

El plan del LTE se había dado de alta clonando el de otro buque. Los 4 motores principales
estaban fichados como **Volvo Penta D16 MH** cuando el LATERE tiene **Cummins KTA-50**: las
frecuencias cargadas eran de otro motor y faltaban tareas. Además casi ningún plan tenía
fecha de última ejecución ni de vencimiento (sólo 12 de 207).

## Criterios acordados con Gustavo (2026-08-17)

1. **Corregir todo según el PlanA**: se pisan frecuencias, títulos y tareas de los planes
   existentes, se separan los ítems que estaban agrupados y se crea lo que falta.
2. **Activos faltantes: crearlos.** El PlanA tiene ~16 equipos sin activo en el sistema
   (6 transformadores 380/220, barómetro, ecosondas babor y estribor, chiller, equipo tifón,
   termotanque, bomba de espuma, separador de aguas oleosas, cabrestantes de POPA BR/ER,
   molinete ancla popa, electrobomba trasvase AUX, electrobomba incendio AUX, servo motores
   1 y 2, aparejo eléctrico de pluma).
3. **Rutinas consolidadas**: UN solo plan para todas las tareas DIARIO, otro para todas las
   SEMANAL y otro para todas las de 15 DÍAS, con todas las tareas unidas en el campo TAREAS.
   (Pendiente: se arma al final, cuando estén relevadas las 12 hojas.)
4. **Sobrantes del PlanB**: los ~60 planes que no figuran en el PlanA (casco, CO2, detección
   de incendio, hélices, botellones, purificadora, NK40, motor auxiliar de puerto, elementos
   de elevación, válvulas de gran achique…) **no se tocan**; van listados en el informe final.
5. **Todos los planes**: área = MAQUINAS, responsable = "Jefe de Máquinas",
   triggerResultMode = AUTO_WO (todos abren OT), y criterios de aceptación / LOTO /
   riesgo / RCM generados con IA.
6. **Ejecución por tandas, hoja por hoja**, con visto bueno entre tanda y tanda.

## Cómo leer el Excel (ya resuelto, no re-deducir)

- Hojas de motores: `E` = "Última verificación" es la ejecución ANTERIOR; `F` = "Hora de
  cambio Act." es la MÁS RECIENTE; `H` = "Próximo recorrido" es el vencimiento. **Manda H**,
  y la hora de última ejecución se toma de F o E según cuál cierre `H − frecuencia`
  (hay errores de tipeo en E/F: huelgo axial de N02, N03 y N04).
- La fecha real de la última ejecución sale de la columna del mes ("22/JUL/2026 08:00").
- Resto de las hojas: "Recorrido Actual" es la última ejecución y "Próximo recorrido" el
  vencimiento; ambas son fechas.
- "Tomar muestras" es C/CAMBIO → hereda horas del cambio de aceite del mismo motor.

## Scripts

| Archivo | Qué hace |
|---|---|
| `scripts/_tmp-parse-lte-plana.py` | Normaliza las 12 hojas del Excel a `_tmp-lte-plana.json` |
| `scripts/_tmp-gen-lte-mp-plans.py` | Genera los 60 planes de motores → `_tmp-lte-mp-plans.json` |
| `scripts/_tmp_lte_common.py` | **Módulo común**: parseo de fechas y horas de la planilla, `resolver_horas`, `resolver_fechas` |
| `scripts/_tmp-gen-lte-cajas.py` | Genera los 20 planes de cajas → `_tmp-lte-cajas-plans.json` |
| `scripts/_tmp-gen-lte-mmaa.py` | Genera los 42 planes de generadores → `_tmp-lte-mmaa-plans.json` |
| `scripts/_tmp-gen-lte-electrica.py` | Genera los 26 planes de planta eléctrica → `_tmp-lte-electrica-plans.json` |
| `scripts/_tmp_lte_tareas.py` | Catálogo de tareas que se repiten en todo el plan (códigos 30-49) |
| `scripts/_tmp-gen-lte-hoja.py` | **Generador genérico** de las hojas de equipos. `python ... <NOMBRE_HOJA>` |
| `scripts/_tmp-audit-lte.ts` | Auditoría: planes incompletos y restos de plantilla (sin args = buque entero) |
| `scripts/_tmp-lte-rutinas.json` | Acumulador de las tareas DIARIO/SEMANAL/15 DÍAS apartadas para el cierre |
| `scripts/load-lte-plan-motores.ts` | Aplica los planes de motores (fue la tanda 1; el genérico lo reemplaza) |
| `scripts/load-lte-plan.ts` | **Cargador genérico de todas las tandas.** Recibe el JSON del lote (DRY=1 previsualiza) |
| `scripts/load-lte-plan-ia.ts` | Completa criterios/LOTO/riesgo/RCM con IA. `CLEAN=1` sólo limpia, `FORCE=1` regenera |
| `scripts/_tmp-dump-latere-mp.ts` | Dump read-only del estado del buque |

Respaldo del estado previo de los motores: `/app-cms3/scripts/_tmp-lte-mp-backup.json` (VPS).

## Estado

- [x] **Tanda 1 — MOTORES_PROPULSORES** (2026-08-17). 36 planes corregidos + 24 creados = 60,
      los 4 motores con 15 tareas cada uno, todos con IA completa. Activos corregidos a
      Cummins KTA-50.
- [x] **Tanda 2 — CAJAS_REDUCTORAS** (2026-08-17). 16 corregidos + 4 creados; 36 planes en
      total sobre las 4 cajas, todos con IA. Fichas corregidas de Twin Disc 5170 a
      **Reintjes 5,75:1**. Los 16 planes sin par (engrase de sellos, ánodos del
      intercambiador, acople torsional, adición de aceite) conservan tarea y frecuencia;
      sólo se les completó área y responsable.
      Las 8 tareas DIARIO de las líneas de eje quedan para el plan consolidado del cierre.
- [x] **Tanda 3 — MOTORES_GENERADORES** (2026-08-17). Los 3 grupos: 36 corregidos +
      18 creados = 46 planes, todos con IA. Fichas corregidas de Cummins 4BTA3-G1 a
      **Cummins N855** (por eso sus planes listaban 4 inyectores y el papel tiene 6).
      El **N03 de emergencia** es el activo `LTE-MA-PTO`, que figuraba como "Motor Auxiliar
      Puerto": Gustavo confirmó que es el mismo equipo y se renombró a "Motor Generador N°3
      de Emergencia" (y `LTE-ALT-PTO` a "Alternador N°3 de Emergencia"). Sus frecuencias son
      propias: corre 127 h en total, así que el service es ANUAL y no cada 400 h.
      Sin par: "CONTROL 2: Medición gases escape / inyectores / alternador" (3000 h) en los
      tres, e "Inspección SEMANAL" en el de emergencia.
      Se unificaron dos pares de filas del papel en una tarea cada uno, por describir el
      mismo trabajo en el mismo momento y con los mismos datos: "cambio de aceite" +
      "cambio de filtro de aceite", e "inyector N°1..N°6" + "cambio de inyectores y control
      de avance de inyección".
- [x] **Tanda 4 — PLANTA_ELECTRICA** (2026-08-17). 5 corregidos + 21 creados = 26 planes,
      todos con IA. Se dieron de alta los **6 transformadores 380/220** (`LTE-TRAFO-01..06`,
      SFI 800, criticidad B), que no existían como activo.
      **Nombres unificados** (pedido de Gustavo): `LTE-MA-#1/#2` → "Motor Generador N°1 Babor"
      y "N°2 Estribor"; `LTE-ALT-BR/ER` → "Alternador N°1 Babor" y "N°2 Estribor".
      Sin par: rodamientos (renovación 60 m y sellados 20 000 h) y verificación de diodos/AVR
      en los tres alternadores.
      ⚠ Esta hoja usa **otro layout de columnas**: el vencimiento está en la columna 6, no en
      la 7 como en las hojas de motores, y "Recorrido Actual" (col 5) es la última ejecución.
- [x] **Tanda 5 — CIRCUITO_DE_COMBUSTIBLE** (2026-08-17). 2 corregidos + 10 creados = 12
      planes, todos con IA. Se dio de alta `LTE-EB-TRASV-AUX` "Bomba Trasvase de Combustible
      Auxiliar". La toma de muestra de calidad del combustible es "con cada embarque" →
      quedó como plan por EVENTO (sin vencimiento automático), colgada de la tubería de
      embarque. 2 rutinas semanales apartadas.
      **Desde esta tanda el generador es genérico** (`_tmp-gen-lte-hoja.py`), configurable
      por hoja: cubre las 7 hojas de equipos que quedan.
- [x] **Tanda 6 — NAV-COM** (2026-08-17). 9 corregidos + 3 creados = 12 planes, todos con IA.
      Activos nuevos: `LTE-BAROMETRO`, `LTE-ECO-BR`, `LTE-ECO-ER`. Se cargaron los modelos que
      el papel declara (Samyung SI-30, Danforth, Furuno 1715 / M1934 BB / LS-4100, Icom IC-M412).
      El magnetrón del radar de babor figuraba de **2 KW** y el papel dice **6 KW**: corregido.
      Los VHF pasaron de 12 a 60 meses (el papel dice 5 años).
      ⚠ Estructura propia: sin fila de encabezado, cada equipo ocupa 2-3 filas y sólo la
      primera trae frecuencia y fechas → script aparte, `_tmp-gen-lte-navcom.py`.
- [x] **Tanda 7 — BOMBAS_ELECTRICAS** (2026-08-17). 5 corregidos + 24 creados = 29 planes.
      Activos nuevos: `LTE-EB-INC-AUX`, `LTE-EB-ESPUMA`. Las dos bombas de agua potable
      comparten texto en la planilla y son dos equipos: el generador las reparte por orden.
- [x] **Tanda 8 — COMPRESOR-A_A-TIFON** (2026-08-17). 2 corregidos + 18 creados = 20 planes.
      Activo nuevo: `LTE-CHILLER`. Mapeo asumido: "COMPRESOR" del papel = `LTE-COMP-NK40`,
      "EQUIPO TIFON" = `LTE-COMP-PITO`.
- [x] **Tanda 9 — SISTEMA_HIDRAULICO** (2026-08-17). 2 corregidos + 6 creados = 8 planes.
      Activos nuevos: `LTE-SERVO-1` y `LTE-SERVO-2`. El "Motor Electrico" de la hoja se
      mapeó a `LTE-CENT-HID` (es el que acciona la central hidráulica).
- [x] **Tanda 10 — VENTILADORES/EXTRACTORES/OTROS** (2026-08-17). 3 corregidos + 10 creados.
      Activos nuevos: `LTE-APAREJO-PLUMA`, `LTE-TERMOTANQUE`, `LTE-EXTR-COCINA`.
- [x] **Tanda 11 — CABRESTANTES** (2026-08-17). 2 corregidos + 9 creados. Activos nuevos:
      `LTE-CABR-POPA-BR`, `LTE-CABR-POPA-ER`, `LTE-MOLINETE`.
- [x] **Tanda 12 — SEPARADOR / PLANTA PTE** (2026-08-17). 1 corregido + 5 creados. Activo
      nuevo: `LTE-SEPARADOR`. El "Control aislación de motor eléctrico" de la planta PTE es
      la misma tarea que la hoja de ventiladores llama "Toma de Aislación": el papel la
      repite en dos hojas y se unificó en un solo plan.
- [x] **Cierre — RUTINAS CONSOLIDADAS** (2026-08-17). Gustavo pidió **unir las diarias con
      las semanales**, así que quedaron **2** planes en vez de 3, colgados de
      `LTE-6-ED-001` (Equipos de Máquinas en General):
      - `LTE-6-ED-001-90` **RUTINA SEMANAL DE MÁQUINAS** — trigger WEEK, 1 semana, 39 tareas
        (las 33 diarias van marcadas "(diaria)" para no perder el dato).
      - `LTE-6-ED-001-91` **RUTINA QUINCENAL DE MÁQUINAS** — trigger DAY, 15 días, 14 tareas.
      El sistema soporta WEEK y DAY: usan `frequencyMonths` como nº de semanas / de días
      (ver `advanceDateOccurrence` y `recalculateNextDue`).

## Aprendizajes de las primeras tandas

- Cada grupo de activos viene con la **ficha del fabricante equivocada**, heredada del clon.
  Revisarla siempre contra el encabezado de la hoja del Excel antes de cargar
  (motores: Volvo Penta → Cummins KTA-50; cajas: Twin Disc → Reintjes).
- Los planes heredados del clon traen `department` en null y el responsable escrito
  "Jefe de Maquinas" **sin tilde**. El cargador genérico lo normaliza.
- Después de cada tanda conviene correr `CLEAN=1 load-lte-plan-ia.ts <activos>`: los planes
  que ya tenían IA de antes arrastran los corchetes del bug viejo.
- **Las columnas cambian de hoja en hoja.** Verificar siempre el encabezado antes de
  escribir el generador: en motores el vencimiento está en la columna 7; en planta eléctrica
  y las demás, en la 6, con "Recorrido Actual" (col 5) como última ejecución.
- Al correr la pasada de IA, incluir **todos** los activos tocados, no sólo los que tienen
  planes nuevos (se escapó `LTE-ALT-PTO` en la tanda 4).

## Resuelto

- **Generador N03 = `LTE-MA-PTO`** (2026-08-17). Ver tanda 3.
- **Bug de la IA** (commit `3673549`, deployado 2026-08-17): el texto sugerido salía con los
  corchetes de la plantilla del prompt. Se reescribieron los prompts y se agregó
  `cleanAiText()` en `apps/api/src/tenant/ai/ai-text.ts`, aplicado en planes, órdenes de
  trabajo y diferimientos.

## Estado final

**361 planes sobre 92 activos.** 201 planes salen del plan en papel; 22 activos se dieron de
alta. 334 planes tienen los cuatro campos de análisis completos.
Restos de plantilla: 0. Rutinas consolidadas: 53 tareas (33 diarias, 6 semanales, 14 quincenales).

**Quedan 27 planes sin análisis de IA**: todos sobrantes de clase o estatutarios que no
figuran en el plan de máquinas en papel (hélices, purificadora, botellones de aire, split,
filtros de toma de mar, CO2, bombas de sanidad/lodos/prelubricación/refrigeración de bocinas,
motobomba EGA portátil). Pendiente de decisión de Gustavo si se les corre la IA.

⚠ **Ojo con el área**: algunos planes del buque son de **CUBIERTA**, no de máquinas
(`LTE-ELEV-02` prueba de peso, `LTE-1-002/003` inspecciones de casco con responsable
"3er Oficial Cubierta"). El criterio "área = MÁQUINAS" se aplicó sólo a los activos de las
hojas de máquinas; no forzar los de cubierta.


---

# DON CHICUETO (DCH) — en curso

**Fuente:** `MisDocs/DCH/Mantenimiento/07- PMP DON CHICUETO - JULIO.xlsm`
(20 hojas, **369 tareas**). Estado inicial: 170 planes sobre 80 activos.

## Diferencias con el LATERE

- **El plan del DCH es uniforme**: todas las hojas tienen la misma fila de encabezado
  (`TRABAJO A RELIZAR` / `ULTIMO TRABAJO` / `PROXIMO TRABAJO` / `FRECUENCIA`) y la columna
  anterior al trabajo nombra el componente o el equipo. Un solo generador cubre las 20 hojas:
  `scripts/_tmp-gen-dch-hoja.py`.
- **No hay tareas diarias, semanales ni quincenales.** La frecuencia mínima es mensual
  (99 tareas). No hacen falta planes consolidados de rutina.
- El último y el próximo trabajo vienen como fecha o como horas en las **mismas** columnas,
  según la frecuencia de la tarea.
- El papel usa `0` en "último trabajo" para *nunca ejecutado*: se carga sin última ejecución.
- Frecuencias propias: `Mensual`, `Trimestral`, `Semestral`, `Anual`, `6 Años / Dique Seco`
  (= 72 meses), además de `N MESES` y horas.

## Decisiones acordadas con Gustavo (2026-08-17)

1. **Motores principales**: figuran como Volvo Penta D16 MH y el plan en papel no cuadra
   con ese motor (turbosoplante, colector de escape, botadores hidráulicos, cojinetes de
   bancada, recorrido completo a 40 000 h, 39 501 horas de servicio). Gustavo decidió
   **dejar la ficha como está** y anotarlo en el informe final.
2. **Bombas que el papel trata de a pares** (agua potable BR y ER, refrigeración de motores
   auxiliares popa y proa): **duplicar** las tareas en cada bomba, para que cada equipo lleve
   su propio historial.
3. **Guinches y pluma**: crearlos como activos propios.

## Scripts (genéricos, sirven para los dos buques)

| Archivo | Qué hace |
|---|---|
| `scripts/load-vessel-plan.ts` | Cargador. El buque sale del campo `vessel` del lote; el autor, de `USUARIO_POR_BUQUE` |
| `scripts/load-vessel-plan-ia.ts` | Pasada de IA. `--buque=DCH`, `--todos`, `CLEAN=1`, `FORCE=1` |
| `scripts/_tmp-audit-vessel.ts` | Auditoría. `--buque=DCH` + activos opcionales |
| `scripts/_tmp-gen-dch-hoja.py` | Generador de lote por hoja del DCH |

⚠ El jefe de máquinas del DCH es **OSCAR-DUARTE** (Oscar Duarte), no un usuario "MAQUINAS…"
como en el LATERE (MAQUINASLATERE).

## Fichas equivocadas detectadas en el DCH

| Equipo | En el sistema | Dice el papel |
|---|---|---|
| Radar de Babor | Furuno 1715 | **Samyung SMR 3700**, magnetrón 4 KW |
| Radar de Estribor | Furuno M1934 BB | **Furuno FAR 2117BB** (principal), magnetrón 12 KW |
| AIS | Samyung SI-30 | **Emtrak A-200** |
| Motores principales | Volvo Penta D16 MH | no cuadra (ver decisión 1) |

## Estado

- [x] **Tanda 1 — MM.PP Bb. y MM.PP Eb.** (2026-08-17). 16 corregidos + 38 creados = 54;
      61 planes en total sobre los dos motores, todos con IA.
      Sin par: "Mantenimiento CADA 2000 HS" en ambos, "Recorrido completo cada 42000 HS" y
      las adiciones de aceite/refrigerante por evento.
- [ ] MM.AA. Nº1 Bb / Nº2 Eb. / Nº3 Puerto
- [ ] CAJAS · ALTERNADORES · COMPRESORES Y BOTELLONES
- [ ] SIST DE GOBIERNO · LINEA DE EJE Y HELICE · CABRESTANTE
- [ ] BOMBAS (69 tareas, 12 bombas) · CTRAL HIDRAULICA guinche-pluma
- [ ] MOTOR LANCHA · ENGRASE · TOMAS DE MAR · TERMOTANQUES · AIRE ACOND. CENTRAL
- [ ] EQUIPOS CRITICOS (22 tareas) · EQ NAVEGACION
- [ ] Informe final
