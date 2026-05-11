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

import { env } from '$env/dynamic/private';
import type { ConstituentResolver } from './constituent-resolver';
import { LocalConstituentResolver } from './local-resolver';
import { NitroEnclaveResolver } from './nitro-resolver';

/**
 * Get the active constituent resolver. Per-call factory: NO module-scope
 * memoization. CF Workers reuse isolates across requests; a memoized resolver
 * with per-instance state (cache, DB handle, key material) would bleed state
 * across users. Today both implementations are stateless, but the factory
 * shape is what guards against future regressions — the moment a resolver
 * subclass adds instance state, this no-memoization contract is what keeps
 * cross-request bleed impossible.
 *
 * Construction is cheap: `LocalConstituentResolver` has no constructor work;
 * `NitroEnclaveResolver` validates the endpoint URL once. Per-request cost is
 * negligible compared to the actual resolve() work.
 *
 * If you find yourself wanting to add caching here, push the cache INTO the
 * resolver implementation with explicit per-request scoping (e.g., a request-id
 * key) — never back to module scope.
 */
export function getConstituentResolver(): ConstituentResolver {
	// Read via SvelteKit's `$env/dynamic/private` (NOT `process.env`). On
	// Cloudflare Pages with `nodejs_compat`, `process` is polyfilled but
	// `process.env` is empty — the platform binds env vars through the
	// `platform.env` interface that `$env/dynamic/private` reads. Using
	// `process.env` here would silently fall back to LocalConstituentResolver
	// even when the operator has configured `TEE_PUBLIC_KEY_URL`. (MEMORY.md
	// "CF Workers: process.env is empty" is the operative gotcha.)
	const teeUrl = env.TEE_PUBLIC_KEY_URL;
	if (teeUrl && teeUrl.trim() !== '') {
		return new NitroEnclaveResolver(teeUrl.trim());
	}
	return new LocalConstituentResolver();
}

/**
 * No-op retained for test-source compatibility. The factory no longer caches
 * any state — there is nothing to reset. Kept exported so the existing afterEach
 * hooks in `tests/unit/tee/nitro-resolver.test.ts` continue to compile.
 */
export function _resetConstituentResolverForTest(): void {
	// no-op
}

export type { ConstituentResolver, EncryptedWitnessRef, ResolverResult } from './constituent-resolver';
export type { ConstituentData } from '$lib/core/legislative/types';
