# Alta de la conexión con Google (equipo CMS3)

Esto lo hace **una sola vez el equipo de CMS3**, no el cliente. Da de alta la aplicación en
Google para que después cada empresa pueda conectar su Drive con un botón
(ver [GUIA.md](GUIA.md)).

## 1. Proyecto y API

1. [console.cloud.google.com](https://console.cloud.google.com) → crear proyecto (ej. `CMS3`).
2. **APIs y servicios → Biblioteca** → habilitar **Google Drive API**.

## 2. Pantalla de consentimiento

1. **APIs y servicios → Pantalla de consentimiento de OAuth** → tipo **Externo**.
2. Nombre de la app (`CMS3`), correo de asistencia, dominio autorizado `shipcms.cloud`,
   correo del desarrollador.
3. Permiso a agregar: **`.../auth/drive.file`** y ninguno más. Es un permiso *no sensible*:
   Google no pide verificación ni auditoría de seguridad, y el usuario no ve la pantalla de
   "app no verificada".
4. **Publicar la app** (estado *En producción*). En estado *Prueba* el permiso se vence a los
   7 días y la conexión se corta sola.
5. Google pide ser dueño del dominio autorizado: verificar `shipcms.cloud` en
   [Search Console](https://search.google.com/search-console) con la misma cuenta.

## 3. Credencial

**APIs y servicios → Credenciales → Crear credenciales → ID de cliente de OAuth →
Aplicación web**. En *URI de redirección autorizados* cargar uno por entorno y por empresa
(Google no acepta comodines):

```
http://localhost:5174/app/tenant/pdf-archive/google/callback
https://demo.cms3.shipcms.cloud/app/tenant/pdf-archive/google/callback
https://mercurio.cms3.shipcms.cloud/app/tenant/pdf-archive/google/callback
```

**Al dar de alta una empresa nueva hay que agregar su línea acá**, con su subdominio. Sin eso,
al tocar "Conectar" Google contesta `redirect_uri_mismatch`.

## 4. Variables en el servidor

En el `.env` de cada instalación (producción, demo y local):

```
GOOGLE_OAUTH_CLIENT_ID=...
GOOGLE_OAUTH_CLIENT_SECRET=...
```

En **local** además `APP_PUBLIC_BASE_URL=http://localhost:5174`, porque el proxy de Vite
reescribe el host y sin eso la dirección de retorno saldría con el puerto de la API. En el
servidor **no se carga**: la dirección sale del subdominio de cada request.

Reiniciar la API después de tocar el `.env`.

## Cómo diagnosticar

| Síntoma | Causa típica |
|---|---|
| El botón no se puede tocar | Faltan las dos variables en el `.env` de ese servidor. |
| `redirect_uri_mismatch` | Falta el subdominio de esa empresa en la lista del paso 3. |
| Conectó y a los días dejó de andar | La app quedó en estado *Prueba*: publicarla. |
| "Google no devolvió el permiso permanente" | Se conectó una cuenta que ya tenía el permiso dado; volver a conectar (el flujo fuerza el consentimiento). |
| Error al subir un PDF puntual | Queda escrito arriba de la sección en Configuración, con fecha. |
