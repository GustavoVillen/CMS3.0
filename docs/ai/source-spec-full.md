Prompt para Claude Code:

Act�a como un **Principal Software Architect + Staff Engineer + Reliability Engineer + Marine PMS Domain Expert**.

Tu tarea es **analizar y extender** el sistema actual para incorporar un m�dulo PMS mar�timo robusto, pero con una condici�n cr�tica:

## REGLA M�XIMA

**No debes modificar nada fuera del alcance estrictamente necesario.**
No hagas refactors generales.
No renombres m�dulos existentes sin necesidad.
No cambies patrones globales del sistema salvo incompatibilidad real y demostrable.
No introduzcas una arquitectura paralela si la actual ya resuelve el problema.
No reemplaces piezas existentes por preferencia personal.

Tu criterio de trabajo debe ser:

1. **preservar arquitectura actual**
2. **reutilizar al m�ximo**
3. **extender con m�nimo impacto**
4. **preguntar antes de tocar partes ambiguas o sensibles**

---

# 1. Modo de trabajo obligatorio

## Fase 0 � Inspecci�n obligatoria antes de programar

Antes de escribir c�digo:

* inspecciona la arquitectura actual del repositorio
* identifica stack t�cnico
* identifica patr�n de m�dulos
* identifica ORM/modelos
* identifica multi-tenant y permisos
* identifica scheduler/jobs existentes
* identifica inventario/spares existente
* identifica patrones AI/skills/prompts si ya existen
* identifica dise�o UI, componentes, tablas, forms, dashboards
* identifica convenciones de naming, validaci�n, servicios y tests

### Salida obligatoria de esta fase

Debes responder con un informe dividido en:

#### A. Arquitectura actual detectada

* stack
* m�dulos existentes
* patr�n de datos
* seguridad y tenancy
* UI stack
* testing stack
* automatismos ya existentes
* posibles puntos de extensi�n

#### B. Riesgos de contradicci�n

Enumera espec�ficamente:

* qu� partes de este PMS podr�an duplicar conceptos ya existentes
* qu� nombres podr�an entrar en conflicto
* qu� m�dulos no conviene tocar
* qu� decisiones no puedes tomar sin preguntarme

#### C. Propuesta de integraci�n m�nima

Debes explicar:

* qu� reutilizar�s
* qu� crear�s
* qu� extender�s
* qu� no tocar�s
* por qu� tu propuesta es compatible con la arquitectura actual

#### D. Preguntas bloqueantes

Si hay dudas reales, preg�ntalas **antes de implementar**.

**No empieces a programar hasta terminar esta fase y esperar mi aprobaci�n si hay dudas relevantes.**

---

# 2. Restricciones de cambio obligatorias

## 2.1 No tocar sin justificaci�n fuerte

No modifiques salvo estricta necesidad:

* autenticaci�n
* motor global de autorizaci�n
* motor multi-tenant
* layout global
* navegaci�n principal global
* componentes base de design system
* pipelines CI/CD
* m�dulos fuera del PMS
* naming estructural del proyecto
* tablas cr�ticas ya productivas
* APIs ajenas al alcance del PMS

## 2.2 Si detectas algo reutilizable, �salo

Ejemplos:

* si ya existe `AccessControlService`, �salo
* si ya existe `buildUnitFilter`, int�grate
* si ya existe inventory module, integra spares ah� o crea extensi�n coherente
* si ya existe jobs/scheduler, reutil�zalo
* si ya existe patr�n AI action/tool/prompt, �salo
* si ya existe auditor�a o soft delete, resp�talo

## 2.3 No crear duplicaciones sem�nticas

No crees entidades redundantes si ya existen equivalentes, por ejemplo:

* asset vs equipment
* task vs work order
* issue vs finding
* inventory item vs spare
* organization vs tenant vs company
* vessel vs unit

Si ya existe un nombre consolidado, reutil�zalo.

---

# 3. Objetivo funcional

Integrar dentro del sistema actual un PMS mar�timo multi-tenant con estas capacidades:

* flota / vessels
* systems / SFI
* equipment classes
* equipment register
* task master library
* class task templates
* maintenance plans
* work orders
* executions / work logs
* findings
* spares
* dashboard PMS
* skills / asistencias IA
* automatizaci�n por triggers

---

# 4. Principios de dominio obligatorios

## 4.1 Separaci�n de conceptos

Debes modelar y mantener separados:

* **Equipment / Asset f�sico**
* **Equipment Class**
* **Task Master**
* **Maintenance Plan**
* **Inspection**
* **Maintenance**
* **Work Order**
* **Finding**
* **Spare**

## 4.2 Separaci�n estricta entre mantenimiento e inspecci�n

Esto es obligatorio en datos, l�gica y UI.

### Maintenance

Intervenci�n f�sica:

* change
* replace
* clean
* adjust
* lubricate
* overhaul
* repair

### Inspection

Verificaci�n / control:

* inspect
* verify
* test
* measure
* analyze
* check
* review condition

Una inspecci�n puede generar hallazgos.
Un hallazgo puede generar una work order correctiva. El uso de repuestos deber� controlarse con los stocks

## 4.3 Reutilizaci�n basada en plantillas

No crear tareas una por una para cada equipo si puede evitarse.
Debe existir:

* biblioteca maestra de tareas
* clases de equipo
* templates clase ? tarea
* asignaci�n autom�tica al crear un equipo

## 4.4 Trigger-driven

Los planes deben soportar:

* CALENDAR
* RUNNING_HOURS
* CONDITION
* EVENT
* opcional: CYCLES solo si encaja naturalmente

## 4.5 Generaci�n configurable de work orders

Cada plan debe soportar:

* AUTOMATIC
* SEMI_AUTOMATIC
* MANUAL

Con anti-duplicaci�n.

---

# 5. Requisitos funcionales m�nimos

## 5.2 Systems / SFI

Necesito jerarqu�a funcional y soporte SFI.
Evaluar si conviene:

* cat�logo global reusable
* cat�logo por tenant
* asociaci�n por vessel
* esquema h�brido

No decidas esto a ciegas: primero revisa la arquitectura actual.

## 5.3 Equipment Classes

Cat�logo reusable de clases de equipo.

## 5.4 Equipment Register

Alta, edici�n, detalle y filtros.
Al crear un equipo:

* sugerir clase
* sugerir SFI
* sugerir criticidad
* sugerir tareas base
* opcionalmente sugerir repuestos

## 5.5 Task Master Library

Biblioteca reusable con:

* taskType = MAINTENANCE | INSPECTION
* triggerType
* frecuencias por defecto
* evidencia requerida
* criterios de aceptaci�n
* procedimiento
* horas estimadas

## 5.6 Class Task Templates

Puente entre clase de equipo y tareas maestras.

## 5.7 Maintenance Plans

Instancia concreta por equipo con:

* trigger
* frecuencias
* lead time
* next due
* last done
* responsible role
* prioridad
* generaci�n WO

## 5.8 Work Orders

Con estados y control de aprobaci�n.

Estados sugeridos:

* PLANNED
* PENDING_APPROVAL
* OPEN
* IN_PROGRESS
* COMPLETED
* CLOSED
* CANCELLED
* OVERDUE

## 5.9 Executions / Work Logs

Registro t�cnico de lo realizado.

## 5.10 Findings

Hallazgos provenientes de inspecciones o an�lisis.

## 5.11 Spares

Integrar con inventario existente si lo hubiera.
No crear m�dulo paralelo si ya existe uno apto.

## 5.12 PMS Dashboard

KPIs m�nimos:

* PM compliance
* overdue WOs
* critical equipment without plan
* open findings
* stock below minimum

---

# 6. Automatizaci�n requerida

## 6.1 Evaluaci�n de triggers

Implementar usando el mecanismo de scheduler/job ya existente si lo hay.

### Fecha

* revisi�n diaria

### Horas

* al actualizar running hours o por job peri�dico

### Condici�n

* dejar estructura preparada aunque no todo el pipeline est� implementado

### Evento

* soporte manual o por eventos de negocio

## 6.2 Work orders

Reglas:

* AUTOMATIC: crea WO
* SEMI_AUTOMATIC: crea draft/pending approval
* MANUAL: manda a backlog o due list

## 6.3 Anti-duplicaci�n

No crear WO nueva si ya existe otra activa equivalente para el mismo plan.

## 6.4 Recalcular vencimientos

Cuando se completa una WO preventiva:

* actualizar `last done`
* recalcular `next due`
* cerrar ciclo correctamente

---

# 7. Skills / IA

Debes revisar si el proyecto ya tiene infraestructura para IA, actions, prompts, tools, agents o similares.
Si existe, int�grate ah�.
Si no existe, crea una estructura m�nima desacoplada y extensible.

## Skills m�nimas

### Skill A � Alta asistida de equipo

Entrada libre ? sugerir:

* clase de equipo
* SFI
* criticidad
* running hours applicability
* tareas base
* repuestos sugeridos

### Skill B � Clasificaci�n de tarea

Determinar:

* MAINTENANCE
* INSPECTION

Regla:

* clasificar por verbo principal y prop�sito operativo
* no por parecido superficial

### Skill C � Mejora de cierre t�cnico

Transformar notas crudas en:

* trabajo realizado
* hallazgos
* acci�n correctiva
* seguimiento

### Skill D � Auditor de planes

Detectar:

* equipos cr�ticos sin plan
* equipos mantenibles sin tareas activas
* WOs cerradas sin evidencia
* hallazgos abiertos sin seguimiento
* tareas vencidas sin WO

### Skill E � Sugeridor de repuestos

Sugerir spares por clase/tarea/equipo

## Restricci�n importante

Las skills deben ser:

* desacopladas
* testeables
* no invasivas
* accesibles por endpoints/actions coherentes con la arquitectura actual

---

# 8. Seguridad y permisos

Debes reutilizar estrictamente el sistema actual de permisos/roles.

Roles esperados o equivalentes:

* Super Admin
* Company Admin
* Superintendent
* Captain
* Chief Engineer
* Vessel User / Technical User

No inventes otro motor RBAC.

Protege al menos:

* ver PMS
* crear/editar equipos
* administrar task library
* asignar planes
* aprobar WOs
* cerrar WOs
* cerrar findings
* usar skills IA
* ver dashboard

---

# 9. UI / UX

Respeta estrictamente la UI actual.
Usa componentes existentes.
No rehagas el design system.

Pantallas m�nimas:

* listado de vessels / acceso PMS
* equipment register
* equipment detail con tabs
* task library
* maintenance plan board
* work orders
* findings
* spares
* dashboard PMS
* entry points de AI assistant

Filtros �tiles:

* vessel
* SFI
* class
* criticality
* status
* due
* overdue

---

# 10. Persistencia

Usa el ORM actual del proyecto.
Si es Prisma, usa Prisma.
Si no, respeta el patr�n existente.

Necesito:

* modelos/entidades consistentes
* migraciones seguras
* �ndices razonables
* constraints �tiles
* soft delete si ya existe
* audit fields si ya existe ese patr�n

No rompas datos existentes.

---

# 11. APIs / servicios

Implementa CRUD y operaciones espec�ficas solo siguiendo el patr�n actual.

Necesito cobertura para:

* equipment classes
* systems / SFI
* equipment
* task master
* class task templates
* maintenance plans
* work orders
* work logs
* findings
* spares
* dashboard
* skills
* scheduler logic

---

# 12. Seeds

Si el proyecto ya soporta seeds/fixtures:
crear datasets iniciales extensibles para:

* SFI base
* equipment classes base
* task masters base
* templates clase ? tarea
* spares sugeridos base

Si no existe soporte de seeds, prop�n la mejor forma compatible.

---

# 13. Testing obligatorio

Agregar tests siguiendo el framework actual.

M�nimos:

* tenant isolation
* generaci�n autom�tica de WO
* no duplicaci�n de WO
* clasificaci�n maintenance vs inspection
* auditor�a de planes
* permisos b�sicos

---

# 14. Entregables obligatorios por etapas

## Etapa A

Informe de arquitectura actual + propuesta m�nima de integraci�n + dudas bloqueantes

## Etapa B

Backend / modelo / servicios / automatismos

## Etapa C

UI

## Etapa D

Skills / IA

## Etapa E

Tests + seeds + documentaci�n

---

# 15. Formato de trabajo esperado

Quiero que trabajes en este orden:

1. inspeccionar repositorio
2. resumir arquitectura actual
3. marcar contradicciones potenciales
4. proponer integraci�n m�nima
5. hacer preguntas si hay dudas reales
6. esperar mi respuesta si las dudas son relevantes
7. reci�n entonces implementar

---

# 16. Criterios estrictos de calidad

Tu soluci�n final debe:

* respetar la arquitectura actual
* minimizar cambios colaterales
* simplificar gesti�n real del PMS
* separar mantenimiento de inspecci�n
* soportar triggers correctamente
* manejar work orders de manera seria
* respetar multi-tenant
* integrar skills IA sin acoplamiento excesivo
* ser extensible
* ser mantenible
* ser profesional

---

# 17. Prohibiciones finales

Est� prohibido:

* hacer refactors globales innecesarios
* duplicar conceptos ya existentes
* cambiar nombres estructurales por gusto
* tocar autenticaci�n o tenancy sin necesidad
* crear un m�dulo de inventario paralelo si ya existe uno usable
* hacer cambios silenciosos en permisos sin explicarlos
* asumir decisiones ambiguas sin preguntarme

Si detectas que alguna parte de este pedido choca con la arquitectura actual, **detente, expl�calo claramente y prop�n la m�nima alternativa compatible**.

# 18. Simplificaci�n operativa obligatoria del PMS

Quiero que priorices la **usabilidad real a bordo y en oficina**.
El PMS no debe convertirse en un sistema burocr�tico ni en una f�brica de Work Orders innecesarias.

Debes dise�ar el m�dulo para que sea **simple de usar, r�pido de cerrar y estructurado en datos**, evitando formularios excesivos y procesos redundantes.

Prioridad adicional: simplificar el uso operativo. No convertir cada trigger en Work Order. Inspecciones por defecto con checklist y findings; mantenimiento simple con quick execution; WO formal solo cuando agregue control real.


## 18.1 Principio rector de simplificaci�n

Debes separar claramente:

* **Trigger** = indica que una actividad ya corresponde ejecutarse
* **Due Item** = actividad vencida / exigible
* **Execution Record** = registro de una ejecuci�n simple
* **Finding** = deficiencia detectada
* **Work Order** = intervenci�n formal cuando realmente se necesita control operativo, trazabilidad, repuestos, aprobaci�n o seguimiento

### Regla obligatoria

**No toda activaci�n de trigger debe crear una Work Order.**

El flujo correcto es:

**Trigger ? Due Item / actividad exigible ? seg�n configuraci�n:**

* ejecuci�n simple
* finding
* work order
* backlog / aprobaci�n

---

# 19. INSPECCIONES (Verification & Control)

## 19.1 Filosof�a de dise�o

Las inspecciones deben ser **muy f�ciles de ejecutar** y **muy estructuradas en resultados**.

### Regla obligatoria

Una inspecci�n:

* **no debe depender exclusivamente de un PDF**
* **no debe generar autom�ticamente una WO por defecto**
* **s� debe permitir PDF imprimible**
* **s� debe registrar resultados estructurados en el sistema**

## 19.2 Modelo recomendado para inspecciones

Implementa las inspecciones con 3 capas:

### A. Inspection Template Master

Plantilla maestra reusable con:

* nombre
* equipo o clase de equipo aplicable
* frecuencia
* checklist items
* criterio de aceptaci�n por �tem
* si requiere evidencia
* si requiere instrumento
* si requiere lectura num�rica
* l�mites admisibles
* fuente del criterio t�cnico

### B. Inspection Execution Checklist

Instancia ejecutable de la inspecci�n, con soporte para:

* ejecuci�n digital en UI
* exportaci�n/impresi�n PDF
* carga posterior si se ejecut� en papel

### C. Inspection Result Record

Resultado estructurado con:

* fecha
* equipo
* inspector
* resultado general
* observaciones
* �tems no conformes
* evidencias
* instrumentos utilizados
* lecturas registradas
* necesidad de acci�n correctiva
* pr�xima fecha

## 19.3 PDF

El sistema debe soportar checklist tipo PDF, pero bajo esta regla:

### Permitido

* imprimir checklist para uso en campo
* adjuntar PDF firmado o escaneado como evidencia
* exportar la plantilla a PDF

### Prohibido como dise�o principal

* usar PDF como �nica fuente de datos
* guardar solo el archivo sin estructurar resultados
* depender de texto libre para explotar resultados luego

### Implementaci�n esperada

El **master de inspecci�n debe ser digital y estructurado**.
El PDF debe ser una **vista imprimible** o una **evidencia adjunta**, no el modelo principal.

## 19.4 Tipos de resultado de inspecci�n

Toda inspecci�n debe poder cerrarse con uno de estos estados:

* SATISFACTORY
* SATISFACTORY_WITH_OBSERVATIONS
* UNSATISFACTORY_FOLLOW_UP_REQUIRED
* CRITICAL_DEFICIENCY_IMMEDIATE_ACTION

## 19.5 Qu� hacer si la inspecci�n resulta satisfactoria

Flujo esperado:

* cerrar inspecci�n
* guardar resultados
* recalcular pr�ximo vencimiento
* no generar WO

## 19.6 Qu� hacer si se detectan deficiencias

Debes diferenciar por gravedad.

### Nivel 1 � Observaci�n menor

Ejemplos:

* suciedad
* corrosi�n superficial menor
* pintura deteriorada
* peque�o ajuste pendiente
* housekeeping

Acci�n:

* crear **Finding**
* prioridad baja o media
* sin WO autom�tica obligatoria
* permitir agrupar luego en WO planificada

### Nivel 2 � Deficiencia que requiere intervenci�n

Ejemplos:

* fuga
* presi�n fuera de rango
* vibraci�n anormal
* pernos flojos
* switch que no act�a
* aislamiento deficiente
* componente desgastado

Acci�n:

* crear **Finding**
* marcar corrective action required
* permitir o generar **Corrective Work Order**

### Nivel 3 � Condici�n cr�tica

Ejemplos:

* equipo de seguridad/emergencia inoperativo
* condici�n insegura
* riesgo para personas, operaci�n, medio ambiente o cumplimiento

Acci�n:

* finding cr�tica
* WO inmediata
* alerta / escalamiento
* soporte para bloquear operaci�n si arquitectura actual contempla ese patr�n

## 19.7 Regla de automatizaci�n para inspecciones

Por defecto:

* trigger de inspecci�n ? crea **Due Inspection Item**
* ejecuci�n de inspecci�n ? crea **Inspection Record**
* si falla ? crea **Finding**
* si la severidad o configuraci�n lo requiere ? crea **Corrective WO**

### Regla obligatoria

**Las inspecciones no deben generar autom�ticamente una Work Order por defecto.**

## 19.8 Estructura de checklist

Cada �tem de checklist debe soportar tipo de respuesta:

* BOOLEAN_OK_NOK
* PASS_FAIL_NA
* NUMERIC_READING
* SHORT_TEXT
* TECHNICAL_NOTES
* PHOTO_REQUIRED

Y adem�s:

* acceptanceCriteria
* nominalValue
* minValue
* maxValue
* unit
* requiresInstrument
* requiredInstrumentType
* evidenceRequired
* deficiencySeverityIfFailed
* criteriaSource

## 19.9 Instrumentos de control y medici�n

Debes incorporar una gesti�n simple y �til, no excesiva.

### Cat�logo m�nimo de instrumentos

Crear o integrar una entidad/cat�logo de instrumentos con:

* id
* code
* name
* type
* serialNumber
* calibrationRequired
* calibrationDate
* calibrationDueDate
* status
* notes

### Uso en inspecciones

Cada checklist item debe poder requerir:

* instrumento sugerido u obligatorio
* registro de lectura
* unidad
* validaci�n contra l�mites

### Regla funcional

Si el instrumento usado tiene calibraci�n vencida:

* el sistema debe alertarlo
* no necesariamente bloquear, salvo configuraci�n o criticidad

## 19.10 Fuente de criterios t�cnicos

Los criterios de aceptaci�n y l�mites admisibles deben poder referenciar:

* maker manual
* company standard
* class requirement
* statutory/regulatory requirement
* engineering criterion

No dejar esto �nicamente en observaciones libres.

---

# 20. MANTENIMIENTO (Physical Intervention)

## 20.1 Filosof�a de simplificaci�n

El mantenimiento debe ser f�cil de gestionar y cerrar.
No conviertas cada tarea en una mini burocracia documental.

Debes soportar 3 niveles operativos:

### Nivel A � Simple Maintenance Execution

Para tareas simples, repetitivas y de baja complejidad:

* limpiar filtro
* lubricar
* ajuste menor
* drenaje
* rellenado
* housekeeping t�cnico

Estas deben poder cerrarse con flujo simple, sin WO formal obligatoria.

### Nivel B � Formal Preventive Maintenance

Para tareas preventivas que requieren trazabilidad:

* cambio de aceite
* cambio de filtros
* reemplazo programado
* overhaul menor
* intervenci�n con repuestos
* tareas cr�ticas/reglamentarias

Estas normalmente s� deben usar WO o modo configurable.

### Nivel C � Corrective Maintenance / Repair

Para reparaci�n o restauraci�n tras falla o deficiencia:

* WO obligatoria
* causa / hallazgo
* repuestos
* evidencia
* seguimiento
* verificaci�n posterior si aplica

## 20.2 Reglas de Work Order para mantenimiento

Debes implementar un campo de configuraci�n equivalente a:

* `triggerResultMode = DUE_ONLY | AUTO_WO | APPROVAL_WO`

o un dise�o equivalente coherente con la arquitectura actual.

### Sem�ntica obligatoria

* **DUE_ONLY**: el trigger genera una actividad exigible, no WO
* **AUTO_WO**: genera WO autom�ticamente
* **APPROVAL_WO**: genera draft o pending approval

### Pol�tica por defecto sugerida

* Inspection ? DUE_ONLY
* Simple preventive maintenance ? DUE_ONLY o AUTO_WO configurable
* Formal preventive maintenance ? AUTO_WO o APPROVAL_WO
* Corrective / Repair ? AUTO_WO obligatorio

## 20.3 Estructura recomendada para tareas de mantenimiento

Cada tarea debe definirse con estructura compacta:

* t�tulo corto
* objetivo
* procedimiento resumido
* referencia a procedimiento/manual
* criterios de aceptaci�n
* repuestos sugeridos
* consumibles sugeridos
* evidencias requeridas
* estimaci�n de horas-hombre
* responsable sugerido

### Regla

No copies manuales completos dentro de cada tarea.
Usa:

* resumen corto
* referencia/link/adjunto
* checklist breve de ejecuci�n si hace falta

## 20.4 Resultado de mantenimiento

Toda ejecuci�n o WO debe poder cerrarse con estados como:

* COMPLETED
* COMPLETED_WITH_OBSERVATIONS
* NOT_COMPLETED
* FOLLOW_UP_REQUIRED

---

# 21. Gesti�n de repuestos y consumibles

## 21.1 Simplificaci�n obligatoria

El usuario no debe reconstruir manualmente todos los repuestos desde cero en cada trabajo si el sistema puede sugerirlos.

## 21.2 Separaci�n conceptual

Debes diferenciar, si la arquitectura lo permite:

### Spares

Partes identificables:

* filtros
* juntas
* retenes
* rodamientos
* inyectores
* v�lvulas
* kits

### Consumables

* aceite
* grasa
* refrigerante
* solvente
* limpieza
* pintura
* trapos / materiales menores

## 21.3 Repuestos sugeridos

Cada:

* Equipment Class
* Task Master
* Maintenance Plan

debe poder asociarse con:

* repuestos sugeridos
* consumibles sugeridos
* cantidad estimada

## 21.4 Flujo operativo recomendado

Al abrir o ejecutar un mantenimiento / WO:

* mostrar repuestos sugeridos
* permitir confirmar, ajustar o eliminar
* permitir agregar no previstos
* registrar consumo real
* descontar stock
* alertar bajo m�nimo o falta de stock

## 21.5 Regla de stock

El uso de repuestos debe quedar controlado con stock.

### Debe soportar:

* reserva opcional
* consumo confirmado al ejecutar o cerrar
* movimiento de inventario si m�dulo existente lo soporta
* alerta de faltante
* alerta bajo m�nimo
* trazabilidad del repuesto usado por WO, equipo y fecha

## 21.6 Kits

Si la arquitectura actual lo permite, soporta kits:

* overhaul kit
* 500h service kit
* filter replacement kit

Esto simplifica mucho el uso.

---

# 22. Requisitos, exigencias y l�mites admisibles

## 22.1 Regla obligatoria

Los l�mites admisibles, criterios de aceptaci�n y exigencias t�cnicas **no deben vivir solo en PDF o texto libre**.

Debe existir una capa estructurada para:

* acceptance criteria
* nominal values
* minimum admissible
* maximum admissible
* tolerances
* unit
* criteria source

## 22.2 Aplicaci�n

Esto debe poder asociarse a:

* checklist item
* task master
* maintenance plan
* inspection template

## 22.3 Fuentes

Toda exigencia t�cnica debe poder asociarse a su origen:

* maker manual
* statutory requirement
* class requirement
* company standard
* engineering decision

## 22.4 Comportamiento esperado

Si una lectura o resultado excede el l�mite:

* marcar no conformidad
* sugerir finding
* sugerir acci�n correctiva
* escalar seg�n severidad si corresponde

---

# 23. Modelo operativo simplificado obligatorio

Debes implementar el PMS con este criterio de uso:

## 23.1 Para inspecciones

* trigger ? due inspection
* usuario ejecuta checklist
* si todo OK ? cierra inspecci�n
* si hay observaciones ? finding
* si hay deficiencia relevante ? corrective WO
* PDF solo como soporte / export / evidencia

## 23.2 Para mantenimiento simple

* trigger ? due maintenance item
* quick execution posible
* repuestos/consumibles opcionales
* WO no obligatoria

## 23.3 Para mantenimiento formal

* trigger ? AUTO_WO o APPROVAL_WO seg�n configuraci�n
* gesti�n de repuestos
* evidencia
* cierre formal
* recalcular pr�ximo vencimiento

## 23.4 Para correctivos

* finding o evento ? WO
* repuestos
* causa / acci�n
* seguimiento
* verificaci�n si corresponde

---

# 24. Requisitos de UI/UX para simplificar

Quiero flujos muy simples.

## 24.1 Inspecciones

Necesito:

* vista r�pida de inspecciones due/upcoming/overdue
* ejecuci�n tipo checklist
* bot�n �Export / Print PDF�
* cierre r�pido si satisfactory
* creaci�n asistida de finding si falla
* creaci�n asistida de WO correctiva si la deficiencia lo requiere

## 24.2 Mantenimiento

Necesito:

* vista r�pida de due maintenance
* quick close para tareas simples
* WO formal solo cuando corresponda
* secci�n de repuestos sugeridos / usados
* criterios de aceptaci�n visibles
* evidencia f�cil de adjuntar

## 24.3 Hallazgos

Necesito:

* listado claro
* severidad
* estado
* origen (inspecci�n, an�lisis, etc.)
* acci�n requerida
* v�nculo a WO si existe

## 24.4 Instrumentos

Necesito:

* cat�logo simple
* visualizaci�n de vencimiento de calibraci�n
* selecci�n en checklist si aplica

---

# 25. Plan de implementaci�n detallado

Debes ejecutar esta parte del PMS por etapas estrictas, minimizando impacto.

## Etapa 1 � Descubrimiento y mapeo

Objetivo:

* revisar arquitectura actual
* identificar si ya existe m�dulo de inventory, findings/issues, assets/equipment, jobs, forms engine, AI, attachments
* mapear qu� conceptos ya est�n presentes
* decidir qu� se reutiliza

Entregable:

* informe de integraci�n m�nima
* tabla de mapping entre conceptos actuales y conceptos PMS
* listado de riesgos
* dudas bloqueantes

## Etapa 2 � Modelo de dominio m�nimo

Objetivo:

* definir entidades nuevas o extensiones m�nimas para:

  * inspection templates
  * inspection executions
  * maintenance plans
  * work orders
  * findings
  * spare usage
  * instruments
  * acceptance criteria / limits
* evitar duplicaci�n con m�dulos existentes

Entregable:

* propuesta de modelos
* migraciones/entidades
* validaciones
* �ndices
* restricciones

## Etapa 3 � L�gica de triggers y due items

Objetivo:

* implementar generaci�n de due items sin convertir todo en WO
* separar:

  * inspection due items
  * maintenance due items
  * work orders

Entregable:

* servicios de scheduler o hooks
* reglas DUE_ONLY / AUTO_WO / APPROVAL_WO
* anti-duplicaci�n
* recalcular next due

## Etapa 4 � Inspecciones

Objetivo:

* implementar templates
* checklist executions
* PDF export/print
* result capture estructurado
* creation of findings from failed items

Entregable:

* backend + UI de inspecciones
* checklist engine simple
* export PDF
* hallazgos derivados

## Etapa 5 � Mantenimiento simplificado

Objetivo:

* implementar quick execution para tareas simples
* implementar WO formal para tareas complejas
* mostrar criterios, procedimiento breve, evidencias y responsables

Entregable:

* backend + UI de maintenance executions
* formal WO flow
* quick close flow

## Etapa 6 � Repuestos y consumibles

Objetivo:

* integrar inventario existente o extenderlo m�nimamente
* sugerir repuestos por clase/tarea
* registrar consumo real
* alertar faltantes o stock bajo m�nimo

Entregable:

* relaci�n tarea ? repuesto sugerido
* UI de selecci�n/confirmaci�n de uso
* movimientos/consumos compatibles con arquitectura actual

## Etapa 7 � Instrumentos y l�mites

Objetivo:

* crear cat�logo b�sico de instrumentos
* asociarlo a checklist items
* registrar lecturas
* validar l�mites
* alertar calibraci�n vencida

Entregable:

* modelos + UI b�sica + validaciones

## Etapa 8 � Skills / IA

Objetivo:

* integrar skills en la arquitectura AI actual o crear capa m�nima
* incluir:

  * alta asistida de equipo
  * clasificaci�n task maintenance vs inspection
  * mejora de cierre t�cnico
  * auditor de planes
  * sugeridor de repuestos

Entregable:

* servicios/prompts/actions desacoplados
* entry points UI discretos
* tests m�nimos

## Etapa 9 � Dashboard y reporting

Objetivo:

* exponer indicadores simples pero �tiles

KPIs m�nimos:

* inspection compliance
* PM compliance
* overdue due items
* overdue WOs
* open findings
* critical findings
* critical equipment without plan
* stock below minimum
* instruments with expired calibration

Entregable:

* dashboard PMS integrado con UI actual

## Etapa 10 � Tests, seeds y documentaci�n

Objetivo:

* validar la calidad m�nima del m�dulo

Tests m�nimos:

* tenant isolation
* trigger ? due item
* inspection does not auto-create WO by default
* failed inspection ? finding
* severe failed inspection ? corrective WO when configured
* maintenance AUTO_WO generation
* anti-duplicaci�n de WO
* repuesto consumido descuenta stock
* l�mite excedido genera no conformidad
* calibraci�n vencida alerta
* permisos por rol

Seeds m�nimas:

* clases de equipo base
* tareas maestras base
* templates de inspecci�n base
* instrumentos base
* criterios t�cnicos base de ejemplo
* repuestos sugeridos base

Documentaci�n m�nima:

* arquitectura del m�dulo
* decisiones de dise�o
* flujos operativos
* reglas de uso
* limitaciones
* pr�ximos pasos

---

# 26. Preguntas obligatorias antes de implementar si aplica

Debes preguntarme antes de decidir si detectas dudas reales sobre:

* si los findings deben reutilizar un m�dulo issue ya existente
* si inventory/spares ya existe y debe ser extendido
* si existe forms/checklist engine reutilizable
* si PDF se generar� del lado servidor o cliente
* si los instrumentos ser�n inventario t�cnico o cat�logo liviano
* si due items deben ser tabla propia o vista derivada
* si el sistema actual distingue asset vs equipment vs unit
* si el scheduler actual ya soporta jobs recurrentes del PMS

---

# 27. Resultado esperado

Quiero que el PMS resultante:

* sea simple de usar
* no genere WOs innecesarias
* permita checklist tipo PDF sin depender de PDF como base de datos
* maneje hallazgos con l�gica clara
* permita instrumentos y lecturas con l�mites admisibles
* simplifique el mantenimiento simple
* controle repuestos con trazabilidad y stock
* estructure criterios t�cnicos y exigencias
* mantenga coherencia con la arquitectura actual
* minimice cambios colaterales

--
# 28. Ventana de ejecuci�n obligatoria para planes de mantenimiento e inspecci�n

Quiero que tanto el **Maintenance Plan** como el **Inspection Plan** definan una **execution window** adem�s del vencimiento.

## 28.1 Objetivo funcional

El PMS no debe limitarse a mostrar solo:

* due
* overdue

Tambi�n debe informar claramente:

* qu� �tems **entran en ventana de ejecuci�n**
* qu� �tems **vencen pr�ximamente**
* qu� �tems **todav�a no corresponde ejecutar**
* qu� �tems **ya vencieron**

Esto debe servir para planificaci�n operativa de:

* pr�ximos d�as
* pr�ximas semanas
* pr�ximos meses
* pr�ximos a�os

seg�n corresponda en funci�n de la frecuencia de cada plan.

---

## 28.2 Conceptos obligatorios

Debes distinguir al menos estos conceptos:

* **lastDone** = �ltima ejecuci�n v�lida
* **nextDue** = pr�ximo vencimiento calculado
* **windowOpen** = fecha/hora/umbral desde el cual ya se permite ejecutar dentro de ventana
* **windowClose** = opcional si la arquitectura lo requiere, o equivalente al due / overdue boundary
* **executionStatus** = FUTURE | UPCOMING | IN_WINDOW | DUE | OVERDUE | COMPLETED

### Regla obligatoria

Un �tem puede estar:

* fuera de ventana
* upcoming
* dentro de ventana
* due
* overdue

No reducir todo a due/overdue.

---

## 28.3 Aplicaci�n a Maintenance Plans e Inspection Plans

Esto debe aplicarse a:

* planes basados en calendario
* planes basados en running hours
* planes mixtos
* opcionalmente ciclos si ya existe soporte natural

### Para planes mixtos

Si el plan vence por:

* calendario
* o running hours

debe prevalecer **la primera condici�n que ocurra**, pero la ventana debe calcularse para ambos criterios si corresponde.

---

## 28.4 Configuraci�n de ventana

Cada plan debe soportar una configuraci�n equivalente a una de estas dos estrategias:

### A. Ventana autom�tica

El sistema calcula la ventana en funci�n de la frecuencia.

### B. Ventana manual/configurable

El usuario define expl�citamente:

* window lead days
* window lead hours
* window lead weeks/months/years si el dise�o lo soporta coherentemente

### Regla recomendada

Soportar ambas:

* `windowMode = AUTO | MANUAL`

---

## 28.5 Regla de ventana autom�tica

Si no hay configuraci�n manual, el sistema debe sugerir o calcular una ventana de ejecuci�n razonable seg�n la frecuencia.

### Para frecuencia basada en calendario

Debes implementar una regla equivalente a esta l�gica:

* frecuencia muy corta (diaria / semanal): abrir ventana pocos d�as antes
* frecuencia mensual: abrir ventana por semanas
* frecuencia trimestral / semestral: abrir ventana por semanas o 1 mes antes
* frecuencia anual: abrir ventana varios meses antes
* frecuencia multianual: abrir ventana con anticipaci�n suficiente en meses

### Objetivo

Que el sistema muestre los �tems pr�ximos con una anticipaci�n �til, no arbitraria.

### Implementaci�n sugerida

Puedes modelarlo con:

* porcentaje de anticipaci�n respecto de la frecuencia
* o tabla de reglas por rango de frecuencia
* o ambos, si la arquitectura lo permite sin complejidad excesiva

## 28.6 Regla sugerida de referencia para AUTO

Si no existe otra pol�tica ya definida, usar una tabla equivalente a esta:

* frecuencia hasta 7 d�as ? abrir ventana 1 d�a antes o 20% de la frecuencia
* frecuencia > 7 y hasta 30 d�as ? abrir ventana 7 d�as antes
* frecuencia > 30 y hasta 90 d�as ? abrir ventana 14 d�as antes
* frecuencia > 90 y hasta 180 d�as ? abrir ventana 30 d�as antes
* frecuencia > 180 y hasta 365 d�as ? abrir ventana 60 d�as antes
* frecuencia > 365 d�as ? abrir ventana 90 d�as antes o valor configurable

No tomes esta tabla como r�gida si la arquitectura actual ya tiene un patr�n mejor; �sala como referencia m�nima razonable.

---

## 28.7 Running hours

Para planes por running hours, la ventana tambi�n debe existir.

### Conceptos

* nextDueHours
* windowOpenHours

### Ejemplo

Si una tarea vence a 1000 horas:

* puede abrir ventana a las 950 h
* quedar due a las 1000 h
* quedar overdue despu�s

### Regla funcional

Debe poder configurarse:

* por porcentaje de frecuencia
* o por valor fijo de anticipaci�n en horas

Ejemplo:

* frecuencia 500 h
* ventana abre 50 h antes
* due en 500 h
* overdue luego del umbral

## 28.8 Conversi�n estimada a tiempo

Si el sistema dispone de un promedio de uso del equipo o del buque, puede estimar:

* fecha probable de entrada en ventana por running hours
* fecha probable de due por running hours

Si esa capacidad no existe a�n, deja el modelo preparado pero no inventes precisi�n.

---

## 28.9 Upcoming buckets / vistas de planificaci�n

El sistema debe poder informar pr�ximos vencimientos agrupados en ventanas �tiles para el usuario.

### Vistas m�nimas requeridas

Necesito al menos estas vistas o filtros:

* vence en pr�ximos 7 d�as
* vence en pr�ximos 30 d�as
* vence en pr�ximos 90 d�as
* vence en pr�ximos 180 d�as
* vence en pr�ximos 365 d�as
* vence en pr�ximos 2 a�os o m�s, si aplica

### Agrupaci�n inteligente

Adicionalmente, quiero que el sistema pueda presentar agrupaciones legibles como:

* hoy
* esta semana
* pr�ximo mes
* pr�ximo trimestre
* este a�o
* pr�ximo a�o

si la UI actual lo permite sin sobrecomplejidad.

---

## 28.10 Reporte seg�n frecuencia

El sistema debe adaptar la lectura de �pr�ximamente� seg�n la naturaleza del plan.

### Ejemplos esperados

* una tarea semanal debe reportarse naturalmente en d�as/semanas
* una tarea mensual o trimestral debe reportarse naturalmente en semanas/meses
* una tarea anual o plurianual debe reportarse naturalmente en meses/a�os

### Regla

No presentar todos los planes con el mismo horizonte fijo.
La capa de reporte debe ser sensible a la frecuencia.

---

## 28.11 Estados funcionales recomendados

Debes calcular estados equivalentes a:

* FUTURE = a�n fuera de ventana
* UPCOMING = pr�ximo a entrar en ventana
* IN_WINDOW = ya ejecutable dentro de ventana
* DUE = alcanz� el vencimiento
* OVERDUE = excedido
* COMPLETED = ejecutado y recalculado

### Regla importante

`UPCOMING` no es lo mismo que `IN_WINDOW`.
`IN_WINDOW` implica que ya se puede ejecutar v�lidamente.

---

## 28.12 UI / UX para planificaci�n

Quiero que el usuario pueda visualizar f�cilmente:

### Para Maintenance

* pr�ximos mantenimientos por buque
* pr�ximos mantenimientos por equipo
* en ventana
* due
* overdue
* pr�ximos 7/30/90/180/365 d�as
* pr�ximos por horas si aplica

### Para Inspections

* pr�ximas inspecciones por buque
* por clase de equipo o sistema
* en ventana
* due
* overdue
* agrupadas por semanas/meses/a�os seg�n corresponda

### Requisito

La UI debe priorizar la planificaci�n y no solo el cumplimiento reactivo.

---

## 28.13 Modelo de datos sugerido

Extiende Maintenance Plan e Inspection Plan con campos equivalentes a:

* windowMode = AUTO | MANUAL
* windowLeadDays nullable
* windowLeadHours nullable
* windowLeadPercent nullable
* windowOpenDate nullable
* windowOpenHours nullable
* nextDueDate
* nextDueHours
* executionStatus calculado o derivable

Si el sistema actual prefiere campos derivados en vez de persistidos, respeta esa arquitectura.

---

## 28.14 Reglas de c�lculo

### Calendar-based

* nextDueDate = lastDoneDate + frecuencia
* windowOpenDate = nextDueDate - anticipaci�n definida o calculada

### Running-hours-based

* nextDueHours = lastDoneHours + frecuencia
* windowOpenHours = nextDueHours - anticipaci�n definida o calculada

### Mixtos

* calcular ambos
* mostrar ambos
* prevalece la primera condici�n de vencimiento real

---

## 28.15 Scheduler / servicios

Quiero que el sistema tenga servicios o jobs capaces de:

* recalcular ventanas
* recalcular pr�ximos vencimientos
* actualizar estados de ejecuci�n
* alimentar dashboards y listas de planificaci�n

Esto debe integrarse al scheduler/job engine ya existente si lo hay.

---

## 28.16 Dashboard y reportes

Agregar KPIs o widgets m�nimos para:

* maintenance items entering window soon
* inspection items entering window soon
* due in next 7 / 30 / 90 days
* annual items approaching execution window
* overdue items
* items currently in execution window

---

## 28.17 Criterio de dise�o

La ventana de ejecuci�n no debe obligar a crear WO.
Su funci�n principal es:

* **planificar**
* **priorizar**
* **visualizar carga futura**
* **evitar ejecuci�n demasiado temprana o demasiado tard�a**

### Regla final

`execution window` es un concepto de planificaci�n, no necesariamente de work order.

---

## 28.18 Implementaci�n detallada requerida

Incorpora esta funcionalidad al plan de implementaci�n con una etapa espec�fica:

### Etapa adicional � Execution Windows & Forecasting

Objetivo:

* dise�ar y aplicar ventanas de ejecuci�n para maintenance plans e inspection plans
* soportar AUTO y MANUAL
* generar estados FUTURE / UPCOMING / IN_WINDOW / DUE / OVERDUE
* habilitar vistas por pr�ximos d�as / semanas / meses / a�os
* adaptar la presentaci�n al tipo de frecuencia

Entregables:

* modelo de datos o extensi�n m�nima
* l�gica de c�lculo
* filtros y vistas
* dashboard de pr�ximos vencimientos
* tests para calendar, running hours y mixed triggers

---

# 29. Integraci�n del Daily Report con planificaci�n log�stica y copiloto IA

Quiero que el PMS use el **Daily Report** como fuente principal de contexto operativo para planificaci�n de mantenimiento, inspecciones y provisi�n de repuestos.

## 29.1 Campos adicionales obligatorios del Daily Report

Agregar o mapear, si ya existen en la arquitectura actual, los siguientes campos:

* nextPort
* etaNextPort
* etdNextPort nullable
* portCallType (loading, discharging, bunkering, anchorage, waiting, repair, other)
* estimatedStayHours nullable
* maintenanceOpportunity (YES, LIMITED, NO, UNKNOWN)
* sparesReceiptPossible (YES, NO, UNKNOWN)
* operationalRemarks nullable

## 29.2 Objetivo funcional

Estos datos no deben quedar solo almacenados.
Deben ser analizados por el copiloto IA y por los servicios de planificaci�n para:

* evaluar factibilidad real de pr�ximos mantenimientos
* sugerir agrupaci�n de tareas en escalas viables
* anticipar provisi�n de repuestos
* detectar tareas en ventana sin oportunidad operativa cercana
* priorizar intervenciones por criticidad, vencimiento, log�stica y disponibilidad

## 29.3 Regla de dise�o

No convertir el Daily Report en un formulario narrativo pesado.
La carga para la tripulaci�n debe seguir siendo m�nima y estructurada.

## 29.4 Qu� debe analizar el copiloto IA

El copiloto dentro de la app debe poder cruzar al menos:

* running hours de motores y equipos cr�ticos
* execution windows de maintenance plans e inspection plans
* due items
* overdue items
* hallazgos abiertos
* work orders abiertas
* stock y faltantes de repuestos
* repuestos sugeridos por tarea
* pr�ximo puerto
* ETA/ETD
* duraci�n estimada de escala
* oportunidad de mantenimiento
* posibilidad de recepci�n de repuestos
* condici�n operativa del buque

## 29.5 Salidas esperadas del copiloto IA

El copiloto no debe limitarse a responder preguntas en texto.
Debe generar tambi�n insights accionables, tales como:

* mantenimientos factibles en el pr�ximo puerto
* inspecciones que conviene ejecutar antes de arribar
* tareas que deben reagendarse por falta de ventana operativa
* repuestos que deben pedirse o enviarse al pr�ximo puerto
* agrupaci�n recomendada de trabajos
* alertas de criticidad por vencimiento + falta de oportunidad operativa
* borradores de findings
* borradores de work orders
* borradores de spare requests
* res�menes para superintendent

## 29.6 Ejemplos de razonamiento esperado

El copiloto debe poder razonar de forma equivalente a:

* �DG2 entra en ventana antes de arribar al pr�ximo puerto, pero la estad�a estimada es insuficiente para la intervenci�n completa.�
* �La pr�xima escala �til para ejecutar esta tarea preventiva parece ser la siguiente, no la inmediata.�
* �El repuesto sugerido no est� disponible en stock y deber�a provisionarse antes del arribo a Montevideo.�
* �Conviene agrupar esta tarea con otras dos del mismo sistema durante la pr�xima estad�a alongside.�
* �La tarea no est� overdue a�n, pero si no se programa en la pr�xima escala, entrar� en condici�n cr�tica.�

## 29.7 UI / UX esperada

Agregar vistas o paneles donde el usuario pueda ver:

* tareas factibles en pr�ximo puerto
* tareas en ventana sin oportunidad operativa clara
* repuestos a enviar al pr�ximo puerto
* tareas agrupables por escala
* riesgos por vencimiento antes de siguiente oportunidad

## 29.8 Preguntas inteligentes del copiloto

Quiero que el copiloto pueda responder dentro de la app preguntas como:

* �Qu� mantenimientos puedo hacer en el pr�ximo puerto?
* �Qu� inspecciones vencen antes de la pr�xima escala �til?
* �Qu� repuestos debo enviar ya?
* �Qu� tareas conviene agrupar?
* �Qu� equipos cr�ticos van a quedar expuestos si no intervengo en la pr�xima estad�a?
* �Qu� trabajos no son factibles en el pr�ximo puerto por falta de tiempo o repuestos?

## 29.9 Plan de implementaci�n adicional

Agregar una etapa espec�fica al plan de implementaci�n:

### Etapa adicional � Daily Report Intelligence & Port-Aware Planning

Objetivo:

* integrar Daily Report como fuente autom�tica para horas, contexto operativo y planificaci�n
* incorporar next port / ETA / opportunity data
* permitir al copiloto IA analizar factibilidad log�stica y t�cnica
* generar recomendaciones accionables para mantenimiento, inspecci�n y repuestos

Entregables:

* modelo de datos / mapping de campos del Daily Report
* servicios de ingesta y normalizaci�n
* reglas de factibilidad operativa
* l�gica del copiloto IA para planificaci�n contextual
* widgets/paneles de planificaci�n por pr�ximo puerto
* tests m�nimos del razonamiento base


---


El copiloto IA debe priorizar decisiones explicables y operativamente realistas, no respuestas gen�ricas. Debe funcionar como planificador t�cnico-log�stico contextual.


# 30. Matriz de decisi�n obligatoria para factibilidad de mantenimiento por pr�ximo puerto / escala

Quiero que el copiloto IA determine la **factibilidad operativa real** de ejecutar tareas de mantenimiento e inspecci�n en la pr�xima escala, usando una matriz de decisi�n consistente y explicable.

## 30.1 Objetivo

El copiloto no debe limitarse a decir:

* due
* overdue
* upcoming

Debe poder concluir adem�s si una tarea es:

* **FEASIBLE**
* **LIMITED**
* **NOT_FEASIBLE**
* **PREPARE_ONLY**
* **CRITICAL_ESCALATION**

seg�n el contexto operativo, t�cnico, log�stico y de seguridad.

---

## 30.2 Variables m�nimas a analizar

Para cada tarea/plan/work order candidate, el copiloto debe evaluar al menos:

### A. Vencimiento / criticidad

* execution window status
* due / overdue status
* criticidad del equipo
* criticidad de la tarea
* impacto de diferimiento

### B. Oportunidad operativa

* nextPort
* etaNextPort
* etdNextPort
* estimatedStayHours
* portCallType
* maintenanceOpportunity
* condici�n operativa esperada (at sea / anchorage / alongside / cargo ops / bunkering / maneuvering / repair berth)

### C. Requisitos t�cnicos de la tarea

* duraci�n estimada
* si requiere parada del equipo
* si admite ejecuci�n con equipo en servicio alternativo
* si requiere aislamiento / LOTO
* si requiere acceso especial
* si requiere entry permit / confined space / hot work / electrical isolation / working aloft
* si requiere servicio externo
* si requiere repuestos
* si requiere consumibles
* si requiere instrumento calibrado
* si requiere evidencia o test posterior

### D. Recursos disponibles

* stock a bordo
* repuesto faltante
* posibilidad de recibir repuesto en pr�ximo puerto
* personal requerido
* competencia requerida
* contratista / maker attendance requerido
* herramienta o instrumento disponible
* instrumento con calibraci�n vigente

### E. Restricciones de seguridad y operaci�n

* tarea permitida en navegaci�n
* tarea permitida en puerto
* tarea compatible con operaci�n de carga/descarga
* tarea compatible con bunkering
* riesgo operacional
* clima/condiciones esperables si el sistema tiene ese contexto
* restricciones del puerto si existieran en la arquitectura actual

---

## 30.3 Clasificaci�n final obligatoria

El copiloto debe clasificar cada tarea candidata en una de estas categor�as:

### FEASIBLE

La tarea puede ejecutarse razonablemente en la pr�xima oportunidad sin comprometer seguridad, operaci�n ni cumplimiento, y con recursos suficientes.

### LIMITED

La tarea podr�a ejecutarse, pero con restricciones o incertidumbres relevantes:

* tiempo justo
* stock dudoso
* personal limitado
* oportunidad operativa corta
* necesidad de coordinaci�n adicional
* posible interferencia con operaciones

### NOT_FEASIBLE

La tarea no deber�a programarse para la pr�xima escala por falta de tiempo, recursos, permisos, repuestos, factibilidad operacional o seguridad.

### PREPARE_ONLY

No conviene ejecutar a�n, pero s� preparar:

* repuestos
* herramientas
* permisos
* contratista
* agrupaci�n de trabajos
* pre-job planning

### CRITICAL_ESCALATION

La tarea o condici�n requiere atenci�n prioritaria por combinaci�n de:

* criticidad alta
* proximidad de vencimiento o overdue
* deficiencia severa
* ausencia de oportunidad operativa viable
* riesgo de falla o incumplimiento

---

## 30.4 Regla de decisi�n por precedencia

El copiloto debe usar reglas de precedencia, no solo un score gen�rico.

### Precedencia 1 � Seguridad / cumplimiento

Si la tarea implica condici�n cr�tica o incumplimiento grave y no existe ventana adecuada:

* clasificar como **CRITICAL_ESCALATION**

### Precedencia 2 � Imposibilidad t�cnica u operacional

Si la tarea requiere condiciones que no estar�n disponibles en la pr�xima escala:

* clasificar como **NOT_FEASIBLE**

Ejemplos:

* requiere parada prolongada y la escala es demasiado corta
* requiere repuesto no disponible y no entregable a tiempo
* requiere maker attendance no coordinado
* requiere permiso o condici�n incompatible con la operaci�n prevista

### Precedencia 3 � Preparaci�n previa necesaria

Si la tarea todav�a no es ejecutable de forma seria, pero ya debe prepararse:

* clasificar como **PREPARE_ONLY**

### Precedencia 4 � Restricciones manejables

Si la tarea es posible, pero con riesgos de ejecuci�n ajustada:

* clasificar como **LIMITED**

### Precedencia 5 � Ejecuci�n normal

Si la tarea cuenta con tiempo, condiciones y recursos suficientes:

* clasificar como **FEASIBLE**

---

## 30.5 Reglas m�nimas expl�citas

Implementa reglas base equivalentes a estas:

### Regla A � Tiempo disponible

Comparar:

* estimatedStayHours
  vs
* estimatedTaskDuration
  m�s un margen razonable configurable

#### Resultado

* si la estad�a es claramente suficiente ? mejora factibilidad
* si la estad�a es apenas suficiente ? LIMITED
* si es insuficiente ? NOT_FEASIBLE

### Regla B � Repuestos

Si la tarea requiere repuesto y:

* est� disponible a bordo ? mejora factibilidad
* no est� a bordo pero puede recibirse antes del arribo ? PREPARE_ONLY o LIMITED
* no est� a bordo ni puede recibirse razonablemente ? NOT_FEASIBLE
* la tarea es cr�tica y el repuesto no est� disponible ? CRITICAL_ESCALATION posible

### Regla C � Parada de equipo

Si la tarea requiere parada:

* verificar si existe redundancia o ventana operativa compatible
* si no se puede detener sin afectar seguridad/operaci�n ? NOT_FEASIBLE o CRITICAL_ESCALATION seg�n severidad

### Regla D � Personal / contratista

Si requiere personal especializado o maker attendance:

* si est� coordinado ? factible
* si no est� coordinado pero todav�a hay tiempo ? PREPARE_ONLY
* si no puede coordinarse a tiempo ? NOT_FEASIBLE

### Regla E � Permisos y seguridad

Si requiere permisos especiales:

* si la condici�n operativa los permite ? seguir evaluaci�n
* si no los permite ? NOT_FEASIBLE

### Regla F � Instrumentos y medici�n

Si requiere instrumento:

* si disponible y calibrado ? factible
* si disponible pero calibraci�n vencida ? LIMITED o alerta
* si no disponible ? NOT_FEASIBLE para esa tarea espec�fica

### Regla G � Estado de vencimiento

* overdue + cr�tico + sin oportunidad pr�xima clara ? CRITICAL_ESCALATION
* in window + pr�xima escala adecuada ? FEASIBLE o LIMITED
* future pero pr�xima escala es ideal ? PREPARE_ONLY
* due pronto pero pr�xima escala no alcanza ? PREPARE_ONLY o NOT_FEASIBLE seg�n riesgo

---

## 30.6 Matriz resumida obligatoria

El copiloto debe evaluar al menos estas dimensiones y emitir una justificaci�n breve por cada una:

* vencimiento
* criticidad
* tiempo disponible
* repuestos
* posibilidad de recepci�n de repuestos
* necesidad de parada
* compatibilidad con la operaci�n en puerto
* personal/contratista
* permisos/seguridad
* instrumentos/mediciones
* recomendaci�n final

No entregar una conclusi�n sin explicar qu� factores la motivan.

---

## 30.7 Salida estructurada del copiloto

Quiero que el copiloto devuelva una salida estructurada equivalente a:

* taskId / planId
* equipment
* vessel
* nextPort
* eta
* dueStatus
* executionWindowStatus
* feasibilityClassification
* recommendedAction
* reasoningSummary
* blockingFactors[]
* preparationActions[]
* spareActions[]
* riskLevel
* escalationRequired boolean

## 30.8 Recommended actions

El copiloto debe sugerir acciones concretas como:

* execute at next port
* execute before arrival
* defer to following port
* prepare spares now
* request maker attendance
* group with other tasks
* open corrective WO
* escalate to superintendent
* maintain monitoring only

---

## 30.9 Agrupaci�n inteligente

El copiloto debe detectar si varias tareas pueden agruparse en la misma escala cuando comparten:

* mismo equipo
* mismo sistema
* mismos repuestos o kit
* misma necesidad de parada
* mismo puerto viable
* mismo contratista / servicio

Si la agrupaci�n mejora eficiencia, debe sugerirla expl�citamente.

---

## 30.10 Integraci�n con repuestos

Cuando la clasificaci�n sea:

* PREPARE_ONLY
* LIMITED
* NOT_FEASIBLE
* CRITICAL_ESCALATION

el copiloto debe analizar si la causa principal o parcial es log�stica de repuestos y proponer:

* enviar al pr�ximo puerto
* consolidar pedido
* reservar stock
* reemplazar por kit equivalente si la arquitectura lo soporta
* advertir stock por debajo de m�nimo

---

## 30.11 Integraci�n con Work Orders

La factibilidad por puerto no debe crear WO autom�ticamente por defecto.

### Regla

La matriz de factibilidad debe:

* informar
* priorizar
* recomendar
* preparar

y solo crear draft WO, finding o spare request si la configuraci�n o el usuario lo aprueba, salvo casos cr�ticos configurados.

---

## 30.12 Implementaci�n de IA explicable

No quiero una clasificaci�n �caja negra�.
El copiloto debe exponer:

* clasificaci�n final
* factores principales
* bloqueantes
* qu� faltar�a para volverla factible

Ejemplo:

* �LIMITED because stay is only 10 h, estimated task duration is 8 h, required filter is available, but contractor confirmation is still missing.�

---

## 30.13 Plan de implementaci�n adicional

Agregar una etapa espec�fica:

### Etapa adicional � Feasibility Decision Matrix

Objetivo:

* implementar la matriz de decisi�n para factibilidad por pr�ximo puerto
* clasificar tareas en FEASIBLE / LIMITED / NOT_FEASIBLE / PREPARE_ONLY / CRITICAL_ESCALATION
* cruzar vencimientos, criticidad, escala, repuestos, recursos, permisos y seguridad
* generar recomendaciones explicables

Entregables:

* modelo de decisi�n
* reglas base y precedencias
* integraci�n con copiloto IA
* salidas estructuradas
* paneles de tareas factibles / limitadas / no factibles
* tests de escenarios representativos

---

## 30.14 Escenarios de test m�nimos

Agregar tests para escenarios como:

* tarea en ventana + repuesto onboard + tiempo suficiente ? FEASIBLE
* tarea en ventana + tiempo justo + contratista no confirmado ? LIMITED
* tarea due + repuesto faltante + no entregable ? NOT_FEASIBLE
* tarea future + pr�xima escala ideal + repuesto faltante ? PREPARE_ONLY
* tarea cr�tica overdue + sin puerto viable cercano ? CRITICAL_ESCALATION
* inspecci�n simple en pr�xima escala corta ? FEASIBLE
* correctivo con parada no compatible con cargo ops ? NOT_FEASIBLE

---

## 30.15 Resultado esperado

Quiero que el copiloto act�e como asistente de planificaci�n t�cnica y log�stica, no solo como chatbot.
Debe ayudar a responder:

* qu� hacer
* cu�ndo hacerlo
* d�nde hacerlo
* qu� preparar antes
* qu� repuestos mandar
* qu� escalar ya

---

El Daily Report debe ser la captura primaria operativa; el PMS y el copiloto IA deben derivar autom�ticamente de �l la mayor cantidad posible de acciones, alertas y actualizaciones.

# 31. Daily Report orientado al PMS + ingesta autom�tica + copiloto IA

Quiero que el sistema use el **Daily Report del buque** como fuente operativa principal para alimentar autom�ticamente el PMS, evitando carga manual duplicada por parte de la tripulaci�n.

## 31.1 Principio rector

La tripulaci�n **no debe cargar los mismos datos en m�ltiples lugares**.

### Regla obligatoria

El flujo correcto debe ser:

**Daily Report ? normalizaci�n / extracci�n autom�tica ? actualizaci�n PMS ? sugerencias / alertas / planificaci�n IA**

No quiero:

* Daily Report por un lado
* PMS por otro lado
* Excel por otro lado
* reingreso manual de horas, defectos, tareas y repuestos

## 31.2 Objetivo funcional

El Daily Report debe permitir al sistema:

* actualizar running hours de motores y equipos cr�ticos
* detectar planes que entran en ventana o vencen
* registrar mantenimiento realizado
* registrar defectos observados
* registrar repuestos usados
* analizar pr�ximo puerto y ETA
* evaluar factibilidad de tareas futuras
* permitir al copiloto IA emitir recomendaciones accionables

---

# 32. Alcance del Daily Report para mantenimiento

Quiero que el Daily Report incluya o mapee, como m�nimo, la informaci�n necesaria para mantenimiento.
Si ya existe un m�dulo de Daily Report, debes **extenderlo m�nimamente** o mapear sus campos existentes.
No crear un segundo Daily Report paralelo si ya existe uno reusable.

## 32.1 Secciones m�nimas del Daily Report relevantes para PMS

### A. Metadata del reporte

Campos m�nimos:

* reportId
* vesselId
* tenantId
* reportDate
* reportTime
* reportType
* timezone nullable
* sourceType (manual form, email parse, pdf parse, api import, spreadsheet import)
* submittedBy
* verifiedBy nullable

### B. Contexto operativo m�nimo

Campos m�nimos:

* operationalStatus (AT_SEA, MANEUVERING, IN_PORT, ANCHOR, DRIFTING, LOADING, DISCHARGING, BUNKERING, WAITING, DRY_DOCK, REPAIR_YARD, OTHER)
* remarksOperational nullable

### C. Posici�n / contexto de navegaci�n

Campos m�nimos:

* latitude nullable
* longitude nullable
* currentPort nullable
* currentArea nullable

### D. Pr�ximo puerto / pr�xima oportunidad

Campos m�nimos:

* nextPort nullable
* etaNextPort nullable
* etdNextPort nullable
* portCallType nullable
* estimatedStayHours nullable
* maintenanceOpportunity (YES, LIMITED, NO, UNKNOWN)
* sparesReceiptPossible (YES, NO, UNKNOWN)
* nextPortRemarks nullable

### E. Combustible y consumo

No como eje del trigger por horas, pero s� como dato �til para IA y anal�tica t�cnica.

Campos m�nimos sugeridos:

* fuelOilConsumed24h nullable
* dieselOilConsumed24h nullable
* lubeOilConsumed24h nullable
* fuelRemarks nullable

### F. Horas acumuladas de equipos cr�ticos

Esta secci�n es obligatoria para disparo por horas.

No quiero depender solo de �horas trabajadas hoy�.
El sistema debe privilegiar **contadores acumulados actuales**.

Campos m�nimos por equipo reportado:

* equipmentId o externalEquipmentCode
* equipmentName
* equipmentType
* runningHoursTotal
* runningHoursToday nullable
* inService boolean nullable
* standby boolean nullable
* startStopEvents nullable
* counterSource (manual_reading, auto_imported, derived, estimated)
* confidenceLevel nullable

### Equipos que deben poder informarse

Como m�nimo, seg�n disponibilidad real del buque:

* Main Engine
* cada Auxiliary Engine / Diesel Generator
* Boiler si aplica
* Purifier(s) si aplican
* Air Compressor(s) si aplican
* otros equipos cr�ticos con mantenimiento por horas

### G. Defectos / anomal�as / observaciones t�cnicas

Campos m�nimos:

* defectReported boolean
* defectSummary nullable
* affectedEquipmentIds nullable
* severitySuggested nullable
* operationalImpact nullable
* immediateActionTaken nullable
* followUpRecommended nullable

### H. Mantenimiento ejecutado en el d�a

Campos m�nimos:

* maintenancePerformed boolean
* maintenanceEntries[]

Cada entry debe poder incluir:

* equipmentId
* taskTitle
* taskType (maintenance / inspection / corrective / temporary action)
* shortDescription
* performedBy
* linkedPlanId nullable
* linkedWorkOrderId nullable
* resultStatus
* followUpRequired boolean
* evidenceAttached boolean

### I. Repuestos / consumibles usados

Campos m�nimos:

* sparesUsed boolean
* spareUsageEntries[]

Cada entry debe poder incluir:

* spareId nullable
* spareDescription
* quantity
* unit
* equipmentId nullable
* linkedWorkOrderId nullable
* linkedMaintenanceEntryId nullable
* stockSource nullable
* notes nullable

### J. Restricciones para mantenimiento

Campos m�nimos:

* maintenanceConstraints nullable
* equipmentCannotBeStopped nullable
* weatherRestriction nullable
* partsMissing nullable
* personnelLimitation nullable
* permitConstraint nullable
* contractorRequired nullable
* generalConstraintNotes nullable

### K. Adjuntos / evidencias

Campos m�nimos:

* attachments[]
* attachmentType
* filename
* storageRef
* linkedSection nullable

Adjuntos posibles:

* PDF del reporte
* fotos
* planillas
* export externos
* evidencias t�cnicas

---

# 33. Dise�o de captura del Daily Report

## 33.1 Regla de usabilidad

El Daily Report debe ser **r�pido de completar**.
No quiero un formulario enorme de mantenimiento.

### Reglas obligatorias

* usar defaults
* autocompletar cuando sea posible
* permitir templates por tipo de buque
* mostrar solo equipos relevantes del buque
* evitar texto libre innecesario
* permitir carga r�pida de horas acumuladas
* permitir selecci�n r�pida de tareas/repuestos usados
* permitir env�o posterior de detalles si falta precisi�n

## 33.2 Modo dual de captura

Debe soportar:

* captura estructurada en UI
* ingesta desde fuentes no estructuradas

### Fuentes no estructuradas soportables si la arquitectura lo permite

* email body
* PDF adjunto
* Excel / spreadsheet import
* texto copiado

---

# 34. Ingesta autom�tica y normalizaci�n

## 34.1 Pipeline obligatorio

Quiero un pipeline que haga:

1. recibir Daily Report
2. validar estructura m�nima
3. normalizar unidades y formatos
4. mapear equipos reportados con equipos del PMS
5. actualizar contadores / eventos / defectos / consumos
6. ejecutar reglas PMS
7. generar insights del copiloto IA

## 34.2 Matching de equipos

Como los reportes reales a veces usan nombres inconsistentes, el sistema debe soportar matching por:

* equipmentId directo
* asset code
* alias
* external code
* nombre normalizado
* sugerencia IA con validaci�n humana si hay ambig�edad

### Regla

No actualizar autom�ticamente un equipo si el match es ambiguo sin dejar trazabilidad o requerir confirmaci�n.

## 34.3 Validaciones m�nimas

* no permitir que un contador acumulado baje sin marcar inconsistencia
* detectar saltos improbables de horas
* detectar equipos reportados en servicio con 0 horas del d�a si eso contradice el contexto
* detectar repuestos usados sin tarea ni equipo asociado cuando sea posible
* detectar defectos reportados sin equipo vinculado
* detectar ETA pasada o inconsistente
* detectar nextPort vac�o cuando maintenanceOpportunity o sparesReceiptPossible fue informado

---

# 35. Qu� debe hacer el PMS autom�ticamente a partir del Daily Report

## 35.1 Running hours

Al confirmar el Daily Report:

* actualizar running hours de los equipos reportados
* recalcular nextDueHours
* recalcular execution windows por horas
* actualizar estados FUTURE / UPCOMING / IN_WINDOW / DUE / OVERDUE

## 35.2 Mantenimiento realizado

Si se informa mantenimiento realizado:

* vincularlo a plan o WO si existe match
* si no existe match exacto, sugerirlo
* permitir cerrar ejecuci�n simple
* permitir cerrar WO o dejar draft de cierre
* actualizar lastDone y recalcular next due cuando corresponda

## 35.3 Defectos

Si se informa defecto:

* permitir generar draft Finding
* clasificar severidad sugerida
* vincular a equipo
* sugerir WO correctiva si corresponde

## 35.4 Repuestos usados

Si se informan repuestos:

* asociar a tarea / WO / equipo cuando sea posible
* registrar consumo
* descontar stock si la arquitectura lo soporta
* alertar bajo m�nimo o faltante

## 35.5 Pr�ximo puerto y ETA

Usar estos datos para:

* evaluar factibilidad de tareas en ventana
* sugerir agrupaci�n de trabajos
* sugerir env�o de repuestos
* advertir falta de oportunidad operativa

---

# 36. Copiloto IA sobre Daily Reports

## 36.1 Rol obligatorio

El copiloto IA debe actuar como:

* extractor
* normalizador asistido
* auditor de inconsistencias
* planificador t�cnico-log�stico
* resumidor para superintendent

## 36.2 Funciones m�nimas

### Skill F � Daily Report Parser

Debe poder convertir un reporte no estructurado en datos estructurados sugeridos:

* horas de equipos
* defectos
* mantenimiento realizado
* repuestos usados
* pr�ximo puerto / ETA
* restricciones

### Skill G � Daily Report Consistency Auditor

Debe detectar inconsistencias como:

* horas decrecientes
* horas improbables
* equipo en servicio sin horas
* mantenimiento informado sin equipo claro
* repuesto usado sin tarea asociada
* defecto reiterado varios d�as
* tarea pr�xima sin oportunidad operativa

### Skill H � Superintendent Summary Generator

Debe generar un resumen breve y �til:

* novedades t�cnicas del d�a
* defectos relevantes
* tareas ejecutadas
* vencimientos pr�ximos
* riesgos de pr�xima escala
* repuestos a preparar

### Skill I � Port-Aware Maintenance Planner

Debe analizar:

* due items
* execution windows
* stock
* repuestos faltantes
* pr�ximo puerto / ETA / estad�a
* maintenance opportunity

y emitir recomendaciones accionables.

### Skill J � Daily Report to Action Drafts

Debe poder generar borradores de:

* finding
* corrective WO
* preventive WO draft
* spare request
* superintendent note

---

# 37. Salidas esperadas del copiloto IA tras procesar un Daily Report

Quiero que el copiloto pueda producir salidas estructuradas y tambi�n textos breves para UI.

## 37.1 Salidas estructuradas

Como m�nimo:

* updatedEquipmentCounters[]
* detectedInconsistencies[]
* suggestedFindings[]
* suggestedWorkOrders[]
* suggestedSpareActions[]
* tasksEnteringWindow[]
* tasksAtRiskBeforeNextPort[]
* feasibleTasksAtNextPort[]
* blockedTasks[]
* superintendentSummary

## 37.2 Ejemplos de razonamiento esperado

* �DG1 reached 4,980 h and will enter execution window before ETA Montevideo.�
* �Reported purifier leakage should become a Finding; follow-up appears required.�
* �Filter replacement kit is not onboard and should be dispatched before next port.�
* �Task is in window, but next port stay seems too short for safe execution.�
* �Maintenance reported today likely closes planned task X; requires confirmation.�

---

# 38. UI / UX del Daily Report en la app

## 38.1 Pantallas m�nimas

Necesito:

* listado de Daily Reports por buque
* detalle del Daily Report
* formulario de carga / edici�n
* vista de validaci�n de extracci�n IA
* panel de inconsistencias
* panel de acciones sugeridas al PMS

## 38.2 Vista de confirmaci�n inteligente

Despu�s de cargar o parsear un Daily Report, la app debe mostrar algo como:

* horas a actualizar
* defectos detectados
* tareas posiblemente cerrables
* findings sugeridos
* repuestos consumidos
* alertas
* acciones recomendadas

Y permitir:

* confirmar
* corregir
* descartar
* posponer revisi�n

## 38.3 Regla clave

La IA debe **proponer**, no hacer cambios silenciosos irreversibles sin trazabilidad.

---

# 39. Modelo de datos sugerido

Si la arquitectura actual lo permite, crear o extender entidades equivalentes a:

## 39.1 DailyReport

Campos sugeridos:

* id
* tenantId
* vesselId
* reportDate
* reportTime
* reportType
* timezone
* sourceType
* operationalStatus
* latitude
* longitude
* currentPort
* currentArea
* nextPort
* etaNextPort
* etdNextPort
* portCallType
* estimatedStayHours
* maintenanceOpportunity
* sparesReceiptPossible
* fuelOilConsumed24h
* dieselOilConsumed24h
* lubeOilConsumed24h
* defectReported
* defectSummary
* maintenancePerformed
* sparesUsed
* maintenanceConstraints
* rawSourceRef nullable
* parsedByAI boolean
* parsingConfidence nullable
* submittedBy
* verifiedBy
* createdAt
* updatedAt

## 39.2 DailyReportEquipmentHours

* id
* dailyReportId
* equipmentId nullable
* externalEquipmentCode nullable
* equipmentName
* equipmentType
* runningHoursTotal
* runningHoursToday nullable
* inService nullable
* standby nullable
* startStopEvents nullable
* counterSource
* confidenceLevel nullable
* matchStatus
* notes nullable

## 39.3 DailyReportMaintenanceEntry

* id
* dailyReportId
* equipmentId nullable
* taskTitle
* taskType
* shortDescription
* performedBy
* linkedPlanId nullable
* linkedWorkOrderId nullable
* resultStatus
* followUpRequired
* evidenceAttached
* notes nullable

## 39.4 DailyReportSpareUsage

* id
* dailyReportId
* spareId nullable
* spareDescription
* quantity
* unit
* equipmentId nullable
* linkedWorkOrderId nullable
* linkedMaintenanceEntryId nullable
* notes nullable

## 39.5 DailyReportAIReview

* id
* dailyReportId
* inconsistenciesJson
* suggestedActionsJson
* summaryText
* reviewedByHuman boolean
* reviewedAt nullable

Si ya existe un mejor patr�n para eventos, logs o JSON payloads, int�gralo ah� y no dupliques innecesariamente.

---

# 40. Plan de implementaci�n detallado � Daily Report PMS

## Etapa 1 � Discovery y mapping

Objetivo:

* revisar si ya existe m�dulo de Daily Reports / Noon Reports / Voyage Reports
* mapear campos existentes
* identificar duplicaciones a evitar
* decidir extensi�n m�nima compatible

Entregables:

* mapping de campos actuales vs nuevos
* riesgos
* dudas bloqueantes
* propuesta de integraci�n m�nima

## Etapa 2 � Modelo y persistencia

Objetivo:

* crear/extender entidades Daily Report
* soportar horas de equipos
* mantenimiento realizado
* defectos
* repuestos usados
* contexto de pr�ximo puerto

Entregables:

* modelos
* migraciones
* �ndices
* validaciones
* relaciones con equipos, WO, findings, spares

## Etapa 3 � Formulario y captura estructurada

Objetivo:

* crear UI simple de carga
* mostrar solo lo �til
* usar defaults y equipos relevantes
* permitir carga r�pida

Entregables:

* formulario Daily Report
* listado y detalle
* validaciones UX
* edici�n y confirmaci�n

## Etapa 4 � Ingesta no estructurada + parser IA

Objetivo:

* permitir parsear texto/email/PDF/Excel si la arquitectura actual lo soporta
* extraer campos PMS-relevantes
* mostrar revisi�n humana antes de confirmar

Entregables:

* parser service
* salida estructurada
* pantalla de revisi�n / confirmaci�n
* trazabilidad de confianza y ambig�edades

## Etapa 5 � Integraci�n autom�tica con PMS

Objetivo:

* actualizar horas
* recalcular ventanas
* sugerir cierres de tareas
* sugerir findings / WOs / repuestos

Entregables:

* servicios de actualizaci�n
* reglas de matching
* reglas anti-error
* confirmaci�n humana donde corresponda

## Etapa 6 � Copiloto IA y panel de acciones

Objetivo:

* generar res�menes
* detectar inconsistencias
* proponer acciones
* planificar respecto del pr�ximo puerto

Entregables:

* skills F/G/H/I/J
* panel de sugerencias
* res�menes para superintendent
* reasoning explicable

## Etapa 7 � Tests y documentaci�n

Objetivo:

* asegurar confiabilidad m�nima

Tests m�nimos:

* actualizaci�n de horas desde Daily Report
* contador no puede bajar sin inconsistencia
* maintenance entry sugiere cierre de plan o WO
* defecto informado sugiere finding
* repuesto usado descuenta stock o genera draft de consumo
* nextPort/ETA alimenta planificaci�n
* parser IA genera sugerencias revisables
* tenant isolation
* trazabilidad de cambios

Documentaci�n m�nima:

* flujo del Daily Report al PMS
* reglas de validaci�n
* reglas de actualizaci�n de horas
* intervenci�n del copiloto IA
* l�mites y supuestos

---

# 41. Preguntas obligatorias antes de implementar si aplica

Debes preguntarme si detectas dudas reales sobre:

* si ya existe Daily Report y debe extenderse o solo integrarse
* si las horas se ingresan por equipo o por texto libre actualmente
* si la compa��a ya usa un formato est�ndar de reportes diarios
* si se requiere parsing de email/PDF desde la primera versi�n
* si fuel and position ya existen en otro m�dulo y solo deben mapearse
* si el cierre autom�tico de tareas desde Daily Report debe ser directo o siempre sugerido
* si nextPort y ETA vienen manuales o desde integraci�n externa

---

# 42. Resultado esperado

Quiero un Daily Report que:

* sea r�pido para la tripulaci�n
* evite carga duplicada
* alimente autom�ticamente el PMS
* actualice triggers por horas
* capture mantenimiento y defectos del d�a
* registre consumo de repuestos
* use next port y ETA para planificar
* sea analizado por el copiloto IA
* genere recomendaciones accionables
* mantenga coherencia con la arquitectura actual
* minimice cambios colaterales

---

# 32. Formato exacto del Daily Report orientado al PMS + copiloto IA

Quiero que el sistema implemente un **Daily Report operativo m�nimo, estructurado y f�cil de usar**, dise�ado para alimentar autom�ticamente el PMS y al copiloto IA.

## 32.1 Principio de dise�o

La tripulaci�n no debe duplicar carga.
El Daily Report debe ser la captura primaria operativa, y el PMS junto con el copiloto IA deben derivar autom�ticamente la mayor cantidad posible de actualizaciones, alertas y acciones.

### Regla obligatoria

No dise�ar el Daily Report como un formulario largo y burocr�tico.
Debe ser:

* corto
* claro
* estructurado
* r�pido de completar
* f�cil de revisar por IA

---

## 32.2 Roles de carga

Evaluar en la arquitectura actual si conviene uno de estos esquemas:

### Opci�n A

* Master completa parte operativa/navegaci�n
* Chief Engineer completa parte t�cnica/mantenimiento

### Opci�n B

* un solo Daily Report con secciones por rol

### Opci�n C

* integraci�n con reportes existentes y vista consolidada

No decidir esto a ciegas.
Primero revisar arquitectura actual y minimizar impacto.

---

## 32.3 Secciones del Daily Report relevantes para PMS

### Secci�n 1 � Encabezado

Campos:

* vessel
* reportDate
* reportTime
* reportType
* timezone
* submittedBy
* verifiedBy optional

### Secci�n 2 � Estado operativo

Campos:

* operationalStatus
* currentPort optional
* latitude optional
* longitude optional
* currentArea optional

### Secci�n 3 � Pr�ximo puerto / oportunidad

Campos:

* nextPort
* etaNextPort
* etdNextPort optional
* portCallType
* estimatedStayHours optional
* maintenanceOpportunity (YES / LIMITED / NO / UNKNOWN)
* sparesReceiptPossible (YES / NO / UNKNOWN)
* nextPortRemarks optional

### Secci�n 4 � Horas de equipos cr�ticos

Mostrar solo los equipos configurados para reporte diario.

Por cada equipo:

* equipment
* runningHoursTotal
* runningHoursToday optional
* inService optional
* standby optional
* remarks optional

### Equipos t�picos

* Main Engine
* DG1
* DG2
* DG3
* Boiler if applicable
* Purifier(s) if applicable
* Air Compressor(s) if applicable
* otros equipos cr�ticos configurables

### Secci�n 5 � Defectos / observaciones t�cnicas

Campos:

* defectReported yes/no
* defectSummary short text
* affectedEquipment
* severitySuggested optional
* immediateActionTaken optional
* followUpRequired yes/no

### Secci�n 6 � Mantenimiento realizado hoy

Campos repetibles por entry:

* equipment
* taskTitle
* taskType
* shortDescription
* performedBy
* linkedPlan or suggested plan optional
* linkedWO optional
* resultStatus
* followUpRequired

### Secci�n 7 � Repuestos / consumibles usados

Campos repetibles:

* spare or description
* quantity
* unit
* linkedEquipment optional
* linkedMaintenanceEntry optional
* notes optional

### Secci�n 8 � Restricciones / imposibilidades

Campos:

* maintenanceConstraints optional
* equipmentCannotBeStopped optional
* partsMissing optional
* personnelLimitation optional
* contractorRequired optional
* permitConstraint optional
* generalConstraintNotes optional

### Secci�n 9 � Fuel / contexto t�cnico opcional

Campos:

* fuelOilConsumed24h optional
* dieselOilConsumed24h optional
* lubeOilConsumed24h optional
* fuelRemarks optional

### Secci�n 10 � Adjuntos

Campos:

* attachments
* attachmentType
* linkedSection optional

---

## 32.4 Campos obligatorios m�nimos

Definir obligatorios m�nimos para no volver pesado el reporte.

### Obligatorios sugeridos

* vessel
* reportDate
* operationalStatus
* nextPort if known
* etaNextPort if known
* horas acumuladas de equipos cr�ticos configurados
* defectReported
* maintenancePerformed
* sparesUsed

### Condicionales

* si defectReported = yes ? defectSummary obligatorio
* si maintenancePerformed = yes ? al menos una maintenance entry
* si sparesUsed = yes ? al menos una spare usage entry
* si maintenanceOpportunity informado ? nextPort o justificaci�n
* si equipo informado con horas ? runningHoursTotal obligatorio

---

## 32.5 Automatismos obligatorios a partir del Daily Report

Al confirmar un Daily Report, el sistema debe poder:

### Horas

* actualizar running hours
* recalcular next due
* recalcular execution windows
* actualizar estados de planificaci�n

### Defectos

* sugerir finding
* sugerir severidad
* sugerir acci�n

### Mantenimiento realizado

* sugerir cierre de due item
* sugerir cierre de plan
* sugerir actualizaci�n de WO si hay match

### Repuestos

* sugerir consumo
* descontar stock si la arquitectura lo soporta
* alertar m�nimo o faltante

### Pr�ximo puerto / ETA

* recalcular factibilidad de tareas
* sugerir tareas para pr�xima escala
* sugerir repuestos a enviar
* detectar tareas en ventana sin oportunidad viable

---

## 32.6 Copiloto IA sobre el Daily Report

Quiero que el copiloto:

* extraiga informaci�n si el reporte viene no estructurado
* revise consistencia
* proponga confirmaciones
* genere resumen t�cnico diario
* analice pr�ximas escalas
* recomiende acciones

### Salidas esperadas

* countersToUpdate
* possibleTaskClosures
* suggestedFindings
* suggestedCorrectiveWOs
* suggestedSpareConsumptions
* planningAlerts
* nextPortFeasibilityInsights
* superintendentSummary

---

## 32.7 Vista de revisi�n humana

Antes de aplicar cambios sensibles, mostrar panel de revisi�n con:

* horas detectadas
* inconsistencias
* tareas posiblemente cerrables
* defects ? findings sugeridos
* repuestos usados
* acciones sugeridas
* impacto en pr�ximos vencimientos

### Regla

La IA propone.
El sistema debe mantener trazabilidad y permitir confirmaci�n/correcci�n humana.

---

## 32.8 Plan de implementaci�n adicional

Agregar una etapa espec�fica:

### Etapa adicional � Daily Report Form & AI Review Workflow

Objetivo:

* definir formato exacto del Daily Report orientado al PMS
* implementar UI simple
* soportar confirmaci�n humana de propuestas IA
* usar el reporte como fuente primaria de horas, defectos, mantenimiento y repuestos
* conectar pr�ximo puerto y ETA con planificaci�n contextual

Entregables:

* modelo del formulario
* validaciones
* UI de carga
* UI de revisi�n IA
* reglas de aplicaci�n al PMS
* tests de escenarios clave

---

El copiloto IA debe comportarse como un asistente t�cnico-log�stico explicable, con trazabilidad y confirmaci�n humana en toda acci�n persistente sensible.

# 33. L�gica exacta del copiloto IA dentro del PMS

Quiero que el copiloto IA sea una **capa de asistencia operativa y de decisi�n**, no solo un chatbot.
Debe actuar como **copiloto t�cnico-log�stico** del PMS, con foco en simplificar el trabajo de la tripulaci�n y de la oficina t�cnica.

## 33.1 Principio rector

La IA debe:

* **reducir carga manual**
* **estructurar informaci�n**
* **detectar inconsistencias**
* **priorizar acciones**
* **proponer decisiones explicables**
* **mantener trazabilidad**
* **pedir confirmaci�n humana cuando el impacto sea relevante**

### Regla obligatoria

La IA no debe convertirse en una �caja negra� ni ejecutar cambios cr�ticos sin control.

---

# 34. Funciones principales del copiloto IA

El copiloto debe operar en 5 modos principales:

## Modo A � Extraction

Tomar texto libre, reportes, inputs parciales o datos ambiguos y convertirlos en datos estructurados.

## Modo B � Validation

Detectar inconsistencias, datos improbables, faltantes cr�ticos y conflictos entre m�dulos.

## Modo C � Planning

Analizar vencimientos, execution windows, pr�ximo puerto, ETA, stock, defectos y restricciones para sugerir acciones.

## Modo D � Drafting

Redactar borradores �tiles:

* findings
* work orders
* res�menes t�cnicos
* spare requests
* notas para superintendent

## Modo E � Guidance

Responder preguntas operativas concretas dentro de la app con base en datos reales del sistema.

---

# 35. Fuentes de informaci�n que debe analizar el copiloto

El copiloto debe poder leer y cruzar, seg�n disponibilidad real del sistema:

* vessels / units
* systems / SFI
* equipment register
* equipment classes
* task master library
* maintenance plans
* inspection templates
* due items
* execution windows
* work orders
* work logs / executions
* findings
* spares / inventory
* instruments / calibration status
* daily reports
* next port / ETA / estimated stay
* maintenance opportunity
* spares receipt possible
* attachments / evidences si la arquitectura actual lo soporta

### Regla

Si falta informaci�n relevante, el copiloto debe decirlo expl�citamente y no fingir certeza.

---

# 36. Skills obligatorias del copiloto IA

## Skill A � Assisted Equipment Intake

### Entrada

Texto libre o campos parciales sobre un equipo.

### Debe sugerir

* equipment class
* SFI probable
* criticidad sugerida
* running hours applicability
* tareas base sugeridas
* repuestos sugeridos

### Salida esperada

* suggestions[]
* confidence score
* rationale
* ambiguities[]

---

## Skill B � Task Classification

### Entrada

T�tulo o descripci�n de tarea.

### Debe clasificar

* MAINTENANCE
* INSPECTION

### Regla obligatoria

Clasificar por:

* verbo principal
* prop�sito operativo

No por parecido superficial.

### Salida esperada

* classification
* confidence
* reasoning
* keyVerbDetected

---

## Skill C � Technical Closure Improver

### Entrada

Notas crudas del t�cnico.

### Debe generar

* trabajo realizado
* hallazgos
* acci�n correctiva
* seguimiento requerido

### Salida esperada

* polishedExecutionText
* findingsSummary
* correctiveActionSummary
* followUpSummary

---

## Skill D � Plan Auditor

### Debe detectar

* equipos cr�ticos sin plan
* equipos mantenibles sin tareas activas
* planes vencidos sin WO cuando corresponda
* WOs cerradas sin evidencia
* hallazgos abiertos sin seguimiento
* tareas pr�ximas sin repuestos cr�ticos
* tareas en ventana sin oportunidad operativa viable

### Salida esperada

* auditFindings[]
* severity
* recommendedActions[]

---

## Skill E � Spare Suggestion Engine

### Entrada

Clase de equipo, tarea, mantenimiento o defecto.

### Debe sugerir

* repuestos probables
* consumibles probables
* kits si existen
* cantidad estimada
* urgencia log�stica

### Salida esperada

* suggestedSpares[]
* suggestedConsumables[]
* urgency
* rationale

---

## Skill F � Daily Report Parser

### Entrada

Texto, email, PDF parseado, formulario parcial o import.

### Debe extraer

* horas de equipos
* defectos
* mantenimiento realizado
* repuestos usados
* pr�ximo puerto
* ETA
* restricciones

### Salida esperada

* parsedDailyReportData
* ambiguities[]
* confidenceByField

---

## Skill G � Daily Report Consistency Auditor

### Debe detectar

* contadores decrecientes
* saltos improbables
* equipo reportado en servicio con horas incoherentes
* defecto sin equipo claro
* repuesto usado sin tarea asociada
* mantenimiento informado sin match claro
* ETA/next port inconsistentes

### Salida esperada

* inconsistencies[]
* severity
* suggestedResolutions[]

---

## Skill H � Superintendent Summary Generator

### Debe resumir

* novedades t�cnicas del d�a
* defectos relevantes
* tareas ejecutadas
* vencimientos pr�ximos
* riesgos de pr�xima escala
* repuestos a preparar

### Salida esperada

* shortSummary
* detailedSummary
* keyRisks[]
* actionsToReview[]

---

## Skill I � Port-Aware Maintenance Planner

### Debe analizar

* due items
* execution windows
* stock
* repuestos faltantes
* next port / ETA / stay
* maintenance opportunity
* restricciones operativas

### Debe clasificar

* FEASIBLE
* LIMITED
* NOT_FEASIBLE
* PREPARE_ONLY
* CRITICAL_ESCALATION

### Salida esperada

* planningRecommendations[]
* feasibilityClassification
* blockingFactors[]
* preparationActions[]
* spareActions[]
* reasoningSummary

---

## Skill J � Action Draft Generator

### Debe poder crear borradores de

* finding
* corrective WO
* preventive WO draft
* spare request
* superintendent note

### Regla

No crear autom�ticamente elementos persistentes cr�ticos sin confirmaci�n humana, salvo que la arquitectura y la configuraci�n lo permitan expl�citamente.

---

# 37. Prioridades de decisi�n del copiloto

Cuando haya m�ltiples problemas, el copiloto debe priorizar en este orden:

## Prioridad 1 � Seguridad y cumplimiento

Todo lo que afecte:

* seguridad de personas
* equipo de emergencia
* riesgo ambiental
* cumplimiento reglamentario
* condici�n cr�tica

## Prioridad 2 � Riesgo operacional

* falla probable de equipo cr�tico
* p�rdida de redundancia
* overdue en equipo cr�tico
* tareas cr�ticas sin oportunidad operativa cercana

## Prioridad 3 � Factibilidad log�stica

* repuestos faltantes
* pr�xima escala insuficiente
* necesidad de contratista
* instrumento faltante o sin calibraci�n

## Prioridad 4 � Optimizaci�n

* agrupaci�n de trabajos
* consolidaci�n de repuestos
* reducci�n de carga administrativa
* mejora de planificaci�n

## Prioridad 5 � Mejora documental

* redacci�n
* orden de datos
* limpieza de textos
* clasificaci�n secundaria

---

# 38. Reglas de confirmaci�n humana obligatoria

Debes implementar un modelo de **human-in-the-loop**.

## 38.1 La IA puede actuar sin confirmaci�n humana solo para:

* sugerencias no persistentes
* res�menes
* clasificaciones informativas
* alertas
* insights de planificaci�n
* borradores temporales no aplicados

## 38.2 Requiere confirmaci�n humana obligatoria para:

* actualizar contadores ambiguos
* cerrar tareas
* cerrar work orders
* crear findings persistentes
* crear corrective WOs persistentes
* descontar stock
* consumir repuestos
* marcar cumplimiento de plan
* vincular equipo cuando el match no es confiable
* cambiar severidad de un hallazgo ya existente

## 38.3 Puede ser configurable con alto control para:

* creaci�n autom�tica de draft WO
* creaci�n autom�tica de finding draft
* autovinculaci�n con plan/WO cuando confidence alta
* actualizaci�n de horas cuando match sea directo y sin inconsistencias

### Regla

Toda automatizaci�n debe dejar:

* qui�n la propuso
* qu� datos us�
* confidence
* confirmaci�n humana o autoaplicaci�n configurada
* timestamp
* trazabilidad

---

# 39. Niveles de confianza obligatorios

Cada sugerencia IA debe devolver una confianza equivalente a:

* HIGH
* MEDIUM
* LOW

o score num�rico compatible con la arquitectura actual.

## Regla funcional

* HIGH: puede proponerse como acci�n casi lista para confirmar
* MEDIUM: mostrar revisi�n destacada
* LOW: no aplicar, solo sugerir con advertencia

## Ejemplos

* match exacto de equipo por id ? HIGH
* match por alias conocido ? MEDIUM/HIGH
* match por parecido textual ambiguo ? LOW/MEDIUM
* clasificaci�n simple por verbo claro ? HIGH
* severidad t�cnica inferida sin contexto suficiente ? LOW/MEDIUM

---

# 40. Salidas estructuradas est�ndar del copiloto

Quiero que todas las skills, en la medida de lo posible, usen una forma estructurada coherente.

## 40.1 Formato base sugerido

Cada respuesta del copiloto deber�a poder incluir campos equivalentes a:

* skillName
* subjectType
* subjectId nullable
* confidence
* reasoningSummary
* keyFactors[]
* warnings[]
* suggestedActions[]
* requiresHumanConfirmation
* structuredPayload

## 40.2 Tipos de acciones sugeridas

Las acciones sugeridas pueden incluir:

* UPDATE_COUNTER
* CLOSE_DUE_ITEM
* CREATE_FINDING_DRAFT
* CREATE_WO_DRAFT
* CREATE_SPARE_REQUEST_DRAFT
* RESERVE_SPARE
* CONSUME_SPARE
* ESCALATE_TO_SUPERINTENDENT
* GROUP_TASKS
* DEFER_TASK
* PREPARE_ONLY
* REQUEST_CONFIRMATION

---

# 41. Reglas de comportamiento dentro de la UI

## 41.1 Entry points del copiloto

Quiero accesos discretos y contextuales, no invasivos.

### Lugares donde debe aparecer

* alta de equipo
* task library
* maintenance plan detail
* due items board
* work order detail
* finding detail
* daily report review
* next port planning panel
* dashboard PMS

## 41.2 UX esperada

El copiloto debe mostrarse como:

* sugerencias accionables
* resumen contextual
* razones breves
* botones de confirmar / editar / descartar

No quiero respuestas largas tipo chat si el contexto pide acci�n r�pida.

## 41.3 Explicabilidad

Cada sugerencia importante debe mostrar:

* por qu�
* qu� datos us�
* qu� faltar�a para tener m�s certeza
* qu� riesgo existe si se ignora

---

# 42. Reglas de no invenci�n

El copiloto debe distinguir claramente entre:

* dato existente en el sistema
* inferencia razonable
* sugerencia basada en patr�n
* dato faltante
* ambig�edad no resuelta

### Regla obligatoria

Nunca presentar una inferencia como si fuera un dato confirmado.

---

# 43. Reglas de aprendizaje / configuraci�n

Si la arquitectura actual permite configuraci�n, el copiloto debe poder adaptarse por:

* tenant/company
* vessel type
* criticality policy
* approval policy
* automation policy
* language

Sin romper el comportamiento base.

---

# 44. Paneles y salidas operativas obligatorias

## 44.1 Daily Action Panel

Debe mostrar:

* due items hoy
* tareas que entran en ventana
* findings cr�ticos
* work orders que requieren atenci�n
* repuestos faltantes
* acciones sugeridas por IA

## 44.2 Next Port Planning Panel

Debe mostrar:

* tareas factibles
* tareas limitadas
* tareas no factibles
* tareas a preparar
* repuestos a enviar
* riesgos antes del pr�ximo puerto

## 44.3 Superintendent Review Panel

Debe mostrar:

* resumen t�cnico diario
* inconsistencias del Daily Report
* borradores de findings/WOs
* riesgos de cumplimiento
* recomendaciones clave

---

# 45. Plan de implementaci�n detallado � Copiloto IA

## Etapa 1 � Discovery de infraestructura IA existente

Objetivo:

* revisar si ya existe framework AI / prompts / tools / actions / agent services
* mapear patr�n actual
* decidir integraci�n m�nima compatible

Entregables:

* informe de arquitectura IA actual
* puntos de integraci�n
* restricciones
* dudas bloqueantes

## Etapa 2 � Core AI Copilot Layer

Objetivo:

* crear una capa desacoplada para skills IA
* definir contratos de entrada y salida
* definir confidence, trazabilidad y human confirmation

Entregables:

* servicios base
* tipos / schemas
* mecanismo de logging
* reglas de confirmaci�n humana

## Etapa 3 � Skills de extracci�n y validaci�n

Objetivo:

* implementar Daily Report Parser
* Consistency Auditor
* Task Classification
* Equipment Intake Assistant

Entregables:

* skills A/B/F/G
* tests
* UI de revisi�n

## Etapa 4 � Skills de planificaci�n y log�stica

Objetivo:

* implementar Port-Aware Maintenance Planner
* Spare Suggestion Engine
* Plan Auditor

Entregables:

* skills D/E/I
* motor de factibilidad
* integraci�n con execution windows y next port

## Etapa 5 � Skills de redacci�n y borradores

Objetivo:

* implementar Technical Closure Improver
* Superintendent Summary Generator
* Action Draft Generator

Entregables:

* skills C/H/J
* borradores estructurados
* botones de confirmaci�n

## Etapa 6 � UI integration

Objetivo:

* insertar entry points contextuales
* paneles operativos
* review workflows
* confirm/approve/edit/discard

Entregables:

* Daily Action Panel
* Next Port Planning Panel
* Superintendent Review Panel
* acciones contextuales

## Etapa 7 � Observabilidad y seguridad

Objetivo:

* asegurar trazabilidad
* logs de sugerencias IA
* control por permisos
* tenant isolation
* no exponer datos cruzados entre tenants

Entregables:

* audit trail
* permission checks
* safe fallback behavior

## Etapa 8 � Tests y documentaci�n

Tests m�nimos:

* parser IA genera salida revisable
* inconsistency auditor detecta contador decreciente
* planner clasifica factibilidad correctamente
* low confidence no autoaplica cambios cr�ticos
* finding/WO draft requiere confirmaci�n cuando corresponde
* tenant isolation en contexto IA
* summary generator no pierde datos relevantes
* spare suggestion engine propone items coherentes

Documentaci�n m�nima:

* arquitectura del copiloto
* skills implementadas
* inputs/outputs
* confidence model
* human confirmation policy
* l�mites conocidos
* pr�ximos pasos

---

# 46. Resultado esperado

Quiero que el copiloto IA:

* reduzca carga manual
* mejore calidad de datos
* simplifique decisiones
* ayude a planificar mantenimiento real
* use contexto operativo y log�stico
* proponga acciones �tiles
* mantenga trazabilidad y control humano
* sea explicable
* respete multi-tenant y arquitectura actual
* tambi�n proponga sugerencias de mejora en la gesti�n del mantenimiento, del stock de repuestos, de la eficiencia operativa y de la seguridad, siempre basadas en el an�lisis de los registros hist�ricos disponibles.

---

El sistema debe automatizar c�lculos, alertas e insights al m�ximo; y reservar para confirmaci�n humana las acciones persistentes ambiguas, cr�ticas o de alto impacto.

# 34. Pol�tica exacta de automatizaci�n: autom�tica, semiautom�tica y manual

Quiero que el PMS y el copiloto IA operen bajo una pol�tica expl�cita de automatizaci�n, para maximizar eficiencia sin perder control ni trazabilidad.

## 34.1 Principio rector

No toda acci�n debe ser manual.
No toda acci�n debe ser autom�tica.

El sistema debe decidir el nivel de automatizaci�n en funci�n de:

* criticidad
* impacto operativo
* impacto en stock
* impacto en cumplimiento
* calidad/confianza del dato
* ambig�edad
* riesgo de error

### Regla obligatoria

Toda automatizaci�n debe ser:

* explicable
* auditable
* reversible cuando corresponda
* compatible con permisos y multi-tenant
* coherente con la arquitectura actual

---

# 35. Tres niveles obligatorios de automatizaci�n

## Nivel 1 � AUTOM�TICO

La acci�n puede aplicarse sin intervenci�n humana previa, dejando trazabilidad.

## Nivel 2 � SEMIAUTOM�TICO

La IA o el sistema preparan la acci�n, pero requieren confirmaci�n humana antes de persistirla definitivamente.

## Nivel 3 � MANUAL

La IA solo informa, recomienda o prepara contexto.
La ejecuci�n y registraci�n dependen totalmente del usuario.

---

# 36. Criterios para decidir el nivel de automatizaci�n

## 36.1 Variables obligatorias a considerar

Para cada automatizaci�n, evaluar:

* criticidad del equipo
* criticidad de la tarea
* impacto en seguridad
* impacto en cumplimiento
* impacto en stock/repuestos
* impacto en historial t�cnico
* necesidad de juicio humano
* confianza del matching
* consistencia del dato fuente
* reversibilidad de la acci�n
* riesgo de propagar un error

## 36.2 Regla de decisi�n

### Tiende a AUTOM�TICO si:

* el dato es objetivo
* el match es directo
* la confianza es alta
* el impacto es bajo o controlado
* la acci�n es reversible o no destructiva

### Tiende a SEMIAUTOM�TICO si:

* el match es razonable pero no perfecto
* la acci�n tiene impacto persistente
* el sistema propone mejor que el humano, pero a�n requiere validaci�n

### Tiende a MANUAL si:

* hay ambig�edad relevante
* la acci�n cambia el estado formal de cumplimiento
* afecta seguridad, stock cr�tico o historial sensible
* requiere criterio t�cnico o operacional

---

# 37. Acciones que pueden ser AUTOM�TICAS

## 37.1 Actualizaci�n de execution window y estados derivados

Puede ser autom�tica:

* recalcular next due
* recalcular window open
* actualizar FUTURE / UPCOMING / IN_WINDOW / DUE / OVERDUE
* actualizar listas y dashboards

### Condici�n

Siempre que los contadores o fechas base ya hayan sido confirmados o sean de fuente confiable.

## 37.2 Actualizaci�n de running hours con match directo y sin inconsistencias

Puede ser autom�tica:

* si el Daily Report trae equipo identificado sin ambig�edad
* si el contador no decrece
* si no hay salto improbable
* si la pol�tica del tenant lo permite

### Debe dejar trazabilidad

* fuente
* valor anterior
* valor nuevo
* timestamp
* confidence

## 37.3 Generaci�n de alertas e insights

Puede ser autom�tica:

* alertas de item entrando en ventana
* alertas de overdue
* alertas de stock bajo m�nimo
* alertas de instrumento con calibraci�n vencida
* alertas de pr�xima escala no factible

## 37.4 Generaci�n de res�menes

Puede ser autom�tica:

* superintendent summary
* planning summary
* daily action summary
* risk highlights

## 37.5 Sugerencias no persistentes

Puede ser autom�tica:

* sugerencias de repuestos
* sugerencias de agrupaci�n
* sugerencias de factibilidad
* sugerencias de criticidad
* sugerencias de task classification

---

# 38. Acciones que deber�an ser SEMIAUTOM�TICAS

## 38.1 Cierre sugerido de due item simple

Cuando el Daily Report o una ejecuci�n simple sugiera que una tarea se complet�:

* el sistema puede preparar el cierre
* pero debe pedir confirmaci�n humana antes de marcar cumplimiento formal

## 38.2 Creaci�n de finding draft

Si la IA detecta una deficiencia a partir de:

* inspecci�n fallida
* Daily Report
* nota t�cnica

puede crear un **draft de finding**, pero no persistirlo como finding definitivo sin validaci�n, salvo configuraci�n expl�cita.

## 38.3 Creaci�n de WO draft

Si la IA detecta:

* correctivo probable
* tarea formal pr�xima
* necesidad de preparar intervenci�n

puede generar WO draft o pending approval.

## 38.4 Matching de mantenimiento realizado con plan/WO

Si el match no es perfecto pero es razonable:

* sugerir vinculaci�n
* requerir confirmaci�n

## 38.5 Consumo de repuestos sugerido

Si del Daily Report surge un uso probable de repuestos:

* preparar consumo sugerido
* pedir confirmaci�n antes de descontar stock

## 38.6 Sugerencia de env�o de repuestos al pr�ximo puerto

La IA puede generar:

* draft spare request
* draft reservation
* draft dispatch recommendation

pero no comprometer inventario/log�stica sin aprobaci�n seg�n permisos.

---

# 39. Acciones que deben ser MANUALES o con confirmaci�n estricta

## 39.1 Cierre formal de Work Orders

No cerrar autom�ticamente WOs formales salvo que exista una pol�tica muy espec�fica, controlada y justificada.

## 39.2 Marcado de cumplimiento reglamentario

No marcar autom�ticamente cumplimiento de tareas cr�ticas/reglamentarias sin validaci�n humana.

## 39.3 Descuento definitivo de stock cr�tico

No descontar autom�ticamente stock cr�tico o controlado si:

* el repuesto es de alto impacto
* el match es ambiguo
* la pol�tica del tenant exige confirmaci�n

## 39.4 Cambio de severidad en findings existentes

Debe ser manual o requerir confirmaci�n expl�cita.

## 39.5 Creaci�n de correctivos cr�ticos definitivos

WO cr�tica, finding cr�tico o escalamiento formal:

* siempre con confirmaci�n o aprobaci�n, salvo regla operativa expl�cita del tenant

## 39.6 Cambios derivados de inferencias d�biles

Toda acci�n basada en confidence LOW debe ser manual.

---

# 40. Matriz recomendada por tipo de acci�n

## 40.1 Daily Report ? horas

* match exacto + sin inconsistencias ? AUTOM�TICO configurable
* match razonable + alguna duda ? SEMIAUTOM�TICO
* match ambiguo o inconsistente ? MANUAL

## 40.2 Daily Report ? defecto detectado

* defecto claro ? CREATE_FINDING_DRAFT semiautom�tico
* defecto cr�tico claro ? draft + alerta alta
* ambig�edad fuerte ? manual review

## 40.3 Daily Report ? mantenimiento realizado

* tarea simple probable ? SEMIAUTOM�TICO
* WO formal o tarea cr�tica ? confirmaci�n estricta
* match incierto ? MANUAL

## 40.4 Daily Report ? repuestos usados

* repuesto + equipo + tarea claros ? SEMIAUTOM�TICO
* repuesto sin v�nculo claro ? MANUAL
* repuesto cr�tico o controlado ? confirmaci�n obligatoria

## 40.5 IA planner ? pr�xima escala

* factibilidad, agrupaci�n, preparaci�n, riesgos ? AUTOM�TICO como sugerencia
* generaci�n de drafts persistentes ? SEMIAUTOM�TICO
* cambios definitivos de plan ? MANUAL o approval based

## 40.6 Inspecci�n fallida

* finding draft ? SEMIAUTOM�TICO
* WO correctiva draft ? SEMIAUTOM�TICO
* finding definitivo / WO definitiva ? confirmaci�n

---

# 41. Automatizaci�n configurable por tenant

Si la arquitectura lo permite, quiero que la pol�tica de automatizaci�n pueda parametrizarse por tenant/company.

## 41.1 Configuraciones m�nimas sugeridas

* autoUpdateCountersFromDailyReport
* autoCreateFindingDrafts
* autoCreateWODrafts
* autoApplySimpleTaskClosures
* autoConsumeNonCriticalSpares
* requireApprovalForCriticalCorrectives
* requireApprovalForComplianceTasks
* allowHighConfidenceAutoMatching

## 41.2 Regla

Aunque sea configurable, la configuraci�n por defecto debe ser conservadora pero �til:

* automatizar insights y c�lculos
* semiautomatizar propuestas persistentes
* reservar para humano las acciones m�s sensibles

---

# 42. Motor de decisi�n de automatizaci�n

Quiero un motor o funci�n central equivalente a una pol�tica de automatizaci�n reusable, no reglas dispersas y contradictorias.

## 42.1 Inputs del motor

Debe considerar al menos:

* actionType
* entityType
* entityCriticality
* complianceImpact
* stockImpact
* confidence
* ambiguityLevel
* sourceReliability
* tenantPolicy
* userRole

## 42.2 Outputs del motor

Debe devolver algo equivalente a:

* automationLevel (AUTOMATIC / SEMIAUTOMATIC / MANUAL)
* allowed boolean
* requiresHumanConfirmation boolean
* requiresApproval boolean
* rationale
* auditMetadata

---

# 43. UI / UX de automatizaci�n

Quiero que la UI deje claro qu� hizo el sistema y qu� requiere al usuario.

## 43.1 Etiquetas visibles

Mostrar etiquetas como:

* Auto-applied
* Suggested
* Needs review
* Approval required
* Low confidence
* High impact

## 43.2 Panel de revisi�n

Debe existir una vista donde el usuario vea:

* propuestas IA
* nivel de confianza
* impacto
* acci�n sugerida
* motivo
* confirmar / editar / rechazar

## 43.3 Trazabilidad visible

El usuario debe poder ver:

* qu� fue autom�tico
* qu� fue confirmado manualmente
* qu� fue rechazado
* por qu�

---

# 44. Logging y auditor�a obligatorios

Toda automatizaci�n o sugerencia relevante debe registrar:

* actionType
* source
* confidence
* oldValue
* proposedValue
* appliedValue
* appliedAutomatically boolean
* confirmedBy nullable
* rejectedBy nullable
* timestamp
* rationale
* tenantId
* vesselId nullable
* subjectEntity nullable

---

# 45. Plan de implementaci�n detallado � pol�tica de automatizaci�n

## Etapa 1 � Discovery

Objetivo:

* revisar si ya existe motor de approvals, policy engine, rules engine o automation settings
* reutilizarlo si existe

Entregables:

* mapping de infraestructura reutilizable
* propuesta m�nima compatible
* dudas bloqueantes

## Etapa 2 � Automation Policy Core

Objetivo:

* crear una pol�tica central reusable
* definir inputs/outputs
* definir niveles de automatizaci�n
* integrarla con permisos y tenancy

Entregables:

* servicio/policy engine
* tipos/schemas
* reglas base
* trazabilidad

## Etapa 3 � Integraci�n con Daily Report

Objetivo:

* decidir qu� se autoaplica
* qu� queda en review
* qu� queda manual

Entregables:

* reglas por horas
* defectos
* maintenance entries
* spare usage
* panel de revisi�n

## Etapa 4 � Integraci�n con Findings / WO / Due Items

Objetivo:

* aplicar la pol�tica a findings drafts, WO drafts, due item closures y correctivos

Entregables:

* workflows semiautom�ticos
* approval paths
* anti-errores

## Etapa 5 � Configuraci�n por tenant

Objetivo:

* permitir ajustes por empresa sin romper defaults globales

Entregables:

* settings UI/API si la arquitectura lo permite
* defaults seguros
* documentaci�n

## Etapa 6 � Tests y documentaci�n

Tests m�nimos:

* HIGH confidence + low impact ? autom�tico cuando policy lo permite
* HIGH confidence + high impact ? semiautom�tico o manual seg�n policy
* LOW confidence ? nunca autoaplica cambios cr�ticos
* stock cr�tico no se consume autom�ticamente si policy no lo permite
* finding draft se crea pero no persiste definitivo sin confirmaci�n
* tenant isolation y permisos respetados
* audit trail completo

Documentaci�n m�nima:

* niveles de automatizaci�n
* reglas por tipo de acci�n
* acciones autom�ticas vs semiautom�ticas vs manuales
* configuraci�n por tenant
* limitaciones

---

# 46. Resultado esperado

Quiero una automatizaci�n que:

* simplifique de verdad
* no genere burocracia
* reduzca trabajo repetitivo
* mantenga control humano donde importa
* sea segura
* sea explicable
* sea configurable
* sea coherente con la arquitectura actual

---

Los dashboards del PMS deben ser orientados a decisi�n y riesgo, no solo a visualizaci�n. Cada KPI debe ser accionable, explicable y consistente.

# 35. KPIs exactos y dashboards obligatorios del PMS

Quiero que el PMS y el copiloto IA no solo gestionen tareas y eventos, sino que tambi�n midan desempe�o, backlog, riesgo, cumplimiento, eficiencia operativa y calidad de datos.

## 35.1 Principio rector

Los dashboards no deben ser decorativos.
Deben servir para:

* priorizar
* decidir
* detectar riesgo
* anticipar problemas
* medir cumplimiento real
* medir calidad de ejecuci�n
* medir preparaci�n log�stica
* simplificar seguimiento de la oficina t�cnica y de la tripulaci�n

### Regla obligatoria

No mostrar m�tricas vac�as o ambiguas.
Toda KPI debe:

* tener definici�n clara
* tener f�rmula clara
* indicar per�odo
* indicar alcance
* indicar fuente
* ser consistente con multi-tenant
* ser coherente con la arquitectura actual

---

# 36. Niveles de dashboard requeridos

Quiero dashboards o vistas KPI al menos en estos niveles:

## 36.1 Global / tenant

Para administraci�n t�cnica de toda la compa��a:

* cumplimiento global PM
* overdue totales
* equipos cr�ticos expuestos
* backlog correctivo
* hallazgos abiertos
* stock cr�tico bajo m�nimo
* riesgo por pr�xima escala
* calidad de datos de Daily Reports

## 36.2 Por buque

Para superintendent, captain y chief engineer:

* PM compliance del buque
* inspections compliance
* due items / overdue items
* work orders abiertas
* findings abiertos
* repuestos faltantes
* tareas factibles en pr�ximo puerto
* tareas en ventana sin oportunidad viable

## 36.3 Por equipo / sistema

Para an�lisis t�cnico puntual:

* historial de intervenciones
* overdue recurrentes
* defectos repetidos
* consumo de repuestos
* frecuencia real de fallas
* tendencia de hallazgos
* exposici�n por diferimientos

## 36.4 Por log�stica / pr�ximo puerto

Para planificaci�n:

* tareas factibles en pr�ximo puerto
* tareas limitadas
* tareas no factibles
* tareas a preparar
* repuestos a enviar
* riesgos si no se interviene en pr�xima escala

---

# 37. KPIs obligatorias del PMS

## 37.1 Cumplimiento de mantenimiento preventivo

### KPI

**PM Compliance %**

### F�rmula sugerida

`completedPreventiveTasks / plannedPreventiveTasksDueInPeriod * 100`

### Reglas

* distinguir entre tareas vencidas en el per�odo y tareas futuras
* no contar tareas fuera de ventana como incumplidas
* poder filtrar por tenant, buque, sistema, criticidad y per�odo

---

## 37.2 Cumplimiento de inspecciones

### KPI

**Inspection Compliance %**

### F�rmula sugerida

`completedInspections / inspectionsDueInPeriod * 100`

### Reglas

* distinguir inspecciones satisfactorias de insatisfactorias
* poder mostrar tambi�n porcentaje de inspecciones con observaciones y con deficiencias

---

## 37.3 Overdue items

### KPIs

* overdue maintenance items
* overdue inspections
* overdue work orders
* overdue findings follow-up

### Reglas

Segmentar por:

* criticidad
* buque
* sistema
* equipo
* aging bucket

---

## 37.4 Aging del backlog

### Buckets m�nimos

* 0�7 d�as
* 8�30 d�as
* 31�90 d�as
* 91�180 d�as
* 181�365 d�as
* > 365 d�as

### Aplicar a:

* work orders
* findings
* due items overdue
* tareas sin oportunidad operativa

---

## 37.5 Critical equipment exposure

### KPI

**Critical Equipment Without Valid Plan**
Cantidad y porcentaje de equipos cr�ticos que:

* no tienen plan activo
* tienen plan incompleto
* tienen tareas cr�ticas vencidas
* tienen hallazgos cr�ticos abiertos
* est�n en riesgo por falta de oportunidad operativa

---

## 37.6 Findings management

### KPIs

* open findings
* critical findings
* findings without follow-up
* findings linked to WO
* findings aging
* repeat findings by equipment/system

---

## 37.7 Work Order performance

### KPIs

* open WO count
* WO completed on time %
* average WO cycle time
* WO by source type (preventive / corrective / finding / manual)
* WO requiring approval
* WO awaiting parts
* WO blocked by logistics
* WO blocked by operation

---

## 37.8 Planning readiness for next port

### KPIs

* tasks feasible at next port
* tasks limited at next port
* tasks not feasible at next port
* tasks prepare-only
* critical tasks at risk before next port
* spare dispatches required before next port

---

## 37.9 Spares / inventory readiness

### KPIs

* critical spares below minimum
* stock below reorder point
* spare requests pending
* tasks blocked by missing spares
* consumption by vessel
* consumption by equipment class
* repeated spare usage suggesting chronic issue

---

## 37.10 Instruments / calibration

### KPIs

* instruments with expired calibration
* inspections blocked by missing instrument
* inspections executed with expired calibration warning
* instruments due for calibration soon

---

## 37.11 Daily Report quality

### KPIs

* reports received on time %
* reports with inconsistencies
* reports requiring human review
* reports with ambiguous equipment matching
* reports with missing critical fields
* daily reports successfully auto-processed

---

## 37.12 Data quality / trust

### KPIs

* AI suggestions confirmed %
* AI suggestions rejected %
* low confidence items pending review
* unmatched maintenance entries
* unmatched spare usages
* unmatched defects
* counter anomalies detected

---

## 37.13 Efficiency / optimization

### KPIs

* grouped tasks count
* avoided corrective WO through early intervention
* tasks executed within window vs overdue
* average days from entering window to execution
* tasks successfully executed at next port
* tasks deferred with accepted risk vs overdue with unmitigated risk

---

## 37.14 Safety and compliance risk

### KPIs

* critical overdue compliance tasks
* emergency/safety equipment with open deficiencies
* tasks blocked by permits/conditions
* unresolved critical escalation cases
* compliance tasks without evidence

---

# 38. Vistas obligatorias de dashboard

## 38.1 Executive / Company Dashboard

Debe mostrar al menos:

* PM compliance global
* inspection compliance global
* overdue critical items
* critical findings
* critical equipment exposure
* next port planning risk
* stock critical alerts
* trend mensual comparativa

## 38.2 Vessel Dashboard

Debe mostrar:

* due hoy / esta semana / este mes
* items entering window
* overdue
* next port feasible tasks
* blocked tasks
* findings abiertos
* WO abiertas
* stock y repuestos faltantes
* resumen IA del buque

## 38.3 Maintenance Planning Dashboard

Debe mostrar:

* future
* upcoming
* in window
* due
* overdue
* filtros por 7/30/90/180/365 d�as
* agrupaci�n por equipo, sistema y criticidad

## 38.4 Inspection Dashboard

Debe mostrar:

* inspecciones pr�ximas
* in window
* overdue
* satisfactorias
* con observaciones
* con deficiencias
* findings derivados

## 38.5 Next Port Dashboard

Debe mostrar:

* tareas FEASIBLE
* LIMITED
* NOT_FEASIBLE
* PREPARE_ONLY
* CRITICAL_ESCALATION
* repuestos a enviar
* tareas agrupables
* bloqueantes

## 38.6 Stock & Spares Dashboard

Debe mostrar:

* bajo m�nimo
* reorder point
* consumos recientes
* repuestos requeridos por pr�ximas tareas
* tareas bloqueadas por stock
* sugerencias IA de provisi�n

## 38.7 Superintendent Review Dashboard

Debe mostrar:

* daily summaries
* inconsistencias de reportes
* borradores de findings / WOs
* riesgos por pr�ximos puertos
* tareas cr�ticas no resueltas
* acciones recomendadas por IA

---

# 39. Tendencias y series temporales obligatorias

Quiero que al menos algunas m�tricas puedan verse en tendencia:

* PM compliance por mes
* inspection compliance por mes
* overdue trend
* findings trend
* WO cycle time trend
* stock shortage trend
* daily report inconsistency trend
* repeat failure / repeat finding trend por equipo o sistema

### Regla

No solo mostrar foto actual; tambi�n mostrar evoluci�n.

---

# 40. Filtros obligatorios

Todos los dashboards deben poder filtrar, seg�n permisos y arquitectura actual, por:

* tenant/company
* vessel
* fleet
* system / SFI
* equipment class
* equipment
* criticality
* task type
* source type
* due status
* feasibility classification
* date range
* next port
* open/closed status

---

# 41. Definiciones y diccionario KPI

Quiero un diccionario de KPIs documentado.

Cada KPI debe tener:

* nombre
* definici�n
* f�rmula
* per�odo aplicable
* alcance
* exclusiones
* fuente de datos
* interpretaci�n
* posibles limitaciones

### Regla obligatoria

Evitar m�tricas enga�osas por mezclar:

* tareas futuras con vencidas
* drafts con registros definitivos
* sugerencias IA con acciones confirmadas
* datos ambiguos con datos validados

---

# 42. Integraci�n del copiloto IA con dashboards

El copiloto debe poder:

* explicar por qu� una KPI empeor�
* se�alar principales drivers de riesgo
* resumir backlog cr�tico
* priorizar top 5 acciones recomendadas
* detectar patrones hist�ricos de fallas
* proponer mejoras de gesti�n del mantenimiento
* proponer mejoras de stock y provisi�n
* proponer mejoras de eficiencia operativa
* proponer mejoras de seguridad
* proponer focos de auditor�a t�cnica

## 42.1 Sugerencias basadas en hist�ricos

Quiero que el copiloto tambi�n proponga mejoras basadas en registros hist�ricos disponibles, por ejemplo:

* equipos con fallas repetidas
* tareas sistem�ticamente diferidas
* repuestos sistem�ticamente faltantes
* inspecciones que suelen derivar en correctivos
* tareas mal dimensionadas en duraci�n o ventana
* puertos donde recurrentemente faltan oportunidades de intervenci�n
* equipos que consumen repuestos por encima de lo normal

### Regla

Estas sugerencias deben ser explicables y basadas en evidencia hist�rica disponible.

---

# 43. Alertas inteligentes obligatorias

Quiero alertas y widgets de atenci�n temprana para:

* �tems que entran en ventana pronto
* cr�ticos que quedar�n overdue antes de pr�xima escala �til
* tareas bloqueadas por repuestos
* tasks feasible now but likely not feasible later
* repeat defects
* repeated WO on same equipment
* stock critical low with task approaching
* inspection failures increasing
* poor Daily Report data quality affecting planning

---

# 44. Plan de implementaci�n detallado � KPIs y dashboards

## Etapa 1 � Discovery y mapping

Objetivo:

* revisar dashboards y analytics ya existentes
* identificar m�tricas reutilizables
* evitar duplicaci�n de reporting
* definir fuentes y joins m�nimos

Entregables:

* mapa de m�tricas existentes
* propuesta de KPIs PMS
* riesgos
* dudas bloqueantes

## Etapa 2 � KPI definitions & data model

Objetivo:

* definir f�rmulas
* definir per�odos
* definir filtros
* definir materializaci�n o c�lculo on-demand seg�n arquitectura actual

Entregables:

* diccionario KPI
* contratos de datos
* decisiones de performance
* validaciones

## Etapa 3 � Services / queries / aggregations

Objetivo:

* implementar queries o servicios de agregaci�n eficientes
* respetar multi-tenant
* evitar c�lculos inconsistentes

Entregables:

* servicios KPI
* agregaciones
* filtros
* tests de consistencia

## Etapa 4 � Dashboards UI

Objetivo:

* integrar dashboards en la UI actual
* reutilizar componentes existentes
* priorizar claridad y acci�n

Entregables:

* Executive Dashboard
* Vessel Dashboard
* Maintenance Planning Dashboard
* Inspection Dashboard
* Next Port Dashboard
* Stock & Spares Dashboard
* Superintendent Review Dashboard

## Etapa 5 � AI insights over KPIs

Objetivo:

* permitir al copiloto interpretar m�tricas
* resumir riesgos
* proponer acciones
* detectar tendencias problem�ticas

Entregables:

* panel de insights IA
* explicaciones breves
* top recommendations
* reasoning based on historical evidence

## Etapa 6 � Tests y documentaci�n

Tests m�nimos:

* PM compliance correcto
* inspection compliance correcto
* overdue buckets correctos
* critical equipment exposure correcto
* next port feasibility counts correctos
* stock shortage KPI correcto
* tenant isolation correcto
* dashboards no mezclan drafts con registros definitivos
* filtros correctos

Documentaci�n m�nima:

* diccionario KPI
* alcance y limitaciones
* f�rmulas
* filtros
* notas de interpretaci�n

---

# 37. Aclaraci�n definitiva del modelo de roles y alcance

Quiero que el PMS implemente este modelo de roles como verdad funcional base, reutilizando los nombres reales existentes en la arquitectura actual si ya est�n definidos.

## 37.1 Roles base confirmados

### Super Admin

Gestiona todos los tenants del sistema.
Puede administrar configuraciones globales, soporte, auditor�a y supervisi�n total cross-tenant, siempre con trazabilidad expl�cita.

### Company Admin

Gestiona exclusivamente su tenant/company.
Puede administrar configuraci�n, bibliotecas, buques, equipos, planes, dashboards, pol�ticas y usuarios dentro de su tenant.

### Fleet Superintendent

Existen varios superintendentes dentro de un mismo tenant.
Cada uno gestiona �nicamente una **flota definida para �l**, es decir, un conjunto expl�cito de embarcaciones asignadas dentro de su tenant.

### Embarked Personnel

Gestiona �nicamente su embarcaci�n asignada.
No puede actuar sobre otras embarcaciones aunque pertenezcan al mismo tenant.

---

## 37.2 Regla obligatoria de alcance

El rol por s� solo no es suficiente.
Toda autorizaci�n debe validar adem�s el **scope real** del usuario.

### Scope jer�rquico obligatorio

* Super Admin ? GLOBAL
* Company Admin ? TENANT
* Fleet Superintendent ? FLEET dentro de su TENANT
* Embarked Personnel ? VESSEL dentro de su TENANT

### Regla cr�tica

Nunca deducir acceso a toda la empresa solo porque el usuario pertenece al tenant.
El acceso efectivo debe resultar de:

* tenant assignment
* fleet assignment cuando aplique
* vessel assignment cuando aplique
* permiso de acci�n espec�fico

---

## 37.3 Fleet Superintendent

El Fleet Superintendent debe poder operar solo sobre los buques expl�citamente asignados a su flota o portfolio t�cnico.

### Debe poder:

* ver equipos, planes, WO, findings, dashboards y Daily Reports de sus buques asignados
* planificar mantenimiento
* revisar y confirmar sugerencias IA
* aprobar acciones seg�n pol�tica del tenant
* preparar log�stica de repuestos para sus buques asignados

### No debe poder:

* ver o gestionar buques de otros superintendentes salvo que est�n tambi�n asignados
* actuar fuera de su tenant
* modificar configuraci�n global del sistema

## 37.4 Embarked Personnel

El personal embarcado debe quedar limitado a su buque asignado.

### Debe poder, seg�n funci�n a bordo:

* ver tareas, due items, inspecciones, WO y hallazgos de su buque
* cargar Daily Reports
* ejecutar inspecciones
* ejecutar mantenimiento simple
* informar defectos
* adjuntar evidencia
* revisar sugerencias IA de su buque si la pol�tica lo permite

### No debe poder:

* actuar sobre otros buques
* administrar bibliotecas globales del tenant
* modificar pol�ticas de automatizaci�n
* cerrar elementos cr�ticos si su funci�n o permisos no lo permiten

---

## 37.5 Subroles opcionales dentro de Embarked Personnel

Si la arquitectura actual lo soporta sin complejidad excesiva, distinguir al menos:

* Captain
* Chief Engineer
* Vessel Technical User / Crew User

### Regla

Si ya existe esta distinci�n en el sistema actual, reutilizarla.
Si no existe, no crear complejidad innecesaria sin preguntar antes.

---

## 37.6 Reglas de seguridad obligatorias

* Todas las queries deben aplicar tenant scope y luego fleet/vessel scope.
* Todos los dashboards deben respetar scope.
* Todas las sugerencias IA deben respetar scope.
* Todo acceso backend debe ser fail-closed.
* La UI no debe mostrar acciones de buques fuera de alcance.
* Los filtros de frontend nunca sustituyen controles backend.

---

## 37.7 Dudas que debes confirmar antes de implementar si la arquitectura actual no lo deja claro

Antes de programar, verifica y preg�ntame si detectas ambig�edad sobre:

* si un Fleet Superintendent puede tener m�ltiples flotas o solo una lista de buques
* si una embarcaci�n puede estar asignada a m�s de un Fleet Superintendent
* si Captain y Chief Engineer ya existen como roles separados
* si Company Admin puede aprobar cualquier acci�n sensible del tenant o si algunas quedan reservadas a ciertos perfiles t�cnicos
* si Embarked Personnel incluye usuarios read-only adem�s de usuarios operativos

---

## 37.8 Resultado esperado

Quiero que la autorizaci�n del PMS siga esta l�gica:

**Super Admin > Company Admin > Fleet Superintendent > Embarked Personnel**

pero siempre aplicada con:

* control de tenant
* control de fleet cuando aplique
* control de vessel cuando aplique
* control de acci�n
* control por estado del registro


---

# 38. Regla definitiva de asignaci�n Superintendent ? Vessel

Quiero que el PMS implemente un modelo **configurable y expl�cito** de asignaci�n entre superintendentes y embarcaciones.

## 38.1 Regla funcional definitiva

Una embarcaci�n **s� puede estar asignada a m�s de un Fleet Superintendent al mismo tiempo**.

Asimismo:

* un Fleet Superintendent puede tener asignadas m�ltiples embarcaciones
* una embarcaci�n puede tener m�ltiples Fleet Superintendents asignados
* las asignaciones deben ser expl�citas, configurables y auditables

### Ejemplo v�lido

* Superintendent A ? BuqueA, BuqueB, BuqueC
* Superintendent B ? BuqueD, BuqueE, BuqueA

Por lo tanto, el modelo correcto debe ser **many-to-many** entre:

* Fleet Superintendent
* Vessel

## 38.2 Recomendaci�n obligatoria: Primary Superintendent

Para evitar ambig�edad operativa, quiero que el sistema soporte distinguir entre:

* **PRIMARY_SUPERINTENDENT**
* **SECONDARY_SUPERINTENDENT** o equivalente

### Regla recomendada

* cada buque puede tener un **primary superintendent** opcional o requerido seg�n el dise�o actual
* puede tener adem�s uno o m�s **secondary/shared superintendents**

## 38.3 Uso funcional del primary

El primary superintendent debe ser el responsable t�cnico principal para:

* ownership t�cnico principal del buque
* prioridad de alertas
* default assignee en ciertos flujos si la pol�tica lo permite
* referencia principal en dashboards y planificaci�n

## 38.4 Uso funcional de secondary/shared

Los superintendentes secundarios deben poder:

* ver y gestionar el buque dentro de sus permisos
* colaborar en planificaci�n
* revisar hallazgos, WO, Daily Reports y repuestos
* actuar como backup o soporte t�cnico compartido

## 38.5 Restricci�n importante

No quiero que todos los superintendentes del tenant vean todos los buques por defecto.
El acceso debe seguir siendo **solo para los buques expl�citamente asignados**.

## 38.6 Gesti�n de asignaciones

Quiero que el **Company Admin** pueda:

* asignar uno o varios buques a cada superintendent
* asignar uno o varios superintendentes a un buque
* definir cu�l es el primary
* activar/desactivar asignaciones
* ver una matriz clara superintendent ? vessel
* mantener trazabilidad de cambios

## 38.7 Modelo de datos recomendado

No usar un �nico `superintendentId` fijo dentro de Vessel si eso limita el dise�o.

Implementar una relaci�n expl�cita equivalente a:

* userVesselAssignments
  o nombre equivalente compatible con la arquitectura actual

Con campos equivalentes a:

* id
* tenantId
* userId
* vesselId
* assignmentType (PRIMARY / SECONDARY)
* active
* assignedBy
* assignedAt
* removedBy nullable
* removedAt nullable

## 38.8 Reglas de autorizaci�n

El Fleet Superintendent debe poder actuar **solo sobre los buques que tenga asignados**.

### Regla obligatoria

La autorizaci�n debe validar:

* tenant
* rol
* asignaci�n expl�cita al buque

No basta con que el usuario tenga rol de superintendent dentro del tenant.

## 38.9 Queries y dashboards

Todas las queries, dashboards, KPIs, sugerencias IA y paneles operativos del superintendent deben filtrarse solo por:

* buques asignados al superintendent
* dentro de su tenant

## 38.10 Preguntas a resolver por la implementaci�n

Antes de programar, revisar y confirmar si la arquitectura actual soporta naturalmente:

* m�ltiples asignaciones activas por buque
* una sola primary assignment por buque
* m�ltiples primary assignments prohibidas por constraint
* dashboards personalizados por superintendent

## 38.11 Resultado esperado

Quiero un sistema donde:

* las asignaciones superintendent ? vessel sean flexibles
* el acceso est� estrictamente limitado a buques asignados
* pueda existir m�s de un superintendent por buque
* exista primary superintendent para evitar ambig�edad
* todo quede auditado y configurable


---
# 39. Diferimientos, backlog y control obligatorio de �tems vencidos

Quiero que el PMS implemente un control formal de diferimientos y backlog para mantenimiento e inspecciones.

## 39.1 Principio rector

Un �tem planeado que venci� y no se realiz� **no debe quedar simplemente olvidado como overdue**.

Debe existir una gesti�n expl�cita del caso.

### Regla obligatoria

**Overdue no es lo mismo que Deferred.**

Debes distinguir al menos entre:

* �tem vencido no ejecutado
* solicitud de diferimiento
* diferimiento aprobado
* �tem bloqueado
* �tem escalado
* backlog activo

---

## 39.2 Flujo obligatorio cuando un �tem vence y no se ejecuta

Cuando una tarea/inspecci�n/plan pasa a vencido y no fue ejecutado, el sistema debe requerir tratamiento expl�cito.

Las opciones deben incluir al menos:

* ejecutar ahora
* marcar como blocked / no factible
* solicitar diferimiento
* escalar
* cerrar por reemplazo/superseded/cancelaci�n justificada si la l�gica del sistema lo admite

### Regla

No permitir que �tems vencidos permanezcan largo tiempo sin explicaci�n ni tratamiento.

---

## 39.3 Estados requeridos

Adem�s del estado temporal del plan/tarea, incorporar un estado de gesti�n equivalente a:

* NORMAL
* NEEDS_REVIEW
* BLOCKED
* DEFERMENT_REQUESTED
* DEFERRED_APPROVED
* ESCALATED
* CANCELLED
* SUPERSEDED

Esto debe coexistir coherentemente con estados como:

* FUTURE
* UPCOMING
* IN_WINDOW
* DUE
* OVERDUE
* COMPLETED

---

## 39.4 Cu�ndo exigir diferimiento formal

El sistema debe requerir diferimiento formal al menos cuando el �tem vencido sea:

* cr�tico
* reglamentario / compliance
* safety related
* de equipo esencial o con impacto operacional alto
* repetidamente postergado
* ya vencido y sin oportunidad viable de ejecuci�n inmediata
* dependiente de pr�xima escala o repuestos no disponibles

Para tareas menores o de bajo impacto, la pol�tica puede permitir tratamiento m�s liviano seg�n configuraci�n del tenant.

---

## 39.5 Tipos de diferimiento

No dejar el motivo solo en texto libre.

Soportar tipos equivalentes a:

* OPERATIONAL_CONSTRAINT
* NO_PORT_OPPORTUNITY
* SPARES_MISSING
* CONTRACTOR_REQUIRED
* SAFETY_CONSTRAINT
* WEATHER_CONSTRAINT
* EQUIPMENT_CANNOT_BE_STOPPED
* PERMIT_NOT_AVAILABLE
* CREW_LIMITATION
* LOW_RISK_RESCHEDULE
* OTHER

---

## 39.6 Datos m�nimos de una solicitud de diferimiento

Toda solicitud de diferimiento debe poder incluir:

* vessel
* equipment
* sourcePlanId / dueItemId / inspectionId
* task title
* original due date / due hours
* deferment type
* short justification
* risk level suggested
* operational impact
* mitigation measures
* next feasible opportunity
* target execution date or target port
* requestedBy
* requestedAt
* approvalRequired
* linkedNextPort optional
* linkedETA optional
* missingSpares optional
* monitoringRequired boolean
* monitoringFrequency optional
* reviewDate optional

---

## 39.7 Aprobaci�n de diferimientos

No todos los diferimientos requieren el mismo nivel de aprobaci�n.

### Regla recomendada

* diferimiento menor / bajo impacto ? aprobaci�n operativa seg�n pol�tica
* diferimiento importante ? aprobaci�n de superintendent
* diferimiento cr�tico / compliance / safety ? aprobaci�n superior obligatoria seg�n pol�tica del tenant

### Regla obligatoria

Un diferimiento aprobado debe definir:

* aprobado por
* fecha de aprobaci�n
* hasta cu�ndo aplica
* pr�xima revisi�n
* mitigaciones exigidas
* condiciones de re-evaluaci�n
* si bloquea o no operaci�n normal

No permitir diferimientos aprobados �abiertos para siempre�.

---

## 39.8 Deferment entity / modelo recomendado

Implementar una entidad o equivalente compatible con la arquitectura actual para registrar diferimientos.

Campos equivalentes sugeridos:

* id
* tenantId
* vesselId
* equipmentId nullable
* sourceEntityType
* sourceEntityId
* taskTitle
* defermentType
* originalDueDate nullable
* originalDueHours nullable
* requestedExecutionDate nullable
* targetPort nullable
* justification
* riskLevel
* operationalImpact
* mitigationMeasures
* monitoringRequired
* monitoringNotes nullable
* reviewDate nullable
* approvalStatus
* requestedBy
* requestedAt
* approvedBy nullable
* approvedAt nullable
* rejectedBy nullable
* rejectedAt nullable
* validUntil nullable
* status
* aiRecommendationJson nullable
* aiConfidence nullable
* createdAt
* updatedAt

Si ya existe una entidad reusable de exception / waiver / issue / approval, int�grala si realmente encaja mejor.

---

## 39.9 Backlog obligatorio

No quiero un backlog �nico y confuso.

Quiero distinguir al menos:

* overdue backlog
* deferment backlog
* blocked backlog
* corrective backlog
* critical backlog

### Subcategor�as �tiles

* waiting spares
* waiting next port
* waiting contractor
* waiting permit
* waiting shutdown window
* awaiting approval

---

## 39.10 Control y aging del backlog

El sistema debe calcular aging para:

* overdue items
* deferment requests
* approved deferments
* blocked items
* critical backlog

Buckets m�nimos:

* 0�7 d�as
* 8�30 d�as
* 31�90 d�as
* 91�180 d�as
* 181�365 d�as
* > 365 d�as

Tambi�n debe detectar:

* repeat deferrals
* same item repeatedly overdue
* same equipment repeatedly deferred
* same reason repeated many times
* backlog growth trend

---

## 39.11 Participaci�n obligatoria del copiloto IA

El copiloto IA debe participar activamente en la gesti�n de diferimientos y backlog, pero no aprobar por s� solo.

### Debe poder:

* detectar �tems vencidos sin tratamiento
* sugerir si corresponde diferimiento formal
* sugerir tipo de diferimiento
* estimar risk level
* sugerir mitigaciones
* sugerir target port / next feasible opportunity
* sugerir si debe escalarse
* detectar abuso o repetici�n de diferimientos
* detectar backlog peligroso o cr�nico
* resumir backlog cr�tico para superintendent/company admin

### Ejemplos de sugerencias IA

* �Task is overdue and next feasible port appears to be Montevideo; recommend deferment request with temporary monitoring.�
* �This item has already been deferred twice; escalation recommended.�
* �Missing spare is the main blocker; create spare request before approving deferment.�
* �Critical task overdue without viable next port opportunity; critical escalation required.�

---

## 39.12 IA y nivel de riesgo

El copiloto debe poder sugerir un risk level equivalente a:

* LOW
* MEDIUM
* HIGH
* CRITICAL

Basado en:

* criticidad del equipo
* tipo de tarea
* overdue duration
* historial del equipo
* findings abiertos
* disponibilidad de redundancia
* pr�xima oportunidad operativa
* disponibilidad de repuestos
* cumplimiento/regulaci�n

### Regla

El riesgo sugerido por IA no reemplaza la aprobaci�n humana.

---

## 39.13 Mitigaciones temporales

Todo diferimiento relevante debe poder llevar mitigaciones compensatorias, por ejemplo:

* monitoreo adicional diario
* inspecci�n extraordinaria
* prueba funcional adicional
* limitaci�n operativa
* restricci�n de uso
* revisi�n en pr�ximo puerto
* pedido urgente de repuestos
* contractor attendance request

Estas mitigaciones deben quedar trazables.

---

## 39.14 Integraci�n con los 2 botones principales

### Bot�n 1 � Plan

Agregar dentro del m�dulo de Plan vistas/pesta�as para:

* Today / Week
* Overdue
* Backlog
* Deferments
* Blocked
* Next Port Opportunity

Desde all� debe poder:

* ejecutar tarea
* marcar blocked
* solicitar diferimiento
* escalar
* ver motivo y aging
* ver mitigaciones

### Bot�n 2 � Daily Report + Qu� se hizo

Si una tarea planificada no se ejecut�, el sistema debe permitir registrar:

* not done
* blocked
* deferment requested
* reschedule suggested
* spare missing
* not feasible in current operation

Y a partir de eso:

* crear draft de diferimiento
* actualizar backlog
* disparar sugerencias IA
* solicitar aprobaci�n cuando corresponda

---

## 39.15 Reglas de aprobaci�n y permisos

La aprobaci�n de diferimientos debe respetar permisos y criticidad.

### Debe poder configurarse por tenant:

* qui�n puede solicitar deferment
* qui�n puede aprobar deferment
* qu� tipos requieren aprobaci�n superior
* cu�ndo un deferment cr�tico debe escalarse autom�ticamente

---

## 39.16 Dashboards y KPIs de diferimientos / backlog

Agregar KPIs y paneles para:

* total overdue items
* deferment requests pending approval
* approved deferments active
* critical deferred items
* backlog by reason
* backlog by vessel
* repeated deferments
* backlog aging
* items overdue without treatment
* tasks blocked by missing spares
* tasks blocked by no port opportunity

---

## 39.17 Alertas inteligentes

Agregar alertas para:

* overdue item without treatment
* deferment request pending too long
* approved deferment approaching valid-until date
* repeated deferment on same equipment/task
* critical deferred item with no mitigation
* backlog growing above threshold
* next port missed without executing deferred task

---

## 39.18 Plan de implementaci�n adicional � Deferments & Backlog Control

### Etapa adicional � Deferments & Backlog Control

Objetivo:

* implementar gesti�n formal de diferimientos
* separar overdue de deferred
* estructurar backlog
* integrar IA para sugerencias y riesgo
* incorporar aprobaciones y aging

Entregables:

* modelo de datos de deferments o extensi�n compatible
* estados y workflows
* integraci�n con Plan y Daily Report
* paneles backlog/deferments
* reglas de aprobaci�n
* insights IA
* tests representativos

### Tests m�nimos

* item overdue sin ejecuci�n pasa a needs review
* item cr�tico vencido requiere deferment formal
* deferment request no se autoaprueba
* approved deferment exige valid-until o reviewDate
* repeated deferments disparan alerta
* backlog aging calcula correctamente
* IA sugiere deferment type y risk level
* permisos respetan qui�n solicita y qui�n aprueba

---

## 39.19 Resultado esperado

Quiero que el sistema:

* no deje vencimientos sin tratamiento
* diferencie claramente overdue de deferred
* controle backlog real
* permita aprobar diferimientos importantes
* use IA para sugerir y priorizar
* detecte abuso, repetici�n y riesgo
* mantenga trazabilidad y control operativo


---

La IA asiste, estructura y propone; la definici�n, validaci�n, aceptaci�n del riesgo y aprobaci�n final de Risk Assessment, RCA y CAPA son siempre responsabilidad humana seg�n rol y criticidad.

# 40. Gobernanza obligatoria de Risk Assessment, RCA y CAPA

Quiero que el PMS implemente una gobernanza clara para:

* Risk Assessment
* Root Cause Analysis (RCA)
* CAPA

## 40.1 Principio rector

El copiloto IA **no define ni aprueba por s� solo** el an�lisis de riesgo, la causa ra�z ni el CAPA definitivo.

### Regla obligatoria

La IA puede:

* sugerir
* estructurar
* detectar patrones
* proponer hip�tesis
* proponer mitigaciones
* proponer acciones correctivas y preventivas
* ayudar a redactar

Pero la definici�n formal, validaci�n y aprobaci�n deben quedar en manos humanas seg�n rol, criticidad y pol�tica.

---

# 41. Rol exacto del copiloto IA

## 41.1 Risk Assessment

La IA debe poder:

* sugerir cu�ndo corresponde un an�lisis de riesgo
* precompletar factores de riesgo
* proponer nivel de riesgo preliminar
* proponer mitigaciones
* advertir bloqueantes o condiciones inseguras
* se�alar informaci�n faltante

### Regla

La **aceptaci�n del riesgo** debe ser siempre humana cuando el caso sea relevante.

## 41.2 RCA

La IA debe poder:

* detectar recurrencias
* ordenar cronolog�a de eventos
* cruzar historial de fallas, hallazgos, repuestos y diferimientos
* proponer hip�tesis de causa
* sugerir posibles causas inmediatas, contribuyentes y ra�z
* advertir si la evidencia es insuficiente

### Regla

La **causa ra�z validada** no puede quedar definida solo por IA.

## 41.3 CAPA

La IA debe poder:

* proponer Corrective Actions
* proponer Preventive Actions
* sugerir responsables tentativos
* sugerir plazos
* advertir si el CAPA propuesto no cubre la causa ra�z
* detectar CAPAs repetidas o inefectivas
* proponer verificaci�n de eficacia

### Regla

El **CAPA aprobado** debe tener siempre owner/responsable humano.

---

# 42. Qui�n define cada cosa

## 42.1 Risk Assessment

### Regla funcional

El an�lisis de riesgo debe ser definido por el responsable t�cnico/operativo correspondiente.

### Esquema sugerido

* **Chief Engineer**: puede preparar o proponer an�lisis inicial a bordo
* **Fleet Superintendent**: revisa o valida cuando el caso supera operaci�n rutinaria
* **Company Admin o Technical Authority equivalente**: aprueba cuando el riesgo sea alto, cr�tico, de compliance, safety o con impacto relevante

### Regla

La IA puede preparar un draft, pero no aceptar el riesgo por s� sola.

---

## 42.2 RCA

### Regla funcional

La causa ra�z debe ser validada por el responsable t�cnico que investiga, con el nivel de revisi�n que corresponda a la gravedad.

### Esquema sugerido

* **Chief Engineer**: aporta evidencia operativa/t�cnica y hechos de campo
* **Fleet Superintendent**: lidera o valida el RCA t�cnico en casos relevantes
* **Company Admin / Technical Manager / autoridad t�cnica equivalente**: revisa o aprueba RCA en casos cr�ticos, repetitivos, de alto impacto o de compliance

### Regla

La IA puede proponer hip�tesis, no cerrar por s� sola la causa ra�z.

---

## 42.3 CAPA

### Regla funcional

El CAPA debe ser definido por quien tenga responsabilidad real sobre la correcci�n y la prevenci�n, y capacidad de asignar recursos.

### Esquema sugerido

* **Fleet Superintendent**: owner principal del CAPA t�cnico en la mayor�a de los casos relevantes
* **Chief Engineer**: ejecuta o alimenta acciones a bordo
* **Company Admin / Technical Manager / autoridad equivalente**: aprueba CAPA cuando impacta pol�ticas, presupuesto, cumplimiento, procedimientos, stock o seguridad

### Regla

La IA puede proponer el CAPA, pero no aprobarlo ni cerrarlo sola.

---

# 43. Cu�ndo aplicar revisi�n y aprobaci�n humana

## 43.1 Risk Assessment

### Requiere revisi�n y/o aprobaci�n humana cuando:

* el riesgo es MEDIUM/HIGH/CRITICAL seg�n pol�tica
* hay diferimiento importante
* hay safety/compliance implications
* hay operaci�n con deficiencia aceptada
* hay restricci�n operativa relevante
* hay tarea no rutinaria o especial

## 43.2 RCA

### Requiere validaci�n humana cuando:

* la falla es relevante
* existe repetici�n
* el equipo es cr�tico
* hay findings mayores
* hay correctivos recurrentes
* hay da�o costoso o p�rdida de redundancia
* hay implicancias regulatorias, HSE o de disponibilidad

## 43.3 CAPA

### Requiere aprobaci�n humana cuando:

* el hallazgo es importante o cr�tico
* el RCA detecta causa sist�mica
* hay impacto en compliance
* hay cambio de procedimiento o pol�tica
* hay impacto en stock/log�stica/presupuesto
* hay acciones que deben asignarse formalmente

---

# 44. Estados obligatorios para Risk, RCA y CAPA

## 44.1 Risk Assessment

Estados sugeridos:

* DRAFT_AI
* DRAFT_USER
* UNDER_REVIEW
* APPROVED
* REJECTED
* ACTIVE
* CLOSED

## 44.2 RCA

Estados sugeridos:

* DRAFT_AI
* DRAFT_USER
* UNDER_INVESTIGATION
* UNDER_REVIEW
* VALIDATED
* REJECTED
* CLOSED

## 44.3 CAPA

Estados sugeridos:

* DRAFT_AI
* DRAFT_USER
* UNDER_REVIEW
* APPROVED
* IN_PROGRESS
* EFFECTIVENESS_REVIEW
* VERIFIED_EFFECTIVE
* CLOSED
* REJECTED

### Regla

No confundir draft IA con documento validado.

---

# 45. Ownership y responsabilidad

## 45.1 Campos obligatorios sugeridos

Cada Risk Assessment, RCA y CAPA debe poder registrar:

* preparedByUserId nullable
* preparedByAI boolean
* reviewedByUserId nullable
* approvedByUserId nullable
* ownerUserId
* ownerRole
* dueDate nullable
* reviewDate nullable
* effectivenessReviewDate nullable
* status
* confidence nullable
* rationale / reasoning summary
* linkedEntityType
* linkedEntityId
* tenantId
* vesselId nullable
* equipmentId nullable

### Regla

Siempre debe quedar claro:

* qui�n lo prepar�
* qui�n lo revis�
* qui�n lo aprob�
* qui�n es el owner responsable

---

# 46. Reglas espec�ficas por tipo de caso

## 46.1 Caso menor / rutinario

* Risk Assessment: opcional o light seg�n pol�tica
* RCA: normalmente no aplica
* CAPA: normalmente no aplica

## 46.2 Caso t�cnico relevante

* Risk Assessment: Chief Engineer propone, Superintendent revisa/valida seg�n pol�tica
* RCA: Superintendent lidera o valida
* CAPA: Superintendent define, buque ejecuta

## 46.3 Caso cr�tico / safety / compliance / repetitivo

* Risk Assessment: revisi�n y aprobaci�n superior obligatoria
* RCA: validaci�n formal por autoridad t�cnica competente
* CAPA: aprobaci�n formal por nivel de management autorizado

---

# 47. Reglas del copiloto IA sobre confianza y evidencia

## 47.1 La IA debe declarar expl�citamente:

* datos confirmados del sistema
* hip�tesis
* evidencia encontrada
* lagunas de informaci�n
* confidence

## 47.2 Regla de no invenci�n

La IA no puede presentar:

* causa ra�z inferida como hecho confirmado
* riesgo aceptado como si ya estuviera aprobado
* CAPA sugerido como si fuera definitivo

---

# 48. Integraci�n con findings, deferments, WO y backlog

## 48.1 Risk Assessment puede dispararse o sugerirse desde:

* deferment request
* overdue critical item
* blocked task with operational impact
* finding importante
* work order de alto riesgo
* tarea no rutinaria

## 48.2 RCA puede dispararse o sugerirse desde:

* repeated findings
* repeated corrective WOs
* same equipment recurring failure
* chronic spare consumption
* repeated deferments
* critical breakdown

## 48.3 CAPA puede dispararse o sugerirse desde:

* validated RCA
* critical finding
* compliance deviation
* chronic backlog issue
* repeated planning/logistics failure
* systemic procedural weakness

---

# 49. UI / UX obligatoria

## 49.1 La UI debe mostrar claramente:

* Draft by AI
* Draft by User
* Under Review
* Approved
* Owner
* Approval Required
* Confidence
* Missing Evidence

## 49.2 Acciones disponibles seg�n rol y estado

La UI debe habilitar o restringir:

* prepare
* edit draft
* submit for review
* approve
* reject
* assign owner
* add evidence
* close
* reopen if policy allows

### Regla

No mostrar botones enga�osos sin permiso real.

---

# 50. Permisos y gobernanza

Aplicar permisos expl�citos para:

* create risk assessment draft
* approve risk assessment
* create RCA draft
* validate RCA
* create CAPA draft
* approve CAPA
* close CAPA
* verify effectiveness

### Regla

Ver sugerencias IA no implica poder aprobarlas.

---

# 51. Automatizaci�n permitida

## 51.1 Puede ser autom�tico

* sugerir que hace falta Risk/RCA/CAPA
* crear draft temporal no persistente
* resumir evidencia
* detectar recurrencia
* proponer cronolog�a
* proponer borradores

## 51.2 Debe ser semiautom�tico

* crear draft persistente
* vincular draft con finding/WO/deferment
* sugerir owner y due date

## 51.3 Debe ser manual o con aprobaci�n estricta

* aceptaci�n del riesgo
* validaci�n de causa ra�z
* aprobaci�n CAPA
* cierre formal de CAPA
* verificaci�n de efectividad

---

# 52. Verificaci�n de eficacia CAPA

No quiero CAPAs que se cierren solo por �acci�n completada�.

Debe existir:

* criterio de eficacia
* fecha de revisi�n
* evidencia de verificaci�n
* resultado: effective / partially effective / ineffective

### Regla

Si el CAPA fue ineffective, el sistema debe:

* reabrir o escalar
* sugerir nuevo RCA o revisi�n de causa
* alertar reincidencia

---

# 53. Participaci�n del copiloto IA en hist�ricos

Quiero que el copiloto tambi�n use hist�ricos para:

* detectar causas repetitivas
* detectar CAPAs inefectivos
* detectar diferimientos cr�nicos
* detectar riesgos aceptados demasiadas veces
* sugerir mejoras de procedimiento, stock, entrenamiento o planificaci�n

### Regla

Estas sugerencias deben ser evidenciables y explicables.

---

# 54. Plan de implementaci�n adicional � Gobernanza de Risk / RCA / CAPA

### Etapa adicional � Risk / RCA / CAPA Governance

Objetivo:

* implementar gobernanza clara de Risk Assessment, RCA y CAPA
* definir ownership humano
* integrar IA como asistente, no como aprobador
* conectar con findings, deferments, WO y backlog
* asegurar permisos, estados, trazabilidad y revisi�n de efectividad

Entregables:

* modelo de datos o extensi�n m�nima compatible
* workflows y estados
* permisos por rol
* integraci�n con copiloto IA
* UI de drafts, review, approval y effectiveness review
* tests de casos representativos

### Tests m�nimos

* IA puede crear draft de risk assessment pero no aprobarlo
* IA puede sugerir RCA pero no validarlo sola
* IA puede sugerir CAPA pero no cerrarlo sola
* Chief Engineer prepara, Superintendent revisa seg�n caso
* casos cr�ticos requieren aprobaci�n superior
* CAPA ineffective dispara revisi�n/escalamiento
* tenant isolation y permisos correctos
* trazabilidad completa de prepared/reviewed/approved/owner

---

# 55. Resultado esperado

Quiero un sistema donde:

* la IA ayude mucho
* la responsabilidad t�cnica siga siendo humana
* el riesgo no se acepte sin responsable
* la causa ra�z no se cierre sin validaci�n
* el CAPA tenga owner, plazo y verificaci�n de eficacia
* todo quede trazable, explicable y coherente con la criticidad


---

Risk Assessment, RCA y CAPA deben dispararse por reglas expl�citas de criticidad, recurrencia, cumplimiento, seguridad y debilidad sist�mica; no por intuici�n ni por uso indiscriminado.

# 41. Triggers exactos para Risk Assessment, RCA y CAPA dentro del PMS

Quiero que el PMS implemente reglas claras y expl�citas para determinar **cu�ndo corresponde**:

* Risk Assessment
* Root Cause Analysis (RCA)
* CAPA

## 41.1 Principio rector

No quiero que Risk Assessment, RCA y CAPA se disparen indiscriminadamente para cualquier tarea menor o hallazgo trivial.

### Regla obligatoria

El sistema debe diferenciar entre:

* casos donde solo corresponde registrar ejecuci�n o hallazgo
* casos donde corresponde sugerir an�lisis adicional
* casos donde el an�lisis es obligatorio
* casos donde adem�s se requiere aprobaci�n humana formal

### Niveles de activaci�n requeridos

Toda regla debe poder derivar en uno de estos niveles:

* **AUTO_SUGGEST**
* **REQUIRED**
* **APPROVAL_REQUIRED**

---

# 42. Triggers exactos para Risk Assessment

## 42.1 Cu�ndo aplicar Risk Assessment

El Risk Assessment debe aplicarse cuando exista necesidad de:

* aceptar riesgo temporal
* ejecutar una tarea no rutinaria o con condiciones especiales
* operar con una deficiencia aceptada
* diferir una tarea importante
* evaluar impacto de una restricci�n operacional
* justificar continuidad operativa bajo condici�n degradada

## 42.2 Triggers obligatorios de Risk Assessment

Disparar **AUTO_SUGGEST**, **REQUIRED** o **APPROVAL_REQUIRED** seg�n criticidad y pol�tica en los siguientes casos:

### A. Diferimientos

* deferment request de tarea importante
* deferment request de tarea cr�tica
* deferment request de tarea safety/compliance
* tarea repetidamente diferida

### B. Vencimientos cr�ticos

* critical task overdue
* compliance task overdue
* safety-related task overdue
* overdue con no port opportunity clara
* overdue sin repuesto cr�tico disponible

### C. Operaci�n con deficiencia

* equipo cr�tico con falla parcial pero a�n operando
* p�rdida de redundancia
* equipo de seguridad/emergencia con restricci�n
* limitaci�n operacional aceptada temporalmente

### D. Trabajo no rutinario o especial

* hot work
* confined space
* electrical isolation relevante
* trabajo con riesgo operacional elevado
* intervenci�n fuera del procedimiento normal
* trabajo que requiere desv�o de condiciones est�ndar

### E. Condiciones operativas especiales

* tarea que requiere parada pero el buque est� en operaci�n sensible
* ejecuci�n con clima/restricci�n adversa relevante
* pr�xima escala limitada que obliga a intervenci�n ajustada
* intervenci�n cr�tica con contractor/maker no confirmado

## 42.3 L�gica m�nima recomendada para Risk Assessment

### AUTO_SUGGEST

* task overdue importante pero no cr�tica
* deferment request menor
* tarea no rutinaria de impacto moderado
* blocked item con impacto operativo moderado

### REQUIRED

* critical task overdue
* deferment request de tarea importante
* operating with accepted technical deficiency
* safety-related work with non-routine conditions

### APPROVAL_REQUIRED

* critical deferment
* compliance deferment
* safety-critical accepted risk
* accepted operation under degraded condition in essential equipment

---

# 43. Triggers exactos para RCA

## 43.1 Cu�ndo aplicar RCA

El RCA debe aplicarse cuando el problema:

* sea relevante
* sea repetitivo
* sea costoso
* tenga impacto en seguridad, cumplimiento o disponibilidad
* revele una debilidad sist�mica
* no quede explicado por desgaste normal o causa obvia menor

## 43.2 Triggers obligatorios de RCA

Disparar **AUTO_SUGGEST**, **REQUIRED** o **APPROVAL_REQUIRED** en los siguientes casos:

### A. Fallas repetitivas

* mismo equipo con 2 o m�s fallas similares en per�odo configurable
* mismo sistema con correctivos repetidos
* mismo hallazgo repetido
* mismo repuesto consumido repetidamente por misma causa probable

### B. Correctivos recurrentes

* 2 o m�s corrective WO sobre mismo equipo o misma subfunci�n en per�odo configurable
* cierre de WO correctiva con reaparici�n temprana del problema
* same failure mode recurring after preventive maintenance

### C. Hallazgos importantes

* finding cr�tico
* finding mayor repetido
* hallazgo safety/compliance relevante
* inspecci�n fallida de equipo cr�tico con repetici�n hist�rica

### D. Breakdown / disponibilidad

* breakdown de equipo cr�tico
* p�rdida de redundancia importante
* parada no programada con impacto operacional
* falla que impide ejecutar misi�n/operaci�n normal

### E. Diferimientos cr�nicos

* mismo �tem diferido 2 o m�s veces
* mismo equipo acumulando diferimientos
* backlog cr�nico vinculado al mismo tipo de problema
* tarea vencida de forma repetitiva por misma causa sist�mica

### F. Problemas sist�micos

* falta recurrente de repuestos cr�ticos
* procedimiento deficiente reiterado
* tareas sistem�ticamente mal planificadas
* error recurrente en ejecuci�n
* CAPA previa inefectiva

## 43.3 L�gica m�nima recomendada para RCA

### AUTO_SUGGEST

* hallazgo repetido de criticidad media
* dos correctivos similares en per�odo razonable
* consumo repetitivo de repuesto que sugiere patr�n

### REQUIRED

* repeated failure on critical equipment
* same defect reoccurs after repair
* repeated deferments on same critical task
* major finding with recurrence
* unplanned breakdown of important equipment

### APPROVAL_REQUIRED

* critical breakdown with safety/compliance impact
* repeated critical failure with fleet relevance
* RCA linked to major incident or regulatory exposure
* RCA reopening due to ineffective previous CAPA in critical case

---

# 44. Triggers exactos para CAPA

## 44.1 Cu�ndo aplicar CAPA

El CAPA debe aplicarse cuando el problema requiere:

* acci�n correctiva formal
* acci�n preventiva para evitar recurrencia
* seguimiento con owner y plazo
* verificaci�n de eficacia
* control m�s all� de una simple reparaci�n puntual

## 44.2 Triggers obligatorios de CAPA

Disparar **AUTO_SUGGEST**, **REQUIRED** o **APPROVAL_REQUIRED** en los siguientes casos:

### A. RCA validado

* RCA validado con causas identificadas
* RCA que revela causa sist�mica
* RCA que revela debilidad de procedimiento, planificaci�n, entrenamiento, stock o dise�o

### B. Findings relevantes

* finding cr�tico
* finding mayor
* finding repetitivo
* finding de compliance
* finding safety relevante
* hallazgo con corrective action requerida y riesgo persistente

### C. Incumplimientos o desv�os

* tarea compliance cr�ticamente vencida
* evidencia insuficiente en tareas cr�ticas/reglamentarias
* accepted deferment with mitigation requirements
* desv�o formal de procedimiento o requisito

### D. Problemas sist�micos

* repuestos cr�ticos sistem�ticamente faltantes
* tareas recurrentemente no factibles por misma causa
* backlog cr�nico por misma debilidad
* planificaci�n deficiente repetida
* instrumentos/calibraciones generando problemas recurrentes
* errores humanos recurrentes que exigen acci�n preventiva

### E. CAPA previa inefectiva

* verification result = ineffective
* recurrence after CAPA closure
* partial effectiveness requiring extension or redesign

## 44.3 L�gica m�nima recomendada para CAPA

### AUTO_SUGGEST

* major finding with clear need for follow-up
* repeated medium-severity issue indicating systemic weakness
* RCA likely to require formal action plan

### REQUIRED

* validated RCA
* critical finding
* compliance deviation
* repeated failure with systemic cause
* deferment with mandated mitigation and review

### APPROVAL_REQUIRED

* CAPA affecting procedure/policy
* CAPA affecting critical spares strategy
* CAPA affecting compliance/safety
* CAPA requiring budget/resource commitment or cross-vessel rollout

---

# 45. Reglas de disparo combinadas

## 45.1 Secuencia t�pica recomendada

Quiero que el PMS soporte secuencias como:

### Secuencia A

Overdue critical task
? Risk Assessment REQUIRED
? if deferred, Deferment Approval REQUIRED
? if repeated, RCA AUTO_SUGGEST / REQUIRED
? if systemic cause confirmed, CAPA REQUIRED

### Secuencia B

Inspection failed on critical equipment
? Finding created
? if severe, Corrective WO draft
? if repeated failure mode, RCA REQUIRED
? if systemic weakness found, CAPA REQUIRED

### Secuencia C

Repeated spare shortage blocks same task
? backlog warning
? RCA AUTO_SUGGEST / REQUIRED
? CAPA REQUIRED for stock/logistics/process improvement

### Secuencia D

Daily Report reports repeated abnormal vibration
? finding suggestion
? repeated pattern detected
? RCA AUTO_SUGGEST
? if confirmed and high risk, CAPA REQUIRED

---

# 46. Reglas de no disparo

No quiero que el sistema dispare formalmente Risk/RCA/CAPA para casos menores sin justificaci�n.

## 46.1 No disparar autom�ticamente RCA o CAPA para:

* tarea simple aislada no ejecutada de bajo impacto
* defecto menor no repetitivo
* housekeeping t�cnico menor
* consumo normal esperado de repuesto
* correctivo menor aislado sin tendencia
* inspecci�n satisfactoria con observaci�n menor sin recurrencia

## 46.2 Risk Assessment liviano permitido

En tareas simples puede existir un safety check o checklist breve, pero eso no debe convertirse autom�ticamente en un Risk Assessment formal.

---

# 47. Motor de reglas recomendado

Quiero un motor central o policy layer reusable para evaluar disparos de Risk/RCA/CAPA, no l�gica dispersa.

## 47.1 Inputs m�nimos del motor

* entityType
* entityId
* vesselId
* equipmentId nullable
* equipmentCriticality
* taskCriticality
* complianceImpact
* safetyImpact
* overdueDuration
* defermentCount
* recurrenceCount
* backlogCategory
* spareAvailability
* operationalConstraint
* nextPortOpportunity
* historicalPatternDetected
* previousCAPAEffectiveness
* tenantPolicy

## 47.2 Outputs m�nimos

* triggerType (RISK / RCA / CAPA)
* triggerLevel (AUTO_SUGGEST / REQUIRED / APPROVAL_REQUIRED)
* rationale
* keyFactors[]
* suggestedOwnerRole
* suggestedDueDate nullable
* suggestedMitigations[]
* requiresHumanReview boolean

---

# 48. Participaci�n del copiloto IA en los disparos

## 48.1 El copiloto IA debe poder

* detectar condiciones que activan disparadores
* sugerir por qu� corresponde Risk/RCA/CAPA
* resumir factores relevantes
* proponer hip�tesis y mitigaciones
* proponer owner y due date tentativos
* advertir evidencia faltante
* detectar patrones hist�ricos y recurrencia

## 48.2 Regla obligatoria

El copiloto IA no debe disparar aprobaci�n final por s� solo.
Puede:

* sugerir
* crear draft
* elevar prioridad

No puede:

* validar RCA
* aceptar riesgo
* aprobar CAPA
  sin intervenci�n humana seg�n pol�tica.

---

# 49. UI / UX obligatoria para disparos

Cuando el sistema detecte que aplica Risk/RCA/CAPA, debe mostrarlo de forma clara.

## 49.1 Mensajes esperados

Ejemplos:

* �Risk Assessment required before approving this deferment.�
* �Repeated failure pattern detected. RCA recommended.�
* �Validated RCA indicates systemic issue. CAPA required.�
* �Critical overdue item with no viable next port opportunity. Escalation and risk review required.�

## 49.2 Acciones visibles

* Create draft
* Review required
* Approval required
* Add evidence
* Assign owner
* Escalate

---

# 50. KPIs y alertas ligadas a Risk/RCA/CAPA

Agregar m�tricas y alertas para:

* risk assessments pending review
* open RCA
* open CAPA
* overdue CAPA actions
* ineffective CAPA
* repeated deferments without RCA
* repeated failures without CAPA
* critical risks accepted and still active

---

# 51. Plan de implementaci�n adicional � Triggers de Risk / RCA / CAPA

### Etapa adicional � Risk / RCA / CAPA Trigger Engine

Objetivo:

* implementar reglas expl�citas de disparo
* distinguir auto-suggest, required y approval-required
* conectar triggers con findings, deferments, overdue items, WO, backlog y Daily Reports
* integrar copiloto IA como asistente explicable

Entregables:

* motor de reglas o policy engine compatible con la arquitectura actual
* configuraci�n m�nima por tenant si aplica
* integraci�n UI
* alertas
* tests representativos

### Tests m�nimos

* critical deferment request dispara Risk Assessment REQUIRED
* repeated failure dispara RCA REQUIRED
* validated RCA dispara CAPA REQUIRED
* task minor overdue no dispara RCA/CAPA formal
* repeated deferment on same critical task dispara RCA suggestion/escalation
* ineffective CAPA dispara revisi�n o nuevo RCA/CAPA
* IA sugiere trigger pero no autoaprueba
* permisos y tenant isolation correctos

---

# 52. Resultado esperado

Quiero que el PMS:

* dispare Risk/RCA/CAPA cuando corresponde de verdad
* no burocratice casos menores
* detecte recurrencia y debilidad sist�mica
* use IA para sugerir y explicar
* mantenga aprobaci�n humana donde importa
* conecte correctamente diferimientos, backlog, findings, WO y an�lisis formales


---

Cada entidad del PMS debe tener una responsabilidad documental y funcional clara: definir, planificar, ejecutar, reportar, detectar, analizar o corregir; nunca mezclar todo en el mismo registro.

# 42. Jerarqu�a documental y de datos obligatoria del PMS

Quiero que el sistema mantenga una separaci�n clara y estricta entre:

* definiciones maestras reutilizables
* planes aplicados a equipos concretos
* ejecuciones reales
* reportes diarios
* hallazgos
* an�lisis formales (Risk / RCA / CAPA)

## 42.1 Principio rector

No duplicar informaci�n en m�ltiples niveles.
Cada tipo de entidad debe tener una responsabilidad clara.

### Regla obligatoria

No mezclar:

* definici�n reusable
* programaci�n
* ejecuci�n
* resultado
* hallazgo
* an�lisis formal

---

# 43. Qu� debe vivir en cada entidad

## 43.1 Equipment Class

Debe vivir aqu� lo reusable por clase de equipo, por ejemplo:

* nombre de clase
* descripci�n funcional
* criticidad por defecto
* si aplica running hours
* tareas maestras sugeridas
* repuestos base sugeridos
* estrategia de mantenimiento general

### No debe vivir aqu�

* fechas de vencimiento
* resultados ejecutados
* defectos reales del equipo
* WO espec�ficas
* contadores reales del equipo

---

## 43.2 Task Master

Debe vivir aqu� la definici�n reusable de una tarea gen�rica.

### Debe incluir

* t�tulo corto
* taskType (maintenance / inspection)
* objetivo
* procedimiento resumido
* referencia a procedimiento/manual
* criterios de aceptaci�n base
* requerimientos safety base
* herramientas/instrumentos requeridos
* repuestos/consumibles sugeridos
* duraci�n estimada
* si normalmente requiere WO o puede ser ejecuci�n simple
* trigger type por defecto
* frecuencia sugerida base si aplica

### No debe vivir aqu�

* pr�ximo vencimiento de un equipo concreto
* resultado de ejecuci�n real
* defecto encontrado en una ocasi�n espec�fica
* fechas reales de cierre
* aprobaciones reales
* horas reales ejecutadas

---

## 43.3 Inspection Template

Debe vivir aqu� la definici�n reusable del checklist de inspecci�n.

### Debe incluir

* nombre de la inspecci�n
* equipo o clase aplicable
* frecuencia sugerida base
* checklist items
* tipo de respuesta por �tem
* criterios de aceptaci�n por �tem
* l�mites admisibles
* unidad
* fuente del criterio
* instrumentos requeridos
* evidencia requerida
* severity if failed
* notas safety base

### No debe vivir aqu�

* resultado de una inspecci�n real
* findings reales de una ejecuci�n espec�fica
* aprobaci�n real de una inspecci�n concreta
* defectos detectados en una fecha puntual

---

## 43.4 Maintenance Plan / Inspection Plan

Debe vivir aqu� la instancia aplicada a un equipo concreto y su programaci�n.

### Debe incluir

* vessel
* equipment
* task master o inspection template asociado
* frecuencia real aplicable
* trigger real (calendar / hours / event / condition)
* window mode
* execution window
* next due
* last done
* prioridad
* generation mode
* responsible role
* active/inactive
* si requiere aprobaci�n
* si requiere WO formal
* si permite quick execution

### No debe vivir aqu�

* narrativa completa de cada ejecuci�n pasada
* defectos espec�ficos detectados en una ejecuci�n
* an�lisis RCA/CAPA completos
* texto libre desordenado del Daily Report

---

## 43.5 Due Item

Debe vivir aqu�, si decides modelarlo expl�citamente o derivarlo, la expresi�n operativa de �esto toca ahora�.

### Debe representar

* qu� tarea o inspecci�n corresponde ejecutar
* para qu� equipo
* con qu� status temporal
* en qu� ventana est�
* si est� blocked / overdue / deferred / escalated

### No debe reemplazar

* la definici�n maestra
* la WO
* la ejecuci�n real
* el finding

---

## 43.6 Work Order

Debe vivir aqu� la intervenci�n formal a ejecutar o ejecutada.

### Debe incluir

* t�tulo
* equipo
* source type
* referencia al plan/finding si aplica
* responsible/assigned
* status
* scheduled date
* due date
* approval state
* necesidad de repuestos
* necesidad de parada
* resultado formal resumido
* referencias a evidencia y work logs

### No debe vivir aqu�

* checklist maestro reusable completo
* l�gica base general de la tarea
* toda la historia del equipo
* Daily Report completo
* RCA/CAPA completos salvo v�nculo

---

## 43.7 Execution / Work Log / Inspection Result

Debe vivir aqu� lo que realmente ocurri� en una ejecuci�n concreta.

### Debe incluir

* fecha
* ejecutado por
* resultado
* observaciones
* lecturas
* evidencias
* horas al momento de ejecuci�n
* repuestos usados confirmados
* follow-up required
* v�nculo a WO o plan o inspection execution

### No debe vivir aqu�

* la definici�n maestra de procedimiento
* la pol�tica general
* el an�lisis RCA definitivo
* el CAPA completo

---

## 43.8 Daily Report

Debe vivir aqu� el resumen operativo diario del buque, no la l�gica maestra del mantenimiento.

### Debe incluir

* contexto operativo
* horas acumuladas de equipos cr�ticos
* pr�ximo puerto / ETA
* mantenimiento realizado hoy
* defectos observados hoy
* repuestos usados hoy
* restricciones operativas
* observaciones t�cnicas del d�a

### No debe vivir aqu�

* plan maestro de mantenimiento
* definici�n completa de WO
* criterios t�cnicos base de cada tarea
* RCA/CAPA completos
* bibliotecas maestras

---

## 43.9 Finding

Debe vivir aqu� la deficiencia detectada.

### Debe incluir

* qu� se encontr�
* en qu� equipo/sistema
* origen
* severidad
* recomendaci�n
* corrective action required
* estado
* v�nculo a inspecci�n, WO, Daily Report o plan
* due/follow-up si aplica

### No debe vivir aqu�

* la ejecuci�n completa de mantenimiento
* la definici�n maestra de tareas
* toda la RCA o CAPA salvo link

---

## 43.10 Risk Assessment

Debe vivir aqu� el an�lisis formal del riesgo asociado a una condici�n, diferimiento o intervenci�n especial.

### Debe incluir

* contexto
* peligro/riesgo
* consecuencias
* nivel de riesgo
* mitigaciones
* riesgo residual
* owner
* aprobaci�n
* vigencia/revisi�n

### No debe vivir aqu�

* toda la historia de la falla
* la causa ra�z
* el CAPA completo salvo v�nculo

---

## 43.11 RCA

Debe vivir aqu� la investigaci�n causal formal.

### Debe incluir

* evento/problema analizado
* evidencia
* cronolog�a
* causa inmediata
* factores contribuyentes
* causa ra�z validada
* reviewed/validated by
* v�nculo a findings, WO, deferments, Daily Reports

### No debe vivir aqu�

* acciones CAPA completas salvo referencia
* criterios maestros de tarea
* texto operativo diario irrelevante

---

## 43.12 CAPA

Debe vivir aqu� el plan formal de correcci�n y prevenci�n.

### Debe incluir

* problema origen
* RCA vinculada si aplica
* corrective actions
* preventive actions
* responsables
* plazos
* estado
* revisi�n de eficacia
* resultado de efectividad

### No debe vivir aqu�

* toda la evidencia cruda del problema
* la ejecuci�n detallada de cada WO salvo referencia
* datos maestros de tarea/plantilla

---

# 44. Reglas de herencia y referencia

## 44.1 Heredar, no copiar innecesariamente

Quiero que el sistema use referencias entre entidades en vez de copiar texto una y otra vez.

### Ejemplo

* Task Master define procedimiento resumido y criterios base
* Plan referencia Task Master
* WO referencia Plan
* Execution referencia WO
* Finding referencia Execution o Inspection Result
* RCA referencia Finding/WO/Deferment
* CAPA referencia RCA/Finding

## 44.2 Copia controlada permitida

Se puede copiar snapshot de ciertos datos cuando sea necesario preservar contexto hist�rico, por ejemplo:

* t�tulo de tarea al momento de crear WO
* criterios usados al momento de ejecuci�n
* risk level al momento de aprobar un diferimiento

### Regla

Si se hace snapshot, debe ser deliberado y justificado, no duplicaci�n ca�tica.

---

# 45. Safety, criterios de aceptaci�n y �c�mo hacerlo�

## 45.1 Qu� vive en Task Master o Inspection Template

Aqu� deben vivir:

* c�mo hacerlo de forma resumida
* criterios de aceptaci�n base
* safety controls base
* referencias normativas o de procedimiento
* instrumentos requeridos
* repuestos sugeridos

## 45.2 Qu� vive en el Plan

Aqu� deben vivir:

* adaptaciones para ese equipo o buque si hacen falta
* frecuencia real
* ventana real
* si requiere aprobaci�n o WO
* responsables

## 45.3 Qu� vive en la ejecuci�n

Aqu� debe vivir:

* c�mo se ejecut� realmente
* qu� ocurri�
* qu� resultado dio
* si se cumplieron o no los criterios
* evidencias
* desv�os reales

---

# 46. Reglas de conexi�n entre Daily Report y PMS

El Daily Report puede:

* actualizar horas
* sugerir cierre de una tarea
* sugerir finding
* sugerir consumo de repuestos
* sugerir diferimiento
* alimentar backlog y planning

### Regla obligatoria

El Daily Report no reemplaza ni al Plan ni a la WO ni al Finding.
Solo los alimenta o actualiza cuando corresponde.

---

# 47. Reglas de conexi�n entre hallazgos y an�lisis formales

* una inspecci�n fallida puede crear Finding
* un Finding importante o repetitivo puede sugerir RCA
* un RCA validado puede disparar CAPA
* un diferimiento cr�tico puede disparar Risk Assessment
* un backlog cr�nico puede disparar RCA/CAPA

### Regla

No colapsar todos estos conceptos en una sola entidad tipo �issue�.

---

# 48. Vistas UI alineadas a esta jerarqu�a

## 48.1 Bot�n 1 � Plan

Debe mostrar:

* Planes
* Due items
* instrucciones resumidas
* criterios de aceptaci�n
* safety
* repuestos
* factibilidad

No debe mostrarlo como si fuera un Daily Report o una WO cerrada.

## 48.2 Bot�n 2 � Daily Report + Qu� se hizo

Debe mostrar:

* contexto del d�a
* horas
* lo ejecutado
* defectos
* repuestos usados
* restricciones
* acciones sugeridas

No debe convertirse en biblioteca de procedimientos.

## 48.3 Finding / RCA / CAPA views

Deben vivir en su propio flujo de problema / mejora, no escondidos dentro del Daily Report.

---

# 49. Validaciones obligatorias

Quiero validaciones que eviten mezclar capas, por ejemplo:

* no guardar next due en Task Master
* no guardar criterio maestro solo dentro de Daily Report
* no crear RCA sin entidad origen
* no cerrar CAPA sin owner y efectividad
* no meter findings como simple texto perdido en una WO si deben ser entidad formal

---

# 50. Plan de implementaci�n adicional � Document & Data Hierarchy

### Etapa adicional � PMS Data Hierarchy & Responsibility Boundaries

Objetivo:

* definir con precisi�n qu� informaci�n vive en cada entidad
* evitar duplicaci�n
* asegurar referencias correctas
* preservar snapshots hist�ricos solo donde haga falta
* alinear backend, UI, IA y reporting con esta jerarqu�a

Entregables:

* mapa de entidades y responsabilidades
* reglas de referencia/herencia
* reglas de snapshot hist�rico
* validaciones
* documentaci�n de jerarqu�a

### Tests m�nimos

* Task Master no contiene datos operativos del equipo
* Daily Report no reemplaza Plan ni WO
* Finding nace de origen v�lido
* RCA requiere entidad origen
* CAPA referencia RCA/Finding cuando corresponde
* snapshots hist�ricos preservan contexto sin duplicaci�n excesiva
* dashboards usan fuentes correctas

---

# 51. Resultado esperado

Quiero un PMS donde:

* cada entidad tenga responsabilidad clara
* no haya duplicaci�n ca�tica
* la informaci�n reusable viva en bibliotecas maestras
* la programaci�n viva en planes
* la realidad operativa viva en ejecuciones y Daily Reports
* los problemas vivan en findings
* los an�lisis formales vivan en Risk/RCA/CAPA
* todo est� conectado pero no mezclado


---

El control de instrumentos y calibraci�n debe ser integrado, basado en impacto y orientado a la ejecuci�n; nunca un sub-sistema burocr�tico separado de la l�gica real del PMS.


# 44. Decisi�n definitiva sobre el m�todo de control de instrumentos y calibraci�n, alineada con la esencia del PMS

Quiero que el control de instrumentos, calibraci�n y verificaci�n quede implementado de forma **coherente con la filosof�a general del PMS** que estamos definiendo.

## 44.1 Esencia que debe respetarse

Todo el dise�o debe seguir estos principios:

* m�nima carga manual para la tripulaci�n
* una sola captura primaria cuando sea posible
* IA y automatismos como copiloto
* control fuerte solo donde agrega valor real
* gesti�n por excepci�n, no por burocracia
* separaci�n clara entre dato maestro, planificaci�n, ejecuci�n, hallazgo y an�lisis
* reutilizaci�n de arquitectura existente
* evitar m�dulos paralelos innecesarios

### Regla obligatoria

El control de instrumentos/calibraci�n **no debe convertirse en un sub-sistema pesado y aislado** que contradiga la esencia del PMS.

---

# 45. M�todo de control aprobado

## 45.1 Enfoque general

Quiero un control **integrado, liviano, basado en impacto y orientado a la ejecuci�n**.

Esto significa:

* controlar instrumentos y verificaciones solo con el nivel de rigor que aporta valor operativo, t�cnico, reglamentario o de seguridad
* no crear burocracia para tareas menores
* permitir que el sistema alerte o bloquee seg�n criticidad/pol�tica
* permitir que el copiloto IA use esa informaci�n para planificar, alertar y sugerir acciones

---

# 46. Regla de clasificaci�n funcional

## 46.1 Instrumentos port�tiles de medici�n y prueba

Ejemplos:

* multimeter
* megger
* pressure gauge master
* infrared thermometer
* vibration meter
* tachometer
* caliper
* micrometer
* torque wrench if included in calibration control

### Regla

Estos instrumentos **no deben tratarse igual que los equipos productivos del buque**.

## 46.2 Instrumentaci�n fija o equipos que requieren verificaci�n/prueba

Ejemplos:

* pressure transmitters
* temperature sensors
* level switches
* fixed analyzers
* fixed gauges
* alarm/switch devices requiring periodic verification

### Regla

Estos s� forman parte del sistema/equipo del buque y deben quedar vinculados a su contexto t�cnico real.

---

# 47. Decisi�n de arquitectura aprobada

## 47.1 Si el sistema actual ya usa `Assets` como registro maestro universal

Entonces quiero que:

* los instrumentos vivan en `Assets`
* pero diferenciados claramente por subtipo
* y con extensi�n espec�fica de calibraci�n/verificaci�n

### Subtipos m�nimos sugeridos

* EQUIPMENT
* FIXED_INSTRUMENT
* PORTABLE_INSTRUMENT
* TOOL si la arquitectura actual ya lo soporta

### Regla

No duplicar el maestro del instrumento en otro m�dulo paralelo si `Assets` ya cumple el rol de cat�logo central.

## 47.2 Extensi�n espec�fica

Aunque el instrumento viva en `Assets`, el control metrol�gico debe tener l�gica y datos propios, por ejemplo:

* calibration required
* verification required
* frequency
* last calibration/verification
* next due
* certificate
* status
* out of tolerance
* out of service

### Regla

No tratar calibraci�n/verificaci�n como un simple adjunto PDF sin estructura.

---

# 48. Uso del SFI

## 48.1 Instrumentaci�n fija

Quiero que la instrumentaci�n fija o componentes instalados utilicen el **SFI del sistema/equipo al que realmente pertenecen**.

### Regla

Esto s� tiene l�gica t�cnica y debe integrarse al �rbol funcional del buque.

## 48.2 Instrumentos port�tiles

Quiero que los instrumentos port�tiles **no usen el SFI como clasificaci�n principal**, salvo que la arquitectura actual lo exija por uniformidad administrativa.

### Regla

Para port�tiles, la clasificaci�n principal debe basarse en:

* instrumentType
* measurementCategory
* vessel/location assignment
* metrology/calibration status

Si el sistema exige SFI para todo asset, se puede usar una categor�a gen�rica de soporte/herramientas, pero **sin convertir el SFI en el eje del control metrol�gico**.

---

# 49. L�gica operativa alineada con la esencia del PMS

## 49.1 El usuario no debe gestionar manualmente la metrolog�a en cada paso

Quiero que las inspecciones y tareas simplemente:

* indiquen si requieren instrumento
* sugieran instrumento apropiado
* validen vigencia/estado
* alerten o bloqueen seg�n criticidad y pol�tica

### Regla

La tripulaci�n no debe tener que navegar un m�dulo complejo de calibraci�n para completar cada tarea.

## 49.2 Gesti�n por excepci�n

Quiero que el sistema:

* advierta si un instrumento est� vencido
* bloquee solo si la tarea es cr�tica/reglamentaria o la pol�tica lo exige
* permita warning en casos menores
* sugiera calibraci�n/verificaci�n previa cuando haga falta

### Regla

No bloquear indiscriminadamente tareas menores por cualquier vencimiento metrol�gico.

---

# 50. Integraci�n con inspecciones y mantenimiento

## 50.1 Inspecciones

Cada checklist item debe poder:

* requerir instrumento
* especificar tipo de instrumento
* registrar lectura
* validar lectura contra l�mites
* mostrar estado de vigencia del instrumento seleccionado

## 50.2 Mantenimiento

Las tareas de mantenimiento deben poder:

* requerir instrumento para medici�n o aceptaci�n
* validar si el instrumento est� vigente
* asociar la medici�n al resultado real de ejecuci�n

## 50.3 Regla

La l�gica metrol�gica debe **ayudar a ejecutar y validar**, no convertirse en una barrera artificial.

---

# 51. Rol del copiloto IA en metrolog�a y calibraci�n

Quiero que el copiloto IA pueda:

* advertir que una tarea pr�xima requiere instrumento vigente
* detectar instrumentos pr�ximos a vencer
* advertir que una inspecci�n importante no es factible por problema metrol�gico
* sugerir calibraci�n/verificaci�n previa
* detectar carencias repetitivas de instrumentos
* detectar uso reiterado de instrumentos vencidos
* sugerir mejoras de gesti�n metrol�gica basadas en hist�ricos

### Regla

La IA no �calibra� ni valida certificados por s� sola; asiste y prioriza.

---

# 52. Regla de control por impacto

Quiero que la severidad del control dependa del impacto real.

## 52.1 Control fuerte

Aplicar control fuerte cuando:

* la medici�n define aceptaci�n cr�tica
* la tarea es cr�tica o reglamentaria
* la inspecci�n requiere evidencia t�cnica confiable
* el instrumento est� vencido y el riesgo de error es relevante

## 52.2 Control moderado

Aplicar warning o revisi�n cuando:

* la tarea es menor
* la medici�n es de apoyo
* el instrumento vencido no compromete una decisi�n cr�tica
* la pol�tica del tenant as� lo permita

### Regla

El m�todo debe ser **basado en impacto**, no uniforme para todo.

---

# 53. Reglas de coherencia con la esencia del sistema

Antes de implementar, verificar que el m�todo elegido cumpla todo esto:

* no exige carga extra diaria innecesaria a la tripulaci�n
* permite a la IA usar la informaci�n de instrumentos/calibraci�n para planificar y alertar
* reutiliza una sola fuente maestra si `Assets` ya existe como cat�logo central
* no obliga SFI artificial a instrumentos port�tiles
* no crea un mini-software paralelo de metrolog�a aislado del PMS
* no burocratiza tareas menores
* s� protege tareas cr�ticas y criterios de aceptaci�n relevantes

### Regla obligatoria

Si una decisi�n de implementaci�n contradice estos principios, debe detenerse y proponerse una alternativa m�s alineada.

---

# 54. Implementaci�n requerida

## 54.1 Modelo aprobado

Implementar una soluci�n equivalente a:

* `Assets` como maestro �nico si ya existe as� en la arquitectura
* subtipos claros para distinguir instrumentos
* extensi�n metrol�gica/calibraci�n/verificaci�n especializada
* integraci�n con inspection templates, task masters, executions, alerts y IA

## 54.2 Lo que no quiero

* duplicaci�n de instrumentos en m�ltiples maestros
* m�dulo de calibraci�n separado sin v�nculo real con las tareas
* calibraci�n tratada solo como PDF adjunto
* SFI forzado artificialmente a port�tiles
* bloqueos excesivos en tareas menores
* burocracia metrol�gica desalineada con el PMS

---

# 55. Plan de implementaci�n adicional � M�todo de control metrol�gico alineado

### Etapa adicional � Metrology Control Aligned with PMS Philosophy

Objetivo:

* implementar control de instrumentos/calibraci�n/verificaci�n alineado con la esencia del PMS
* reutilizar `Assets` si ya es el maestro universal
* distinguir port�tiles de instrumentaci�n fija
* aplicar SFI solo donde tenga sentido t�cnico real
* integrar metrolog�a con tareas, inspecciones, IA y dashboards sin crear carga innecesaria

Entregables:

* decisi�n arquitect�nica final documentada
* reglas de clasificaci�n (portable vs fixed)
* modelo de datos alineado
* uso de subtipos en `Assets` si corresponde
* extensi�n metrol�gica estructurada
* reglas de impacto/warning/block
* integraci�n con copiloto IA
* validaciones y tests

### Tests m�nimos

* instrumento port�til vive en `Assets` con subtipo correcto si la arquitectura actual as� lo define
* instrumentaci�n fija usa SFI del sistema correspondiente
* instrumento port�til no depende de SFI como eje principal
* tarea cr�tica con instrumento vencido dispara control seg�n pol�tica
* tarea menor con instrumento vencido no bloquea indiscriminadamente
* IA detecta riesgo metrol�gico para tarea pr�xima
* no existe duplicaci�n ca�tica de maestros



El PMS debe dise�arse para operaci�n mar�tima real: implementaci�n por fases, importaci�n y poblado asistido, trazabilidad fuerte, preparaci�n futura para offline, y evoluci�n sin deuda t�cnica innecesaria.

# 45. Bloque final de implementaci�n, evoluci�n y operaci�n real del PMS

Quiero que cierres el dise�o e implementaci�n del PMS con una capa final de reglas para asegurar que el sistema sea:

* implementable en secuencia correcta
* usable en operaci�n real
* poblable con datos reales
* escalable a futuro
* trazable
* mantenible

---

# 46. Orden maestro de implementaci�n obligatorio

No quiero que implementes todo al mismo tiempo ni de forma desordenada.
Quiero una secuencia de construcci�n clara, con dependencias correctas y entregables verificables.

## 46.1 Regla obligatoria

Debes implementar en el orden correcto, evitando mezclar:

* modelo de datos
* reglas de negocio
* UI
* IA
* dashboards
* importaci�n
* automatizaci�n

## 46.2 Fases maestras obligatorias

### Fase 1 � Discovery & Architecture Alignment

* inspecci�n completa del repositorio
* an�lisis de arquitectura actual
* mapping de entidades existentes
* mapping de permisos
* mapping de m�dulos reutilizables
* detecci�n de contradicciones
* preguntas bloqueantes

### Fase 2 � Core Domain Model

* entidades maestras
* planes
* due items
* WO
* findings
* deferments
* backlog
* risk / RCA / CAPA
* instrumentos / calibraci�n
* daily reports
* relaciones e �ndices
* migraciones seguras

### Fase 3 � Security / Scope / Permissions

* roles
* scopes
* fail-closed checks
* filtros backend
* permisos por acci�n y estado

### Fase 4 � Core PMS Logic

* triggers
* execution windows
* due item generation
* backlog
* deferments
* feasibility by next port
* planning services
* stock linkage

### Fase 5 � Daily Report Integration

* formulario
* captura
* parser
* normalizaci�n
* integraci�n autom�tica con PMS

### Fase 6 � UI Operativa Principal

* bot�n 1: Plan de Hoy / Semana
* bot�n 2: Daily Report + Qu� se hizo
* pantallas de support: findings, WO, backlog, deferments, spares, instruments

### Fase 7 � AI Copilot Layer

* skills
* drafts
* review workflows
* human-in-the-loop
* reasoning explicable

### Fase 8 � Dashboards / KPIs / Alerts

* KPIs
* dashboards
* notificaciones
* escalamiento
* insights IA

### Fase 9 � Importaci�n y Poblado Inicial

* carga de cat�logos
* carga de equipos
* carga de planes
* carga de bibliotecas
* validaci�n de consistencia
* asistente IA de poblado

### Fase 10 � Hardening Final

* tests
* documentaci�n
* auditor�a
* performance checks
* preparaci�n para evoluci�n futura

## 46.3 Regla de salida por fase

Cada fase debe cerrar con:

* resumen de cambios
* riesgos
* pendientes
* decisiones tomadas
* impacto en arquitectura
* pruebas realizadas

---

# 47. Preparaci�n para operaci�n offline futura

## 47.1 Decisi�n actual

Por ahora el sistema ser� **online only**.

### Regla obligatoria

No implementar ahora sincronizaci�n offline completa ni l�gica compleja de conflicto si no es estrictamente necesario para esta versi�n.

## 47.2 Pero debe quedar preparado

Quiero que el dise�o quede preparado para un futuro modo offline.

### Preparaciones m�nimas requeridas

* separar claramente lectura/escritura y servicios transaccionales
* usar identificadores robustos y trazables
* evitar depender de estado UI ef�mero para persistencia
* dejar eventos / timestamps / audit trails claros
* dise�ar formularios y entidades con posibilidad futura de draft local / sync
* evitar decisiones que imposibiliten sincronizaci�n posterior

## 47.3 Lo que no quiero ahora

* sync engine completo
* cola offline completa
* resoluci�n completa de conflictos
* UX offline final

## 47.4 Lo que s� quiero ahora

* documentaci�n de preparaci�n offline
* identificaci�n de entidades conflict-prone
* recomendaci�n de futuros puntos de sync

---

# 48. Versionado obligatorio de templates, criterios y procedimientos

Quiero versionado expl�cito para evitar p�rdida de trazabilidad cuando cambien definiciones maestras.

## 48.1 Deben versionarse o dejarse preparados para versionado

* Task Masters
* Inspection Templates
* acceptance criteria
* safety controls
* linked procedures / summarized instructions
* possibly equipment class base mappings if the architecture requires it

## 48.2 Regla obligatoria

Cuando cambie una definici�n maestra, debe quedar claro:

* desde cu�ndo aplica la nueva versi�n
* qu� planes existentes heredan cambios y cu�les no
* qu� versi�n se utiliz� en una ejecuci�n hist�rica
* qu� snapshot se guard� en WO / inspection result / execution

## 48.3 Regla de snapshot hist�rico

Cuando una tarea o inspecci�n se ejecuta, el sistema debe poder preservar el contexto hist�rico relevante, por ejemplo:

* t�tulo usado
* criterios usados
* safety notes usadas
* procedure reference usada

No quiero que el pasado cambie silenciosamente por editar un template hoy.

---

# 49. Migraci�n, importaci�n y poblado inicial del sistema

No quiero un sistema perfecto pero vac�o o imposible de poblar.

## 49.1 Objetivo

Quiero que Claude Code tambi�n me ayude a **poblar el sistema** con datos reales o semiestructurados.

## 49.2 Fuentes t�picas a contemplar

* Excel
* planillas estructuradas
* cat�logos de equipos
* listados SFI
* listados de repuestos
* planes de mantenimiento existentes
* bibliotecas de tareas
* checklists de inspecci�n
* daily reports previos si los hubiera
* instrumentos / calibraciones
* hist�ricos parciales

## 49.3 Requisitos de importaci�n

Debe soportarse o prepararse:

* importaci�n estructurada
* validaci�n de columnas/campos
* normalizaci�n
* deduplicaci�n
* mapping de equipos
* detecci�n de errores
* reportes de importaci�n
* modo dry-run / preview si la arquitectura lo permite

## 49.4 Asistente IA de poblado

Quiero que Claude Code implemente o deje preparado un flujo donde el copiloto IA pueda ayudar a:

* clasificar equipos
* sugerir SFI
* sugerir equipment class
* sugerir task masters asociados
* detectar duplicados
* sugerir repuestos
* estructurar tareas importadas
* clasificar maintenance vs inspection
* detectar inconsistencias en cat�logos
* proponer correcciones antes de persistir

## 49.5 Regla obligatoria

La IA puede ayudar a poblar, clasificar y limpiar, pero no debe introducir datos ambiguos como definitivos sin revisi�n cuando la confianza sea insuficiente.

## 49.6 Poblado incremental

Quiero que el sistema permita poblar por etapas, por ejemplo:

* primero vessels
* luego systems / SFI
* luego equipment classes
* luego assets/equipment
* luego task library
* luego plans
* luego spares
* luego instruments
* luego historical enrichments

---

# 50. Notificaciones y escalamiento obligatorios

El sistema no debe solo detectar; tambi�n debe empujar acci�n.

## 50.1 Debe existir una pol�tica de notificaciones y escalamiento para al menos:

* due critical item
* overdue critical item
* deferment request pending too long
* approved deferment approaching valid-until
* critical finding open
* WO blocked by spares
* next port task at risk
* CAPA overdue
* calibration critical overdue
* Daily Report inconsistency affecting planning

## 50.2 Definir para cada caso

* qui�n recibe la notificaci�n
* nivel de prioridad
* si se reitera
* cu�ndo escala
* si requiere acknowledgment
* si dispara panel UI, badge, email u otro canal ya existente

## 50.3 Regla

Si ya existe infraestructura de notificaciones, reutilizarla.
No crear una paralela sin necesidad.

---

# 51. Ownership y accountability obligatorios

Quiero que toda entidad importante tenga owner claro.

## 51.1 Debe existir owner o responsable al menos para:

* vessel technical ownership if applicable
* maintenance plans when relevant
* work orders
* findings
* deferments
* RCA
* CAPA
* spare requests
* calibration/verifications when applicable
* review queues / AI drafts when relevant

## 51.2 Regla

Visible para varios no significa responsabilidad difusa.
El sistema debe mostrar claramente:

* owner
* reviewer
* approver
* assignee
  cuando corresponda.

---

# 52. Correcciones, reaperturas y rectificaciones

Quiero manejo expl�cito de errores reales de operaci�n.

## 52.1 Debe poder controlarse

* correcci�n de Daily Report ya enviado/verificado
* correcci�n de horas mal cargadas
* reapertura de WO cerrada
* reapertura de finding
* rectificaci�n de consumo de repuestos
* correcci�n de severidad
* correcci�n de deferment request
* rectificaci�n de cierre err�neo de tarea

## 52.2 Regla obligatoria

Toda rectificaci�n importante debe:

* dejar audit trail
* indicar previous value y new value
* indicar motivo
* respetar permisos
* no borrar historia silenciosamente

---

# 53. B�squeda, filtros persistentes y acciones masivas

Para que el PMS sea usable de verdad, quiero soporte para productividad operativa.

## 53.1 B�squeda global o contextual �til

Buscar por:

* vessel
* equipment
* asset code
* SFI
* WO
* finding
* task
* spare
* daily report
* deferment
* RCA / CAPA if applicable

## 53.2 Filtros persistentes

Permitir:

* guardar filtros frecuentes
* recuperar vistas �tiles por rol
* mantener contexto entre pantallas si la arquitectura actual lo soporta

## 53.3 Acciones masivas

Soportar cuando sea �til y seguro:

* bulk assign
* bulk approve drafts where allowed
* bulk export
* bulk categorize
* bulk schedule/prepare for next port
* bulk review of AI suggestions with safeguards

## 53.4 Regla

No implementar acciones masivas peligrosas sin permisos, confirmaci�n ni trazabilidad.

---

# 54. Gesti�n documental y evidencias

Quiero definir bien el rol de archivos y evidencias.

## 54.1 Reglas obligatorias

Los adjuntos:

* complementan
* evidencian
* respaldan

pero **no reemplazan** al dato estructurado cuando ese dato es relevante para planificaci�n, m�tricas o decisiones.

## 54.2 Tipos de evidencia a soportar

* fotos
* PDF
* certificados
* procedimientos adjuntos
* reportes externos
* evidencias de calibraci�n
* evidencias de ejecuci�n
* evidencias de cierre CAPA
* evidencias de inspections/results

## 54.3 Debe quedar claro

* qui�n subi� el archivo
* a qu� entidad est� vinculado
* qu� tipo de evidencia es
* si reemplaza o no una versi�n anterior
* permisos de visibilidad

---

# 55. KPIs de adopci�n y calidad del sistema

Adem�s de KPIs t�cnicos del PMS, quiero m�tricas de calidad de uso del propio sistema.

## 55.1 KPIs m�nimos sugeridos

* % de Daily Reports procesados sin correcci�n
* % de sugerencias IA aceptadas
* % de sugerencias IA rechazadas
* % de tareas cerradas con evidencia completa
* % de WO cerradas con documentaci�n suficiente
* backlog sin owner
* drafts IA pendientes demasiado tiempo
* tiempo medio de revisi�n de sugerencias IA
* import records with unresolved ambiguity
* repeated data-quality issues by vessel

## 55.2 Objetivo

Poder medir no solo mantenimiento, sino tambi�n:

* adopci�n
* calidad de dato
* efectividad de IA
* disciplina operativa
* madurez del uso del PMS

---

# 56. Plan de implementaci�n adicional � Evolution, Import, Notifications & Hardening

### Etapa adicional � Real-World Operation Hardening

Objetivo:

* cerrar el dise�o para operaci�n real
* definir orden maestro de implementaci�n
* dejar preparado el sistema para offline futuro
* versionar templates y criterios
* soportar importaci�n/poblado inicial
* definir notificaciones/escalamiento
* asegurar ownership, rectificaciones, b�squeda y evidencias
* medir calidad de uso

Entregables:

* master implementation order documentado
* offline-readiness notes
* versioning strategy
* import/population strategy
* notification/escalation matrix
* ownership model
* correction/reopen rules
* evidence/document rules
* adoption/data-quality KPIs
* tests y documentaci�n

### Tests m�nimos

* templates versioned preserve historical context
* imports detect ambiguity and invalid rows
* AI-assisted population does not auto-persist low-confidence mappings
* overdue escalation notifications respect permissions and scope
* corrections preserve audit trail
* owner fields behave consistently
* dashboards include adoption/data-quality KPIs correctly
* architecture remains ready for future offline evolution without current offline complexity

---

# 57. Resultado esperado

Quiero un PMS que no solo est� bien dise�ado en abstracto, sino que tambi�n:

* pueda implementarse en orden correcto
* pueda poblarse con datos reales
* pueda crecer sin romperse
* pueda preparar futuro offline sin implementarlo ahora
* pueda notificar y escalar
* tenga ownership claro
* permita corregir errores sin perder trazabilidad
* sea operativo y mantenible en el mundo real

