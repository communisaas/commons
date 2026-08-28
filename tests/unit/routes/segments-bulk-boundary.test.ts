import { beforeEach, describe, expect, it, vi } from 'vitest';

const { api, mockServerAction, mockServerMutation, mockServerQuery, mockRateLimitCheck } =
	vi.hoisted(() => ({
		api: {
			segments: {
				list: 'segments.list',
				countMatching: 'segments.countMatching',
				create: 'segments.create',
				update: 'segments.update',
				remove: 'segments.remove',
				bulkApplyTag: 'segments.bulkApplyTag',
				bulkRemoveTag: 'segments.bulkRemoveTag',
				exportDecrypted: 'segments.exportDecrypted'
			}
		},
		mockServerAction: vi.fn(),
		mockServerMutation: vi.fn(),
		mockServerQuery: vi.fn(),
		mockRateLimitCheck: vi.fn()
	}));

vi.mock('$lib/convex', () => ({ api }));
vi.mock('$lib/server/convex-work-budget', () => ({
	serverAction: mockServerAction,
	serverMutation: mockServerMutation,
	serverQuery: mockServerQuery
}));
vi.mock('$lib/core/security/rate-limiter', () => ({
	getRateLimiter: () => ({ check: mockRateLimitCheck })
}));
vi.mock('$lib/core/server/security', () => ({ safeUserId: () => 'safe-user' }));
vi.mock('$lib/server/internal/secret-auth', () => ({
	getInternalSecret: () => 'segments-route-test-secret'
}));

import { POST } from '../../../src/routes/api/org/[slug]/segments/+server';

const filters = {
	logic: 'AND',
	conditions: [{ id: 'source', field: 'source', operator: 'equals', value: 'organic' }]
};

function event(body: unknown) {
	return {
		request: new Request('https://commons.email/api/org/test-org/segments', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		}),
		params: { slug: 'test-org' },
		locals: { user: { id: 'user-1' } }
	} as never;
}

describe('POST /api/org/[slug]/segments bounded bulk boundary', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockRateLimitCheck.mockResolvedValue({ allowed: true });
		vi.spyOn(console, 'info').mockImplementation(() => {});
		vi.spyOn(console, 'warn').mockImplementation(() => {});
	});

	it('rejects oversized and non-exact envelopes before spending Convex work', async () => {
		await expect(
			POST(event({ action: 'count', filters, ballast: 'x'.repeat(21 * 1024) }))
		).rejects.toMatchObject({ status: 413 });
		await expect(
			POST(event({ action: 'count', filters, ignored: true }))
		).rejects.toMatchObject({ status: 400 });
		expect(mockServerAction).not.toHaveBeenCalled();
	});

	it('maps an oversized bulk cohort to 409 instead of reporting partial success', async () => {
		mockServerAction.mockResolvedValue({
			affected: 0,
			partial: true,
			complete: false,
			scanned: 400,
			rejection: 'SEGMENT_ORG_EXCEEDS_SCAN_LIMIT'
		});

		await expect(
			POST(event({ action: 'apply_tag', tagId: 'tag-1', filters }))
		).rejects.toMatchObject({ status: 409 });
		expect(mockServerAction).toHaveBeenCalledWith(api.segments.bulkApplyTag, {
			_secret: 'segments-route-test-secret',
			slug: 'test-org',
			tagId: 'tag-1',
			filters
		});
	});

	it('refuses an incomplete export before constructing any CSV response', async () => {
		mockServerAction.mockResolvedValue({
			rows: [],
			partial: true,
			complete: false,
			scanned: 400
		});

		await expect(POST(event({ action: 'export_csv', filters }))).rejects.toMatchObject({
			status: 409
		});
	});

	it('serializes only an explicitly complete export object', async () => {
		mockServerAction.mockResolvedValue({
			rows: [{ email: '=formula', name: 'Person', phone: '', tags: 'Member' }],
			partial: false,
			complete: true,
			scanned: 1
		});

		const response = await POST(event({ action: 'export_csv', filters }));
		expect(response.status).toBe(200);
		expect(response.headers.get('Cache-Control')).toBe('private, no-store');
		expect(await response.text()).toBe("email,name,phone,tags\n'=formula,Person,,Member");
	});
});
