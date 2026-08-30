---
name: scaffold-module
description: Genera un módulo completo en GPMS (backend service + router routes + React page + i18n keys + App/Layout/Sidebar wiring). Úsalo cuando el usuario quiera crear un nuevo módulo/entidad en el sistema.
arguments: [module-name]
---

Genera un módulo completo para GPMS. El nombre del módulo es: $ARGUMENTS

Sigue estos pasos en orden. Lee los archivos necesarios antes de modificarlos.

## 1. Analiza el contexto

- Lee `apps/api/src/tenant/spare-requests/spare-requests-service.ts` como referencia del patrón de servicio.
- Lee `apps/api/src/tenant/pms/spares-router.ts` para ver cómo se agregan rutas.
- Lee `apps/web-modern/src/pages/SpareRequests.tsx` como referencia del patrón de página.
- Lee `apps/web-modern/src/lib/i18n.tsx` para ver la estructura del dict.
- Lee `apps/web-modern/src/App.tsx`, `apps/web-modern/src/components/Layout.tsx`, `apps/web-modern/src/components/Sidebar.tsx`.

## 2. Deriva los nombres

Del argumento `$ARGUMENTS` (ej: "purchase-orders", "inspections", "certificates"):
- **kebab**: el argumento tal cual (ej: `purchase-orders`)
- **camelPlural**: versión camelCase plural (ej: `purchaseOrders`)
- **PascalSingular**: versión PascalCase singular (ej: `PurchaseOrder`)
- **PascalPlural**: versión PascalCase plural (ej: `PurchaseOrders`)
- **path**: la ruta URL (ej: `/purchase-orders`)
- **i18nPrefix**: prefijo para claves i18n (ej: `po`)

## 3. Crea el servicio backend

Crea `apps/api/src/tenant/$ARGUMENTS/$ARGUMENTS-service.ts` con:
- Función `resolveTenantId(session)` — misma que en spare-requests-service.ts
- `list${PascalPlural}(session, filters)` — con `prisma.findMany`, `where: { tenantId, deletedAt: null }`
- `get${PascalSingular}(session, id)` — con `findFirst` y throw 404
- `create${PascalSingular}(session, input)` — con `canManage` guard y `void publishAudit(...)`
- `update${PascalSingular}(session, id, input)` — con `canManage` guard
- `delete${PascalSingular}(session, id)` — soft delete (`deletedAt`)
- Imports: `TenantAccessSession`, `getPrismaClient`, `RouteError`, `publishAudit`
- `canManage`: roles `TENANT_ADMIN`, `MAINTENANCE_MANAGER`, `PROCUREMENT_STORE`

## 4. Agrega rutas al router

En `apps/api/src/tenant/pms/spares-router.ts`:
- Agrega el import del nuevo servicio
- Agrega `/app/pms/$ARGUMENTS` al prefijo guard (condición `url.pathname.startsWith(...)`)
- Agrega rutas: `GET /app/pms/$ARGUMENTS`, `POST /app/pms/$ARGUMENTS`, `GET/PATCH/DELETE /app/pms/$ARGUMENTS/:id`

## 5. Crea la página React

Crea `apps/web-modern/src/pages/${PascalPlural}.tsx` con:
- Interfaz TypeScript para la entidad
- `useFetch` para cargar datos del endpoint `/app/pms/$ARGUMENTS`
- `PageHeader` con botón "Nuevo" usando `Plus` icon
- `DataTable` con `onRowClick={row => setEditing(row)}` (NUNCA botón Editar en la fila)
- Modal con:
  - Header: título + botón X
  - Body: formulario con campos (inferidos del modelo Prisma si existe, o campos genéricos)
  - Footer: botón "Cerrar" + botón "Guardar" (solo si aplica)
- Estado: `editing: Entity | null | "new"`
- `fetch` con `credentials: "include"` para POST/PATCH

## 6. Agrega claves i18n

En `apps/web-modern/src/lib/i18n.tsx`, dentro del `dict`, agrega una sección con prefijo `${i18nPrefix}`:
- `nav.${camelPlural}`: nombre en sidebar (es/en/pt)
- `${i18nPrefix}.new`: "Nuevo X" / "New X" / "Novo X"
- `${i18nPrefix}.name`: nombre del campo principal
- `${i18nPrefix}.status`: "Estado" / "Status" / "Status" (si aplica)
- `empty.${camelPlural}`: mensaje de lista vacía

## 7. Conecta en App.tsx

En `apps/web-modern/src/App.tsx`:
- Agrega el import de `${PascalPlural}Page`
- Agrega la ruta: `<Route path="/$ARGUMENTS" element={<${PascalPlural}Page />} />`

## 8. Conecta en Layout.tsx

En `apps/web-modern/src/components/Layout.tsx`, en el objeto `TITLES`:
- Agrega: `"/$ARGUMENTS": "Título legible en español"`

## 9. Conecta en Sidebar.tsx

En `apps/web-modern/src/components/Sidebar.tsx`, en `MAIN_ITEMS`:
- Agrega el item con el ícono más apropiado de lucide-react
- Si el ícono no está importado, agrégalo al import

## 10. Verifica TypeScript

Corre: `npx tsc -p apps/api/tsconfig.json --noEmit 2>&1 | grep "$ARGUMENTS"` para verificar errores en el nuevo servicio.
Corre: `npx tsc -p apps/web-modern/tsconfig.json --noEmit 2>&1 | grep "${PascalPlural}"` para verificar la página.

## Reglas invariantes

- NUNCA escribir `currentStock` ni leer stock desde campos directos — siempre usar `stock-calc-service`
- NUNCA agregar botón "Editar" en filas de tabla — el click en la fila abre el modal
- Todos los `fetch` deben usar `credentials: "include"`
- `publishAudit` siempre con `void` (fire-and-forget)
- Soft delete: `deletedAt` + `deletedByUserId`, nunca `prisma.delete`
