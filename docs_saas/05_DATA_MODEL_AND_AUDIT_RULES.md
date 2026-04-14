# File Purpose
Status: approved
Primary Owner: Data Lead
Allowed Touchers:
- Data Lead
- Architecture Lead
Source of Truth: yes
Depends On:
- docs_saas/03_TENANCY_AUTH_AND_I18N.md
- docs_saas/04_ROLES_PERMISSIONS_AND_SCOPES.md
Do Not Edit Without Reading:
- docs_saas/01_DECISION_LOG.md
Out of Scope:
- final Prisma syntax; this file defines rules, not generated schema

# Data Model And Audit Rules

## Core Multi-Tenant Rule

Every operational tenant-scoped table must carry `tenant_id`.

No operational query may execute without tenant filtering.

## Record Traceability Rule

Every operational tenant-scoped record must include:
- `created_at`
- `created_by_user_id`
- `updated_at`
- `updated_by_user_id`

If a system action changes a record:
- `updated_by_user_id` may be `null`
- audit trail must record `SYSTEM`

## Soft Delete Rule

Operational tables generally use:
- `deleted_at`
- `deleted_by_user_id`

Soft-deleted records:
- are hidden by default
- remain historically traceable
- are restorable only by tenant admin in MVP

## Tables That Use Soft Delete

- vessels
- assets
- maintenance_plans
- work_orders
- defects
- deferrals
- rca_records
- capa_records
- spares
- spare_orders
- providers
- provider_evaluations
- provider_nonconformities
- inspections
- certificates
- daily_reports
- attachments
- tenant_documents
- tenant_document_versions

## Tables That Must Be Append-Only Or Historical

- audit_events
- domain_events
- ai_usage_logs
- ai_messages
- stock_movements
- inspection_logs
- platform_sessions
- refresh_tokens

## Historical Preservation Rule

The system must preserve long-term history for vessel equipment and failure analysis.

This is required because defects and maintenance patterns may span years, not only weeks or months.

## Asset Identity Rule

Assets should be designed with strong long-term identity where possible, including support for:
- asset code
- SFI code
- serial number
- manufacturer
- model
- installation date
- last overhaul date
- replacement date

## Daily Report Growth Rule

Daily reports must support:
- human-entered operational fields
- position metadata
- engine and generator hours
- fuel and oil consumption
- extension path to telemetry snapshots and IoT integrations

## Audit Rule

Important operations must write both:
- record-level traceability fields
- append-only audit events

## AI Context Rule

AI must ignore soft-deleted operational records by default in MVP.

## Cross-Tenant Safety Rule

Data, documents, prompts, embeddings, events, and insights must never be mixed across tenants.
