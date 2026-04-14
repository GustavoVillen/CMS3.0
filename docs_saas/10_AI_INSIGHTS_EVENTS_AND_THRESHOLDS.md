# File Purpose
Status: approved
Primary Owner: AI Insights Lead
Allowed Touchers:
- AI Insights Lead
- AI Lead
- Architecture Lead
Source of Truth: yes
Depends On:
- docs_saas/08_AI_ARCHITECTURE.md
- docs_saas/09_AI_RULES_SKILLS_PROMPTS.md
Do Not Edit Without Reading:
- docs_saas/01_DECISION_LOG.md
Out of Scope:
- exact SQL or job scheduler implementation

# AI Insights, Events, And Thresholds

## Core Objects

### domain_events
Append-only event stream of relevant PMS activity.

### ai_insights
Curated actionable suggestions for dashboard and contextual copiloto panels.

## Event Categories

- master data
- maintenance
- operations
- compliance
- stock
- procurement
- document
- AI
- import/export
- security

## Required Event Rule

Every event must include `tenant_id`.

If a candidate event has no tenant id, it must not enter the insight pipeline.

## Insight Display Rule

Dashboard displays a fixed `AI Insights` panel.

This panel is not an autonomous speaking chat.

It is a prioritized feed of open insights.

## Cross-Vessel Insight Rule

Inside the same tenant, AI may mention other vessels in insights even if the viewer does not have direct record access to those vessels.

This is limited to:
- vessel name
- type of finding
- general recommendation

This does not allow opening protected records.

## Insight Types

- `backlog_risk`
- `repeated_failure`
- `repeated_deferral`
- `pm_frequency_review`
- `stock_below_minimum`
- `stock_below_reorder_point`
- `certificate_expiring`
- `certificate_expired`
- `inspection_failure_pattern`
- `overdue_capa`
- `overdue_work_order`
- `documentation_gap`
- `operational_anomaly`
- `recurring_asset_downtime`
- `trend_based_maintenance_improvement`
- `cross_vessel_spare_availability`
- `fleet_repeated_failure_pattern`
- `fleet_known_fix_suggestion`
- `fleet_shared_operational_experience`

## Standard Time Windows

- 7 days for recent signals
- 30 days for tactical operations
- 90 days for short trend recurrence
- 180 days for maintenance historical review
- 365 plus days for long reliability analysis where relevant

## Thresholds

### repeated_failure
- 3 defects on same asset in 90 days, or
- 2 similar defects on same asset in 30 days, or
- 2 closed work orders plus a new similar failure in 45 days

### repeated_deferral
- 2 deferrals on same asset or task in 90 days, or
- active deferral plus new request on same asset or task in 60 days

### backlog_risk
- more than 5 overdue open work orders on a vessel, or
- more than 20 percent of open work orders overdue, or
- preventive backlog grows more than 25 percent versus prior 30-day window

### overdue_work_order
- more than 3 days overdue, or 1 day for critical asset work order

### pm_frequency_review
- 2 or more related corrective work orders in 180 days, or
- 2 repeated failures after PM in 90 days, or
- PM frequency adjusted twice in 180 days

### stock_below_minimum
- current stock below minimum

### stock_below_reorder_point
- current stock at or below reorder point while still above or equal to minimum

### certificate_expiring
- 30 days or less to expiry date

### certificate_expired
- expiry date before today

### inspection_failure_pattern
- 2 FAIL inspections in 90 days, or
- 3 CONDITIONAL inspections in 90 days

### overdue_capa
- CAPA overdue by more than 3 days, or 1 day if high criticality

### documentation_gap
- critical work order closed without required evidence or verifier, or
- incomplete RCA required fields, or
- CAPA closed without verification note, or
- daily report submitted without minimum required fields

### operational_anomaly
- at least 2 high-value signals on same vessel in 7 days

### recurring_asset_downtime
- same asset non-operational twice in 30 days, or
- more than 72 accumulated downtime hours in 30 days

### trend_based_maintenance_improvement
- repeated fleet or asset patterns over 180 days or longer

## Deduplication Rule

Do not create duplicate open insights with same tenant, insight type, target type, and target id.

Refresh the existing insight instead.

## Insight Visibility Rule

Insight visibility is broader than record access for cross-vessel summaries inside same tenant, but only at summary level.

## Build Note

For MVP, prefer deterministic threshold generation first, then AI summarization and prioritization second.
