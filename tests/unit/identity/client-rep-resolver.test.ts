/**
 * Tests for client-side representative resolver (C-2a)
 *
 * Verifies that resolveRepsFromCredential:
 *   - Resolves reps from session credential tree state (primary path)
 *   - Falls back to credential wallet VC (secondary path)
 *   - Returns empty when no credentials exist
 *   - Handles IPFS failures gracefully
 *   - Checks credential expiration
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mockGetTreeState = vi.hoisted(() => vi.fn());
const mockGetCredential = vi.hoisted(() => vi.fn());
const mockGetOfficialsFromBrowser = vi.hoisted(() => vi.fn());

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('$lib/core/identity/session-credentials', () => ({
	getTreeState: mockGetTreeState
}));

vi.mock('$lib/core/identity/credential-store', () => ({
	getCredential: mockGetCredential
}));

vi.mock('$lib/core/shadow-atlas/browser-client', () => ({
	getOfficialsFromBrowser: mockGetOfficialsFromBrowser
}));

vi.mock('$lib/core/shadow-atlas/ipfs-store', () => ({}));

// ---------------------------------------------------------------------------
// Import module under test AFTER mocks
// ---------------------------------------------------------------------------

import { resolveRepsFromCredential } from '$lib/core/identity/client-rep-resolver';
import type { RepResolverResult } from '$lib/core/identity/client-rep-resolver';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const USER_ID = 'user-rep-001';

const MOCK_OFFICIALS = {
	version: 1,
	country: 'US',
	district_code: 'CA-12',
	officials: [
		{
			id: 'bio-001',
			name: 'Nancy Pelosi',
			party: 'Democrat',
			chamber: 'house',
			state: 'CA',
			district: 'CA-12',
			bioguide_id: 'P000197',
		},
		{
			id: 'bio-002',
			name: 'Dianne Feinstein',
			party: 'Democrat',
			chamber: 'senate',
			state: 'CA',
			district: null,
			bioguide_id: 'F000062',
		},
	],
};

const MOCK_TREE_STATE = {
	leafIndex: 42,
	merklePath: ['0x1', '0x2'],
	merkleRoot: '0xroot',
	congressionalDistrict: 'CA-12',
	createdAt: new Date(),
	expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
};

function makeDistrictCredential(district: string, expired = false) {
	const expiresAt = expired
		? new Date(Date.now() - 1000).toISOString()
		: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
	return {
		userId: USER_ID,
		type: 'district_residency' as const,
		credential: {
			'@context': ['https://www.w3.org/ns/credentials/v2'],
			type: ['VerifiableCredential', 'DistrictResidencyCredential'],
			credentialSubject: {
				id: `urn:commons:user:${USER_ID}`,
				districtMembership: { congressional: district },
			},
		},
		issuedAt: new Date().toISOString(),
		expiresAt,
		credentialHash: 'abc123',
	};
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
	vi.clearAllMocks();
	mockGetTreeState.mockResolvedValue(null);
	mockGetCredential.mockResolvedValue(null);
	mockGetOfficialsFromBrowser.mockResolvedValue(null);
});

afterEach(() => {
	vi.restoreAllMocks();
});

// ============================================================================
// Tests
// ============================================================================

describe('resolveRepsFromCredential', () => {
	describe('session credential tree state (primary path)', () => {
		it('should resolve reps from tree state congressionalDistrict', async () => {
			mockGetTreeState.mockResolvedValue(MOCK_TREE_STATE);
			mockGetOfficialsFromBrowser.mockResolvedValue(MOCK_OFFICIALS);

			const result = await resolveRepsFromCredential(USER_ID);

			expect(result.source).toBe('session-credential');
			expect(result.districtCode).toBe('CA-12');
			expect(result.representatives).toHaveLength(2);
			expect(mockGetTreeState).toHaveBeenCalledWith(USER_ID);
			expect(mockGetOfficialsFromBrowser).toHaveBeenCalledWith('CA-12');
		});

		it('should map officials to ClientRep shape', async () => {
			mockGetTreeState.mockResolvedValue(MOCK_TREE_STATE);
			mockGetOfficialsFromBrowser.mockResolvedValue(MOCK_OFFICIALS);

			const result = await resolveRepsFromCredential(USER_ID);
			const house = result.representatives.find(r => r.chamber === 'house');
			const senate = result.representatives.find(r => r.chamber === 'senate');

			expect(house).toEqual({
				name: 'Nancy Pelosi',
				party: 'Democrat',
				chamber: 'house',
				state: 'CA',
				district: 'CA-12',
				title: 'Representative',
				jurisdiction: 'CA',
			});

			expect(senate).toEqual({
				name: 'Dianne Feinstein',
				party: 'Democrat',
				chamber: 'senate',
				state: 'CA',
				district: '',
				title: 'Senator',
				jurisdiction: 'CA',
			});
		});

		it('should not query credential wallet when tree state succeeds', async () => {
			mockGetTreeState.mockResolvedValue(MOCK_TREE_STATE);
			mockGetOfficialsFromBrowser.mockResolvedValue(MOCK_OFFICIALS);

			await resolveRepsFromCredential(USER_ID);

			expect(mockGetCredential).not.toHaveBeenCalled();
		});
	});

	describe('credential wallet fallback (secondary path)', () => {
		it('should fall back to credential wallet when tree state is null', async () => {
			mockGetTreeState.mockResolvedValue(null);
			mockGetCredential.mockResolvedValue(makeDistrictCredential('NY-14'));
			mockGetOfficialsFromBrowser.mockResolvedValue({
				...MOCK_OFFICIALS,
				district_code: 'NY-14',
			});

			const result = await resolveRepsFromCredential(USER_ID);

			expect(result.source).toBe('credential-wallet');
			expect(result.districtCode).toBe('NY-14');
			expect(mockGetCredential).toHaveBeenCalledWith(USER_ID, 'district_residency');
		});

		it('should fall back when tree state has no congressionalDistrict', async () => {
			mockGetTreeState.mockResolvedValue({ ...MOCK_TREE_STATE, congressionalDistrict: '' });
			mockGetCredential.mockResolvedValue(makeDistrictCredential('TX-07'));
			mockGetOfficialsFromBrowser.mockResolvedValue({
				...MOCK_OFFICIALS,
				district_code: 'TX-07',
			});

			const result = await resolveRepsFromCredential(USER_ID);

			expect(result.source).toBe('credential-wallet');
			expect(result.districtCode).toBe('TX-07');
		});

		it('should fall back when tree state IPFS returns no officials', async () => {
			mockGetTreeState.mockResolvedValue(MOCK_TREE_STATE);
			// First call (tree state path) returns null, second call (wallet path) returns officials
			mockGetOfficialsFromBrowser
				.mockResolvedValueOnce(null)
				.mockResolvedValueOnce(MOCK_OFFICIALS);
			mockGetCredential.mockResolvedValue(makeDistrictCredential('CA-12'));

			const result = await resolveRepsFromCredential(USER_ID);

			expect(result.source).toBe('credential-wallet');
		});

		it('should reject expired credential wallet VCs', async () => {
			mockGetTreeState.mockResolvedValue(null);
			mockGetCredential.mockResolvedValue(makeDistrictCredential('CA-12', true));

			const result = await resolveRepsFromCredential(USER_ID);

			expect(result.source).toBe('none');
			expect(result.representatives).toHaveLength(0);
			expect(mockGetOfficialsFromBrowser).not.toHaveBeenCalled();
		});
	});

	describe('no credentials available', () => {
		it('should return empty when no credentials exist', async () => {
			const result = await resolveRepsFromCredential(USER_ID);

			expect(result).toEqual({
				representatives: [],
				source: 'none',
				districtCode: null,
			});
		});

		it('should return districtCode when district known but IPFS unavailable', async () => {
			mockGetTreeState.mockResolvedValue(null);
			mockGetCredential.mockResolvedValue(makeDistrictCredential('WA-09'));
			mockGetOfficialsFromBrowser.mockResolvedValue(null);

			const result = await resolveRepsFromCredential(USER_ID);

			expect(result.districtCode).toBe('WA-09');
			expect(result.representatives).toHaveLength(0);
			expect(result.source).toBe('none');
		});
	});

	describe('error handling', () => {
		it('should return empty on tree state read error', async () => {
			mockGetTreeState.mockRejectedValue(new Error('IndexedDB blocked'));

			const result = await resolveRepsFromCredential(USER_ID);

			expect(result.source).toBe('none');
			expect(result.representatives).toHaveLength(0);
		});

		it('should return empty on IPFS fetch error', async () => {
			mockGetTreeState.mockResolvedValue(MOCK_TREE_STATE);
			mockGetOfficialsFromBrowser.mockRejectedValue(new Error('Gateway timeout'));
			mockGetCredential.mockResolvedValue(null);

			const result = await resolveRepsFromCredential(USER_ID);

			// The tree state path throws, then credential wallet path returns null
			expect(result.source).toBe('none');
		});

		it('should not throw — always returns a result', async () => {
			mockGetTreeState.mockRejectedValue(new Error('Catastrophic'));
			mockGetCredential.mockRejectedValue(new Error('Also broken'));

			const result = await resolveRepsFromCredential(USER_ID);

			expect(result).toBeDefined();
			expect(result.source).toBe('none');
		});
	});
});
