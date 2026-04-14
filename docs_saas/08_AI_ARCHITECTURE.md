# File Purpose
Status: approved
Primary Owner: AI Lead
Allowed Touchers:
- AI Lead
- Architecture Lead
Source of Truth: yes
Depends On:
- docs_saas/03_TENANCY_AUTH_AND_I18N.md
- docs_saas/05_DATA_MODEL_AND_AUDIT_RULES.md
Do Not Edit Without Reading:
- docs_saas/09_AI_RULES_SKILLS_PROMPTS.md
- docs_saas/10_AI_INSIGHTS_EVENTS_AND_THRESHOLDS.md
Out of Scope:
- vendor-specific SDK decisions

# AI Architecture

## AI Roles In Product

AI is not only a chatbot.

It must support:
- knowledge assistance grounded in tenant documents
- contextual copiloto behavior in workflows
- trend and maintenance improvement analysis
- dashboard insights generated from events and history
- structured prefill suggestions for forms

## AI Sources

### Permanent Tenant Sources
- tenant documents
- active document versions
- operational data from same tenant
- event history from same tenant

### Temporary Session Sources
- files uploaded ad hoc into AI session
- current workflow context
- current conversation history

Temporary files are not permanent knowledge by default.

## Tenant Isolation Rule

AI context must always remain inside the active tenant.

No cross-tenant retrieval is allowed.

## Cross-Vessel Rule

Inside the same tenant, AI may use and summarize fleet-level patterns.

AI may mention other vessels in insights, but that does not grant direct record access.

## Copiloto Rule

AI is always a copiloto, never an autonomous actor.

AI may:
- suggest
- summarize
- explain
- extract
- prefill drafts

AI may not:
- submit final forms
- close workflows
- save final data without confirmation

## Trend Analysis Rule

AI must support both:
- short-term operational analysis
- long-term reliability analysis

Because vessel equipment failures may occur after years, not only short windows.

Long-term analysis should support:
- long date windows
- operating hours
- hours since overhaul
- recurring defects over years
- maintenance effectiveness review

## Daily Reports And Telemetry Growth Rule

Daily reports must be designed to grow into:
- IoT integrations
- AWS IoT integrations
- remote monitoring
- future telemetry snapshots

## AI Document Management

Tenant admin can:
- upload documents
- create versions
- activate versions
- deactivate versions

Only active tenant document versions are eligible for AI retrieval.
