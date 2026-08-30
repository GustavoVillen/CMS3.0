---
name: audit-i18n
description: Audita el sistema i18n de GPMS. Detecta claves huérfanas en el dict, strings hardcodeados en páginas, y traducciones faltantes. Úsalo periódicamente o antes de un release.
---

Realiza una auditoría completa del sistema i18n de GPMS.

## 1. Lee el dict completo

Lee `apps/web-modern/src/lib/i18n.tsx` y extrae todas las claves definidas en el `dict`.

## 2. Escanea el uso de claves en el código

Busca todas las llamadas a `t("...)` en `apps/web-modern/src/`:
```bash
grep -rh 't("[^"]*")' apps/web-modern/src/ --include="*.tsx" --include="*.ts" -o | sort | uniq
```

También busca claves usadas como `labelKey`:
```bash
grep -rh 'labelKey: "[^"]*"' apps/web-modern/src/ --include="*.tsx" -o | sort | uniq
```

## 3. Detecta claves huérfanas

Compara las claves definidas en el dict con las encontradas en el código. Las claves que están en el dict pero **no** se usan en ningún archivo son huérfanas. Lista hasta 20.

## 4. Detecta strings hardcodeados

Busca texto en español hardcodeado en JSX (no dentro de `t(...)`):
```bash
grep -rn ">[A-ZÁÉÍÓÚÑ][a-záéíóúñ]" apps/web-modern/src/pages/ --include="*.tsx" | grep -v "t(\"" | grep -v "//" | head -30
```

Lista los archivos con más strings hardcodeados.

## 5. Detecta traducciones faltantes

En el dict, verifica que cada clave tenga los 3 idiomas: `es`, `en`, `pt`. Reporta las claves que les falte algún idioma.

## 6. Reporta

Genera un reporte en formato markdown con:

### Resumen
- Total claves en dict: N
- Claves usadas: N
- Claves huérfanas: N
- Archivos con strings hardcodeados: N
- Claves con traducciones faltantes: N

### Claves huérfanas (candidatas a eliminar)
Lista de claves no usadas.

### Archivos con más strings sin traducir
Lista de archivos y count aproximado.

### Claves con traducciones incompletas
Lista de claves y qué idioma falta.

### Recomendaciones
Acciones prioritarias ordenadas por impacto.

## Reglas

- No modificar ningún archivo, solo reportar
- Si hay más de 20 items en una categoría, muestra los 20 primeros y el total
- Prioriza archivos en `apps/web-modern/src/pages/` sobre componentes
