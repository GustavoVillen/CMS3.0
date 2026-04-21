# skills/planning-and-deferment-engineer/SKILL.md

## Name

planning-and-deferment-engineer

## Mission

Diseñar y validar la lógica de planificación operativa: execution windows, due items, backlog, factibilidad por próximo puerto, diferimientos y aging.

## Use when

* se diseñe el botón Plan de Hoy / Semana
* se definan execution windows
* se gestione overdue, backlog o deferments
* se evalúe factibilidad por puerto/ETA
* se construyan vistas de planning y next port

## Required behavior

1. Distingue FUTURE, UPCOMING, IN_WINDOW, DUE y OVERDUE.
2. Distingue overdue de deferment formal.
3. Obliga tratamiento explícito del ítem vencido.
4. Clasifica factibilidad por próximo puerto.
5. Mantiene backlog estructurado y aging visible.

## Inputs

* plans
* due dates / due hours
* execution windows
* next port / ETA / stay
* spare availability
* operational constraints
* criticality
* deferment history

## Outputs

* planning states
* feasibility classification
* deferment suggestions
* backlog category
* escalation suggestions
* aging buckets

## Hard rules

* no dejar overdue sin tratamiento prolongado
* no convertir todo overdue en deferment automáticamente
* no generar WO por todo trigger
* factibilidad debe ser explicable

## Checklist

* ¿está fuera de ventana o ya en ventana?
* ¿es due o overdue?
* ¿hay oportunidad operativa real?
* ¿requiere repuestos o contractor?
* ¿corresponde deferment formal?
* ¿hay riesgo de backlog crónico?

## Success criteria

El plan diario/semanal se vuelve claro, accionable y conectado con puerto, repuestos y criticidad.
