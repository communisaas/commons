/**
 * Unit tests for /api/identity/verify-address POST handler
 *
 * Tests the Tier 2 credential issuance endpoint:
 *   - Input validation: district format regex, verification_method enum
 *   - Credential issuance: W3C VC 2.0 format, TTL (90 days), integrity hash
 *   - Trust tier upgrade logic (never downgrade)
 *   - Database transaction atomicity (credential create + user update)
 *   - Auth guard (requires authenticated session)
 *   - Error cases: invalid district format, missing fields, DB errors
 *
 * Security contract:
 *   - Only authenticated users may issue credentials
 *   - District format strictly validated: /^[A-Z]{2}-(\d{2}|AL)$/
 *   - verification_method must be 'civic_api', 'postal', or 'shadow_atlas'
 *   - Trust tier is NEVER downgraded (Math.max(current, 2))
 *   - Credential + user update are atomic ($transaction)
 *   - identity_commitment is NOT set by Tier 2 (only Tier 3+ mDL sets it)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mockIssueDistrictCredential = vi.hoisted(() => vi.fn());
const mockHashCredential = vi.hoisted(() => vi.fn());
const mockHashDistrict = vi.hoisted(() => vi.fn());
// district_hash_v2 and hashDistrictSalted removed — hashDistrict now uses HMAC internally

const mockDbUser = vi.hoisted(() => ({
	findUniqueOrThrow: vi.fn()
}));

const mockDbDistrictCredential = vi.hoisted(() => ({
	create: vi.fn()
}));

const mockDbUserUpdate = vi.hoisted(() => ({
	update: vi.fn()
}));

const mockDbTransaction = vi.hoisted(() => vi.fn());

const mockDb = vi.hoisted(() => ({
	user: mockDbUser,
	districtCredential: mockDbDistrictCredential,
	$transaction: mockDbTransaction
}));

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('$lib/core/db', () => ({
	db: mockDb,
	prisma: mockDb
}));

vi.mock('$lib/core/identity/district-credential', () => ({
	issueDistrictCredential: mockIssueDistrictCredential,
	hashCredential: mockHashCredential,
	hashDistrict: mockHashDistrict
}));

vi.mock('$lib/core/identity/credential-policy', () => ({
	TIER_CREDENTIAL_TTL: {
		0: 0,
		1: 365 * 24 * 60 * 60 * 1000,
		2: 90 * 24 * 60 * 60 * 1000,     // 90 days
		3: 180 * 24 * 60 * 60 * 1000,
		4: 180 * 24 * 60 * 60 * 1000,
		5: 365 * 24 * 60 * 60 * 1000
	}
}));

// ---------------------------------------------------------------------------
// Import the module under test AFTER mocks are set up
// ---------------------------------------------------------------------------

import { POST } from '../../../src/routes/api/identity/verify-address/+server';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const TEST_USER_ID = 'user-addr-001';

const MOCK_CREDENTIAL = {
	'@context': ['https://www.w3.org/ns/credentials/v2'],
	type: ['VerifiableCredential', 'DistrictResidencyCredential'],
	issuer: 'did:web:commons.email',
	issuanceDate: '2026-01-15T00:00:00.000Z',
	expirationDate: '2026-04-15T00:00:00.000Z',
	credentialSubject: {
		id: 'did:key:zMockDID',
		districtMembership: { congressional: 'CA-12' }
	},
	proof: {
		type: 'Ed25519Signature2020',
		created: '2026-01-15T00:00:00.000Z',
		verificationMethod: 'did:web:commons.email#district-attestation-key',
		proofPurpose: 'assertionMethod',
		proofValue: 'mock-signature-base64url'
	}
};

const MOCK_CREDENTIAL_HASH = 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
const MOCK_DISTRICT_HASH = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';

function makeRequestEvent(overrides: {
	body?: unknown;
	user?: { id: string } | null;
} = {}) {
	const body = overrides.body ?? {
		district: 'CA-12',
		verification_method: 'civic_api'
	};

	return {
		request: new Request('http://localhost/api/identity/verify-address', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		}),
		locals: {
			user: overrides.user !== undefined ? overrides.user : { id: TEST_USER_ID },
			session: overrides.user !== undefined
				? (overrides.user ? { userId: overrides.user.id } : null)
				: { userId: TEST_USER_ID }
		},
		params: {},
		url: new URL('http://localhost/api/identity/verify-address'),
		cookies: { get: () => undefined, getAll: () => [], set: () => {}, delete: () => {}, serialize: () => '' },
		fetch: globalThis.fetch,
		getClientAddress: () => '127.0.0.1',
		platform: null,
		setHeaders: () => {},
		isDataRequest: false,
		isSubRequest: false,
		route: { id: '/api/identity/verify-address' }
	} as any;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
	vi.clearAllMocks();

	// Default mock implementations for happy path
	mockDbUser.findUniqueOrThrow.mockResolvedValue({
		did_key: 'did:key:zMockDID',
		trust_tier: 1,
	});

	mockIssueDistrictCredential.mockResolvedValue(MOCK_CREDENTIAL);
	mockHashCredential.mockResolvedValue(MOCK_CREDENTIAL_HASH);
	mockHashDistrict.mockResolvedValue(MOCK_DISTRICT_HASH);

	// Transaction mock: execute callback with mock tx
	mockDbTransaction.mockImplementation(async (fn: (tx: any) => Promise<void>) => {
		const tx = {
			districtCredential: {
				create: vi.fn().mockResolvedValue({}),
				updateMany: vi.fn().mockResolvedValue({})
			},
			$executeRaw: vi.fn().mockResolvedValue(1),
			userDMRelation: {
				updateMany: vi.fn().mockResolvedValue({}),
				upsert: vi.fn().mockResolvedValue({})
			},
			externalId: {
				findUnique: vi.fn().mockResolvedValue(null),
				create: vi.fn().mockResolvedValue({})
			},
			decisionMaker: {
				update: vi.fn().mockResolvedValue({}),
				create: vi.fn().mockResolvedValue({ id: 'dm-mock' })
			},
			institution: {
				upsert: vi.fn().mockResolvedValue({ id: 'inst-mock' })
			}
		};
		return fn(tx);
	});
});

afterEach(() => {
	vi.restoreAllMocks();
});

// ============================================================================
// Authentication Guard
// ============================================================================

describe('POST /api/identity/verify-address', () => {
	describe('authentication guard', () => {
		it('should return 401 when user is not authenticated', async () => {
			const event = makeRequestEvent({ user: null });
			const response = await POST(event);
			const data = await response.json();

			expect(response.status).toBe(401);
			expect(data.success).toBe(false);
			expect(data.error).toBe('Authentication required');
		});

		it('should return 401 when locals.user is undefined', async () => {
			const event = makeRequestEvent();
			event.locals.user = undefined;

			const response = await POST(event);
			const data = await response.json();

			expect(response.status).toBe(401);
			expect(data.success).toBe(false);
		});

		it('should proceed when user is authenticated', async () => {
			const event = makeRequestEvent();
			const response = await POST(event);

			expect(response.status).toBe(200);
		});
	});

	// ============================================================================
	// Input Validation: District Format
	// ============================================================================

	describe('input validation: district format', () => {
		it('should accept valid district format "CA-12"', async () => {
			const event = makeRequestEvent({ body: { district: 'CA-12', verification_method: 'civic_api' } });
			const response = await POST(event);

			expect(response.status).toBe(200);
		});

		it('should accept at-large district format "WY-AL"', async () => {
			const event = makeRequestEvent({ body: { district: 'WY-AL', verification_method: 'civic_api' } });
			const response = await POST(event);

			expect(response.status).toBe(200);
		});

		it('should accept single-digit district with leading zero "NY-01"', async () => {
			const event = makeRequestEvent({ body: { district: 'NY-01', verification_method: 'civic_api' } });
			const response = await POST(event);

			expect(response.status).toBe(200);
		});

		it('should accept high-numbered district "TX-36"', async () => {
			const event = makeRequestEvent({ body: { district: 'TX-36', verification_method: 'civic_api' } });
			const response = await POST(event);

			expect(response.status).toBe(200);
		});

		it('should reject lowercase state abbreviation "ca-12"', async () => {
			const event = makeRequestEvent({ body: { district: 'ca-12', verification_method: 'civic_api' } });
			const response = await POST(event);
			const data = await response.json();

			expect(response.status).toBe(400);
			expect(data.error).toContain('Invalid district format');
		});

		it('should reject three-letter state code "CAL-12"', async () => {
			const event = makeRequestEvent({ body: { district: 'CAL-12', verification_method: 'civic_api' } });
			const response = await POST(event);

			expect(response.status).toBe(400);
		});

		it('should reject single-letter state code "C-12"', async () => {
			const event = makeRequestEvent({ body: { district: 'C-12', verification_method: 'civic_api' } });
			const response = await POST(event);

			expect(response.status).toBe(400);
		});

		it('should reject district without hyphen "CA12"', async () => {
			const event = makeRequestEvent({ body: { district: 'CA12', verification_method: 'civic_api' } });
			const response = await POST(event);

			expect(response.status).toBe(400);
		});

		it('should reject three-digit district number "CA-123"', async () => {
			const event = makeRequestEvent({ body: { district: 'CA-123', verification_method: 'civic_api' } });
			const response = await POST(event);

			expect(response.status).toBe(400);
		});

		it('should reject single-digit district number without leading zero "CA-1"', async () => {
			const event = makeRequestEvent({ body: { district: 'CA-1', verification_method: 'civic_api' } });
			const response = await POST(event);

			expect(response.status).toBe(400);
		});

		it('should reject empty district string', async () => {
			const event = makeRequestEvent({ body: { district: '', verification_method: 'civic_api' } });
			const response = await POST(event);

			expect(response.status).toBe(400);
		});

		it('should reject numeric district value', async () => {
			const event = makeRequestEvent({ body: { district: 12, verification_method: 'civic_api' } });
			const response = await POST(event);

			expect(response.status).toBe(400);
		});

		it('should reject null district', async () => {
			const event = makeRequestEvent({ body: { district: null, verification_method: 'civic_api' } });
			const response = await POST(event);

			expect(response.status).toBe(400);
		});

		it('should reject missing district field', async () => {
			const event = makeRequestEvent({ body: { verification_method: 'civic_api' } });
			const response = await POST(event);

			expect(response.status).toBe(400);
		});

		it('should reject lowercase "al" in at-large district "WY-al"', async () => {
			const event = makeRequestEvent({ body: { district: 'WY-al', verification_method: 'civic_api' } });
			const response = await POST(event);

			expect(response.status).toBe(400);
		});
	});

	// ============================================================================
	// Input Validation: Verification Method
	// ============================================================================

	describe('input validation: verification_method', () => {
		it('should accept "civic_api"', async () => {
			const event = makeRequestEvent({ body: { district: 'CA-12', verification_method: 'civic_api' } });
			const response = await POST(event);

			expect(response.status).toBe(200);
		});

		it('should accept "postal"', async () => {
			const event = makeRequestEvent({ body: { district: 'CA-12', verification_method: 'postal' } });
			const response = await POST(event);

			expect(response.status).toBe(200);
		});

		it('should reject unknown verification method "email"', async () => {
			const event = makeRequestEvent({ body: { district: 'CA-12', verification_method: 'email' } });
			const response = await POST(event);
			const data = await response.json();

			expect(response.status).toBe(400);
			expect(data.error).toContain('verification_method must be');
		});

		it('should reject empty string verification method', async () => {
			const event = makeRequestEvent({ body: { district: 'CA-12', verification_method: '' } });
			const response = await POST(event);

			expect(response.status).toBe(400);
		});

		it('should reject missing verification_method', async () => {
			const event = makeRequestEvent({ body: { district: 'CA-12' } });
			const response = await POST(event);

			expect(response.status).toBe(400);
		});

		it('should reject numeric verification_method', async () => {
			const event = makeRequestEvent({ body: { district: 'CA-12', verification_method: 1 } });
			const response = await POST(event);

			expect(response.status).toBe(400);
		});
	});

	// ============================================================================
	// Input Validation: Request Body
	// ============================================================================

	describe('input validation: request body', () => {
		it('should reject empty object body (no required fields)', async () => {
			const event = makeRequestEvent({ body: {} });
			const response = await POST(event);

			expect(response.status).toBe(400);
		});

		it('should reject non-object body (string)', async () => {
			const event = makeRequestEvent();
			event.request = new Request('http://localhost/api/identity/verify-address', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify('not an object')
			});

			const response = await POST(event);
			expect(response.status).toBe(400);
		});

		it('should reject non-JSON body', async () => {
			const event = makeRequestEvent();
			event.request = new Request('http://localhost/api/identity/verify-address', {
				method: 'POST',
				headers: { 'Content-Type': 'text/plain' },
				body: 'not json at all'
			});

			const response = await POST(event);
			expect(response.status).toBe(400);
		});

		it('should accept optional state_senate_district', async () => {
			const event = makeRequestEvent({
				body: {
					district: 'CA-12',
					verification_method: 'civic_api',
					state_senate_district: 'CA-SD-11'
				}
			});
			const response = await POST(event);

			expect(response.status).toBe(200);
			expect(mockIssueDistrictCredential).toHaveBeenCalledWith(
				expect.objectContaining({ stateSenate: 'CA-SD-11' })
			);
		});

		it('should accept optional state_assembly_district', async () => {
			const event = makeRequestEvent({
				body: {
					district: 'CA-12',
					verification_method: 'civic_api',
					state_assembly_district: 'CA-AD-19'
				}
			});
			const response = await POST(event);

			expect(response.status).toBe(200);
			expect(mockIssueDistrictCredential).toHaveBeenCalledWith(
				expect.objectContaining({ stateAssembly: 'CA-AD-19' })
			);
		});

		it('should ignore non-string state_senate_district', async () => {
			const event = makeRequestEvent({
				body: {
					district: 'CA-12',
					verification_method: 'civic_api',
					state_senate_district: 42
				}
			});
			const response = await POST(event);

			expect(response.status).toBe(200);
			expect(mockIssueDistrictCredential).toHaveBeenCalledWith(
				expect.objectContaining({ stateSenate: undefined })
			);
		});
	});

	// ============================================================================
	// Credential Issuance
	// ============================================================================

	describe('credential issuance', () => {
		it('should call issueDistrictCredential with correct parameters', async () => {
			const event = makeRequestEvent({
				body: {
					district: 'CA-12',
					verification_method: 'civic_api',
					state_senate_district: 'CA-SD-11'
				}
			});

			await POST(event);

			expect(mockIssueDistrictCredential).toHaveBeenCalledWith({
				userId: TEST_USER_ID,
				didKey: 'did:key:zMockDID',
				congressional: 'CA-12',
				stateSenate: 'CA-SD-11',
				stateAssembly: undefined,
				verificationMethod: 'civic_api'
			});
		});

		it('should use the user did_key from database', async () => {
			mockDbUser.findUniqueOrThrow.mockResolvedValue({
				did_key: 'did:key:zCustomDIDKey',
				trust_tier: 0
			});

			const event = makeRequestEvent();
			await POST(event);

			expect(mockIssueDistrictCredential).toHaveBeenCalledWith(
				expect.objectContaining({ didKey: 'did:key:zCustomDIDKey' })
			);
		});

		it('should compute and return the credential hash', async () => {
			const event = makeRequestEvent();
			const response = await POST(event);
			const data = await response.json();

			expect(mockHashCredential).toHaveBeenCalledWith(MOCK_CREDENTIAL);
			expect(data.credentialHash).toBe(MOCK_CREDENTIAL_HASH);
		});

		it('should compute the district hash for privacy-preserving storage', async () => {
			const event = makeRequestEvent({
				body: { district: 'NY-14', verification_method: 'civic_api' }
			});

			await POST(event);

			expect(mockHashDistrict).toHaveBeenCalledWith('NY-14');
		});

		it('should return the credential in the response body', async () => {
			const event = makeRequestEvent();
			const response = await POST(event);
			const data = await response.json();

			expect(data.success).toBe(true);
			expect(data.credential).toEqual(MOCK_CREDENTIAL);
		});
	});

	// ============================================================================
	// Trust Tier Upgrade Logic
	// ============================================================================

	describe('trust tier upgrade logic', () => {
		// Trust tier non-downgrade is enforced by SQL GREATEST(trust_tier, 2)
		// These tests verify the transaction executes successfully at each tier level

		it('should execute $executeRaw for user with trust_tier 0', async () => {
			mockDbUser.findUniqueOrThrow.mockResolvedValue({
				did_key: 'did:key:zMock',
				trust_tier: 0,
					});

			const event = makeRequestEvent();
			const response = await POST(event);

			expect(response.status).toBe(200);
			expect(mockDbTransaction).toHaveBeenCalledTimes(1);
		});

		it('should execute $executeRaw for user with trust_tier 1', async () => {
			mockDbUser.findUniqueOrThrow.mockResolvedValue({
				did_key: 'did:key:zMock',
				trust_tier: 1,
					});

			const event = makeRequestEvent();
			const response = await POST(event);

			expect(response.status).toBe(200);
			expect(mockDbTransaction).toHaveBeenCalledTimes(1);
		});

		it('should succeed for user already at trust_tier 3 (GREATEST prevents downgrade)', async () => {
			mockDbUser.findUniqueOrThrow.mockResolvedValue({
				did_key: 'did:key:zMock',
				trust_tier: 3,
					});

			const event = makeRequestEvent();
			const response = await POST(event);

			expect(response.status).toBe(200);
		});

		it('should succeed for user already at trust_tier 5 (GREATEST prevents downgrade)', async () => {
			mockDbUser.findUniqueOrThrow.mockResolvedValue({
				did_key: 'did:key:zMock',
				trust_tier: 5,
					});

			const event = makeRequestEvent();
			const response = await POST(event);

			expect(response.status).toBe(200);
		});

		it('should succeed for user already at trust_tier 2', async () => {
			mockDbUser.findUniqueOrThrow.mockResolvedValue({
				did_key: 'did:key:zMock',
				trust_tier: 2,
					});

			const event = makeRequestEvent();
			const response = await POST(event);

			expect(response.status).toBe(200);
		});
	});

	// ============================================================================
	// Database Transaction Atomicity
	// ============================================================================

	describe('database transaction atomicity', () => {
		it('should execute credential create and user update in a single transaction', async () => {
			const event = makeRequestEvent();
			await POST(event);

			expect(mockDbTransaction).toHaveBeenCalledTimes(1);
			expect(mockDbTransaction).toHaveBeenCalledWith(expect.any(Function));
		});

		it('should create DistrictCredential with correct fields', async () => {
			let txCredentialCreateData: any;
			mockDbTransaction.mockImplementation(async (fn: any) => {
				const tx = {
					districtCredential: {
						create: vi.fn().mockImplementation((args: any) => {
							txCredentialCreateData = args;
							return {};
						}),
						updateMany: vi.fn().mockResolvedValue({})
					},
					$executeRaw: vi.fn().mockResolvedValue(1)
				};
				return fn(tx);
			});

			const event = makeRequestEvent({
				body: {
					district: 'CA-12',
					verification_method: 'civic_api',
					state_senate_district: 'CA-SD-11'
				}
			});

			await POST(event);

			expect(txCredentialCreateData.data.user_id).toBe(TEST_USER_ID);
			expect(txCredentialCreateData.data.credential_type).toBe('district_residency');
			expect(txCredentialCreateData.data.congressional_district).toBe('CA-12');
			expect(txCredentialCreateData.data.state_senate_district).toBe('CA-SD-11');
			expect(txCredentialCreateData.data.state_assembly_district).toBeNull();
			expect(txCredentialCreateData.data.verification_method).toBe('civic_api');
			expect(txCredentialCreateData.data.credential_hash).toBe(MOCK_CREDENTIAL_HASH);
			expect(txCredentialCreateData.data.issued_at).toBeInstanceOf(Date);
			expect(txCredentialCreateData.data.expires_at).toBeInstanceOf(Date);
		});

		it('should set credential expiration to 90 days from issuance', async () => {
			let txCredentialCreateData: any;
			const before = Date.now();

			mockDbTransaction.mockImplementation(async (fn: any) => {
				const tx = {
					districtCredential: {
						create: vi.fn().mockImplementation((args: any) => {
							txCredentialCreateData = args;
							return {};
						}),
						updateMany: vi.fn().mockResolvedValue({})
					},
					$executeRaw: vi.fn().mockResolvedValue(1)
				};
				return fn(tx);
			});

			const event = makeRequestEvent();
			await POST(event);

			const after = Date.now();
			const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
			const issuedAt = txCredentialCreateData.data.issued_at.getTime();
			const expiresAt = txCredentialCreateData.data.expires_at.getTime();

			expect(issuedAt).toBeGreaterThanOrEqual(before);
			expect(issuedAt).toBeLessThanOrEqual(after);
			expect(expiresAt - issuedAt).toBe(ninetyDaysMs);
		});

		it('should call $executeRaw to update user with verification flags', async () => {
			let executeRawCalled = false;
			mockDbTransaction.mockImplementation(async (fn: any) => {
				const tx = {
					districtCredential: { create: vi.fn().mockResolvedValue({}), updateMany: vi.fn().mockResolvedValue({}) },
					$executeRaw: vi.fn().mockImplementation(() => {
						executeRawCalled = true;
						return 1;
					})
				};
				return fn(tx);
			});

			const event = makeRequestEvent({
				body: { district: 'CA-12', verification_method: 'civic_api' }
			});

			const response = await POST(event);

			expect(response.status).toBe(200);
			expect(executeRawCalled).toBe(true);
		});

		it('should NOT set identity_commitment (Tier 2 is not person-bound)', async () => {
			const event = makeRequestEvent({
				body: { district: 'CA-12', verification_method: 'civic_api' }
			});

			const response = await POST(event);
			const data = await response.json();

			expect(data).not.toHaveProperty('identity_commitment');
		});

		it('should propagate transaction errors as 500', async () => {
			mockDbTransaction.mockRejectedValue(new Error('Deadlock detected'));

			const event = makeRequestEvent();
			const response = await POST(event);
			const data = await response.json();

			expect(response.status).toBe(500);
			expect(data.success).toBe(false);
			expect(data.error).toContain('Failed to issue district credential');
		});
	});

	// ============================================================================
	// Officials Upsert (Representative Persistence)
	// ============================================================================

	describe('officials upsert', () => {
		it('should accept and validate officials array in input', async () => {
			const event = makeRequestEvent({
				body: {
					district: 'IL-18',
					verification_method: 'civic_api',
					officials: [
						{
							name: 'Senator One (Illinois)',
							chamber: 'senate',
							party: 'Democratic',
							state: 'IL',
							district: 'IL',
							bioguide_id: 'I000001'
						},
						{
							name: 'Representative (Illinois-18)',
							chamber: 'house',
							party: 'Republican',
							state: 'IL',
							district: '18',
							bioguide_id: 'H000018',
							phone: '202-555-0100',
							office_code: 'IL18'
						}
					]
				}
			});

			const response = await POST(event);
			expect(response.status).toBe(200);
		});

		it('should create DecisionMaker and UserDMRelation in transaction', async () => {
			const dmCreateCalls: any[] = [];
			const dmRelationUpsertCalls: any[] = [];
			const deactivateCalls: any[] = [];

			mockDbTransaction.mockImplementation(async (fn: any) => {
				const tx = {
					districtCredential: { create: vi.fn().mockResolvedValue({}), updateMany: vi.fn().mockResolvedValue({}) },
					$executeRaw: vi.fn().mockResolvedValue(1),
					userDMRelation: {
						updateMany: vi.fn().mockImplementation((args: any) => {
							deactivateCalls.push(args);
							return {};
						}),
						upsert: vi.fn().mockImplementation((args: any) => {
							dmRelationUpsertCalls.push(args);
							return {};
						})
					},
					externalId: {
						findUnique: vi.fn().mockResolvedValue(null),
						create: vi.fn().mockResolvedValue({})
					},
					decisionMaker: {
						update: vi.fn().mockResolvedValue({}),
						create: vi.fn().mockImplementation((args: any) => {
							dmCreateCalls.push(args);
							return { id: `dm-${dmCreateCalls.length}` };
						})
					},
					institution: {
						upsert: vi.fn().mockResolvedValue({ id: 'inst-mock' })
					}
				};
				return fn(tx);
			});

			const event = makeRequestEvent({
				body: {
					district: 'IL-18',
					verification_method: 'civic_api',
					officials: [
						{
							name: 'Senator Test',
							chamber: 'senate',
							party: 'Democratic',
							state: 'IL',
							district: 'IL',
							bioguide_id: 'I000001'
						},
						{
							name: 'Rep Test',
							chamber: 'house',
							party: 'Republican',
							state: 'IL',
							district: '18',
							bioguide_id: 'H000018'
						}
					]
				}
			});

			const response = await POST(event);
			expect(response.status).toBe(200);

			// Should deactivate existing UserDMRelation rows first
			expect(deactivateCalls).toHaveLength(1);
			expect(deactivateCalls[0].where.userId).toBe(TEST_USER_ID);
			expect(deactivateCalls[0].data.isActive).toBe(false);

			// Should create 2 decision-makers (since externalId.findUnique returns null)
			expect(dmCreateCalls).toHaveLength(2);
			expect(dmCreateCalls[0].data.name).toBe('Senator Test');
			expect(dmCreateCalls[0].data.title).toBe('Senator');
			expect(dmCreateCalls[0].data.type).toBe('legislator');
			expect(dmCreateCalls[1].data.name).toBe('Rep Test');
			expect(dmCreateCalls[1].data.title).toBe('Representative');

			// Should create 2 UserDMRelation records
			expect(dmRelationUpsertCalls).toHaveLength(2);
			expect(dmRelationUpsertCalls[0].create.userId).toBe(TEST_USER_ID);
			expect(dmRelationUpsertCalls[0].create.relationship).toBe('constituent');
			expect(dmRelationUpsertCalls[0].create.isActive).toBe(true);
		});

		it('should skip DM creation when no officials provided', async () => {
			const dmCreateCalls: any[] = [];

			mockDbTransaction.mockImplementation(async (fn: any) => {
				const tx = {
					districtCredential: { create: vi.fn().mockResolvedValue({}), updateMany: vi.fn().mockResolvedValue({}) },
					$executeRaw: vi.fn().mockResolvedValue(1),
					userDMRelation: {
						updateMany: vi.fn(),
						upsert: vi.fn()
					},
					externalId: {
						findUnique: vi.fn().mockResolvedValue(null),
						create: vi.fn().mockResolvedValue({})
					},
					decisionMaker: {
						update: vi.fn(),
						create: vi.fn().mockImplementation((args: any) => {
							dmCreateCalls.push(args);
							return { id: 'nope' };
						})
					},
					institution: {
						upsert: vi.fn().mockResolvedValue({ id: 'inst-mock' })
					}
				};
				return fn(tx);
			});

			const event = makeRequestEvent({
				body: {
					district: 'CA-12',
					verification_method: 'civic_api'
					// No officials field
				}
			});

			const response = await POST(event);
			expect(response.status).toBe(200);

			// Should NOT have called DM create
			expect(dmCreateCalls).toHaveLength(0);
		});

		it('should filter out officials missing required fields', async () => {
			const dmCreateCalls: any[] = [];

			mockDbTransaction.mockImplementation(async (fn: any) => {
				const tx = {
					districtCredential: { create: vi.fn().mockResolvedValue({}), updateMany: vi.fn().mockResolvedValue({}) },
					$executeRaw: vi.fn().mockResolvedValue(1),
					userDMRelation: {
						updateMany: vi.fn().mockResolvedValue({}),
						upsert: vi.fn().mockResolvedValue({})
					},
					externalId: {
						findUnique: vi.fn().mockResolvedValue(null),
						create: vi.fn().mockResolvedValue({})
					},
					decisionMaker: {
						update: vi.fn(),
						create: vi.fn().mockImplementation((args: any) => {
							dmCreateCalls.push(args);
							return { id: `dm-${dmCreateCalls.length}` };
						})
					},
					institution: {
						upsert: vi.fn().mockResolvedValue({ id: 'inst-mock' })
					}
				};
				return fn(tx);
			});

			const event = makeRequestEvent({
				body: {
					district: 'CA-12',
					verification_method: 'civic_api',
					officials: [
						// Valid official
						{
							name: 'Valid Rep',
							chamber: 'house',
							party: 'Democratic',
							state: 'CA',
							district: '12',
							bioguide_id: 'C000012'
						},
						// Missing bioguide_id — should be filtered out
						{
							name: 'Invalid Rep',
							chamber: 'house',
							party: 'Republican'
						},
						// Missing name — should be filtered out
						{
							chamber: 'senate',
							party: 'Democratic',
							bioguide_id: 'S000001'
						}
					]
				}
			});

			const response = await POST(event);
			expect(response.status).toBe(200);

			// Only the valid official should be created as DM
			expect(dmCreateCalls).toHaveLength(1);
			expect(dmCreateCalls[0].data.name).toBe('Valid Rep');
		});

		it('should derive title from chamber for DecisionMaker creation', async () => {
			const dmCreateCalls: any[] = [];

			mockDbTransaction.mockImplementation(async (fn: any) => {
				const tx = {
					districtCredential: { create: vi.fn().mockResolvedValue({}), updateMany: vi.fn().mockResolvedValue({}) },
					$executeRaw: vi.fn().mockResolvedValue(1),
					userDMRelation: {
						updateMany: vi.fn().mockResolvedValue({}),
						upsert: vi.fn().mockResolvedValue({})
					},
					externalId: {
						findUnique: vi.fn().mockResolvedValue(null),
						create: vi.fn().mockResolvedValue({})
					},
					decisionMaker: {
						update: vi.fn(),
						create: vi.fn().mockImplementation((args: any) => {
							dmCreateCalls.push(args);
							return { id: `dm-${dmCreateCalls.length}` };
						})
					},
					institution: {
						upsert: vi.fn().mockResolvedValue({ id: 'inst-mock' })
					}
				};
				return fn(tx);
			});

			const event = makeRequestEvent({
				body: {
					district: 'CA-12',
					verification_method: 'civic_api',
					officials: [
						{
							name: 'House Rep',
							chamber: 'house',
							party: 'Democratic',
							state: 'CA',
							district: '12',
							bioguide_id: 'C000012'
						},
						{
							name: 'Senate Rep',
							chamber: 'senate',
							party: 'Republican',
							state: 'CA',
							district: 'CA',
							bioguide_id: 'S000001'
						}
					]
				}
			});

			const response = await POST(event);
			expect(response.status).toBe(200);

			expect(dmCreateCalls[0].data.title).toBe('Representative');
			expect(dmCreateCalls[1].data.title).toBe('Senator');
		});
	});

	// ============================================================================
	// Error Cases
	// ============================================================================

	describe('error cases', () => {
		it('should return 500 when user lookup fails', async () => {
			mockDbUser.findUniqueOrThrow.mockRejectedValue(
				new Error('Record not found')
			);

			const event = makeRequestEvent();
			const response = await POST(event);
			const data = await response.json();

			expect(response.status).toBe(500);
			expect(data.success).toBe(false);
		});

		it('should return 500 when credential issuance fails', async () => {
			mockIssueDistrictCredential.mockRejectedValue(
				new Error('IDENTITY_SIGNING_KEY not configured')
			);

			const event = makeRequestEvent();
			const response = await POST(event);
			const data = await response.json();

			expect(response.status).toBe(500);
			expect(data.success).toBe(false);
		});

		it('should return 500 when hashCredential fails', async () => {
			mockHashCredential.mockRejectedValue(
				new Error('SHA-256 digest failed')
			);

			const event = makeRequestEvent();
			const response = await POST(event);

			expect(response.status).toBe(500);
		});

		it('should return 500 when hashDistrict fails', async () => {
			mockHashDistrict.mockRejectedValue(
				new Error('SHA-256 digest failed')
			);

			const event = makeRequestEvent();
			const response = await POST(event);

			expect(response.status).toBe(500);
		});
	});

	// ============================================================================
	// Response Format
	// ============================================================================

	describe('response format', () => {
		it('should return success=true with credential and credentialHash (no identity_commitment)', async () => {
			const event = makeRequestEvent();
			const response = await POST(event);
			const data = await response.json();

			expect(response.status).toBe(200);
			expect(data).toHaveProperty('success', true);
			expect(data).toHaveProperty('credential');
			expect(data).toHaveProperty('credentialHash');
			expect(data).not.toHaveProperty('identity_commitment');
		});

		it('should return JSON content type', async () => {
			const event = makeRequestEvent();
			const response = await POST(event);

			expect(response.headers.get('content-type')).toContain('application/json');
		});

		it('should return error format on validation failure', async () => {
			const event = makeRequestEvent({ body: { district: 'invalid' } });
			const response = await POST(event);
			const data = await response.json();

			expect(response.status).toBe(400);
			expect(data.success).toBe(false);
			expect(data.error).toBeDefined();
		});
	});

	// ============================================================================
	// B-3c: shadow_atlas Verification Method
	// ============================================================================

	describe('shadow_atlas verification method (B-3c)', () => {
		const VALID_COMMITMENT = 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';

		it('should accept shadow_atlas as valid verification_method', async () => {
			const event = makeRequestEvent({
				body: {
					verification_method: 'shadow_atlas',
					district_commitment: VALID_COMMITMENT,
					slot_count: 3
				}
			});

			const response = await POST(event);
			const data = await response.json();

			expect(response.status).toBe(200);
			expect(data.success).toBe(true);
			expect(data.commitment).toBe(VALID_COMMITMENT);
		});

		it('should accept shadow_atlas commitment-only (no district)', async () => {
			const event = makeRequestEvent({
				body: {
					verification_method: 'shadow_atlas',
					district_commitment: VALID_COMMITMENT,
					slot_count: 3
				}
			});

			const response = await POST(event);
			const data = await response.json();

			expect(response.status).toBe(200);
			expect(data.success).toBe(true);
			expect(data.commitment).toBe(VALID_COMMITMENT);
			// No W3C VC in commitment-only path
			expect(data.credential).toBeUndefined();
			expect(data.credentialHash).toBeUndefined();
		});

		it('should reject shadow_atlas without commitment', async () => {
			const event = makeRequestEvent({
				body: {
					verification_method: 'shadow_atlas'
				}
			});

			const response = await POST(event);
			const data = await response.json();

			expect(response.status).toBe(400);
			expect(data.error).toContain('shadow_atlas verification requires a valid district_commitment');
		});

		it('should reject shadow_atlas with invalid commitment format', async () => {
			const event = makeRequestEvent({
				body: {
					verification_method: 'shadow_atlas',
					district_commitment: 'not-valid-hex'
				}
			});

			const response = await POST(event);

			expect(response.status).toBe(400);
		});

		it('should not call issueDistrictCredential in shadow_atlas commitment-only path', async () => {
			const event = makeRequestEvent({
				body: {
					verification_method: 'shadow_atlas',
					district_commitment: VALID_COMMITMENT
				}
			});

			await POST(event);

			expect(mockIssueDistrictCredential).not.toHaveBeenCalled();
			expect(mockHashCredential).not.toHaveBeenCalled();
			expect(mockHashDistrict).not.toHaveBeenCalled();
		});

		it('should execute transaction in shadow_atlas commitment-only path', async () => {
			const event = makeRequestEvent({
				body: {
					verification_method: 'shadow_atlas',
					district_commitment: VALID_COMMITMENT
				}
			});

			await POST(event);

			expect(mockDbTransaction).toHaveBeenCalledTimes(1);
		});

		it('should store commitment in districtCredential create', async () => {
			let txCredentialCreateData: any;
			mockDbTransaction.mockImplementation(async (fn: any) => {
				const tx = {
					districtCredential: {
						create: vi.fn().mockImplementation((args: any) => {
							txCredentialCreateData = args;
							return {};
						}),
						updateMany: vi.fn().mockResolvedValue({})
					},
					$executeRaw: vi.fn().mockResolvedValue(1)
				};
				return fn(tx);
			});

			const event = makeRequestEvent({
				body: {
					verification_method: 'shadow_atlas',
					district_commitment: VALID_COMMITMENT,
					slot_count: 5
				}
			});

			await POST(event);

			expect(txCredentialCreateData.data.congressional_district).toBeNull();
			expect(txCredentialCreateData.data.district_commitment).toBe(VALID_COMMITMENT);
			expect(txCredentialCreateData.data.slot_count).toBe(5);
			expect(txCredentialCreateData.data.credential_hash).toBeNull();
			expect(txCredentialCreateData.data.verification_method).toBe('shadow_atlas');
		});

		it('should not set district_hash in user update for shadow_atlas commitment-only', async () => {
			let executeRawArgs: any;
			mockDbTransaction.mockImplementation(async (fn: any) => {
				const tx = {
					districtCredential: {
						create: vi.fn().mockResolvedValue({}),
						updateMany: vi.fn().mockResolvedValue({})
					},
					$executeRaw: vi.fn().mockImplementation((...args: any[]) => {
						executeRawArgs = args;
						return 1;
					})
				};
				return fn(tx);
			});

			const event = makeRequestEvent({
				body: {
					verification_method: 'shadow_atlas',
					district_commitment: VALID_COMMITMENT
				}
			});

			await POST(event);

			// The raw SQL should NOT contain district_hash
			const sqlTemplate = executeRawArgs[0];
			const sqlStr = Array.isArray(sqlTemplate) ? sqlTemplate.join('') : String(sqlTemplate);
			expect(sqlStr).not.toContain('district_hash');
		});

		it('should skip UserDMRelation writes for shadow_atlas even with officials', async () => {
			const dmRelationUpsertCalls: any[] = [];
			const deactivateCalls: any[] = [];

			mockDbTransaction.mockImplementation(async (fn: any) => {
				const tx = {
					districtCredential: { create: vi.fn().mockResolvedValue({}), updateMany: vi.fn().mockResolvedValue({}) },
					$executeRaw: vi.fn().mockResolvedValue(1),
					userDMRelation: {
						updateMany: vi.fn().mockImplementation((args: any) => {
							deactivateCalls.push(args);
							return {};
						}),
						upsert: vi.fn().mockImplementation((args: any) => {
							dmRelationUpsertCalls.push(args);
							return {};
						})
					},
					externalId: {
						findUnique: vi.fn().mockResolvedValue(null),
						create: vi.fn().mockResolvedValue({})
					},
					decisionMaker: {
						create: vi.fn().mockResolvedValue({ id: 'dm-1' })
					},
					institution: {
						upsert: vi.fn().mockResolvedValue({ id: 'inst-mock' })
					}
				};
				return fn(tx);
			});

			const event = makeRequestEvent({
				body: {
					verification_method: 'shadow_atlas',
					district_commitment: VALID_COMMITMENT,
					officials: [
						{
							name: 'Senator Test',
							chamber: 'senate',
							party: 'Democratic',
							state: 'IL',
							district: 'IL',
							bioguide_id: 'I000001'
						}
					]
				}
			});

			const response = await POST(event);
			expect(response.status).toBe(200);

			// shadow_atlas is commitment-only — officials should be skipped
			expect(deactivateCalls).toHaveLength(0);
			expect(dmRelationUpsertCalls).toHaveLength(0);
		});

		it('should accept shadow_atlas with optional district for display', async () => {
			const event = makeRequestEvent({
				body: {
					verification_method: 'shadow_atlas',
					district: 'CA-12',
					district_commitment: VALID_COMMITMENT
				}
			});

			const response = await POST(event);
			const data = await response.json();

			expect(response.status).toBe(200);
			expect(data.success).toBe(true);
			// With district provided, VC is issued
			expect(data.credential).toBeDefined();
			expect(data.credentialHash).toBeDefined();
		});

		it('should reject shadow_atlas with invalid district format', async () => {
			const event = makeRequestEvent({
				body: {
					verification_method: 'shadow_atlas',
					district: 'invalid',
					district_commitment: VALID_COMMITMENT
				}
			});

			const response = await POST(event);

			expect(response.status).toBe(400);
		});

		it('should accept commitment with 0x prefix', async () => {
			const event = makeRequestEvent({
				body: {
					verification_method: 'shadow_atlas',
					district_commitment: '0x' + VALID_COMMITMENT
				}
			});

			const response = await POST(event);
			const data = await response.json();

			expect(response.status).toBe(200);
			expect(data.success).toBe(true);
		});

		it('should return 500 on transaction failure in shadow_atlas path', async () => {
			mockDbTransaction.mockRejectedValue(new Error('DB connection lost'));

			const event = makeRequestEvent({
				body: {
					verification_method: 'shadow_atlas',
					district_commitment: VALID_COMMITMENT
				}
			});

			const response = await POST(event);
			const data = await response.json();

			expect(response.status).toBe(500);
			expect(data.success).toBe(false);
		});
	});

	// ============================================================================
	// B-3c: civic_api/postal still require district
	// ============================================================================

	describe('civic_api/postal district requirement (B-3c)', () => {
		it('should reject civic_api without district', async () => {
			const event = makeRequestEvent({
				body: {
					verification_method: 'civic_api'
				}
			});

			const response = await POST(event);
			const data = await response.json();

			expect(response.status).toBe(400);
			expect(data.error).toContain('Invalid district format');
		});

		it('should reject postal without district', async () => {
			const event = makeRequestEvent({
				body: {
					verification_method: 'postal'
				}
			});

			const response = await POST(event);

			expect(response.status).toBe(400);
		});

		it('should accept civic_api with both district and optional commitment', async () => {
			const VALID_COMMITMENT = 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
			const event = makeRequestEvent({
				body: {
					district: 'CA-12',
					verification_method: 'civic_api',
					district_commitment: VALID_COMMITMENT
				}
			});

			const response = await POST(event);
			const data = await response.json();

			expect(response.status).toBe(200);
			expect(data.success).toBe(true);
			// Standard path returns credential, not just commitment
			expect(data.credential).toBeDefined();
			expect(data.credentialHash).toBeDefined();
		});

		it('should reject civic_api with invalid commitment format', async () => {
			const event = makeRequestEvent({
				body: {
					district: 'CA-12',
					verification_method: 'civic_api',
					district_commitment: 'not-valid-hex'
				}
			});

			const response = await POST(event);

			expect(response.status).toBe(400);
		});

		it('should still require verification_method', async () => {
			const VALID_COMMITMENT = 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
			const event = makeRequestEvent({
				body: {
					district_commitment: VALID_COMMITMENT
				}
			});

			const response = await POST(event);

			expect(response.status).toBe(400);
		});
	});

	// ============================================================================
	// UserDMRelation source tracking
	// ============================================================================

	describe('UserDMRelation source tracking (B-3c)', () => {
		it('should set source to verification_method on UserDMRelation upsert', async () => {
			const dmRelationUpsertCalls: any[] = [];

			mockDbTransaction.mockImplementation(async (fn: any) => {
				const tx = {
					districtCredential: { create: vi.fn().mockResolvedValue({}), updateMany: vi.fn().mockResolvedValue({}) },
					$executeRaw: vi.fn().mockResolvedValue(1),
					userDMRelation: {
						updateMany: vi.fn().mockResolvedValue({}),
						upsert: vi.fn().mockImplementation((args: any) => {
							dmRelationUpsertCalls.push(args);
							return {};
						})
					},
					externalId: {
						findUnique: vi.fn().mockResolvedValue(null),
						create: vi.fn().mockResolvedValue({})
					},
					decisionMaker: {
						create: vi.fn().mockResolvedValue({ id: 'dm-1' })
					},
					institution: {
						upsert: vi.fn().mockResolvedValue({ id: 'inst-mock' })
					}
				};
				return fn(tx);
			});

			const event = makeRequestEvent({
				body: {
					district: 'CA-12',
					verification_method: 'civic_api',
					officials: [
						{
							name: 'Rep Test',
							chamber: 'house',
							party: 'Democratic',
							state: 'CA',
							district: '12',
							bioguide_id: 'T000001'
						}
					]
				}
			});

			const response = await POST(event);
			expect(response.status).toBe(200);

			expect(dmRelationUpsertCalls).toHaveLength(1);
			expect(dmRelationUpsertCalls[0].create.source).toBe('civic_api');
			expect(dmRelationUpsertCalls[0].update.source).toBe('civic_api');
		});
	});
});
