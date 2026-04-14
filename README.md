# SaaS Build Workspace

This repository now contains two clearly separated worlds:

- Active SaaS build source of truth in `docs_saas/`, `apps/`, `packages/`, `prisma/`, and `infra/`
- Legacy read-only reference material in `_LEGACY_*_READ_ONLY/`

Before any implementation work, read:

1. `docs_saas/00_MASTER_INDEX.md`
2. `docs_saas/01_DECISION_LOG.md`
3. `docs_saas/13_AGENT_WORK_PROTOCOL.md`

Do not create new implementation files inside legacy folders.

Default local API port for this project:
- `3105`
