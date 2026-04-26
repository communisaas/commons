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
	SHADOW_ATLAS_VERIFICATION: true,

	/** Agentic delegation: AI proxy civic actions under user-defined policy constraints (Tier 3+) */
	DELEGATION: false,

	/** Send/engagement counters: "X acted on this", district coverage, open/click metrics */
	ENGAGEMENT_METRICS: false,

	/** Passkey (WebAuthn) sign-in option on the login screen */
	PASSKEY: false,

	/**
	 * Android mDL over OpenID4VP.
	 *
	 * This is the first functional rollout lane. OpenID4VP responses are JWT /
	 * SD-JWT based, and `processOid4vpResponse` verifies the token signature and
	 * compares the VP nonce against the server-issued nonce before trusting
	 * claims. It does not depend on Apple Business Connect.
	 */
	MDL_ANDROID_OID4VP: true,

	/**
	 * Raw ISO mdoc (`org-iso-mdoc`) lane.
	 *
	 * Keep this false until T3 lands: reconstruct SessionTranscript and verify
	 * DeviceMAC / DeviceSignature per ISO 18013-5 section 9.1.3. The current
	 * presence gate rejects malformed wallets but does not stop capture-replay.
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
	 * Desktop to phone bridge. For the Android-first rollout this bridge returns
	 * only OpenID4VP request configs and the complete endpoint rejects mdoc.
	 */
	MDL_BRIDGE: true,

	/**
	 * Legacy alias retained only for old string-search tests and migration
	 * comments. New code must use the protocol/platform flags above.
	 */
	MDL: false
} as const;

export type MdlProtocol = 'openid4vp' | 'org-iso-mdoc';

export function isMdlProtocolEnabled(protocol: string): boolean {
	if (protocol === 'openid4vp') return FEATURES.MDL_ANDROID_OID4VP;
	if (protocol === 'org-iso-mdoc') return FEATURES.MDL_MDOC;
	return false;
}

export function isAnyMdlProtocolEnabled(): boolean {
	return FEATURES.MDL_ANDROID_OID4VP || FEATURES.MDL_MDOC;
}

export function isMdlBridgeEnabled(): boolean {
	return FEATURES.MDL_BRIDGE && isAnyMdlProtocolEnabled();
}
