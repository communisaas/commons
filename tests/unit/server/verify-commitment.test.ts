/**
 * Wave 6 / FU-1.1 — issuance-time commitment authenticity tests.
 *
 * Asserts: given (lat, lng) the server fetches the same IPFS cell data the
 * client used, recomputes Poseidon2 sponge over 24 districts, and rejects
 * client-supplied commitments that don't match.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const {
	mockGetFullCellData,
	mockPoseidonSponge,
	mockGetExpectedCellMapRoot,
	mockGetExpectedCellMapDepth,
	mockVerifyCellMapMembership
} = vi.hoisted(() => ({
	mockGetFullCellData: vi.fn(),
	mockPoseidonSponge: vi.fn(),
	mockGetExpectedCellMapRoot: vi.fn(),
	mockGetExpectedCellMapDepth: vi.fn(),
	mockVerifyCellMapMembership: vi.fn()
}));

vi.mock('$lib/core/shadow-atlas/browser-client', () => ({
	getFullCellDataFromBrowser: (...args: unknown[]) => mockGetFullCellData(...args)
}));

vi.mock('$lib/core/crypto/poseidon', () => ({
	poseidon2Sponge24: (...args: unknown[]) => mockPoseidonSponge(...args)
}));

vi.mock('$lib/core/shadow-atlas/ipfs-store', () => ({
	getExpectedCellMapRoot: (...args: unknown[]) => mockGetExpectedCellMapRoot(...args),
	getExpectedCellMapDepth: (...args: unknown[]) => mockGetExpectedCellMapDepth(...args),
	IPFS_CIDS: { root: '', merkleSnapshot: '' }
}));

vi.mock('$lib/core/shadow-atlas/cell-authenticity', () => ({
	verifyCellMapMembership: (...args: unknown[]) => mockVerifyCellMapMembership(...args)
}));

import { verifyDistrictCommitment } from '../../../src/lib/server/identity/verify-commitment';

const VALID_24_DISTRICTS = Array.from({ length: 24 }, (_, i) =>
	'0x' + (i + 1).toString(16).padStart(64, '0')
);

const VALID_CELL_ID = '0x' + 'cc'.repeat(32);
const VALID_PATH = ['0x' + '01'.repeat(32), '0x' + '02'.repeat(32)];
const VALID_PATH_BITS = [0, 1];
const VALID_PINNED_ROOT = '0x' + 'aa'.repeat(32);

const EXPECTED_COMMITMENT = '0xabc' + '0'.repeat(61);

const VALID_CELL_DATA = {
	cellMapRoot: VALID_PINNED_ROOT,
	cellId: VALID_CELL_ID,
	cellMapPath: VALID_PATH,
	cellMapPathBits: VALID_PATH_BITS,
	districts: VALID_24_DISTRICTS
};

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_ALLOW_UNPINNED = process.env.ATLAS_AUTHENTICITY_ALLOW_UNPINNED;

beforeEach(() => {
	vi.clearAllMocks();
	// Default: pin is set, authenticity check passes — tests opt-out via mocks.
	mockGetExpectedCellMapRoot.mockReturnValue(VALID_PINNED_ROOT);
	mockGetExpectedCellMapDepth.mockReturnValue(0);
	mockVerifyCellMapMembership.mockResolvedValue(undefined);
	process.env.NODE_ENV = 'test';
	process.env.ATLAS_AUTHENTICITY_ALLOW_UNPINNED = '';
});

afterEach(() => {
	process.env.NODE_ENV = ORIGINAL_NODE_ENV;
	if (ORIGINAL_ALLOW_UNPINNED !== undefined) {
		process.env.ATLAS_AUTHENTICITY_ALLOW_UNPINNED = ORIGINAL_ALLOW_UNPINNED;
	} else {
		delete process.env.ATLAS_AUTHENTICITY_ALLOW_UNPINNED;
	}
});

describe('verifyDistrictCommitment', () => {
	it('matches: returns matches=true with the expected commitment', async () => {
		mockGetFullCellData.mockResolvedValueOnce(VALID_CELL_DATA);
		mockPoseidonSponge.mockResolvedValueOnce(EXPECTED_COMMITMENT);

		const result = await verifyDistrictCommitment({
			lat: 37.7749,
			lng: -122.4194,
			clientCommitment: EXPECTED_COMMITMENT
		});

		expect(result.matches).toBe(true);
		expect(result.expectedCommitment).toBe(EXPECTED_COMMITMENT);
	});

	it('mismatch: throws COMMITMENT_AUTHENTICITY_MISMATCH', async () => {
		mockGetFullCellData.mockResolvedValueOnce(VALID_CELL_DATA);
		mockPoseidonSponge.mockResolvedValueOnce(EXPECTED_COMMITMENT);

		await expect(
			verifyDistrictCommitment({
				lat: 37.7749,
				lng: -122.4194,
				clientCommitment: '0xdef' + '0'.repeat(61) // different
			})
		).rejects.toThrow(/COMMITMENT_AUTHENTICITY_MISMATCH/);
	});

	it('match is case-insensitive and normalizes leading zeros', async () => {
		// Server returns "0x0...01", client supplies "0x1" — same numeric value.
		const root = '0x' + '0'.repeat(63) + '1';
		mockGetFullCellData.mockResolvedValueOnce(VALID_CELL_DATA);
		mockPoseidonSponge.mockResolvedValueOnce(root);

		const result = await verifyDistrictCommitment({
			lat: 0,
			lng: 0,
			clientCommitment: '0x1'
		});
		expect(result.matches).toBe(true);
	});

	it('IPFS returns null: throws COMMITMENT_VERIFY_IPFS_UNAVAILABLE', async () => {
		mockGetFullCellData.mockResolvedValueOnce(null);

		await expect(
			verifyDistrictCommitment({
				lat: 0,
				lng: 0,
				clientCommitment: EXPECTED_COMMITMENT
			})
		).rejects.toThrow(/COMMITMENT_VERIFY_IPFS_UNAVAILABLE/);
	});

	it('IPFS throws: wrapped as COMMITMENT_VERIFY_IPFS_UNAVAILABLE', async () => {
		mockGetFullCellData.mockRejectedValueOnce(new Error('socket hang up'));

		await expect(
			verifyDistrictCommitment({
				lat: 0,
				lng: 0,
				clientCommitment: EXPECTED_COMMITMENT
			})
		).rejects.toThrow(/COMMITMENT_VERIFY_IPFS_UNAVAILABLE.*socket hang up/);
	});

	it('cell data has wrong district count: throws COMMITMENT_VERIFY_BAD_CELL_DATA', async () => {
		mockGetFullCellData.mockResolvedValueOnce({
			districts: VALID_24_DISTRICTS.slice(0, 12) // only 12, not 24
		});

		await expect(
			verifyDistrictCommitment({
				lat: 0,
				lng: 0,
				clientCommitment: EXPECTED_COMMITMENT
			})
		).rejects.toThrow(/COMMITMENT_VERIFY_BAD_CELL_DATA.*expected 24/);
	});

	it('malformed clientCommitment: throws COMMITMENT_AUTHENTICITY_MISMATCH', async () => {
		mockGetFullCellData.mockResolvedValueOnce(VALID_CELL_DATA);
		mockPoseidonSponge.mockResolvedValueOnce(EXPECTED_COMMITMENT);

		await expect(
			verifyDistrictCommitment({
				lat: 0,
				lng: 0,
				clientCommitment: 'not-hex'
			})
		).rejects.toThrow(/COMMITMENT_AUTHENTICITY_MISMATCH.*not valid hex/);
	});

	it('passes country option through to IPFS fetch', async () => {
		mockGetFullCellData.mockResolvedValueOnce(VALID_CELL_DATA);
		mockPoseidonSponge.mockResolvedValueOnce(EXPECTED_COMMITMENT);

		await verifyDistrictCommitment({
			lat: 51.5,
			lng: -0.1,
			clientCommitment: EXPECTED_COMMITMENT,
			country: 'GB'
		});

		expect(mockGetFullCellData).toHaveBeenCalledWith(
			expect.objectContaining({ lat: 51.5, lng: -0.1, country: 'GB' })
		);
	});

	it('default country is US', async () => {
		mockGetFullCellData.mockResolvedValueOnce(VALID_CELL_DATA);
		mockPoseidonSponge.mockResolvedValueOnce(EXPECTED_COMMITMENT);

		await verifyDistrictCommitment({
			lat: 0,
			lng: 0,
			clientCommitment: EXPECTED_COMMITMENT
		});

		expect(mockGetFullCellData).toHaveBeenCalledWith(
			expect.objectContaining({ country: 'US' })
		);
	});

	// -------------------------------------------------------------------------
	// F-1.1 — atlas authenticity gate
	// -------------------------------------------------------------------------

	it('poisoned-gateway: SMT path mismatch throws COMMITMENT_VERIFY_CELL_MAP_ROOT_MISMATCH', async () => {
		// Simulate the poisoned-source attack: chunk LOOKS valid (24 districts,
		// well-shaped path) but its SMT path doesn't actually resolve to the
		// pinned Tree 2 root — `verifyCellMapMembership` rejects.
		mockGetFullCellData.mockResolvedValueOnce(VALID_CELL_DATA);
		mockVerifyCellMapMembership.mockRejectedValueOnce(
			new Error('CELL_AUTHENTICITY_ROOT_MISMATCH: computed=0xbeef expected=0xaa...')
		);

		await expect(
			verifyDistrictCommitment({
				lat: 1,
				lng: 1,
				clientCommitment: EXPECTED_COMMITMENT
			})
		).rejects.toThrow(/COMMITMENT_VERIFY_CELL_MAP_ROOT_MISMATCH/);

		// Critical: the Poseidon2 sponge over poisoned districts is NEVER
		// computed. Without this guard, the server would have agreed with the
		// client's poisoned commitment and let verification through.
		expect(mockPoseidonSponge).not.toHaveBeenCalled();
	});

	it('authenticity gate runs BEFORE Poseidon sponge, with the fetched chunk fields', async () => {
		mockGetFullCellData.mockResolvedValueOnce(VALID_CELL_DATA);
		mockPoseidonSponge.mockResolvedValueOnce(EXPECTED_COMMITMENT);

		await verifyDistrictCommitment({
			lat: 1,
			lng: 1,
			clientCommitment: EXPECTED_COMMITMENT
		});

		expect(mockVerifyCellMapMembership).toHaveBeenCalledWith({
			cellId: VALID_CELL_ID,
			districts: VALID_24_DISTRICTS,
			siblings: VALID_PATH,
			bits: VALID_PATH_BITS,
			expectedRoot: VALID_PINNED_ROOT
		});
		// Order matters — sponge runs only after the authenticity gate succeeds.
		const sponge = mockPoseidonSponge.mock.invocationCallOrder[0];
		const verify = mockVerifyCellMapMembership.mock.invocationCallOrder[0];
		expect(verify).toBeLessThan(sponge);
	});

	it('chunk missing path/bits/cellId: throws COMMITMENT_VERIFY_BAD_CELL_DATA when pin set', async () => {
		mockGetFullCellData.mockResolvedValueOnce({
			districts: VALID_24_DISTRICTS,
			cellMapPath: undefined,
			cellMapPathBits: undefined,
			cellId: undefined
		});

		await expect(
			verifyDistrictCommitment({
				lat: 0,
				lng: 0,
				clientCommitment: EXPECTED_COMMITMENT
			})
		).rejects.toThrow(/COMMITMENT_VERIFY_BAD_CELL_DATA.*missing/);
		expect(mockVerifyCellMapMembership).not.toHaveBeenCalled();
		expect(mockPoseidonSponge).not.toHaveBeenCalled();
	});

	it('production + pin unset: throws COMMITMENT_VERIFY_CELL_MAP_ROOT_NOT_PINNED (fail-closed)', async () => {
		process.env.NODE_ENV = 'production';
		mockGetExpectedCellMapRoot.mockReturnValue(''); // pin unset
		mockGetFullCellData.mockResolvedValueOnce(VALID_CELL_DATA);

		await expect(
			verifyDistrictCommitment({
				lat: 0,
				lng: 0,
				clientCommitment: EXPECTED_COMMITMENT
			})
		).rejects.toThrow(/COMMITMENT_VERIFY_CELL_MAP_ROOT_NOT_PINNED/);
		expect(mockVerifyCellMapMembership).not.toHaveBeenCalled();
		expect(mockPoseidonSponge).not.toHaveBeenCalled();
	});

	it('production + ATLAS_AUTHENTICITY_ALLOW_UNPINNED=1: bypasses gate (rotation escape hatch)', async () => {
		process.env.NODE_ENV = 'production';
		process.env.ATLAS_AUTHENTICITY_ALLOW_UNPINNED = '1';
		mockGetExpectedCellMapRoot.mockReturnValue('');
		mockGetFullCellData.mockResolvedValueOnce(VALID_CELL_DATA);
		mockPoseidonSponge.mockResolvedValueOnce(EXPECTED_COMMITMENT);

		const result = await verifyDistrictCommitment({
			lat: 0,
			lng: 0,
			clientCommitment: EXPECTED_COMMITMENT
		});
		expect(result.matches).toBe(true);
		expect(mockVerifyCellMapMembership).not.toHaveBeenCalled();
		expect(mockPoseidonSponge).toHaveBeenCalled();
	});

	it('non-production + pin unset: bypasses gate with warning (dev mode)', async () => {
		process.env.NODE_ENV = 'test';
		mockGetExpectedCellMapRoot.mockReturnValue('');
		mockGetFullCellData.mockResolvedValueOnce(VALID_CELL_DATA);
		mockPoseidonSponge.mockResolvedValueOnce(EXPECTED_COMMITMENT);

		const result = await verifyDistrictCommitment({
			lat: 0,
			lng: 0,
			clientCommitment: EXPECTED_COMMITMENT
		});
		expect(result.matches).toBe(true);
		expect(mockVerifyCellMapMembership).not.toHaveBeenCalled();
	});

	it('passes expectedDepth through when configured (defense-in-depth)', async () => {
		mockGetExpectedCellMapDepth.mockReturnValue(20);
		mockGetFullCellData.mockResolvedValueOnce(VALID_CELL_DATA);
		mockPoseidonSponge.mockResolvedValueOnce(EXPECTED_COMMITMENT);

		await verifyDistrictCommitment({
			lat: 0,
			lng: 0,
			clientCommitment: EXPECTED_COMMITMENT
		});
		expect(mockVerifyCellMapMembership).toHaveBeenCalledWith(
			expect.objectContaining({ expectedDepth: 20 })
		);
	});

	it('omits expectedDepth when getExpectedCellMapDepth returns 0', async () => {
		mockGetExpectedCellMapDepth.mockReturnValue(0);
		mockGetFullCellData.mockResolvedValueOnce(VALID_CELL_DATA);
		mockPoseidonSponge.mockResolvedValueOnce(EXPECTED_COMMITMENT);

		await verifyDistrictCommitment({
			lat: 0,
			lng: 0,
			clientCommitment: EXPECTED_COMMITMENT
		});
		const call = mockVerifyCellMapMembership.mock.calls[0][0];
		expect(call.expectedDepth).toBeUndefined();
	});

	it('production bypass emits structured warn log (review finding — observability)', async () => {
		process.env.NODE_ENV = 'production';
		process.env.ATLAS_AUTHENTICITY_ALLOW_UNPINNED = '1';
		mockGetExpectedCellMapRoot.mockReturnValue('');
		mockGetFullCellData.mockResolvedValueOnce(VALID_CELL_DATA);
		mockPoseidonSponge.mockResolvedValueOnce(EXPECTED_COMMITMENT);
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

		try {
			await verifyDistrictCommitment({
				lat: 12.34,
				lng: -56.78,
				clientCommitment: EXPECTED_COMMITMENT
			});

			const tagged = warn.mock.calls.find(
				(c) =>
					typeof c[0] === 'string' && c[0].includes('ATLAS_AUTHENTICITY_GATE_BYPASSED')
			);
			expect(tagged).toBeDefined();
			expect(tagged?.[1]).toMatchObject({
				lat: 12.34,
				lng: -56.78,
				bypass: 'ATLAS_AUTHENTICITY_ALLOW_UNPINNED'
			});
		} finally {
			warn.mockRestore();
		}
	});
});
