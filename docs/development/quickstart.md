# Development Guide

**Commons's development workflow: testing, seeding, feature flags, deployment. Not blockchain—that's in [voter-protocol](https://github.com/communisaas/voter-protocol).**

This guide covers local development setup, testing strategies, database seeding, feature flag management, and deployment workflows. For blockchain integration, see `docs/integration.md`.

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [Development Environment](#development-environment)
3. [Testing Strategy](#testing-strategy)
4. [Database Seeding](#database-seeding)
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
cp .env.example .env
# Edit .env with your database and API credentials

# Generate Prisma client
npm run db:generate

# Push schema to database (development)
npm run db:push

# Seed development data
npm run db:seed

# Start development server
npm run dev
```

Visit http://localhost:5173 to see the application.

### Common Commands

```bash
# Development
npm run dev              # Start dev server with hot reload

# Code Quality
npm run check            # TypeScript + Svelte validation
npm run lint             # ESLint (warnings allowed)
npm run lint:strict      # ESLint (zero tolerance)
npm run format           # Prettier auto-fix

# Database
npm run db:push          # Push schema changes (dev)
npm run db:migrate       # Create/run migrations (prod)
npm run db:studio        # Open Prisma Studio GUI
npm run db:seed          # Seed sample data

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

- **Node.js**: 20.x or later
- **PostgreSQL**: 15.x or later (via pgvector/Prisma or local Docker Compose)
- **Environment Variables**: See `.env.example` for required configuration

### Environment Configuration

**Required Variables:**

```bash
# Database (pgvector via Docker Compose or managed Neon)
DATABASE_URL=postgresql://commons:commons@localhost:5432/commons

# Congressional Delivery (Optional)
CWC_API_KEY=your-cwc-api-key

# OAuth Providers (Optional - any combination)
OAUTH_REDIRECT_BASE_URL=http://localhost:5173
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
# ... other OAuth providers
```

**Development vs Production:**

- **Development**: `NODE_ENV=development` (default)
  - OAuth security relaxed (HTTP allowed)
  - Detailed error messages
  - Hot reload enabled

- **Production**: `NODE_ENV=production`
  - OAuth HTTPS enforcement
  - Error sanitization
  - Build optimizations

### Local Database Setup

**Option 1: Docker Compose (Recommended)**

```bash
# Start local Postgres
npm run db:start

# Connect to local database
DATABASE_URL=postgres://root:mysecretpassword@localhost:5432/local
npm run db:push
npm run db:seed
```

**Database Workflow:**

```bash
# Development: Push schema changes directly
npm run db:push

# Production: Create migration first
npm run db:migrate

# Inspect database
npm run db:studio  # Opens Prisma Studio at http://localhost:5555

# Reset database (⚠️ DELETES ALL DATA)
npx prisma migrate reset
```

---

## Testing Strategy

### Philosophy: Integration-First

**Commons uses an integration-first testing approach:**

- **Focus**: Realistic user workflows over isolated units
- **Benefits**: Higher confidence, less maintenance, better bug detection
- **Coverage**: 170/194 tests passing (87.6%), 70%+ coverage across all metrics

### Test Types

#### 1. Integration Tests (Primary Focus)

**Location**: `tests/integration/`

**What to test:**
- Full user flows (address verification → saving → database)
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
    // Setup
    const user = userFactory.build({ state: 'CA', congressional_district: 'CA-11' });
    const template = templateFactory.build({ deliveryMethod: 'cwc' });

    // Execute delivery pipeline
    const result = await deliverToCongressionalOffices(user, template);

    // Verify
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

**Example:**

```typescript
// tests/unit/template-resolver.test.ts
import { describe, it, expect } from 'vitest';
import { resolveTemplate } from '$lib/utils/templateResolver';

describe('Template Resolution', () => {
  it('should resolve [Name] variable with user name', () => {
    const template = { message_body: 'Hello [Name]!' };
    const user = { name: 'Sarah Martinez' };

    const resolved = resolveTemplate(template, user);

    expect(resolved.body).toBe('Hello Sarah Martinez!');
  });

  it('should remove unfilled variables from final text', () => {
    const template = { message_body: 'Dear [Representative Name],\n[Personal Connection]' };
    const user = { name: 'Alex' };

    const resolved = resolveTemplate(template, user);

    expect(resolved.body).not.toContain('[Representative Name]');
    expect(resolved.body).not.toContain('[Personal Connection]');
  });
});
```

#### 3. End-to-End Tests (Critical Flows)

**Location**: `tests/e2e/`

**What to test:**
- Full browser workflows (template selection → customization → submission)
- Multi-page interactions
- UI component behavior
- Cross-browser compatibility

**Example:**

```typescript
// tests/e2e/template-customization.spec.ts
import { test, expect } from '@playwright/test';

test('should customize template and submit', async ({ page }) => {
  await page.goto('/s/climate-subsidies');

  // Fill in customization fields
  await page.fill('[name="personalConnection"]', 'I live near a flood zone.');
  await page.fill('[name="street"]', '1847 Fillmore St');
  await page.fill('[name="city"]', 'San Francisco');

  // Submit
  await page.click('button:has-text("Send Message")');

  // Verify delivery
  await expect(page.locator('.success-message')).toBeVisible();
});
```

### Running Tests

```bash
# All tests (watch mode)
npm run test

# All tests (single run)
npm run test:run

# Specific test types
npm run test:unit
npm run test:integration
npm run test:e2e

# With coverage
npm run test:coverage

# Feature flag testing
npm run test:production    # Production features only (ENABLE_BETA=false)
npm run test:beta          # Include beta features (ENABLE_BETA=true)
ENABLE_RESEARCH=true npm run test:run  # Include research features

# Debugging
npm run test -- --reporter=verbose
npm run test -- --grep="pattern"
npm run test -- filename.test.ts
DEBUG_TESTS=true npm run test
```

### Test Configuration

**Vitest Configuration** (`vitest.config.ts`):

```typescript
export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: [
      'tests/config/setup.ts',
      'tests/config/test-monitoring.ts'
    ],

    // Parallelism for fast execution
    pool: 'forks',
    poolOptions: {
      forks: {
        maxForks: 4  // 4 parallel processes
      }
    },

    // Coverage thresholds (honest measurement)
    coverage: {
      provider: 'v8',
      thresholds: {
        global: {
          branches: 20,
          functions: 20,
          lines: 20,
          statements: 20
        },
        // Higher for critical paths
        'src/lib/core/auth/': { branches: 40, functions: 40 },
        'src/routes/api/': { branches: 30, functions: 30 }
      }
    }
  }
});
```

**Playwright Configuration** (`playwright.config.ts`):

```typescript
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,

  // Cross-browser testing
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } }
  ],

  // Auto-start preview server
  webServer: {
    command: 'npm run build && npm run preview',
    port: 4173
  }
});
```

### Test Fixtures & Mocks

**Type-Safe Factories** (`tests/fixtures/factories.ts`):

```typescript
// User factory
const user = userFactory.build({
  overrides: { state: 'CA', city: 'San Francisco' }
});

// Template factory
const template = templateFactory.build({
  overrides: { deliveryMethod: 'cwc', category: 'Environment' }
});

// Predefined scenarios
const californiaUser = testScenarios.californiaUser();
const climateTemplate = testScenarios.climateTemplate();
```

**Mock Patterns** (see `tests/README.md` for comprehensive guide):

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

// Database mock (use vi.hoisted for proper isolation)
const mockDb = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
    create: vi.fn()
  }
}));
```

### Critical Testing Requirements

**⚠️ Address Verification Flow (Mission-Critical)**

**Before ANY address-related changes, these tests MUST pass:**

```bash
npm run test:integration -- address-verification-api
npm run test:integration -- address-save-api
```

**Why**: We previously shipped 5 data integrity bugs because tests checked wrong field names.

**Tests MUST verify:**
- ✅ Exact field names (snake_case: `bioguide_id`, not `bioguideId`)
- ✅ All required fields present (`office_code`, `state`, `congressional_district`)
- ✅ Data pipeline contracts (verify → save → database)
- ✅ Representative storage with real bioguide IDs

See `docs/development/testing.md` for test strategy and requirements.

---

## Database Seeding

### Seed Script

**Command:**

```bash
npm run db:seed
```

**What Gets Seeded:**

1. **Users (12 total)**
   - Mix of verified (70%) and unverified (30%)
   - Geographic diversity: CA, WA, NY, TX, FL, OR, DC
   - VOTER Protocol data: trust scores, reputation tiers, token earnings
   - Real addresses with congressional districts

2. **Templates (15 total)**
   - Federal templates (8): Climate, healthcare, education, housing
   - Municipal templates (7): SF-specific issues
   - All verification states: approved, pending, reviewing, rejected
   - Agent consensus scores and quality metrics

3. **Congressional Representatives (4 total)**
   - Active and historical representatives
   - Office addresses and contact information
   - Bioguide IDs for CWC integration

4. **User-Representative Relationships**
   - Links users to their congressional representatives
   - Based on congressional district matching

### Seed Data Structure

**Users** (`scripts/seed-database.ts` line 1336-1923):

```typescript
{
  email: 'sarah.teacher@gmail.com',
  name: 'Sarah Martinez',

  // Address
  street: '1847 Fillmore St',
  city: 'San Francisco',
  state: 'CA',
  congressional_district: 'CA-11',

  // Verification
  is_verified: true,
  verification_method: 'didit_zk',

  // VOTER Protocol
  wallet_address: '0x1234...',
  trust_score: 85,
  reputation_tier: 'established',
  total_earned: '15750000000000000000',  // 15.75 VOTER tokens

  // Profile
  role: 'teacher',
  organization: 'San Francisco Unified School District'
}
```

**Templates** (`scripts/seed-database.ts` line 82-1332):

```typescript
{
  title: "The Math Doesn't Work: Climate Edition",
  slug: 'the-math-doesnt-work-climate-edition',

  // Content
  message_body: 'Dear [Representative Name]...',
  category: 'Environment',
  deliveryMethod: 'cwc',

  // Metrics
  metrics: {
    sent: 8234,
    districts_covered: 417
  },

  // Verification
  verification_status: 'approved',
  quality_score: 92,
  agent_votes: {
    openai: { score: 0.94, reasoning: '...' },
    gemini: { score: 0.89, reasoning: '...' }
  }
}
```

### Seed Output

**After seeding, you'll see:**

```
👥 User Summary:
================
Verified Users: 8/12
  • trusted: 3 users
  • established: 3 users
  • emerging: 2 users
  • novice: 4 users
Average Trust Score: 65
Total VOTER Tokens Earned: 156.80 VOTER

🌐 Available Templates:
=====================
📍 https://commons.email/the-math-doesnt-work-climate-edition
   "The Math Doesn't Work: Climate Edition" (Environment → federal)
   Created by: Sarah Martinez (established)

📍 https://commons.email/housing-2400-rent-400k-starter-home
   "Housing: $2,400 Rent, $400k Starter Home" (Housing → federal)
   Created by: Anna Rodriguez (trusted)
```

### Custom Seeding

**Modify seed data** in `scripts/seed-database.ts`:

```typescript
// Add new user
const seedUserData = [
  // ... existing users
  {
    email: 'new.user@example.com',
    name: 'New User',
    // ... other fields
  }
];

// Add new template
const seedTemplates = [
  // ... existing templates
  {
    title: 'New Template',
    // ... other fields
  }
];
```

**Run seed:**

```bash
npm run db:seed
```

---

## Feature Flags

### Feature Flag System

Commons uses environment-based feature flags to control access to:

- **Beta features** (`src/lib/features/`): AI suggestions, template intelligence
- **Research features** (`src/lib/experimental/`): Cascade analytics, experimental UIs

### Configuration

**Environment Variables:**

```bash
# Enable beta features
ENABLE_BETA=true

# Enable research features (development only)
ENABLE_RESEARCH=true

# Node environment (affects OAuth, logging, etc.)
NODE_ENV=production
```

### Checking Feature Status

**In Code:**

```typescript
import { isFeatureEnabled } from '$lib/features/config';

if (isFeatureEnabled('CASCADE_ANALYTICS')) {
  // Show cascade analytics UI
}

if (isFeatureEnabled('AI_SUGGESTIONS')) {
  // Enable AI-powered template suggestions
}
```

**Feature Flag Helper:**

```typescript
// src/lib/features/config.ts
export function isFeatureEnabled(feature: string): boolean {
  const flags = {
    CASCADE_ANALYTICS: process.env.ENABLE_RESEARCH === 'true',
    AI_SUGGESTIONS: process.env.ENABLE_BETA === 'true',
    TEMPLATE_INTELLIGENCE: process.env.ENABLE_BETA === 'true'
  };

  return flags[feature] || false;
}
```

### Development Workflows

**Standard Development:**

```bash
npm run dev
```

**With Beta Features:**

```bash
ENABLE_BETA=true npm run dev
```

**With Research Features:**

```bash
ENABLE_RESEARCH=true npm run dev
```

**Testing with Feature Flags:**

```bash
# Production features only
npm run test:production

# Include beta features
npm run test:beta

# Include research features
ENABLE_RESEARCH=true npm run test:run
```

---

## Deployment

### Build Process

**Production Build:**

```bash
npm run build
```

**Build Output:**

- Optimized SvelteKit build in `/build`
- Server-side rendering enabled
- Asset fingerprinting for caching
- Code splitting for performance

**Preview Production Build:**

```bash
npm run preview
```

### Pre-Deployment Checklist

**⚠️ MANDATORY - ALL commands must pass with 0 errors:**

```bash
# 1. Format code
npm run format

# 2. Lint (zero tolerance)
npm run lint --max-warnings 0

# 3. Type check
npm run check

# 4. Production build
npm run build

# 5. Test suite
npm run test:run
```

**If ANY command fails, you CANNOT deploy. Fix the issues first.**

### Environment Configuration (Production)

**Required Variables:**

```bash
NODE_ENV=production
DATABASE_URL=postgresql://...
CWC_API_KEY=...
OAUTH_REDIRECT_BASE_URL=https://commons.email

# OAuth providers
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
# ... other OAuth providers
```

**Security Requirements:**

- ✅ All OAuth redirects must use HTTPS in production
- ✅ Session secrets must be cryptographically random (32+ bytes)
- ✅ Database credentials must use SSL/TLS
- ✅ API keys must be stored securely (never in code)

### Deployment Platforms

**Production runs on Cloudflare Workers** (Pages) via `@sveltejs/adapter-cloudflare`.

```javascript
import adapterCloudflare from '@sveltejs/adapter-cloudflare';

export default {
  kit: {
    adapter: adapterCloudflare()
  }
};
```

Build and deploy:
```bash
npm run build && npx wrangler pages deploy .svelte-kit/cloudflare --project-name commons
```

### Database Migrations (Production)

**⚠️ NEVER use `db:push` in production**

**Proper Migration Workflow:**

```bash
# 1. Create migration (local)
npm run db:migrate

# 2. Review migration file
cat prisma/migrations/[timestamp]_[name]/migration.sql

# 3. Test migration on staging database
DATABASE_URL=<staging> npx prisma migrate deploy

# 4. Deploy migration to production
DATABASE_URL=<production> npx prisma migrate deploy
```

**Migration Best Practices:**

- ✅ Always create migrations locally first
- ✅ Test migrations on staging before production
- ✅ Never edit migration files after creation
- ✅ Use transactions for complex migrations
- ✅ Have rollback plan for each migration

### CI/CD Integration

**GitHub Actions Example:**

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
          node-version: 20

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
      - run: npm run build
      # Deploy to your platform
```

### Monitoring & Logging

**Production Logging:**

```typescript
// Use structured logging in production
if (process.env.NODE_ENV === 'production') {
  console.log(JSON.stringify({
    level: 'info',
    message: 'User authenticated',
    userId: user.id,
    timestamp: new Date().toISOString()
  }));
}
```

**Error Tracking:**

- Sanitize error messages (no sensitive data)
- Log to external service (Sentry, LogRocket, etc.)
- Include request context (route, user agent, timestamp)

---

## Troubleshooting

### Common Issues

#### Database Connection Errors

**Symptom:**

```
Error: P1001: Can't reach database server at `<host>`
```

**Solutions:**

```bash
# Check DATABASE_URL format
echo $DATABASE_URL

# Test connection
npx prisma db pull

# Verify database is running (docker compose up -d)
```

#### Test Failures

**Symptom:**

```
Error: Cannot read properties of undefined (reading 'mockResolvedValue')
```

**Solutions:**

```bash
# Clear test cache
npx vitest --clearCache

# Reset mocks
# Ensure vi.clearAllMocks() in afterEach()

# Check mock setup order (use vi.hoisted)
```

#### Build Failures

**Symptom:**

```
Error: Cannot find module '@sveltejs/kit'
```

**Solutions:**

```bash
# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install

# Regenerate Prisma client
npm run db:generate

# Sync SvelteKit types
npx svelte-kit sync
```

#### OAuth Errors in Development

**Symptom:**

```
Error: redirect_uri_mismatch
```

**Solutions:**

```bash
# Verify OAUTH_REDIRECT_BASE_URL
echo $OAUTH_REDIRECT_BASE_URL
# Should be: http://localhost:5173

# Check OAuth provider console
# Ensure http://localhost:5173/auth/[provider]/callback is registered

# Verify NODE_ENV=development (allows HTTP)
```

### Getting Help

**When filing issues:**

1. Include full error message and stack trace
2. Provide specific command that fails
3. Share relevant environment information
4. Include recent changes that might have introduced the issue
5. Check existing issues first

**Resources:**

- Test Suite: `tests/README.md`
- Database Seeding: `docs/development/seeding.md`
- Integrations: `docs/integration.md`
- Template System: `docs/features/templates.md`

---

## Next Steps

- **Testing**: See `tests/README.md` for comprehensive test suite documentation
- **Frontend**: See `docs/frontend.md` for SvelteKit 5 patterns
- **Templates**: See `docs/features/templates.md` for variable system and moderation
- **Integrations**: See `docs/integration.md` for CWC, OAuth, TEE setup
- **Deployment**: See `docs/development/deployment.md` for Cloudflare Workers deployment

---

*Commons | Development Guide | 2026-03*
