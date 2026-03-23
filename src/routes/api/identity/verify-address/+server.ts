/**
 * Tier 2 Credential Issuance Endpoint
 *
 * Receives the district result (from a prior /api/location/resolve call)
 * and issues a W3C VC 2.0 DistrictResidencyCredential.
 *
 * Flow:
 *  1. Validate authenticated user
 *  2. Validate input (district format "XX-NN" or "XX-AL")
 *  3. Issue DistrictResidencyCredential
 *  4. Compute credential hash
 *  5. Store DistrictCredential record in DB
 *  6. Update User record (trust_tier, district_verified, etc.) in a transaction
 *  7. Return credential JSON to client (for IndexedDB storage)
 *
 * Privacy: The plaintext address never reaches this endpoint. Only the geocoded
 * district identifier is received and stored as a SHA-256 hash on the User record.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/core/db';
import {
	issueDistrictCredential,
	hashCredential,
	hashDistrict
} from '$lib/core/identity/district-credential';
import { TIER_CREDENTIAL_TTL } from '$lib/core/identity/credential-policy';

// ============================================================================
// Input Validation
// ============================================================================

/** Matches "XX-NN" (state abbreviation + district number) or "XX-AL" (at-large). */
const DISTRICT_FORMAT = /^[A-Z]{2}-(\d{2}|AL)$/;

/** Bioguide IDs are a single uppercase letter followed by 6 digits (e.g., "B001297"). */
const BIOGUIDE_FORMAT = /^[A-Z]\d{6}$/;

/** Maximum officials per request — no district has more than 3 reps. */
const MAX_OFFICIALS = 10;

interface OfficialInput {
	name: string;
	chamber: 'house' | 'senate';
	party: string;
	state: string;
	district: string;
	bioguide_id: string;
	is_voting_member?: boolean;
	delegate_type?: string | null;
	phone?: string;
	office_code?: string;
	office?: string;
}

interface VerifyAddressInput {
	district: string;
	state_senate_district?: string;
	state_assembly_district?: string;
	verification_method: 'civic_api' | 'postal';
	officials?: OfficialInput[];
	// B-2: Client-computed district commitment (replaces plaintext after transition)
	district_commitment?: string; // Poseidon2_sponge_24(districts[0..24]) hex string
	slot_count?: number;          // How many of 24 district slots are non-zero
}

function validateInput(body: unknown): VerifyAddressInput {
	if (!body || typeof body !== 'object') {
		throw new Error('Request body must be a JSON object');
	}

	const b = body as Record<string, unknown>;

	if (typeof b.district !== 'string' || !DISTRICT_FORMAT.test(b.district)) {
		throw new Error(
			'Invalid district format. Expected "XX-NN" (e.g., "CA-12") or "XX-AL" for at-large districts.'
		);
	}

	if (
		b.verification_method !== 'civic_api' &&
		b.verification_method !== 'postal'
	) {
		throw new Error('verification_method must be "civic_api" or "postal"');
	}

	// Validate officials array if present
	let officials: OfficialInput[] | undefined;
	if (Array.isArray(b.officials)) {
		officials = (b.officials as Record<string, unknown>[])
			.filter((o) => {
				if (typeof o.name !== 'string' || typeof o.party !== 'string') return false;

				// Validate bioguide_id format
				if (typeof o.bioguide_id !== 'string' || !BIOGUIDE_FORMAT.test(o.bioguide_id)) {
					console.warn(`[verify-address] Skipping official with invalid bioguide_id: ${String(o.bioguide_id)}`);
					return false;
				}

				// Validate chamber value
				if (o.chamber !== 'house' && o.chamber !== 'senate') {
					console.warn(`[verify-address] Skipping official "${o.name}" with invalid chamber: ${String(o.chamber)}`);
					return false;
				}

				// Validate state: must be 2-letter uppercase abbreviation
				if (!/^[A-Z]{2}$/.test(o.state as string)) return false;
				// Validate district for House members (1-2 digits)
				if (o.chamber === 'house' && !/^\d{1,2}$/.test((o.district as string) || '')) return false;

				return true;
			})
			.slice(0, MAX_OFFICIALS)
			.map((o) => ({
				name: o.name as string,
				chamber: o.chamber as 'house' | 'senate',
				party: o.party as string,
				state: (o.state as string) || '',
				district: (o.district as string) || '',
				bioguide_id: o.bioguide_id as string,
				is_voting_member: typeof o.is_voting_member === 'boolean' ? o.is_voting_member : true,
				delegate_type: typeof o.delegate_type === 'string' ? o.delegate_type : null,
				phone: typeof o.phone === 'string' ? o.phone : undefined,
				office_code: typeof o.office_code === 'string' ? o.office_code : undefined,
				office: typeof o.office === 'string' ? o.office : undefined
			}));
	}

	// B-2: Validate optional client-computed district commitment
	let districtCommitment: string | undefined;
	let slotCount: number | undefined;
	if (typeof b.district_commitment === 'string') {
		// Must be a valid hex string (64 chars = 32 bytes Poseidon2 output)
		if (!/^(0x)?[0-9a-fA-F]{64}$/.test(b.district_commitment)) {
			throw new Error('Invalid district_commitment format. Expected 64-char hex string.');
		}
		districtCommitment = b.district_commitment;
		slotCount = typeof b.slot_count === 'number' && b.slot_count >= 1 && b.slot_count <= 24
			? b.slot_count
			: undefined;
	}

	return {
		district: b.district as string,
		state_senate_district:
			typeof b.state_senate_district === 'string' ? b.state_senate_district : undefined,
		state_assembly_district:
			typeof b.state_assembly_district === 'string' ? b.state_assembly_district : undefined,
		verification_method: b.verification_method as 'civic_api' | 'postal',
		officials,
		district_commitment: districtCommitment,
		slot_count: slotCount
	};
}

// ============================================================================
// Handler
// ============================================================================

export const POST: RequestHandler = async ({ request, locals }) => {
	// 1. Require authenticated session
	if (!locals.user) {
		return json({ success: false, error: 'Authentication required' }, { status: 401 });
	}

	const userId = locals.user.id;

	// 2. Parse & validate input
	let input: VerifyAddressInput;
	try {
		const body = await request.json();
		input = validateInput(body);
	} catch (err) {
		return json(
			{ success: false, error: err instanceof Error ? err.message : 'Invalid request body' },
			{ status: 400 }
		);
	}

	try {
		// Fetch user's did_key for the credential subject ID
		const user = await db.user.findUniqueOrThrow({
			where: { id: userId },
			select: { did_key: true }
		});

		// 3. Issue the VC
		const credential = await issueDistrictCredential({
			userId,
			didKey: user.did_key,
			congressional: input.district,
			stateSenate: input.state_senate_district,
			stateAssembly: input.state_assembly_district,
			verificationMethod: input.verification_method
		});

		// 4. Compute integrity hash
		const credentialHash = await hashCredential(credential);

		// 5. Compute privacy-preserving district hash (HMAC with server key)
		const districtHash = await hashDistrict(input.district);

		// 6. Compute TTL-based expiration
		const now = new Date();
		const expiresAt = new Date(now.getTime() + TIER_CREDENTIAL_TTL[2]);

		// 7. Database transaction: insert DistrictCredential + update User + upsert representatives
		await db.$transaction(async (tx) => {
			// Revoke existing unexpired credentials before issuing new one
			await tx.districtCredential.updateMany({
				where: { user_id: userId, revoked_at: null },
				data: { revoked_at: now }
			});

			// Insert credential record
			await tx.districtCredential.create({
				data: {
					user_id: userId,
					credential_type: 'district_residency',
					congressional_district: input.district,
					state_senate_district: input.state_senate_district ?? null,
					state_assembly_district: input.state_assembly_district ?? null,
					verification_method: input.verification_method,
					issued_at: now,
					expires_at: expiresAt,
					credential_hash: credentialHash,
					// B-2: Store client-computed commitment alongside plaintext (transition period)
					district_commitment: input.district_commitment ?? null,
					slot_count: input.slot_count ?? null
				}
			});

			// Atomic user update: GREATEST prevents trust_tier downgrade without TOCTOU race
			await tx.$executeRaw`
				UPDATE "user"
				SET trust_tier = GREATEST(trust_tier, 2),
				    district_verified = true,
				    address_verified_at = ${now},
				    address_verification_method = ${input.verification_method},
				    district_hash = ${districtHash},
				    verified_at = ${now},
				    verification_method = ${input.verification_method},
				    is_verified = true
				WHERE id = ${userId}
			`;

			// Upsert representatives and create junction records
			if (input.officials && input.officials.length > 0) {
				// Deactivate existing UserDMRelation rows (district may have changed)
				await tx.userDMRelation.updateMany({
					where: { userId },
					data: { isActive: false }
				});
				// Ensure Institution rows exist for chamber lookup
				const [house, senate] = await Promise.all([
					tx.institution.upsert({
						where: { type_name_jurisdiction: { type: 'legislature', name: 'U.S. House of Representatives', jurisdiction: 'US' } },
						create: { type: 'legislature', name: 'U.S. House of Representatives', jurisdiction: 'US', jurisdictionLevel: 'federal' },
						update: {}
					}),
					tx.institution.upsert({
						where: { type_name_jurisdiction: { type: 'legislature', name: 'U.S. Senate', jurisdiction: 'US' } },
						create: { type: 'legislature', name: 'U.S. Senate', jurisdiction: 'US', jurisdictionLevel: 'federal' },
						update: {}
					})
				]);

				for (const official of input.officials) {
					const chamber = official.chamber;
					const title = chamber === 'senate' ? 'Senator' : 'Representative';
					const institutionId = chamber === 'house' ? house.id : senate.id;
					const nameParts = official.name.split(' ');
					const lastName = nameParts.pop() || official.name;
					const firstName = nameParts.join(' ') || null;

					// Look up existing DecisionMaker via ExternalId (bioguide)
					const existing = await tx.externalId.findUnique({
						where: { system_value: { system: 'bioguide', value: official.bioguide_id } },
						select: { decisionMakerId: true }
					});

					let dmId: string;
					if (existing) {
						// Trust server-side ingestion (congress-gov sync) for DM data — do NOT update from client
						dmId = existing.decisionMakerId;
					} else {
						// Create new DecisionMaker + ExternalId
						const dm = await tx.decisionMaker.create({
							data: {
								type: 'legislator',
								name: official.name,
								firstName,
								lastName,
								party: official.party,
								jurisdiction: official.state,
								jurisdictionLevel: 'federal',
								district: official.district,
								title,
								institutionId,
								phone: official.phone,
								active: true,
								lastSyncedAt: now
							},
							select: { id: true }
						});
						await tx.externalId.create({
							data: {
								decisionMakerId: dm.id,
								system: 'bioguide',
								value: official.bioguide_id
							}
						});
						dmId = dm.id;
					}

					// Upsert UserDMRelation
					await tx.userDMRelation.upsert({
						where: {
							userId_decisionMakerId: {
								userId,
								decisionMakerId: dmId
							}
						},
						create: {
							userId,
							decisionMakerId: dmId,
							relationship: 'constituent',
							isActive: true,
							lastValidated: now
						},
						update: {
							isActive: true,
							lastValidated: now
						}
					});

				}
			}
		});

		// 8. Return credential to client
		return json({
			success: true,
			credential,
			credentialHash
		});
	} catch (err) {
		console.error('[verify-address] Credential issuance failed:', err);
		return json(
			{
				success: false,
				error: 'Failed to issue district credential. Please try again.'
			},
			{ status: 500 }
		);
	}
};
