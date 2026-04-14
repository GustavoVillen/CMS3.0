# File Purpose
Status: approved
Primary Owner: Delivery Lead
Allowed Touchers:
- Delivery Lead
- Architecture Lead
Source of Truth: yes
Depends On:
- docs_saas/02_PRODUCT_SCOPE.md
- docs_saas/03_TENANCY_AUTH_AND_I18N.md
- docs_saas/04_ROLES_PERMISSIONS_AND_SCOPES.md
- docs_saas/05_DATA_MODEL_AND_AUDIT_RULES.md
- docs_saas/06_MODULE_STATES_AND_TRANSITIONS.md
- docs_saas/07_IMPORT_EXPORT_EXCEL.md
- docs_saas/08_AI_ARCHITECTURE.md
- docs_saas/09_AI_RULES_SKILLS_PROMPTS.md
- docs_saas/10_AI_INSIGHTS_EVENTS_AND_THRESHOLDS.md
- docs_saas/11_UI_UX_AND_DASHBOARD.md
Do Not Edit Without Reading:
- docs_saas/13_AGENT_WORK_PROTOCOL.md
- docs_saas/14_BLOCK_CHECKLISTS.md
Out of Scope:
- sprint estimates as contractual dates

# Implementation Plan

## Delivery Principle

Build in blocks with clear ownership and explicit dependencies.

No block should start coding before its source documentation and dependencies are approved.

## Suggested Build Blocks

### Block 01: Documentation Foundation
- create source-of-truth docs
- finalize decision map
- freeze legacy paths as read-only

### Block 02: Tenancy, Auth, I18n
- tenant resolution
- platform and tenant auth split
- session locale
- tenant settings bootstrap

### Block 03: Roles, Permissions, Scopes
- role model
- vessel scope model
- guards and permission checks

### Block 04: Data Model Core
- tenant-scoped operational entities
- traceability fields
- soft delete model
- append-only event and audit tables

### Block 05: Core Functional Modules
- vessels
- assets
- maintenance plans
- work orders
- defects
- deferrals
- RCA/CAPA

### Block 06: Compliance And Operations
- inspections
- certificates
- daily reports

### Block 07: Procurement And Stock
- spares
- stock movements
- providers
- spare orders

### Block 08: Excel Import Export
- templates
- preview flow
- import jobs
- export datasets

### Block 09: AI Documents And Prompt Governance
- tenant AI documents
- document versions and activation
- global prompts by capability and locale

### Block 10: AI Runtime, Insights, And Dashboard
- copiloto runtime
- background event processing
- insights panel
- cross-vessel tenant insight logic

## Block Dependency Order

`01 -> 02 -> 03 -> 04 -> 05 -> 06/07 -> 08 -> 09 -> 10`

## Mandatory Rule

Every block must finish with:
- updated documentation status
- checklist completion
- explicit list of touched files
- unresolved items section if needed
