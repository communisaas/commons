# Seeding

Commons's development data is seeded into the Convex backend via a multi-stage pipeline. All commands run against your Convex dev deployment (set `PUBLIC_CONVEX_URL`).

## Commands

```bash
npm run seed          # Primary: `npx convex run seed:seedAll` (idempotent)
npm run seed:agents   # Agent-powered template regeneration
npm run seed:org      # Org-scoped templates
npx tsx scripts/seed-vibes.ts   # Policy vibes
```

## Primary Seed (`seed:seedAll`)

Entry point: `convex/seed.ts`. Fixture data: `convex/seedData.ts`.

- Idempotent: safe to re-run; existing rows are skipped or updated in-place.
- Runs against the dev Convex deployment via `npx convex run`.
- Loads users, templates, representatives, and a minimal set of debates.

## Agent-Powered Seed (`seed:agents`)

Script: `scripts/seed-with-agents.ts`.

- Regenerates `convex/seedData.ts` by running the full research + message generation pipeline (Gemini + Exa + Groq).
- Required env: `GEMINI_API_KEY`, `EXA_API_KEY`, `GROQ_API_KEY`.
- Output is deterministic per-run; commit the regenerated snapshot when intentional.

## Org Template Seed (`seed:org`)

Script: `scripts/seed-org-templates.ts`.

- Populates org-owned templates for the test organizations.

## Policy Vibes Seed

Script: `scripts/seed-vibes.ts`.

- Populates the policy vibe fixtures used by the domain + topic system.

## Data Shape

Templates carry `domain` + `topics` (not the legacy `category` scalar). Users are seeded with `verificationMethod: "mdl"`. Legacy enum values (`'self.xyz'`, `'didit'`) remain only as string literals in the schema for backward compat with historical rows and never appear in fresh fixtures.

Field naming in Convex is camelCase (`verifiedSends`, `districtHash`, `bioguideId`, `officeCode`).

## Environment

`PUBLIC_CONVEX_URL` (and `CONVEX_DEPLOY_KEY` for CI). No `DATABASE_URL` — Convex is cloud-managed; local dev uses `npx convex dev`.

For CWC testing, `CWC_API_KEY` is additionally required.

## Re-seeding After Tests

If a test run mutates fixture data, just re-run:

```bash
npm run seed
```

## Customizing Fixtures

Edit `convex/seedData.ts` directly (or run `npm run seed:agents` to regenerate it from live sources). Then re-run `npm run seed`.

For new tables, add a loader to `convex/seed.ts:seedAll` so it's covered by the idempotent run.
