import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearPublicDiscoveryCache } from '$lib/server/public-discovery-cache';
import {
	PUBLIC_ORGANIZATION_DIRECTORY_FRESH_MS,
	PublicOrganizationDirectoryNotReadyError,
	getCachedPublicOrganizationDirectoryFirstPage,
	projectPublicOrganizationDirectoryPage
} from '$lib/server/public-organization-directory';

const NOW = 1_800_000_000_000;
const TEST_URL = new URL('https://commons.example/directory');

function rawPage(name: string) {
	return {
		ready: true,
		status: 'ready',
		data: [
			{
				orgId: 'org-secret-shape-is-dropped',
				name,
				slug: name.toLowerCase(),
				description: null,
				mission: 'A public mission',
				logoUrl: null,
				avatar: 'unused',
				supporterCount: 99,
				campaignCount: 12,
				memberCount: 3
			}
		],
		cursor: null,
		hasMore: false,
		total: 1,
		revision: '1:1800000000000',
		updatedAt: NOW
	};
}

describe('public organization directory edge cache', () => {
	beforeEach(() => {
		clearPublicDiscoveryCache();
		vi.stubGlobal('caches', undefined);
		vi.spyOn(Date, 'now').mockReturnValue(NOW);
	});

	afterEach(() => {
		clearPublicDiscoveryCache();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it('shares one compact first-page read for the full one-minute freshness window', async () => {
		const loader = vi.fn().mockResolvedValue(rawPage('Alpha'));
		await expect(
			getCachedPublicOrganizationDirectoryFirstPage({ url: TEST_URL }, loader)
		).resolves.toMatchObject({ orgs: [{ name: 'Alpha' }] });
		vi.mocked(Date.now).mockReturnValue(NOW + PUBLIC_ORGANIZATION_DIRECTORY_FRESH_MS - 1);
		await getCachedPublicOrganizationDirectoryFirstPage({ url: TEST_URL }, loader);
		expect(loader).toHaveBeenCalledOnce();
	});

	it('refreshes synchronously after one minute so directory changes propagate', async () => {
		const loader = vi
			.fn()
			.mockResolvedValueOnce(rawPage('Alpha'))
			.mockResolvedValueOnce(rawPage('Beta'));
		await getCachedPublicOrganizationDirectoryFirstPage({ url: TEST_URL }, loader);
		vi.mocked(Date.now).mockReturnValue(NOW + PUBLIC_ORGANIZATION_DIRECTORY_FRESH_MS + 1);
		await expect(
			getCachedPublicOrganizationDirectoryFirstPage({ url: TEST_URL }, loader)
		).resolves.toMatchObject({ orgs: [{ name: 'Beta' }] });
		expect(loader).toHaveBeenCalledTimes(2);
	});

	it('never caches migration-not-ready responses', async () => {
		const loader = vi
			.fn()
			.mockResolvedValueOnce({
				ready: false,
				status: 'running',
				data: [],
				cursor: null,
				hasMore: false,
				total: 0,
				revision: null,
				updatedAt: NOW
			})
			.mockResolvedValueOnce(rawPage('Alpha'));
		await expect(
			getCachedPublicOrganizationDirectoryFirstPage({ url: TEST_URL }, loader)
		).rejects.toBeInstanceOf(PublicOrganizationDirectoryNotReadyError);
		await expect(
			getCachedPublicOrganizationDirectoryFirstPage({ url: TEST_URL }, loader)
		).resolves.toMatchObject({ orgs: [{ name: 'Alpha' }] });
		expect(loader).toHaveBeenCalledTimes(2);
	});

	it('projects the cache envelope down to the exact SSR allowlist', () => {
		expect(projectPublicOrganizationDirectoryPage(rawPage('Alpha')).orgs[0]).toEqual({
			name: 'Alpha',
			slug: 'alpha',
			description: null,
			mission: 'A public mission',
			logoUrl: null,
			memberCount: 3
		});
	});

	it('rejects inconsistent or attacker-sized cursor envelopes', () => {
		expect(() =>
			projectPublicOrganizationDirectoryPage({
				...rawPage('Alpha'),
				cursor: 'x'.repeat(2_049),
				hasMore: true
			})
		).toThrow('PUBLIC_ORGANIZATION_DIRECTORY_CACHE_INVALID');
	});
});
