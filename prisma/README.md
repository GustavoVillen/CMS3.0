# Prisma — modelo de datos

`schema.prisma` es un único archivo con ~94 modelos. Postgres + Prisma 7 con
`@prisma/adapter-pg`.

| Archivo | Qué es |
|---|---|
| `schema.prisma` | El modelo completo |
| `migrations/` | Migraciones aplicadas |
| `seed.ts` | Seed base (`pnpm db:seed`) |
| `seed-latere-motor.ts` | Seed puntual del motor del LA TERE |

Los seeds de tripulación / CEOP viven en `apps/api/prisma/seeds/`.

## Antes de tocar el schema

Leer la sección 6 de [CLAUDE.md](../CLAUDE.md). En resumen:

- Revisar entidades y relaciones existentes: mucho ya está modelado.
- No agregar campos redundantes si el dato puede derivarse.
- No borrar campos ni cambiar semántica sin revisar impacto en backend, frontend y
  en los datos productivos ya cargados.

Después del cambio:

```bash
pnpm db:push
pnpm prisma:generate
```
