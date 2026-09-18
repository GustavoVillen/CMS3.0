# Archivo de PDFs en Google Drive — guía del usuario

Cada PDF que genera CMS3 se guarda solo en el Google Drive de la empresa. Se configura
una sola vez, desde la propia pantalla, y no hace falta saber nada técnico.

## Conectar la cuenta

1. Entrar a CMS3 como administrador → **Configuración** → **Archivo de PDFs en Google Drive**.
2. Tocar **Conectar con Google Drive**.
3. Se abre Google: elegir la **cuenta de la empresa** (la dueña del Drive donde se van a
   guardar los documentos) y tocar **Continuar / Permitir**.
4. Vuelve a CMS3 con el cartel "Cuenta de Google conectada".
5. Tildar **Activar el archivo automático** y tocar **Guardar**.

Listo. Con **Probar conexión** se puede confirmar cuando se quiera.

## Qué hace

- Crea en ese Drive una carpeta **CMS3 — Documentos** y adentro una por tipo de documento
  (OT, SS, DEF, FA, APL, VAR, REQ, MOC, Planes de Mantenimiento, Otros). Los nombres de esas
  carpetas se pueden cambiar en la misma pantalla.
- Mientras el documento está **abierto**, el PDF va a `<tipo>/Borrador` y se pisa cada vez que
  se genera de nuevo.
- Cuando el documento queda **cerrado, aprobado, rechazado o cancelado**, el PDF pasa a
  `<tipo>/` como registro final y se borra la copia de Borrador.
- Los planes de mantenimiento y los PDFs sueltos (permisos, inspecciones, checklists…) van
  directo a su carpeta, sin borrador.

CMS3 sólo puede ver y tocar lo que él mismo guarda ahí: no tiene acceso al resto del Drive.

## Cosas para saber

- **Desconectar** corta el archivo automático. Lo que ya está guardado queda en el Drive.
- Si algo falla (se revocó el permiso, se borró la carpeta a mano, no había internet), el PDF
  se genera igual y el aviso del error aparece arriba de la sección. Se destraba con
  **Probar conexión** o volviendo a conectar la cuenta.
- El archivo automático arranca **apagado** en una empresa nueva.

Para dar de alta la conexión del lado de Google (una sola vez por instalación, lo hace el
equipo de CMS3) ver [ALTA-GOOGLE.md](ALTA-GOOGLE.md).
