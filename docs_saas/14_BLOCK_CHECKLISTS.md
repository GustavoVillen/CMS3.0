# File Purpose
Status: approved
Primary Owner: Delivery Lead
Allowed Touchers:
- Delivery Lead
- Any block owner updating completion state
Source of Truth: yes
Depends On:
- docs_saas/13_AGENT_WORK_PROTOCOL.md
Do Not Edit Without Reading:
- docs_saas/00_MASTER_INDEX.md
Out of Scope:
- scheduling or staffing

# Block Checklists

## Universal Start Checklist

- Read `00_MASTER_INDEX.md`
- Read `01_DECISION_LOG.md`
- Read latest relevant `HISTORY.txt` entries
- Read target file and all dependencies
- Confirm allowed paths only
- Confirm no legacy path writes
- Confirm block scope and out-of-scope

## Universal Finish Checklist

- Updated file status if appropriate
- Reviewed cross-file consistency
- Added or updated `Open Issues` if needed
- Listed touched files
- Confirmed no forbidden path writes
- Confirmed no closed decision was silently changed
- Updated `HISTORY.txt` if the block changed code, infra, runtime, or workflow
- Confirmed the history entry includes timestamp, changes, validation, and result

## Block 01 Documentation Foundation
- Master index finalized
- decision log initialized
- work protocol and checklists created
- deferred work file created

## Block 02 Tenancy Auth I18n
- tenant resolution documented
- auth split documented
- locale/timezone/currency rules documented
- bootstrap requirements documented

## Block 03 Roles Permissions Scopes
- all roles documented
- vessel scope model documented
- sensitive permissions closed
- single-role-per-user rule captured

## Block 04 Data Model Core
- tenant id rule captured
- traceability fields captured
- soft delete captured
- append-only tables captured
- long-history preservation captured

## Block 05 Core Modules
- state models aligned with documentation
- transition restrictions captured
- role authority captured
- required events captured

## Block 06 Compliance And Operations
- certificates state rules captured
- daily reports one-per-day rule captured
- future telemetry extension path captured

## Block 07 Procurement And Stock
- spare order states captured
- stock update behavior captured
- soft delete limits preserved

## Block 08 Excel Import Export
- importable modules match decision log
- matching keys match decision log
- preview flow captured
- conflict handling for soft delete captured

## Block 09 AI Documents And Prompts
- tenant document lifecycle captured
- prompt governance captured
- global prompt rule preserved
- tenant isolation preserved

## Block 10 AI Runtime And Insights
- event pipeline documented
- insight thresholds documented
- dashboard insight panel behavior documented
- cross-vessel insight summary rule preserved

## Ready For Coding Checklist

- source block doc is approved
- dependencies are approved
- no blocking open issues remain
- target paths are allowed
- plan for `HISTORY.txt` update at block close exists
