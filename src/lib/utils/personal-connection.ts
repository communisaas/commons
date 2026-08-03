/**
 * The send-time gate on the sender's own words.
 *
 * Every lane that can hand a message to a mail app asks this function first.
 * There is one call site abstraction on purpose: a second inline
 * `fetch('/api/moderation/personalization')` is a second failure policy, and the
 * lane that gets it wrong ships unmoderated text to a real official.
 */

export type PersonalConnectionModeration =
	| { approved: true }
	| { approved: false; reason: string };

const NOT_APPROVED = 'Personalization text was not approved. Please edit and try again.';
const UNAVAILABLE = 'Content moderation is temporarily unavailable. Please try again in a moment.';
const SIGN_IN_REQUIRED =
	'Sign in to include your own words in this message. You can still send the letter as written.';

/**
 * Moderate the sender's personal connection text before it can reach a `mailto:`.
 *
 * Empty text has no provider-visible surface and needs no round trip — it is
 * approved locally with zero network calls. Anything else must come back
 * explicitly approved.
 */
export async function moderatePersonalConnection(
	text: string
): Promise<PersonalConnectionModeration> {
	const typed = text?.trim();
	if (!typed) return { approved: true };

	try {
		const response = await fetch('/api/moderation/personalization', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ text: typed })
		});

		// The endpoint is authenticated, so a guest can never be approved. Say why
		// rather than showing them a generic rejection they cannot act on.
		if (response.status === 401) {
			return { approved: false, reason: SIGN_IN_REQUIRED };
		}

		// A rejection is returned as HTTP 400 carrying `approved: false`, so status
		// alone is not the signal — the body is. Read it, and treat anything that is
		// not an explicit approval as a refusal.
		const result = (await response.json().catch(() => null)) as {
			approved?: unknown;
			summary?: unknown;
		} | null;

		if (result?.approved === true) return { approved: true };

		const summary = typeof result?.summary === 'string' ? result.summary : '';
		return {
			approved: false,
			reason: summary || (response.ok ? NOT_APPROVED : UNAVAILABLE)
		};
	} catch {
		// This is a delivery safety boundary. Provider or admission failure must
		// never turn repeated clicks into an unmoderated send.
		return { approved: false, reason: UNAVAILABLE };
	}
}
