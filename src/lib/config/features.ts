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
	DEBATE: false,

	/** CWC delivery, district officials, congressional template routing */
	CONGRESSIONAL: true,

	/**
	 * Address verification specificity level.
	 * Location inference and template filtering are available at 'region'+.
	 * Street address collection and district credential issuance require 'district'.
	 */
	ADDRESS_SPECIFICITY: 'district' as AddressSpecificity,

	/** Stance registration (support/oppose), TrustJourney signal strength, verified positions */
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
	SHADOW_ATLAS_VERIFICATION: false
} as const;
