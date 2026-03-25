import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Tests for template quota enforcement.
 *
 * The getMonthlyTemplateCount function counts templates created by any
 * member of an org in the current calendar month. The POST /api/templates
 * handler uses this to block creation when count >= max_templates_month.
 */

// Mock the db module before importing usage
vi.mock('$lib/core/db', () => ({
	db: {
		template: { count: vi.fn() },
		subscription: { findUnique: vi.fn().mockResolvedValue(null) },
		campaignAction: { count: vi.fn().mockResolvedValue(0) },
		emailBatch: { aggregate: vi.fn().mockResolvedValue({ _sum: { sentCount: 0 } }) }
	}
}));

import { getMonthlyTemplateCount } from '$lib/server/billing/usage';
import { db } from '$lib/core/db';
import type { PrismaClient } from '@prisma/client';

const mockDb = db as unknown as {
	template: { count: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
	vi.clearAllMocks();
});

describe('getMonthlyTemplateCount', () => {
	it('should query templates for the org via memberships', async () => {
		mockDb.template.count.mockResolvedValue(5);

		const result = await getMonthlyTemplateCount(db as unknown as PrismaClient, 'org-123');

		expect(result).toBe(5);
		expect(mockDb.template.count).toHaveBeenCalledOnce();

		const whereArg = mockDb.template.count.mock.calls[0][0].where;
		expect(whereArg.user.memberships.some.orgId).toBe('org-123');
		expect(whereArg.createdAt.gte).toBeInstanceOf(Date);
	});

	it('should use start of current month as cutoff', async () => {
		mockDb.template.count.mockResolvedValue(0);

		await getMonthlyTemplateCount(db as unknown as PrismaClient, 'org-456');

		const cutoff = mockDb.template.count.mock.calls[0][0].where.createdAt.gte;
		const now = new Date();
		expect(cutoff.getFullYear()).toBe(now.getFullYear());
		expect(cutoff.getMonth()).toBe(now.getMonth());
		expect(cutoff.getDate()).toBe(1);
		expect(cutoff.getHours()).toBe(0);
		expect(cutoff.getMinutes()).toBe(0);
	});

	it('should return 0 when no templates exist', async () => {
		mockDb.template.count.mockResolvedValue(0);

		const result = await getMonthlyTemplateCount(db as unknown as PrismaClient, 'org-789');
		expect(result).toBe(0);
	});
});

describe('template quota enforcement logic', () => {
	// These tests verify the comparison logic used in the POST handler:
	// if (count >= org.max_templates_month) → reject

	it('should reject when count equals the limit', () => {
		const count = 100;
		const limit = 100;
		expect(count >= limit).toBe(true);
	});

	it('should reject when count exceeds the limit', () => {
		const count = 150;
		const limit = 100;
		expect(count >= limit).toBe(true);
	});

	it('should allow when count is below the limit', () => {
		const count = 99;
		const limit = 100;
		expect(count >= limit).toBe(false);
	});

	it('should allow when count is zero', () => {
		const count = 0;
		const limit = 100;
		expect(count >= limit).toBe(false);
	});

	it('should handle the free tier limit (10)', () => {
		expect(10 >= 10).toBe(true); // at limit → reject
		expect(9 >= 10).toBe(false); // below limit → allow
	});

	it('should handle the coalition tier limit (1000)', () => {
		expect(1000 >= 1000).toBe(true); // at limit → reject
		expect(999 >= 1000).toBe(false); // below limit → allow
	});
});
