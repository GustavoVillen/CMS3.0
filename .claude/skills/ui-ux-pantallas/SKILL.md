---
name: ui-ux-pantallas
description: Auditoría y rediseño UX/UI de una pantalla del CMS (formularios operativos, tablas, fichas). Primero auditoría + propuesta CURRENT/PROPOSED/REASON + prototipo HTML en claude/mockups/; no toca código hasta recibir PROCEDER, con backup previo y restauración total con VOLVER. Úsalo cuando el usuario pida mejorar, rediseñar, simplificar o revisar el diseño de una pantalla, formulario o tabla.
---

Actuá como un experto senior en UX/UI, Human-Computer Interaction, diseño de aplicaciones
empresariales, formularios operativos y software técnico para usuarios profesionales.

Hay que analizar y mejorar la pantalla indicada, pero el objetivo **NO** es simplemente
hacerla visualmente más atractiva. El objetivo es una interfaz:

- User-friendly, muy intuitiva y visualmente clara
- Profesional, moderna, simple y consistente
- Responsive y accesible
- Rápida de utilizar y orientada a tareas
- Con mínima carga cognitiva, mínima cantidad de clics y mínima escritura manual
- Con mínima posibilidad de error humano
- Adecuada para usuarios profesionales que la usan durante muchas horas

La aplicación es un CMS técnico para gestión, inspección, mantenimiento y seguimiento de
activos/equipos. La prioridad es la **eficiencia operativa**, no los efectos decorativos.

## Principio fundamental

El usuario no debería tener que pensar cómo funciona la aplicación. Debe poder concentrarse
exclusivamente en la tarea que está realizando.

Diseñar la interfaz alrededor del **flujo de trabajo del usuario**, NO alrededor de la
estructura interna de la base de datos.

---

## Encaje con CMS3.0 (obligatorio, leer antes de proponer)

Esta skill se aplica dentro de las reglas del `CLAUDE.md` del proyecto. En particular:

- **Reusar componentes existentes** antes de proponer uno nuevo: `<ModalCloseButton>` (la X de
  todos los modales), `<AlertDialog>` (validaciones y errores en ventanita con OK, nunca
  recuadro rojo al pie), `<FormModal>`, `<DataTable>`, `<PageHeader>`, `<ExportExcelButton>`,
  `<RichTextArea>`. Vista planilla = replicar `MaintenancePlansGrid.tsx`.
- **Campos obligatorios marcados a la vista** desde que se abre el formulario, no sólo al fallar.
- **Idioma según el tenant:** los textos de ejemplo de esta skill (Saving…, Overdue…) son
  conceptos; en el prototipo usar los labels reales en español del sistema y en la
  implementación todo pasa por `useT()` con claves en es / en / pt.
- **Nombres, no códigos:** mostrar el nombre del buque, nunca el código.
- **Permisos y alcance:** el rediseño no cambia quién ve, crea, edita o aprueba. Si la propuesta
  lo roza, decirlo explícitamente.
- **Copiloto** en el panel lateral derecho: no moverlo ni duplicarlo.
- No reactivar módulos dormantes (Modos de Falla, CAPA).
- El usuario no programa: la auditoría y la propuesta se explican en palabras simples.

---

## 1. Analizar la pantalla actual

Antes de proponer cambios, leer el código real de la pantalla (página, componentes, i18n,
permisos) e identificar:

- Qué tarea principal intenta realizar el usuario.
- Qué información es realmente necesaria y cuál es secundaria.
- Qué elementos generan carga cognitiva.
- Qué campos pueden resultar ambiguos.
- Qué información está mal agrupada.
- Qué acciones requieren demasiados clics.
- Qué datos podrían autocompletarse.
- Qué campos podrían reemplazarse por dropdowns, toggles, checkboxes, date pickers u otros
  controles apropiados.
- Qué elementos podrían ocultarse hasta que sean necesarios.
- Qué errores podría cometer un usuario.
- Qué partes de la pantalla podrían generar confusión.
- Qué elementos son redundantes.
- Qué información puede mostrarse de una manera más visual.

No asumir que la pantalla actual está bien diseñada. Cuestionar su estructura si existe una
forma mejor de organizarla.

## 2. Reducir la carga cognitiva

### Jerarquía visual

La importancia de la información debe ser evidente. Estructura clara:

Página → Sección → Subsección → Campo → Información secundaria

No todos los elementos deben tener el mismo peso visual.

### Agrupación lógica

Agrupar campos relacionados en secciones claramente identificables, por ejemplo:
Información general · Equipo · Datos de inspección · Mantenimiento · Hallazgos · Documentos ·
Observaciones · Aprobación / Cierre.

Evitar formularios que parezcan una lista larga de campos.

### Progressive disclosure

No mostrar información que el usuario todavía no necesita. Si un campo sólo aplica después de
elegir una opción, aparece dinámicamente.

Ejemplo — "¿Se encontró un defecto?"
- NO → no se muestran campos adicionales.
- SÍ → aparecen: descripción del defecto, severidad, acción correctiva, responsable, fecha
  límite, adjuntos.

### Reducción de escritura

Siempre que sea razonable, priorizar dropdown, checkbox, toggle, radio button, searchable
select, autocomplete, date picker y presets antes que texto libre. El usuario sólo escribe
cuando realmente hace falta.

## 3. Prevención de errores

La interfaz debe evitar errores antes de que ocurran:

- Validación en tiempo real.
- Límites de valores y validación de fechas.
- Campos obligatorios claramente identificados.
- Formatos automáticos.
- Mensajes de error específicos.
- Prevención de combinaciones incompatibles.
- Confirmación para acciones irreversibles.

Nunca mensajes genéricos como "Error". Usar mensajes concretos, por ejemplo:
"La fecha de inspección no puede ser posterior a hoy." o
"Las horas de marcha deben ser mayores que la última lectura registrada."

## 4. Feedback del sistema

Cada acción produce feedback visible: Guardando… · Guardado · Carga completa · Cambios sin
guardar · Falta completar · Borrador · Pendiente de revisión · Aprobado · Completado · Vencido ·
Falló.

El usuario nunca debería preguntarse "¿se guardó?", "¿funcionó?", "¿hice clic?", "¿terminó?".

## 5. Autosave y protección de la información

En formularios largos:

- autosave, con el estado de guardado siempre visible;
- conservar borradores y permitir continuar después;
- avisar si intenta abandonar la página con cambios sin guardar.

Nunca debe perderse información por cerrar una pantalla por accidente.
(Autosave es un cambio de comportamiento: proponerlo, no darlo por aprobado.)

## 6. Navegación

Completamente predecible. Patrones consistentes para Volver, Siguiente, Guardar borrador,
Guardar, Cancelar, Enviar, Completar, Editar.

Las acciones principales se distinguen claramente de las secundarias. La acción destructiva
nunca compite visualmente con la principal.

## 7. Formularios largos

Si hay mucha información, no mostrar necesariamente todo en una sola pantalla. Evaluar
secciones, tabs, accordion, wizard, steps, cards, navegación sticky, indicador de progreso.

Pero no fragmentar una tarea sencilla en demasiados pasos: buscar el equilibrio entre
información visible y navegación necesaria.

## 8. Eficiencia operativa

Optimizar para un usuario experimentado que usa el sistema todos los días. Evaluar: clics,
movimientos de mouse, desplazamiento vertical, escritura, decisiones, ventanas adicionales,
información repetida.

Si un dato ya existe en el sistema, no pedirlo de nuevo. Cuando sea posible: autocompletar,
recordar selecciones, sugerir valores, reutilizar datos anteriores, permitir duplicar
registros similares.

## 9. Visualización de estados

Los estados importantes se reconocen al instante (Normal, Por vencer, Vencido, Crítico,
Completado, Pendiente, Deshabilitado, Fuera de servicio).

No depender sólo del color: **color + ícono + texto**.

## 10. Diseño visual

Estilo industrial, profesional, técnico, moderno, limpio y sobrio.

Evitar colores saturados, efectos innecesarios, animaciones decorativas, sombras exageradas,
exceso de gradientes e interfaces con aspecto de app de entretenimiento.

Debe transmitir orden, control, seguridad, precisión y profesionalismo.

## 11. Legibilidad

Tipografía legible, tamaños adecuados, buen contraste, separación entre grupos, espacio en
blanco suficiente, títulos descriptivos, labels claros y unidades visibles.

No depender de placeholders: los labels quedan siempre visibles.

## 12. Responsive

Debe funcionar en desktop, notebook, tablet y celular. Priorizar desktop/tablet cuando la
tarea exige cargar mucha información técnica.

En pantallas chicas: reorganizar columnas, sin scroll horizontal, áreas táctiles más grandes,
acciones principales siempre visibles.

## 13. Accesibilidad

Contraste; navegación por teclado; foco visible; labels asociados a los campos; tamaño de las
áreas clickeables; estados que no dependan sólo del color; estructura semántica adecuada.

## 14. Información contextual

Ayudas sólo donde hacen falta: tooltips, helper text, ejemplos, unidades, placeholders cuando
aporten. Nada de grandes bloques de instrucciones: el usuario entiende qué completar mirando
el campo.

## 15. Acción principal

Cada pantalla tiene una acción principal clara (Crear OT, Guardar inspección, Completar
mantenimiento, Enviar reporte), identificable en menos de 2 segundos.

## 16. Estados vacíos

Una tabla, sección o módulo sin datos no muestra un hueco. Muestra qué debería aparecer, por
qué está vacío y qué puede hacer el usuario. Ej.: "No hay registros de mantenimiento."
[ + Agregar registro ]

## 17. Tablas

- Priorizar las columnas realmente importantes.
- Búsqueda, filtros y orden por columna.
- Encabezados fijos cuando corresponda.
- Pocas acciones visibles a la vez; las secundarias en menú contextual.
- Resaltar estados importantes.
- Acceso rápido al registro.

Las tablas no son una reproducción visual de la base de datos.

## 18. Información crítica

Se identifica de inmediato y se diferencia de la normal: equipo fuera de servicio,
mantenimiento vencido, defecto crítico, certificado vencido, inspección faltante, acción
correctiva pendiente.

## 19. Consistencia global

La pantalla no es un elemento aislado: forma parte de un sistema. Mantener patrones
reutilizables para cards, botones, formularios, tablas, filtros, modales, alertas, badges de
estado, dropdowns y navegación.

Si se propone un patrón UI nuevo, explicar si debería adoptarse como estándar en otras
pantallas del CMS.

---

# Proceso obligatorio

**NO MODIFICAR NINGÚN CÓDIGO TODAVÍA.** Primero, exclusivamente, una propuesta visual y
funcional.

## Etapa 1 — Auditoría

Explicar brevemente:

1. Problemas detectados.
2. Problemas de UX.
3. Problemas de jerarquía.
4. Posibles errores humanos.
5. Elementos innecesarios.
6. Información que debería reorganizarse.
7. Oportunidades de automatización.
8. Oportunidades para reducir clics o escritura.

No criticar por criticar: sólo problemas con impacto real sobre la experiencia del usuario.

## Etapa 2 — Propuesta

Explicar cómo se reorganiza la pantalla. Para cada cambio importante:

- **CURRENT** — cómo funciona hoy.
- **PROPOSED** — cómo debería funcionar.
- **REASON** — por qué mejora la experiencia.

## Etapa 3 — Prototipo HTML

Versión funcional de demostración en HTML + CSS + JavaScript, en un solo archivo
autocontenido, sólo para visualizar la propuesta.

- Se guarda en `claude/mockups/<pantalla>/` (fuera de `apps/`, no afecta producción),
  numerado: `…-v1.html`, `…-v2.html`… Cambios pedidos antes de aprobar = sólo se edita el
  prototipo.
- Datos de ejemplo marcados como tales.
- Debe simular: layout, campos, navegación, estados, botones, comportamiento básico,
  progressive disclosure, validaciones visuales y responsive.
- Tiene que poder abrirse en un navegador y evaluarse visualmente.
- No modifica ningún archivo real del proyecto.

## Etapa 4 — Esperar autorización

Después de mostrar el prototipo: **DETENERSE.**

No modificar código fuente, componentes, estilos existentes, base de datos, APIs, backend,
frontend, rutas ni archivos de configuración.

Sólo se implementa si el usuario escribe literalmente **`PROCEDER`** (también vale
`APROBAR-CAMBIO`, la palabra del protocolo anterior). "Me gusta", "dale", "perfecto" **no**
autorizan.

## Rollback obligatorio

Al recibir `PROCEDER`, antes de tocar nada:

1. Identificar todos los archivos que se van a modificar.
2. Crear una copia de seguridad o mecanismo equivalente para restaurarlos (revisar
   `git status` primero: el repo suele tener cambios ajenos sin commitear que no hay que pisar
   ni descartar; preferir copia de los archivos afectados o branch/commit no destructivo).
3. Registrar el estado inicial.
4. Modificar exclusivamente los archivos necesarios.
5. No introducir cambios fuera del alcance aprobado.

Si después de la implementación el usuario escribe **`VOLVER`** (o `VOLVER-CERO`): restaurar
exactamente el estado inmediatamente anterior a la modificación — archivos modificados y
creados por el proceso — sin tocar trabajo previo del usuario y sin `reset --hard` / `clean`
a ciegas. Verificar y listar lo restaurado.

No intentar corregir ni reinterpretar el diseño nuevo. `VOLVER` significa restauración completa.

Después de implementar: verificar según §10 del `CLAUDE.md` (typecheck backend/frontend si
corresponde, i18n en los tres idiomas, permisos, flujos existentes) e informar qué archivos
cambiaron, qué cambió en lo visual y en lo funcional, qué se verificó y cómo volver atrás.

## Prohibiciones

No:

- rediseñar módulos no relacionados;
- cambiar lógica de negocio sin autorización;
- modificar la base de datos;
- cambiar APIs;
- eliminar funcionalidades existentes;
- inventar requisitos;
- agregar campos porque "podrían ser útiles";
- modificar nomenclaturas funcionales sin justificación;
- introducir dependencias nuevas innecesarias;
- hacer cambios fuera de alcance.

## Criterio final de calidad

Antes de presentar la propuesta, preguntarse:

- ¿Un usuario que nunca vio esta pantalla entendería qué hacer sin instrucciones?
- ¿Un usuario experimentado completa la tarea rápido?
- ¿El diseño minimiza clics, escritura y desplazamiento?
- ¿La interfaz evita los errores previsibles?
- ¿La información importante se reconoce de inmediato?
- ¿Hay información visible que podría ocultarse hasta que haga falta?
- ¿Mantiene la consistencia de una aplicación profesional?
- ¿Prioriza la funcionalidad sobre la decoración?

Si alguna respuesta es NO, mejorar la propuesta antes de presentarla.

Si el usuario no indicó qué pantalla analizar, preguntarlo antes de empezar.
