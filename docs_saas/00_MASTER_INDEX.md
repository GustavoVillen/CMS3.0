# File Purpose
Status: approved
Primary Owner: Architecture Lead
Allowed Touchers:
- Architecture Lead
- Documentation Lead
Source of Truth: yes
Depends On:
- none
Do Not Edit Without Reading:
- docs_saas/01_DECISION_LOG.md
Out of Scope:
- legacy GAS implementation details beyond reference mapping

# Master Index

This folder is the only active documentation source of truth for the new SaaS build.

All new implementation work must follow this folder.

Legacy folders are read-only reference only:
- `_LEGACY_GPMS_Documentation_READ_ONLY/`
- `_LEGACY_pms-gas-webapp_READ_ONLY/`

Those legacy folders must never be modified by build agents.

## Active Documentation Order

1. `00_MASTER_INDEX.md`
2. `01_DECISION_LOG.md`
3. `02_PRODUCT_SCOPE.md`
4. `03_TENANCY_AUTH_AND_I18N.md`
5. `04_ROLES_PERMISSIONS_AND_SCOPES.md`
6. `05_DATA_MODEL_AND_AUDIT_RULES.md`
7. `06_MODULE_STATES_AND_TRANSITIONS.md`
8. `07_IMPORT_EXPORT_EXCEL.md`
9. `08_AI_ARCHITECTURE.md`
10. `09_AI_RULES_SKILLS_PROMPTS.md`
11. `10_AI_INSIGHTS_EVENTS_AND_THRESHOLDS.md`
12. `11_UI_UX_AND_DASHBOARD.md`
13. `12_IMPLEMENTATION_PLAN.md`
14. `13_AGENT_WORK_PROTOCOL.md`
15. `14_BLOCK_CHECKLISTS.md`
16. `15_REMINDER_LATER.md`
17. `16_AGENT_HANDOFF_TEMPLATE.md`

## Topic Ownership

| Topic | Source File |
|---|---|
| Product scope and MVP | `02_PRODUCT_SCOPE.md` |
| Tenant model, auth, locale, timezone, currency | `03_TENANCY_AUTH_AND_I18N.md` |
| Roles, permissions, scopes | `04_ROLES_PERMISSIONS_AND_SCOPES.md` |
| Data model rules, audit, traceability, soft delete | `05_DATA_MODEL_AND_AUDIT_RULES.md` |
| Module states and transitions | `06_MODULE_STATES_AND_TRANSITIONS.md` |
| Excel import/export | `07_IMPORT_EXPORT_EXCEL.md` |
| AI architecture | `08_AI_ARCHITECTURE.md` |
| AI rules, skills, prompts | `09_AI_RULES_SKILLS_PROMPTS.md` |
| AI insights, events, thresholds | `10_AI_INSIGHTS_EVENTS_AND_THRESHOLDS.md` |
| UX, dashboard, multiwindow routing | `11_UI_UX_AND_DASHBOARD.md` |
| Delivery phases and build blocks | `12_IMPLEMENTATION_PLAN.md` |
| Agent protocol | `13_AGENT_WORK_PROTOCOL.md` |
| Block checklists | `14_BLOCK_CHECKLISTS.md` |
| Deferred work | `15_REMINDER_LATER.md` |
| Agent handoff prompt | `16_AGENT_HANDOFF_TEMPLATE.md` |

## Allowed Paths For New Build

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

If a path is not listed above, an agent must not create or modify it unless an explicit decision is recorded in `01_DECISION_LOG.md`.

## Forbidden Paths For New Build

- `_LEGACY_GPMS_Documentation_READ_ONLY/**`
- `_LEGACY_pms-gas-webapp_READ_ONLY/**`
- any new work inside legacy folders

Legacy folders may only be read when a task explicitly requires legacy reference mapping.

## Required Reading Before Any Block

Every agent must read:
- `00_MASTER_INDEX.md`
- `01_DECISION_LOG.md`
- latest relevant entries in `HISTORY.txt`
- the target block file
- all files listed in the target file `Depends On` section

## Change Safety Rules

- Do not reopen a closed decision unless the user explicitly requests it.
- Do not move decisions from one file to another without updating this index.
- Do not use legacy names as product names in new documentation.
- Do not treat AI insight visibility as record access.
- Do not mix tenant data, documents, prompts, or insights.
- Do not skip updating `HISTORY.txt` after a completed block or meaningful terminal/build milestone.

## Documentation Status Meanings

- `draft`: open for editing
- `in_review`: pending cross-file consistency check
- `approved`: safe to implement against

## Build Gate

Code implementation for a block may start only when:
- the source file for that block is `approved`
- its dependencies are `approved`
- there are no unresolved blocking items in that block file
