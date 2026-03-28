/**
 * Unit tests for Browser-Safe Shadow Atlas Client + District Format
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============================================================================
// browser-client tests
// ============================================================================

describe('browser-client', () => {
	beforeEach(() => {
		vi.resetModules();
		vi.resetAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe('lookupDistrictsFromBrowser', () => {
		it('returns null when IPFS is not configured', async () => {
			// Mock ipfs-store with no root CID configured
			vi.doMock('$lib/core/shadow-atlas/ipfs-store', () => ({
				isIPFSConfigured: () => false,
				getChunkForCell: vi.fn(),
				getOfficialsForDistrict: vi.fn(),
				setCIDs: vi.fn(),
			}));

			const { lookupDistrictsFromBrowser } = await import(
				'$lib/core/shadow-atlas/browser-client'
			);
			const result = await lookupDistrictsFromBrowser(37.7749, -122.4194);
			expect(result).toBeNull();
		});

		it('returns CellDistricts when IPFS is configured and cell has data', async () => {
			const mockSlots = ['cd-0612', 'CA', null, null, ...Array(20).fill(null)];

			vi.doMock('$lib/core/shadow-atlas/ipfs-store', () => ({
				isIPFSConfigured: () => true,
				getChunkForCell: vi.fn().mockResolvedValue(mockSlots),
				getOfficialsForDistrict: vi.fn(),
				setCIDs: vi.fn(),
			}));

			vi.doMock('h3-js', () => ({
				latLngToCell: vi.fn().mockReturnValue('872830828ffffff'),
			}));

			const { lookupDistrictsFromBrowser } = await import(
				'$lib/core/shadow-atlas/browser-client'
			);
			const result = await lookupDistrictsFromBrowser(37.7749, -122.4194);
			expect(result).not.toBeNull();
			expect(result!.slots).toEqual(mockSlots);
		});

		it('returns null when cell has no data', async () => {
			vi.doMock('$lib/core/shadow-atlas/ipfs-store', () => ({
				isIPFSConfigured: () => true,
				getChunkForCell: vi.fn().mockResolvedValue(null),
				getOfficialsForDistrict: vi.fn(),
				setCIDs: vi.fn(),
			}));

			vi.doMock('h3-js', () => ({
				latLngToCell: vi.fn().mockReturnValue('872830828ffffff'),
			}));

			const { lookupDistrictsFromBrowser } = await import(
				'$lib/core/shadow-atlas/browser-client'
			);
			const result = await lookupDistrictsFromBrowser(37.7749, -122.4194);
			expect(result).toBeNull();
		});
	});

	describe('getOfficialsFromBrowser', () => {
		it('returns null when IPFS is not configured', async () => {
			vi.doMock('$lib/core/shadow-atlas/ipfs-store', () => ({
				isIPFSConfigured: () => false,
				getChunkForCell: vi.fn(),
				getOfficialsForDistrict: vi.fn(),
				setCIDs: vi.fn(),
			}));

			const { getOfficialsFromBrowser } = await import(
				'$lib/core/shadow-atlas/browser-client'
			);
			const result = await getOfficialsFromBrowser('CA-12');
			expect(result).toBeNull();
		});

		it('delegates to getOfficialsForDistrict when IPFS is configured', async () => {
			const mockOfficials = {
				version: 1,
				country: 'US',
				district_code: 'CA-12',
				officials: [{ id: 'P000197', name: 'Nancy Pelosi', party: 'Democrat', chamber: 'house', state: 'CA', district: '12', phone: null, office_address: null, contact_form_url: null, website_url: null, is_voting: true, delegate_type: null }],
				generated: '2026-01-01',
			};

			const mockGetOfficials = vi.fn().mockResolvedValue(mockOfficials);
			vi.doMock('$lib/core/shadow-atlas/ipfs-store', () => ({
				isIPFSConfigured: () => true,
				getChunkForCell: vi.fn(),
				getOfficialsForDistrict: mockGetOfficials,
				setCIDs: vi.fn(),
			}));

			const { getOfficialsFromBrowser } = await import(
				'$lib/core/shadow-atlas/browser-client'
			);
			const result = await getOfficialsFromBrowser('CA-12');
			expect(result).toEqual(mockOfficials);
			expect(mockGetOfficials).toHaveBeenCalledWith('CA-12');
		});
	});

});

// ============================================================================
// district-format tests
// ============================================================================

describe('district-format', () => {
	let convertDistrictId: typeof import('$lib/core/shadow-atlas/district-format').convertDistrictId;
	let normalizeDistrictCode: typeof import('$lib/core/shadow-atlas/district-format').normalizeDistrictCode;

	beforeEach(async () => {
		const mod = await import('$lib/core/shadow-atlas/district-format');
		convertDistrictId = mod.convertDistrictId;
		normalizeDistrictCode = mod.normalizeDistrictCode;
	});

	describe('convertDistrictId', () => {
		it('converts substrate FIPS format to state-district format', () => {
			expect(convertDistrictId('cd-0601')).toBe('CA-01');
			expect(convertDistrictId('cd-3614')).toBe('NY-14');
			expect(convertDistrictId('cd-4832')).toBe('TX-32');
		});

		it('converts at-large districts (00) to AL', () => {
			expect(convertDistrictId('cd-5000')).toBe('VT-AL');
			expect(convertDistrictId('cd-0200')).toBe('AK-AL');
		});

		it('converts non-voting delegates (98) to AL', () => {
			expect(convertDistrictId('cd-1198')).toBe('DC-AL');
			expect(convertDistrictId('cd-7298')).toBe('PR-AL');
		});

		it('returns non-substrate IDs unchanged', () => {
			expect(convertDistrictId('CA-12')).toBe('CA-12');
			expect(convertDistrictId('some-other-format')).toBe('some-other-format');
			expect(convertDistrictId('')).toBe('');
		});

		it('returns unknown FIPS codes unchanged', () => {
			// FIPS 03 does not exist
			expect(convertDistrictId('cd-0301')).toBe('cd-0301');
		});
	});

	describe('normalizeDistrictCode', () => {
		it('uppercases and trims', () => {
			expect(normalizeDistrictCode('ca-12')).toBe('CA-12');
			expect(normalizeDistrictCode('  NY-14  ')).toBe('NY-14');
		});

		it('converts substrate format before normalizing', () => {
			expect(normalizeDistrictCode('cd-0612')).toBe('CA-12');
		});
	});
});
