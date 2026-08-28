import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	hasCommittedProductionReleaseAuthority,
	PRODUCTION_RELEASE_AUTHORITY_COST_RATCHET
} from '$lib/server/production-release-authority';

const sourceSha = 'a'.repeat(40);
const transactionId = '123456789-2';
const backend = 'https://quirky-chinchilla-352.convex.cloud';

afterEach(() => {
	vi.unstubAllGlobals();
});

class MemoryCache {
	readonly entries = new Map<string, Response>();

	async match(request: Request): Promise<Response | undefined> {
		return this.entries.get(request.url)?.clone();
	}

	async put(request: Request, response: Response): Promise<void> {
		this.entries.set(request.url, response.clone());
	}
}

function authorityResponse(
	status: 'absent' | 'committed' | 'contained' | 'provisional' | 'qualified',
	options: { deadlineAt?: number; source?: string; transaction?: string } = {}
): Response {
	return new Response(null, {
		headers: {
			'x-commons-release-authority-status': status,
			...(options.deadlineAt === undefined
				? {}
				: { 'x-commons-release-authority-deadline': String(options.deadlineAt) }),
			'x-public-discovery-refresh-gate-protocol': '3',
			'x-public-template-og-release-sha': options.source ?? sourceSha,
			'x-public-template-og-release-transaction': options.transaction ?? transactionId
		},
		status: 200
	});
}

function platform(fetch: ReturnType<typeof vi.fn>): App.Platform {
	const id = { toString: () => 'production-authority' } as DurableObjectId;
	return {
		env: {
			PUBLIC_CONVEX_URL: backend,
			PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE: {
				get: vi.fn(() => ({ fetch })),
				idFromName: vi.fn(() => id)
			} as unknown as DurableObjectNamespace
		}
	};
}

describe('production release authority cache', () => {
	it('opens only exact committed S+transaction and stores a finite v2 cache envelope', async () => {
		const now = Date.UTC(2026, 6, 20, 12);
		const fetch = vi.fn(async () => authorityResponse('committed'));
		const cache = new MemoryCache();
		const input = {
			cache: cache as never,
			now,
			platform: platform(fetch),
			releaseSha: sourceSha,
			releaseTransactionId: transactionId
		};

		await expect(hasCommittedProductionReleaseAuthority(input)).resolves.toBe(true);
		await expect(hasCommittedProductionReleaseAuthority(input)).resolves.toBe(true);
		expect(fetch).toHaveBeenCalledOnce();
		expect(cache.entries.size).toBe(1);
		const [key, cached] = [...cache.entries]![0]!;
		expect(key).toContain('/v2/');
		expect(key).toContain(`/${sourceSha}/${transactionId}`);
		await expect(cached.clone().json()).resolves.toMatchObject({
			authorized: true,
			checkedAt: now,
			sourceSha,
			status: 'committed',
			transactionId,
			validUntil: now + 60_000
		});
		expect(cached.headers.get('cache-control')).toContain('max-age=60');
	});

	it('does not reuse same-S committed authority across publication transactions', async () => {
		const now = Date.UTC(2026, 6, 20, 12);
		const cache = new MemoryCache();
		const committedFetch = vi.fn(async () => authorityResponse('committed'));
		await hasCommittedProductionReleaseAuthority({
			cache: cache as never,
			now,
			platform: platform(committedFetch),
			releaseSha: sourceSha,
			releaseTransactionId: transactionId
		});

		const nextTransaction = '123456789-3';
		const absentFetch = vi.fn(async () =>
			authorityResponse('absent', { transaction: nextTransaction })
		);
		await expect(
			hasCommittedProductionReleaseAuthority({
				cache: cache as never,
				now,
				platform: platform(absentFetch),
				releaseSha: sourceSha,
				releaseTransactionId: nextTransaction
			})
		).resolves.toBe(false);
		expect(absentFetch).toHaveBeenCalledOnce();
		expect(cache.entries.size).toBe(2);
	});

	it('coalesces concurrent misses and never caches P/Q beyond its signed deadline', async () => {
		const now = Date.UTC(2026, 6, 20, 12);
		let release: (() => void) | undefined;
		const blocked = new Promise<void>((resolve) => (release = resolve));
		const fetch = vi.fn(async () => {
			await blocked;
			return authorityResponse('qualified', { deadlineAt: now + 12_500 });
		});
		const cache = new MemoryCache();
		const input = {
			cache: cache as never,
			now,
			platform: platform(fetch),
			releaseSha: sourceSha,
			releaseTransactionId: transactionId
		};
		const requests = Array.from({ length: 100 }, () =>
			hasCommittedProductionReleaseAuthority(input)
		);
		release?.();
		await expect(Promise.all(requests)).resolves.toEqual(Array(100).fill(false));
		expect(fetch).toHaveBeenCalledOnce();
		const cached = [...cache.entries.values()][0]!;
		await expect(cached.clone().json()).resolves.toMatchObject({
			authorized: false,
			status: 'qualified',
			validUntil: now + 12_500
		});
		expect(cached.headers.get('cache-control')).toContain('max-age=12');
	});

	it('rejects stale-v1/null-expiry cache data and malformed authority responses', async () => {
		const now = Date.UTC(2026, 6, 20, 12);
		const cache = new MemoryCache();
		const staleKey = new Request(
			`https://release-authority-cache.internal/production-release-authority/v2/${encodeURIComponent(`backend=${backend}`)}/${sourceSha}/${transactionId}`
		);
		cache.entries.set(
			staleKey.url,
			Response.json({
				authorized: true,
				backendRealm: `backend=${backend}`,
				checkedAt: now,
				sourceSha,
				status: 'committed',
				transactionId,
				validUntil: null
			})
		);
		const malformedFetch = vi.fn(async () =>
			new Response(null, {
				headers: {
					'x-commons-release-authority-status': 'committed',
					'x-public-discovery-refresh-gate-protocol': '2'
				},
				status: 200
			})
		);
		await expect(
			hasCommittedProductionReleaseAuthority({
				cache: cache as never,
				now,
				platform: platform(malformedFetch),
				releaseSha: sourceSha,
				releaseTransactionId: transactionId
			})
		).resolves.toBe(false);
		expect(malformedFetch).toHaveBeenCalledOnce();
	});

	it('continues with the authority lookup when Access makes caches.default throw', async () => {
		vi.stubGlobal(
			'caches',
			Object.defineProperty({}, 'default', {
				get() {
					throw new Error('Cache API unavailable behind Access');
				}
			})
		);
		const fetch = vi.fn(async () => authorityResponse('committed'));

		await expect(
			hasCommittedProductionReleaseAuthority({
				platform: platform(fetch),
				releaseSha: sourceSha,
				releaseTransactionId: transactionId
			})
		).resolves.toBe(true);
		expect(fetch).toHaveBeenCalledOnce();
	});

	it('pins the zero-cost lookup and cache ratchets', () => {
		expect(PRODUCTION_RELEASE_AUTHORITY_COST_RATCHET).toEqual({
			authorityTimeoutMs: 750,
			committedCacheMaxAgeSeconds: 60,
			maximumConcurrentAuthorityLookupsPerExactRelease: 1,
			negativeCacheMaxAgeMs: 60_000
		});
	});
});
