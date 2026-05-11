/**
 * Atlas-version migration check (G6).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// district-bundle.ts imports from `$env/dynamic/public` for the atlas host
// override. The vitest jsdom env doesn't auto-stub the SvelteKit dynamic
// env module, so we mock it explicitly.
vi.mock('$env/dynamic/public', () => ({
	env: {
		PUBLIC_ATLAS_HOST: ''
	}
}));

import { checkAtlasMigration } from '$lib/core/identity/atlas-migration';
import { _resetManifestCacheForTest } from '$lib/core/shadow-atlas/district-bundle';
import type { SessionCredential } from '$lib/core/identity/session-credentials';

const fetchMock = vi.fn();

beforeEach(() => {
	fetchMock.mockReset();
	globalThis.fetch = fetchMock as unknown as typeof fetch;
	_resetManifestCacheForTest();
});

afterEach(() => {
	_resetManifestCacheForTest();
});

function fakeCredential(overrides: Partial<SessionCredential> = {}): SessionCredential {
	return {
		userId: 'u1',
		identityCommitment: '0x' + '1'.repeat(64),
		leafIndex: 0,
		merklePath: [],
		merkleRoot: '0x' + '2'.repeat(64),
		congressionalDistrict: 'CA-12',
		verificationMethod: 'digital-credentials-api',
		createdAt: new Date(),
		expiresAt: new Date(Date.now() + 86400000),
		...overrides,
	};
}

function manifestResponse(currentVersion: string): Response {
	return {
		ok: true,
		json: async () => ({ currentVersion }),
	} as unknown as Response;
}

describe('checkAtlasMigration', () => {
	it('returns current when versions match', async () => {
		fetchMock.mockResolvedValueOnce(manifestResponse('v20260503'));
		const result = await checkAtlasMigration(
			fakeCredential({ atlasVersion: 'v20260503' }),
		);
		expect(result.status).toBe('current');
		expect(result.credentialVersion).toBe('v20260503');
		expect(result.currentVersion).toBe('v20260503');
	});

	it('returns stale when atlas has rotated', async () => {
		fetchMock.mockResolvedValueOnce(manifestResponse('v20260801'));
		const result = await checkAtlasMigration(
			fakeCredential({ atlasVersion: 'v20260503' }),
		);
		expect(result.status).toBe('stale');
		expect(result.credentialVersion).toBe('v20260503');
		expect(result.currentVersion).toBe('v20260801');
	});

	it('returns pre-g6 when credential lacks atlasVersion (legacy)', async () => {
		// No atlasVersion on credential. Should NOT fetch manifest — we know
		// the answer without the network round-trip.
		const result = await checkAtlasMigration(fakeCredential());
		expect(result.status).toBe('pre-g6');
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('returns unknown when manifest is unreachable (transient outage)', async () => {
		fetchMock.mockRejectedValueOnce(new Error('network down'));
		const result = await checkAtlasMigration(
			fakeCredential({ atlasVersion: 'v20260503' }),
		);
		expect(result.status).toBe('unknown');
		expect(result.credentialVersion).toBe('v20260503');
		expect(result.currentVersion).toBeNull();
	});

	it('returns unknown when manifest body is non-OK', async () => {
		fetchMock.mockResolvedValueOnce({
			ok: false,
			status: 500,
		} as unknown as Response);
		const result = await checkAtlasMigration(
			fakeCredential({ atlasVersion: 'v20260503' }),
		);
		expect(result.status).toBe('unknown');
	});

	it('G6r: transient manifest failure does NOT poison subsequent successful fetches', async () => {
		// CRITICAL G6r bug: the old code memoized `manifestPromise = null` on
		// the first failed fetch, so every subsequent call returned null for
		// the page lifetime. This poisoned getDistrictBoundary too. Fix:
		// clear the cache on null. Test asserts retry works.
		fetchMock.mockRejectedValueOnce(new Error('transient'));
		const first = await checkAtlasMigration(
			fakeCredential({ atlasVersion: 'v20260503' }),
		);
		expect(first.status).toBe('unknown');

		// Subsequent call should retry and succeed.
		fetchMock.mockResolvedValueOnce(manifestResponse('v20260503'));
		const second = await checkAtlasMigration(
			fakeCredential({ atlasVersion: 'v20260503' }),
		);
		expect(second.status).toBe('current');
		// Both fetches actually fired — second was not served from poisoned cache.
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});
});
