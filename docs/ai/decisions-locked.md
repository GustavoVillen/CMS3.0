# Locked Decisions

## Running Hours
Accepted:
- Capture source and canonical trigger source are different concepts.
- DailyReport can be a capture source.
- RunningHoursLog can be a capture source and canonical history for equipment with own counters.
- Maintenance hour triggers must be evaluated per equipment.
- Missing hours data must not automatically create OVERDUE.
- Counter decrease and improbable jumps must create anomalies/alerts, not silent corrections.

## Warning
Not yet accepted:
- MaintenancePlan extension scope is still under review.
- Defect reused as PMS Finding is likely correct, but still must be frozen in ADR.
- Inspection naming boundary must be frozen before implementation.