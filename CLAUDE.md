# CLAUDE.md — Reglas de trabajo para el PMS marítimo

## 1. Regla principal: no romper la arquitectura existente

Antes de modificar cualquier cosa:

- inspeccionar la estructura real del proyecto
- identificar módulos, layouts, rutas, guards, permisos, i18n, modelos y servicios ya existentes
- detectar patrones reutilizables antes de crear nuevos
- no inventar componentes, rutas, tablas, estados o flujos sin revisar primero la implementación real
- si la especificación pedida contradice la implementación actual, reportar primero la contradicción y proponer un ajuste incremental

## 2. Modo de trabajo por defecto

Usar modo plan para cualquier tarea que:

- tenga 3 o más pasos
- implique decisiones de arquitectura
- toque base de datos, permisos, navegación, copiloto IA, multitenancy o reglas de negocio
- impacte más de un módulo

Antes de implementar:

- resumir el objetivo real
- listar restricciones existentes detectadas en el código
- proponer un plan corto, concreto y verificable
- evitar reescrituras totales si puede resolverse con refactor incremental

## 3. Regla de simplicidad

Priorizar siempre:

- el cambio más simple que cumpla correctamente el objetivo
- mínima superficie de impacto
- reutilización sobre reinvención
- coherencia con naming, estructura y patrones ya existentes

Evitar:

- sobreingeniería
- abstracciones prematuras
- duplicación de lógica
- crear nuevas capas si la actual puede extenderse limpiamente

## 4. Verificación obligatoria antes de dar por terminado

Nunca considerar una tarea terminada sin verificar:

- que compila
- que no rompe tipado
- que no rompe imports ni paths
- que no rompe permisos ni scope tenant
- que no rompe i18n
- que no rompe flujos existentes
- que el comportamiento final coincide con lo pedido

Cuando aplique:

- correr tests
- revisar logs y errores
- validar casos borde
- comparar comportamiento anterior vs nuevo

## 5. Regla específica del PMS

Este proyecto es un PMS marítimo multiempresa con reglas críticas de negocio. Toda implementación debe respetar:

- aislamiento por tenant
- alcance por vessel/unit cuando corresponda
- RBAC + ABAC existente
- consistencia con SFI, maintenance plans, daily reports, defects, backlog, inspections, CAPA, RCA y spares
- copiloto IA siempre contextual, visible en panel lateral derecho, sin reemplazar decisiones humanas
- idioma de frontend según idioma del tenant
- trazabilidad y consistencia de datos por encima de conveniencia técnica

## 6. Base de datos y modelos

Antes de tocar schema o modelos:

- revisar entidades ya existentes y relaciones reales
- confirmar si el cambio es realmente necesario
- evitar agregar campos redundantes si la lógica puede derivarse de datos existentes
- preservar compatibilidad con datos actuales
- no eliminar campos ni cambiar semántica sin revisar todo el impacto en frontend, backend y datos existentes

Si un cambio de schema es necesario:

- justificarlo
- explicar impacto
- mantener naming consistente
- contemplar migración y backward compatibility cuando corresponda

## 7. Frontend y UX

Antes de tocar UI:

- inspeccionar layout real
- identificar componentes compartidos
- respetar estructura actual del workspace
- no romper navegación actual
- no mover de lugar áreas principales sin necesidad
- mantener experiencia clara, simple y operativa para tripulación, superintendencia y admin

Para nuevas pantallas o cambios visuales:

- priorizar legibilidad operativa
- reducir fricción para carga de datos
- mostrar estados importantes de forma evidente
- evitar interfaces recargadas
- si el usuario pidió una ubicación específica de un elemento, respetarla

## 8. Copiloto IA

El copiloto IA:

- debe vivir en el panel lateral derecho
- debe ser contextual a la pantalla y al formulario abierto
- debe observar el contexto visible y sugerir ayuda útil
- no debe inventar decisiones automáticas sobre criticidad, causalidad o cumplimiento
- debe guiar al usuario con preguntas mínimas y precisas
- debe actuar como asistente experto, no como reemplazo del usuario

Antes de implementar cualquier cambio del copiloto:

- verificar hooks, providers, paneles y layout existentes
- evitar crear un chat aislado si el objetivo es asistencia contextual embebida

## 9. Permisos, scopes e idioma

Cualquier cambio debe validar:

- quién puede ver
- quién puede crear
- quién puede editar
- quién puede aprobar
- si el dato pertenece al tenant o a una vessel
- si debe respetar idioma del tenant

Nunca asumir permisos. Verificar implementación real.

## 10. Manejo de errores y bugs

Cuando haya un bug:

- reproducirlo
- identificar causa raíz
- corregir la causa, no el síntoma
- evitar parches temporales salvo justificación explícita
- explicar de forma breve qué fallaba y por qué la corrección lo resuelve

## 11. Forma de entregar cambios

En cada tarea:

- dar primero diagnóstico breve
- luego plan corto
- luego implementación
- luego validación
- luego resumen de cambios realizados

Si algo no pudo verificarse, decirlo explícitamente.

## 12. Cuándo frenar y reportar antes de seguir

Detener implementación y reportar cuando:

- haya contradicción entre pedido y arquitectura actual
- falte contexto crítico
- el cambio tenga alto riesgo de romper módulos existentes
- exista más de una interpretación razonable con impacto funcional importante
- el código real muestre una restricción que invalida la solución planeada

## 13. Criterio de calidad

Preguntarse siempre antes de cerrar:

- ¿esto respeta la arquitectura real?
- ¿esto es lo más simple que funciona bien?
- ¿esto evita deuda técnica innecesaria?
- ¿esto sería aprobable en una revisión seria?
- ¿esto protege el negocio y la consistencia operativa del PMS?

## 14. Regla final

No trabajar desde supuestos.
Primero revisar.
Después pensar.
Después planificar.
Recién entonces implementar.
