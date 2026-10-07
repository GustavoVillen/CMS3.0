# Rediseño de la consola SUPERADMIN — instrucciones para cada pantalla

Aprobado por Gustavo (PROCEDER) sobre el prototipo
`claude/mockups/superadmin-amigable/superadmin-amigable-v3.html` (abrirlo y leer la
sección de TU pantalla en `const VIEWS = {...}` y el panel de notas "Antes/Ahora").

## Meta
La consola tiene que poder usarla alguien que no conoce el código: nada de nombres
internos visibles (slug, tenant, feature, tokens, ai_call, roles/estados en inglés tipo
MAINTENANCE_MANAGER / ACTIVE, rutas /app/..., códigos de buque como DCH, ids, JSON).
Gráficamente agradable, simple, consistente entre pantallas, y que funcione en celular.

## Ya está hecho (usarlo, no reinventarlo, no modificarlo)
- `apps/web-modern/src/lib/platform-labels.ts`: roleLabel, statusInfo(status, kind),
  localeLabel, currencyLabel, featureLabel/FEATURE_OPTIONS, capabilityLabel, screenLabel,
  failureLabel, entityLabel, auditActionLabel, auditActionKind, fmtWhen («hoy 08:27»),
  fmtAgo («hace 3 min»), fmtDate, fmtUsd, fmtBytes, fmtInt, humanize.
  Si te falta una etiqueta, agregala en TU archivo de página como mapa local; NO edites
  platform-labels.ts (lo comparten 5 personas trabajando a la vez).
- `apps/web-modern/src/components/platform/PlatformUi.tsx`: PageIntro (título + frase
  explicativa + acciones), StatusPill (color+ícono+texto), Card, KpiCard, KpiRow, BarList,
  FilterBar, FilterField (rótulo visible), Segmented, EmptyState, TwoLines, inputCls.
- Componentes del proyecto: `DataTable` (columnas con filterValue = lo que se ve,
  `mobileCards`, `mobileTitle`, `mobileHidden`), `ModalCloseButton` (la X de TODOS los
  modales), `AlertDialog` (errores/validaciones en ventanita con OK: reemplaza los
  recuadros rojos `ErrMsg` al pie del form), `ConfirmDialog` (acciones irreversibles).
- Backend ya devuelve nombres (campos nuevos):
  - GET /platform/tenants → + vesselCount, userCount.
  - GET /platform/access/active → items + tenantName, vesselName, userName (ya existía).
  - GET /platform/access/logins → items + tenantName. failureReason ahora puede ser
    wrong_password / user_not_found / user_inactive; con user_not_found, userEmail es lo
    que la persona tecleó. Los viejos traen userEmailRedacted=true (identificador ofuscado):
    mostrarlos como «Intento anterior al registro de nombres», no el hash.
  - GET /platform/audit-events?tenantSlug&from&to&limit → items + tenantName, actorName,
    actorEmail, metadata.
  - GET /platform/usage/summary?kind&tenantSlug&userEmail&feature&vesselCode&from&to →
    { totals:{events,costUsd,bytes,users}, byDay:[{day:"YYYY-MM-DD",events,costUsd,bytes}],
      byUser:[{tenantSlug,tenantName,userEmail,userName,events,costUsd,bytes}],
      byFeature:[{feature,events,costUsd,bytes}],
      byVessel:[{tenantSlug,tenantName,vesselCode,vesselName,events,costUsd,bytes}], truncated }
    Cubre TODO el período filtrado (la lista /platform/usage sigue paginada).
  - GET /platform/copilot-questions → items + answer, userName, tenantName, vesselName;
    + storage {count, bytes, oldest, maxBytes, retentionDays}. `search` busca también
    en la respuesta.
  - GET /platform/vessel-positions → items + tenantName, userName (vesselName ya venía).
  - GET /platform/user-activity → events + tenantName, vesselName;
    user.memberships[].tenantName; /search → rows + tenantName.

## Reglas
- Sólo tocás los archivos que te asignaron. No commitees. No toques backend, App.tsx
  (salvo el agente del menú), i18n.tsx, platform-labels.ts ni PlatformUi.tsx.
- No eliminar funcionalidades existentes (crear/editar/borrar, exportar Excel, mapas,
  subir logo, plantilla de PDF, refresco automático, etc.). No cambiar permisos.
- Mostrar nombre ?? código como respaldo (nunca vacío). Buque: vesselName ?? vesselCode.
  Empresa: tenantName ?? tenantSlug. Persona: userName ?? email.
- Filtros con rótulo visible y DESPLEGABLES en vez de texto libre para empresa y persona.
  La lista de personas sale de los datos ya cargados del período (guardala cuando el
  filtro de persona está en «Todas», así no se achica al elegir una). Filtrar sin botón
  «Aplicar» (al cambiar el valor; el texto libre con un debounce de ~400 ms).
- Datos técnicos (IP, modelo de IA, tokens, demora, ids, ruta cruda) escondidos detrás de
  un botón «Ver detalle técnico» o fuera, no en la vista principal.
- Sin `font-mono` para datos normales (fechas, nombres, emails). Sin emojis. Sin
  MAYÚSCULAS para rótulos. Estados siempre con StatusPill.
- Estados vacíos con EmptyState que dice qué falta y qué hacer.
- Celular: DataTable con `mobileCards` (mobileTitle en la columna principal, mobileHidden
  en lo secundario), grillas `grid-cols-1` y `lg:grid-cols-2`, sin scroll horizontal.
- Textos en castellano rioplatense, como el resto de la consola («Tocá», «Elegí»).
- Al terminar: `pnpm --filter web-modern typecheck` desde C:\CMS3.0 sin errores en TUS
  archivos (si hay errores en archivos de otro agente, ignoralos y avisá).
- Informe final (corto): archivos tocados, qué quedó igual que el prototipo, qué no se
  pudo y por qué, y cualquier dato del prototipo que el backend no provee.
