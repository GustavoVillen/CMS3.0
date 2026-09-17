# CONTEXTO — Actualización de manuales y videos (sep 2026)

**Pedido de Gustavo (12-sep-2026):** actualizar los manuales y los videos con los 86 commits desde el
31-ago, crear los videos que no existan y **subir todo al VPS** al final.
Decisiones suyas: regrabar solo los videos que cambiaron mucho; **no grabar pantallas ocultas en
producción para Mercurio** (Tripulantes, Horas de Descanso, Simulacros, Cert. Tripulación, Matriz
Requerimientos, Near Miss). Tanques, Reportes Mensuales y Bitácora ya se grabaron y se publican igual.

Brief para los subagentes: scratchpad de la sesión `BRIEF-comun.md` (copia de las reglas abajo si se perdió).
Clave local: `Mercurio2026`. Para grabar, los scripts NO hacen login: usan una copia del perfil
de Chrome donde Gustavo inició sesión a mano (`scratchpad\chrome-login`; si ya no existe, abrir
Chrome con `--user-data-dir` nuevo y pedirle que entre).

## HECHO
- Manuales corregidos (backup en `MisDocs\ManualesCMS3.bak-20260912\`): Abrir-ot-completa-y-ss,
  cargar-plan-mantenimiento, maintenance-gantt, cargar-activo, tripulacion-y-maestros, dashboard,
  tmsa, horas-de-equipos, parte-semanal, manual-usuario, firmas-en-el-celular, inspecciones,
  muestreos-y-analisis, registrar-muestreo-analisis, permisos-de-trabajo, defectos, checklists,
  flujogramas (vía _flujogramas-data.cjs), diagrama-generar-ot, generar-ot-actualizada.
- Manual NUEVO `planilla-a-bordo` (fuente `_src/planilla-a-bordo.src.html`), ya sumado al MANIFEST de `_build-portal.cjs`.
- Chequeo estructural de manuales OK (tags balanceados, capturas intactas; dashboard 5→3 a propósito).
- Videos REGRABADOS (viejos en el backup como .OLD.mp4): OT, Indicadores Tablero, Horas de Equipos,
  Gantt (16,5 min), Muestreos (18 min), Auditoría ISM, Auditoría TMSA.
- Videos NUEVOS listos: planes-mantenimiento, planilla-a-bordo, medicion-tanques,
  reportes-mensuales, parte-semanal, bitacora.

## EN PAUSA (se frenó a pedido de Gustavo)
- certificados, checklists — carpeta `_capturas-certificados-video\` (guion listo).
- buques, proveedores, usuarios-y-roles.
- ai-documents, configuracion, firmas-celular, copiloto.
Mirar el README de cada `_capturas-<slug>-video\` para ver en qué paso quedó.
Ninguno llegó a grabar ni a escribir en la base. Solo `_capturas-certificados-video\` tiene guion + capturar.cjs (sin login).
**Traba abierta:** la copia del perfil `chrome-login` abre en `/login` (la sesión no viajó con la copia o venció).
Al retomar, antes de lanzar agentes: averiguar dónde guarda la app el token (`lib/auth.tsx`: localStorage vs sessionStorage)
y si la API se reinició (las sesiones viven en memoria). Si hace falta, pedirle a Gustavo que inicie sesión de nuevo
y grabar enseguida, sin reiniciar la API.

## ACTUALIZACIÓN 13-sep
- Los 9 videos que estaban en pausa quedaron grabados: certificados, checklists, buques, proveedores,
  usuarios-y-roles, ai-documents, configuracion, firmas-celular, copiloto. En total hay 33 videos.
- Portales regenerados: `videos-portal.html` (33 videos) y `manual-completo.html` (35 manuales), y copiado a `apps/web-modern/public/manual.html` (sin commit).
- Traba de sesión resuelta: la app rota el token de refresco, así que cada agente necesita su propio
  perfil logueado a mano (no se pueden usar copias del mismo perfil).
- **PUBLICADO 13-sep** (Gustavo dijo "actualizar vps"): commit 5487bc1 en v3, build web en el VPS, 22 MP4 subidos a
  /app-cms3/media/videos (los 7 viejos en `_bak-20260913/`), thumbs + index.html nuevos. Verificado: 33 videos en /videos/.
  TAREA CERRADA. Quedan sólo los bugs de abajo y las 4 capturas viejas de los manuales de OT.

## FALTA (versión anterior, ver arriba)
1. Terminar los 9 videos en pausa.
2. `_build-videos-portal.cjs`: sumar a TITLES/GROUPS los slugs nuevos (planes-mantenimiento,
   planilla-a-bordo, medicion-tanques, reportes-mensuales, parte-semanal, bitacora + los 9) y correrlo
   (genera videos-portal.html y videos.html).
3. `node _build-portal.cjs` → copiar `manual-completo.html` a `apps/web-modern/public/manual.html`.
4. Commit + push a v3; en el VPS `git pull` + build web; subir los MP4 nuevos/regrabados a
   `/app-cms3/media/videos/<slug>.mp4` + `videos-portal.html` como index.html + thumbs.
5. Capturas desactualizadas marcadas en Abrir-ot-completa-y-ss (3) y generar-ot-actualizada (1): decidir si se rehacen.

## Bugs de la app encontrados (sin corregir)
- i18n `assetHours.editDateHint` dice "solo administrador" (también corrigen Superintendente y Jefe de Máquinas).
- Reportes Mensuales: modal en blanco tras guardar uno nuevo; "Generar borrador" IA da 500 con AI_PROVIDER=gemini.
- Parte Semanal: "&MIDDOT;" sin decodificar en el encabezado del correo.
- Bitácora: acciones sin traducir (RECORDED, AUTHORIZED, OPENEDFROMPLAN, SUBMITTEDFORAPPROVAL).
- WorkOrders.tsx: dos secciones con el número 3 en el formulario controlado.
- MaintenancePlans.tsx: strings sin i18n ("Excel", "Limpiar", "Generar una sola…", "ítem(s) marcado(s)").
- Datos: equipos duplicados en MAO 01 (Motor Principal Babor, Caja Reductora Estribor) y planes duplicados por taskCode en DCH (DCH-MA-ER-06, DCH-MA-BR-06). Base local = copia de producción, verificar allá.
- Local: plan M01-MA-BR-01 quedó con "Última verificación" = fecha de grabación (solo base local).

---

# CONTEXTO — Solicitudes de Repuestos (17-sep-2026)

**Pedido de Gustavo:** "mejorar y completar el proceso de Solicitudes de Repuestos".
**Meta aclarada:** la solicitud es **sólo un formulario desde el buque al departamento de Compras** de la
Compañía. No es un pedido a depósito con reservas ni entrega de stock.

## Ya hecho hoy (sin commit)
- Repuestos & Stock: casillas + "Generar solicitud de repuestos (N)" → crea UNA solicitud en Borrador
  con los ítems tildados (Preview V3). Se sacó el "Pedir" de cada fila.
- Formularios/ PDF: REGI-MAN-04.1 y Estándar para viaje (Preview V1/V2). BASELINE: tag `baseline-inventario-formularios-v1`.

## Cómo está hoy el proceso (código)
- Estados: Borrador → Enviada → Aprobada/Rechazada → Parcialmente entregada/Entregada; Cancelada.
- "Entregar" un ítem SUMA STOCK por su cuenta (movimiento RECEIPT), aparte de la Recepción con remito:
  usando los dos, el stock se duplica. Además entrega siempre la cantidad completa.
- Hay reservas de stock (StockReservation) pensadas para pedido a depósito: no aplican a esta meta.
- Rechazada = final: no se puede corregir y reenviar.
- No manda nada a Compras: hay PDF (spare-request-pdf-service) pero no correo. La SS sí manda correo con PDF (mailer).
- Pantalla con textos fijos en español, estados/prioridades en inglés (SUBMITTED, MEDIUM), campo
  "Vessel destino" de texto libre, ítems sin P/N / equipo / stock a bordo / motivo.
- Permisos: crear/enviar = `spareRequest.manage`; aprobar/rechazar = `spareRequest.approve`.
  Ítems usan una lista fija de roles (inconsistente con el permiso).

## DECIDIDO (Gustavo) e IMPLEMENTADO — Preview V4 aprobada
- Sin aprobación: Borrador → "Enviar a Compras" (correo con PDF) → Enviada. Termina ahí; lo que llega va por Recepción Repuestos.
- Casilla de Compras configurable en Configuración (TenantSetting.spareRequestMailbox, sólo admin). Fail-closed: sin casilla/SMTP o si falla, sigue en Borrador.
- Anular (con motivo, avisa a Compras por correo), Reenviar correo. Se sacaron de la pantalla Aprobar/Rechazar/Entregar/Reservas (endpoints quedan).
- PDF nuevo (spare-request-pdf-service). Pendientes del sidebar/TMSA cuentan sólo borradores.
- Ítems: permiso spareRequest.manage (antes lista fija de roles).

## FALTA
- Cargar la casilla real de Compras en Configuración (local, demo y producción) y `pnpm db:push` en el VPS (campo nuevo).
- Probar un envío real con SMTP (local no tiene SMTP: sólo se verificó el camino "no sale").
- Commit + demo + producción cuando Gustavo lo pida.
