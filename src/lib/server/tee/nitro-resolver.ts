/**
 * NitroEnclaveResolver — AWS Nitro Enclave constituent data resolver.
 *
 * Skeleton implementation (G4). The actual enclave deployment is a separate
 * ops effort; this class provides the interface boundary and the typed
 * "enclave not deployed" failure mode so the TEE_PUBLIC_KEY_URL → swap-in
 * is mechanical when deployment lands.
 *
 * Production wire boundary (G4r CRITICAL): the Convex delivery action at
 * convex/submissions.ts:1326 currently calls TEE_RESOLVER_URL/resolve over
 * HTTP, NOT getConstituentResolver() in-process. The interface formalized
 * here is the contract for the SERVICE BEHIND that URL — when a SvelteKit
 * /resolve endpoint is added (or an external service is built), it should
 * use ConstituentResolver internally. Today the in-process selector is
 * exercised only by tests.
 *
 * Trust model:
 *   The enclave's input snapshot CID + deterministic logic must be publicly
 *   reproducible. Attestation says the code ran; verifiers independently
 *   rebuild the inputs to confirm correctness. Without that, attestation
 *   is "trust-me-bro with hardware glitter".
 *
 * Failure semantics:
 *   - Enclave unreachable → return a typed ResolverResult failure, do NOT
 *     silently fall back to LocalConstituentResolver. Mid-flight degradation
 *     defeats the attestation contract.
 *   - This means: if TEE_PUBLIC_KEY_URL is set and the enclave is down,
 *     ALL T3+ submissions fail (delivery error logged, retryable) until
 *     the enclave recovers. Operational consequence is acknowledged in
 *     tee/index.ts.
 *   - Failures RETURN as ResolverResult (not thrown) so the interface
 *     contract is preserved and Convex's existing errorCode persistence
 *     path handles it without try/catch additions.
 *
 * Out-of-scope for the stub (deployment work):
 *   - Actual KMS/attestation document fetching
 *   - vsock proxy for enclave network access
 *   - Per-region active-active failover
 *   - Witness TTL extension during declared TEE outages
 */

import type {
	ConstituentResolver,
	ResolveRequest,
	ResolverResult,
} from './constituent-resolver';

export class NitroEnclaveResolver implements ConstituentResolver {
	private readonly endpoint: string;

	constructor(endpoint: string) {
		if (!endpoint || endpoint.trim() === '') {
			throw new Error('NitroEnclaveResolver requires a non-empty endpoint URL');
		}
		try {
			const url = new URL(endpoint);
			if (url.protocol !== 'https:') {
				throw new Error(
					`NitroEnclaveResolver endpoint must be HTTPS (got ${url.protocol}); ` +
						'attestation cannot be verified over plaintext transport.',
				);
			}
		} catch (err) {
			throw new Error(
				`NitroEnclaveResolver: invalid endpoint URL "${endpoint}": ` +
					(err instanceof Error ? err.message : String(err)),
			);
		}
		this.endpoint = endpoint;
	}

	async resolve(_request: ResolveRequest): Promise<ResolverResult> {
		// Deployment-state probe: when the enclave service is implemented, this
		// path becomes:
		//   1. POST /resolve with the encrypted witness + proof + publicInputs
		//   2. Verify the response's attestation document chain against AWS
		//      Nitro root certificates
		//   3. Verify the attestation's PCR0 measurement matches the published
		//      enclave image (snapshot CID published alongside the manifest)
		//   4. Return ResolverResult from the enclave's signed response body
		//      (success path MUST set attestation field; UNREACHABLE on parse fail)
		//
		// Until then, fail closed with a typed errorCode. Distinct codes for
		// "configured but not deployed" (operator action: deploy or unset env)
		// vs "deployed but unreachable" (operator action: incident response).
		// Both fail closed; no silent fallback to Local.
		return {
			success: false,
			errorCode: 'NITRO_ENCLAVE_NOT_DEPLOYED',
			error:
				`NitroEnclaveResolver configured (endpoint=${this.endpoint}) but ` +
				'enclave service not deployed. Unset TEE_PUBLIC_KEY_URL to use ' +
				'LocalConstituentResolver (non-TEE), or deploy the enclave.',
		};
	}
}
