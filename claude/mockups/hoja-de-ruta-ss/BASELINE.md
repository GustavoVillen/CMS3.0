# Checkpoint — rediseño Hoja de ruta de la SS (Seguimiento)

- Fecha: 2026-10-21
- Prototipo aprobado: `hoja-de-ruta-v1.html` (PROCEDER de Gustavo)
- Rama: `fix/fase-0-bloqueantes`
- Tag git: `CMS_UI_HOJARUTA_BEFORE` → commit `4ea99c1`

## Archivos que toca la implementación (estaban limpios = iguales al tag)
- `apps/web-modern/src/components/service-requests/HojaRutaBox.tsx` (sólo la variante `list`)
- `apps/web-modern/src/pages/Approvals.tsx` (la ventana de la hoja de ruta)
- `apps/web-modern/src/lib/i18n.tsx` (claves `hr.*` nuevas)

## Archivos nuevos
- Ninguno dentro de la app. Sólo este material en `claude/mockups/hoja-de-ruta-ss/`.

## VOLVER
`git checkout CMS_UI_HOJARUTA_BEFORE -- apps/web-modern/src/components/service-requests/HojaRutaBox.tsx apps/web-modern/src/pages/Approvals.tsx apps/web-modern/src/lib/i18n.tsx`
(y commitear; si ya se subió al VPS, volver a desplegar).

## Estado verificado tras implementar (2026-10-21)
- `git diff CMS_UI_HOJARUTA_BEFORE --stat -- apps/` → sólo los 3 archivos de arriba.
- Typecheck y build del frontend OK.
- Probado en navegador con el componente real y respuestas simuladas: etapas, historial por
  día, registrar con Enter (aparece en "Hoy", resaltada, "Novedad registrada"), menú ⋯ con
  Corregir / Borrar (Borrar pide confirmación), pasos del sistema sólo "Corregir paso",
  solicitud cerrada (aviso, sin caja ni menú), sin novedades, celular y modo oscuro.
- No cambia: quién registra / corrige / borra, la ventana de corrección, la hoja de ruta en
  papel del formulario de la SS, el PDF ni el backend.
