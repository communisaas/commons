/**
 * Action Domain Builder - Deterministic action domain computation
 *
 * Constructs action domains for ZK proof nullifier binding. The action domain
 * uniquely identifies a (protocol, country, jurisdictionType, recipientSubdivision,
 * templateId, legislativeSessionId) tuple so that each user can only submit one
 * proof per action domain.
 *
 * HASHING SCHEME:
 * keccak256(abi.encodePacked(protocol, country, jurisdictionType, recipientSubdivision, templateId, sessionId))
 * → reduced mod BN254_MODULUS for circuit compatibility
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
 * SECURITY INVARIANTS:
 * 1. Output is always a valid BN254 field element (< modulus)
 * 2. Deterministic: same params always produce the same domain
 * 3. Collision-resistant: keccak256 preimage resistance
 * 4. Protocol-versioned: schema changes require version bump
 *
 * @see COORDINATION-INTEGRITY-SPEC.md § Action Domain Schema
 * @see DistrictGate.sol § allowedActionDomains mapping
 */

import { solidityPackedKeccak256 } from 'ethers';
import { BN254_MODULUS } from '$lib/core/crypto/bn254';

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

const PROTOCOL_VERSION = 'commons.v1';

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
}

// ═══════════════════════════════════════════════════════════════════════════
// CORE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Build a deterministic action domain from structured parameters.
 *
 * Computes keccak256(abi.encodePacked(fields)) and reduces modulo BN254
 * to produce a valid field element for the ZK circuit.
 *
 * @param params - Action domain parameters
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
 *   sessionId: '119th-congress'          // the legislative session
 * });
 * // domain: "0x1a2b3c..." (64-char hex field element)
 * ```
 */
export function buildActionDomain(params: ActionDomainParams): string {
	validateParams(params);

	// keccak256(abi.encodePacked(protocol, country, jurisdictionType, recipientSubdivision, templateId, sessionId))
	const hash = solidityPackedKeccak256(
		['string', 'string', 'string', 'string', 'string', 'string'],
		[
			PROTOCOL_VERSION,
			params.country,
			params.jurisdictionType,
			params.recipientSubdivision,
			params.templateId,
			params.sessionId
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
