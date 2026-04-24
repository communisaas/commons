# Core API Routes Integration Tests

**Status: NEEDS REWRITE.** The test files in this directory are currently excluded from the vitest run (see `vitest.config.ts` exclude list). They were written against the pre-Convex stack and still reference deleted routes, schema fields, and test-DB setup. Rewriting them against the live Convex backend is pending.

## What to replace

When rewriting:
- Use MSW v2 for external-service mocking (moderation, OAuth, CWC API). Keep internal logic real — no mocking Convex queries/mutations beyond what's strictly necessary.
- Drive Convex from a dedicated test deployment (`npx convex dev`) or from in-memory stubs of `convex-sveltekit`'s `serverQuery` / `serverMutation`. Do not reintroduce a direct-DB client.
- Assert against the shape returned by routes after their Convex call — not against row shape in a DB.

## Coverage targets (per `vitest.config.ts`)
- `src/routes/api/`: 30% minimum (branches, functions, lines, statements)
- Global: 20% minimum
