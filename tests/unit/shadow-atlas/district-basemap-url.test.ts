import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/public', () => ({
	env: {
		PUBLIC_ATLAS_HOST: ''
	}
}));

import {
	getDistrictBasemapUrl,
	_resetManifestCacheForTest
} from '$lib/core/shadow-atlas/district-bundle';

const fetchMock = vi.fn();

beforeEach(() => {
	fetchMock.mockReset();
	globalThis.fetch = fetchMock as unknown as typeof fetch;
	_resetManifestCacheForTest();
});

afterEach(() => {
	_resetManifestCacheForTest();
});

function manifestResponse(currentVersion: string): Response {
	return {
		ok: true,
		json: async () => ({ currentVersion })
	} as unknown as Response;
}

describe('getDistrictBasemapUrl', () => {
	it('returns a deterministic URL for a known district', async () => {
		fetchMock.mockResolvedValueOnce(manifestResponse('v20260503'));
		const url = await getDistrictBasemapUrl('CA-11');
		expect(url).toBe('https://atlas.commons.email/source/v20260503/us/cd/cd-0611-base.png');
	});

	it('handles at-large districts (VT-AL → 5000 GEOID suffix per displayDistrictToGEOID)', async () => {
		fetchMock.mockResolvedValueOnce(manifestResponse('v20260503'));
		const url = await getDistrictBasemapUrl('VT-AL');
		expect(url).toMatch(/^https:\/\/atlas\.commons\.email\/source\/v20260503\/us\/cd\/cd-\d{4}-base\.png$/);
	});

	it('returns null for an unknown display code', async () => {
		const url = await getDistrictBasemapUrl('ZZ-99');
		expect(url).toBeNull();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('rejects path-injection attempts in the district segment', async () => {
		fetchMock.mockResolvedValueOnce(manifestResponse('v20260503'));
		expect(await getDistrictBasemapUrl('CA-11?x=evil')).toBeNull();
		expect(await getDistrictBasemapUrl('CA-../etc/passwd')).toBeNull();
		expect(await getDistrictBasemapUrl('CA-11/foo')).toBeNull();
	});

	it('rejects non-numeric districts that are not the AL sentinel', async () => {
		fetchMock.mockResolvedValueOnce(manifestResponse('v20260503'));
		expect(await getDistrictBasemapUrl('CA-XX')).toBeNull();
		expect(await getDistrictBasemapUrl('CA-1a')).toBeNull();
	});

	it('maps DC-AL and territory-AL to the 98 delegate suffix, not 00', async () => {
		fetchMock.mockResolvedValueOnce(manifestResponse('v20260503'));
		const dcUrl = await getDistrictBasemapUrl('DC-AL');
		expect(dcUrl).toContain('/cd-1198-base.png');

		fetchMock.mockResolvedValueOnce(manifestResponse('v20260503'));
		const prUrl = await getDistrictBasemapUrl('PR-AL');
		expect(prUrl).toContain('/cd-7298-base.png');

		// Real at-large states (VT, WY, AK) still use 00.
		fetchMock.mockResolvedValueOnce(manifestResponse('v20260503'));
		const vtUrl = await getDistrictBasemapUrl('VT-AL');
		expect(vtUrl).toContain('/cd-5000-base.png');
	});

	it('returns null when manifest fetch fails', async () => {
		fetchMock.mockResolvedValueOnce({ ok: false } as unknown as Response);
		const url = await getDistrictBasemapUrl('CA-11');
		expect(url).toBeNull();
	});

	it('returns null when manifest fetch throws', async () => {
		fetchMock.mockRejectedValueOnce(new Error('network'));
		const url = await getDistrictBasemapUrl('CA-11');
		expect(url).toBeNull();
	});

	it('does not perform a fetch for the basemap asset itself', async () => {
		fetchMock.mockResolvedValueOnce(manifestResponse('v20260503'));
		await getDistrictBasemapUrl('CA-11');
		// One fetch for the manifest, zero for the basemap — the helper is a
		// URL builder, not a fetcher.
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(fetchMock.mock.calls[0][0]).toContain('/source/manifest.json');
	});
});
