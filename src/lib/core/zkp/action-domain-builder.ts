/**
 * Action Domain Builder - Deterministic action domain computation
 *
 * Constructs action domains for ZK proof nullifier binding. The action domain
 * uniquely identifies a (protocol, country, jurisdictionType, recipientSubdivision,
 * templateId, legislativeSessionId, district_commitment) tuple so that each user
 * can only submit one proof per action domain, and a user cannot produce a new
 * nullifier scope by re-verifying to a different district (F2 closure).
 *
 * HASHING SCHEME (v2 — post Stage 2 re-grounding):
 * keccak256(abi.encodePacked(
 *   protocol,
 *   country,
 *   jurisdictionType,
 *   recipientSubdivision,
 *   templateId,
 *   sessionId,
 *   district_commitment        // <-- added in commons.v2
 * )) → reduced mod BN254_MODULUS for circuit compatibility
 *
 * WHY KECCAK256 (not Poseidon2):
 * Action domains are managed on-chain via DistrictGate.allowedActionDomains mapping.
 * Governance admins whitelist domains using Solidity tooling (keccak256 is native).
 * Poseidon2 is used circuit-internal; keccak256 is the EVM-standard for domain hashing.
 *
 * WHY RECIPIENT SUBDIVISION:
 * Without recipient granularity, a single nullifier covers an entire jurisdiction type.
 * A user proving for "US + federal" could only message ONE federal representative total.
 * With recipientSubdivision, they can message their senator (US-CA) AND representative
 * (US-CA-12) independently — correct civics, correct cryptography.
 *
 * WHY DISTRICT_COMMITMENT (F2 closure):
 * Pre-v2, `recipientSubdivision` ("US-CA-12") was a client-chosen string, NOT
 * cryptographically linked to the credential's witnessed districts. A user could
 * re-verify their address, get a new credential with a NEW 24-slot district
 * commitment, and generate a FRESH nullifier for the SAME (template, session,
 * subdivision) tuple by claiming a different subdivision string — because the
 * domain depended on the string, not the commitment. This is F2 district-hopping
 * amplification.
 *
 * Binding `district_commitment` into the domain preimage means the nullifier scope
 * is cryptographically tied to the credential's witnessed districts. Two credentials
 * with different district_commitments produce different nullifier scopes even for
 * the same (template, session, subdivision), so re-verification does not mint
 * new nullifier scope. Stale-credential replay is additionally closed by an
 * on-chain revocation nullifier set (see REVOCATION-NULLIFIER-SPEC.md).
 *
 * SECURITY INVARIANTS:
 * 1. Output is always a valid BN254 field element (< modulus)
 * 2. Deterministic: same params always produce the same domain
 * 3. Collision-resistant: keccak256 preimage resistance
 * 4. Protocol-versioned: schema changes require version bump (see PROTOCOL_VERSION)
 * 5. District-bound: nullifier scope is cryptographically linked to
 *    district_commitment (F2 closure — see voter-protocol/specs/CRYPTOGRAPHY-SPEC.md §6.4)
 *
 * @see voter-protocol/specs/CRYPTOGRAPHY-SPEC.md §6.4 Action Domain
 * @see voter-protocol/specs/REVOCATION-NULLIFIER-SPEC.md
 * @see voter-protocol/specs/CIRCUIT-REVISION-MIGRATION.md
 * @see DistrictGate.sol § allowedActionDomains mapping
 */

import { solidityPackedKeccak256 } from 'ethers';
import { BN254_MODULUS } from '$lib/core/crypto/bn254';

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Protocol version string bound into the action domain preimage.
 *
 * v1 → v2 transition (Stage 2 re-grounding, 2026-04): added `district_commitment`
 * as a required preimage component. v1 action domains cannot collide with v2 even
 * for identical (country, jurisdictionType, recipientSubdivision, templateId,
 * sessionId) because the version tag itself differs.
 *
 * All v1 action domains must be revoked or migrated per
 * voter-protocol/specs/CIRCUIT-REVISION-MIGRATION.md before v2 deployment.
 */
const PROTOCOL_VERSION = 'commons.v2';

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Jurisdiction types supported by the action domain schema.
 *
 * - federal: National legislature (US Congress, UK Parliament)
 * - state: Subnational legislature (US state legislature, German Landtag)
 * - local: Municipal/county government (city council, county board)
 * - international: International bodies (EU Parliament, UN committees)
 */
export type JurisdictionType = 'federal' | 'state' | 'local' | 'international';

/**
 * Parameters for constructing an action domain.
 *
 * Each unique combination of these fields produces a distinct action domain,
 * which in turn produces a distinct nullifier per user. This means a user
 * can submit proofs for multiple templates, sessions, and recipients
 * without nullifier collisions.
 */
export interface ActionDomainParams {
	/** ISO 3166-1 alpha-2 country code (e.g., "US", "GB", "DE") */
	country: string;

	/** Type of jurisdiction being addressed */
	jurisdictionType: JurisdictionType;

	/**
	 * Recipient subdivision for nullifier granularity.
	 * - Federal/national scope: "national"
	 * - State scope: ISO 3166-2 code (e.g., "US-CA", "DE-BY")
	 * - Local scope: "{state}-{locality}" (e.g., "US-CA-san-francisco")
	 * - International: organization code (e.g., "EU", "UN")
	 */
	recipientSubdivision: string;

	/** Template identifier from the template registry */
	templateId: string;

	/**
	 * Legislative session identifier (e.g., "119th-congress").
	 *
	 * Scopes nullifier uniqueness to a legislative period — a user's proof for
	 * the 119th Congress produces a distinct nullifier from the same action
	 * in the 120th.  NOT a user-created "campaign" ID; those live in the
	 * `templateId` field.
	 */
	sessionId: string;

	/**
	 * Hex-encoded BN254 field element representing the credential's 24-slot
	 * district commitment: `district_commitment = sponge(districts[0..24])`
	 * with DOMAIN_SPONGE_24 (see voter-protocol/specs/CRYPTOGRAPHY-SPEC.md §2.4).
	 *
	 * Binding this into the action domain preimage prevents F2 district-hopping
	 * amplification. Must be `0x`-prefixed 64-hex-char, or raw 64-hex-char, and
	 * must be a valid BN254 field element (< BN254_MODULUS).
	 *
	 * Source of truth: `districtCredentials.districtCommitment` in Convex
	 * (see commons/convex/schema.ts). The server-side verify flow stores the
	 * commitment when issuing the Ed25519-signed VC; the client reads it out of
	 * the credential before calling this builder.
	 *
	 * Added in commons.v2 (Stage 2 re-grounding).
	 */
	districtCommitment: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// VALIDATION
// ═══════════════════════════════════════════════════════════════════════════

const VALID_JURISDICTION_TYPES: ReadonlySet<string> = new Set([
	'federal',
	'state',
	'local',
	'international'
]);

/**
 * Regex for a district_commitment: optional 0x prefix + exactly 64 lowercase or
 * uppercase hex characters. We accept both to match the rest of the codebase's
 * hex conventions, then normalize.
 */
const DISTRICT_COMMITMENT_RE = /^(?:0x)?[0-9a-fA-F]{64}$/;

/**
 * Validate action domain parameters.
 * @throws Error if any parameter is missing or invalid
 */
function validateParams(params: ActionDomainParams): void {
	if (!params.country || typeof params.country !== 'string') {
		throw new Error('country is required (ISO 3166-1 alpha-2)');
	}
	if (params.country.length !== 2) {
		throw new Error(`country must be 2-character ISO code, got "${params.country}"`);
	}
	if (!VALID_JURISDICTION_TYPES.has(params.jurisdictionType)) {
		throw new Error(
			`jurisdictionType must be one of: ${[...VALID_JURISDICTION_TYPES].join(', ')}; got "${params.jurisdictionType}"`
		);
	}
	if (!params.recipientSubdivision || typeof params.recipientSubdivision !== 'string') {
		throw new Error('recipientSubdivision is required');
	}
	if (!params.templateId || typeof params.templateId !== 'string') {
		throw new Error('templateId is required');
	}
	if (!params.sessionId || typeof params.sessionId !== 'string') {
		throw new Error('sessionId is required');
	}
	if (!params.districtCommitment || typeof params.districtCommitment !== 'string') {
		throw new Error('districtCommitment is required (64-hex BN254 field element)');
	}
	if (!DISTRICT_COMMITMENT_RE.test(params.districtCommitment)) {
		throw new Error(
			`districtCommitment must be 64-hex chars (optionally 0x-prefixed), got "${params.districtCommitment}"`
		);
	}
	// Enforce BN254 field element bound. A malformed (too-large) commitment would
	// still hex-parse but could collide with domain-separation assumptions in the
	// circuit. The sponge-over-24 output is always < BN254_MODULUS by construction,
	// so rejecting here catches client-corruption or malicious fabrication.
	const normalized = params.districtCommitment.startsWith('0x')
		? params.districtCommitment
		: '0x' + params.districtCommitment;
	let asBigInt: bigint;
	try {
		asBigInt = BigInt(normalized);
	} catch {
		throw new Error(
			`districtCommitment is not a valid hex integer: "${params.districtCommitment}"`
		);
	}
	if (asBigInt < 0n || asBigInt >= BN254_MODULUS) {
		throw new Error(
			`districtCommitment must be a valid BN254 field element (< modulus), got ${asBigInt}`
		);
	}
}

// ═══════════════════════════════════════════════════════════════════════════
// CORE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Build a deterministic action domain from structured parameters.
 *
 * Computes keccak256(abi.encodePacked(protocol, country, jurisdictionType,
 * recipientSubdivision, templateId, sessionId, district_commitment)) and
 * reduces modulo BN254 to produce a valid field element for the ZK circuit.
 *
 * @param params - Action domain parameters (districtCommitment required in v2)
 * @returns Hex string field element (0x-prefixed, 64 chars)
 * @throws Error if parameters are invalid
 *
 * @example
 * ```typescript
 * const domain = buildActionDomain({
 *   country: 'US',
 *   jurisdictionType: 'federal',
 *   recipientSubdivision: 'US-CA',
 *   templateId: 'climate-action-2026',  // the user-created "campaign"
 *   sessionId: '119th-congress',         // the legislative session
 *   districtCommitment:                  // Poseidon2 sponge over 24 districts
 *     '0x1fd7...'                        // from districtCredentials.districtCommitment
 * });
 * // domain: "0x1a2b3c..." (64-char hex field element)
 * ```
 */
export function buildActionDomain(params: ActionDomainParams): string {
	validateParams(params);

	// Normalize districtCommitment to `bytes32` layout so the keccak preimage is
	// independent of whether the caller supplied `0x`-prefixed or raw hex.
	const districtCommitmentBytes32 = params.districtCommitment.startsWith('0x')
		? params.districtCommitment
		: '0x' + params.districtCommitment;

	// keccak256(abi.encodePacked(protocol, country, jurisdictionType,
	//                            recipientSubdivision, templateId, sessionId,
	//                            district_commitment))
	//
	// bytes32 for district_commitment is fixed-width in abi.encodePacked, so it
	// can never be confused with a preceding variable-length string via boundary
	// ambiguity — keccak256 encodePacked collisions for strings are only possible
	// across adjacent variable-length fields, and the district commitment is the
	// terminal, fixed-width field.
	const hash = solidityPackedKeccak256(
		['string', 'string', 'string', 'string', 'string', 'string', 'bytes32'],
		[
			PROTOCOL_VERSION,
			params.country,
			params.jurisdictionType,
			params.recipientSubdivision,
			params.templateId,
			params.sessionId,
			districtCommitmentBytes32
		]
	);

	// Reduce to BN254 field element for circuit compatibility
	const fieldElement = BigInt(hash) % BN254_MODULUS;
	return '0x' + fieldElement.toString(16).padStart(64, '0');
}

/**
 * Derive a debate-scoped action domain from a template's base domain.
 *
 * Mirrors the on-chain derivation in DebateMarket.deriveDomain():
 *   keccak256(abi.encodePacked(baseDomain, "debate", propositionHash)) % BN254_MODULUS
 *
 * The client must compute this BEFORE generating the ZK proof, because
 * actionDomain is baked into the circuit as a public input (index [27]).
 *
 * @param baseDomain - The template's registered action domain (0x-prefixed, 64 hex chars)
 * @param propositionHash - The debate's proposition hash (0x-prefixed, 64 hex chars)
 * @returns Hex string field element (0x-prefixed, 64 chars) — the debate action domain
 * @throws Error if baseDomain or propositionHash are invalid
 */
export function buildDebateActionDomain(baseDomain: string, propositionHash: string): string {
	// Validate inputs
	if (!baseDomain || !isValidActionDomain(baseDomain)) {
		throw new Error(`Invalid baseDomain: must be a valid BN254 field element, got "${baseDomain}"`);
	}
	if (!propositionHash || !/^0x[0-9a-fA-F]{64}$/.test(propositionHash)) {
		throw new Error(`Invalid propositionHash: must be 0x-prefixed 32-byte hex, got "${propositionHash}"`);
	}

	// Mirror the on-chain derivation: keccak256(abi.encodePacked(baseDomain, "debate", propositionHash))
	const hash = solidityPackedKeccak256(
		['bytes32', 'string', 'bytes32'],
		[baseDomain, 'debate', propositionHash]
	);

	// Reduce to BN254 field element
	const fieldElement = BigInt(hash) % BN254_MODULUS;
	return '0x' + fieldElement.toString(16).padStart(64, '0');
}

/**
 * Build a community field epoch domain for ZK-verified spatial aggregation.
 *
 * Each user can contribute once per epoch (daily, UTC midnight) per jurisdiction.
 * The epoch domain includes the base action domain + COMMUNITY_FIELD_TAG + date,
 * producing a unique nullifier per user per day per jurisdiction.
 *
 * Derivation mirrors the debate domain pattern:
 *   keccak256(abi.encodePacked(baseDomain, COMMUNITY_FIELD_TAG, epochDateString)) % BN254
 *
 * @param baseDomain - Jurisdiction-specific base domain (0x-prefixed, 64 hex chars)
 * @param epochDate  - UTC date for the epoch (only year-month-day used)
 * @returns Hex string field element (0x-prefixed, 64 chars)
 */
export function buildCommunityFieldEpochDomain(
	baseDomain: string,
	epochDate: Date
): string {
	if (!baseDomain || !isValidActionDomain(baseDomain)) {
		throw new Error(
			`Invalid baseDomain: must be a valid BN254 field element, got "${baseDomain}"`
		);
	}

	// Epoch identifier: "2026-03-02" (UTC date only)
	const epochStr = epochDate.toISOString().slice(0, 10);

	// COMMUNITY_FIELD_TAG = 0x434649454c44 ("CFIELD")
	const hash = solidityPackedKeccak256(
		['bytes32', 'bytes6', 'string'],
		[baseDomain, '0x434649454c44', epochStr]
	);

	const fieldElement = BigInt(hash) % BN254_MODULUS;
	return '0x' + fieldElement.toString(16).padStart(64, '0');
}

/**
 * Validate that a hex string is a valid BN254 field element.
 * Useful for validating action domains received from external sources.
 *
 * @param hex - Hex string (0x-prefixed or raw)
 * @returns true if valid field element
 */
export function isValidActionDomain(hex: string): boolean {
	try {
		const normalized = hex.startsWith('0x') ? hex : '0x' + hex;
		const value = BigInt(normalized);
		return value >= 0n && value < BN254_MODULUS;
	} catch {
		return false;
	}
}
