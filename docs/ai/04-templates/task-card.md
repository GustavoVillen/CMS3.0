# Task Card

## Objetivo
[describir una sola tarea concreta]

## Contexto a cargar
- /docs/ai/00-charter.md
- /docs/ai/01-architecture-snapshot.md
- [agregar solo los domain docs estrictamente necesarios]

## Alcance permitido
- [listar carpetas y archivos que sí puede tocar]

## Fuera de alcance
- auth
- tenancy global
- RBAC global
- layout global
- design system base
- CI/CD
- cualquier módulo no listado explícitamente en "Alcance permitido"

## Entregables obligatorios
1. propuesta mínima de implementación
2. lista de archivos a tocar
3. riesgos de contradicción
4. diff mínimo
5. tests mínimos
6. supuestos detectados

## Reglas obligatorias
- No hacer refactor general.
- No tocar fuera del alcance permitido.
- Reutilizar patrones existentes.
- Detenerse si hay contradicción arquitectónica real.
- Si una decisión es ambigua, marcarla explícitamente antes de implementarla.

## Criterios de aceptación
- [listar condiciones concretas de éxito]

## Detenerse si
- requiere tocar auth
- requiere tocar multi-tenant global
- requiere tocar RBAC global
- detecta duplicación semántica con un módulo existente
- requiere cambiar naming estructural