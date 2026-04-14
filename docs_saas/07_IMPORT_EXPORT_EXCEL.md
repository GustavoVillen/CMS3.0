# File Purpose
Status: approved
Primary Owner: Data Operations Lead
Allowed Touchers:
- Data Operations Lead
- Architecture Lead
Source of Truth: yes
Depends On:
- docs_saas/04_ROLES_PERMISSIONS_AND_SCOPES.md
- docs_saas/05_DATA_MODEL_AND_AUDIT_RULES.md
Do Not Edit Without Reading:
- docs_saas/01_DECISION_LOG.md
Out of Scope:
- free-form column mapping and OCR import

# Import And Export Excel

## Import Modules In MVP

- vessels
- assets
- maintenance_plans
- spares
- providers
- certificates

## Matching Keys

- `vessels.code`
- `assets.sfiCode`
- `maintenance_plans.taskCode`
- `spares.sku`
- `providers.providerCode`
- `certificates.certificateCode`

## Import Behavior

- Import mode is `upsert`
- If key does not exist, create
- If key exists, update
- Do not duplicate
- If the same key appears twice inside the uploaded file, validation error
- If an existing record is absent from the file, ignore it
- Import does not delete or disable missing rows

## Soft Delete Import Rule

If import matches a soft-deleted record:
- do not restore automatically
- show conflict in preview
- allow explicit operator choice in preview to restore and update, or reject row

## Import Flow

1. Download official template
2. Upload `.xlsx`
3. Parse and validate
4. Show preview
5. Confirm execution
6. Run import
7. Return results report

## Preview Statuses

- `CREATE`
- `UPDATE`
- `ERROR`
- `CONFLICT_SOFT_DELETED`

## Import Permissions

- `tenant_admin`: all importable modules
- `maintenance_manager`: vessels, assets, maintenance_plans
- `procurement_store`: spares, providers
- `inspector_compliance`: certificates

## Export Permissions

- `tenant_admin`
- `maintenance_manager`
- `procurement_store`
- `inspector_compliance`
- `auditor_readonly`

## Fields Never Imported

- `tenant_id`
- traceability fields
- soft delete fields
- internal audit fields
- computed visible statuses
- AI-generated stored output fields

## Validation Rules

- required matching key present
- correct sheet/template structure
- no duplicate keys in uploaded file
- valid references inside same tenant
- valid data types
- no forbidden columns applied

## Export Rules

- export respects tenant
- export respects permissions and scopes
- export respects active filters
- export should be based on current filtered dataset when requested from a table

## Report Requirements

Import results must report:
- import job id
- tenant
- module
- actor user
- created rows
- updated rows
- rejected rows
- row-level errors
