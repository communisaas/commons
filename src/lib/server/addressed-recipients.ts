/**
 * The addressed set: which published mailboxes a send-time request actually
 * carries, and the one-directional intersection with what the artifact publishes.
 *
 * A caller-supplied address may only select routes the published roster already
 * contains; no branch here can add one. This intersection is a binding check,
 * not policy evidence: the endpoint separately applies the full published
 * roster as a strict floor, so removing a published person cannot unlock a
 * permissive verdict.
 *
 * `normalizeAddress` is a deliberate TWIN of the normalizer at
 * `src/routes/api/do-not-contact/links/+server.ts:57-61` (trim + lowercase +
 * must contain `@` + 256-char cap). Drift between the two is a silent policy
 * widening: the same string would suppress one mailbox and moderate for another.
 * They must be changed together, and this module does not import into that route
 * because that file is owned elsewhere this wave.
 */

import type { AudienceRoute } from '$lib/core/server/moderation/audience';

/** Mirrors `EMAIL_MAX_CHARS` at `src/routes/api/do-not-contact/links/+server.ts:40`. */
export const ADDRESSED_EMAIL_MAX_CHARS = 256;

/**
 * Trim + lowercase, capped, and only a plausible mailbox survives. Transcribed
 * from `src/routes/api/do-not-contact/links/+server.ts:57-61`. An empty string
 * means "not a mailbox" — callers here treat that as a refusal, not a skip.
 */
export function normalizeAddress(value: unknown): string {
	if (typeof value !== 'string' || value.length > ADDRESSED_EMAIL_MAX_CHARS) return '';
	const normalized = value.trim().toLowerCase();
	return normalized.includes('@') ? normalized : '';
}

/** Either a complete addressed set, or nothing — never a partial one. */
export type AddressedRecipientsResult = { ok: true; addresses: string[] } | { ok: false };

/**
 * Read the caller's addressed set STRICTLY.
 *
 * Absent, not an array, empty, or ANY entry that fails to normalize (non-string,
 * over the cap, no `@`) refuses the whole set. The do-not-contact precedent
 * silently drops bad entries, and that is exactly wrong here: dropping one
 * over-long address while the rest match the published roster would let the
 * survivors buy `institutional` for a send that also addresses a mailbox the
 * artifact never published. Survivors are deduplicated in first-seen order.
 */
export function normalizeAddressedRecipients(value: unknown): AddressedRecipientsResult {
	if (!Array.isArray(value) || value.length === 0) return { ok: false };

	const addresses = new Set<string>();
	for (const entry of value) {
		const normalized = normalizeAddress(entry);
		if (!normalized) return { ok: false };
		addresses.add(normalized);
	}
	return { ok: true, addresses: [...addresses] };
}

/** Either every addressed mailbox is published, or the intersection refuses. */
export type AddressedRoutesResult = { ok: true; routes: AudienceRoute[] } | { ok: false };

/**
 * Intersect the addressed set with the published roster — one-directionally.
 *
 * Every addressed address must be present. One absentee refuses the whole set
 * rather than classifying the survivors, because the survivors would then be
 * choosing the policy for a send that also reaches the mailbox nobody published.
 */
export function intersectAddressed(
	addressed: ReadonlyArray<string>,
	roster: ReadonlyMap<string, AudienceRoute>
): AddressedRoutesResult {
	const routes: AudienceRoute[] = [];
	for (const address of addressed) {
		const route = roster.get(address);
		if (!route) return { ok: false };
		routes.push(route);
	}
	return { ok: true, routes };
}
