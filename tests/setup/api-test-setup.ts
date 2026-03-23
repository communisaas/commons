/**
 * API Test Setup Infrastructure
 * 
 * Provides real database testing with MSW for external services.
 * No more mocking internal business logic - test the real code paths.
 */

import { beforeAll, afterAll, beforeEach } from 'vitest';
import { setupServer } from 'msw/node';
import { externalServiceHandlers } from '../mocks/external-services';
import { PrismaClient } from '@prisma/client';

// Test-specific database client that doesn't depend on SvelteKit env
const testDb = new PrismaClient({
  datasourceUrl: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test',
  log: ['error']
});

export const db = testDb;

// MSW server for external service mocking
export const server = setupServer(...externalServiceHandlers);

// Start MSW server before all tests
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

// Reset MSW handlers between tests
beforeEach(() => {
  server.resetHandlers();
});

// Clean up MSW server after all tests
afterAll(() => {
  server.close();
});

/**
 * Test Database Utilities
 * 
 * Uses real Prisma client with test database for integration testing.
 * Provides isolation and cleanup between tests.
 */

export async function clearTestDatabase() {
  // Clear in STRICT reverse dependency order to avoid foreign key constraints
  // Order: Children → Parents (leaf nodes first, root last)
  //
  // WARNING: Avoid calling this in beforeEach hooks in parallel test environments!
  // Tests running in parallel (maxForks: 4) can have their data deleted mid-test.
  // Prefer using unique IDs per test run for isolation instead.
  try {
    // Leaf nodes (no other tables depend on them)
    await db.template_campaign.deleteMany();

    // DecisionMaker relationships (new path)
    await db.userDMRelation.deleteMany();
    await db.externalId.deleteMany();
    await db.decisionMaker.deleteMany();

    // Templates (depend on users)
    await db.template.deleteMany();

    // Auth sessions and accounts
    await db.session.deleteMany();
    await db.account.deleteMany();

    // Root: Users (everything depends on this)
    await db.user.deleteMany();
  } catch (error) {
    // In tests, we want loud failures to catch schema issues
    throw new Error(`Database cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function createTestUser(overrides?: Partial<any>) {
  return await db.user.create({
    data: {
      id: 'test-user-123',
      encrypted_email: 'encrypted-test@example.com',
      email_hash: `hash-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      encrypted_name: 'encrypted-Test User',
      trust_score: 100,
      // NO PII FIELDS - address data never stored in database per privacy architecture
      is_verified: true,
      ...overrides
    }
  });
}

export async function createTestTemplate(userId: string, overrides?: Partial<any>) {
  return await db.template.create({
    data: {
      id: 'test-template-123',
      slug: 'test-congressional-template',
      userId: userId, // Fix field name
      title: 'Test Congressional Template',
      description: 'A test template for congressional messaging',
      message_body: 'Dear [Representative Name], I am writing to express my views on [Issue]. [Personal Connection]. Thank you.',
      category: 'legislative',
      is_public: true,
      type: 'congressional',
      deliveryMethod: 'cwc',
      preview: 'Congressional template for expressing views',
      delivery_config: {},
      recipient_config: {},
      metrics: {},
      ...overrides
    }
  });
}

export async function createTestDecisionMaker(overrides?: Partial<any>) {
  const dm = await db.decisionMaker.create({
    data: {
      id: 'test-dm-123',
      type: 'legislator',
      name: 'Test Representative',
      firstName: 'Test',
      lastName: 'Representative',
      party: 'Democratic',
      jurisdiction: 'CA',
      jurisdictionLevel: 'federal',
      district: '12',
      title: 'Representative',
      active: true,
      ...overrides
    }
  });
  // Create bioguide ExternalId if bioguideId provided
  if (overrides?.bioguideId) {
    await db.externalId.create({
      data: {
        decisionMakerId: dm.id,
        system: 'bioguide',
        value: overrides.bioguideId
      }
    });
  }
  return dm;
}

export async function createTestSubmission(templateId: string, userId: string, overrides?: Partial<any>) {
  return await db.submission.create({
    data: {
      id: 'test-submission-123',
      pseudonymous_id: 'anon-' + userId,
      template_id: templateId,
      proof_hex: '0x1234567890',
      public_inputs: {},
      nullifier: 'null-' + Math.random(),
      action_id: templateId,
      encrypted_witness: 'encrypted',
      delivery_status: 'pending',
      created_at: new Date(),
      updated_at: new Date(),
      ...overrides
    }
  });
}

/**
 * API Test Helpers
 * 
 * Utilities for testing SvelteKit API routes with real request/response handling.
 */

export function createMockRequest(options: {
  url: string;
  method: string;
  body?: string;
  headers?: Record<string, string>;
  params?: Record<string, string>;
}) {
  const url = new URL(options.url, 'http://localhost:5173');
  
  return new Request(url.toString(), {
    method: options.method,
    body: options.body,
    headers: {
      'content-type': 'application/json',
      ...options.headers
    }
  });
}

export function createMockRequestEvent<
  Params extends Record<string, string> = Record<string, string>,
  RouteId extends string = string
>(options: {
  url: string;
  method: string;
  body?: string;
  headers?: Record<string, string>;
  params?: Record<string, string>;
  locals?: Record<string, any>;
}) {
  const request = createMockRequest(options);

  // Mock span for tracing
  const mockSpan = {
    setAttribute: () => {},
    setAttributes: () => {},
    addEvent: () => {},
    setStatus: () => {},
    updateName: () => {},
    end: () => {},
    isRecording: () => false,
    recordException: () => {}
  };

  return {
    request,
    params: (options.params || {}) as Params,
    url: new URL(options.url, 'http://localhost:5173'),
    locals: {
      // Provide database instances for API routes
      db: testDb,
      analyticsDb: testDb,
      user: null,
      session: null,
      ...options.locals
    },
    cookies: {
      get: () => undefined,
      getAll: () => [],
      set: () => {},
      delete: () => {},
      serialize: () => ''
    },
    fetch: global.fetch,
    getClientAddress: () => '127.0.0.1',
    platform: null,
    setHeaders: () => {},
    isDataRequest: false,
    isSubRequest: false,
    route: { id: options.url as RouteId },
    tracing: {
      enabled: false,
      root: mockSpan as unknown,
      current: mockSpan as unknown
    },
    isRemoteRequest: false
  };
}

/**
 * Test Session Helpers
 * 
 * For testing authenticated vs anonymous user flows.
 */

export async function createTestSession(userId: string) {
  const session = await db.session.create({
    data: {
      id: 'test-session-123',
      userId: userId,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
      createdAt: new Date()
    }
  });

  return {
    session,
    sessionCookie: `auth_session=${session.id}; Path=/; HttpOnly; SameSite=Lax`
  };
}

export function createGuestSession() {
  return {
    sessionToken: 'guest-token-123',
    sessionCookie: `guest_session=guest-token-123; Path=/; SameSite=Lax`
  };
}

/**
 * Test Data Cleanup
 *
 * IMPORTANT: No global beforeEach cleanup to avoid race conditions with parallel tests.
 * Each test file should call clearTestDatabase() in its own beforeEach hook.
 *
 * Why: Vitest runs tests in parallel (maxForks: 4). A global beforeEach clears
 * the database while other tests are creating data, causing foreign key violations.
 */

// REMOVED: Global beforeEach that caused race conditions
// beforeEach(async () => {
//   await clearTestDatabase();
// });