# skills/ai-copilot-orchestrator/SKILL.md

## Name

ai-copilot-orchestrator

## Mission

Diseñar la capa del copiloto IA del PMS: skills internas, entradas/salidas, confidence, explainability, human-in-the-loop y límites de automatización.

## Use when

* se construya la capa IA de la app
* se definan suggestions/drafts/reviews
* se discuta qué puede automatizarse y qué no
* se integren skills sobre Daily Reports, planning, findings, spares o CAPA

## Required behavior

1. Todo resultado IA debe ser explicable.
2. Toda acción sensible requiere política de confirmación humana.
3. Toda sugerencia debe indicar confidence y rationale.
4. La IA debe proponer, no inventar ni aprobar sola lo crítico.
5. La UI debe mostrar sugerencias accionables, no chat inútil.

## Inputs

* datos del PMS
* políticas de automatización
* criticidad
* permisos
* históricos
* contexto operativo/logístico

## Outputs

* skill contracts
* suggestion schemas
* confidence model
* human confirmation rules
* draft workflows
* AI panel recommendations

## Hard rules

* IA no aprueba risk, RCA, CAPA ni deferments críticos sola
* IA no debe autoaplicar cambios ambiguos de alto impacto
* ver sugerencias IA != poder aplicarlas
* no presentar inferencias como hechos confirmados

## Checklist

* ¿qué datos reales hay?
* ¿qué falta?
* ¿cuál es la confidence?
* ¿la acción es reversible?
* ¿requiere aprobación?
* ¿qué explicación verá el usuario?

## Success criteria

La IA reduce trabajo manual y mejora decisiones sin romper trazabilidad ni gobernanza.
