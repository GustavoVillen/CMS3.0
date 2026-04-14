# File Purpose
Status: approved
Primary Owner: Delivery Lead
Allowed Touchers:
- Delivery Lead
- Architecture Lead
Source of Truth: yes
Depends On:
- docs_saas/00_MASTER_INDEX.md
- docs_saas/13_AGENT_WORK_PROTOCOL.md
- docs_saas/14_BLOCK_CHECKLISTS.md
Do Not Edit Without Reading:
- docs_saas/01_DECISION_LOG.md
Out of Scope:
- project decisions; this file is a handoff prompt template

# Agent Handoff Template

Use the following handoff prompt when asking another agent to continue the build.

## Short Handoff Prompt

```text
Continue the build in C:\NPMS\GPMS following the active source of truth only.

Mandatory reading order:
1. docs_saas/00_MASTER_INDEX.md
2. docs_saas/01_DECISION_LOG.md
3. latest relevant HISTORY.txt entries
4. the block file you are implementing
5. every file listed in that block's Depends On section

Rules:
- Work only in allowed paths from docs_saas/00_MASTER_INDEX.md and docs_saas/13_AGENT_WORK_PROTOCOL.md
- Never modify anything under _LEGACY_*_READ_ONLY
- Do not reopen closed decisions
- Do not silently redesign upstream rules
- Append a new entry to HISTORY.txt when you finish the block or make a meaningful runtime/build change
- Keep tenant isolation, AI safety rules, and cross-vessel insight rules intact

Current block to continue:
<PUT BLOCK NAME HERE>

Current goal:
<PUT CONCRETE GOAL HERE>

Definition of done:
<PUT BLOCK-SPECIFIC DONE CRITERIA HERE>
```

## Stronger Handoff Prompt

```text
You are continuing an in-progress SaaS build in C:\NPMS\GPMS.

You must follow these files as source of truth:
- docs_saas/00_MASTER_INDEX.md
- docs_saas/01_DECISION_LOG.md
- docs_saas/13_AGENT_WORK_PROTOCOL.md
- docs_saas/14_BLOCK_CHECKLISTS.md
- HISTORY.txt

Before editing anything:
- read the files above
- read the target block document and all its dependencies

Allowed paths:
- docs_saas/**
- apps/**
- packages/**
- prisma/**
- infra/**
- HISTORY.txt
- root config files explicitly allowed in the protocol

Forbidden paths:
- _LEGACY_GPMS_Documentation_READ_ONLY/**
- _LEGACY_pms-gas-webapp_READ_ONLY/**

Execution rules:
- do not modify legacy folders
- do not overwrite another block's decisions
- if you detect a contradiction, stop and record it as an Open Issue instead of guessing
- if you change runtime behavior, infrastructure, endpoints, workflow, or build state, append a timestamped note to HISTORY.txt

Block to continue:
<PUT BLOCK NAME HERE>

Files you are expected to touch:
<PUT EXPECTED FILES HERE>

Files you must not touch unless absolutely required:
<PUT EXCLUDED FILES HERE>

Deliverable:
- complete the block
- verify it
- update HISTORY.txt
- report touched files, validation performed, and any open issue
```

## Recommended Usage Pattern

When handing off a block, provide:
- exact block name
- exact goal
- exact files expected to change
- exact validation expected
- explicit reminder to update `HISTORY.txt`

## Example

```text
Continue Block: Work Orders Demo Runtime

Goal:
Implement tenant-scoped demo work order dataset and expose authenticated `GET /app/work-orders` in localhost dev runtime.

Expected files:
- apps/api/src/platform/data/dev-domain-store.ts
- apps/api/src/tenant/work-orders/work-orders-service.ts
- apps/api/src/server.ts
- apps/api/src/platform/home/home-page.ts
- HISTORY.txt

Validation required:
- pnpm --filter @pms-saas/api typecheck
- pnpm --filter @pms-saas/api build
- login tenant demo and call GET /app/work-orders?tenant=demo successfully
- append HISTORY.txt entry with timestamp and result
```
