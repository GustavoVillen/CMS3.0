# Checkpoint — Previews V51 + V52 (tablero de Órdenes de Trabajo)

- Fecha: 2026-09-17
- Aprobado por Gustavo: "aprobar cambio de v51 y v52". V51 en su versión base (las dos casillas del preview sin tildar).
- Rama: `fix/fase-0-bloqueantes`
- Tag git: `CMS_UI_BASELINE_V51_V52` → `203f9538427e43aacfc1a39c01d751ec02443250`
  (hecho con `git stash create`: guarda el árbol de trabajo tal como estaba, CON los cambios sin commitear
  de otras sesiones, sin tocar nada).

## Archivos que toca la implementación
### Órdenes de Trabajo (17-sep) y después Solicitudes de Servicio (mismo tag sirve de punto de partida)
- `apps/api/src/tenant/service-requests/service-requests-service.ts` — el listado de SS devuelve `sfiGroupNumber` (heredado de la OT)
- `apps/web-modern/src/pages/ServiceRequests.tsx` — V51 + V52 + Barra reservada (columnas del tablero y ventana de la SS)
- `apps/web-modern/src/components/Layout.tsx` — Barra reservada general (`[scrollbar-gutter:stable]` en `<main>`)

- `apps/api/src/tenant/work-orders/work-orders-service.ts` — el listado devuelve `sfiGroupNumber` por OT
- `apps/web-modern/src/pages/WorkOrders.tsx` — tarjeta comprimida (V51), sin tarjetas de resumen y con botones G0–G9 (V52)
- `apps/web-modern/src/lib/i18n.tsx` — claves `wo.typeShort.*` y `wo.fl.group`

## Archivos nuevos
- Ninguno dentro de la app. Sólo este directorio de mockups.

## VOLVER-CERO
Restaurar sólo esos tres archivos desde el tag, sin tocar el resto del árbol:

    git checkout CMS_UI_BASELINE_V51_V52 -- apps/api/src/tenant/work-orders/work-orders-service.ts apps/web-modern/src/pages/WorkOrders.tsx apps/web-modern/src/lib/i18n.tsx

Ojo: si otra sesión editó alguno de esos tres archivos después del 2026-09-17, ese checkout también
deshace lo suyo. Antes, mirar `git diff CMS_UI_BASELINE_V51_V52 -- <archivo>`.

## Diferencia con el preview
- Una OT con varias SS muestra un chip "N SS" (códigos en el tooltip) en lugar de todos los códigos.
- Si el renglón de equipo/vencimiento/SS no entra, lo que sobra baja a un segundo renglón en esa tarjeta
  (el preview no tenía tarjetas tan cargadas; sin esto los datos quedaban cortados contra el borde).
