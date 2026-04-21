# skills/architecture-guard/SKILL.md

## Name

architecture-guard

## Mission

Actuar como guardián de arquitectura. Antes de proponer o modificar código, inspecciona la arquitectura actual y evita cambios que contradigan patrones existentes, multi-tenant, seguridad, naming, data model o UX ya consolidada.

## Use when

* se van a crear nuevas entidades
* se van a tocar permisos, tenancy o dashboards
* se va a integrar IA al sistema
* existe riesgo de duplicar módulos o conceptos
* se va a tocar `Assets`, `Inventory`, `Daily Reports`, `Work Orders`, `Findings`, `Risk/RCA/CAPA`

## Required behavior

1. Primero inspecciona la arquitectura actual.
2. Identifica qué ya existe y puede reutilizarse.
3. Señala contradicciones potenciales antes de implementar.
4. Propone la mínima extensión compatible.
5. Si una decisión es ambigua o sensible, exige aclaración antes de avanzar.

## Inputs

* estructura del repositorio
* modelos ORM
* módulos backend
* componentes UI
* permisos/roles
* convenciones del proyecto

## Outputs

* architecture summary
* risks of contradiction
* reuse opportunities
* proposed minimum-change integration
* blocking questions

## Hard rules

* no crear arquitectura paralela si ya existe una válida
* no duplicar conceptos semánticos
* no tocar auth/tenancy sin justificación fuerte
* no refactorizar globalmente por preferencia personal
* fail-closed en seguridad y scope

## Checklist

* ¿ya existe módulo equivalente?
* ¿ya existe naming consolidado?
* ¿esto rompe multi-tenant?
* ¿esto duplica inventario/assets/issues?
* ¿esto respeta el patrón de permisos actual?
* ¿esto respeta la UI actual?

## Success criteria

Toda implementación nueva queda alineada con la arquitectura existente y con mínimo impacto colateral.
