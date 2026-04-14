# Seguridad y Permisos

## 1. Enfoque de seguridad actual
GPMS implementa seguridad lógica propia sobre una web app de Google Apps Script. Aunque el despliegue está configurado con acceso `ANYONE`, la autorización real se controla mediante autenticación interna y verificación de permisos en cada operación sensible.

## 2. Autenticación
### Fuente de verdad
Tabla `_USERS`.

### Campos relevantes
- `USER_ID`
- `EMAIL`
- `PASSWORD_HASH`
- `ROLE`
- `PERMISSIONS`
- `STATUS`
- `ASSIGNED_ASSET_ID`, `ASSIGNED_ASSET_IDS`
- `ASSIGNED_VESSEL`, `ASSIGNED_VESSELS`
- `ASSIGNED_UNIT_ID`, `ASSIGNED_UNIT_IDS`

### Flujo de login
1. El usuario envía `USER_ID` y contraseña.
2. `apiLogin()` busca el usuario.
3. Verifica `STATUS = ACTIVE`.
4. Comprueba `PASSWORD_HASH`.
5. Genera sesión en `CacheService` y token persistente.

## 3. Protección de credenciales
### Implementación actual
- hash SHA-256 con salt almacenado en formato `sha256$salt$hash`.

### Riesgo
El backend mantiene compatibilidad con algunos hashes legacy, lo que puede implicar coexistencia con esquemas menos robustos.

## 4. Sesiones
### Componentes
- `CacheService`: sesión corta.
- `ScriptProperties`: token persistente.
- `localStorage`: almacenamiento del token en cliente (`mercurio_auth_token`).

### Riesgos
- token persistente sin gobierno fuerte de expiración;
- storage cliente más expuesto que una cookie httpOnly.

## 5. Roles y permisos
### Roles identificados
- `ADMIN`
- `AUDITOR`
- `READ_ONLY` / `READONLY`
- otros roles operativos definidos por tabla.

### Permisos
Además del rol, cada usuario puede tener permisos explícitos y scopes asignados.

### Privilegios implícitos del admin
- `VIEW_ALL_VESSELS`
- `EDIT_ALL_VESSELS`
- `MANAGE_ALL_VESSELS`
- `MANAGE_USERS`

## 6. Control de acceso por scope
### Dimensiones de scope
- activo;
- embarcación;
- unidad.

### Efecto
La misma API puede devolver subconjuntos distintos según el usuario autenticado.

## 7. Control de permisos por tabla
El backend usa `_assertCanWriteTable_(user, tableName)` para decidir si una tabla es escribible por un usuario.

Casos especiales:
- `_USERS` requiere privilegios más altos;
- perfiles read-only quedan bloqueados para escritura;
- también se valida acceso por scopes antes de escribir.

## 8. Protección de datos
### Medidas implementadas
- autenticación propia;
- filtrado por asset/vessel/unit;
- restricción de carpetas aprobadas para uploads;
- auditoría básica por `_AUDIT_LOG`.

### Debilidades
- no hay cifrado aplicativo adicional;
- no hay segregación fuerte entre entornos;
- `appsscript.json` expone el webapp a `ANYONE` a nivel URL.

## 9. Seguridad documental
El manual maestro exige:

- copia controlada;
- repositorio maestro;
- trazabilidad de revisiones;
- control de acceso por perfil;
- respaldo periódico.

La implementación técnica aporta parte de esto, pero no garantiza completamente la gobernanza documental por sí sola.

## 10. Cumplimiento normativo y operacional
El manual enlaza el sistema con:

- Código ISM;
- requisitos de autoridad marítima;
- exigencias de cliente/terminal;
- enfoque `Inspection Ready` / `SIRE Ready`.

Esto no convierte al sistema automáticamente en compliant; sí lo posiciona como repositorio y herramienta de evidencia para cumplimiento.

## 11. Riesgos principales
| Riesgo | Impacto |
|---|---|
| Web app `ANYONE` | exposición del endpoint público |
| Tokens persistentes | riesgo de sesión prolongada |
| IDs hardcodeados | dependencia de entorno único |
| Passwords legacy | superficie de riesgo histórico |
| Monolito `DB.js` | más difícil auditar seguridad por capas |

## 12. Recomendaciones de mejora
- cambiar `access` a modelo más restrictivo si el contexto lo permite;
- incorporar expiración formal de token persistente;
- migrar completamente a hashes robustos sin fallback legacy;
- externalizar secretos e IDs sensibles;
- agregar logging estructurado de autenticación y autorización;
- separar identidad, permisos y scope management como subsistema independiente.
