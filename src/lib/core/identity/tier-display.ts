/**
 * H6 — Single source of truth for tier-display copy.
 *
 * Three surfaces today render verification-tier copy:
 *   - AttestationFooter.svelte (in-app, shown above message body)
 *   - emailService.ts (mailto footer)
 *   - /v/[hash] verification page (public, staffer-facing)
 *
 * Pre-H6 each had its own phrasing:
 *   - AttestationFooter: "Verified resident, {district}"
 *   - email: tier ≥ 3 → "Verified sender · Gov ID"; ≥ 2 → "Verified resident"
 *   - /v/[hash]: method-conditional ("Address-Resolved" / "Self-Reported")
 *
 * Inconsistency between surfaces is itself a trust signal — a staffer who
 * sees "Verified resident" in the email and "Self-Reported Constituent" on
 * the /v/[hash] page is justifiably suspicious. This helper unifies the copy
 * so honesty is consistent.
 *
 * Honesty principles (post-G5/G5r/H6):
 *   - mDL/digital-credentials-api → "Address-Resolved Constituent" (postal+
 *     city+state attested by wallet, geocoded to district)
 *   - civic_api → "Self-Reported Constituent" (user-typed address, Census
 *     geocoder)
 *   - postal → "Postal-Verified Constituent" (postcard return)
 *   - shadow_atlas → "Address-Resolved Constituent" (commitment-only path,
 *     same epistemic class as mDL: client computed cellId from coordinates)
 *   - unknown / undefined → "Verified Constituent" (legacy fallback)
 *
 * "Unknown" is a first-class state for legacy rows that predate H1's
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
	if (display.confidenceClass === 'mdl') return 'Address-resolved constituent (mDL)';
	if (display.confidenceClass === 'self-reported')
		return 'Self-reported constituent (Census geocoder)';
	if (display.confidenceClass === 'postal')
		return 'Postal-verified constituent';
	return 'Verified constituent';
}
