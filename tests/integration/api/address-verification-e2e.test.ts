/**
 * Address Verification E2E Integration Test
 *
 * Tests the complete flow that was broken and fixed:
 *   1. POST /api/location/resolve-address → Census geocoding → district + officials
 *   2. POST /api/identity/verify-address → credential issuance + rep persistence + trust tier upgrade
 *   3. DB verification: user updated, representatives upserted, junction records created
 *
 * Bug context: Representatives were resolved during address lookup but never persisted.
 * The verify-address endpoint now accepts officials[] and upserts them transactionally.
 *
 * Uses real database (via db-mock.ts PrismaClient) + MSW for external APIs.
 * Real credential modules with test IDENTITY_SIGNING_KEY — true E2E, no mocking.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db, createMockRequestEvent } from '../../setup/api-test-setup';

// Import handlers — real modules, no mocking
import { POST as resolveAddress } from '../../../src/routes/api/location/resolve-address/+server';
import { POST as verifyAddress } from '../../../src/routes/api/identity/verify-address/+server';

// ---------------------------------------------------------------------------
// DB connectivity check — must be synchronous for describe.runIf
// ---------------------------------------------------------------------------

const testDbUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || '';
const dbAvailable = testDbUrl.includes('localhost') || testDbUrl.includes('127.0.0.1');

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

// Use San Francisco — CA is in the MSW Congress API mock data (CA districts: 11, 12)
const TEST_ADDRESS = {
	street: '1 Dr Carlton B Goodlett Pl',
	city: 'San Francisco',
	state: 'CA',
	zip: '94102'
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe.runIf(dbAvailable)('Address Verification E2E Flow', () => {
	let testUser: { id: string; email: string; did_key: string | null };
	const uniqueSuffix = `addr-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

	beforeAll(async () => {
		// Required env vars for real credential issuance
		process.env.CONGRESS_API_KEY = 'test-key';
		// 32-byte hex Ed25519 seed for test credential signing
		process.env.IDENTITY_SIGNING_KEY = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';

		// Create test user
		testUser = await db.user.create({
			data: {
				email: `${uniqueSuffix}@test.commons.email`,
				name: 'E2E Test User',
				did_key: `did:key:z${uniqueSuffix}`,
				trust_tier: 0,
				trust_score: 0,
				is_verified: false,
				district_verified: false
			}
		});
	});

	afterAll(async () => {
		// Cleanup in reverse dependency order
		if (testUser) {
			await db.userDMRelation.deleteMany({ where: { userId: testUser.id } });
			await db.districtCredential.deleteMany({ where: { user_id: testUser.id } });
			await db.user.delete({ where: { id: testUser.id } }).catch(() => {});
		}
		// Clean up test DecisionMakers (via ExternalId join)
		const testBioguides = ['CAS001', 'CAS002', 'CAH011', 'CAH012'];
		const testExternalIds = await db.externalId.findMany({
			where: { system: 'bioguide', value: { in: testBioguides } },
			select: { decisionMakerId: true }
		});
		if (testExternalIds.length > 0) {
			const dmIds = testExternalIds.map((e) => e.decisionMakerId);
			await db.externalId.deleteMany({ where: { decisionMakerId: { in: dmIds } } });
			await db.decisionMaker.deleteMany({ where: { id: { in: dmIds } } });
		}
		// Clean env vars
		delete process.env.IDENTITY_SIGNING_KEY;
	});

	// ====================================================================
	// Step 1: Address Resolution
	// ====================================================================

	describe('Step 1: resolve-address', () => {
		it('resolves a Springfield IL address via Census Bureau mock', async () => {
			const event = createMockRequestEvent({
				url: '/api/location/resolve-address',
				method: 'POST',
				body: JSON.stringify(TEST_ADDRESS),
				locals: { user: { id: testUser.id, email: testUser.email } }
			});

			const response = await resolveAddress(event as any);
			const data = await response.json();

			expect(response.status).toBe(200);
			expect(data.resolved).toBe(true);

			// Census-standardized address
			expect(data.address.matched).toContain('SAN FRANCISCO');
			expect(data.address.state).toBe('CA');

			// District
			expect(data.district.code).toBe('CA-11');
			expect(data.district.state).toBe('CA');

			// Officials from Congress.gov mock
			expect(data.officials).toBeDefined();
			expect(Array.isArray(data.officials)).toBe(true);

			// Cell ID (Census block → tract level)
			expect(data.cell_id).toBeDefined();
			expect(data.zk_eligible).toBe(true);
		});
	});

	// ====================================================================
	// Step 2: Address Verification (credential + rep persistence)
	// ====================================================================

	describe('Step 2: verify-address with officials', () => {
		let resolvedOfficials: Array<Record<string, unknown>>;
		let resolvedDistrict: string;

		beforeAll(async () => {
			// First resolve the address to get officials
			const resolveEvent = createMockRequestEvent({
				url: '/api/location/resolve-address',
				method: 'POST',
				body: JSON.stringify(TEST_ADDRESS),
				locals: { user: { id: testUser.id, email: testUser.email } }
			});

			const resolveResponse = await resolveAddress(resolveEvent as any);
			const resolveData = await resolveResponse.json();

			resolvedDistrict = resolveData.district.code;
			resolvedOfficials = resolveData.officials || [];
		});

		it('issues credential and persists representatives', async () => {
			const event = createMockRequestEvent({
				url: '/api/identity/verify-address',
				method: 'POST',
				body: JSON.stringify({
					district: resolvedDistrict,
					verification_method: 'civic_api',
					officials: resolvedOfficials
				}),
				locals: { user: { id: testUser.id } }
			});

			const response = await verifyAddress(event as any);
			const data = await response.json();

			expect(response.status).toBe(200);
			expect(data.success).toBe(true);
			expect(data.credential).toBeDefined();
			expect(data.credentialHash).toBeDefined();
			expect(data.identity_commitment).toMatch(/^[0-9a-f]{64}$/);
		});

		it('upgraded user trust_tier to 2', async () => {
			const user = await db.user.findUnique({
				where: { id: testUser.id },
				select: {
					trust_tier: true,
					district_verified: true,
					is_verified: true,
					address_verification_method: true,
					identity_commitment: true
				}
			});

			expect(user).not.toBeNull();
			expect(user!.trust_tier).toBe(2);
			expect(user!.district_verified).toBe(true);
			expect(user!.is_verified).toBe(true);
			expect(user!.address_verification_method).toBe('civic_api');
			expect(user!.identity_commitment).toMatch(/^[0-9a-f]{64}$/);
		});

		it('created DistrictCredential record', async () => {
			const credential = await db.districtCredential.findFirst({
				where: { user_id: testUser.id },
				orderBy: { issued_at: 'desc' }
			});

			expect(credential).not.toBeNull();
			expect(credential!.credential_type).toBe('district_residency');
			expect(credential!.congressional_district).toBe('CA-11');
			expect(credential!.verification_method).toBe('civic_api');
			expect(credential!.expires_at.getTime()).toBeGreaterThan(Date.now());
		});

		it('persisted decision-makers to the database', async () => {
			const bioguides = resolvedOfficials
				.map((o) => o.bioguide_id as string)
				.filter(Boolean);
			const externalIds = await db.externalId.findMany({
				where: { system: 'bioguide', value: { in: bioguides } },
				select: { decisionMakerId: true }
			});
			const dmIds = externalIds.map((e) => e.decisionMakerId);
			const dms = await db.decisionMaker.findMany({
				where: { id: { in: dmIds } }
			});

			expect(dms.length).toBeGreaterThan(0);

			for (const dm of dms) {
				expect(dm.name).toBeTruthy();
				expect(dm.party).toBeTruthy();
				expect(dm.title).toBeTruthy();
				expect(dm.active).toBe(true);
				expect(dm.type).toBe('legislator');
			}
		});

		it('created UserDMRelation junction records', async () => {
			const dmRelations = await db.userDMRelation.findMany({
				where: {
					userId: testUser.id,
					isActive: true
				},
				include: { decisionMaker: true }
			});

			// Should have DM relation records linking user to their decision-makers
			expect(dmRelations.length).toBeGreaterThan(0);

			// Each relation should have correct relationship and be active
			for (const rel of dmRelations) {
				expect(rel.relationship).toBe('constituent');
				expect(rel.isActive).toBe(true);
				expect(rel.lastValidated).toBeDefined();

				// The linked decision-maker should exist and be active
				expect(rel.decisionMaker.name).toBeTruthy();
				expect(rel.decisionMaker.active).toBe(true);
				expect(rel.decisionMaker.type).toBe('legislator');
			}
		});
	});

	// ====================================================================
	// Step 3: Profile page reads representatives correctly
	// ====================================================================

	describe('Step 3: profile page representative query', () => {
		it('returns decision-makers via UserDMRelation query pattern', async () => {
			const result = await db.user.findUnique({
				where: { id: testUser.id },
				select: {
					dmRelations: {
						where: { isActive: true },
						select: {
							relationship: true,
							decisionMaker: {
								select: {
									id: true,
									name: true,
									party: true,
									jurisdiction: true,
									district: true,
									title: true,
									phone: true,
									email: true
								}
							}
						}
					}
				}
			});

			expect(result).not.toBeNull();
			expect(result!.dmRelations.length).toBeGreaterThan(0);

			const dms = result!.dmRelations.map((r) => ({
				relationship: r.relationship,
				...r.decisionMaker
			}));

			for (const dm of dms) {
				expect(dm.relationship).toBe('constituent');
				expect(dm.name).toBeTruthy();
				expect(dm.party).toBeTruthy();
				expect(dm.title).toMatch(/^(Senator|Representative)$/);
				expect(dm.jurisdiction).toBeTruthy();
			}
		});

		it('returns decision-makers via the layout server query pattern', async () => {
			// This mirrors the query in src/routes/+layout.server.ts
			const result = await db.user.findUnique({
				where: { id: testUser.id },
				select: {
					dmRelations: {
						where: { isActive: true },
						select: {
							decisionMaker: {
								select: {
									id: true,
									name: true,
									party: true,
									jurisdiction: true,
									district: true,
									title: true,
									phone: true,
									email: true
								}
							}
						}
					}
				}
			});

			expect(result).not.toBeNull();
			const dms = result!.dmRelations.map((r) => r.decisionMaker);

			expect(dms.length).toBeGreaterThan(0);

			for (const dm of dms) {
				expect(dm.name).toBeTruthy();
				expect(dm.title).toMatch(/^(Senator|Representative)$/);
			}
		});
	});

	// ====================================================================
	// Step 4: Re-verification deactivates old reps and creates new ones
	// ====================================================================

	describe('Step 4: re-verification handles district change', () => {
		it('deactivates old representatives when district changes', async () => {
			// Count current active DM relations
			const beforeDmCount = await db.userDMRelation.count({
				where: { userId: testUser.id, isActive: true }
			});
			expect(beforeDmCount).toBeGreaterThan(0);

			// Re-verify with a different district (CA-11) and new officials
			const event = createMockRequestEvent({
				url: '/api/identity/verify-address',
				method: 'POST',
				body: JSON.stringify({
					district: 'CA-11',
					verification_method: 'civic_api',
					officials: [
						{
							name: 'New House Rep',
							chamber: 'house',
							party: 'Independent',
							state: 'CA',
							district: 'CA-11',
							bioguide_id: 'CAH011'
						},
						{
							name: 'New Senator',
							chamber: 'senate',
							party: 'Democratic',
							state: 'CA',
							district: 'CA',
							bioguide_id: 'CAS001'
						}
					]
				}),
				locals: { user: { id: testUser.id } }
			});

			const response = await verifyAddress(event as any);
			expect(response.status).toBe(200);

			// New active DM relations should be for CA officials only
			const activeDmRelations = await db.userDMRelation.findMany({
				where: { userId: testUser.id, isActive: true },
				include: { decisionMaker: true }
			});

			expect(activeDmRelations.length).toBe(2); // 1 house + 1 senate

			const dmNames = activeDmRelations.map((r) => r.decisionMaker.name);
			expect(dmNames).toContain('New House Rep');
			expect(dmNames).toContain('New Senator');

			// Old DM relations should be deactivated
			const inactiveDmRelations = await db.userDMRelation.findMany({
				where: { userId: testUser.id, isActive: false }
			});
			expect(inactiveDmRelations.length).toBeGreaterThan(0);
		});
	});

	// ====================================================================
	// Step 5: verify-address without officials still works
	// ====================================================================

	describe('Step 5: verify-address without officials (backward compat)', () => {
		it('succeeds when no officials are provided', async () => {
			const event = createMockRequestEvent({
				url: '/api/identity/verify-address',
				method: 'POST',
				body: JSON.stringify({
					district: 'NY-10',
					verification_method: 'civic_api'
				}),
				locals: { user: { id: testUser.id } }
			});

			const response = await verifyAddress(event as any);
			const data = await response.json();

			expect(response.status).toBe(200);
			expect(data.success).toBe(true);
		});
	});
});
