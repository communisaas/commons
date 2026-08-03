/**
 * Cross-runtime recipient roster arithmetic.
 *
 * One module answers one question: given a template's `recipient_config` blob,
 * how many recipients does it describe and which addresses are they? The count
 * a sender is shown on a card and the address list that becomes the real
 * mailto `To:` line derive from here, so a card can never advertise a number
 * the send path does not deliver.
 *
 * It deliberately uses only web-standard APIs and imports nothing, so the
 * SvelteKit browser/server boundary and the Convex function boundary share one
 * identical implementation.
 */

/**
 * Every persisted array field that can carry recipients. Authoring stores write
 * AI-resolved `decisionMakers` and manual `customRecipients` separately, while
 * `emails`/`recipientEmails` are commonly a denormalized union of both and
 * `recipients` is the alternative multi-target shape. A new recipient-carrying
 * field is added here once, not in each predicate below.
 */
const RECIPIENT_ROSTER_FIELDS = [
	'recipients',
	'decisionMakers',
	'customRecipients',
	'emails',
	'recipientEmails'
] as const;

/**
 * Normalize an unknown `recipient_config` — a stored object or a JSON string —
 * into a plain record. Anything unparseable, primitive, or array-shaped yields
 * an empty record.
 */
export function parseRecipientConfigObject(value: unknown): Record<string, unknown> {
	let candidate = value;
	if (typeof candidate === 'string') {
		try {
			candidate = JSON.parse(candidate);
		} catch {
			return {};
		}
	}
	if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
		return candidate as Record<string, unknown>;
	}
	return {};
}

/**
 * The addresses a `recipient_config` actually reaches: the union across
 * `recipients`, `decisionMakers`, `customRecipients`, `emails` and
 * `recipientEmails` plus a top-level `email`, trimmed, empties dropped,
 * deduplicated, in first-seen order.
 *
 * Union rather than first-non-empty-wins: the build-side writer already
 * composes `recipientEmails` from decision-makers plus custom recipients plus
 * the congressional relay, so the union never resurrects a recipient the author
 * deselected — it only recovers addresses a narrower read would silently drop.
 */
export function recipientRosterFromConfig(value: unknown): string[] {
	const config = parseRecipientConfigObject(value);
	const emails: string[] = [];
	for (const field of RECIPIENT_ROSTER_FIELDS) {
		const entries = config[field];
		if (!Array.isArray(entries)) continue;
		for (const entry of entries) {
			if (typeof entry === 'string') emails.push(entry);
			else if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
				const email = (entry as { email?: unknown }).email;
				if (typeof email === 'string') emails.push(email);
			}
		}
	}
	if (typeof config.email === 'string') emails.push(config.email);
	// A roster becomes a mailto `To:` line, so a non-address must never reach it.
	// Decision-maker records carry `email` as free text and legitimately hold
	// instructions like "use the web form" when no address was found; the send path
	// downstream validates only non-emptiness, so this is the boundary that has to
	// tell an address from a note. Membership, not mere presence.
	return [
		...new Set(
			emails.map((email) => email.trim()).filter((email) => email.length > 0 && email.includes('@'))
		)
	];
}

/**
 * How many recipients a `recipient_config` claims to reach.
 *
 * The largest credible roster without double-counting compatibility arrays:
 * the alternative `recipients` shape, the structured authoring shape
 * (`decisionMakers` + `customRecipients`), or the deduplicated address union —
 * whichever is largest. Emailless decision-makers therefore count as intent
 * even though they contribute no address, which is the one place this can
 * exceed `recipientRosterFromConfig(...).length`.
 */
export function recipientIntentCount(value: unknown): number {
	const config = parseRecipientConfigObject(value);
	const arrayLength = (field: (typeof RECIPIENT_ROSTER_FIELDS)[number]): number =>
		Array.isArray(config[field]) ? (config[field] as unknown[]).length : 0;
	const structuredAuthoringCount = arrayLength('decisionMakers') + arrayLength('customRecipients');
	return Math.max(
		arrayLength('recipients'),
		structuredAuthoringCount,
		recipientRosterFromConfig(config).length
	);
}

/**
 * How many recipients an ANONYMOUS public detail may advertise.
 *
 * Deliberately narrower than `recipientIntentCount`: it counts only the
 * provenance-verified roster the public detail projection was able to publish,
 * never the private authoring intent. The public card must never advertise a
 * recipient the anonymous detail cannot actually address, so this stays at or
 * below the private config's intent count and is never collapsed into it.
 */
export function publishableRosterCount(publicRecipientConfig: {
	decisionMakers?: readonly unknown[];
	[field: string]: unknown;
}): number {
	return publicRecipientConfig.decisionMakers?.length ?? 0;
}
