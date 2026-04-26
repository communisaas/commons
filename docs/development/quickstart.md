# Development Guide

**Commons's development workflow: testing, seeding, feature flags, deployment. Not blockchain — that's in [voter-protocol](https://github.com/communisaas/voter-protocol).**

This guide covers local development setup, testing strategies, Convex seeding, feature flag management, and deployment workflows.

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [Development Environment](#development-environment)
3. [Testing Strategy](#testing-strategy)
4. [Seeding](#seeding)
5. [Feature Flags](#feature-flags)
6. [Deployment](#deployment)
7. [Troubleshooting](#troubleshooting)

---

## Quick Start

### Initial Setup

```bash
# Install dependencies
npm install

# Set up environment variables
cp .env.example .env.local
# Edit .env.local with required Convex + API keys

# Attach to Convex cloud dev instance (auto-deploys schema + functions)
npx convex dev

# In a second terminal: start the SvelteKit dev server
npm run dev

# In a third terminal (optional): seed fixtures
npm run seed
```

Visit http://localhost:5173 to see the application.

### Common Commands

```bash
# Development
npm run dev              # Start dev server with hot reload
npx convex dev           # Attach/deploy to Convex cloud dev instance

# Code Quality
npm run check            # TypeScript + Svelte validation
npm run lint             # ESLint (warnings allowed)
npm run lint:strict      # ESLint (zero tolerance)
npm run format           # Prettier auto-fix

# Seeding
npm run seed             # Seeds Convex dev instance via seed:seedAll
npm run seed:agents      # Agent-powered seed (requires GEMINI_API_KEY, GROQ_API_KEY, EXA_API_KEY)
npm run seed:org         # Seeds org templates
# scripts/seed-vibes.ts  # Seeds policy vibes (run directly with tsx)

# Testing
npm run test             # All tests (watch mode)
npm run test:run         # All tests (single run)
npm run test:unit        # Unit tests only
npm run test:integration # Integration tests only
npm run test:e2e         # End-to-end browser tests
npm run test:coverage    # With coverage report

# Build
npm run build            # Production build
npm run preview          # Preview production build
```

---

## Development Environment

### Prerequisites

- **Node.js**: 24.15.0 (see `.nvmrc`)
- **No local database** — Convex is the managed backend (`npx convex dev` attaches to your cloud dev deployment)
- **Environment Variables**: See `.env.example` for required configuration

### Environment Configuration

**Required Variables:** `.env.example` is the source of truth. Key ones:

```bash
# Convex (required)
PUBLIC_CONVEX_URL=https://<your-deployment>.convex.cloud
CONVEX_DEPLOY_KEY=...          # For CI/prod deploys

# Moderation (required for creation + agent calls)
GROQ_API_KEY=...

# Agents + embeddings
GEMINI_API_KEY=...

# Congressional Delivery (optional)
CWC_API_KEY=...

# OAuth Providers (optional — any combination)
OAUTH_REDIRECT_BASE_URL=http://localhost:5173
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

**Development vs Production:**

- **Development** (`NODE_ENV=development`): OAuth HTTP allowed, detailed errors, hot reload.
- **Production** (`NODE_ENV=production`): HTTPS enforcement, error sanitization, optimizations.

### Local Services

`docker-compose.yml` defines only the **IPFS** service for ancillary pinning. There is no local application database — Convex is cloud-managed and `npx convex dev` attaches to your dev deployment.

```bash
docker compose up -d    # Optional: local IPFS
```

---

## Testing Strategy

### Philosophy: Integration-First

**Commons uses an integration-first testing approach:**

- **Focus**: Realistic user workflows over isolated units
- **Benefits**: Higher confidence, less maintenance, better bug detection
- **Coverage**: ~4,000 unit tests (3,891 passing as of 2026-03-18, not re-counted post-Convex migration)

### Test Types

#### 1. Integration Tests (Primary Focus)

**Location**: `tests/integration/`

**What to test:**
- Full user flows (address verification → saving → Convex writes)
- API endpoint contracts
- Legislative abstraction pipeline
- Template personalization
- Authentication workflows

**Example:**

```typescript
// tests/integration/congressional-delivery.test.ts
import { describe, it, expect } from 'vitest';
import { userFactory, templateFactory } from '../fixtures/factories';

describe('Congressional Delivery Flow', () => {
  it('should deliver message from template selection to congressional offices', async () => {
    const user = userFactory.build({ state: 'CA', congressionalDistrict: 'CA-11' });
    const template = templateFactory.build({ deliveryMethod: 'cwc' });

    const result = await deliverToCongressionalOffices(user, template);

    expect(result.status).toBe('delivered');
    expect(result.offices).toContain('CA11');
    expect(result.cwcResponse.success).toBe(true);
  });
});
```

#### 2. Unit Tests (Selective)

**Location**: `tests/unit/`

**What to test:**
- Complex algorithms (address parsing, template resolution)
- Utility functions with multiple branches
- Edge case scenarios
- Error handling logic

#### 3. End-to-End Tests (Critical Flows)

**Location**: `tests/e2e/`

**What to test:**
- Full browser workflows (template selection → customization → submission)
- Multi-page interactions
- UI component behavior
- Cross-browser compatibility

### Running Tests

```bash
npm run test                # Watch mode
npm run test:run            # Single run
npm run test:unit
npm run test:integration
npm run test:e2e
npm run test:coverage

# Feature flag testing
npm run test:production     # Production features only
npm run test:beta           # Include beta features
```

### Mock Patterns

```typescript
// OAuth mock
vi.mock('arctic', () => ({
  Google: vi.fn(() => ({
    validateAuthorizationCode: vi.fn().mockResolvedValue({
      accessToken: () => 'mock-token',
      refreshToken: () => 'mock-refresh'
    })
  }))
}));

// Convex client mock (use vi.hoisted for proper isolation)
const mockConvex = vi.hoisted(() => ({
  query: vi.fn(),
  mutation: vi.fn()
}));
```

### Critical Testing Requirements

**Address Verification Flow (Mission-Critical)**

Before any address-related changes, these tests must pass:

```bash
npm run test:integration -- address-verification-e2e
```

Tests must verify:
- Exact field names (camelCase: `bioguideId`, `officeCode`, `congressionalDistrict`)
- All required fields populated
- Data pipeline contracts (verify → save → Convex)
- Representative storage with real bioguide IDs

See `docs/development/testing.md` for details.

---

## Seeding

Seeding runs against your Convex dev instance via `convex/seed.ts`.

### Primary Seed

```bash
npm run seed    # Invokes `npx convex run seed:seedAll`
```

This loads fixture users, templates, representatives, and debates. Idempotent — safe to re-run. Reads from `convex/seedData.ts`.

### Agent-Powered Seed

```bash
npm run seed:agents
```

Regenerates `convex/seedData.ts` by running the full research + message agent pipeline. Requires `GEMINI_API_KEY`, `EXA_API_KEY`, `GROQ_API_KEY`.

### Org Templates

```bash
npm run seed:org    # Invokes scripts/seed-org-templates.ts
```

### Policy Vibes

```bash
npx tsx scripts/seed-vibes.ts
```

See [seeding.md](seeding.md) for data structure and fixture details.

---

## Feature Flags

### Feature Flag System

Commons uses the `FEATURES` object in `src/lib/config/features.ts` for boolean toggles on UI + backend features.

**Committed flags** (see memory index): `CONGRESSIONAL`, `WALLET`, `STANCE_POSITIONS`, `PUBLIC_API`, `ADDRESS_SPECIFICITY`, `ANALYTICS_EXPANDED`, `AB_TESTING`, `EVENTS`, `FUNDRAISING`, `AUTOMATION`, `SMS`, `NETWORKS`, `LEGISLATION`, `ACCOUNTABILITY`, `SHADOW_ATLAS_VERIFICATION`, `DEBATE`, `DELEGATION`.

**Defaults (2026-04-23):** `CONGRESSIONAL=false`, `DEBATE=true`, `PASSKEY=false`, `DELEGATION=false`, `ENGAGEMENT_METRICS=false`.

**Environment-layered flags** (for research features):

```bash
ENABLE_BETA=true        # AI suggestions, template intelligence
ENABLE_RESEARCH=true    # Cascade analytics, experimental UIs (dev-only)
NODE_ENV=production
```

### Checking Feature Status

```typescript
import { FEATURES } from '$lib/config/features';

if (FEATURES.DEBATE) {
  // Show debate UI
}
```

### Development Workflows

```bash
npm run dev                              # Standard
ENABLE_BETA=true npm run dev             # With beta features
ENABLE_RESEARCH=true npm run dev         # With research features

npm run test:production                  # Production features only
npm run test:beta                        # Include beta features
ENABLE_RESEARCH=true npm run test:run    # Include research features
```

---

## Deployment

### Build Process

```bash
npm run build      # Production build
npm run preview    # Preview
```

### Pre-Deployment Checklist

All must pass:

```bash
npm run format
npm run lint --max-warnings 0
npm run check
npm run build
npm run test:run
```

### Production Environment

**Required Variables:** `PUBLIC_CONVEX_URL`, `CONVEX_DEPLOY_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `CWC_API_KEY` (if CWC enabled), security salts (`IDENTITY_HASH_SALT`, `IP_HASH_SALT`), auth secrets (`JWT_SECRET`), OAuth credentials. See [production-secrets-checklist.md](production-secrets-checklist.md).

### Deploy Workflow

**Backend (Convex):**

```bash
npx convex deploy --env-file .env.production
```

Note: `npx convex deploy -y` silently no-ops against prod. Always pass `--env-file`.

**Frontend (Cloudflare Pages):**

```bash
npm run build
npx wrangler pages deploy .svelte-kit/cloudflare \
  --project-name communique-site --branch production
```

### Schema Changes in Production

Schema is code-driven via `convex/schema.ts`. Edit the file, commit, then:

```bash
npx convex deploy --env-file .env.production
```

Convex validates the diff against existing data and applies it. No migration files, no `db:push`.

### CI/CD

```yaml
name: CI/CD

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: 24.15.0

      - run: npm ci
      - run: npm run format -- --check
      - run: npm run lint --max-warnings 0
      - run: npm run check
      - run: npm run build
      - run: npm run test:ci

  deploy:
    needs: test
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - run: npm ci
      - run: npx convex deploy --env-file .env.production
      - run: npm run build
      - run: npx wrangler pages deploy .svelte-kit/cloudflare --project-name communique-site --branch production
```

---

## Troubleshooting

### Convex Connection Errors

**Symptom:** `ConvexError` or "function not found" at runtime

**Solutions:**

```bash
# Ensure `npx convex dev` is running and deployed successfully
# Check PUBLIC_CONVEX_URL matches your deployment
echo $PUBLIC_CONVEX_URL

# Re-deploy functions
npx convex dev
```

### Test Failures

**Symptom:** `Cannot read properties of undefined (reading 'mockResolvedValue')`

**Solutions:**

```bash
npx vitest --clearCache
# Ensure vi.clearAllMocks() in afterEach()
# Check mock setup order (use vi.hoisted)
```

### Build Failures

```bash
rm -rf node_modules package-lock.json
npm install
npx svelte-kit sync
```

### OAuth Errors in Development

**Symptom:** `redirect_uri_mismatch`

**Solutions:**

```bash
echo $OAUTH_REDIRECT_BASE_URL    # Should be http://localhost:5173

# In the OAuth provider console, ensure
# http://localhost:5173/auth/<provider>/callback is registered.
# NODE_ENV=development allows HTTP.
```

---

## Next Steps

- **Testing**: See `tests/README.md` for comprehensive test suite documentation
- **Frontend**: See `docs/frontend.md` for SvelteKit 5 patterns
- **Templates**: See `docs/features/templates.md` for the variable system and moderation
- **Integrations**: See `docs/integration.md` for CWC, OAuth, TEE setup
- **Deployment**: See [deployment.md](deployment.md) for Cloudflare Pages + Convex deploy

---

*Commons | Development Guide*
