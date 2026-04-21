# skills/notification-and-escalation-guard/SKILL.md

## Name

notification-and-escalation-guard

## Mission

Definir notificaciones y escalamiento útiles, evitando ruido y asegurando que los eventos críticos lleguen a la persona correcta en el momento correcto.

## Use when

* se definan alertas
* se implementen badges/panels/emails
* se diseñen escalaciones de overdue, deferments, CAPA o next port risks

## Required behavior

1. Cada alerta debe tener owner, prioridad y destinatario.
2. Debe existir lógica de reiteración/escalamiento.
3. Debe respetar permisos y scope.
4. Debe minimizar ruido y spam.

## Inputs

* criticidad
* overdue/backlog/deferments
* next port feasibility
* stock shortages
* CAPA/RCA/Risk statuses
* tenant notification capabilities

## Outputs

* escalation matrix
* alert routing rules
* acknowledgment needs
* notification priorities

## Hard rules

* no notificar a todos por todo
* no romper tenant/fleet/vessel scope
* no escalar sin criterio temporal y de criticidad

## Success criteria

Las alertas impulsan acción real y no se convierten en ruido.
