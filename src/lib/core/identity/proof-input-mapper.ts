/**
 * SessionCredential → ThreeTreeProofInputs Mapper (CR-009)
 *
 * Bridges the stored credential format (SessionCredential in IndexedDB) to
 * the prover input format (ThreeTreeProofInputs for circuit execution).
 *
 * FIELD MAPPING:
 *   SessionCredential.merkleRoot       → ThreeTreeProofInputs.userRoot
 *   SessionCredential.merklePath       → ThreeTreeProofInputs.userPath
 *   SessionCredential.leafIndex        → ThreeTreeProofInputs.userIndex
 *   SessionCredential.cellMapRoot      → ThreeTreeProofInputs.cellMapRoot      (direct)
 *   SessionCredential.cellMapPath      → ThreeTreeProofInputs.cellMapPath      (direct)
 *   SessionCredential.cellMapPathBits  → ThreeTreeProofInputs.cellMapPathBits  (direct)
 *   SessionCredential.districts        → ThreeTreeProofInputs.districts        (direct)
 *   SessionCredential.userSecret       → ThreeTreeProofInputs.userSecret       (direct)
 *   SessionCredential.cellId           → ThreeTreeProofInputs.cellId           (direct)
 *   SessionCredential.registrationSalt → ThreeTreeProofInputs.registrationSalt (direct)
 *   SessionCredential.engagementRoot   → ThreeTreeProofInputs.engagementRoot   (direct)
 *   SessionCredential.engagementPath   → ThreeTreeProofInputs.engagementPath   (direct)
 *   SessionCredential.engagementIndex  → ThreeTreeProofInputs.engagementIndex  (direct)
 *   SessionCredential.engagementTier   → ThreeTreeProofInputs.engagementTier   (direct)
 *   SessionCredential.actionCount      → ThreeTreeProofInputs.actionCount      (direct)
 *   SessionCredential.diversityScore   → ThreeTreeProofInputs.diversityScore   (direct)
 *
 * COMPUTED AT PROOF TIME:
 *   nullifier     = poseidon2Hash2(identityCommitment, actionDomain)  [NUL-001 fix]
 *   actionDomain  = buildActionDomain(actionParams)  [caller-provided]
 *   authorityLevel = credential.authorityLevel (server-derived via deriveAuthorityLevel)
 *                    ?? context.authorityLevel (caller override)
 *                    ?? conservative fallback (3 if verified, 1 if not)
 *
 * See also: authority-level.ts for canonical server-side derivation,
 *           PUBLIC-INPUT-FIELD-REFERENCE.md for 31-input circuit ordering.
 *
 * PRIVACY INVARIANT:
 *   This mapper operates entirely in the browser. No private inputs
 *   (userSecret, cellId, registrationSalt) leave the client.
 */

import type { SessionCredential } from './session-credentials';
import type { ThreeTreeProofInputs, EngagementTier } from '$lib/core/zkp/prover-client';

/**
 * Context required at proof time (not stored in credential)
 */
export interface ProofContext {
	/** Action domain hex string (from buildActionDomain) */
	actionDomain: string;

	/** Pre-computed nullifier hex string = H2(identityCommitment, actionDomain) (NUL-001) */
	nullifier: string;

	/**
	 * User's authority level (1-5).
	 *
	 * Resolution order:
	 *   1. credential.authorityLevel (set during registration by server via deriveAuthorityLevel)
	 *   2. context.authorityLevel (caller override)
	 *   3. Conservative fallback: identity_commitment present → 3, otherwise → 1
	 */
	authorityLevel?: 1 | 2 | 3 | 4 | 5;

	/**
	 * V2-only F1 closure inputs (Wave 3 — REVOCATION-NULLIFIER-SPEC §2.4).
	 *
	 * When the caller is generating a V2 three-tree proof, ALL THREE fields
	 * MUST be provided together; the mapper threads them through to
	 * `ThreeTreeProofInputs`. The downstream validator
	 * (`validateThreeTreeProofInputs`) enforces all-or-nothing presence.
	 *
	 * Computed via `fetchRevocationWitness()` on the SvelteKit/browser side
	 * by querying `internal.revocations.getRevocationNonMembershipPath` and
	 * filling any null sibling slots with the depth-d empty-subtree value
	 * from `getEmptyTreeRoot()`-style recurrence.
	 *
	 * Absent (undefined) when generating against the V1 prover. The
	 * `FEATURES.V2_PROOF_GENERATION` flag in `src/lib/config/features.ts`
	 * gates whether the caller fetches these.
	 */
	revocationPath?: string[];
	revocationPathBits?: number[];
	revocationRegistryRoot?: string;
}

/**
 * Conservative fallback authority level when credential.authorityLevel is not stored.
 */
function fallbackAuthorityLevel(credential: SessionCredential): 1 | 2 | 3 | 4 | 5 {
	const ic = credential.identityCommitment;
	if (ic && ic.length > 4 && BigInt(ic) !== 0n) {
		return 3;
	}
	return 1;
}

/**
 * Map a stored SessionCredential + proof-time context to ThreeTreeProofInputs.
 *
 * @param credential - Stored three-tree credential from IndexedDB
 * @param context - Proof-time context (actionDomain, nullifier, optional authorityLevel)
 * @returns ThreeTreeProofInputs ready for generateThreeTreeProof()
 * @throws Error if credential is not a three-tree credential or missing required fields
 */
export function mapCredentialToProofInputs(
	credential: SessionCredential,
	context: ProofContext
): ThreeTreeProofInputs {
	if (credential.credentialType !== 'three-tree') {
		throw new Error(
			`Expected three-tree credential, got "${credential.credentialType || 'unknown'}". ` +
				'Re-register with the three-tree flow to generate a compatible credential.'
		);
	}

	if (!credential.cellId) {
		throw new Error(
			'Your address does not support ZK proof generation. ' +
				'This typically affects US territories and some rural areas where Census Block data is unavailable. ' +
				'Please use district-attested delivery instead.'
		);
	}

	// Validate required Tree 1 and Tree 2 fields (these MUST be present)
	const missing: string[] = [];
	if (!credential.merkleRoot) missing.push('merkleRoot');
	if (!credential.merklePath) missing.push('merklePath');
	if (credential.leafIndex === undefined) missing.push('leafIndex');
	if (!credential.cellMapRoot) missing.push('cellMapRoot');
	if (!credential.cellMapPath) missing.push('cellMapPath');
	if (!credential.cellMapPathBits) missing.push('cellMapPathBits');
	if (!credential.districts) missing.push('districts');
	if (!credential.userSecret) missing.push('userSecret');
	if (!credential.registrationSalt) missing.push('registrationSalt');
	if (!credential.identityCommitment) missing.push('identityCommitment');

	if (missing.length > 0) {
		throw new Error(
			`Credential missing required fields: ${missing.join(', ')}. ` +
				'This may indicate a partial registration. Re-register to obtain a complete credential.'
		);
	}

	const authorityLevel =
		credential.authorityLevel ??
		context.authorityLevel ??
		fallbackAuthorityLevel(credential);

	// Tree 3 (engagement) graceful fallback: default to tier-0 values.
	// This ensures proof generation works even for credentials created before
	// the engagement pipeline was wired, or when engagement data fetch fails.
	const ZERO_HASH = '0x0000000000000000000000000000000000000000000000000000000000000000';
	const engagementDepth = credential.merklePath.length; // Match Tree 1 depth
	const engagementRoot = credential.engagementRoot || ZERO_HASH;
	const engagementPath = credential.engagementPath && credential.engagementPath.length > 0
		? credential.engagementPath
		: Array(engagementDepth).fill(ZERO_HASH);
	const engagementIndex = credential.engagementIndex ?? 0;

	return {
		// Public inputs
		userRoot: credential.merkleRoot,
		cellMapRoot: credential.cellMapRoot!,
		districts: credential.districts!,
		nullifier: context.nullifier,
		actionDomain: context.actionDomain,
		authorityLevel,
		engagementRoot,
		engagementTier: (credential.engagementTier ?? 0) as EngagementTier,

		// Private inputs
		userSecret: credential.userSecret!,
		cellId: credential.cellId,
		registrationSalt: credential.registrationSalt!,
		identityCommitment: credential.identityCommitment,

		// Tree 1 proof
		userPath: credential.merklePath,
		userIndex: credential.leafIndex,

		// Tree 2 proof
		cellMapPath: credential.cellMapPath!,
		cellMapPathBits: credential.cellMapPathBits!,

		// Tree 3 proof (engagement) — defaults to tier-0 if missing
		engagementPath,
		engagementIndex,
		actionCount: credential.actionCount ?? '0',
		diversityScore: credential.diversityScore ?? '0',

		// V2 (F1 closure) — pass through if context provided them. The downstream
		// validator catches partial provision; here we just thread.
		...(context.revocationPath !== undefined ? { revocationPath: context.revocationPath } : {}),
		...(context.revocationPathBits !== undefined
			? { revocationPathBits: context.revocationPathBits }
			: {}),
		...(context.revocationRegistryRoot !== undefined
			? { revocationRegistryRoot: context.revocationRegistryRoot }
			: {})
	};
}
