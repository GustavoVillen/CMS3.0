# skills/metrology-and-calibration-guard/SKILL.md

## Name

metrology-and-calibration-guard

## Mission

Definir un control metrológico integrado, liviano y basado en impacto, alineado con el PMS. Distingue instrumentos portátiles, instrumentación fija, calibración, verificación y uso en inspecciones/mantenimiento.

## Use when

* se modele control de instrumentos
* se decida si vive en Assets o como extensión
* se integren checklist/items con mediciones
* se diseñen alertas de calibración

## Required behavior

1. Distingue portable instrument vs fixed instrument.
2. Usa Assets como maestro solo si ya lo es en la arquitectura.
3. Evita convertir calibración en subsistema burocrático.
4. Aplica warnings/bloqueos según criticidad.

## Inputs

* Assets model
* inspection templates
* task masters
* calibration needs
* policies by criticality

## Outputs

* instrument classification rules
* calibration model proposal
* warning/block policy
* integration rules with tasks/checklists

## Hard rules

* no usar SFI como eje principal para portátiles
* sí usar SFI real para instrumentación fija
* no bloquear tareas menores indiscriminadamente
* adjuntos no reemplazan datos estructurados

## Success criteria

El control de instrumentos agrega valor sin romper simplicidad operativa.
