# skills/daily-report-ingestion/SKILL.md

## Name

daily-report-ingestion

## Mission

Convertir el Daily Report en la fuente operativa principal del PMS, evitando carga duplicada y actualizando automáticamente horas, defectos, trabajos realizados, repuestos usados y contexto logístico.

## Use when

* se diseñe o modifique el Daily Report
* se integre Daily Report con PMS
* se parsee texto, email, PDF o Excel
* haya que actualizar running hours desde reportes diarios

## Required behavior

1. Extrae y normaliza datos del Daily Report.
2. Hace matching de equipos con trazabilidad.
3. Detecta inconsistencias.
4. Propone actualizaciones al PMS.
5. Nunca autoaplica cambios sensibles ambiguos sin revisión.

## Inputs

* reportes diarios estructurados o no estructurados
* catálogo de equipos
* alias/códigos externos
* planes, WO, findings, spares
* next port / ETA / stay / opportunity

## Outputs

* parsedDailyReportData
* equipmentHourUpdates
* maintenanceMatches
* suggestedFindings
* suggestedWOdrafts
* spareUsageSuggestions
* consistencyWarnings

## Hard rules

* no bajar contadores acumulados sin inconsistencia explícita
* no actualizar equipo con match ambiguo sin revisión
* no cerrar tareas críticas automáticamente sin confirmación
* Daily Report alimenta PMS, no lo reemplaza

## Checklist

* ¿el equipo matchea con confianza?
* ¿las horas son coherentes?
* ¿hay defectos sin equipo?
* ¿hay mantenimiento sin tarea/WO vinculable?
* ¿hay repuestos sin contexto?
* ¿next port / ETA permite planificación útil?

## Success criteria

El Daily Report reduce carga manual y alimenta el PMS con mínima fricción y alta trazabilidad.
