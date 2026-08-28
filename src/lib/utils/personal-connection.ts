/**
 * The send-time gate on the sender's own words.
 *
 * Every lane that can hand a message to a mail app asks this function first.
 * There is one call site abstraction on purpose: a second inline
 * `fetch('/api/moderation/personalization')` is a second failure policy, and the
 * lane that gets it wrong ships unmoderated text to a real official.
 */

declare const REVIEWED: unique symbol;

/**
 * The exact bytes a moderation verdict was issued for.
 *
 * A bare `{ approved: true }` is authority for nothing in particular: the field
 * it was issued against is mutable `$state`, and an edit landing during the
 * round trip means the bytes assembled are not the bytes reviewed. The capsule
 * makes the verdict name its own subject, and the brand makes it unforgeable
 * from a plain string — a lane that tries to hand raw state to a capsule-typed
 * parameter is a compile error, not a review finding.
 *
 * `digest` is `null` when the server sent none or `crypto.subtle` is absent
 * (a non-secure context has no SubtleCrypto). It is defence-in-depth against a
 * substituted response, never the primary control: the snapshot is.
 */
export type ReviewedText = {
	readonly text: string;
	readonly digest: string | null;
	readonly [REVIEWED]: true;
};

/**
 * The only place a capsule comes into existence, deliberately module-private.
 * The cast through `unknown` is the brand's whole cost, paid exactly once.
 */
function mint(text: string, digest: string | null): ReviewedText {
	return { text, digest } as unknown as ReviewedText;
}

export type PersonalConnectionModeration =
	| { approved: true; reviewed: ReviewedText }
	| { approved: false; reason: string };

/** True when `live` is still the text this verdict was issued for. */
export function isCurrent(reviewed: ReviewedText, live: string): boolean {
	return reviewed.text === live;
}

/**
 * Sending the reviewed text after the sender has replaced it would put words
 * they just retracted over their name. Refusing costs one click and says why.
 */
export const SENDER_TEXT_CHANGED_REASON =
	'Your added words changed while they were being checked, so nothing was sent. Press send again to check the new version.';

const HEX_ENCODER = new TextEncoder();

/**
 * SHA-256 of a string as lowercase hex.
 *
 * Exported so the endpoint and this gate hash with one implementation — the two
 * other copies in the tree (`core/identity/credential-store.ts`,
 * `core/identity/mdl-verification.ts`) are module-private to files this change
 * may not touch. Throws where `crypto.subtle` does not exist; every caller here
 * either guards on it first or degrades the result to `null`.
 */
export async function sha256Hex(input: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', HEX_ENCODER.encode(input));
	return Array.from(new Uint8Array(digest))
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('');
}

const NOT_APPROVED = 'Personalization text was not approved. Please edit and try again.';
const UNAVAILABLE = 'Content moderation is temporarily unavailable. Please try again in a moment.';
const SIGN_IN_REQUIRED =
	'Sign in to include your own words in this message. You can still send the letter as written.';
/**
 * The one sentence that may claim an infrastructure failure.
 *
 * It states a fact about our records — we could not read the recipient list —
 * and stops there. It does not promise a retry will help, because the same
 * reason code also covers a slug that is simply absent from the published
 * inventory. It does not say the words went unchecked, because they were
 * checked: under the stricter set that applies wherever a natural person may
 * be reading. Module-private like the three above, so a test that asserts our
 * wording has to own the literal rather than ask us what we render.
 */
const ROSTER_UNREADABLE =
	"We couldn't read this campaign's recipient list, so your words were checked against the stricter rules that apply when a private person may be reading.";

/** The fields this gate reads off a moderation response. */
type ModerationResponseBody = {
	approved?: unknown;
	summary?: unknown;
	contentDigest?: unknown;
	policy?: unknown;
	reason?: unknown;
};

/**
 * True only when the server could not read the artifact the roster lives in.
 *
 * Deliberately narrow. The other `unevaluable` reasons are lane facts or
 * measured judgments, not infrastructure failures: `no-addressed-recipients` is
 * what a lane that hands off before recipients resolve asks for on purpose, and
 * `no-slug`, `addressee-not-published`, `indeterminate-route`,
 * `seat-lexicon-unattested`, `roster-too-large`, `registry-route-names-a-human`
 * and `no-roster` are all things the server looked at and decided. Dressing any
 * of those as infrastructure would be a new false statement replacing an old one.
 */
function rosterWasUnreadable(result: ModerationResponseBody | null): boolean {
	return result?.policy === 'unevaluable' && result?.reason === 'artifact-unavailable';
}

/**
 * A monthly pool resets up to thirty-one days out. Rendering that as a bare time
 * of day tells a person to come back in an hour, so the date shows whenever the
 * reset is not on today's local calendar day.
 */
function formatResetMoment(iso: unknown): string {
	if (typeof iso !== 'string') return 'later';
	const reset = new Date(iso);
	if (Number.isNaN(reset.getTime())) return 'later';
	const now = new Date();
	const sameDay =
		reset.getFullYear() === now.getFullYear() &&
		reset.getMonth() === now.getMonth() &&
		reset.getDate() === now.getDate();
	if (sameDay) {
		return `at ${reset.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
	}
	return `on ${reset.toLocaleString([], {
		month: 'short',
		day: 'numeric',
		hour: 'numeric',
		minute: '2-digit'
	})}`;
}

/**
 * Three different things can empty the free lane, and the person who typed their
 * own words is entitled to know which one. The server already measured it and
 * puts it on the 429 (`llm-cost-protection.ts` `budgetScope` + `resetAt`); this
 * is where it stops being thrown away.
 *
 * `platform` is the shared pool a stranger may have spent none of — it is never
 * phrased as their own consumption. An unrecognised scope (including the
 * server's explicit `blocked`) falls into NEITHER measured branch: nobody
 * measured anything, so nothing is claimed.
 */
function capacityReason(body: { budgetScope?: unknown; resetAt?: unknown } | null): string {
	const resets = `Resets ${formatResetMoment(body?.resetAt)}.`;
	if (body?.budgetScope === 'actor') {
		return `You've used your share of the free moderation pool this month. ${resets} You can still send the letter as written.`;
	}
	if (body?.budgetScope === 'platform') {
		return `The shared free moderation pool is empty until it resets. Nobody's added words can be checked until then. ${resets} You can still send the letter as written.`;
	}
	return `We couldn't confirm how much moderation capacity is left, so your added words were not checked. You can still send the letter as written.`;
}

/**
 * Moderate the sender's personal connection text before it can reach a `mailto:`.
 *
 * Empty text has no provider-visible surface and needs no round trip — it is
 * approved locally with zero network calls. Anything else must come back
 * explicitly approved.
 *
 * The argument is bound to a `const` on entry and every later use reads that
 * const. The capsule carries `submitted` — the RAW argument — because that is
 * what assembly has always placed at the author's placeholder; the digest covers
 * `typed`, because that is what the server hashed. Minting over `typed` would
 * silently change the delivered bytes for anyone whose text has surrounding
 * whitespace, and would make the drift check refuse every one of those sends.
 *
 * `slug` is a POINTER, not an assertion: the server dereferences it into the
 * published artifact it already holds and derives the recipient audience there.
 * It is typed optional-tolerant on purpose — `Template.slug` is declared
 * `string`, but a default-constructed template carries `''`, and an empty or
 * absent slug must degrade to the strict `unevaluable` policy, never throw.
 *
 * `recipients` is the addressed set this lane is about to write into `To:`. The
 * server accepts it only as a binding check against the slug's published roster;
 * its omissions cannot erase the full roster's strict policy floor. A lane that
 * does not know its addressed set omits it and takes the strict policy — the
 * field is left `undefined` so it disappears from the body entirely, because an
 * explicit `null` or `[]` would be a claim rather than a silence.
 *
 * The response already names how the audience resolved (`policy`, and `reason`
 * when it could not be evaluated); this gate used to parse those fields away, so
 * a person whose recipient list simply could not be read was told their words
 * were rejected — indistinguishable from having been read and declined, which
 * means the opposite thing about their speech. Only `artifact-unavailable` earns
 * the extra sentence; every other unevaluable reason is a deliberate lane fact
 * or a measured judgment and keeps the plain refusal wording.
 *
 * Reading `policy` and `reason` changes WORDS only and can never move
 * `approved`. Admission is still `approved === true` plus the digest check, so a
 * substituted or hostile body asserting `policy: 'institutional'` gains nothing:
 * a refusal can be re-phrased, never turned into a send.
 */
export async function moderatePersonalConnection(
	text: string,
	slug: string | undefined,
	recipients?: string[]
): Promise<PersonalConnectionModeration> {
	const submitted = text ?? '';
	const typed = submitted.trim();
	if (!typed) return { approved: true, reviewed: mint(submitted, null) };

	try {
		const response = await fetch('/api/moderation/personalization', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ text: typed, slug, recipients })
		});

		// The endpoint is authenticated, so a guest can never be approved. Say why
		// rather than showing them a generic rejection they cannot act on.
		if (response.status === 401) {
			return { approved: false, reason: SIGN_IN_REQUIRED };
		}

		// An exhausted budget is not a broken service. The 429 carries which
		// capacity ran out and when it comes back; saying "temporarily unavailable"
		// here is false in both halves — it is not the moderation service, and the
		// reset can be thirty days away.
		if (response.status === 429) {
			const capacity = (await response.json().catch(() => null)) as {
				budgetScope?: unknown;
				resetAt?: unknown;
			} | null;
			return { approved: false, reason: capacityReason(capacity) };
		}

		// A rejection is returned as HTTP 400 carrying `approved: false`, so status
		// alone is not the signal — the body is. Read it, and treat anything that is
		// not an explicit approval as a refusal.
		const result = (await response.json().catch(() => null)) as ModerationResponseBody | null;

		if (result?.approved === true) {
			// The verdict is bound to content when both sides can hash. A failing
			// `subtle` degrades to `null` inside its own catch rather than falling
			// into the outer one — a crypto hiccup must not deny a legitimate send.
			const claimed = typeof result.contentDigest === 'string' ? result.contentDigest : null;
			const computed =
				claimed && globalThis.crypto?.subtle ? await sha256Hex(typed).catch(() => null) : null;

			// Both sides hashed and disagreed: this response is not about this text.
			// Refuse with the service wording and never show the sender a hash.
			if (computed !== null && computed !== claimed) {
				return { approved: false, reason: UNAVAILABLE };
			}

			return { approved: true, reviewed: mint(submitted, computed) };
		}

		const summary = typeof result?.summary === 'string' ? result.summary : '';
		const refusal = summary || (response.ok ? NOT_APPROVED : UNAVAILABLE);
		// The hazard summary is preserved verbatim and only prefixed, so a reader
		// still learns what was found as well as which rules found it. The other
		// refusal branches above each carry their own true explanation and are left
		// alone; `policy`/`reason` are not reliably present on any of them.
		return {
			approved: false,
			reason: rosterWasUnreadable(result) ? `${ROSTER_UNREADABLE} ${refusal}` : refusal
		};
	} catch {
		// This is a delivery safety boundary. Provider or admission failure must
		// never turn repeated clicks into an unmoderated send.
		return { approved: false, reason: UNAVAILABLE };
	}
}
