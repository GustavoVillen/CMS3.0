# File Purpose
Status: approved
Primary Owner: Architecture Lead
Allowed Touchers:
- Architecture Lead
- Documentation Lead
Source of Truth: yes
Depends On:
- docs_saas/00_MASTER_INDEX.md
Do Not Edit Without Reading:
- docs_saas/00_MASTER_INDEX.md
Out of Scope:
- implementation details not yet decided

# Decision Log

Use this file as the canonical list of closed product and architecture decisions.

## Decision Format

| ID | Status | Decision | Impacted Files |
|---|---|---|---|

## Closed Decisions

| D-001 | closed | SaaS architecture with superadmin and multiple tenants | `02`, `03`, `04`, `05`, `08`, `12` |
| D-002 | closed | One tenant-scoped user belongs to one tenant only in MVP | `03`, `04`, `05` |
| D-003 | closed | Tenant resolution uses subdomain in production and path only in dev | `03`, `11`, `12`, `13` |
| D-004 | closed | Superadmin lives under separate `admin.` host | `03`, `12` |
| D-005 | closed | Login final model is email, with temporary legacy `USER_ID` support during migration | `03`, `12` |
| D-006 | closed | User creation is invitation-only in MVP | `03`, `04`, `12` |
| D-007 | closed | Password reset by email is included in MVP | `03`, `12` |
| D-008 | closed | Mandatory email verification is deferred | `15` |
| D-009 | closed | Email is globally unique | `03`, `05` |
| D-010 | closed | Tenant branding is minimal in MVP: `display_name`, `logo_url`, `primary_color`, `support_email` | `02`, `03`, `11` |
| D-011 | closed | Billing is out of MVP | `02`, `12`, `15` |
| D-012 | closed | Supported locales are `es`, `en`, `pt` | `03`, `08`, `09`, `11` |
| D-013 | closed | Tenant config includes `default_locale`, `enabled_locales`, `timezone`, `currency` | `03`, `05`, `08`, `11` |
| D-014 | closed | Header locale selector changes active user session locale | `03`, `11` |
| D-015 | closed | Global product accent color is `#EAB308` | `11` |
| D-016 | closed | Multiwindow in MVP is via browser tabs/windows and URL-based routing only | `02`, `11` |
| D-017 | closed | Every tenant has its own AI document base and AI context | `08`, `09`, `10` |
| D-018 | closed | AI must never mix information across tenants | `08`, `09`, `10`, `13` |
| D-019 | closed | AI answers in question language if enabled for tenant, else tenant default locale | `08`, `09` |
| D-020 | closed | Tenant admin can upload, version, and activate tenant AI documents in MVP | `04`, `08`, `09` |
| D-021 | closed | Superadmin manages prompts globally for all tenants | `08`, `09` |
| D-022 | closed | Prompts are global, versioned, per capability and locale | `09` |
| D-023 | closed | Prompts are configurable, but runtime guardrails remain immutable | `09` |
| D-024 | closed | AI acts as copiloto, not autonomous operator | `08`, `09`, `10` |
| D-025 | closed | AI can prefill forms but only with preview and explicit user confirmation | `08`, `09` |
| D-026 | closed | AI ad hoc files are temporary by default and only persist when explicitly published | `08` |
| D-027 | closed | Dashboard must include persistent AI Insights panel, not autonomous chat loop | `10`, `11` |
| D-028 | closed | AI can analyze events and trends in the PMS using event-driven background processing | `08`, `10` |
| D-029 | closed | Daily reports are one per vessel per day | `05`, `06` |
| D-030 | closed | Daily reports are emitted by crew and include auto position, hours, consumptions, and future telemetry extension path | `06`, `08` |
| D-031 | closed | Import/export Excel exists in MVP | `07` |
| D-032 | closed | Import Excel in MVP only for `vessels`, `assets`, `maintenance_plans`, `spares`, `providers`, `certificates` | `07` |
| D-033 | closed | Import behavior is upsert without duplication | `07` |
| D-034 | closed | Missing rows in import file are ignored, not deleted or disabled | `07` |
| D-035 | closed | Every tenant-scoped operational record includes traceability for create and update user | `05` |
| D-036 | closed | Soft delete applies to most operational tenant-scoped tables | `05`, `04` |
| D-037 | closed | Only tenant admin can restore soft-deleted records in MVP | `04`, `05` |
| D-038 | closed | Cross-vessel AI insights inside same tenant may mention other vessels even if user lacks direct record access | `08`, `10`, `11` |
| D-039 | closed | Cross-vessel insight visibility does not imply record access | `08`, `10`, `13` |
| D-040 | closed | Superintendente maps to role `maintenance_manager` and may have one or multiple assigned vessels | `04` |
| D-041 | closed | Capitan and Jefe de Maquinas are treated the same in MVP under `technician_operator` | `04` |
| D-042 | closed | Each tenant-scoped user has exactly one role in MVP | `04`, `05` |

## Change Control

- New decisions must be appended, never silently overwrite old ones.
- If a closed decision changes, add a new decision row superseding the older one.
- Any file changed due to a decision update must be listed in the `Impacted Files` column.
