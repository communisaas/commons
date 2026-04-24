# E2E Testing Guide: Commons ↔ Voter Protocol Integration

**Current layout (2026-04-23):**

- **Two suites:**
  - **Browser E2E (Playwright):** `tests/e2e/*.spec.ts` (e.g. `identity-verification-flow.spec.ts`, `moderation/moderation-pipeline.spec.ts`). Run via `npm run test:e2e` against a live dev server.
  - **Voter-protocol integration (Vitest + MSW):** `tests/unit/voter-protocol/`. Fixtures, `full-flow.test.ts`, `error-cases.test.ts`, `edge-cases.test.ts` live here. Run via `npm run test:e2e:voter`.
- **Identity:** mDL via W3C Digital Credentials API is the active intake. Legacy `'self.xyz' | 'didit'` enum values remain only for historical record backward compat.
- **Backend:** Convex-only. No `DATABASE_URL` is read at runtime; any Postgres DSN in test fixtures is dead weight kept for old fixture defaults, not a live dependency.
- **Submit endpoint:** `POST /api/submissions/create`.
- **Feature flags in tests:** `FEATURES.CONGRESSIONAL=false`, `PASSKEY=false`, `DELEGATION=false`, `ENGAGEMENT_METRICS=false`; `DEBATE=true`. Tests that assert CWC/passkey/delegation flows are live must override the flag for the test env.

This guide covers the end-to-end testing suite for the Commons ↔ voter-protocol integration, including identity verification, ZK proof generation, and congressional submission.

## Overview

The E2E test suite validates the complete flow:

```
Identity Verification → District Registration → ZK Proof Generation → Congressional Submission
        (Didit.me)         (Shadow Atlas)        (@voter-protocol)           (CWC API)
```

## Test Structure

```
tests/e2e/voter-protocol/
├── fixtures.ts         # Test data, mock payloads, test vectors
├── test-utils.ts       # Shared utilities, MSW handlers, helpers
├── full-flow.test.ts   # Happy path end-to-end tests
├── error-cases.test.ts # Failure scenarios and error handling
└── edge-cases.test.ts  # Boundary conditions and edge cases
```

## Running Tests

### Quick Start

```bash
# Run all voter-protocol E2E tests
npm run test:e2e:voter

# Or run directly with Vitest
npx vitest run tests/e2e/voter-protocol --config=vitest.config.ts

# Run specific test file
npx vitest run tests/e2e/voter-protocol/full-flow.test.ts

# Run in watch mode during development
npx vitest tests/e2e/voter-protocol --watch
```

### Test Categories

| Test File | Description | Duration |
|-----------|-------------|----------|
| `full-flow.test.ts` | Happy path scenarios | ~5s |
| `error-cases.test.ts` | Failure and error handling | ~3s |
| `edge-cases.test.ts` | Boundary conditions | ~3s |

## Test Fixtures

### Mock Didit.me Webhooks

```typescript
import { createMockDiditWebhook } from './fixtures';

// Create approved verification webhook
const webhook = createMockDiditWebhook({
  userId: 'test-user-123',
  status: 'Approved',
  documentType: 'passport',
  birthYear: 1990,
  nationality: 'USA'
});
```

### Mock Shadow Atlas Responses

```typescript
import { createMockShadowAtlasResponse } from './fixtures';

// Create district lookup response with depth-20 Merkle proof
const response = createMockShadowAtlasResponse({
  districtId: 'usa-ca-sf-d5',
  districtName: 'San Francisco District 5',
  depth: 20
});
```

### Valid Proof Inputs

```typescript
import { VALID_PROOF_INPUTS } from './fixtures';

// Minimal inputs for testing
const inputs = VALID_PROOF_INPUTS.minimal;

// Realistic inputs with proper encoding
const realisticInputs = VALID_PROOF_INPUTS.realistic;
```

## MSW Handlers

The test suite uses MSW (Mock Service Worker) to intercept HTTP requests:

```typescript
import { setupTestServer, createShadowAtlasHandlers } from './test-utils';

const server = setupTestServer({
  shadowAtlasOptions: { healthStatus: true },
  diditOptions: {},
  congressionalOptions: { houseEnabled: true, senateEnabled: true },
  nullifierOptions: { existingNullifiers: [] }
});

// Override handlers for specific test
useHandlers(createShadowAtlasHandlers({ errorMode: 'network' }));
```

### Available Handler Factories

| Factory | Purpose |
|---------|---------|
| `createShadowAtlasHandlers` | Mock Shadow Atlas API |
| `createDiditHandlers` | Mock Didit.me verification |
| `createCongressionalHandlers` | Mock CWC Senate/House APIs |
| `createNullifierRegistryHandlers` | Mock nullifier registry |

## Test Scenarios

### Full Flow Tests

1. **Identity Verification**
   - Validate Didit.me webhook signatures
   - Parse verification results
   - Calculate authority levels from document types

2. **District Registration**
   - Lookup district from coordinates
   - Validate Merkle proof structure
   - Handle various jurisdictions (city, state, federal)

3. **Proof Generation**
   - Validate proof input structure
   - Check field element bounds (BN254 modulus)
   - Verify Merkle path length (depth-20)

4. **Congressional Submission**
   - Format submission payload
   - Validate nullifier uniqueness
   - Handle API responses

### Error Cases

- Invalid webhook signatures
- Rejected/expired verification status
- Network failures (Shadow Atlas, CWC)
- Rate limiting
- Double-voting (nullifier reuse)

### Edge Cases

- Boundary coordinates (district lines)
- Maximum tree depth (2^20 leaves)
- Authority level boundaries (1-5)
- BN254 field element limits
- Leap year birth dates

## Configuration

### Environment Variables

```bash
# tests/.env.test
SHADOW_ATLAS_API_URL=http://localhost:3000
# Convex test deployment — set via CONVEX_DEPLOY_KEY + PUBLIC_CONVEX_URL in CI
PUBLIC_CONVEX_URL=https://<test-deployment>.convex.cloud
```

### Test Configuration

```typescript
// tests/e2e/voter-protocol/test-utils.ts
export const TEST_CONFIG = {
  SHADOW_ATLAS_URL: 'http://localhost:3000',
  DIDIT_WEBHOOK_SECRET: 'test-webhook-secret',
  PROVER_DEPTH: 20,
  PROVER_TIMEOUT_MS: 60000
};
```

## Best Practices

### 1. Use Factories for Test Data

```typescript
// Good: Use factory with specific overrides
const webhook = createMockDiditWebhook({
  userId: 'specific-user',
  status: 'Approved'
});

// Avoid: Hardcoding entire payloads
const webhook = { type: 'status.updated', data: { ... } };
```

### 2. Reset State Between Tests

```typescript
beforeEach(() => {
  server.resetHandlers();
  vi.clearAllMocks();
});
```

### 3. Test One Behavior Per Test

```typescript
// Good: Single assertion focus
it('should reject expired verification status', () => {
  expect(() => parseVerificationResult(expiredWebhook)).toThrow('Expired');
});

// Avoid: Multiple unrelated assertions
it('should handle verification', () => {
  // Tests expired, rejected, AND pending in one test
});
```

### 4. Use Descriptive Test Names

```typescript
// Good
it('should reject webhook with tampered payload')
it('should handle coordinates exactly on district boundary')

// Avoid
it('test webhook')
it('boundary test')
```

## Debugging Tests

### Enable Verbose Logging

```bash
DEBUG=msw* npx vitest run tests/e2e/voter-protocol
```

### Inspect Network Requests

```typescript
server.listen({
  onUnhandledRequest: 'warn'  // or 'error' to fail on unhandled
});
```

### Check Assertion Details

```typescript
// Use toMatchObject for partial matching
expect(result).toMatchObject({
  district: expect.objectContaining({ id: 'usa-ca-sf-d5' })
});
```

## Adding New Tests

### 1. Create Test Scenario

Add to `fixtures.ts`:

```typescript
export const NEW_TEST_SCENARIO = {
  user: { ... },
  coordinates: { ... },
  proofInputs: { ... },
  expectedOutcome: 'success'
};
```

### 2. Add Handler if Needed

Add to `test-utils.ts`:

```typescript
export function createNewServiceHandlers(options?: {...}) {
  return [
    http.get('/new-endpoint', () => { ... })
  ];
}
```

### 3. Write Test

```typescript
describe('New Feature', () => {
  it('should handle new scenario', async () => {
    const scenario = NEW_TEST_SCENARIO;
    // Test implementation
  });
});
```

## Continuous Integration

These tests run in CI on every PR:

```yaml
# .github/workflows/test.yml
- name: Run E2E Tests
  run: npm run test:e2e:voter
  env:
    SHADOW_ATLAS_API_URL: ${{ secrets.SHADOW_ATLAS_TEST_URL }}
```

## Related Documentation

- [ZK Prover Integration](../architecture/zk-prover-integration.md)
- [Congressional Submit Implementation](../congressional/congressional-submit.md)
