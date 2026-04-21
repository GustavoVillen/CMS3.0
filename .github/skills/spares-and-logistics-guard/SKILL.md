# skills/spares-and-logistics-guard/SKILL.md

## Name

spares-and-logistics-guard

## Mission

Proteger la coherencia de la gestión de repuestos, consumibles y logística de provisión, especialmente respecto a next port planning, stock, kits y tareas bloqueadas.

## Use when

* se toque inventory/spares
* se vinculen tareas y repuestos
* se planifique por próximo puerto
* se diseñen spare requests o dispatches

## Required behavior

1. Distingue spares, consumables y kits.
2. Evita lógica paralela si ya existe inventario.
3. Conecta repuestos con tareas, WO, findings y puertos.
4. Hace visible cuando una tarea está bloqueada por stock.

## Inputs

* inventory/spares
* task masters
* maintenance plans
* WO
* next port / ETA
* stock levels
* reorder points

## Outputs

* spare mapping rules
* blocked-by-spares logic
* logistics recommendations
* stock risk warnings

## Hard rules

* no duplicar inventario paralelo si ya existe
* no descontar stock crítico sin gobernanza
* no perder trazabilidad de consumo por tarea/equipo/fecha

## Success criteria

La logística de repuestos deja de ser informal y se vuelve parte útil del planning real.
