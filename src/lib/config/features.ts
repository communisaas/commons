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

if (import.meta.env.PROD && forceShadowAtlasOff && import.meta.env.VITE_ENVIRONMENT !== 'test') {
	throw new Error('VITE_FORCE_SHADOW_ATLAS_OFF may only be used by test builds');
}

export const FEATURES = {
	/** Deliberation surfaces, argument submission, LMSR market, resolution/appeal */
	DEBATE: false,

	/**
	 * CWC delivery, district officials, congressional template routing.
	 * Code exists; this is the ENTRY launch gate: when false, CWC templates are
	 * excluded from discovery and direct CWC template routes 404. The submission
	 * endpoints additionally require Tier 2+ (district-confirmed) proof authority
	 * before delivery runs — gov-ID (tier 4) raises the assurance badge, it is not
	 * the bar (see REQUIRED_CONGRESSIONAL_PROOF_TIER).
	 *
	 * Env-driven so the entry opens from BUILD config (`VITE_CONGRESSIONAL=1`) per
	 * environment, not by editing this constant — default OFF leaves prod unchanged
	 * until a build sets it. (The Convex DELIVERY gate is separate:
	 * `CONGRESSIONAL_DELIVERY_LAUNCHED` + the Senate path prefix.)
	 *
	 * SAFETY: only open this on a build whose Convex deployment routes the Senate to
	 * the LIVE inbox (`CWC_SENATE_PATH_PREFIX=messages` + `CWC_PRODUCTION=true`).
	 * Opening the entry on the `testing-messages` sandbox would surface "delivered"
	 * receipts for no-op sends — a false claim.
	 */
	CONGRESSIONAL: import.meta.env.VITE_CONGRESSIONAL === '1',

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

	/**
	 * Server-side email dispatch from the org composer. Draft creation and
	 * client-direct sends exist; the Convex server sender can be queued when
	 * route-local SES, org-key, and unsubscribe runtime dependencies pass.
	 */
	EMAIL_SERVER_DISPATCH: true,

	/**
	 * Per-recipient merge-field substitution for client-direct Lambda sends.
	 * The browser sender resolves tokens after org-key decryption and switches
	 * to one-recipient Lambda calls when a subject/body contains supported
	 * merge fields. Non-personalized sends keep the normal batch path.
	 */
	EMAIL_CLIENT_DIRECT_MERGE: true,

	/** Public REST API at /api/v1/ with API key auth */
	PUBLIC_API: true,

	/** Events: RSVP, verified attendance, event management */
	EVENTS: true,

	/** Fundraising: Stripe donations, 0% platform fee, public donate pages */
	FUNDRAISING: true,

	/** Automation: event-driven engagement ladders, workflow builder */
	AUTOMATION: true,

	/**
	 * Workflow side effects and scheduled processing. The builder and saved
	 * definitions are live; non-email workflows can arm tag writes, branch
	 * conditions, delay/resume, and trigger dispatch. Workflow email remains
	 * guarded by route-local SES/org-key/from-email dependencies.
	 */
	WORKFLOW_EXECUTION: true,

	/** SMS campaigns + patch-through calling (Twilio) */
	SMS: true,

	/**
	 * SMS blast dispatch. Draft CRUD is live; bulk send is gated until the
	 * client-side phone decryptor / Twilio proxy path is wired.
	 */
	SMS_DISPATCH: false,

	/** Multi-org coalition networks: parent/child orgs, shared supporter pools */
	NETWORKS: true,

	/** Legislative intelligence loop: bill monitoring, alerts, scorecards */
	LEGISLATION: true,

	/**
	 * Legislative-intelligence PRODUCERS are live. Distinct from LEGISLATION, which
	 * only gates the route's existence — bill SEARCH + WATCH are real. But the
	 * producers behind relevance, vote-alignment scoring, and alerts are stubs with
	 * zero callers (trackVotes, the bill topicEmbedding writer, createAlert), so
	 * those surfaces produce nothing. They gate on THIS flag and show an explicit
	 * "not yet available" state instead of an empty-as-working list, until E1 ships.
	 */
	LEGISLATIVE_INTELLIGENCE_LIVE: false,

	/** Accountability receipts: proof-weighted decision-maker tracking */
	ACCOUNTABILITY: true,

	/** Shadow Atlas client-side verification: browser computes district commitment (no plaintext to server) */
	SHADOW_ATLAS_VERIFICATION: forceShadowAtlasOff ? false : true,

	/**
	 * Profile-page basemap layer beneath the district + privacy-hex SVG.
	 * When false: tile-less SVG only (abstract polygons on white).
	 * When true: a pre-rendered per-district raster is fetched from the same atlas
	 * host as the GeoJSON boundary and mounted beneath the SVG paths. Enabled
	 * once the publish pipeline produced the assets for every published district.
	 */
	PROFILE_BASEMAP: true,

	/** Agentic delegation: AI proxy civic actions under user-defined policy constraints (Tier 3+) */
	DELEGATION: false,

	/** Send/engagement counters: "X acted on this", district coverage, open/click metrics */
	ENGAGEMENT_METRICS: false,

	/** Passkey (WebAuthn) sign-in option on the login screen */
	PASSKEY: false,

	/**
	 * mDL over OpenID4VP via the W3C Digital Credentials API.
	 *
	 * This lane is capability-detected by browser protocol support. The current
	 * browser-mediated protocol identifier is `openid4vp-v1-signed`.
	 */
	MDL_ANDROID_OID4VP: true,

	/**
	 * Raw ISO mdoc (`org-iso-mdoc`) lane.
	 *
	 * The verifier is ready: this lane was lifted to the same
	 * SessionTranscript-binding floor as the DC API path via the shared
	 * `verifyMdocDeviceAuth` helper — DeviceMAC / DeviceSignature are verified
	 * per ISO 18013-5 §9.1.3 on both lanes, and capture-replay is bounded by
	 * the OID4VP nonce lifetime. Kept false until the mDL launch is ready;
	 * flip on deliberately alongside the umbrella MDL flag.
	 */
	MDL_MDOC: false,

	/**
	 * iOS/Safari same-device lane. Keep false until `org-iso-mdoc` verifier
	 * support is ready and browser capability checks pass in real-device smoke.
	 */
	MDL_IOS: false,

	/**
	 * Legacy alias retained only for old string-search tests and migration
	 * comments. New code must use the protocol/platform flags above.
	 */
	MDL: false,

	/**
	 *  V2 three-tree proof generation (F1 closure).
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

export const OPENID4VP_DC_API_PROTOCOL = 'openid4vp-v1-signed';

export type MdlProtocol = typeof OPENID4VP_DC_API_PROTOCOL | 'org-iso-mdoc';

export function isOpenId4VpProtocol(protocol: string): boolean {
	return protocol === OPENID4VP_DC_API_PROTOCOL;
}

export function isMdlProtocolEnabled(protocol: string): boolean {
	if (protocol === OPENID4VP_DC_API_PROTOCOL) return FEATURES.MDL_ANDROID_OID4VP;
	if (protocol === 'org-iso-mdoc') return FEATURES.MDL_MDOC;
	return false;
}

export function isAnyMdlProtocolEnabled(): boolean {
	return FEATURES.MDL_ANDROID_OID4VP || FEATURES.MDL_MDOC;
}
