# File Purpose
Status: approved
Primary Owner: Product Lead
Allowed Touchers:
- Product Lead
- Architecture Lead
Source of Truth: yes
Depends On:
- docs_saas/00_MASTER_INDEX.md
- docs_saas/01_DECISION_LOG.md
Do Not Edit Without Reading:
- docs_saas/01_DECISION_LOG.md
Out of Scope:
- billing, custom domains, multi-role users

# Product Scope

## Product Goal

Build a multi-tenant SaaS PMS for vessels and technical assets, with strong maintenance traceability, controlled workflows, AI copilot capabilities, documentation management, operational reporting, and audit readiness.

## MVP Core Characteristics

- Multi-tenant SaaS
- Separate superadmin control plane
- Tenant-specific branding and locale configuration
- One user belongs to one tenant only in MVP
- One role per user in MVP
- Scope-based access by assigned vessels
- AI copiloto available across the product
- AI insights in dashboard
- Excel import/export for selected modules
- Browser multiwindow by URL only

## In Scope For MVP

- Tenant management by superadmin
- Tenant branding and operational settings
- Auth, invitation flow, password reset
- Fleet and asset master data
- Maintenance plans
- Work orders
- Defects
- Deferrals
- RCA and CAPA
- Spares and spare orders
- Providers
- Inspections and certificates
- Daily reports
- Attachments and AI documents
- AI copiloto, AI document retrieval, AI insights
- Excel import/export for selected modules

## Explicitly Out Of Scope For MVP

- Billing and self-service subscriptions
- Custom tenant domains
- Public signup
- Multi-role per user
- Multiple tenants per user
- Fully custom tenant UI themes
- Autonomous AI writes without human confirmation
- AI prompt overrides per tenant
- Advanced OCR, SSO, MFA, microservices

## Product Naming Rules

- Do not reuse legacy product naming in new active documentation.
- Legacy names may appear only in migration notes.

## AI Product Role

The AI is part of the product core, not a side module.

It must support:
- technical assistance
- document-grounded answers
- contextual copiloto behavior in workflows
- structured prefill suggestions with preview
- background trend analysis and insights

It must not:
- write final data without confirmation
- mix tenants
- bypass permissions

## Operational Philosophy

- Human-controlled workflows
- Strong traceability
- Tenant isolation
- Long-term maintenance history preservation
- Support for fleet-level insights within the same tenant
- Extension path to telemetry, IoT, and remote monitoring
