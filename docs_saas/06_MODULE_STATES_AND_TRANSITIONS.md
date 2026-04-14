# File Purpose
Status: approved
Primary Owner: Business Rules Lead
Allowed Touchers:
- Business Rules Lead
- Architecture Lead
Source of Truth: yes
Depends On:
- docs_saas/04_ROLES_PERMISSIONS_AND_SCOPES.md
- docs_saas/05_DATA_MODEL_AND_AUDIT_RULES.md
Do Not Edit Without Reading:
- docs_saas/01_DECISION_LOG.md
Out of Scope:
- UI wording for visible statuses

# Module States And Transitions

## Work Orders

### States
- `PLANNED`
- `IN_PROGRESS`
- `ON_HOLD`
- `DEFERRED`
- `CLOSED`
- `CANCELLED`

### Allowed Transitions
- `PLANNED -> IN_PROGRESS`
- `PLANNED -> ON_HOLD`
- `PLANNED -> DEFERRED`
- `PLANNED -> CANCELLED`
- `IN_PROGRESS -> ON_HOLD`
- `IN_PROGRESS -> DEFERRED`
- `IN_PROGRESS -> CLOSED`
- `IN_PROGRESS -> CANCELLED`
- `ON_HOLD -> IN_PROGRESS`
- `ON_HOLD -> DEFERRED`
- `ON_HOLD -> CANCELLED`
- `DEFERRED -> PLANNED`
- `DEFERRED -> IN_PROGRESS`
- `DEFERRED -> CANCELLED`

### Hard Rules
- `PLANNED -> CLOSED` is forbidden
- `DEFERRED` requires active deferral
- `ON_HOLD` requires hold reason
- `CANCELLED` requires cancel reason
- closing critical work order requires test result, independent verifier, and evidence
- `CLOSED` and `CANCELLED` are terminal

## Defects

### States
- `OPEN`
- `UNDER_REVIEW`
- `IN_PROGRESS`
- `DEFERRED`
- `RESOLVED`
- `CLOSED`

### Allowed Transitions
- `OPEN -> UNDER_REVIEW`
- `OPEN -> IN_PROGRESS`
- `OPEN -> DEFERRED`
- `UNDER_REVIEW -> IN_PROGRESS`
- `UNDER_REVIEW -> DEFERRED`
- `IN_PROGRESS -> RESOLVED`
- `IN_PROGRESS -> DEFERRED`
- `DEFERRED -> IN_PROGRESS`
- `DEFERRED -> RESOLVED`
- `RESOLVED -> CLOSED`

### Hard Rules
- `OPEN -> CLOSED` is forbidden
- `DEFERRED` requires active deferral
- `RESOLVED` requires corrective action captured
- `CLOSED` is terminal

## Deferrals

### States
- `REQUESTED`
- `UNDER_REVIEW`
- `APPROVED`
- `REJECTED`
- `ACTIVE`
- `EXPIRED`
- `CLOSED`

### Allowed Transitions
- `REQUESTED -> UNDER_REVIEW`
- `REQUESTED -> APPROVED`
- `REQUESTED -> REJECTED`
- `UNDER_REVIEW -> APPROVED`
- `UNDER_REVIEW -> REJECTED`
- `APPROVED -> ACTIVE`
- `ACTIVE -> EXPIRED`
- `ACTIVE -> CLOSED`
- `EXPIRED -> CLOSED`

### Hard Rules
- `ACTIVE` requires target date and justification
- compensatory measures are required when applicable
- `maintenance_manager` and `tenant_admin` may approve or reject in MVP
- `REJECTED`, `CLOSED` are terminal

## Daily Reports

### States
- `DRAFT`
- `SUBMITTED`
- `REVIEWED`
- `CLOSED`

### Allowed Transitions
- `DRAFT -> SUBMITTED`
- `SUBMITTED -> REVIEWED`
- `REVIEWED -> CLOSED`

### Hard Rules
- one report per vessel per day
- crew emits the report
- location should be captured automatically when available
- AI may assist, but may not submit or close automatically

## Certificates

### States
- `ACTIVE`
- `EXPIRING_SOON`
- `EXPIRED`
- `SUSPENDED`
- `CLOSED`

### Rules
- `EXPIRING_SOON` starts at 30 days before expiry in MVP
- `EXPIRING_SOON` and `EXPIRED` are computed states
- `expiry_date` is mandatory
- `CLOSED` is terminal

## Spare Orders

### States
- `DRAFT`
- `REQUESTED`
- `APPROVED`
- `ORDERED`
- `PARTIALLY_RECEIVED`
- `RECEIVED`
- `CANCELLED`

### Allowed Transitions
- `DRAFT -> REQUESTED`
- `REQUESTED -> APPROVED`
- `REQUESTED -> CANCELLED`
- `APPROVED -> ORDERED`
- `APPROVED -> CANCELLED`
- `ORDERED -> PARTIALLY_RECEIVED`
- `ORDERED -> RECEIVED`
- `ORDERED -> CANCELLED`
- `PARTIALLY_RECEIVED -> RECEIVED`
- `PARTIALLY_RECEIVED -> CANCELLED`

### Hard Rules
- receiving impacts stock
- `PARTIALLY_RECEIVED` supports cumulative quantity reception
- `RECEIVED` and `CANCELLED` are terminal

## RCA

### States
- `DRAFT`
- `UNDER_ANALYSIS`
- `COMPLETED`
- `APPROVED`
- `CLOSED`

### Allowed Transitions
- `DRAFT -> UNDER_ANALYSIS`
- `UNDER_ANALYSIS -> COMPLETED`
- `COMPLETED -> APPROVED`
- `APPROVED -> CLOSED`

### Hard Rules
- `COMPLETED` requires methodology, immediate cause, contributing cause, and root cause
- `APPROVED` requires human review
- `CLOSED` is terminal

## CAPA

### States
- `OPEN`
- `IN_PROGRESS`
- `PENDING_VERIFICATION`
- `CLOSED`
- `CANCELLED`

### Computed State
- `OVERDUE`

### Allowed Transitions
- `OPEN -> IN_PROGRESS`
- `OPEN -> CANCELLED`
- `IN_PROGRESS -> PENDING_VERIFICATION`
- `IN_PROGRESS -> CANCELLED`
- `PENDING_VERIFICATION -> CLOSED`
- `PENDING_VERIFICATION -> IN_PROGRESS`

### Hard Rules
- `CLOSED` requires verification note or evidence
- `CANCELLED` requires reason
- `OVERDUE` is computed when due date is passed and state is not terminal

## State Change Audit Rule

Every state transition above must generate:
- audit event
- domain event
- record `updated_by_user_id`
