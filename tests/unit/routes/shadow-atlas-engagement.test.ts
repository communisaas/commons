import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
	api,
	mockComplete,
	mockGetMetrics,
	mockGetPath,
	mockMark,
	mockRecordFailure,
	mockRegister,
	mockReserve,
	mockServerMutation
} = vi.hoisted(() => ({
	api: {
		users: {
			claimShadowAtlasEngagement: 'users.claim',
			completeShadowAtlasEngagement: 'users.complete',
			markShadowAtlasEngagementRegistered: 'users.mark',
			recordShadowAtlasEngagementFailure: 'users.failure',
			reserveShadowAtlasEngagementRegistration: 'users.reserve'
		}
	},
	mockComplete: vi.fn(() => ({ cachedUntil: Date.now() + 60_000 })),
	mockGetMetrics: vi.fn(),
	mockGetPath: vi.fn(),
	mockMark: vi.fn(() => ({ registered: true })),
	mockRecordFailure: vi.fn(() => ({ recorded: true })),
	mockRegister: vi.fn(),
	mockReserve: vi.fn(() => ({ reserved: true, registrationStatus: 'write_reserved' })),
	mockServerMutation: vi.fn()
}));

vi.mock('$lib/convex', () => ({ api }));
vi.mock('$lib/server/internal/secret-auth', () => ({
	getInternalSecret: () => 'shadow-atlas-route-secret'
}));
vi.mock('$lib/server/convex-work-budget', () => ({ serverMutation: mockServerMutation }));
vi.mock('$lib/core/shadow-atlas/client', () => ({
	getEngagementMetrics: mockGetMetrics,
	getEngagementPath: mockGetPath,
	registerEngagement: mockRegister
}));

import { POST } from '../../../src/routes/api/shadow-atlas/engagement/+server';

const IDENTITY = `0x${'ab'.repeat(32)}`;
const SIGNER = `0x${'12'.repeat(20)}`;
const ZERO_HASH = `0x${'0'.repeat(64)}`;
const SNAPSHOT = {
	engagementRoot: ZERO_HASH,
	engagementPath: Array(20).fill(ZERO_HASH) as string[],
	engagementIndex: 7,
	engagementTier: 2,
	actionCount: '12',
	diversityScore: '4'
};

function event(options: { authenticated?: boolean; body?: string } = {}) {
	const authenticated = options.authenticated ?? true;
	return {
		request: new Request('https://commons.email/api/shadow-atlas/engagement', {
			method: 'POST',
			...(options.body === undefined
				? {}
				: {
						headers: { 'content-type': 'application/json' },
						body: options.body
					})
		}),
		locals: { session: authenticated ? { userId: 'user_1' } : null }
	} as never;
}

function owner(
	overrides: Partial<{
		registrationStatus: 'unseen' | 'write_reserved' | 'registered';
		leafIndex: number | null;
		snapshot: typeof SNAPSHOT | null;
	}> = {}
) {
	return {
		kind: 'owner' as const,
		identityCommitment: IDENTITY,
		signerAddress: SIGNER,
		registrationStatus: overrides.registrationStatus ?? 'unseen',
		leafIndex: overrides.leafIndex ?? null,
		snapshot: overrides.snapshot ?? null
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	mockServerMutation.mockImplementation((ref: string) => {
		if (ref === api.users.reserveShadowAtlasEngagementRegistration) return mockReserve();
		if (ref === api.users.markShadowAtlasEngagementRegistered) return mockMark();
		if (ref === api.users.completeShadowAtlasEngagement) return mockComplete();
		if (ref === api.users.recordShadowAtlasEngagementFailure) return mockRecordFailure();
		throw new Error(`unexpected mutation ${ref}`);
	});
	mockGetPath.mockResolvedValue({
		engagementRoot: ZERO_HASH,
		engagementPath: Array(20).fill(ZERO_HASH),
		pathIndices: Array(20).fill(0),
		tier: 0,
		actionCount: 0,
		diversityScore: 0
	});
});

function claimWith(value: unknown): void {
	mockServerMutation.mockImplementation((ref: string) => {
		if (ref === api.users.claimShadowAtlasEngagement) return value;
		if (ref === api.users.reserveShadowAtlasEngagementRegistration) return mockReserve();
		if (ref === api.users.markShadowAtlasEngagementRegistered) return mockMark();
		if (ref === api.users.completeShadowAtlasEngagement) return mockComplete();
		if (ref === api.users.recordShadowAtlasEngagementFailure) return mockRecordFailure();
		throw new Error(`unexpected mutation ${ref}`);
	});
}

describe('POST /api/shadow-atlas/engagement', () => {
	it('rejects a guest before request parsing, Convex, or external traffic', async () => {
		const response = await POST(event({ authenticated: false, body: 'x'.repeat(2_000) }));
		expect(response.status).toBe(401);
		expect(mockServerMutation).not.toHaveBeenCalled();
		expect(mockGetMetrics).not.toHaveBeenCalled();
		expect(mockRegister).not.toHaveBeenCalled();
	});

	it('returns a fresh durable snapshot after one Convex claim and zero upstream calls', async () => {
		claimWith({ kind: 'cached', snapshot: SNAPSHOT });
		const response = await POST(event());
		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual(SNAPSHOT);
		expect(response.headers.get('cache-control')).toBe('private, no-store, max-age=0');
		expect(mockServerMutation).toHaveBeenCalledTimes(1);
		expect(mockGetMetrics).not.toHaveBeenCalled();
		expect(mockGetPath).not.toHaveBeenCalled();
		expect(mockRegister).not.toHaveBeenCalled();
	});

	it('coalesces an active lease to the last snapshot without external fanout', async () => {
		claimWith({ kind: 'in_flight', snapshot: SNAPSHOT });
		const response = await POST(event());
		await expect(response.json()).resolves.toEqual(SNAPSHOT);
		expect(mockGetMetrics).not.toHaveBeenCalled();
		expect(mockRegister).not.toHaveBeenCalled();
	});

	it('checks metrics before reserving and performing the only cold registration write', async () => {
		const order: string[] = [];
		claimWith(owner());
		mockGetMetrics.mockImplementation(async () => {
			order.push('metrics');
			return null;
		});
		mockReserve.mockImplementation(() => {
			order.push('reserve');
			return { reserved: true, registrationStatus: 'write_reserved' };
		});
		mockRegister.mockImplementation(async () => {
			order.push('register');
			return { leafIndex: 7, engagementRoot: ZERO_HASH };
		});
		mockMark.mockImplementation(() => {
			order.push('mark');
			return { registered: true };
		});
		mockGetPath.mockImplementation(async () => {
			order.push('path');
			return {
				engagementRoot: ZERO_HASH,
				engagementPath: Array(20).fill(ZERO_HASH),
				pathIndices: Array(20).fill(0),
				tier: 0,
				actionCount: 0,
				diversityScore: 0
			};
		});
		mockComplete.mockImplementation(() => {
			order.push('complete');
			return { cachedUntil: Date.now() + 60_000 };
		});

		const response = await POST(event());
		expect(response.status).toBe(200);
		expect(order).toEqual(['metrics', 'reserve', 'register', 'mark', 'path', 'complete']);
		expect(mockRegister).toHaveBeenCalledTimes(1);
	});

	it('never retries a reserved write when metrics still reports the identity absent', async () => {
		claimWith(owner({ registrationStatus: 'write_reserved' }));
		mockGetMetrics.mockResolvedValue(null);
		const response = await POST(event());
		expect(response.status).toBe(200);
		expect(mockReserve).not.toHaveBeenCalled();
		expect(mockRegister).not.toHaveBeenCalled();
		expect(mockGetPath).not.toHaveBeenCalled();
		expect(mockRecordFailure).toHaveBeenCalledTimes(1);
	});

	it('repairs a post-write process loss from metrics without another POST', async () => {
		claimWith(owner({ registrationStatus: 'write_reserved' }));
		mockGetMetrics.mockResolvedValue({
			identityCommitment: IDENTITY,
			tier: 2,
			actionCount: 12,
			diversityScore: 4,
			tenureMonths: 3,
			leafIndex: 7
		});

		const response = await POST(event());
		await expect(response.json()).resolves.toMatchObject({
			engagementIndex: 7,
			engagementTier: 0,
			actionCount: '0'
		});
		expect(mockRegister).not.toHaveBeenCalled();
		expect(mockReserve).not.toHaveBeenCalled();
		expect(mockMark).toHaveBeenCalledTimes(1);
		expect(mockGetPath).toHaveBeenCalledWith(7);
	});

	it('keeps proof-leaf metrics internally consistent across an upstream update race', async () => {
		claimWith(owner({ registrationStatus: 'registered', leafIndex: 7 }));
		mockGetMetrics.mockResolvedValue({
			identityCommitment: IDENTITY,
			tier: 4,
			actionCount: 999,
			diversityScore: 999,
			tenureMonths: 10,
			leafIndex: 7
		});
		mockGetPath.mockResolvedValue({
			engagementRoot: ZERO_HASH,
			engagementPath: Array(20).fill(ZERO_HASH),
			pathIndices: Array(20).fill(0),
			tier: 2,
			actionCount: 12,
			diversityScore: 4
		});

		const response = await POST(event());
		await expect(response.json()).resolves.toMatchObject({
			engagementTier: 2,
			actionCount: '12',
			diversityScore: '4'
		});
	});

	it('persists registration before a path failure and returns a safe fallback', async () => {
		claimWith(owner());
		mockGetMetrics.mockResolvedValue({
			identityCommitment: IDENTITY,
			tier: 1,
			actionCount: 5,
			diversityScore: 2,
			tenureMonths: 1,
			leafIndex: 7
		});
		mockGetPath.mockRejectedValue(new Error('upstream unavailable'));

		const response = await POST(event());
		await expect(response.json()).resolves.toMatchObject({ engagementTier: 0 });
		expect(mockMark).toHaveBeenCalledTimes(1);
		expect(mockComplete).not.toHaveBeenCalled();
		expect(mockRecordFailure).toHaveBeenCalledTimes(1);
		expect(mockRegister).not.toHaveBeenCalled();
	});

	it('rejects oversized or unexpected input before the Convex claim', async () => {
		const oversized = await POST(event({ body: JSON.stringify({ identityCommitment: 'a'.repeat(2_000) }) }));
		expect(oversized.status).toBe(413);
		const unexpected = await POST(event({ body: JSON.stringify({ unexpected: true }) }));
		expect(unexpected.status).toBe(400);
		expect(mockServerMutation).not.toHaveBeenCalled();
	});
});
