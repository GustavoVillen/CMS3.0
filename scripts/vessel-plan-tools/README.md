# Herramientas de carga y auditoría de planes de mantenimiento

Cadena que usamos para pasar un plan de mantenimiento **en papel** (la planilla Excel
del buque) al sistema, y después auditar que la carga quedó fiel al papel.

Todo se corre **desde la raíz del repo**. Las salidas intermedias van a `out/`
(ignorada por git, se regenera corriendo los scripts de nuevo).

## Módulos compartidos

| Archivo | Qué hace |
|---|---|
| `paper_plan_common.py` | Parseo de fechas, números y frecuencias de las planillas |
| `paper_plan_tasks.py` | Normalización de títulos de tarea |
| `report_style.py` | CSS común de los informes HTML |

## Genéricos (sirven para cualquier buque)

| Archivo | Qué hace |
|---|---|
| `audit-vessel-plans.ts` | Audita los planes cargados: campos incompletos y restos de plantilla. `--buque=LTE` |
| `report-vessel-plans-data.ts` | Vuelca a JSON los datos del informe final del plan. `--buque=LTE` |
| `find-plans-without-paper-match.ts` | Planes del sistema que no tienen par en el plan en papel (`VESSEL` arriba del archivo) |

## Ejemplos por buque

Cada buque tiene su planilla con su propio layout, así que el parser se copia y se
adapta. Estos son los ejemplos vigentes para partir:

| Archivo | Buque |
|---|---|
| `build-mao02-plans-from-excel.py` | MAO 02 — planilla por hojas → JSON de planes |
| `build-don-chicueto-plans-from-excel.py` | DON CHICUETO — ídem, 20 hojas |
| `parse-latere-flat-plan.py` | LA TERE — planilla de una sola tabla plana |
| `report-mao02-plans-html.py` | Informe HTML del plan cargado |

## Auditoría del DON CHICUETO (agosto 2026)

Cadena completa, en este orden:

1. `dump-don-chicueto-audit.ts` → `out/dch-estado.json` (dump read-only de la base)
2. `dump-don-chicueto-audit-2.ts` → `out/dch-auditoria2.json`
3. `build-don-chicueto-plans-from-excel.py --todas` → `out/dch-*-plans.json`
4. `analyze-don-chicueto-audit.py` → `out/dch-auditoria.json` + informe por consola
5. `report-audit-don-chicueto.py` → `out/auditoria-dch.html`

Ninguno de estos escribe en la base. El informe ya generado está archivado en
`MisDocs/DCH/Auditorias/2026-08-29-Auditoria-Plan-Don-Chicueto.html`.

## Después de generar el JSON de planes

La carga contra la API la hacen los scripts genéricos de `scripts/`:
`load-vessel-plan.ts` y `load-vessel-plan-ia.ts`.
