# File Purpose
Status: approved
Primary Owner: AI Governance Lead
Allowed Touchers:
- AI Governance Lead
- AI Lead
- Architecture Lead
Source of Truth: yes
Depends On:
- docs_saas/08_AI_ARCHITECTURE.md
Do Not Edit Without Reading:
- docs_saas/01_DECISION_LOG.md
Out of Scope:
- final prompt wording

# AI Rules, Skills, And Prompts

## Immutable Runtime Rules

- tenant isolation is mandatory
- permission and scope enforcement is mandatory
- answer language follows question language if enabled, else tenant default locale
- grounding priority is tenant documents first, tenant operational data second, expert reasoning third
- no hallucination: lack of evidence must be stated explicitly
- structured output enforcement applies to critical skills
- human approval is required before final writes
- prompts are globally governed by superadmin only
- all relevant AI runs are audited

## Skills For MVP

- `knowledge_assistant`
- `rca_assistant`
- `defect_assistant`
- `deferral_analysis`
- `barrier_interviewer`
- `maintenance_insights`
- `daily_executive_summary`
- `document_summarizer`
- `evidence_link_assistant`

## Prompt Governance

- Prompts are global for all tenants
- Only superadmin can manage them
- Prompts are versioned
- Prompts are stored per capability and locale
- Publish and rollback are explicit actions

## Prompt Composition Rule

Final prompt execution order must be:
1. immutable guardrails
2. published global prompt template for capability and locale
3. structured output instruction if required
4. tenant-scoped context
5. user message

## AI Prefill Rule

AI prefill must always follow:
1. extract or infer proposal
2. show preview
3. wait for explicit user confirmation
4. apply draft values only after confirmation

## Temporary File Rule

Files uploaded into AI conversations are temporary by default.

They are only retained beyond temporary lifecycle if explicitly published as reusable tenant attachments or documents.

## Form Prefill MVP Targets

- RCA
- defects
- deferrals
- daily_reports

## Prompt Safety Rule

Editable prompt templates must never be trusted for security.

Security, tenant isolation, scope filtering, and write confirmation remain enforced in code.
