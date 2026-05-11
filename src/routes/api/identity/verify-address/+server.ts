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
 * Privacy: this endpoint receives derived district/cell metadata, not a raw
 * address form payload. Address resolution and government delivery have their
 * own plaintext boundaries; persistent custody is the encrypted ground vault.
 *
 * B-3c: shadow_atlas verification method allows commitment-only requests
 * (no plaintext district). The client computes a Poseidon2 commitment over
 * 24 district slots and sends that instead.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	isGroundServiceError,
	issueGroundCredential,
	verifyGroundCommitmentAuthenticity
} from '$lib/server/ground/ground-service';
import { verifyAddressResolutionToken } from '$lib/server/auth/address-resolution-token';

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
	// FU-1.1: coordinates required when district_commitment is provided.
	// Server fetches the same IPFS cell data and recomputes the expected
	// commitment; mismatch is rejected as COMMITMENT_AUTHENTICITY_MISMATCH.
	coordinates?: { lat: number; lng: number };
	// F-2.4: server-issued HMAC token from a prior /api/location/resolve-address
	// call, binding (userId, lat, lng, addressHash, expiresAt). When the client
	// supplies coordinates, it MUST also supply the token + addressHash so the
	// server can verify the coordinates were produced by the geocoder for the
	// claimed address (and not substituted by a malicious client).
	address_token?: string;
	address_hash?: string;
	cell_id?: string;
	h3_cell?: string;
	cell_map_root?: string;
	cell_map_version?: string;
	atlas_root?: string;
	atlas_version?: string;
	// H1 — trust-context fields the client may carry from session-credentials.
	// cell_straddles  : G2 boundary-cell mark.
	// cell_anchor_mode: G8 audit-trail mode (one of CELL_ANCHOR_MODES; server
	//                   re-validates against the canonical list at the Convex
	//                   handler — duplicate validation here would drift).
	cell_straddles?: boolean;
	cell_anchor_mode?: string;
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

	// FU-1.1 — coordinates required when commitment is provided (server uses
	// them to recompute the expected commitment from IPFS cell data).
	let coordinates: { lat: number; lng: number } | undefined;
	const rawCoords = b.coordinates;
	if (rawCoords && typeof rawCoords === 'object') {
		const c = rawCoords as Record<string, unknown>;
		if (
			typeof c.lat === 'number' &&
			typeof c.lng === 'number' &&
			Number.isFinite(c.lat) &&
			Number.isFinite(c.lng) &&
			Math.abs(c.lat) <= 90 &&
			Math.abs(c.lng) <= 180
		) {
			coordinates = { lat: c.lat, lng: c.lng };
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

	// Each remaining string field gets a realistic boundary cap so a hostile
	// client can't waste downstream storage with megabyte values before
	// Convex arg validation. Caps mirror atlas_version=64.
	//
	// Both type-mismatch AND over-cap surface as 400 (not silently dropped):
	// these fields have known sizes (h3 16-char, BN254 hex 64-char, etc.), so
	// any deviation is malformed input. Silently dropping would mask attack
	// fuzzing telemetry and cause downstream code to operate on undefined
	// instead of rejecting the payload.
	const checkCap = (value: unknown, maxLen: number, fieldName: string): string | undefined => {
		if (value === undefined || value === null) return undefined;
		if (typeof value !== 'string') {
			throw new Error(`${fieldName} must be a string`);
		}
		if (value.length > maxLen) {
			throw new Error(`${fieldName} must be ${maxLen} characters or fewer`);
		}
		return value;
	};

	return {
		district,
		state_senate_district: checkCap(b.state_senate_district, 64, 'state_senate_district'),
		state_assembly_district: checkCap(b.state_assembly_district, 64, 'state_assembly_district'),
		verification_method: verificationMethod,
		officials,
		district_commitment: districtCommitment,
		slot_count: slotCount,
		coordinates,
		// F-2.4 token + address hash. Token is `v1.<expiresAt>.<hex>`; cap at 256
		// to keep malformed inputs from chewing memory. Address hash is SHA-256
		// hex (64 chars). Cap is 80 to allow leading-zero / 0x-prefix variants.
		address_token: checkCap(b.address_token, 256, 'address_token'),
		address_hash: checkCap(b.address_hash, 80, 'address_hash'),
		// h3 indices are 16-char hex; cell ids are similar size. 64 = generous slack.
		cell_id: checkCap(b.cell_id, 64, 'cell_id'),
		h3_cell: checkCap(b.h3_cell, 64, 'h3_cell'),
		// Roots are 64-char Poseidon2 hex (BN254). 80 = slack for 0x prefix + edge formats.
		cell_map_root: checkCap(b.cell_map_root, 80, 'cell_map_root'),
		cell_map_version: checkCap(b.cell_map_version, 64, 'cell_map_version'),
		atlas_root: checkCap(b.atlas_root, 80, 'atlas_root'),
		// H1r F5: atlas_version is a short publisher-controlled label (today
		// "v20260503"-ish). Cap at 64 chars at the boundary so a hostile client
		// can't waste storage with megabyte version strings before the Convex
		// args validator sees them.
		atlas_version:
			typeof b.atlas_version === 'string' && b.atlas_version.length <= 64
				? b.atlas_version
				: undefined,
		// H1 — trust-context pass-through. cell_anchor_mode allowlist is enforced
		// at the Convex handler (single source of truth); here we only require
		// the right primitive shape so we don't leak garbage further.
		cell_straddles: typeof b.cell_straddles === 'boolean' ? b.cell_straddles : undefined,
		cell_anchor_mode:
			typeof b.cell_anchor_mode === 'string' && b.cell_anchor_mode.length <= 64
				? b.cell_anchor_mode
				: undefined
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

	// F-2.4 — coordinate authenticity. Whenever the client supplies
	// coordinates, the request MUST carry a matching server-issued
	// HMAC token: `addr` mode if `address_hash` is also supplied (manual
	// address path), `geo` mode otherwise (browser geolocation path).
	// Without this, a malicious client could substitute coordinates between
	// the resolve step and verify-address to poison Tier 2 storage. The
	// gate fires on `input.coordinates` alone — dropping `address_hash`
	// does not downgrade the request to an un-gated state because the
	// server demands a token in either case.
	if (input.coordinates) {
		if (!input.address_token) {
			return json(
				{
					success: false,
					error:
						'address_token is required when coordinates are supplied. Re-run /api/location/resolve or /api/location/resolve-address to obtain a fresh binding.',
					code: 'ADDRESS_TOKEN_MISSING'
				},
				{ status: 400 }
			);
		}
		const tokenCheck = await verifyAddressResolutionToken({
			token: input.address_token,
			userId,
			lat: input.coordinates.lat,
			lng: input.coordinates.lng,
			addressHash: input.address_hash ?? null
		});
		if (!tokenCheck.valid) {
			return json(
				{
					success: false,
					error:
						tokenCheck.reason === 'expired'
							? 'Address resolution expired. Re-run address lookup.'
							: 'Address binding could not be verified. Re-run address lookup.',
					code:
						tokenCheck.reason === 'expired' ? 'ADDRESS_TOKEN_EXPIRED' : 'ADDRESS_TOKEN_INVALID'
				},
				{ status: 400 }
			);
		}
	}

	// FU-1.1 — issuance-time commitment authenticity. When the client
	// supplies a `district_commitment`, the server recomputes the expected
	// commitment from IPFS cell data at the user's coordinates and rejects
	// on mismatch. Closes the dummy-hex bypass of the downgrade guard.
	//
	// Coordinates are required when commitment is supplied. Server doesn't
	// learn anything new — `/api/location/resolve-address` already gave it
	// the lat/lng during geocoding; the client just echoes them back.
	if (input.district_commitment) {
		try {
			await verifyGroundCommitmentAuthenticity(userId, input);
		} catch (err) {
			if (isGroundServiceError(err)) {
				return json({ success: false, error: err.message, code: err.code }, { status: err.status });
			}
			console.error('[verify-address] commitment verification failed:', err);
			return json(
				{
					success: false,
					error: 'Failed to verify district commitment. Please retry.'
				},
				{ status: 500 }
			);
		}
	}

	try {
		return json(await issueGroundCredential(userId, input));
	} catch (err) {
		if (isGroundServiceError(err)) {
			return json({ success: false, error: err.message, code: err.code }, { status: err.status });
		}
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
		if (message.includes('ADDRESS_VERIFICATION_COMMITMENT_DOWNGRADE')) {
			// Client submitted a verify request without districtCommitment while
			// the user's history contains at least one commitment-bearing row.
			// Client-side Poseidon2 sponge likely failed silently — surface so
			// the UI can retry commitment generation rather than downgrade.
			return json(
				{
					success: false,
					error:
						'Address commitment could not be computed. Please try again; if the problem persists, check your connection and retry.',
					code: 'COMMITMENT_DOWNGRADE'
				},
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
