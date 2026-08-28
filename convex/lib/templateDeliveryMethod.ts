/**
 * The vocabulary of the persisted `templates.deliveryMethod` column.
 *
 * This module answers exactly two questions: what may be STORED in that column,
 * and whether a stored value means congressional delivery. The column is closed
 * to this set by the `v.union(...)` on `templates.deliveryMethod` in
 * `convex/schema.ts` and by the write-time guard in `convex/templates.ts`, so
 * every reader asking "is this congressional?" gets one answer.
 *
 * Adding a delivery method means editing the table below and the matching
 * `v.union(...)` in the schema — nothing else. A value added to one but not the
 * other is a red test, not a silent divergence.
 *
 * Nothing is imported here on purpose: the file loads unchanged in the Convex
 * runtime, in the SvelteKit server, and in the browser bundle, which is what
 * lets one policy be enforced at every boundary instead of three copies of it.
 *
 * Three same-named vocabularies are DIFFERENT axes and deliberately stay where
 * they are:
 *   - `EmailFlowResult.deliveryMethod` in `src/lib/services/emailService.ts`
 *     records how ONE send actually left the machine ('cwc' | 'mailto' |
 *     'email_attested'). That is a per-send outcome, not an authoring choice.
 *   - The analytics union in `src/lib/types/analytics/metrics.ts` is a reporting
 *     dimension whose members exist to slice charts.
 *   - The per-delivery columns in `convex/schema.ts` (the congressional delivery
 *     record and the per-recipient delivery rows) record what happened to one
 *     recipient, including states like 'recorded' and 'mailto_confirmed' that a
 *     template could never be authored as.
 *
 * Also deliberately out of scope: the per-member route in
 * `src/lib/utils/landscapeMerge.ts` (keyed on `member.cwcCode`) and the
 * `recipientConfig.cwcRouting` flag. Those answer "how do I reach THIS
 * recipient", which is a different question with a different owner. Keeping it
 * out is what keeps this module single-purpose.
 */

/** Every value the `templates.deliveryMethod` column may hold. */
export const TEMPLATE_DELIVERY_METHODS = ['cwc', 'email'] as const;

export type TemplateDeliveryMethod = (typeof TEMPLATE_DELIVERY_METHODS)[number];

/** Is this a value the column accepts? Rejects non-strings without throwing. */
export function isTemplateDeliveryMethod(value: unknown): value is TemplateDeliveryMethod {
	return typeof value === 'string' && (TEMPLATE_DELIVERY_METHODS as readonly string[]).includes(value);
}

/**
 * Does a stored delivery method mean the message is bound for Congress?
 *
 * Congressional delivery is the only method that carries constituent proof,
 * requires a complete street address, and routes through the Communicating With
 * Congress transport. Every gate that turns on any of those facts asks here.
 */
export function isCongressionalDelivery(value: unknown): boolean {
	return value === 'cwc';
}

/**
 * Which delivery method does an authoring choice store?
 *
 * The authoring UI speaks in channels ("certified", "direct") and in a separate
 * audience toggle for whether Congress is included. Both collapse to one stored
 * value here so two authoring surfaces cannot disagree about what they wrote.
 */
export function templateDeliveryMethodForChannel(
	channelId: string | null | undefined,
	options: { includesCongress?: boolean }
): TemplateDeliveryMethod {
	if (channelId === 'certified' || channelId === 'cwc') return 'cwc';
	return options.includesCongress ? 'cwc' : 'email';
}
