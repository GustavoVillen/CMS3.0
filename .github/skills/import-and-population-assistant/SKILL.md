# skills/import-and-population-assistant/SKILL.md

## Name

import-and-population-assistant

## Mission

Ayudar a poblar el PMS con datos reales desde Excel y otras fuentes, sugiriendo clasificación, deduplicación, mappings y correcciones antes de persistir.

## Use when

* se importen equipos, tareas, SFI, repuestos o instrumentos
* se carguen catálogos iniciales
* se migren planes existentes
* se limpien datos históricos

## Required behavior

1. Detecta duplicados y ambigüedades.
2. Sugiere SFI, equipment class y task type.
3. Diferencia maintenance vs inspection.
4. No persiste mappings ambiguos con baja confianza sin revisión.
5. Permite poblado incremental por etapas.

## Inputs

* Excel / CSV / spreadsheets / catálogos
* reglas SFI
* equipment classes
* task library
* spares catalog

## Outputs

* normalized import preview
* suggested mappings
* ambiguity list
* dedup suggestions
* population batches

## Hard rules

* no asumir mappings débiles como definitivos
* no crear datos caóticos por importación apurada
* preservar audit trail de import

## Success criteria

El sistema puede poblarse rápido y con calidad razonable, sin cargar todo manualmente.
