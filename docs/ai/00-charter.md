# PMS AI Charter

## Objetivo
Extender el sistema actual para incorporar el PMS marítimo con el menor impacto posible, preservando la arquitectura existente.

## Reglas inviolables

1. Preservar la arquitectura actual.
2. Reutilizar al máximo módulos, servicios, patrones y entidades existentes.
3. Extender con impacto mínimo.
4. No hacer refactors globales innecesarios.
5. No duplicar conceptos ya existentes.
6. No asumir decisiones ambiguas sin marcarlo explícitamente.
7. No tocar autenticación, tenancy, RBAC global, layout global ni design system salvo necesidad real y demostrable.
8. Toda seguridad debe ser fail-closed.
9. Todo acceso debe respetar tenant scope y luego fleet/vessel scope si aplica.
10. La IA asiste, propone y estructura, pero no aprueba por sí sola acciones sensibles.
11. Mantener separación estricta entre:
   - definiciones maestras
   - planes
   - due items
   - work orders
   - ejecuciones
   - daily reports
   - findings
   - risk / RCA / CAPA
12. Inspección y mantenimiento no son lo mismo:
   - Inspection = verificar / medir / probar / inspeccionar
   - Maintenance = intervenir físicamente / cambiar / limpiar / ajustar / reparar
13. No todo trigger debe crear Work Order.
14. PDF puede ser soporte o evidencia, pero no debe ser la única fuente de datos estructurados.
15. Los datos históricos no deben cambiar silenciosamente cuando se modifiquen templates o criterios.
16. La trazabilidad es obligatoria en toda acción relevante.

## Principios operativos

- Priorizar simplicidad real de uso a bordo y en oficina.
- Evitar burocracia innecesaria.
- IA y automatismos deben reducir carga manual, no aumentarla.
- Mantener human-in-the-loop en cierres, aprobaciones, consumos críticos, findings importantes y decisiones de riesgo.
- Reutilizar infraestructura actual de scheduler, inventory, AI, attachments, policies y notifications si ya existe.

## Prohibiciones

- No crear módulos paralelos si ya existe uno reusable.
- No renombrar estructuras por preferencia personal.
- No tocar módulos fuera de alcance sin justificación.
- No hacer cambios silenciosos en permisos.
- No persistir datos ambiguos como definitivos sin revisión cuando la confianza sea insuficiente.