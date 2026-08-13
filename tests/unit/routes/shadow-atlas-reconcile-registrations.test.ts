import { beforeEach, describe, expect, it, vi } from 'vitest';

const { api, mockServerMutation, mockServerQuery } = vi.hoisted(() => ({
	api: {
		users: {
			reconcileShadowAtlasRegistrationOperation: 'users.tree1Reconcile',
			countRegistrations: 'users.countRegistrations',
			listRecentRegistrations: 'users.listRecentRegistrations'
		}
	},
	mockServerMutation: vi.fn(),
	mockServerQuery: vi.fn()
}));

vi.mock('$env/dynamic/private', () => ({
	env: {
		CRON_SECRET: 'tree1-reconcile-cron-secret',
		SHADOW_ATLAS_API_URL: 'https://atlas.example.test',
		SHADOW_ATLAS_REGISTRATION_TOKEN: ''
	}
}));
vi.mock('$lib/convex', () => ({ api }));
vi.mock('$lib/server/convex-work-budget', () => ({
	serverMutation: mockServerMutation,
	serverQuery: mockServerQuery
}));
vi.mock('$lib/server/internal/secret-auth', () => ({
	getInternalSecret: () => 'tree1-reconcile-internal-secret'
}));

import { POST } from '../../../src/routes/api/admin/reconcile-registrations/+server';
import {
	encodeShadowAtlasRegistrationRetry,
	shadowAtlasRegistrationRetryKey,
	type ShadowAtlasRegistrationRetry
} from '../../../src/lib/server/shadow-atlas-registration-retry';

const IDENTITY = `0x${'ab'.repeat(32)}`;
const IDEMPOTENCY_KEY = '00000000-0000-4000-8000-000000000001';
const FIELD = `0x${'0'.repeat(64)}`;

function retry(): ShadowAtlasRegistrationRetry {
	return {
		version: 2,
		userId: 'user_1',
		identityCommitment: IDENTITY,
		operation: 'replace',
		generation: 2,
		leafDigest: '11'.repeat(32),
		idempotencyKey: IDEMPOTENCY_KEY,
		priorLeafIndex: 3,
		atlasResult: {
			leafIndex: 7,
			userRoot: FIELD,
			userPath: Array(20).fill(FIELD) as string[]
		},
		queuedAt: 1_700_000_000_000
	};
}

function event(options: {
	authorized?: boolean;
	list: ReturnType<typeof vi.fn>;
	get: ReturnType<typeof vi.fn>;
	delete: ReturnType<typeof vi.fn>;
}) {
	return {
		request: new Request('https://commons.email/api/admin/reconcile-registrations', {
			method: 'POST',
			headers: options.authorized === false
				? {}
				: { Authorization: 'Bearer tree1-reconcile-cron-secret' }
		}),
		platform: {
			env: {
				REGISTRATION_RETRY_KV: {
					list: options.list,
					get: options.get,
					delete: options.delete
				}
			}
		}
	} as never;
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 503 })));
	vi.spyOn(console, 'log').mockImplementation(() => {});
	vi.spyOn(console, 'error').mockImplementation(() => {});
	vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('POST /api/admin/reconcile-registrations', () => {
	it('rejects an invalid cron secret before reading the retry queue', async () => {
		const list = vi.fn();
		const response = await POST(event({ authorized: false, list, get: vi.fn(), delete: vi.fn() }));
		expect(response.status).toBe(401);
		expect(list).not.toHaveBeenCalled();
		expect(mockServerMutation).not.toHaveBeenCalled();
	});

	it('deletes a proven-stale generation without overwriting the newer operation', async () => {
		const item = retry();
		const key = shadowAtlasRegistrationRetryKey(item);
		const list = vi.fn(async () => ({ keys: [{ name: key }] }));
		const get = vi.fn(async () => encodeShadowAtlasRegistrationRetry(item));
		const remove = vi.fn(async () => undefined);
		mockServerMutation.mockResolvedValueOnce({ status: 'stale' });

		const response = await POST(event({ list, get, delete: remove }));
		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			retriesProcessed: 1,
			retriesSucceeded: 0,
			retriesStale: 1,
			retriesFailed: 0
		});
		expect(list).toHaveBeenCalledWith({ prefix: 'retry:v2:', limit: 100 });
		expect(mockServerMutation).toHaveBeenCalledOnce();
		expect(mockServerMutation).toHaveBeenCalledWith(api.users.reconcileShadowAtlasRegistrationOperation, {
			_secret: 'tree1-reconcile-internal-secret',
			userId: 'user_1',
			identityCommitment: IDENTITY,
			operation: 'replace',
			generation: 2,
			leafDigest: '11'.repeat(32),
			idempotencyKey: IDEMPOTENCY_KEY,
			priorLeafIndex: 3,
			leafIndex: 7,
			merkleRoot: FIELD,
			merklePath: Array(20).fill(FIELD)
		});
		expect(remove).toHaveBeenCalledWith(key);
		expect(mockServerQuery).not.toHaveBeenCalled();
	});

	it('retains a malformed retry entry for operator inspection', async () => {
		const key = `retry:v2:user_1:2:${IDEMPOTENCY_KEY}`;
		const remove = vi.fn();
		const response = await POST(
			event({
				list: vi.fn(async () => ({ keys: [{ name: key }] })),
				get: vi.fn(async () => '{"version":2,"unexpected":true}'),
				delete: remove
			})
		);
		await expect(response.json()).resolves.toMatchObject({
			retriesProcessed: 1,
			retriesFailed: 1,
			retriesStale: 0
		});
		expect(remove).not.toHaveBeenCalled();
		expect(mockServerMutation).not.toHaveBeenCalled();
	});
});
