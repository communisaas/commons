/**
 * Constituent Resolver — TEE Abstraction
 *
 * Resolves encrypted witness data into constituent PII for CWC delivery.
 * PII is not written to disk or database in plaintext. The local implementation
 * is standard process memory, not enclave memory; the Nitro implementation is
 * the future hardware-isolated boundary.
 *
 * Implementations:
 * - LocalConstituentResolver (MVP): In-process decryption via X25519 + XChaCha20
 * - NitroEnclaveResolver (future): AWS Nitro Enclave with attestation —
 *   PII never leaves the enclave boundary; decryption key is enclave-only
 */

import type { ConstituentData } from '$lib/core/legislative/types';

export interface EncryptedWitnessRef {
	ciphertext: string;
	nonce: string;
	ephemeralPublicKey: string;
}

/**
 * Circuit-domain separation inputs. The resolver compares these against the
 * values committed in publicInputs to prevent cross-template proof replay.
 *
 * `districtCommitment` is REQUIRED (Stage 2.7). It is the server-canonical
 * Poseidon2_sponge_24 hash of the user's 24 district slots, fetched from
 * `districtCredentials.districtCommitment` by the submissions action. The
 * resolver hashes the DECRYPTED witness's district slots with the same
 * sponge and compares — closes the witness-to-commitment binding gap a
 * prover could exploit with a leaked credentialHash.
 */
export interface ResolverExpected {
	actionDomain: string;
	templateId: string;
	districtCommitment: string;
}

/**
 * Full /resolve v2 request: encrypted witness + proof + publicInputs + expected.
 *
 * The three-gate resolver check runs atomically:
 *   1. Decrypt the witness (XChaCha20)
 *   2. Verify the ZK proof against publicInputs (bundled verifier key)
 *   3. Geocode decrypted deliveryAddress → derive cellId →
 *      compare to witness.cellId (from decrypted private input)
 *
 * All three must pass OR ConstituentData is never returned.
 * No partial success result is returned. The local implementation does not
 * claim enclave-grade memory or timing isolation.
 */
export interface ResolveRequest extends EncryptedWitnessRef {
	proof: string;
	publicInputs: unknown;
	expected: ResolverExpected;
}

export type ResolverErrorCode =
	| 'DECRYPT_FAIL'
	| 'PROOF_INVALID'
	| 'CELL_MISMATCH'
	| 'ADDRESS_UNRESOLVABLE'
	| 'MISSING_FIELDS'
	| 'DOMAIN_MISMATCH'
	/**
	 * G7: credential predates the H3-vs-BN254 encoding split fix. The witness
	 * lacks h3Cell, so H3-to-H3 reconciliation is impossible. The user must
	 * re-verify (mDL recovery flow) to receive a post-G7 credential. UX should
	 * route this to the recovery flow, NOT to the "fix your address" UI.
	 */
	| 'CREDENTIAL_MIGRATION_REQUIRED'
	/**
	 * G4: NitroEnclaveResolver was selected (TEE_PUBLIC_KEY_URL set) but the
	 * enclave service is not yet deployed. Operator action: deploy the
	 * enclave or unset TEE_PUBLIC_KEY_URL. UI should show "infrastructure
	 * provisioning" rather than "your data is bad."
	 */
	| 'NITRO_ENCLAVE_NOT_DEPLOYED'
	/**
	 * G4: NitroEnclaveResolver was selected and was reachable previously,
	 * but a resolve() call failed (network, attestation chain, response
	 * parse). Distinct from NOT_DEPLOYED — this is a runtime outage on
	 * shipped infrastructure. Different incident-response path.
	 */
	| 'NITRO_ENCLAVE_UNREACHABLE';

export interface ResolverResult {
	success: boolean;
	constituent?: ConstituentData;
	/** Nitro Enclave attestation document (future — proves decryption happened inside TEE) */
	attestation?: string;
	error?: string;
	/** Typed failure code. Never contains PII; safe to persist to deliveryError. */
	errorCode?: ResolverErrorCode;
}

/**
 * Interface for resolving encrypted witness data into constituent PII.
 *
 * All implementations MUST:
 * 1. Never persist plaintext PII to disk or database
 * 2. Scope PII to the lifetime of the resolve() call
 * 3. Return ConstituentData that satisfies CWC <ConstituentData> requirements
 * 4. Run the three-gate atomic check (decrypt, verify, reconcile) — any gate
 *    failure produces a typed errorCode with no PII in the error payload
 *
 * The LocalConstituentResolver satisfies (1-4) via in-process handling and by
 * keeping plaintext out of persisted records/log payloads. It does not provide
 * secure memory zeroization.
 * A NitroEnclaveResolver would additionally guarantee PII never leaves
 * the enclave's attested memory boundary.
 */
export interface ConstituentResolver {
	resolve(request: ResolveRequest): Promise<ResolverResult>;
}
