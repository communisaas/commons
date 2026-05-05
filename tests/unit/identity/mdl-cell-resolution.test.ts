/**
 * Tests for cell ID resolution in the mDL privacy boundary.
 *
 * resolveCellIdFromAddress() delegates to Shadow Atlas's sovereign
 * Nominatim + H3 pipeline to resolve city/state/zip to a cell ID
 * for Shadow Atlas Tree 2.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveCellIdFromAddress } from '$lib/core/identity/mdl-verification';

// Mock Shadow Atlas client
vi.mock('$lib/core/shadow-atlas/client', () => ({
	resolveAddress: vi.fn()
}));

import { resolveAddress } from '$lib/core/shadow-atlas/client';
const mockResolveAddress = vi.mocked(resolveAddress);

describe('resolveCellIdFromAddress', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('should resolve a cell ID from Shadow Atlas address resolution', async () => {
		mockResolveAddress.mockResolvedValue({
			geocode: { lat: 39.7392, lng: -104.9903, matched_address: 'Denver, CO 80202', confidence: 0.9, country: 'US' },
			district: { id: 'CO-01', name: 'Congressional District 1', jurisdiction: 'US', district_type: 'cd' },
			officials: { district_code: 'CO-01', state: 'CO', officials: [], special_status: null, cached: true, source: 'congress-legislators' },
			cell_id: '08031000100',
			vintage: 'shadow-atlas-nominatim'
		});

		const result = await resolveCellIdFromAddress('80202', 'Denver', 'CO');
		expect(result).toBe('08031000100');
	});

	it('should pass correct address fields to resolveAddress', async () => {
		mockResolveAddress.mockResolvedValue({
			geocode: { lat: 37.7749, lng: -122.4194, matched_address: 'San Francisco, CA 94103', confidence: 0.9, country: 'US' },
			district: { id: 'CA-11', name: 'Congressional District 11', jurisdiction: 'US', district_type: 'cd' },
			officials: null,
			cell_id: '06075017601',
			vintage: 'shadow-atlas-nominatim'
		});

		await resolveCellIdFromAddress('94103', 'San Francisco', 'CA');

		expect(mockResolveAddress).toHaveBeenCalledWith({
			street: '',
			city: 'San Francisco',
			state: 'CA',
			zip: '94103'
		});
	});

	it('should return null when Shadow Atlas resolution fails', async () => {
		mockResolveAddress.mockRejectedValue(new Error('Nominatim geocoding returned 500'));

		const result = await resolveCellIdFromAddress('80202', 'Denver', 'CO');
		expect(result).toBeNull();
	});

	it('should return null when address not found', async () => {
		mockResolveAddress.mockRejectedValue(new Error('Address not found. Please check your address and try again.'));

		const result = await resolveCellIdFromAddress('00000', 'Nowhere', 'XX');
		expect(result).toBeNull();
	});

	it('should return null when cell_id not available in response', async () => {
		mockResolveAddress.mockResolvedValue({
			geocode: { lat: 39.7392, lng: -104.9903, matched_address: 'Denver, CO 80202', confidence: 0.9, country: 'US' },
			district: { id: 'CO-01', name: 'Congressional District 1', jurisdiction: 'US', district_type: 'cd' },
			officials: null,
			cell_id: null,
			vintage: 'shadow-atlas-nominatim'
		});

		const result = await resolveCellIdFromAddress('80202', 'Denver', 'CO');
		expect(result).toBeNull();
	});

	it('should handle timeout errors gracefully', async () => {
		mockResolveAddress.mockRejectedValue(new DOMException('Aborted', 'AbortError'));

		const result = await resolveCellIdFromAddress('80202', 'Denver', 'CO');
		expect(result).toBeNull();
	});

	it('should resolve DC cell ID correctly', async () => {
		mockResolveAddress.mockResolvedValue({
			geocode: { lat: 38.9072, lng: -77.0369, matched_address: 'Washington, DC 20001', confidence: 0.9, country: 'US' },
			district: { id: 'DC-AL', name: 'At-Large Congressional District', jurisdiction: 'US', district_type: 'cd' },
			officials: { district_code: 'DC-AL', state: 'DC', officials: [], special_status: { type: 'dc', message: 'DC residents have a non-voting delegate', has_senators: false, has_voting_representative: false }, cached: true, source: 'congress-legislators' },
			cell_id: '11001000101',
			vintage: 'shadow-atlas-nominatim'
		});

		const result = await resolveCellIdFromAddress('20001', 'Washington', 'DC');
		expect(result).toBe('11001000101');
		expect(result).toHaveLength(11);
	});
});
