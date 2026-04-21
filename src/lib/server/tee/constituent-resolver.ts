/**
 * Constituent Resolver — TEE Abstraction
 *
 * Resolves encrypted witness data into constituent PII for CWC delivery.
 * PII exists only in memory during the delivery request and is never
 * written to disk or database in plaintext.
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
 */
export interface ResolverExpected {
	actionDomain: string;
	templateId: string;
}

/**
 * Full /resolve v2 request: encrypted witness + proof + publicInputs + expected.
 *
 * The three-gate TEE check runs atomically:
 *   1. Decrypt the witness (XChaCha20)
 *   2. Verify the ZK proof against publicInputs (bundled verifier key)
 *   3. Geocode decrypted deliveryAddress → derive cellId →
 *      compare to witness.cellId (from decrypted private input)
 *
 * All three must pass OR ConstituentData is never returned.
 * No partial leakage. No timing side channel.
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
	| 'DOMAIN_MISMATCH';

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
 * The LocalConstituentResolver satisfies (1-4) via function-scoped variables
 * and in-process verification.
 * A NitroEnclaveResolver would additionally guarantee PII never leaves
 * the enclave's attested memory boundary.
 */
export interface ConstituentResolver {
	resolve(request: ResolveRequest): Promise<ResolverResult>;
}
