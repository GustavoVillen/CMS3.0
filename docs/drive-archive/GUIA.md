# Guía: conectar CMS3 con Google Drive

Se hace **una sola vez**, con la cuenta de Google dueña de la carpeta (ej. mercuriogroupflota@gmail.com).

## 1. Copiar la clave en CMS3
1. Entrar a CMS3 como administrador → **Configuración** → **Archivo de PDFs en Google Drive**.
2. Tocar **Guardar** una vez (sin activar todavía). Aparece la **clave**: copiarla.

## 2. Crear el script en Google
1. Con la cuenta de Mercurio abrir **script.google.com** → **Nuevo proyecto**.
2. Borrar lo que aparece y pegar todo el contenido de `apps-script.gs`.
3. En `ROOT_FOLDER_ID` pegar el ID de la carpeta raíz (lo que sigue a `/folders/` en el enlace de Drive).
   Para MisDocs: `1n5EmXXxG04HMOxcd0_luyayBANnUsNR_`
4. En `SECRET` pegar la clave copiada de CMS3.
5. Guardar (ícono de disquete).

## 3. Publicarlo
1. Botón **Implementar** → **Nueva implementación**.
2. Tipo (engranaje): **Aplicación web**.
3. **Ejecutar como:** Yo. **Quién tiene acceso:** Cualquier persona.
4. **Implementar** → Google pide permisos: **Autorizar acceso** → elegir la cuenta →
   "Google no verificó esta app" → **Configuración avanzada** → **Ir a … (no seguro)** → **Permitir**.
   (Es normal: el script es de la propia empresa.)
5. Copiar la **URL de la aplicación web** (termina en `/exec`).

## 4. Terminar en CMS3
1. Volver a Configuración, pegar la URL, tildar **Activar** y **Guardar**.
2. Tocar **Probar conexión**: tiene que decir que conectó.
3. Listo. Desde ahora cada PDF que se genere cae en Drive.

## Si algo cambia
- **Se modifica el script:** Implementar → Gestionar implementaciones → editar → Versión: nueva. La URL no cambia.
- **Se regenera la clave en CMS3:** hay que pegar la nueva en `SECRET` y volver a publicar como arriba.
- **Error en Configuración:** el aviso rojo dice qué pasó. Lo más común: la clave no coincide o el acceso no quedó en "Cualquier persona".
