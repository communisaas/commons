/**
 * Send-time fetch of the mailbox-addressed do-not-contact links.
 *
 * Every lane that assembles a direct `mailto:` asks this function for the
 * suppression URLs its recipients are owed. There is one call-site abstraction
 * on purpose: a second inline `fetch('/api/do-not-contact/links')` is a second
 * failure policy, and the lane that gets it wrong ships a message with no route
 * off the platform.
 *
 * One failure policy, stated here: a direct message never ships when its
 * suppression links were not completely observed. Timeout/network/protocol
 * failures are BLOCKED facts; a completed response missing a requested link is
 * ABSENT. Neither is erased into `{}` and mistaken for a complete empty roster.
 *
 * The map is keyed by the address trimmed and lowercased — the same
 * normalization the global email hash applies — because that is what
 * `buildSuppressionZone` and `generateMailtoUrl` look the URL up by.
 */

import { buildSuppressionZone } from '$lib/services/emailService';
import { absent, blocked, present, type Fact } from '$lib/core/fact';

export type DoNotContactLinks = Readonly<Record<string, string>>;

/** The send remains recoverable, but never waits forever on the link service. */
export const DO_NOT_CONTACT_LINK_TIMEOUT_MS = 5_000;

const LINKS_UNAVAILABLE =
	'Do-not-contact links are temporarily unavailable. Please try sending again in a moment.';
const LINKS_TIMED_OUT = 'Do-not-contact links timed out. Please try sending again in a moment.';
const LINKS_INCOMPLETE =
	'A do-not-contact link could not be prepared for every recipient. Please try sending again.';
const LINKS_ROSTER_TOO_LARGE =
	'This message has too many recipients to prepare do-not-contact links safely.';

function normalizeRequestedAddresses(emails: readonly string[]): string[] {
	const seen = new Set<string>();
	for (const email of emails) {
		const normalized = email.trim().toLowerCase();
		if (normalized) seen.add(normalized);
	}
	return [...seen];
}

/** Sender-facing explanation without collapsing the underlying fact state. */
export function describeDoNotContactFailure(fact: Fact<unknown>): string {
	switch (fact.state) {
		case 'blocked':
			return fact.why;
		case 'withheld':
			return fact.why;
		case 'absent':
			return LINKS_INCOMPLETE;
		case 'present':
			return '';
	}
}

/**
 * Fetch suppression URLs for a published template's recipients.
 *
 * @param slug - Public template slug. The server derives the roster from it; the
 *   client cannot name an address the template does not already publish.
 * @param emails - Optional narrowing. Omit it when the composer resolves its own
 *   recipients and the whole published roster is wanted.
 */
export async function fetchDoNotContactUrls(
	slug: string,
	emails?: readonly string[]
): Promise<Fact<DoNotContactLinks>> {
	const requested = emails ? normalizeRequestedAddresses(emails) : null;
	if (requested?.length === 0) return absent();

	const signal = AbortSignal.timeout(DO_NOT_CONTACT_LINK_TIMEOUT_MS);
	try {
		const response = await fetch('/api/do-not-contact/links', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(requested ? { slug, emails: requested } : { slug }),
			signal
		});
		if (!response.ok) {
			return blocked(response.status === 413 ? LINKS_ROSTER_TOO_LARGE : LINKS_UNAVAILABLE);
		}

		const result = (await response.json().catch(() => null)) as { links?: unknown } | null;
		const links = result?.links;
		if (links === null || typeof links !== 'object' || Array.isArray(links)) {
			return blocked(LINKS_UNAVAILABLE);
		}

		const urls: Record<string, string> = {};
		for (const [email, url] of Object.entries(links as Record<string, unknown>)) {
			if (typeof url === 'string' && url.length > 0) urls[email] = url;
		}

		// A 200 can intentionally hide whether a named address is on the public
		// roster. At the send seam, however, every actual recipient must have a URL.
		// A partial map is therefore observed ABSENCE, never a complete present fact.
		if (requested?.some((email) => !urls[email])) return absent();
		return present(urls);
	} catch {
		return blocked(signal.aborted ? LINKS_TIMED_OUT : LINKS_UNAVAILABLE);
	}
}

/**
 * Fetch the links for a set of addresses and hand the shared composer its
 * suppression zone, in one step.
 *
 * A surface that assembles its own `mailto:` calls this rather than the fetch
 * directly: the addresses a message carries and the lines it renders are then
 * the same list by construction, and no lane can obtain the URLs and then choose
 * to withhold them. If any address has no URL, this returns an ABSENT fact and
 * the calling send seam refuses assembly; it never emits a partial block.
 */
export async function buildDoNotContactZone(
	slug: string,
	addresses: readonly string[]
): Promise<Fact<string>> {
	const links = await fetchDoNotContactUrls(slug, addresses);
	if (links.state !== 'present') return links;

	const zone = buildSuppressionZone(
		addresses.map((email) => ({
			email,
			doNotContactUrl: links.value[email.trim().toLowerCase()] ?? null
		}))
	);
	return zone ? present(zone) : absent();
}
