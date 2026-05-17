# API App

Purpose: new backend service for the SaaS platform.

This app is the target runtime for:
- tenant auth
- platform auth
- tenant-scoped domain APIs
- AI runtime
- import/export jobs
- audit and event pipelines

Do not pull implementation code from legacy folders directly into this app without documenting the migration mapping in `CLAUDE.md` and `HISTORY.txt`.
