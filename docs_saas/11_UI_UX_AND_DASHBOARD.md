# File Purpose
Status: approved
Primary Owner: UX Lead
Allowed Touchers:
- UX Lead
- Frontend Lead
Source of Truth: yes
Depends On:
- docs_saas/03_TENANCY_AUTH_AND_I18N.md
- docs_saas/10_AI_INSIGHTS_EVENTS_AND_THRESHOLDS.md
Do Not Edit Without Reading:
- docs_saas/01_DECISION_LOG.md
Out of Scope:
- detailed component implementation code

# UI, UX, And Dashboard

## Visual System

- Primary background: `#0F172A`
- Global accent: `#EAB308`
- Semantic success: `#22C55E`
- Semantic danger: `#EF4444`
- Semantic warning: `#F97316`

## Layout

- left sidebar
- top header
- responsive content area
- dashboard home uses bento-inspired modular layout

## Header Requirements

- product and tenant identity
- refresh action
- locale selector
- user profile menu
- logout action

## Sidebar Modules

- dashboard
- daily reports
- inspections and tests
- maintenance plans
- assets and critical spares
- certificates
- work orders
- deferrals
- defects
- spare orders
- providers

## Routing Rule

The product must support URL-based module and record navigation.

This enables multiwindow and multitabs in browser.

## AI UX Rule

Use two different AI surfaces:

### Dashboard
- persistent `AI Insights` panel
- prioritized, reviewable suggestions

### Module Pages
- contextual copiloto panel
- suggestions and explanations tied to current module or record

## I18n Rule

No visible UI text should be hardcoded outside translation dictionaries.

Frontend must respect active locale from session, plus tenant timezone and currency for formatting.

## Branding Rule

Tenant branding is limited in MVP to:
- display name
- logo
- primary color
- support email

Tenant branding does not replace semantic status colors or core product accent.
