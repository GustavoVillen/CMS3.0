# File Purpose
Status: approved
Primary Owner: Delivery Lead
Allowed Touchers:
- Delivery Lead
- Architecture Lead
Source of Truth: yes
Depends On:
- docs_saas/00_MASTER_INDEX.md
- docs_saas/12_IMPLEMENTATION_PLAN.md
Do Not Edit Without Reading:
- docs_saas/14_BLOCK_CHECKLISTS.md
Out of Scope:
- product decisions; this file governs execution behavior

# Agent Work Protocol

## Mandatory Read Before Starting Any Block

Every agent must read:
- `docs_saas/00_MASTER_INDEX.md`
- `docs_saas/01_DECISION_LOG.md`
- latest relevant entries in `HISTORY.txt`
- the block source file
- all dependency files listed in that source file

## Allowed Paths

- `docs_saas/**`
- `apps/**`
- `packages/**`
- `prisma/**`
- `infra/**`
- `HISTORY.txt`
- `README.md`
- `.env`
- `.env.example`
- `package.json`
- `pnpm-workspace.yaml`
- `tsconfig.base.json`

## Forbidden Paths

- `_LEGACY_GPMS_Documentation_READ_ONLY/**`
- `_LEGACY_pms-gas-webapp_READ_ONLY/**`
- any path not listed in allowed paths unless explicitly approved in decision log

## Legacy Folder Rule

Legacy folders are read-only reference only.

Agents may read them only when a task explicitly requires migration mapping or legacy behavior confirmation.

Agents must never modify legacy folders.

## Block Ownership Rule

Each block should have one primary owner agent at a time.

If another agent must touch the same file, the overlap must be explicit in the file `Allowed Touchers` header.

## No Silent Redesign Rule

If an agent finds a contradiction with a closed decision:
- do not silently redesign
- do not edit upstream docs by intuition
- add an `Open Issues` section in the working file
- stop and escalate the contradiction

## Touched File Rule

At the end of a block, the agent must report:
- files created
- files modified
- files intentionally not touched

## History Logging Rule

`HISTORY.txt` is mandatory shared execution memory for multi-agent and multi-day work.

Every agent must:
- read the latest relevant entries before starting a block
- append a concise but concrete history entry after finishing a block or important runtime/build change
- include:
  - timestamp
  - block name
  - major changes introduced
  - validation performed
  - current result or open issue

Agents must not delete prior history entries.
Agents may correct factual mistakes only by appending a newer correction entry.

## AI Safety Rule For Agents

Agents working on AI-related blocks must preserve:
- tenant isolation
- prompt governance
- no autonomous writes
- cross-vessel insight summary rule
- `insight visibility != record access`

## Completion Rule

No block is complete until the corresponding checklist in `14_BLOCK_CHECKLISTS.md` is marked complete.

No block is complete until `HISTORY.txt` has been updated if the block changed code, runtime behavior, local infrastructure, or developer workflow.
