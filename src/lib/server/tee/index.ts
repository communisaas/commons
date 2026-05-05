/**
 * TEE (Trusted Execution Environment) Module
 *
 * Provides constituent data resolution through an abstraction that
 * can be swapped between local decryption (today, non-TEE) and an attested
 * AWS Nitro Enclave (post-launch).
 *
 * ===========================================================================
 * G4r CRITICAL CONTEXT: this factory is NOT on the production delivery path.
 * ===========================================================================
 * The Convex delivery action at convex/submissions.ts:1326 calls
 * `${TEE_RESOLVER_URL}/resolve` over HTTP. That URL points at a service
 * (in-repo SvelteKit endpoint or external) which uses ConstituentResolver
 * internally. Today only LocalConstituentResolver is used inside that
 * service. Flipping TEE_PUBLIC_KEY_URL on a Convex worker has NO effect
 * unless the resolver service ALSO reads it.
 *
 * Two env vars control the system:
 *   - TEE_RESOLVER_URL     : HTTP target (Convex action calls this)
 *   - TEE_PUBLIC_KEY_URL   : in-process selector (this factory)
 *
 * They MUST be coordinated at deployment time. This is the operational
 * gap G4 surfaces but does not close. Future work: have the resolver
 * service expose its own /tee/public-key endpoint and have the witness
 * encryption layer pin to it; then TEE_PUBLIC_KEY_URL becomes redundant
 * with TEE_RESOLVER_URL and one var goes away.
 *
 * Selection (when this factory IS the call site):
 *   - TEE_PUBLIC_KEY_URL unset/whitespace → LocalConstituentResolver
 *     (in-process plaintext, JS-string memory model, no isolation
 *     guarantees; trust the operator not to log/persist)
 *   - TEE_PUBLIC_KEY_URL set → NitroEnclaveResolver (HTTP client to
 *     enclave; returns ResolverResult{success:false, errorCode:
 *     NITRO_ENCLAVE_NOT_DEPLOYED} when stub is in effect — no silent
 *     fallback to Local)
 *
 * The trust models differ:
 *   Local: verifiable via reproducible Tree 2 build from public TIGER inputs.
 *     Atlas inputs publicly auditable; resolver computation is not.
 *   Nitro: hardware-isolated, attested. Trust the attestation chain AND the
 *     input snapshot CID + deterministic logic. Attestation says the code
 *     ran; verifiers can independently rebuild the inputs.
 *
 * Launch decision: shipping with Local is acceptable IF the trust model is
 * stated truthfully in the receipt UI (G5: "operator-resolved" vs
 * "TEE-resolved"). Nitro deployment is a post-launch ops effort that swaps
 * the implementation, not the architecture.
 */

import type { ConstituentResolver } from './constituent-resolver';
import { LocalConstituentResolver } from './local-resolver';
import { NitroEnclaveResolver } from './nitro-resolver';

let resolver: ConstituentResolver | null = null;

/**
 * Get the active constituent resolver.
 *
 * Selection happens at first call and is memoized. Production startup should
 * fail loud if TEE_PUBLIC_KEY_URL is set but unreachable — see
 * NitroEnclaveResolver constructor + resolve() for the failure semantics.
 */
export function getConstituentResolver(): ConstituentResolver {
	if (!resolver) {
		const teeUrl = typeof process !== 'undefined' ? process.env?.TEE_PUBLIC_KEY_URL : undefined;
		if (teeUrl && teeUrl.trim() !== '') {
			resolver = new NitroEnclaveResolver(teeUrl.trim());
		} else {
			resolver = new LocalConstituentResolver();
		}
	}
	return resolver;
}

/**
 * Reset the singleton. Tests only — never call from production paths.
 * Without this, env-var changes inside a test don't propagate.
 */
export function _resetConstituentResolverForTest(): void {
	resolver = null;
}

export type { ConstituentResolver, EncryptedWitnessRef, ResolverResult } from './constituent-resolver';
export type { ConstituentData } from '$lib/core/legislative/types';
