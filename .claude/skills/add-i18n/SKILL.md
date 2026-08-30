---
name: add-i18n
description: Detecta strings hardcodeados en un componente/página React de GPMS, propone claves i18n con la convención correcta, las inserta en el dict de i18n.tsx y reemplaza los strings en el componente. Úsalo cuando el usuario quiera internacionalizar una página o cuando haya strings en español hardcodeados en el JSX.
arguments: [file-path]
---

Internacionaliza el archivo: $ARGUMENTS

## 1. Lee el archivo objetivo

Lee `$ARGUMENTS` y extrae todos los strings literales en español que aparezcan:
- En atributos JSX (placeholder, title, aria-label, etc.)
- Como texto directo en JSX (`<p>Texto</p>`, `<span>Texto</span>`)
- En variables de mensajes de error o estado
- En objetos de configuración como `TITLES`, `STATUS_LABELS`, arrays de columnas

No extraigas: nombres de clases CSS, valores de `key`, rutas URL, códigos de estado HTTP, nombres de campos de DB.

## 2. Lee el dict actual

Lee `apps/web-modern/src/lib/i18n.tsx` para:
- Ver qué claves ya existen y evitar duplicados
- Entender el prefijo de dominio correcto para el componente (ej: si el archivo es `WorkOrders.tsx`, el prefijo es `wo`)
- Ver la estructura del `dict` satisfies para agregar correctamente

## 3. Propone las claves

Para cada string encontrado, propone una clave con el formato `dominio.accion` o `dominio.campo`:
- Strings de navegación: `nav.*`
- Strings vacíos/empty state: `empty.*`
- Strings de columnas/labels del dominio: `{prefijo}.*`
- Strings de acciones: `{prefijo}.save`, `{prefijo}.cancel`, `{prefijo}.new`, etc.

Verifica que la clave no exista ya. Si existe una similar, reutilízala.

## 4. Inserta en el dict

En `apps/web-modern/src/lib/i18n.tsx`, agrega las nuevas claves en la sección correcta del `dict`, con las 3 traducciones (es, en, pt):
- `es`: el string original en español
- `en`: traducción al inglés (náutico/industrial si aplica)
- `pt`: traducción al portugués

Mantén el orden alfabético dentro de cada sección de dominio.

## 5. Modifica el componente

En el archivo `$ARGUMENTS`:
- Asegúrate de que se importe y use `useT` de `"../lib/i18n"` (ajusta la ruta relativa según la ubicación)
- Agrega `const t = useT();` al comienzo del componente si no existe
- Reemplaza cada string hardcodeado por `{t("clave.elegida")}` o `t("clave.elegida")` según el contexto JSX

## 6. Verifica

Corre:
```bash
npx tsc -p apps/web-modern/tsconfig.json --noEmit 2>&1 | grep "$(basename $ARGUMENTS .tsx)"
```

Si hay errores de tipo en las claves i18n (TranslationKey), es porque la clave no existe en el dict — corrígela.

## Reglas

- No tocar strings que ya usan `t("...")` — ya están internacionalizados
- No cambiar la lógica del componente, solo los strings
- Los 3 idiomas son obligatorios: es, en, pt
- Las claves deben ser descriptivas, no genéricas (`po.orderCode` mejor que `po.field1`)
- Si el componente usa `STATUS_LABELS` u objetos similares con strings, conviértelos a usar `t()`
