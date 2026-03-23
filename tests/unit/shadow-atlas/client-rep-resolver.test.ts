/**
 * Unit tests for Client-Side Representative Resolver
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('client-rep-resolver', () => {
	beforeEach(() => {
		vi.resetModules();
		vi.resetAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	const MOCK_CREDENTIAL = {
		userId: 'user-123',
		type: 'district_residency' as const,
		credential: {
			'@context': ['https://www.w3.org/ns/credentials/v2'],
			type: ['VerifiableCredential', 'DistrictResidencyCredential'],
			issuer: 'did:web:commons.email',
			issuanceDate: '2026-01-01T00:00:00Z',
			expirationDate: '2027-01-01T00:00:00Z',
			credentialSubject: {
				id: 'did:key:z123',
				districtMembership: {
					congressional: 'CA-12',
				},
			},
		},
		issuedAt: '2026-01-01T00:00:00Z',
		expiresAt: '2027-01-01T00:00:00Z',
		credentialHash: 'abc123',
	};

	const MOCK_OFFICIALS = {
		version: 1,
		country: 'US',
		district_code: 'CA-12',
		officials: [
			{
				id: 'P000197',
				name: 'Nancy Pelosi',
				party: 'Democrat',
				chamber: 'house',
				state: 'CA',
				district: '12',
				phone: null,
				office_address: null,
				contact_form_url: null,
				website_url: null,
				is_voting: true,
				delegate_type: null,
			},
			{
				id: 'F000062',
				name: 'Dianne Feinstein',
				party: 'Democrat',
				chamber: 'senate',
				state: 'CA',
				district: null,
				phone: null,
				office_address: null,
				contact_form_url: null,
				website_url: null,
				is_voting: true,
				delegate_type: null,
			},
		],
		generated: '2026-01-01',
	};

	const MOCK_TREE_STATE = {
		leafIndex: 42,
		merklePath: Array(20).fill('0x00'),
		merkleRoot: '0xabc',
		congressionalDistrict: 'CA-12',
	};

	/**
	 * Helper to set up mocks for all three dependencies.
	 */
	function setupMocks(opts: {
		treeState?: unknown;
		credential?: unknown;
		officials?: unknown;
	}) {
		vi.doMock('$lib/core/identity/session-credentials', () => ({
			getTreeState: vi.fn().mockResolvedValue(opts.treeState ?? null),
		}));

		vi.doMock('$lib/core/identity/credential-store', () => ({
			getCredential: vi.fn().mockResolvedValue(opts.credential ?? null),
		}));

		vi.doMock('$lib/core/shadow-atlas/browser-client', () => ({
			getOfficialsFromBrowser: vi.fn().mockResolvedValue(opts.officials ?? null),
		}));
	}

	it('resolves reps from session credential tree state (primary path)', async () => {
		setupMocks({
			treeState: MOCK_TREE_STATE,
			officials: MOCK_OFFICIALS,
		});

		const { resolveRepsFromCredential } = await import(
			'$lib/core/identity/client-rep-resolver'
		);

		const result = await resolveRepsFromCredential('user-123');

		expect(result.source).toBe('session-credential');
		expect(result.districtCode).toBe('CA-12');
		expect(result.representatives).toHaveLength(2);
		expect(result.representatives[0]).toEqual({
			name: 'Nancy Pelosi',
			party: 'Democrat',
			chamber: 'house',
			state: 'CA',
			district: '12',
			title: 'Representative',
			jurisdiction: 'CA',
		});
		expect(result.representatives[1]).toEqual({
			name: 'Dianne Feinstein',
			party: 'Democrat',
			chamber: 'senate',
			state: 'CA',
			district: '',
			title: 'Senator',
			jurisdiction: 'CA',
		});
	});

	it('falls back to credential wallet when tree state has no district', async () => {
		setupMocks({
			treeState: { ...MOCK_TREE_STATE, congressionalDistrict: undefined },
			credential: MOCK_CREDENTIAL,
			officials: MOCK_OFFICIALS,
		});

		const { resolveRepsFromCredential } = await import(
			'$lib/core/identity/client-rep-resolver'
		);

		const result = await resolveRepsFromCredential('user-123');
		expect(result.source).toBe('credential-wallet');
		expect(result.districtCode).toBe('CA-12');
		expect(result.representatives).toHaveLength(2);
	});

	it('returns empty when no credential sources exist', async () => {
		setupMocks({});

		const { resolveRepsFromCredential } = await import(
			'$lib/core/identity/client-rep-resolver'
		);

		const result = await resolveRepsFromCredential('user-123');
		expect(result.source).toBe('none');
		expect(result.representatives).toEqual([]);
		expect(result.districtCode).toBeNull();
	});

	it('returns empty when credential is expired', async () => {
		setupMocks({
			credential: { ...MOCK_CREDENTIAL, expiresAt: '2020-01-01T00:00:00Z' },
		});

		const { resolveRepsFromCredential } = await import(
			'$lib/core/identity/client-rep-resolver'
		);

		const result = await resolveRepsFromCredential('user-123');
		expect(result.source).toBe('none');
		expect(result.representatives).toEqual([]);
	});

	it('returns empty when credential has no district', async () => {
		setupMocks({
			credential: {
				...MOCK_CREDENTIAL,
				credential: {
					credentialSubject: {
						id: 'did:key:z123',
						districtMembership: {},
					},
				},
			},
		});

		const { resolveRepsFromCredential } = await import(
			'$lib/core/identity/client-rep-resolver'
		);

		const result = await resolveRepsFromCredential('user-123');
		expect(result.source).toBe('none');
		expect(result.districtCode).toBeNull();
	});

	it('returns districtCode but no reps when IPFS is unavailable', async () => {
		setupMocks({
			credential: MOCK_CREDENTIAL,
			officials: null,
		});

		const { resolveRepsFromCredential } = await import(
			'$lib/core/identity/client-rep-resolver'
		);

		const result = await resolveRepsFromCredential('user-123');
		expect(result.source).toBe('none');
		expect(result.districtCode).toBe('CA-12');
		expect(result.representatives).toEqual([]);
	});

	it('handles errors gracefully', async () => {
		vi.doMock('$lib/core/identity/session-credentials', () => ({
			getTreeState: vi.fn().mockRejectedValue(new Error('IndexedDB unavailable')),
		}));
		vi.doMock('$lib/core/identity/credential-store', () => ({
			getCredential: vi.fn(),
		}));
		vi.doMock('$lib/core/shadow-atlas/browser-client', () => ({
			getOfficialsFromBrowser: vi.fn(),
		}));

		const { resolveRepsFromCredential } = await import(
			'$lib/core/identity/client-rep-resolver'
		);

		const result = await resolveRepsFromCredential('user-123');
		expect(result.source).toBe('none');
		expect(result.representatives).toEqual([]);
	});

	it('maps null district to empty string in rep output', async () => {
		const singleSenator = {
			...MOCK_OFFICIALS,
			officials: [MOCK_OFFICIALS.officials[1]], // senator with null district
		};

		setupMocks({
			treeState: MOCK_TREE_STATE,
			officials: singleSenator,
		});

		const { resolveRepsFromCredential } = await import(
			'$lib/core/identity/client-rep-resolver'
		);

		const result = await resolveRepsFromCredential('user-123');
		expect(result.representatives[0].district).toBe('');
	});

	it('prefers session credential over credential wallet', async () => {
		// Both sources available — should use tree state (source 1)
		setupMocks({
			treeState: { ...MOCK_TREE_STATE, congressionalDistrict: 'NY-14' },
			credential: MOCK_CREDENTIAL, // has CA-12
			officials: MOCK_OFFICIALS,
		});

		const { resolveRepsFromCredential } = await import(
			'$lib/core/identity/client-rep-resolver'
		);

		const result = await resolveRepsFromCredential('user-123');
		expect(result.source).toBe('session-credential');
		expect(result.districtCode).toBe('NY-14');
	});
});
