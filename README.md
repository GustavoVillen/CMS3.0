# CMS3.0 — PMS marítimo multiempresa

Sistema de mantenimiento planificado para flotas. Multitenant: varias empresas navieras
en la misma base, cada una con sus buques, su tripulación, su idioma y sus permisos.

Las reglas de negocio y las convenciones del proyecto están en **[CLAUDE.md](CLAUDE.md)**.
El historial de cambios funcionales está en **[HISTORY.txt](HISTORY.txt)**.

## Mapa del repositorio

| Carpeta | Qué contiene |
|---|---|
| `apps/api/` | Backend TypeScript sobre `node:http` puro. Entrada: `src/server.ts` |
| `apps/web-modern/` | Frontend React 19 + Vite + Tailwind 4 + react-router 7 |
| `packages/` | `shared-types`, `config` e `i18n` compartidos entre api y web |
| `prisma/` | `schema.prisma` (~94 modelos), migraciones y seed |
| `scripts/` | Scripts `tsx`/`python` de carga y migración de datos reales |
| `infra/` | `docker-compose.yml` de Postgres para desarrollo |
| `claude/plans/` | `CONTEXTO.md`: memoria viva del trabajo en curso |
| `.claude/skills/` | Skills del proyecto para Claude Code |

Fuera de git (ver `.gitignore`): `MisDocs/` (documentos y planillas reales de la flota),
`Pass/` (datos de acceso), `generated/` (cliente Prisma), `node_modules/`.

## Puesta en marcha

```bash
pnpm install
pnpm db:up            # Postgres en Docker
pnpm prisma:generate
pnpm db:push
pnpm db:seed
```

## Desarrollo

```bash
pnpm dev:api          # API
pnpm dev:web-modern   # Frontend en http://localhost:5174
```

Puertos locales: **web 5174 → api 3106**. El `PORT` sale del `.env`; el proxy de Vite
(`apps/web-modern/vite.config.ts`) apunta a 3106. Si cambiás uno, cambiá el otro.

## Verificación

```bash
pnpm --filter @cms3/api typecheck
pnpm --filter web-modern typecheck
```

`npx tsc --noEmit` en la raíz **no chequea el frontend**: usá el comando con `--filter`.
