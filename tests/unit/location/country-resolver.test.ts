/**
 * Unified postal district resolver dispatcher tests.
 *
 * The deleted server/location resolver factory has been replaced by
 * src/lib/core/location/resolvers, which dispatches GB/CA/AU postal inputs.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
	mockResolveUKPostcode,
	mockResolveCanadaPostalCode,
	mockResolveAustraliaPostcode
} = vi.hoisted(() => ({
	mockResolveUKPostcode: vi.fn(),
	mockResolveCanadaPostalCode: vi.fn(),
	mockResolveAustraliaPostcode: vi.fn()
}));

vi.mock('$lib/core/location/resolvers/uk-postcodes', () => ({
	resolveUKPostcode: (...args: unknown[]) => mockResolveUKPostcode(...args),
	isValidUKPostcode: vi.fn()
}));

vi.mock('$lib/core/location/resolvers/canada-postal', () => ({
	resolveCanadaPostalCode: (...args: unknown[]) => mockResolveCanadaPostalCode(...args),
	isValidCanadaPostalCode: vi.fn()
}));

vi.mock('$lib/core/location/resolvers/australia-aec', () => ({
	resolveAustraliaPostcode: (...args: unknown[]) => mockResolveAustraliaPostcode(...args),
	isValidAustraliaPostcode: vi.fn()
}));

const { resolveDistrict } = await import('$lib/core/location/resolvers');

beforeEach(() => {
	vi.clearAllMocks();
});

describe('resolveDistrict dispatcher', () => {
	it('dispatches GB postcodes to the UK resolver', async () => {
		mockResolveUKPostcode.mockResolvedValue({
			constituencyId: 'E14000639',
			constituencyName: 'Cities of London and Westminster',
			council: 'City of London',
			region: 'London'
		});

		const result = await resolveDistrict('GB', 'SW1A 1AA');

		expect(mockResolveUKPostcode).toHaveBeenCalledWith('SW1A 1AA');
		expect(result).toEqual({
			districtId: 'E14000639',
			districtName: 'Cities of London and Westminster',
			districtType: 'uk-constituency',
			country: 'GB',
			extra: { council: 'City of London', region: 'London' }
		});
	});

	it('dispatches CA postal codes to the Canada resolver', async () => {
		mockResolveCanadaPostalCode.mockResolvedValue({
			ridingId: '35075',
			ridingName: 'Ottawa Centre',
			province: 'ON'
		});

		const result = await resolveDistrict('CA', 'K1A 0A9');

		expect(mockResolveCanadaPostalCode).toHaveBeenCalledWith('K1A 0A9');
		expect(result).toEqual({
			districtId: '35075',
			districtName: 'Ottawa Centre',
			districtType: 'ca-riding',
			country: 'CA',
			extra: { province: 'ON' }
		});
	});

	it('dispatches AU postcodes to the Australia resolver', async () => {
		mockResolveAustraliaPostcode.mockResolvedValue({
			electorateId: 'sydney',
			electorateName: 'Sydney',
			state: 'NSW'
		});

		const result = await resolveDistrict('au', '2000');

		expect(mockResolveAustraliaPostcode).toHaveBeenCalledWith('2000');
		expect(result).toEqual({
			districtId: 'sydney',
			districtName: 'Sydney',
			districtType: 'au-electorate',
			country: 'AU',
			extra: { state: 'NSW' }
		});
	});

	it('rejects US because Shadow Atlas handles US district lookup', async () => {
		await expect(resolveDistrict('US', 'CA-12')).rejects.toThrow(
			'US resolution uses Shadow Atlas'
		);
	});

	it('rejects unsupported countries with the normalized country code', async () => {
		await expect(resolveDistrict('fr', '75001')).rejects.toThrow(
			'Unsupported country code: FR. Supported: GB, CA, AU'
		);
	});
});
