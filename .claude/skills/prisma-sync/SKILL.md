---
name: prisma-sync
description: Corre db push + prisma generate para sincronizar el schema con la base de datos. Úsalo después de modificar prisma/schema.prisma.
---

Sincroniza el schema de Prisma con la base de datos y regenera el cliente. Sigue estos pasos en orden:

## 1. Lee el .env

Lee el archivo `.env` en la raíz del proyecto para obtener `DATABASE_URL`.

## 2. Corre db push

```bash
DATABASE_URL="<valor del .env>" npx prisma db push --schema=prisma/schema.prisma
```

Si falla con un error de migración destructiva, muéstrale el error al usuario y pregunta si desea continuar con `--accept-data-loss`. NUNCA usar `--accept-data-loss` sin confirmación explícita.

## 3. Corre prisma generate

```bash
DATABASE_URL="<valor del .env>" npx prisma generate --schema=prisma/schema.prisma
```

## 4. Verifica errores de tipo relacionados con el schema

```bash
npx tsc -p apps/api/tsconfig.json --noEmit 2>&1 | grep -v "node_modules" | head -20
```

Muestra solo errores nuevos (ignora los errores pre-existentes en archivos que no tocaste).

## 5. Actualiza HISTORY.txt

Agrega una entrada breve en `HISTORY.txt` indicando qué cambios de schema se sincronizaron y la fecha actual.

## Reglas

- Siempre leer `.env` para el DATABASE_URL real, nunca hardcodearlo
- Si `db push` falla, detente y reporta el error sin intentar `--force` ni `--accept-data-loss`
- Si `generate` falla, muestra el error completo
- Reporta cuántas tablas/enums se crearon/modificaron según el output de Prisma
