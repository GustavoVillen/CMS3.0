# File Purpose
Status: approved
Primary Owner: Auth Lead
Allowed Touchers:
- Auth Lead
- Architecture Lead
Source of Truth: yes
Depends On:
- docs_saas/00_MASTER_INDEX.md
- docs_saas/01_DECISION_LOG.md
- docs_saas/02_PRODUCT_SCOPE.md
Do Not Edit Without Reading:
- docs_saas/01_DECISION_LOG.md
Out of Scope:
- billing and custom domains

# Tenancy, Auth, And I18n

## Tenant Resolution

### Production
- Primary mode: `<tenant>.<domain>`
- Superadmin: `admin.<domain>`

### Development
- Tenant fallback: `/t/:slug`

### Rules
- Production tenant resolution uses subdomain.
- Development tenant resolution may use path.
- Path is not a production routing model.

## User Model

- Platform users and tenant users are separate concerns.
- One tenant user belongs to one tenant only in MVP.
- One tenant user has one role only in MVP.
- Vessel assignment scopes access inside the tenant.

## Authentication

### Tenant User Login
- Final login identifier: email
- Temporary migration support: `legacy_user_id`
- Flow: `identifier + password`

### Superadmin Login
- Separate host
- Separate auth flow
- Separate session domain and permissions

### Invitation
- Tenant users are created by invitation only in MVP.

### Password Recovery
- Forgot password by email is in MVP.

### Email Rules
- Email is globally unique.

## Tenant Settings

Each tenant must define:
- `display_name`
- `logo_url`
- `primary_color`
- `support_email`
- `default_locale`
- `enabled_locales`
- `timezone`
- `currency`

## I18n Rules

### Supported Locales
- `es`
- `en`
- `pt`

### Active Locale Resolution
1. User session locale if explicitly selected and enabled for tenant
2. Tenant `default_locale`

### AI Locale Resolution
1. Detect question language
2. If enabled for tenant, answer in that language
3. Else use tenant `default_locale`

### Formatting Rules
- Dates are stored in UTC
- Display uses active locale and tenant timezone
- Currency formatting uses active locale and tenant currency

## Session Scope Rules

- Tenant user session is always tenant-bound.
- Superadmin session is platform-bound.
- AI conversation context is tenant-bound.
- Cross-vessel insights do not change record access permissions.
