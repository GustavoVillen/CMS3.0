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
| `paper_sheets.py` | Los dos layouts de hoja que repiten las planillas de los remolcadores: hoja de tareas (equipo arrastrado) y hoja semanal (equipos críticos) |
| `paper_assets.py` | Empareja el equipo que nombra el papel con el activo del CMS3, por palabras del nombre y por marca/modelo de la ficha |
| `report_style.py` | CSS común de los informes HTML |

## Genéricos (sirven para cualquier buque)

| Archivo | Qué hace |
|---|---|
| `dump-fleet-plans.ts` | **Se corre en el VPS.** Vuelca activos, planes y conteo de OT de toda la flota a `out/flota-estado.json`. Read-only. `--buque=DCH` para acotarlo |
| `audit-fleet-plans.py` | Cruza las planillas contra ese dump y clasifica cada tarea en EN AMBOS / SOLO EXCEL / SOLO CMS3 / RUTINA DE GUARDIA |
| `report-fleet-audit-excel.py` | Escribe el Excel de la auditoría |
| `audit-vessel-plans.ts` | Audita los planes cargados: campos incompletos y restos de plantilla. `--buque=LTE` |
| `report-vessel-plans-data.ts` | Vuelca a JSON los datos del informe final del plan. `--buque=LTE` |
| `find-plans-without-paper-match.ts` | Planes del sistema que no tienen par en el plan en papel (`VESSEL` arriba del archivo) |

## Parsers por buque

Cada buque tiene su planilla con su propio layout. Los cuatro primeros salen del
mismo formulario y comparten `paper_sheets.py`; los dos de arriba además
transforman el papel para cargarlo (juntan inyectores, apartan rutinas), mientras
que los de abajo lo dejan como está, que es lo que necesita la auditoría.

| Archivo | Buque | Salida |
|---|---|---|
| `build-mao02-plans-from-excel.py` | MAO 02 | `out/m02-plans.json` |
| `build-don-chicueto-plans-from-excel.py` | DON CHICUETO, 20 hojas (`--todas`) | `out/dch-*-plans.json` |
| `build-mao01-plans-from-excel.py` | MAO 01 | `out/m01-plans.json` |
| `build-latere-plans-from-excel.py` | LATERE, 12 hojas + equipos críticos | `out/lte-plans.json` |
| `build-barcazas-plans-from-excel.py` | Las 33 barcazas, desde el registro del SGS por familia de motor | `out/barcazas-plans.json` |
| `parse-latere-flat-plan.py` | LATERE — volcado crudo, sin resolver activos (quedó del primer pase) | `out/lte-plana.json` |
| `report-mao02-plans-html.py` | Informe HTML del plan cargado | |

## Auditoría de toda la flota (agosto 2026)

Cadena completa, en este orden:

1. En el VPS: `export $(grep -E '^DATABASE_URL=' .env | xargs)` y
   `npx tsx scripts/vessel-plan-tools/dump-fleet-plans.ts`; después bajar
   `out/flota-estado.json` con `scp`.
2. Los cinco parsers de planilla (`build-*-plans-from-excel.py`; el del DCH con `--todas`).
3. `audit-fleet-plans.py` → `out/auditoria-flota.json` + resumen por consola.
4. `report-fleet-audit-excel.py` → el Excel en `MisDocs/_Carga/Auditorias/`.

Ninguno escribe en la base. El paso 1 es el único que necesita el VPS: la base
local está desactualizada y no sirve para contar planes.

**Control de que la cadena sigue sana:** el DON CHICUETO tiene que dar 382 filas de
papel y ~374 emparejadas. Si se mueve mucho, algo se rompió en los parsers.

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
