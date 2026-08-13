/**
 * Single source of truth for tier-display copy.
 *
 * Every surface that names a verification class reads this module:
 *   - the attestation carried by outgoing mail (mailto footers, both the
 *     congressional relay lane and the direct lanes)
 *   - the send preview the sender reads before the mail leaves
 *   - the /v/[hash] verification page (public, staffer-facing)
 *
 * Inconsistency between surfaces is itself a trust signal. A staffer who sees
 * one class in the email and a weaker one on /v/[hash] is justifiably
 * suspicious; a sender shown a stronger class than the one that actually left
 * has been lied to. One module composes the copy so honesty holds in both
 * directions.
 *
 * Honesty principles:
 *   - mDL/digital-credentials-api → "Address-Resolved Constituent" (postal+
 *     city+state attested by wallet, geocoded to district)
 *   - civic_api → "Self-Reported Constituent" (user-typed address, Census
 *     geocoder)
 *   - postal → "Postal-Verified Constituent" (postcard return)
 *   - shadow_atlas → "Address-Resolved Constituent" (commitment-only path,
 *     same epistemic class as mDL: client computed cellId from coordinates)
 *   - unknown / undefined → "Verified Constituent" (legacy fallback)
 *
 * "Unknown" is a first-class state for legacy rows that predate the
 * trust-context fields. Callers MUST distinguish unknown (display "—" or
 * omit) from "false/clean" (assert positively that the property is absent).
 */

export type VerificationMethod =
	| 'mdl'
	| 'digital-credentials-api'
	| 'civic_api'
	| 'postal'
	| 'shadow_atlas'
	| string
	| null
	| undefined;

export interface TierDisplayInput {
	/** Verification method captured on the credential. Both 'mdl' and
	 *  'digital-credentials-api' map to the mDL class — they are different
	 *  writers (Convex finalizeMdlVerification vs client IdentityVerificationFlow)
	 *  for the same epistemic claim. */
	method: VerificationMethod;
	/** trustTier snapshot at issuance (H1). Optional — legacy rows are null. */
	trustTier?: number | null;
	/** G2 boundary-cell mark (H1). Optional. */
	cellStraddles?: boolean | null;
	/** G6 atlas version at issuance (H1). Optional. */
	atlasVersion?: string | null;
	/** Current atlas version (compare against atlasVersion for drift). Optional. */
	currentAtlasVersion?: string | null;
}

export interface TierDisplay {
	/** Headline label shown most prominently. */
	headline: string;
	/** One-sentence description shown under the headline. */
	description: string;
	/** "mdl" | "self-reported" | "postal" | "unknown". Drives color choice
	 *  upstream — green for mdl, amber for self-reported, slate for unknown. */
	confidenceClass: 'mdl' | 'self-reported' | 'postal' | 'unknown';
	/** True when atlasVersion is older than currentAtlasVersion. */
	atlasDrift: boolean;
	/** Atlas-drift sentence to render below the description, when atlasDrift. */
	atlasDriftLabel: string | null;
	/** True when cellStraddles=true — caller should also render the H2-style
	 *  boundary banner copy elsewhere. */
	isBoundaryCell: boolean;
}

const MDL_METHODS = new Set(['mdl', 'digital-credentials-api']);

export function isMdlMethod(method: VerificationMethod): boolean {
	return typeof method === 'string' && MDL_METHODS.has(method);
}

/**
 * Produce a coherent tier-display payload for a credential.
 *
 * The returned `confidenceClass` lets callers pick visual tone (green/amber)
 * without re-deciding the epistemic question. `atlasDrift` and
 * `isBoundaryCell` are independent flags — drift is a freshness concern,
 * boundary is a precision concern, both can fire together.
 */
export function formatTierDisplay(input: TierDisplayInput): TierDisplay {
	const { method, atlasVersion, currentAtlasVersion, cellStraddles } = input;

	const atlasDrift =
		typeof atlasVersion === 'string' &&
		typeof currentAtlasVersion === 'string' &&
		atlasVersion !== currentAtlasVersion;

	const atlasDriftLabel = atlasDrift
		? `Verified against an earlier atlas (${atlasVersion}); current is ${currentAtlasVersion}.`
		: null;

	const isBoundaryCell = cellStraddles === true;

	if (isMdlMethod(method)) {
		return {
			headline: 'Address-Resolved Constituent',
			description:
				'Postal code, city, and state were disclosed from a state-issued credential and geocoded to a congressional district. The credential does not attest to a current street-level address.',
			confidenceClass: 'mdl',
			atlasDrift,
			atlasDriftLabel,
			isBoundaryCell,
		};
	}

	if (method === 'civic_api') {
		return {
			headline: 'Self-Reported Constituent',
			description:
				'A user-typed address was geocoded by the Census Geocoder. There is no third-party credential signature behind this verification.',
			confidenceClass: 'self-reported',
			atlasDrift,
			atlasDriftLabel,
			isBoundaryCell,
		};
	}

	if (method === 'postal') {
		return {
			headline: 'Postal-Verified Constituent',
			description:
				'A postcard was sent to the address and returned with the activation code, confirming control of the mailbox.',
			confidenceClass: 'postal',
			atlasDrift,
			atlasDriftLabel,
			isBoundaryCell,
		};
	}

	if (method === 'shadow_atlas') {
		return {
			headline: 'Address-Resolved Constituent',
			description:
				'The user-supplied address was geocoded client-side via the Shadow Atlas index; only the district commitment was disclosed to the server.',
			confidenceClass: 'mdl',
			atlasDrift,
			atlasDriftLabel,
			isBoundaryCell,
		};
	}

	return {
		headline: 'Verified Constituent',
		description: 'Verification method not specified for this credential.',
		confidenceClass: 'unknown',
		atlasDrift,
		atlasDriftLabel,
		isBoundaryCell,
	};
}

/**
 * Short label suitable for an email-footer line. Keeps the same epistemic
 * distinctions as formatTierDisplay but compresses to a single phrase.
 */
export function formatTierEmailFooter(input: TierDisplayInput): string {
	const display = formatTierDisplay(input);
	if (display.confidenceClass === 'mdl') {
		// Both actual-mDL and shadow_atlas share confidenceClass 'mdl' (same
		// "Address-Resolved Constituent" epistemic class). Only an actual mDL
		// method may claim the "(mDL)" government-credential protocol suffix —
		// shadow_atlas is client-side index resolution, not a state credential.
		// Asserting "(mDL)" for shadow_atlas would be a false government-ID claim
		// and would diverge from /v/[hash], which shows the bare headline for both.
		return isMdlMethod(input.method)
			? 'Address-resolved constituent (mDL)'
			: 'Address-resolved constituent';
	}
	if (display.confidenceClass === 'self-reported')
		return 'Self-reported constituent (Census geocoder)';
	if (display.confidenceClass === 'postal')
		return 'Postal-verified constituent';
	return 'Verified constituent';
}

export interface AttestationInput {
	/** Trust tier at send time. Null/undefined is read as tier 0. */
	trustTier: number | null | undefined;
	/** Verification method captured on the credential — decides the label class. */
	method: VerificationMethod;
	/** District code, when the surface has one loaded. Optional suffix only. */
	districtCode?: string | null;
	/** Active district credential hash — the record /v/[hash] resolves. */
	credentialHash?: string | null;
}

export interface Attestation {
	/** The one phrase the sender and the recipient both read. */
	line: string | null;
	/** The sender offering verifiability of themselves, never an instruction. */
	verifyLine: string | null;
	/** `line` + `verifyLine`, newline-joined — the whole attestation zone. */
	block: string | null;
}

/**
 * Compose the sender's attestation. This is the ONLY composer: the preview, the
 * direct mailto, the batch mailto and the congressional relay footer all read
 * its result, so what a sender is shown is byte-identical to what the recipient
 * receives. A surface that re-derives the copy can drift into overclaiming.
 *
 * Line 1 stays a third-person NOUN PHRASE — it is consumed mid-sentence
 * elsewhere ("Your message carried <line>."), where a first-person clause would
 * read as a person mismatch.
 *
 * The district code is an OPTIONAL SUFFIX, never a gate: a tier-2 sender whose
 * district code has not loaded still reads the method label, never upgraded past
 * what the method proves.
 *
 * Below tier 2 there is nothing to claim. Tier 1 is email/OAuth possession — an
 * anti-sybil and cost-control fact about an account, not civic proof about a
 * person — so every tier below 2 composes to null. A hollow footer still reads
 * to a recipient as a verification claim; an absent one honestly reads as
 * absence.
 */
export function buildAttestation(input: AttestationInput): Attestation {
	const tier = input.trustTier ?? 0;

	let line: string | null = null;
	let verifyLine: string | null = null;

	if (tier >= 2) {
		line = formatTierEmailFooter({ method: input.method, trustTier: tier });
		if (typeof input.districtCode === 'string' && input.districtCode.trim() !== '') {
			line = `${line} · ${input.districtCode}`;
		}
		// The verify URL is gated identically to the constituent label it backs:
		// "Confirm I'm a real constituent" is itself a constituent claim. Emitted
		// only when the hash resolves — the active credential hash is the record
		// /v/[hash] looks up, and a truncated user id 404s.
		verifyLine = input.credentialHash
			? `Confirm I'm a real constituent: https://commons.email/v/${input.credentialHash}`
			: null;
	}

	const block = line === null ? null : [line, verifyLine].filter(Boolean).join('\n');

	return { line, verifyLine, block };
}
