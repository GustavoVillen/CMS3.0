# ADR-008 Running Hours: Source of Capture vs Canonical Log

## Title
Running Hours: source of capture vs canonical log

## Status
Accepted

## Context
The PMS needs running-hours-based triggers for maintenance planning. The architecture already has DailyReport as an operational reporting source. However, capture source and canonical maintenance trigger source are not necessarily the same concept.

A false dichotomy must be avoided:
- DailyReport is not sufficient as the only canonical model for all equipment
- RunningHoursLog is not necessarily the only capture source

The PMS must support both:
1. capture of hours from vessel reporting context
2. canonical evaluation of maintenance triggers per equipment

## Options considered

### Option A — Use only DailyReport
Pros:
- minimum new modeling
- simple for ship reporting

Cons:
- weak for equipment-specific counters
- poor auditability for equipment-level trigger logic
- mixes operational report with canonical maintenance history

### Option B — Use only RunningHoursLog
Pros:
- strong canonical history
- equipment-level traceability

Cons:
- creates unnecessary manual duplication if DailyReport already captures relevant hours
- increases crew workload if everything must be re-entered

### Option C — Separate source of capture from canonical trigger model
Pros:
- aligns with real vessel operation
- allows DailyReport as source where appropriate
- allows independent equipment logs where needed
- keeps trigger logic equipment-based
- minimizes duplication

Cons:
- requires explicit source selection per equipment
- requires clear scheduler logic

## Decision
Adopt Option C.

The system will distinguish between:
1. source of capture
2. canonical maintenance trigger evaluation

### Capture sources
- DailyReport for vessel-reported hours where operationally appropriate
- RunningHoursLog for equipment with independent counters or direct maintenance logging

### Canonical trigger basis
Maintenance triggers by hours must be evaluated per equipment, not only per vessel.

Each relevant Asset/Equipment must indicate its running-hours source using a field equivalent to:
- VESSEL_REPORT
- INDEPENDENT_LOG

The scheduler or trigger service must resolve the latest valid running-hours value for each equipment according to that source.

## Data quality rules
1. Missing hours data must not produce OVERDUE automatically.
   Use a status/insight equivalent to HOURS_DATA_UNAVAILABLE.

2. Counter decrease must generate an anomaly insight and require review.
   It must not silently overwrite history.

3. Improbable jump must generate an alert/insight for review.
   It should not block by default unless future policy requires it.

## Consequences
- DailyReport remains an operational input source
- RunningHoursLog becomes the canonical historical mechanism for equipment-level hour tracking where needed
- trigger logic stays aligned with equipment maintenance reality
- crew workload is reduced because duplicate entry is avoided where DailyReport already provides usable input

## What this prevents
- false choice between vessel report and equipment log
- vessel-level hours being used incorrectly as the only maintenance trigger basis
- silent corruption of running-hours history
- false overdue generation due to missing data

## Impact on implementation
- add a running-hours source discriminator to Asset/Equipment or equivalent existing entity
- add RunningHoursLog as a minimal new entity if not already present
- scheduler must resolve latest valid hours by source
- anomaly insights must be supported for missing/decreasing/improbable data