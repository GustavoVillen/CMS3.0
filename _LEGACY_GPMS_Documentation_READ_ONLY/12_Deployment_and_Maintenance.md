# Implementación, Despliegue y Mantenimiento

## 1. Estructura de despliegue actual
El proyecto se despliega como una web app de Google Apps Script usando `clasp`.

Archivos relevantes:

- `.clasp.json`
- `.claspignore`
- `appsscript.json`

## 2. Configuración del entorno
### `.clasp.json`
Contiene:

- `scriptId`
- extensiones soportadas
- `rootDir`

### `.claspignore`
Define qué archivos se empujan realmente a Apps Script. Observación importante:

- `models.json` está excluido del push.
- `public/` está excluido.
- el código efectivo es `Code.js`, `DB.js`, `AI.js`, `SetupDB.js`, `*.html`, `appsscript.json`.

## 3. Despliegue como Web App
### Manifest
`appsscript.json` define:

- `executeAs: USER_DEPLOYING`
- `access: ANYONE`
- scopes para Drive, Sheets, Docs, requests externas, email.

### Implicancias
- el usuario que despliega es el principal ejecutor efectivo;
- sus permisos sobre Drive/Sheets son determinantes;
- cualquier cambio de cuenta o pérdida de acceso afecta toda la operación.

## 4. Provisioning inicial
### SetupDB
`SetupDB.js` contiene el bootstrap del sistema:

- `initMercurioDatabase()`
- `initProveedoresDatabase()`
- helpers de creación de tablas y migración.

### Resultado esperado
- creación del spreadsheet base;
- creación de pestañas con headers canónicos;
- creación de carpeta de evidencias;
- impresión de IDs para copiar en `DB_CONFIG`.

## 5. Variables y configuración sensible
### En código
- IDs de spreadsheets;
- IDs de carpetas Drive;
- IDs de manual y datasource IA.

### En Script Properties
- `GEMINI_API_KEY`
- `GEMINI_MODEL` (opcional)
- `APP_TIMEZONE` (opcional)

## 6. Versionado
### Estado actual
- el versionado de código se apoya en Git + `clasp push`.
- el versionado documental operativo depende de Drive/Docs y del manual maestro.

### Riesgos
- parte de la configuración crítica no está desacoplada del código;
- el versionado de datos en Sheets queda fuera del repositorio.

## 7. Actualizaciones
### Patrón actual
1. editar archivos locales;
2. `clasp push`;
3. desplegar nueva versión web app si corresponde;
4. validar operación en entorno Apps Script.

### Recomendaciones
- separar `dev`, `test`, `prod`;
- mover IDs/env a propiedades por ambiente;
- generar checklist de smoke tests post-deploy.

## 8. Respaldo de datos
### Estado observado
No existe un subsistema explícito de backup en el código. El manual exige respaldo del repositorio maestro.

### Recomendación mínima
- exportación periódica de Sheets críticos;
- snapshot de carpetas Drive de evidencia;
- backup controlado de Script Properties;
- recuperación documentada.

## 9. Mantenimiento correctivo y evolutivo
### Desafíos actuales
- `DB.js` y `Script.html` son monolitos grandes;
- alto acoplamiento funcional;
- cambios aparentemente simples pueden afectar varios módulos.

### Estrategia sugerida
- mantenimiento por dominio;
- pruebas manuales guiadas por workflow;
- auditoría de side-effects antes de cada despliegue.

## 10. Operación diaria del sistema
### Requiere
- usuario administrador funcional/técnico;
- cuidado de estructura de hojas;
- gobierno documental en Drive;
- control de usuarios y permisos en `_USERS`.

## 11. Buenas prácticas recomendadas
- no editar headers manualmente sin revisión técnica;
- documentar toda nueva columna o sincronización;
- centralizar cambios de configuración;
- mantener bitácora de despliegues;
- validar generación de PDFs y permisos Drive tras cada release.

## 12. Recomendación para futura plataforma
Una migración a Antigravity debería separar claramente:

- código de dominio;
- configuración;
- secretos;
- documentos;
- datos operativos;
- pipelines de despliegue.
