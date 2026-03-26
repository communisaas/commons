# Convex Backend

This directory contains Convex server functions (queries, mutations, actions).

## Setup
```bash
npx convex dev  # Start development server + watch mode
```

## Structure
- `schema.ts` — Database schema (67 tables)
- `lib/` — Shared helpers (PII encryption, auth)
- `*.ts` — Domain modules (users, templates, campaigns, etc.)
- `_generated/` — Auto-generated types (gitignored)
