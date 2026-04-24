# Development Documentation

**Setup, database, testing, deployment, and code maintenance.**

---

## Getting Started

### 1. [quickstart.md](quickstart.md) - Development Setup

Install dependencies, run dev server, common commands.

**Start here**: `npm install` → `cp .env.example .env.local` → `npx convex dev` → `npm run dev` → http://localhost:5173

**Commands**:
- `npx convex dev` - Attach to Convex cloud dev instance
- `npm run dev` - SvelteKit dev server
- `npm run build` - Production build
- `npm run test` - Test suite
- `npm run check` - Type checking

### 2. [database.md](database.md) - Database

**Convex** (managed backend). Schema lives in `convex/schema.ts` (~71 tables, 232 indexes).

**What it documents**: Schema overview, auth bridge (RS256 JWT → `ctx.auth.getUserIdentity()`), Convex vector index for embeddings.

**Cross-reference**: `convex/schema.ts` (code-driven, no migration files)

### 3. [seeding.md](seeding.md) - Seeding

Test data generation via Convex seed actions.

**Commands**:
- `npm run seed` - Runs `npx convex run seed:seedAll` (idempotent)
- `npm run seed:agents` - Seeds AI-agent fixtures (requires `GEMINI_API_KEY`, `GROQ_API_KEY`, `EXA_API_KEY`)
- Schema changes: edit `convex/schema.ts` and `npx convex dev` re-deploys (no migrations)

---

## Testing & Quality

### 4. [testing.md](testing.md) - Test Strategy

Integration-first testing, smart mocks, test fixtures.

**Philosophy**: Integration tests > unit tests. Test user flows, not implementation details.

**Test types**:
- Integration tests (53 → 6 consolidated)
- Unit tests (template resolution, analytics)
- E2E tests (Playwright, critical user paths)

**Commands**:
- `npm run test` - All tests
- `npm run test:integration` - Integration only
- `npm run test:e2e` - E2E browser tests

### 5. [flags.md](flags.md) - Feature Flags

Simple `FEATURES` object in `src/lib/config/features.ts` with boolean toggles.

**Current flags**: DEBATE, CONGRESSIONAL, WALLET, STANCE_POSITIONS, ADDRESS_SPECIFICITY

---

## AI & Moderation

### 6. [agents.md](agents.md) - AI Agent System

Three-agent pipeline for campaign creation: subject line generation, decision-maker resolution, message writing.

**Architecture**: Gemini 3 Flash → SSE streaming → real-time UI feedback

**Agents**:
- Subject line generator (clarification + generation modes)
- Decision-maker resolver (4-phase agentic pipeline with web search)
- Message writer (two-phase verified source pipeline)

**Key concepts**: LLM cost protection tiers, prompt injection defense, circuit breakers

### 7. [moderation.md](moderation.md) - Content Moderation

Automated two-layer pipeline via Groq. No manual review by design.

**Layer 0**: Prompt injection detection (Llama Prompt Guard 2)
**Layer 1**: Content safety classification (`openai/gpt-oss-safeguard-20b`, permissive for civic speech)

**Policy**: Only S1 (violent crimes) and S4 (CSAM) block content. Political speech, defamation, and electoral opinions are allowed.

---

## Monitoring & Analytics

### 8. [analytics.md](analytics.md) - Analytics Tracking

Funnel tracking, event logging, database analytics.

**What we track**:
- Template views → customizations → submissions
- OAuth conversion rates
- Search queries → template clicks
- User retention cohorts

**Privacy**: All analytics are aggregate. No individual tracking without consent.

### 9. [deployment.md](deployment.md) - Production Checklist

Pre-deployment verification, production build, environment checks.

**Before deploying**:
- [ ] `npm run build` succeeds
- [ ] `npm run test:run` passes
- [ ] `npm run check` (type checking)
- [ ] Environment variables set
- [ ] `npx convex deploy --env-file .env.production`
- [ ] Feature flags configured

---

## External Services

### 10. [firecrawl-deployment-checklist.md](firecrawl-deployment-checklist.md) - Firecrawl Provider

Deployment checklist for Firecrawl web scraping provider integration.

### 10b. [production-secrets-checklist.md](production-secrets-checklist.md) - Production Secrets

Pre-production checklist for API keys, proxy configuration, CWC credentials.

---

## Testing Resources

### 12. [e2e-testing-guide.md](e2e-testing-guide.md) - E2E Testing Guide

End-to-end testing for voter-protocol integration: identity verification, ZK proofs, congressional submission.

### 13. [ZK-PROOF-TESTING-STRATEGY.md](ZK-PROOF-TESTING-STRATEGY.md) - ZK Proof Testing

Testing strategy for zero-knowledge proof generation and verification.

### 15. [VECTOR_SEARCH_GUIDE.md](VECTOR_SEARCH_GUIDE.md) - Convex Vector Search Guide

Convex `.vectorIndex(...)` setup, embedding generation with Gemini `text-embedding-004` (768 dims), similarity search patterns.

---

## Code Maintenance

### 11. [maintenance.md](maintenance.md) - Code Health

Linting, formatting, dependency updates, tech debt tracking.

**Commands**:
- `npm run lint` - ESLint
- `npm run format` - Prettier
- `npm run check` - TypeScript + Svelte validation

**Standards**:
- Zero ESLint errors (CI enforced)
- Prettier for formatting (no debates)
- TypeScript strict mode
- No `any` types (use proper types or `unknown`)

---

## Architecture Cross-References

**TEE systems** → See `/docs/architecture/tee-systems.md`

**voter-protocol integration** → See `/docs/integration.md`

**Congressional delivery** → See `/docs/congressional/`

**Frontend architecture** → See `/docs/frontend.md`

---

## Development Workflow

### Daily Development

1. **Pull latest**: `git pull`
2. **Install deps**: `npm install` (if package.json changed)
3. **Start Convex**: `npx convex dev`
4. **Run dev server**: `npm run dev`
5. **Make changes**
6. **Run tests**: `npm run test`
7. **Type check**: `npm run check`
8. **Commit**: `git commit -m "feat: description"`

### Before Creating PR

1. **Run full test suite**: `npm run test:run`
2. **Type check**: `npm run check`
3. **Lint**: `npm run lint`
4. **Build**: `npm run build`
5. **Format**: `npm run format`

**All must pass** or PR will be rejected by CI.

### Schema Changes

1. **Edit schema**: `convex/schema.ts`
2. **Auto-deploy (dev)**: `npx convex dev` watches and deploys on save
3. **Deploy (prod)**: `npx convex deploy --env-file .env.production`
4. **Update seed data**: Edit `convex/seedData.ts` or regenerate via `npm run seed:agents`

---

## For New Developers

**First day**:
1. Read quickstart.md
2. `npm install && npx convex dev && npm run dev`
3. Browse codebase in `/src/lib/` and `/convex/`
4. Read database.md (understand schema)
5. Run test suite (`npm run test`)

**First week**:
1. Pick "good first issue" from GitHub
2. Read relevant docs in `/docs/features/`
3. Make PR following development workflow above
4. Get code review feedback
5. Ship feature

**First month**:
1. Read `docs/frontend.md` (SvelteKit 5 patterns)
2. Read `docs/architecture.md` (product architecture)
3. Understand TEE architecture (`docs/architecture/tee-systems.md`)
4. Take ownership of a component area

---

## Common Tasks

**Add new feature**:
1. Create feature flag in flags.md
2. Add schema in `convex/schema.ts`
3. Add Convex queries/mutations in `convex/`
4. Create UI components in `/src/lib/components/`
5. Add API routes in `/src/routes/api/` (if SvelteKit-side needed)
6. Write integration tests
7. Document in `/docs/features/`

**Fix bug**:
1. Write failing test that reproduces bug
2. Fix bug
3. Verify test passes
4. Check no regressions (`npm run test:run`)
5. Create PR

**Refactor code**:
1. Write tests for current behavior
2. Refactor
3. Verify tests still pass
4. Check type safety (`npm run check`)
5. Update docs if behavior changed

---

## Emergency Procedures

**Production is down**:
1. Check Cloudflare Pages logs via Cloudflare dashboard
2. Check Convex dashboard for function errors
3. Check environment variables in Cloudflare Pages + Convex
4. Rollback deploy if needed via Cloudflare Pages dashboard / Convex dashboard

**Schema deploy failed**:
1. Check Convex dashboard for validation errors
2. Fix schema mismatch in `convex/schema.ts`
3. Retry: `npx convex deploy --env-file .env.production`

**Tests failing in CI but passing locally**:
1. Check Node version matches CI (see `.github/workflows/`)
2. Check environment variables
3. Run `npm ci` (clean install)
4. Check for race conditions in tests
