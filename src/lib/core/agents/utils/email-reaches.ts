export type EmailReachesClaim = 'person' | 'seat' | 'general';

/** Fail closed: anything unrecognized becomes 'general', the weakest branch. */
export function normalizeReachesClaim(raw: unknown): EmailReachesClaim {
	if (typeof raw !== 'string') return 'general';

	const normalized = raw.trim().toLowerCase();
	if (normalized === 'person' || normalized === 'seat') return normalized;
	return 'general';
}

/**
 * A 'seat' claim survives only if its office/function label byte-appears
 * (case-insensitive) in the page text that grounded the email. Otherwise it
 * is downgraded to 'general'. A 'person' claim is passed through UNVALIDATED —
 * corroborating a person-to-address binding is a separate concern.
 */
export function resolveEmailReachesClaim(input: {
	raw: unknown;
	rawLabel: unknown;
	groundedPageText: string | undefined;
}): { claim: EmailReachesClaim; label?: string } {
	const claim = normalizeReachesClaim(input.raw);
	if (claim === 'person') return { claim };
	if (claim !== 'seat') return { claim: 'general' };

	if (typeof input.rawLabel !== 'string') return { claim: 'general' };
	const label = input.rawLabel.trim();
	if (label.length === 0 || label.length > 160) return { claim: 'general' };
	if (typeof input.groundedPageText !== 'string' || input.groundedPageText.trim().length === 0) {
		return { claim: 'general' };
	}
	if (!input.groundedPageText.toLowerCase().includes(label.toLowerCase())) {
		return { claim: 'general' };
	}

	return { claim: 'seat', label };
}
