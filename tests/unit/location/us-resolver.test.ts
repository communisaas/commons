/**
 * US Shadow Atlas resolver tests.
 *
 * The old USResolver class was deleted; US resolution now uses the Shadow Atlas
 * client directly for H3 district lookup and officials.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
	mockLatLngToCell,
	mockGetChunkForCell,
	mockGetOfficialsForDistrict,
	mockIsIPFSConfigured
} = vi.hoisted(() => ({
	mockLatLngToCell: vi.fn(),
	mockGetChunkForCell: vi.fn(),
	mockGetOfficialsForDistrict: vi.fn(),
	mockIsIPFSConfigured: vi.fn()
}));

vi.mock('$env/dynamic/private', () => ({
	env: {}
}));

vi.mock('h3-js', () => ({
	latLngToCell: (...args: unknown[]) => mockLatLngToCell(...args)
}));

vi.mock('$lib/core/shadow-atlas/ipfs-store', () => ({
	getMerkleSnapshot: vi.fn(),
	checkIPFSHealth: vi.fn(),
	isIPFSConfigured: (...args: unknown[]) => mockIsIPFSConfigured(...args),
	getChunkForCell: (...args: unknown[]) => mockGetChunkForCell(...args),
	getOfficialsForDistrict: (...args: unknown[]) => mockGetOfficialsForDistrict(...args),
	clearCache: vi.fn()
}));

vi.mock('$lib/core/shadow-atlas/cell-tree-snapshot', () => ({
	deserializeCellTreeSnapshot: vi.fn(),
	computeClientCellProof: vi.fn(),
	validateSnapshotRoot: vi.fn()
}));

const { lookupDistrict, getOfficials } = await import('$lib/core/shadow-atlas/client');

describe('Shadow Atlas US lookup', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockLatLngToCell.mockReturnValue('872830828ffffff');
		mockGetChunkForCell.mockResolvedValue(['cd-0601']);
		mockIsIPFSConfigured.mockReturnValue(true);
	});

	describe('lookupDistrict', () => {
		it('resolves coordinates to the congressional district in slot 0', async () => {
			const result = await lookupDistrict(37.7749, -122.4194);

			expect(mockLatLngToCell).toHaveBeenCalledWith(37.7749, -122.4194, 7);
			expect(mockGetChunkForCell).toHaveBeenCalledWith('872830828ffffff');
			expect(result).toEqual({
				district: {
					id: 'CA-01',
					name: "California's 1st Congressional District",
					jurisdiction: 'congressional',
					districtType: 'congressional'
				},
				merkleProof: null,
				cell_id: '872830828ffffff'
			});
		});

		it('rejects invalid coordinates before consulting H3', async () => {
			await expect(lookupDistrict(91, -122.4194)).rejects.toThrow(
				'Invalid latitude: 91. Must be between -90 and 90.'
			);
			expect(mockLatLngToCell).not.toHaveBeenCalled();
		});

		it('rejects locations without district data', async () => {
			mockGetChunkForCell.mockResolvedValue(null);

			await expect(lookupDistrict(0, 0)).rejects.toThrow(
				'No district data for H3 cell 872830828ffffff'
			);
		});

		it('rejects cells missing congressional slot data', async () => {
			mockGetChunkForCell.mockResolvedValue([null, 'state-senate']);

			await expect(lookupDistrict(37.7749, -122.4194)).rejects.toThrow(
				'Cell has no congressional district assignment'
			);
		});
	});

	describe('getOfficials', () => {
		it('maps IPFS officials data to the public officials response', async () => {
			mockGetOfficialsForDistrict.mockResolvedValue({
				version: 1,
				country: 'US',
				district_code: 'CA-01',
				generated: '2026-03-21T00:00:00Z',
				officials: [
					{
						id: 'P000197',
						name: 'Nancy Pelosi',
						party: 'Democrat',
						chamber: 'house',
						state: 'CA',
						district: '01',
						phone: '202-225-4965',
						office_address: null,
						contact_form_url: null,
						website_url: 'https://pelosi.house.gov',
						is_voting: true,
						delegate_type: null
					}
				]
			});

			const officials = await getOfficials('CA-01');

			expect(mockGetOfficialsForDistrict).toHaveBeenCalledWith('CA-01');
			expect(officials).toEqual({
				officials: [
					{
						bioguide_id: 'P000197',
						name: 'Nancy Pelosi',
						party: 'Democrat',
						chamber: 'house',
						state: 'CA',
						district: '01',
						office: 'Representative, CA',
						phone: '202-225-4965',
						contact_form_url: null,
						website_url: 'https://pelosi.house.gov',
						cwc_code: null,
						is_voting: true,
						delegate_type: null
					}
				],
				district_code: 'CA-01',
				state: 'CA',
				special_status: null,
				source: 'congress-legislators',
				cached: true
			});
		});

		it('throws when IPFS officials data is unavailable', async () => {
			mockGetOfficialsForDistrict.mockResolvedValue(null);

			await expect(getOfficials('CA-01')).rejects.toThrow(
				'Officials lookup failed [IPFS]: No officials data for district CA-01'
			);
		});
	});
});
