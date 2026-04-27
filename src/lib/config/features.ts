/**
 * Feature flags — flip to `true` when ready to reveal.
 *
 * These are compile-time constants. Svelte's dead-code elimination
 * will strip the gated UI from the bundle when a flag is `false`.
 */

/**
 * Address verification specificity level.
 *
 * - `'off'`      — No location features at all (dead-code eliminated)
 * - `'region'`   — State/city-level inference, LocationFilter active,
 *                  template filtering by geography — no street address collection
 * - `'district'` — Full street address → congressional district verification,
 *                  AddressCollectionForm, credential issuance, trust_tier upgrade
 */
export type AddressSpecificity = 'off' | 'region' | 'district';

const forceShadowAtlasOff = import.meta.env.VITE_FORCE_SHADOW_ATLAS_OFF === '1';
const enableDirectQrSmoke = import.meta.env.VITE_MDL_DIRECT_QR === '1';
const environmentLabel = import.meta.env.VITE_ENVIRONMENT;
const directQrSmokeOrigin = import.meta.env.VITE_MDL_DIRECT_QR_ORIGIN?.trim() || '';
const STAGING_DIRECT_QR_ORIGIN = 'https://staging.commons.email';

if (import.meta.env.PROD && forceShadowAtlasOff && import.meta.env.VITE_ENVIRONMENT !== 'test') {
	throw new Error('VITE_FORCE_SHADOW_ATLAS_OFF may only be used by test builds');
}

if (import.meta.env.PROD && enableDirectQrSmoke && environmentLabel !== 'staging') {
	throw new Error('VITE_MDL_DIRECT_QR may only be enabled for staging smoke builds');
}

if (
	import.meta.env.PROD &&
	enableDirectQrSmoke &&
	directQrSmokeOrigin !== STAGING_DIRECT_QR_ORIGIN
) {
	throw new Error('VITE_MDL_DIRECT_QR_ORIGIN must be the staging smoke origin');
}

export const FEATURES = {
	/** Deliberation surfaces, argument submission, LMSR market, resolution/appeal */
	DEBATE: true,

	/** CWC delivery, district officials, congressional template routing */
	CONGRESSIONAL: false,

	/**
	 * Address verification specificity level.
	 * Location inference and template filtering are available at 'region'+.
	 * Street address collection and district credential issuance require 'district'.
	 */
	ADDRESS_SPECIFICITY: 'district' as AddressSpecificity,

	/** Stance registration (support/oppose), inline proof footer, verified positions */
	STANCE_POSITIONS: true,

	/** Wallet connect, balance display, on-chain identity */
	WALLET: true,

	/** Enhanced campaign analytics: delivery metrics, timelines, coordination integrity overlay */
	ANALYTICS_EXPANDED: true,

	/** Email A/B testing: two-variant split, winner selection, results comparison */
	AB_TESTING: true,

	/** Public REST API at /api/v1/ with API key auth */
	PUBLIC_API: true,

	/** Events: RSVP, verified attendance, event management */
	EVENTS: true,

	/** Fundraising: Stripe donations, 0% platform fee, public donate pages */
	FUNDRAISING: true,

	/** Automation: event-driven engagement ladders, workflow builder */
	AUTOMATION: true,

	/** SMS campaigns + patch-through calling (Twilio) */
	SMS: true,

	/** Multi-org coalition networks: parent/child orgs, shared supporter pools */
	NETWORKS: true,

	/** Legislative intelligence loop: bill monitoring, alerts, scorecards */
	LEGISLATION: true,

	/** Accountability receipts: proof-weighted decision-maker tracking */
	ACCOUNTABILITY: true,

	/** Shadow Atlas client-side verification: browser computes district commitment (no plaintext to server) */
	SHADOW_ATLAS_VERIFICATION: forceShadowAtlasOff ? false : true,

	/** Agentic delegation: AI proxy civic actions under user-defined policy constraints (Tier 3+) */
	DELEGATION: false,

	/** Send/engagement counters: "X acted on this", district coverage, open/click metrics */
	ENGAGEMENT_METRICS: false,

	/** Passkey (WebAuthn) sign-in option on the login screen */
	PASSKEY: false,

	/**
	 * Android mDL over OpenID4VP via the W3C Digital Credentials API.
	 *
	 * This lane does not depend on Apple Business Connect. Google Wallet's
	 * current web protocol identifier is `openid4vp-v1-unsigned`; the legacy
	 * `openid4vp` alias is accepted only for older browser experiments.
	 */
	MDL_ANDROID_OID4VP: true,

	/**
	 * Raw ISO mdoc (`org-iso-mdoc`) lane.
	 *
	 * Keep this false until T3 lands: reconstruct SessionTranscript and verify
	 * DeviceMAC / DeviceSignature per ISO 18013-5 §9.1.3. The current presence
	 * gate rejects malformed wallets but does not stop capture-replay.
	 */
	MDL_MDOC: false,

	/**
	 * iOS/Safari same-device lane.
	 *
	 * Apple Business Connect is an iOS availability gate, not an Android launch
	 * gate. Keep false until ABC enrollment and `MDL_MDOC` are both ready.
	 */
	MDL_IOS: false,

	/**
	 * Desktop → phone bridge. For the Android-first rollout this bridge returns
	 * only OpenID4VP request configs and the complete endpoint rejects mdoc.
	 */
	MDL_BRIDGE: true,

	/**
	 * Desktop → phone direct OpenID4VP QR.
	 *
	 * Keep false until the direct-session store, direct mdoc handover,
	 * request_uri/direct_post endpoints, desktop QR UI, staging preflight, and
	 * real-device smoke all pass. `/verify-bridge` remains the default desktop
	 * fallback while this is false.
	 */
	MDL_DIRECT_QR: enableDirectQrSmoke,

	/**
	 * Legacy alias retained only for old string-search tests and migration
	 * comments. New code must use the protocol/platform flags above.
	 */
	MDL: false,

	/**
	 * Wave 3 — V2 three-tree proof generation (F1 closure).
	 *
	 * When `false` (default): the client generates V1 proofs (31 public inputs).
	 * The server-side resolver-gates and submission endpoint accept BOTH V1 and
	 * V2 already, so a partial cutover is safe — flipping this on a subset of
	 * sessions is the canary mechanism.
	 *
	 * When `true`: the client fetches the revocation non-membership path from
	 * Convex and generates a V2 proof (33 public inputs, including
	 * revocation_nullifier and revocation_registry_root). The on-chain
	 * `verifyThreeTreeProofV2` ABI is invoked.
	 *
	 * Cutover plan (REGROUNDING-LAUNCH-READINESS.md Phase R2):
	 *   - Day 0: flip true for 10% of new proofs (gradient via remote config or
	 *            session-id hash bucket)
	 *   - Day 3: 50% if metrics nominal
	 *   - Day 7: 100%
	 *   - Day 14: deprecate V1 generation; keep V1 verifier indefinitely for
	 *            grandfathered submissions
	 *
	 * Hard gate: `@voter-protocol/noir-prover@2.x` MUST be installed and the
	 * V2 circuit's verifying key MUST be deployed in DistrictGate before this
	 * flag flips true. Otherwise V2 proofs can't be generated AND can't be
	 * verified.
	 */
	V2_PROOF_GENERATION: false
} as const;

export const OPENID4VP_DC_API_PROTOCOL = 'openid4vp-v1-unsigned';
export const LEGACY_OPENID4VP_PROTOCOL = 'openid4vp';
export const MDL_DIRECT_QR_ALLOWED_ORIGIN = enableDirectQrSmoke
	? directQrSmokeOrigin || (import.meta.env.DEV ? undefined : STAGING_DIRECT_QR_ORIGIN)
	: undefined;

export type MdlProtocol =
	| typeof OPENID4VP_DC_API_PROTOCOL
	| typeof LEGACY_OPENID4VP_PROTOCOL
	| 'org-iso-mdoc';

export function isOpenId4VpProtocol(protocol: string): boolean {
	return protocol === OPENID4VP_DC_API_PROTOCOL || protocol === LEGACY_OPENID4VP_PROTOCOL;
}

export function isMdlProtocolEnabled(protocol: string): boolean {
	if (isOpenId4VpProtocol(protocol)) return FEATURES.MDL_ANDROID_OID4VP;
	if (protocol === 'org-iso-mdoc') return FEATURES.MDL_MDOC;
	return false;
}

export function isAnyMdlProtocolEnabled(): boolean {
	return FEATURES.MDL_ANDROID_OID4VP || FEATURES.MDL_MDOC;
}

export function isMdlBridgeEnabled(): boolean {
	return FEATURES.MDL_BRIDGE && isAnyMdlProtocolEnabled();
}

export function isMdlDirectQrEnabled(): boolean {
	return FEATURES.MDL_DIRECT_QR && FEATURES.MDL_ANDROID_OID4VP;
}

export function requireMdlDirectQrEnabled(runtimeOrigin?: string, requestOrigin?: string): void {
	if (!isMdlDirectQrEnabled()) {
		throw new Error('MDL_DIRECT_QR_DISABLED');
	}
	if (import.meta.env.DEV || !MDL_DIRECT_QR_ALLOWED_ORIGIN) return;
	if (!runtimeOrigin) {
		throw new Error('MDL_DIRECT_QR_ORIGIN_MISSING');
	}
	if (!requestOrigin) {
		throw new Error('MDL_DIRECT_QR_REQUEST_ORIGIN_MISSING');
	}
	const runtime = parseOrigin(runtimeOrigin);
	const request = parseOrigin(requestOrigin);
	if (runtime !== MDL_DIRECT_QR_ALLOWED_ORIGIN || request !== MDL_DIRECT_QR_ALLOWED_ORIGIN) {
		throw new Error('MDL_DIRECT_QR_ORIGIN_MISMATCH');
	}
}

function parseOrigin(value: string): string {
	try {
		return new URL(value).origin;
	} catch {
		throw new Error('MDL_DIRECT_QR_ORIGIN_INVALID');
	}
}
