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
 *
 * B-3c: shadow_atlas verification method allows commitment-only requests
 * (no plaintext district). The client computes a Poseidon2 commitment over
 * 24 district slots and sends that instead.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { serverQuery, serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';
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

/** Valid verification methods */
type VerificationMethod = 'civic_api' | 'postal' | 'shadow_atlas';

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
	district?: string;
	state_senate_district?: string;
	state_assembly_district?: string;
	verification_method: VerificationMethod;
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

	if (
		b.verification_method !== 'civic_api' &&
		b.verification_method !== 'postal' &&
		b.verification_method !== 'shadow_atlas'
	) {
		throw new Error('verification_method must be "civic_api", "postal", or "shadow_atlas"');
	}

	const verificationMethod = b.verification_method as VerificationMethod;

	// B-3c: Validate district + commitment based on verification method
	let district: string | undefined;
	let districtCommitment: string | undefined;
	let slotCount: number | undefined;

	if (verificationMethod === 'shadow_atlas') {
		// shadow_atlas: commitment is required, district is optional
		if (typeof b.district_commitment !== 'string' || !/^(0x)?[0-9a-fA-F]{64}$/.test(b.district_commitment)) {
			throw new Error('shadow_atlas verification requires a valid district_commitment');
		}
		districtCommitment = b.district_commitment;
		slotCount = typeof b.slot_count === 'number' && b.slot_count >= 1 && b.slot_count <= 24
			? b.slot_count
			: undefined;
		// district is optional for shadow_atlas — may be provided for display
		if (b.district && (typeof b.district !== 'string' || !DISTRICT_FORMAT.test(b.district))) {
			throw new Error('Invalid district format when provided. Expected "XX-NN" or "XX-AL".');
		}
		if (typeof b.district === 'string' && DISTRICT_FORMAT.test(b.district)) {
			district = b.district;
		}
	} else {
		// civic_api/postal: district is required
		if (typeof b.district !== 'string' || !DISTRICT_FORMAT.test(b.district)) {
			throw new Error(
				'Invalid district format. Expected "XX-NN" (e.g., "CA-12") or "XX-AL" for at-large districts.'
			);
		}
		district = b.district;

		// Optional commitment for civic_api/postal (B-2 transition period)
		if (typeof b.district_commitment === 'string') {
			if (!/^(0x)?[0-9a-fA-F]{64}$/.test(b.district_commitment)) {
				throw new Error('Invalid district_commitment format. Expected 64-char hex string.');
			}
			districtCommitment = b.district_commitment;
			slotCount = typeof b.slot_count === 'number' && b.slot_count >= 1 && b.slot_count <= 24
				? b.slot_count
				: undefined;
		}
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

	return {
		district,
		state_senate_district:
			typeof b.state_senate_district === 'string' ? b.state_senate_district : undefined,
		state_assembly_district:
			typeof b.state_assembly_district === 'string' ? b.state_assembly_district : undefined,
		verification_method: verificationMethod,
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
		const now = Date.now();
		const expiresAt = now + TIER_CREDENTIAL_TTL[2];
		const isCommitmentOnly = input.verification_method === 'shadow_atlas' && !!input.district_commitment;

		// Fetch user's did_key for the credential subject ID
		const userDidKey = await serverQuery(api.users.getDidKey, { userId: userId as any });

		// 3. Issue the VC — use district if available, null for commitment-only
		const credential = input.district
			? await issueDistrictCredential({
				userId,
				didKey: userDidKey?.didKey ?? null,
				congressional: input.district,
				stateSenate: input.state_senate_district,
				stateAssembly: input.state_assembly_district,
				verificationMethod: input.verification_method
			})
			: null;

		// 4. Compute integrity hash
		const credentialHash = credential ? await hashCredential(credential) : null;

		// 5. Compute privacy-preserving district hash — skip for commitment-only
		const districtHash = input.district ? await hashDistrict(input.district) : null;

		// 7. Convex mutation: revoke old credentials, create new one, update user, upsert DM relations
		await serverMutation(api.users.verifyAddress, {
			userId: userId as any,
			district: input.district,
			stateSenateDistrict: input.state_senate_district,
			stateAssemblyDistrict: input.state_assembly_district,
			verificationMethod: input.verification_method,
			credentialHash: credentialHash ?? undefined,
			districtHash: districtHash ?? undefined,
			districtCommitment: input.district_commitment,
			slotCount: input.slot_count,
			expiresAt,
			isCommitmentOnly,
			officials: (!isCommitmentOnly && input.officials && input.officials.length > 0)
				? input.officials.map((o) => ({
					name: o.name,
					chamber: o.chamber,
					party: o.party,
					state: o.state,
					district: o.district,
					bioguideId: o.bioguide_id,
					isVotingMember: o.is_voting_member,
					delegateType: o.delegate_type ?? undefined,
					phone: o.phone,
				}))
				: undefined,
		});

		// 8. Return credential to client
		if (credential && credentialHash) {
			return json({
				success: true,
				credential,
				credentialHash
			});
		}

		// Commitment-only response
		return json({
			success: true,
			commitment: input.district_commitment
		});
	} catch (err) {
		// Surface throttle / allowlist errors from verifyAddress mutation with
		// the right HTTP status so the UI can distinguish user-correctable
		// conditions from internal errors.
		const message = err instanceof Error ? err.message : '';
		if (message.includes('ADDRESS_VERIFICATION_THROTTLED_24H')) {
			return json(
				{ success: false, error: 'You re-verified recently. Please wait 24 hours between address changes.', code: 'THROTTLED_24H' },
				{ status: 429 }
			);
		}
		if (message.includes('ADDRESS_VERIFICATION_THROTTLED_180D')) {
			return json(
				{ success: false, error: 'Re-verification limit reached for this account. Contact support if you have moved.', code: 'THROTTLED_180D' },
				{ status: 429 }
			);
		}
		if (message.includes('ADDRESS_VERIFICATION_EMAIL_SYBIL')) {
			return json(
				{ success: false, error: 'This email is associated with multiple accounts. Contact support to consolidate before re-verifying.', code: 'EMAIL_SYBIL' },
				{ status: 429 }
			);
		}
		if (message.includes('INVALID_VERIFICATION_METHOD')) {
			return json(
				{ success: false, error: 'Invalid verification method.', code: 'INVALID_METHOD' },
				{ status: 400 }
			);
		}
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
