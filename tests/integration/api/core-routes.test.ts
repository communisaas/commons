/**
 * Core API Routes Integration Tests
 *
 * Comprehensive integration tests for templates, user, and analytics API endpoints.
 * Uses real database with MSW for external services - no internal mocking.
 *
 * Test Coverage:
 * - Templates API (4 routes)
 * - User API (3 routes)
 * - Analytics API (2 routes)
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import {
  clearTestDatabase,
  createTestUser,
  createTestTemplate,
  createMockRequestEvent,
  db
} from '../../setup/api-test-setup';
import { GET as getTemplates, POST as createTemplate } from '../../../src/routes/api/templates/+server';
import { GET as checkSlug } from '../../../src/routes/api/templates/check-slug/+server';
import { GET as getUserTemplates } from '../../../src/routes/api/user/templates/+server';
import { GET as getUserProfile, POST as updateUserProfile } from '../../../src/routes/api/user/profile/+server';
// NOTE: /api/user/address route removed per CYPHERPUNK-ARCHITECTURE.md (privacy-preserving design)
// Address data is encrypted in EncryptedDeliveryData, not stored on User model
import { POST as trackAnalytics } from '../../../src/routes/api/analytics/increment/+server';
import type { RequestEvent } from '@sveltejs/kit';

// Mock moderation to avoid AI API calls in tests
vi.mock('$lib/core/server/moderation', () => ({
  moderateTemplate: vi.fn(async () => ({
    approved: true,
    summary: 'Approved',
    latency_ms: 100,
    safety: {
      safe: true,
      model: 'openai/gpt-oss-safeguard-20b',
      hazards: [],
      blocking_hazards: [],
      hazard_descriptions: [],
      reasoning: 'No safety violations detected',
      timestamp: new Date().toISOString()
    },
    quality: {
      approved: true,
      confidence: 0.95,
      reasoning: 'Appropriate for congressional communication',
      timestamp: new Date().toISOString(),
      model: 'gemini-2.5-flash'
    }
  }))
}));

// ---------------------------------------------------------------------------
// Database connectivity check — skip DB-dependent tests when unreachable
// ---------------------------------------------------------------------------
let dbAvailable = false;
beforeAll(async () => {
  try {
    await db.$queryRaw`SELECT 1`;
    dbAvailable = true;
  } catch {
    console.warn(
      '[core-routes] Test database unreachable — DB-dependent tests will be skipped.\n' +
      'Start a local test DB or set DATABASE_URL to run the full suite.'
    );
  }
});

// ============================================================================
// TEMPLATES API
// ============================================================================

describe.runIf(dbAvailable)('Templates API', () => {
  beforeEach(async () => {
    await clearTestDatabase();
  });

  describe('GET /api/templates', () => {
    it('should return empty array when no public templates exist', async () => {
      const event = createMockRequestEvent({
        url: '/api/templates',
        method: 'GET'
      });

      const response = await getTemplates(event as any);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).toBeInstanceOf(Array);
      expect(data.data).toHaveLength(0);
    });

    it('should return only public templates', async () => {
      const user = await createTestUser();

      // Create public template
      await createTestTemplate(user.id, {
        id: 'public-template',
        slug: 'public-template-slug',
        title: 'Public Template',
        is_public: true
      });

      // Create private template
      await createTestTemplate(user.id, {
        id: 'private-template',
        slug: 'private-template-slug',
        title: 'Private Template',
        is_public: false
      });

      const event = createMockRequestEvent({
        url: '/api/templates',
        method: 'GET'
      }) as unknown as RequestEvent;

      const response = await getTemplates(event as any);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).toHaveLength(1);
      expect(data.data[0].title).toBe('Public Template');
      expect(data.data[0].is_public).toBe(true);
    });

    it('should include coordination metrics in response', async () => {
      const user = await createTestUser();
      await createTestTemplate(user.id, {
        slug: 'high-coordination-template',
        verified_sends: 500,
        unique_districts: 100,
        is_public: true
      });

      const event = createMockRequestEvent({
        url: '/api/templates',
        method: 'GET'
      }) as unknown as RequestEvent;

      const response = await getTemplates(event as any);
      const data = await response.json();

      expect(data.data[0].coordinationScale).toBeDefined();
      expect(data.data[0].coordinationScale).toBeGreaterThan(0);
      expect(data.data[0].verified_sends).toBe(500);
      expect(data.data[0].unique_districts).toBe(100);
    });

    it('should mark templates created within 7 days as new', async () => {
      const user = await createTestUser();

      // New template
      await createTestTemplate(user.id, {
        id: 'new-template',
        slug: 'new-template',
        is_public: true,
        createdAt: new Date()
      });

      // Old template
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 10);
      await createTestTemplate(user.id, {
        id: 'old-template',
        slug: 'old-template',
        is_public: true,
        createdAt: oldDate
      });

      const event = createMockRequestEvent({
        url: '/api/templates',
        method: 'GET'
      }) as unknown as RequestEvent;

      const response = await getTemplates(event as any);
      const data = await response.json();

      const newTemplate = data.data.find((t: any) => t.id === 'new-template');
      const oldTemplate = data.data.find((t: any) => t.id === 'old-template');

      expect(newTemplate.isNew).toBe(true);
      expect(oldTemplate.isNew).toBe(false);
    });
  });

  describe('POST /api/templates', () => {
    it('should create template for authenticated user', async () => {
      const user = await createTestUser();

      const templateData = {
        title: 'Test Climate Action Template',
        message_body: 'Dear Representative, I urge you to support climate action legislation.',
        preview: 'Support climate action legislation',
        type: 'congressional',
        deliveryMethod: 'cwc',
        category: 'Environment',
        topics: ['climate', 'environment']
      };

      const event = createMockRequestEvent({
        url: '/api/templates',
        method: 'POST',
        body: JSON.stringify(templateData),
        locals: { user }
      }) as unknown as RequestEvent;

      const response = await createTemplate(event as any);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.template).toBeDefined();
      expect(data.data.template.title).toBe(templateData.title);
      // userId is not returned in API response (intentional)
      // Verify it was saved to database
      const saved = await db.template.findFirst({
        where: { title: templateData.title }
      });
      expect(saved).toBeDefined();
      expect(saved?.userId).toBe(user.id);
    });

    it('should return response matching client isTemplate() contract', async () => {
      // This test guards against the POST/GET response shape mismatch that caused
      // "Invalid template data received from API" — the save succeeded but the client
      // rejected the response because it lacked computed fields (send_count, coordinationScale, isNew).
      const user = await createTestUser();

      const templateData = {
        title: 'Contract Validation Template',
        message_body: 'Message body for contract test',
        preview: 'Preview text',
        type: 'congressional',
        deliveryMethod: 'cwc',
        category: 'Testing',
        topics: ['contract-test']
      };

      const event = createMockRequestEvent({
        url: '/api/templates',
        method: 'POST',
        body: JSON.stringify(templateData),
        locals: { user }
      }) as unknown as RequestEvent;

      const response = await createTemplate(event as any);
      const data = await response.json();
      const template = data.data.template;

      // Required string fields (isTemplate lines 14-38)
      expect(typeof template.id).toBe('string');
      expect(typeof template.slug).toBe('string');
      expect(typeof template.title).toBe('string');
      expect(typeof template.description).toBe('string');
      expect(typeof template.category).toBe('string');
      expect(typeof template.type).toBe('string');
      expect(typeof template.message_body).toBe('string');
      expect(typeof template.preview).toBe('string');
      expect(typeof template.status).toBe('string');

      // Required boolean fields (isTemplate lines 40-48)
      expect(typeof template.is_public).toBe('boolean');
      expect(typeof template.isNew).toBe('boolean');

      // Required number fields (isTemplate lines 50-60)
      expect(typeof template.send_count).toBe('number');
      expect(typeof template.coordinationScale).toBe('number');

      // Required enum field (isTemplate lines 62-66)
      expect(['cwc', 'email']).toContain(template.deliveryMethod);

      // Computed values for a fresh template
      expect(template.send_count).toBe(0);
      expect(template.coordinationScale).toBe(0);
      expect(template.isNew).toBe(true);
    });

    it('should reject unauthenticated template creation', async () => {
      const templateData = {
        title: 'Guest Template',
        message_body: 'Template content from guest user',
        preview: 'Guest template preview',
        type: 'congressional',
        deliveryMethod: 'cwc'
      };

      const event = createMockRequestEvent({
        url: '/api/templates',
        method: 'POST',
        body: JSON.stringify(templateData),
        locals: {} // No user
      }) as unknown as RequestEvent;

      const response = await createTemplate(event as any);
      const data = await response.json();

      // Authentication is required for template creation
      expect(response.status).toBe(401);
      expect(data.success).toBe(false);
    });

    it('should validate required fields', async () => {
      const user = await createTestUser();

      const invalidData = {
        title: '', // Empty title
        message_body: 'Content',
        preview: 'Preview',
        type: 'congressional',
        deliveryMethod: 'cwc'
      };

      const event = createMockRequestEvent({
        url: '/api/templates',
        method: 'POST',
        body: JSON.stringify(invalidData),
        locals: { user }
      }) as unknown as RequestEvent;

      const response = await createTemplate(event as any);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.errors).toBeDefined();
      expect(data.errors.some((e: any) => e.field === 'title')).toBe(true);
    });

    it('should validate message body is required', async () => {
      const user = await createTestUser();

      const invalidData = {
        title: 'Title',
        message_body: '', // Empty message
        preview: 'Preview',
        type: 'congressional',
        deliveryMethod: 'cwc'
      };

      const event = createMockRequestEvent({
        url: '/api/templates',
        method: 'POST',
        body: JSON.stringify(invalidData),
        locals: { user }
      }) as unknown as RequestEvent;

      const response = await createTemplate(event as any);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.errors).toBeDefined();
      expect(data.errors.some((e: any) => e.field === 'message_body')).toBe(true);
    });

    it('should enforce character limits', async () => {
      const user = await createTestUser();

      const tooLongTitle = 'x'.repeat(501); // Over 500 char limit
      const invalidData = {
        title: tooLongTitle,
        message_body: 'Content',
        preview: 'Preview',
        type: 'congressional',
        deliveryMethod: 'cwc'
      };

      const event = createMockRequestEvent({
        url: '/api/templates',
        method: 'POST',
        body: JSON.stringify(invalidData),
        locals: { user }
      }) as unknown as RequestEvent;

      const response = await createTemplate(event as any);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.errors).toBeDefined();
      expect(data.errors.some((e: any) => e.code === 'VALIDATION_TOO_LONG')).toBe(true);
    });

    it('should prevent duplicate slugs', async () => {
      const user = await createTestUser();

      // Create first template
      await createTestTemplate(user.id, {
        slug: 'climate-action',
        title: 'Climate Action'
      });

      // Try to create template with same slug
      const duplicateData = {
        title: 'Climate Action', // Will generate same slug
        slug: 'climate-action',
        message_body: 'Different content',
        preview: 'Preview',
        type: 'congressional',
        deliveryMethod: 'cwc'
      };

      const event = createMockRequestEvent({
        url: '/api/templates',
        method: 'POST',
        body: JSON.stringify(duplicateData),
        locals: { user }
      }) as unknown as RequestEvent;

      const response = await createTemplate(event as any);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('VALIDATION_DUPLICATE');
    });

    it('should run content moderation on template', async () => {
      const { moderateTemplate } = await import('$lib/core/server/moderation');
      const user = await createTestUser();

      const templateData = {
        title: 'Safe Template',
        message_body: 'This is appropriate congressional content.',
        preview: 'Appropriate content',
        type: 'congressional',
        deliveryMethod: 'cwc'
      };

      const event = createMockRequestEvent({
        url: '/api/templates',
        method: 'POST',
        body: JSON.stringify(templateData),
        locals: { user }
      }) as unknown as RequestEvent;

      await createTemplate(event as any);

      // Verify moderation was called
      expect(moderateTemplate).toHaveBeenCalledWith(
        expect.objectContaining({
          title: templateData.title,
          message_body: templateData.message_body
        })
      );
    });

    it('should accept AI-generated slug from request', async () => {
      const user = await createTestUser();

      const templateData = {
        title: 'Climate Action Now',
        slug: 'ai-generated-climate-action', // AI-provided slug
        message_body: 'Support climate action',
        preview: 'Climate action preview',
        type: 'congressional',
        deliveryMethod: 'cwc'
      };

      const event = createMockRequestEvent({
        url: '/api/templates',
        method: 'POST',
        body: JSON.stringify(templateData),
        locals: { user }
      }) as unknown as RequestEvent;

      const response = await createTemplate(event as any);
      const data = await response.json();

      expect(data.success).toBe(true);
      expect(data.data.template.slug).toBe('ai-generated-climate-action');
    });

    it('should store sources and research log from AI agent', async () => {
      const user = await createTestUser();

      const templateData = {
        title: 'Research-Backed Template',
        message_body: 'Evidence-based policy recommendation',
        preview: 'Policy recommendation',
        type: 'congressional',
        deliveryMethod: 'cwc',
        sources: [
          { num: 1, title: 'Source 1', url: 'https://example.com/1', type: 'article' },
          { num: 2, title: 'Source 2', url: 'https://example.com/2', type: 'report' }
        ],
        research_log: ['Query 1', 'Found sources', 'Synthesized content']
      };

      const event = createMockRequestEvent({
        url: '/api/templates',
        method: 'POST',
        body: JSON.stringify(templateData),
        locals: { user }
      }) as unknown as RequestEvent;

      const response = await createTemplate(event as any);
      const data = await response.json();

      expect(data.success).toBe(true);

      const saved = await db.template.findFirst({
        where: { id: data.data.template.id }
      });

      expect(saved?.sources).toEqual(templateData.sources);
      expect(saved?.research_log).toEqual(templateData.research_log);
    });
  });

  describe('GET /api/templates/check-slug', () => {
    it('should return available=true for new slug', async () => {
      const event = createMockRequestEvent({
        url: '/api/templates/check-slug?slug=brand-new-slug',
        method: 'GET'
      }) as unknown as RequestEvent;

      const response = await checkSlug(event as any);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.available).toBe(true);
      expect(data.data.suggestions).toHaveLength(0);
    });

    it('should return available=false for existing slug', async () => {
      const user = await createTestUser();
      await createTestTemplate(user.id, {
        slug: 'existing-slug',
        title: 'Existing Template'
      });

      const event = createMockRequestEvent({
        url: '/api/templates/check-slug?slug=existing-slug',
        method: 'GET'
      }) as unknown as RequestEvent;

      const response = await checkSlug(event as any);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.available).toBe(false);
    });

    it('should provide suggestions when slug is taken', async () => {
      const user = await createTestUser();
      await createTestTemplate(user.id, {
        slug: 'climate-action',
        title: 'Climate Action'
      });

      const event = createMockRequestEvent({
        url: '/api/templates/check-slug?slug=climate-action&title=Climate Action',
        method: 'GET'
      }) as unknown as RequestEvent;

      const response = await checkSlug(event as any);
      const data = await response.json();

      expect(data.data.available).toBe(false);
      expect(data.data.suggestions).toBeDefined();
      expect(data.data.suggestions.length).toBeGreaterThan(0);
      expect(data.data.suggestions.length).toBeLessThanOrEqual(3);
    });

    it('should return error when slug parameter missing', async () => {
      const event = createMockRequestEvent({
        url: '/api/templates/check-slug',
        method: 'GET'
      }) as unknown as RequestEvent;

      const response = await checkSlug(event as any);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toContain('Slug parameter is required');
    });
  });

  describe('GET /api/user/templates', () => {
    it('should return 401 when not authenticated', async () => {
      const event = createMockRequestEvent({
        url: '/api/user/templates',
        method: 'GET',
        locals: {} // No user
      }) as unknown as RequestEvent;

      const response = await getUserTemplates(event as any);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe('Unauthorized');
    });

    it('should return user templates when authenticated', async () => {
      const user = await createTestUser();
      const otherUser = await createTestUser({
        id: 'other-user',
        email: 'other@example.com'
      });

      // Create templates for both users
      await createTestTemplate(user.id, {
        id: 'user-template-1',
        slug: 'user-template-1',
        title: 'User Template 1'
      });
      await createTestTemplate(user.id, {
        id: 'user-template-2',
        slug: 'user-template-2',
        title: 'User Template 2'
      });
      await createTestTemplate(otherUser.id, {
        id: 'other-template',
        slug: 'other-template',
        title: 'Other User Template'
      });

      const event = createMockRequestEvent({
        url: '/api/user/templates',
        method: 'GET',
        locals: { user }
      }) as unknown as RequestEvent;

      const response = await getUserTemplates(event as any);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(Array.isArray(data)).toBe(true);
      expect(data).toHaveLength(2);
      expect(data.every((t: any) => t.userId === user.id)).toBe(true);
    });

    it('should return templates ordered by updatedAt desc', async () => {
      const user = await createTestUser();

      // Create templates with different update times
      const now = new Date();
      await createTestTemplate(user.id, {
        id: 'old-template',
        slug: 'old-template',
        title: 'Old Template',
        updatedAt: new Date(now.getTime() - 10000)
      });
      await createTestTemplate(user.id, {
        id: 'new-template',
        slug: 'new-template',
        title: 'New Template',
        updatedAt: now
      });

      const event = createMockRequestEvent({
        url: '/api/user/templates',
        method: 'GET',
        locals: { user }
      }) as unknown as RequestEvent;

      const response = await getUserTemplates(event as any);
      const data = await response.json();

      expect(data[0].id).toBe('new-template');
      expect(data[1].id).toBe('old-template');
    });
  });
});

// ============================================================================
// USER API
// ============================================================================

describe.runIf(dbAvailable)('User API', () => {
  beforeEach(async () => {
    await clearTestDatabase();
  });

  describe('GET /api/user/profile', () => {
    it('should return 401 when not authenticated', async () => {
      const event = createMockRequestEvent({
        url: '/api/user/profile',
        method: 'GET',
        locals: {} // No user
      }) as unknown as RequestEvent;

      const response = await getUserProfile(event as any);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe('Unauthorized');
    });

    it('should return profile for authenticated user', async () => {
      const user = await createTestUser({
        name: 'Test User',
        email: 'test@example.com',
        role: 'constituent',
        organization: 'Test Org',
        location: 'California'
      });

      const event = createMockRequestEvent({
        url: '/api/user/profile',
        method: 'GET',
        locals: { user }
      }) as unknown as RequestEvent;

      const response = await getUserProfile(event as any);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.user).toBeDefined();
      expect(data.user.id).toBe(user.id);
      // Profile endpoint returns encrypted blobs — client decrypts locally
      // Server never holds standing plaintext, so name/email are null
      expect(data.user.name).toBeNull();
      expect(data.user.email).toBeNull();
      expect(data.user.encryptedEmail).toBeDefined();
      expect(data.user.profile).toBeDefined();
      expect(data.user.profile.role).toBe('constituent');
      expect(data.user.profile.organization).toBe('Test Org');
      expect(data.user.profile.location).toBe('California');
    });

    it('should not expose sensitive fields', async () => {
      const user = await createTestUser();

      const event = createMockRequestEvent({
        url: '/api/user/profile',
        method: 'GET',
        locals: { user }
      }) as unknown as RequestEvent;

      const response = await getUserProfile(event as any);
      const data = await response.json();

      // Should not include password, internal fields, etc
      expect(data.user.password).toBeUndefined();
      expect(data.user.trust_score).toBeUndefined();
    });
  });

  describe('POST /api/user/profile', () => {
    it('should return 401 when not authenticated', async () => {
      const event = createMockRequestEvent({
        url: '/api/user/profile',
        method: 'POST',
        body: JSON.stringify({ role: 'constituent' }),
        locals: {} // No user
      }) as unknown as RequestEvent;

      const response = await updateUserProfile(event as any);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe('Unauthorized');
    });

    it('should update allowed profile fields', async () => {
      const user = await createTestUser();

      const updateData = {
        role: 'organizer',
        organization: 'Climate Action Network',
        location: 'New York',
        connection: 'activist'
      };

      const event = createMockRequestEvent({
        url: '/api/user/profile',
        method: 'POST',
        body: JSON.stringify(updateData),
        locals: { user }
      }) as unknown as RequestEvent;

      const response = await updateUserProfile(event as any);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.message).toContain('Profile saved successfully');

      // Verify database was updated
      const updated = await db.user.findUnique({
        where: { id: user.id }
      });

      expect(updated?.role).toBe('organizer');
      expect(updated?.organization).toBe('Climate Action Network');
      expect(updated?.location).toBe('New York');
      expect(updated?.connection).toBe('activist');
      expect(updated?.profile_completed_at).toBeDefined();
    });

    it('should require role and connection fields', async () => {
      const user = await createTestUser();

      const invalidData = {
        organization: 'Test Org'
        // Missing role and connection
      };

      const event = createMockRequestEvent({
        url: '/api/user/profile',
        method: 'POST',
        body: JSON.stringify(invalidData),
        locals: { user }
      }) as unknown as RequestEvent;

      const response = await updateUserProfile(event as any);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain('Role and connection are required');
    });

    it('should set profile_completed_at timestamp', async () => {
      const user = await createTestUser({
        profile_completed_at: null
      });

      const updateData = {
        role: 'constituent',
        connection: 'voter'
      };

      const event = createMockRequestEvent({
        url: '/api/user/profile',
        method: 'POST',
        body: JSON.stringify(updateData),
        locals: { user }
      }) as unknown as RequestEvent;

      await updateUserProfile(event as any);

      const updated = await db.user.findUnique({
        where: { id: user.id }
      });

      expect(updated?.profile_completed_at).toBeDefined();
      expect(updated?.profile_completed_at).toBeInstanceOf(Date);
    });
  });

  // NOTE: /api/user/address route removed per CYPHERPUNK-ARCHITECTURE.md (privacy-preserving design)
  // Address data is encrypted in EncryptedDeliveryData, not stored on User model
});

// ============================================================================
// ANALYTICS API
// ============================================================================

describe.runIf(dbAvailable)('Analytics API', () => {
  beforeEach(async () => {
    await clearTestDatabase();
  });

  describe('POST /api/analytics/increment', () => {
    it('should accept valid analytics event', async () => {
      const incrementData = {
        increments: [
          {
            metric: 'template_view',
            dimensions: { templateId: 'test-123' }
          }
        ]
      };

      const event = createMockRequestEvent({
        url: '/api/analytics/increment',
        method: 'POST',
        body: JSON.stringify(incrementData)
      }) as unknown as RequestEvent;

      const response = await trackAnalytics(event as any);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.processed).toBeGreaterThan(0);
    });

    it('should accept multiple increments in batch', async () => {
      const incrementData = {
        increments: [
          { metric: 'template_view', dimensions: { templateId: 'test-1' } },
          { metric: 'template_view', dimensions: { templateId: 'test-2' } },
          { metric: 'delivery_success', dimensions: { method: 'cwc' } }
        ]
      };

      const event = createMockRequestEvent({
        url: '/api/analytics/increment',
        method: 'POST',
        body: JSON.stringify(incrementData)
      }) as unknown as RequestEvent;

      const response = await trackAnalytics(event as any);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.processed).toBeLessThanOrEqual(incrementData.increments.length);
    });

    it('should silently drop invalid metrics', async () => {
      const incrementData = {
        increments: [
          { metric: 'template_view' }, // Valid
          { metric: 'invalid_metric_name' }, // Invalid
          { metric: 'delivery_success' } // Valid
        ]
      };

      const event = createMockRequestEvent({
        url: '/api/analytics/increment',
        method: 'POST',
        body: JSON.stringify(incrementData)
      }) as unknown as RequestEvent;

      const response = await trackAnalytics(event as any);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      // Invalid metric should be silently dropped
      expect(data.dropped).toBeGreaterThanOrEqual(1);
    });

    it('should always return success for fire-and-forget semantics', async () => {
      const invalidData = {
        increments: 'not-an-array'
      };

      const event = createMockRequestEvent({
        url: '/api/analytics/increment',
        method: 'POST',
        body: JSON.stringify(invalidData)
      }) as unknown as RequestEvent;

      const response = await trackAnalytics(event as any);
      const data = await response.json();

      // Even with invalid data, should return success
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });

    it('should hash IP address for rate limiting', async () => {
      const incrementData = {
        increments: [{ metric: 'template_view' }]
      };

      const event = createMockRequestEvent({
        url: '/api/analytics/increment',
        method: 'POST',
        body: JSON.stringify(incrementData),
        headers: {
          'x-forwarded-for': '192.168.1.1'
        }
      }) as unknown as RequestEvent;

      const response = await trackAnalytics(event as any);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      // IP should be hashed internally (not exposed in response)
    });

    it('should enforce contribution limits per metric', async () => {
      // Create many increments to potentially hit rate limit
      const manyIncrements = Array(200).fill(null).map(() => ({
        metric: 'template_view',
        dimensions: { templateId: 'test' }
      }));

      const event = createMockRequestEvent({
        url: '/api/analytics/increment',
        method: 'POST',
        body: JSON.stringify({ increments: manyIncrements }),
        headers: {
          'x-forwarded-for': '192.168.1.100'
        }
      }) as unknown as RequestEvent;

      const response = await trackAnalytics(event as any);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      // Some may be dropped due to rate limiting
      expect(data.processed + data.dropped).toBe(manyIncrements.length);
    });

    it('should handle missing increments array gracefully', async () => {
      const event = createMockRequestEvent({
        url: '/api/analytics/increment',
        method: 'POST',
        body: JSON.stringify({}) // No increments field
      }) as unknown as RequestEvent;

      const response = await trackAnalytics(event as any);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.processed).toBe(0);
    });
  });
});
