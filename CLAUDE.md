# CLAUDE.md — CMS3.0 (PMS marítimo multiempresa)

Sistema de mantenimiento planificado para flotas. Multitenant: varias empresas navieras
en la misma base, cada una con sus buques, su tripulación, su idioma y sus permisos.
Las reglas de negocio son críticas (auditorías TMSA, clase, bandera): la trazabilidad y
la consistencia de los datos valen más que la conveniencia técnica.

---

## 1. Mapa del repo

Monorepo pnpm. Dos aplicaciones y un schema de base compartido.

| Dónde | Qué es |
|---|---|
| `apps/api/` | Backend. TypeScript sobre `node:http` **puro** (no Express, no Nest). Entrada: `src/server.ts` |
| `apps/api/src/tenant/<modulo>/` | Un directorio por módulo de negocio (work-orders, spares, defects, inspections…). ~50 módulos |
| `apps/api/src/tenant/tenant-router.ts` | Ruteo de todos los endpoints de tenant. `pms/pms-router.ts` para el PMS |
| `apps/api/src/platform/` | Consola SUPERADMIN: tenants, usuarios, auditoría, prompts, uso |
| `apps/api/src/common/`, `src/http/` | Cross-cutting: logger, rate limit, bearer token, respuestas JSON. Sin lógica de negocio |
| `apps/web-modern/` | Frontend. React 19 + Vite + Tailwind 4 + react-router 7 |
| `apps/web-modern/src/pages/` | Una página por módulo (`WorkOrders.tsx`, `Spares.tsx`…) |
| `apps/web-modern/src/components/` | Componentes compartidos (ver §5) |
| `apps/web-modern/src/lib/` | `api.ts` (fetch), `auth.tsx`, `i18n.tsx`, `vessel-context.tsx`, `copilot-context.tsx` |
| `apps/web-modern/src/mobile/` | Vistas móviles para tripulación |
| `prisma/schema.prisma` | ~94 modelos, un solo archivo. Postgres + Prisma 7 con `@prisma/adapter-pg` |
| `packages/` | `shared-types`, `config`, `i18n` compartidos entre api y web |
| `scripts/` | Scripts `tsx` de carga/migración de datos reales (cargas históricas, clonado de planes) |
| `.claude/skills/` | Skills del proyecto: `scaffold-module`, `add-i18n`, `prisma-sync`, `pms-*` |

## 2. Comandos

```bash
pnpm dev:api                       # API en watch (puerto del .env)
pnpm dev:web-modern                # Frontend en http://localhost:5174
pnpm --filter @cms3/api typecheck  # Typecheck backend
pnpm --filter web-modern typecheck # Typecheck frontend
pnpm db:push                       # Aplicar schema a la base (dev)
pnpm prisma:generate               # Regenerar el cliente Prisma
pnpm db:seed
```

Puertos locales: **web 5174 → api 3106**. El `PORT` sale del `.env`; el default del código
es 3105 y el proxy de Vite apunta a 3106. Si cambiás uno, cambiá el otro
(`apps/web-modern/vite.config.ts`). Un endpoint nuevo bajo `/platform/*` necesita además
su entrada en ese proxy, si no Vite devuelve el `index.html` y la pantalla queda vacía.

`AI_PROVIDER` en el `.env` conmuta Claude ⇄ Gemini para todos los servicios de IA.
Cambiarlo exige reiniciar la API.

## 3. Reglas de negocio innegociables

Toda consulta, mutación y listado debe respetar, sin excepción:

- **Aislamiento por tenant.** Nunca una query sin filtro de tenant. Si la escribís y no
  filtra, es un bug de seguridad, no un detalle.
- **Alcance por vessel/unit** cuando corresponda (`tenant/auth/vessel-scope.ts`).
- **RBAC existente.** Roles reales en `prisma/schema.prisma`: `TENANT_ADMIN`,
  `FLEET_SUPERINTENDENT`, `MAINTENANCE_MANAGER`, `TECHNICIAN_OPERATOR`,
  `INSPECTOR_COMPLIANCE`, `PROCUREMENT_STORE`, `AUDITOR_READONLY`; plataforma:
  `SUPERADMIN`, `SUPPORT`. No inventar roles ni asumir permisos: verificar el código.
- Para cada cambio, contestar explícitamente: quién ve, quién crea, quién edita, quién aprueba.
- **Idioma según el tenant.** Nada de texto en español hardcodeado en el JSX.
- Consistencia entre SFI, maintenance plans, work orders, service requests, daily reports,
  defects, backlog, inspections, RCA y spares. Los módulos se cruzan: un cambio en OT
  toca planes, repuestos y reportes.

## 4. Backend — cómo se agrega algo

Patrón real, respetarlo:

1. La lógica va en `tenant/<modulo>/<modulo>-service.ts`. El service valida permisos y scope.
2. El endpoint se cablea a mano en `tenant-router.ts` (o `pms-router.ts`): importar la
   función del service y agregar el `if` de método + path.
3. Errores con `RouteError`; respuestas con `sendJson`.
4. No agregar frameworks HTTP, ORMs ni capas nuevas. Si hace falta una capa, justificarla antes.
5. Para un módulo entero nuevo, usar la skill `scaffold-module` en vez de escribirlo a mano.

## 5. Frontend — patrones obligatorios

Reusar antes de crear. Componentes que ya existen y hay que usar:

- **`<ModalCloseButton>`** — la X de cierre de **todos** los modales. No dibujar una X propia.
- **`<AlertDialog>`** — validaciones y errores de formulario van en ventanita con botón OK,
  **no** en un recuadro rojo al pie del form.
- `<FormModal>`, `<DataTable>`, `<PageHeader>`, `<ExportExcelButton>`, `<RichTextArea>`.
- `MaintenancePlansGrid.tsx` es la referencia de "Vista Planilla": grilla compacta, edición
  inline para admin, orden por columna, columnas ajustables. Si se pide vista planilla en
  otra pantalla, replicar ese pack completo.

**i18n:** todo texto visible pasa por `useT()` con clave en el dict de
`apps/web-modern/src/lib/i18n.tsx` (es / en / pt, ~2200 líneas). Convención de claves:
`modulo.concepto` (`nav.workOrders`, `wo.status.open`). Usar la skill `add-i18n` para
internacionalizar una pantalla y `audit-i18n` para detectar faltantes.

**UX:** priorizar legibilidad operativa y menos fricción de carga para tripulación,
superintendencia y admin. Estados importantes visibles. No recargar la interfaz. No mover
áreas principales sin necesidad. Si el usuario pidió una ubicación específica para un
elemento, respetarla.

## 6. Base de datos

Antes de tocar `schema.prisma`:

- Revisar entidades y relaciones reales; el schema tiene 94 modelos y mucho ya existe.
- No agregar campos redundantes si el dato puede derivarse.
- No borrar campos ni cambiar semántica sin revisar impacto en backend, frontend y datos cargados.
- Preservar compatibilidad con los datos productivos ya existentes (hay cargas históricas reales).

Si el cambio es necesario: justificarlo, explicar impacto, mantener naming consistente,
y después correr `pnpm db:push` + `pnpm prisma:generate` (skill `prisma-sync`).

## 7. Copiloto IA

- Vive en el **panel lateral derecho**, contextual a la pantalla y al formulario abierto.
- Observa el contexto visible y sugiere; **no decide** criticidad, causalidad ni cumplimiento.
- Guía con preguntas mínimas y precisas. Asistente experto, no reemplazo del usuario.
- Antes de tocarlo: revisar `CopilotoPanel.tsx`, `lib/copilot-context.tsx` y
  `tenant/copiloto/`. No crear un chat aislado si lo que se pide es asistencia embebida.

## 8. Trampas conocidas (ya nos costaron una vez)

- **Typecheck del frontend:** `npx tsc --noEmit` en la raíz **no chequea nada**. Usar
  `pnpm --filter web-modern typecheck` (`tsconfig.app.json`).
- **Nombres, no códigos:** en PDFs, UI e IA mostrar el nombre del buque
  ("DON CHICUETO"), nunca el código ("DCH").
- **PDFs:** seguir la skill `pms-pdf-generation`. Bug recurrente: el texto se sale del badge
  gris al pasar de página.
- **OT y SS son entidades separadas** desde el split: `WorkOrder` y `ServiceRequest`
  (la SS cuelga de una OT autorizada). No tratarlas como el mismo registro.
- **Módulos dormantes:** Modos de Falla (RCM) y CAPA están construidos pero **ocultos a
  propósito** (rutas comentadas en `App.tsx`, ítems fuera del Sidebar). No reactivarlos,
  no borrarlos, no fusionarlos sin pedido explícito.
- Un endpoint `/platform/*` nuevo necesita su línea en el proxy de Vite (§2).

## 9. Cómo trabajar

**Primero revisar, después pensar, después planificar, recién ahí implementar.** Nunca
desde supuestos.

Usar **modo plan** cuando la tarea tenga 3+ pasos, toque base de datos, permisos,
navegación, copiloto, multitenancy o reglas de negocio, o impacte más de un módulo.
El plan: objetivo real, restricciones detectadas en el código, pasos concretos y verificables.

**Simplicidad:** el cambio más simple que cumpla bien el objetivo, mínima superficie de
impacto, reutilización sobre reinvención, coherencia con el naming y los patrones que ya
están. Nada de sobreingeniería, abstracciones prematuras ni lógica duplicada. Refactor
incremental antes que reescritura.

**Bugs:** reproducir, encontrar la causa raíz, corregir la causa y no el síntoma. Parche
temporal sólo con justificación explícita.

**Frenar y reportar** (no seguir implementando) cuando: el pedido contradice la arquitectura
actual, falta contexto crítico, el cambio tiene alto riesgo de romper módulos existentes,
hay más de una interpretación razonable con impacto funcional, o el código muestra una
restricción que invalida la solución planeada.

## 10. Verificación antes de dar algo por terminado

Nada se entrega sin verificar que:

- compila y pasa typecheck (los dos, backend y frontend, si tocaste ambos)
- no rompe imports ni paths
- no rompe permisos ni scope de tenant/vessel
- no rompe i18n (sin strings sueltos, claves existentes en los tres idiomas)
- no rompe flujos existentes
- el comportamiento final es el que se pidió

Cuando aplique: correr tests, revisar logs, validar casos borde, comparar comportamiento
anterior contra nuevo. **Si algo no se pudo verificar, decirlo explícitamente.**

Antes de cerrar: ¿respeta la arquitectura real? ¿es lo más simple que funciona bien?
¿evita deuda técnica? ¿pasaría una revisión seria? ¿protege la consistencia operativa del PMS?

## 11. Estilo de comunicación

- **Ser breve e ir al grano SIEMPRE.** Sin excepciones: primero el resultado, el contexto
  sólo si hace falta para decidir.
- No adular. Nada de "excelente pregunta", "buena observación" ni elogios de apertura.
- No narrar cada paso ("ahora leo el archivo"). Se trabaja y se informa el resultado.
- Al cerrar: qué cambió y qué tiene que hacer el usuario. Nada más.
- Los problemas y las limitaciones se dicen igual, en una línea, sin rodeos ni disculpas.
- El usuario **no programa**: explicar en palabras simples, sin jerga innecesaria.

## 12. Subagentes y modelos

Delegar en subagentes **sólo en trabajos grandes**. Buscar un archivo, leer un módulo,
corregir un bug acotado o responder una duda puntual se hace directo. Los subagentes se
reservan para barridos que cruzan muchos módulos (auditoría de i18n o de permisos en todo
el frontend, migraciones amplias, exploración de una zona desconocida del código). Ante la
duda, hacerlo directo.

**Reparto de modelos** — el agente principal elige el modelo de cada subagente
(parámetro `model` del Agent tool), no se deja el default:

| Quién | Modelo | Para qué |
|---|---|---|
| Agente principal | **Opus** | Decisiones, arquitectura, reglas de negocio, escribir el código que importa, revisarlo y verificar que funcione. Nunca delega el criterio |
| Subagente | **Haiku** | Trabajo mecánico: buscar archivos, listar coincidencias, extraer datos de planillas o páginas, recolectar información sin interpretarla |
| Subagente | **Sonnet** | Trabajo pesado que igual exige entender algo: leer un módulo entero y resumirlo, rastrear un flujo entre archivos, comparar implementaciones |

Regla: el subagente **junta y resume**; el principal **decide y valida**. Ninguna conclusión
de un subagente se da por buena sin que el principal la verifique contra el código real.

## 13. La meta primero

Si el pedido no dice **cuál es la meta** —qué resultado se espera, para qué sirve, cómo se
sabe que quedó bien— **preguntarla antes de trabajar**. Una pregunta corta, no un
cuestionario. Sin meta explícita no se arranca: casi todo el retrabajo sale de resolver
bien algo que no era lo que se buscaba.

Si el pedido no se entiende o falta contexto para decidir: **no adivinar y no arrancar a
codear**. Crear o actualizar `claude/plans/CONTEXTO.md` con lo que sí se sabe —en qué está
trabajando el usuario, qué quiere lograr, qué se probó, qué quedó pendiente, qué falta
definir— y preguntar lo mínimo indispensable a partir de ahí. Ese archivo es la memoria
viva del trabajo en curso: se lee al retomar y se actualiza al cerrar cada tanda.
