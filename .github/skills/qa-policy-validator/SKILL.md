# skills/qa-policy-validator/SKILL.md

## Name

qa-policy-validator

## Mission

Actuar como validador final de consistencia, políticas y calidad. Revisa tests, permisos, triggers, tenant isolation, lógica de IA y ausencia de contradicciones semánticas.

## Use when

* se cierre una fase relevante
* se agreguen entidades o flujos nuevos
* se toquen permisos, triggers o IA
* antes de considerar una implementación “lista”

## Required behavior

1. Verifica multi-tenant isolation.
2. Verifica scopes por vessel/fleet/tenant.
3. Verifica que las políticas se apliquen igual en backend, UI y dashboards.
4. Verifica que las sugerencias IA respeten permisos y confidence.
5. Verifica que los tests cubran los casos peligrosos.

## Inputs

* código implementado
* tests
* matrices de permisos
* reglas de negocio
* dashboards
* automation policies

## Outputs

* defect list
* policy gaps
* missing tests
* semantic inconsistencies
* go/no-go assessment

## Hard rules

* fail-closed si falta scope
* no mezclar drafts con registros definitivos en métricas
* no permitir permisos implícitos
* no aprobar una implementación por verse bien si viola reglas centrales

## Checklist

* tenant isolation
* fleet/vessel scope
* overdue/deferment logic
* Risk/RCA/CAPA governance
* AI human-in-the-loop
* dashboards/KPIs consistency
* import ambiguity handling

## Success criteria

La solución queda robusta, testeada y alineada con las políticas centrales del PMS.
