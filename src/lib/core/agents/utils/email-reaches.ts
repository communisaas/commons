export type EmailReachesClaim = 'person' | 'seat' | 'general';

/** Fail closed: anything unrecognized becomes 'general', the weakest branch. */
export function normalizeReachesClaim(raw: unknown): EmailReachesClaim {
	if (typeof raw !== 'string') return 'general';

	const normalized = raw.trim().toLowerCase();
	if (normalized === 'person' || normalized === 'seat') return normalized;
	return 'general';
}

/**
 * The hard breaks that end a candidate string: LF (U+000A), VT (U+000B),
 * FF (U+000C), CR (U+000D), NEL (U+0085), LS (U+2028), PS (U+2029).
 *
 * VT and FF are separators real pages emit between list items, and while they
 * were missing from this set they were live glue paths: two adjacent menu
 * entries divided by one of them folded into a single line and could satisfy
 * containment for a label the page never printed as a phrase.
 *
 * NARROWED, not deleted. This was exported so the attestation issuer could
 * re-check a label it had signed. That issuer no longer carries a reach term, so
 * the only consumer left is `foldLinesForContainment` below — and an export with
 * no importer is an invitation to grow one. The constant is load-bearing and
 * unchanged; only its visibility moved.
 */
const HARD_BREAK = /[\u000a\u000b\u000c\u000d\u0085\u2028\u2029]/u;

/**
 * The ceiling on a seat label. Defined once, here, at the producer — this is
 * the only place a label is admitted.
 *
 * NARROWED for the same reason as `HARD_BREAK`: it was exported so a downstream
 * signer could restate the bound rather than duplicate the number, and there is
 * no longer a downstream signer.
 */
const EMAIL_REACHES_LABEL_MAX_LENGTH = 160;

/** Every Unicode whitespace run, including the ones `\s` alone can leave behind. */
const INTRA_LINE_WHITESPACE_RUN = /[\s\u00a0\u180e\u202f\u205f\u3000]+/gu;

/**
 * Comparison-only fold, applied one line at a time. Within a line, two
 * spellings of the same office label — one composed, one decomposed, one
 * spaced with a tab or a non-breaking space — must compare equal, or a real
 * label silently downgrades. A hard break ends a candidate string: the fold
 * never reaches across one, so two menu entries separated by any code point in
 * `HARD_BREAK` cannot be glued into a label no page ever printed. That
 * guarantee is exactly as wide as `HARD_BREAK` and no wider — a separator this
 * module does not recognize is a separator it will fold through, which is why
 * the set is enumerated rather than approximated by `\s`. The cost is
 * deliberate — a label a page broke mid-phrase is unverifiable here, because
 * telling that apart from a navigation list takes a heuristic this module
 * refuses to carry. The folded form is never emitted: the label is signed
 * downstream, so what leaves this module is what the page said.
 */
function foldLinesForContainment(value: string): string[] {
	return value
		.normalize('NFC')
		.split(HARD_BREAK)
		.map((line) => line.replace(INTRA_LINE_WHITESPACE_RUN, ' ').trim().toLocaleLowerCase())
		.filter((line) => line.length > 0);
}

/**
 * A 'seat' claim survives only if it has a public grounding basis (the address
 * was read off a page this run) AND its office/function label appears in that
 * page text under the comparison fold. Otherwise it is downgraded to 'general'.
 * A 'person' claim is passed through UNVALIDATED — corroborating a
 * person-to-address binding is a separate concern.
 */
export function resolveEmailReachesClaim(input: {
	raw: unknown;
	rawLabel: unknown;
	groundedPageText: string | undefined;
	/** True only when a `publicEmailGrounding` basis is emitted alongside this claim. */
	hasPublicGroundingBasis: boolean;
}): { claim: EmailReachesClaim; label?: string } {
	const claim = normalizeReachesClaim(input.raw);
	if (claim === 'person') return { claim };
	if (claim !== 'seat') return { claim: 'general' };

	// A seat claim without its basis is an assertion about a page nobody read.
	if (input.hasPublicGroundingBasis !== true) return { claim: 'general' };

	if (typeof input.rawLabel !== 'string') return { claim: 'general' };
	const label = input.rawLabel.trim();
	if (label.length === 0 || label.length > EMAIL_REACHES_LABEL_MAX_LENGTH) {
		return { claim: 'general' };
	}
	if (typeof input.groundedPageText !== 'string' || input.groundedPageText.trim().length === 0) {
		return { claim: 'general' };
	}

	const labelLines = foldLinesForContainment(label);
	// A label carrying its own hard break cannot smuggle one back into the match.
	if (labelLines.length !== 1) return { claim: 'general' };

	const foldedLabel = labelLines[0];
	// A one-character label is contained by almost any page; that is not evidence.
	if (foldedLabel.length < 2) return { claim: 'general' };
	if (!foldLinesForContainment(input.groundedPageText).some((line) => line.includes(foldedLabel))) {
		return { claim: 'general' };
	}

	return { claim: 'seat', label };
}
