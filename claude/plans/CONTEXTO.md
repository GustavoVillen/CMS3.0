# Actualización del Plan de Mantenimiento del LATERE (LTE) — en curso

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
| `scripts/_tmp-gen-lte-cajas.py` | Genera los 20 planes de cajas → `_tmp-lte-cajas-plans.json` |
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
- [ ] Tanda 3 — MOTORES_GENERADORES
- [ ] Tanda 4 — PLANTA_ELECTRICA (requiere crear los 6 transformadores)
- [ ] Tanda 5 — CIRCUITO_DE_COMBUSTIBLE
- [ ] Tanda 6 — NAV-COM
- [ ] Tanda 7 — BOMBAS_ELECTRICAS
- [ ] Tanda 8 — COMPRESOR-A_A-TIFON
- [ ] Tanda 9 — SISTEMA_HIDRAULICO
- [ ] Tanda 10 — VENTILADORES/EXTRACTORES/OTROS
- [ ] Tanda 11 — CABRESTANTES
- [ ] Tanda 12 — SEPARADOR / PLANTA PTE
- [ ] Cierre — planes consolidados DIARIO / SEMANAL / 15 DÍAS + informe final

## Aprendizajes de las primeras tandas

- Cada grupo de activos viene con la **ficha del fabricante equivocada**, heredada del clon.
  Revisarla siempre contra el encabezado de la hoja del Excel antes de cargar
  (motores: Volvo Penta → Cummins KTA-50; cajas: Twin Disc → Reintjes).
- Los planes heredados del clon traen `department` en null y el responsable escrito
  "Jefe de Maquinas" **sin tilde**. El cargador genérico lo normaliza.
- Después de cada tanda conviene correr `CLEAN=1 load-lte-plan-ia.ts <activos>`: los planes
  que ya tenían IA de antes arrastran los corchetes del bug viejo.

## Resuelto

- **Bug de la IA** (commit `3673549`, deployado 2026-08-17): el texto sugerido salía con los
  corchetes de la plantilla del prompt. Se reescribieron los prompts y se agregó
  `cleanAiText()` en `apps/api/src/tenant/ai/ai-text.ts`, aplicado en planes, órdenes de
  trabajo y diferimientos.
