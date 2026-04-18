/**
 * Tests for B-3b: AddressVerificationFlow client-side resolution logic.
 *
 * Exercises the browser-client functions the component uses when
 * SHADOW_ATLAS_VERIFICATION is enabled:
 * - lookupDistrictsFromBrowser → district slots from IPFS
 * - convertDistrictId → substrate FIPS → display format
 * - getOfficialsFromBrowser → officials for UI display
 *
 * Also verifies the feature flag gating in features.ts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('B-3b: AddressVerificationFlow client-side resolution', () => {
	beforeEach(() => {
		vi.resetModules();
		vi.resetAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe('feature flag gating', () => {
		it('SHADOW_ATLAS_VERIFICATION flag exists and is boolean true', async () => {
			const { FEATURES } = await import('$lib/config/features');
			expect(typeof FEATURES.SHADOW_ATLAS_VERIFICATION).toBe('boolean');
			expect(FEATURES.SHADOW_ATLAS_VERIFICATION).toBe(true);
		});
	});

	describe('end-to-end client-side resolution flow', () => {
		it('resolves lat/lng → districts → officials (simulating component flow)', async () => {
			const mockSlots = ['cd-0612', 'CA', null, null, ...Array(20).fill(null)];
			const mockOfficials = {
				version: 1,
				country: 'US',
				district_code: 'CA-12',
				officials: [{
					id: 'P000197',
					name: 'Nancy Pelosi',
					party: 'Democrat',
					chamber: 'house',
					state: 'CA',
					district: '12',
					phone: null,
					office_address: '2457 Rayburn House Office Building',
					contact_form_url: null,
					website_url: null,
					is_voting: true,
					delegate_type: null
				}],
				generated: '2026-01-01'
			};

			vi.doMock('$lib/core/shadow-atlas/ipfs-store', () => ({
				configure: vi.fn(),
				isConfigured: () => true,
				isIPFSConfigured: () => true,
				getChunkForCell: vi.fn().mockResolvedValue(mockSlots),
				getOfficialsForDistrict: vi.fn().mockResolvedValue(mockOfficials),
				setCIDs: vi.fn(),
			}));
			vi.doMock('h3-js', () => ({
				latLngToCell: vi.fn().mockReturnValue('872830828ffffff'),
			}));
			const { lookupDistrictsFromBrowser, getOfficialsFromBrowser } =
				await import('$lib/core/shadow-atlas/browser-client');
			const { convertDistrictId } = await import('$lib/core/shadow-atlas/district-format');

			// Step 1: Lookup districts from IPFS (what component does after getting lat/lng)
			const cellDistricts = await lookupDistrictsFromBrowser(37.7749, -122.4194);
			expect(cellDistricts).not.toBeNull();
			expect(cellDistricts!.slots[0]).toBe('cd-0612');

			// Step 2: Convert FIPS format to display format (component does this)
			const districtCode = convertDistrictId(cellDistricts!.slots[0]!);
			expect(districtCode).toBe('CA-12');

			// Step 3: Fetch officials for UI (component displays these)
			const officials = await getOfficialsFromBrowser(districtCode);
			expect(officials).not.toBeNull();
			expect(officials!.officials).toHaveLength(1);
			expect(officials!.officials[0].name).toBe('Nancy Pelosi');
		});

		it('returns null when cell has no congressional district (slot 0 empty)', async () => {
			const emptySlots = Array(24).fill(null);

			vi.doMock('$lib/core/shadow-atlas/ipfs-store', () => ({
				configure: vi.fn(),
				isConfigured: () => true,
				isIPFSConfigured: () => true,
				getChunkForCell: vi.fn().mockResolvedValue(emptySlots),
				getOfficialsForDistrict: vi.fn(),
				setCIDs: vi.fn(),
			}));
			vi.doMock('h3-js', () => ({
				latLngToCell: vi.fn().mockReturnValue('872830828ffffff'),
			}));

			const { lookupDistrictsFromBrowser } =
				await import('$lib/core/shadow-atlas/browser-client');

			const cellDistricts = await lookupDistrictsFromBrowser(37.7749, -122.4194);
			// CellDistricts returned but slot 0 is null → component would fall back to server
			expect(cellDistricts).not.toBeNull();
			expect(cellDistricts!.slots[0]).toBeNull();
		});

		it('falls back gracefully when content source is not configured', async () => {
			vi.doMock('$lib/core/shadow-atlas/ipfs-store', () => ({
				configure: vi.fn(),
				isConfigured: () => false,
				isIPFSConfigured: () => false,
				getChunkForCell: vi.fn(),
				getOfficialsForDistrict: vi.fn(),
				setCIDs: vi.fn(),
			}));

			const { lookupDistrictsFromBrowser } =
				await import('$lib/core/shadow-atlas/browser-client');

			const result = await lookupDistrictsFromBrowser(37.7749, -122.4194);
			expect(result).toBeNull();
		});
	});

});
