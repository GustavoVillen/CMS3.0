# File Purpose
Status: approved
Primary Owner: Security Lead
Allowed Touchers:
- Security Lead
- Architecture Lead
Source of Truth: yes
Depends On:
- docs_saas/03_TENANCY_AUTH_AND_I18N.md
Do Not Edit Without Reading:
- docs_saas/01_DECISION_LOG.md
- docs_saas/05_DATA_MODEL_AND_AUDIT_RULES.md
Out of Scope:
- multi-role users

# Roles, Permissions, And Scopes

## Roles

### Platform Role
- `superadmin`

### Tenant Roles
- `tenant_admin`
- `maintenance_manager`
- `technician_operator`
- `inspector_compliance`
- `procurement_store`
- `auditor_readonly`

## Operational Mapping

- `maintenance_manager`: Superintendente
- `technician_operator`: operativo embarcado; includes Capitan and Jefe de Maquinas in MVP

## Scope Model

- Primary scope dimension in MVP: assigned vessels
- A user may have one or many assigned vessels
- Scope filters access within the tenant

## Role Intent

### tenant_admin
- Tenant-level administration
- User invitations
- Role assignment
- Tenant settings
- Broad data control
- AI document management

### maintenance_manager
- Technical supervision
- Maintenance decisions
- One or many assigned vessels
- Review and approval authority for technical flows

### technician_operator
- Operational data entry
- Crew-issued reports
- Execution updates in assigned vessels
- AI copiloto usage

### inspector_compliance
- Inspections and certificates
- Compliance visibility

### procurement_store
- Spares, stock, providers, spare orders

### auditor_readonly
- Read and export only

## Sensitive Permissions

### Deferral Approval
- `maintenance_manager`: yes
- `tenant_admin`: yes

### Close Critical Work Orders
- `maintenance_manager`: yes
- `tenant_admin`: yes
- `technician_operator`: no

### Excel Import In MVP
- `tenant_admin`: all supported modules
- `maintenance_manager`: `vessels`, `assets`, `maintenance_plans`
- `procurement_store`: `spares`, `providers`
- `inspector_compliance`: `certificates`

### Excel Export In MVP
- `tenant_admin`
- `maintenance_manager`
- `procurement_store`
- `inspector_compliance`
- `auditor_readonly`

### AI Document Management
- `tenant_admin`: yes
- all others: no

### Prompt Management
- `superadmin` only

### Soft Delete
- `tenant_admin`: broad operational delete rights
- `maintenance_manager`: technical modules only
- all others: no

### Restore Soft Delete
- `tenant_admin` only

## Cross-Vessel Insight Rule

AI may mention other vessels from the same tenant in insights even without direct record access.

This does not grant access to those vessels' records.
