import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
	api,
	mockBegin,
	mockCommit,
	mockMarkAmbiguous,
	mockRegister,
	mockReplace,
	mockReserve,
	mockServerMutation
} = vi.hoisted(() => ({
	api: {
		users: {
			beginShadowAtlasRegistrationDispatch: 'users.tree1Begin',
			commitShadowAtlasRegistrationOperation: 'users.tree1Commit',
			markShadowAtlasRegistrationOperationAmbiguous: 'users.tree1Ambiguous',
			reserveShadowAtlasRegistrationOperation: 'users.tree1Reserve'
		}
	},
	mockBegin: vi.fn(() => ({ started: true, status: 'dispatching' })),
	mockCommit: vi.fn(() => ({ status: 'committed' })),
	mockMarkAmbiguous: vi.fn(() => ({ recorded: true, status: 'ambiguous' })),
	mockRegister: vi.fn(),
	mockReplace: vi.fn(),
	mockReserve: vi.fn(),
	mockServerMutation: vi.fn()
}));

vi.mock('$lib/convex', () => ({ api }));
vi.mock('$lib/server/internal/secret-auth', () => ({
	getInternalSecret: () => 'shadow-atlas-register-route-secret-32'
}));
vi.mock('$lib/server/convex-work-budget', () => ({ serverMutation: mockServerMutation }));
vi.mock('$lib/core/shadow-atlas/client', () => ({
	registerLeaf: mockRegister,
	replaceLeaf: mockReplace
}));

import { POST } from '../../../src/routes/api/shadow-atlas/register/+server';
import { parseShadowAtlasRegistrationRetry } from '../../../src/lib/server/shadow-atlas-registration-retry';

const IDENTITY = `0x${'ab'.repeat(32)}`;
const KEY = '00000000-0000-4000-8000-000000000001';
const ROOT = `0x${'0'.repeat(64)}`;
const PATH = Array(20).fill(ROOT) as string[];
const PATH_INDICES = [1, 1, 1, ...Array(17).fill(0)] as number[];
const RESULT = {
	leafIndex: 7,
	userRoot: ROOT,
	userPath: PATH,
	pathIndices: PATH_INDICES,
	receipt: { data: 'receipt-data', sig: 'receipt-signature' }
};

function owner(overrides: Partial<Record<string, unknown>> = {}) {
	return {
		kind: 'owner' as const,
		identityCommitment: IDENTITY,
		authorityLevel: 5,
		operation: 'register' as const,
		generation: 1,
		leafDigest: '11'.repeat(32),
		idempotencyKey: KEY,
		...overrides
	};
}

function event(
	body: string | undefined,
	options: { authenticated?: boolean; kv?: { put: ReturnType<typeof vi.fn> } } = {}
) {
	return {
		request: new Request('https://commons.email/api/shadow-atlas/register', {
			method: 'POST',
			...(body === undefined
				? {}
				: { headers: { 'content-type': 'application/json' }, body })
		}),
		locals: {
			session: options.authenticated === false ? null : { userId: 'user_1' }
		},
		platform: options.kv
			? { env: { REGISTRATION_RETRY_KV: { ...options.kv } } }
			: { env: {} }
	} as never;
}

beforeEach(() => {
	vi.clearAllMocks();
	mockReserve.mockReturnValue(owner());
	mockRegister.mockResolvedValue(RESULT);
	mockReplace.mockResolvedValue({ ...RESULT, receipt: undefined });
	mockServerMutation.mockImplementation((ref: string, args: unknown) => {
		if (ref === api.users.reserveShadowAtlasRegistrationOperation) return mockReserve(args);
		if (ref === api.users.beginShadowAtlasRegistrationDispatch) return mockBegin(args);
		if (ref === api.users.commitShadowAtlasRegistrationOperation) return mockCommit(args);
		if (ref === api.users.markShadowAtlasRegistrationOperationAmbiguous) {
			return mockMarkAmbiguous(args);
		}
		throw new Error(`unexpected mutation ${ref}`);
	});
});

describe('POST /api/shadow-atlas/register', () => {
	it('rejects a guest before body parsing, Convex, or Atlas traffic', async () => {
		const response = await POST(event('x'.repeat(2_000), { authenticated: false }));
		expect(response.status).toBe(401);
		expect(mockServerMutation).not.toHaveBeenCalled();
		expect(mockRegister).not.toHaveBeenCalled();
	});

	it('rejects oversized, extra, and wrongly typed input before reservation', async () => {
		const oversized = await POST(event(JSON.stringify({ leaf: 'a'.repeat(2_000) })));
		expect(oversized.status).toBe(413);
		const extra = await POST(event(JSON.stringify({ leaf: '1', unexpected: true })));
		expect(extra.status).toBe(400);
		const wrongReplace = await POST(event(JSON.stringify({ leaf: '1', replace: 'yes' })));
		expect(wrongReplace.status).toBe(400);
		expect(mockServerMutation).not.toHaveBeenCalled();
	});

	it('reserves and begins before one register call, using the persisted key', async () => {
		const order: string[] = [];
		mockReserve.mockImplementation(() => {
			order.push('reserve');
			return owner({ resumed: true });
		});
		mockBegin.mockImplementation(() => {
			order.push('begin');
			return { started: true, status: 'dispatching' };
		});
		mockRegister.mockImplementation(async () => {
			order.push('register');
			return RESULT;
		});
		mockCommit.mockImplementation(() => {
			order.push('commit');
			return { status: 'committed' };
		});

		const response = await POST(event(JSON.stringify({ leaf: '1' })));
		expect(response.status).toBe(200);
		expect(order).toEqual(['reserve', 'begin', 'register', 'commit']);
		expect(mockReserve).toHaveBeenCalledWith(
			expect.objectContaining({
				userId: 'user_1',
				requestedReplace: false,
				leafDigest: expect.stringMatching(/^[0-9a-f]{64}$/u),
				idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/iu)
			})
		);
		expect(mockRegister).toHaveBeenCalledWith(`0x${'0'.repeat(63)}1`, {
			attestationHash: IDENTITY,
			idempotencyKey: KEY
		});
		expect(mockCommit).toHaveBeenCalledWith(
			expect.objectContaining({
				operation: 'register',
				generation: 1,
				idempotencyKey: KEY,
				leafIndex: 7,
				merklePath: PATH
			})
		);
		await expect(response.json()).resolves.toMatchObject({
			leafIndex: 7,
			identityCommitment: IDENTITY,
			authorityLevel: 5,
			receipt: RESULT.receipt
		});
	});

	it('coalesces an active reservation and a lost dispatch race without Atlas traffic', async () => {
		mockReserve.mockReturnValueOnce({
			kind: 'in_flight',
			status: 'dispatching',
			operation: 'register',
			generation: 1
		});
		const active = await POST(event(JSON.stringify({ leaf: '1' })));
		expect(active.status).toBe(409);
		expect(mockBegin).not.toHaveBeenCalled();
		expect(mockRegister).not.toHaveBeenCalled();

		mockReserve.mockReturnValueOnce(owner());
		mockBegin.mockReturnValueOnce({ started: false, status: 'dispatching' });
		const lost = await POST(event(JSON.stringify({ leaf: '1' })));
		expect(lost.status).toBe(409);
		expect(mockRegister).not.toHaveBeenCalled();
	});

	it('marks a timeout ambiguous and returns a non-retryable failure', async () => {
		mockRegister.mockRejectedValueOnce(new Error('timeout after write'));
		const response = await POST(event(JSON.stringify({ leaf: '1' })));
		expect(response.status).toBe(503);
		await expect(response.json()).resolves.toMatchObject({ retry: false });
		expect(mockMarkAmbiguous).toHaveBeenCalledWith(
			expect.objectContaining({
				generation: 1,
				idempotencyKey: KEY,
				failureCode: 'SHADOW_ATLAS_EXTERNAL_OUTCOME_UNKNOWN'
			})
		);
		expect(mockCommit).not.toHaveBeenCalled();
	});

	it('queues an exact generation-bound result after DB failure without another Atlas call', async () => {
		const put = vi.fn();
		mockCommit.mockRejectedValueOnce(new Error('Convex unavailable after external success'));
		const response = await POST(event(JSON.stringify({ leaf: '1' }), { kv: { put } }));
		expect(response.status).toBe(503);
		expect(mockRegister).toHaveBeenCalledTimes(1);
		expect(mockMarkAmbiguous).not.toHaveBeenCalled();
		expect(put).toHaveBeenCalledTimes(1);
		const [key, raw, options] = put.mock.calls[0]!;
		expect(key).toBe(`retry:v2:user_1:1:${KEY}`);
		expect(options).toEqual({ expirationTtl: 7 * 24 * 60 * 60 });
		expect(parseShadowAtlasRegistrationRetry(raw)).toMatchObject({
			version: 2,
			userId: 'user_1',
			identityCommitment: IDENTITY,
			operation: 'register',
			generation: 1,
			idempotencyKey: KEY,
			atlasResult: { leafIndex: 7, userRoot: ROOT, userPath: PATH }
		});
	});

	it('serves a committed same-leaf retry from Convex without dispatching', async () => {
		mockReserve.mockReturnValueOnce({
			kind: 'cached',
			identityCommitment: IDENTITY,
			authorityLevel: 5,
			registration: {
				leafIndex: 7,
				merkleRoot: ROOT,
				merklePath: PATH
			}
		});
		const response = await POST(event(JSON.stringify({ leaf: '1' })));
		await expect(response.json()).resolves.toMatchObject({
			alreadyRegistered: true,
			leafIndex: 7,
			pathIndices: PATH_INDICES
		});
		expect(mockBegin).not.toHaveBeenCalled();
		expect(mockRegister).not.toHaveBeenCalled();
	});

	it('uses the reserved prior index and stable key for replacement', async () => {
		mockReserve.mockReturnValueOnce(
			owner({ operation: 'replace', generation: 2, priorLeafIndex: 7 })
		);
		const response = await POST(event(JSON.stringify({ leaf: '2', replace: true })));
		expect(response.status).toBe(200);
		expect(mockReplace).toHaveBeenCalledWith(`0x${'0'.repeat(63)}2`, 7, {
			idempotencyKey: KEY
		});
		expect(mockRegister).not.toHaveBeenCalled();
		expect(mockCommit).toHaveBeenCalledWith(
			expect.objectContaining({ operation: 'replace', generation: 2, priorLeafIndex: 7 })
		);
	});

	it('maps missing canonical identity to the existing verification-required response', async () => {
		mockReserve.mockImplementationOnce(() => {
			throw new Error('SHADOW_ATLAS_TREE1_IDENTITY_REQUIRED');
		});
		const response = await POST(event(JSON.stringify({ leaf: '1' })));
		expect(response.status).toBe(403);
		expect(mockRegister).not.toHaveBeenCalled();
	});
});
