/**
 * Email Verification — DNS MX record check via Cloudflare DOH.
 *
 * Works in all runtimes (Node, Cloudflare Workers, local dev).
 *
 * An MX answer is three-state, and the result reports which one was reached.
 * The DNS response code decides which: only NOERROR (0) and NXDOMAIN (3) mean
 * the resolver actually answered the question. Every other RCODE is a resolver
 * failure — a statement about the lookup, never about the domain.
 *  - Syntax failure           → undeliverable, nothing observed.
 *  - RCODE 0/3, no MX record  → undeliverable, observed (the domain published
 *                               no mail exchanger — a real absence).
 *  - RCODE 0, has MX          → risky, observed. An MX record proves a DOMAIN
 *                               accepts mail, never that a MAILBOX exists.
 *  - DOH unreachable, any
 *    other RCODE, a body
 *    carrying no RCODE, or
 *    the caller's domain
 *    ceiling                  → risky, NOT observed. We were blocked from
 *                               looking; that is not evidence of anything.
 *
 * That distinction is no longer local to this module: it is `Fact` from
 * `$lib/core/fact`, where "what we found" and "whether we looked" are separate
 * states. `mxObserved` is derived from the Fact at a single site rather than
 * hand-asserted per branch, so a blocked lookup cannot be persisted as an
 * observation. A blocked LOOKUP fails open: it never drops a candidate. A
 * syntax failure is not a lookup — it is undeliverable on its face, decided
 * before any query is attempted, and it does drop the candidate downstream.
 */

import { type Fact, present, absent, blocked } from '$lib/core/fact';

// ============================================================================
// Types
// ============================================================================

export type EmailVerdict = 'deliverable' | 'risky' | 'undeliverable';

export interface EmailVerificationResult {
	email: string;
	verdict: EmailVerdict;
	/** True only when a DNS answer was actually parsed this run. */
	mxObserved: boolean;
	reason?: string;
}

// ============================================================================
// MX lookup via DNS-over-HTTPS
// ============================================================================

/**
 * What the DNS answer actually said. `present` carries the observed MX-record
 * count (always ≥ 1); `absent` means the resolver answered and the domain
 * published none; `blocked` means we never got a usable answer (non-200,
 * timeout, network error, a failure RCODE, or a body with no RCODE) and is
 * therefore not a claim about the domain at all.
 */
type MxFact = Fact<number>;

/** The transport never delivered a readable body: non-200, timeout, network error. */
const DOH_NO_ANSWER = 'DNS-over-HTTPS returned no answer';

/**
 * The resolver replied, but with a code that means it could not answer the
 * question (SERVFAIL, REFUSED, …). The numeric status travels with the reason.
 */
const dohResolverFailure = (status: number) => `DNS-over-HTTPS resolver returned status ${status}`;

/**
 * A 200 body with no numeric `Status` is not a parsed DNS answer at all — the
 * shape a proxy or captive-portal interstitial produces on this path.
 */
const DOH_NO_STATUS = 'DNS-over-HTTPS returned a body with no DNS status';

/** The two response codes that mean the resolver actually answered the question. */
const DNS_RCODE_NOERROR = 0;
const DNS_RCODE_NXDOMAIN = 3;

/** Deduplicated in-flight + resolved cache: domain → promise of the MX fact. */
const mxCache = new Map<string, Promise<MxFact>>();

async function domainHasMx(domain: string): Promise<MxFact> {
	try {
		const res = await fetch(
			`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=MX`,
			{
				headers: { Accept: 'application/dns-json' },
				signal: AbortSignal.timeout(1000),
			}
		);
		if (!res.ok) return blocked(DOH_NO_ANSWER); // DOH unavailable — nothing observed
		const data: { Status?: unknown; Answer?: { type: number }[] } = await res.json();
		// The RCODE gates everything below it. A missing `Answer` is an absence
		// only if the resolver actually answered; on a SERVFAIL, or on a proxy
		// interstitial that returns 200 with no DNS body at all, it means nothing
		// — and reading it as "no MX records" would delete a reachable recipient
		// on the strength of a DNS incident.
		if (typeof data.Status !== 'number') return blocked(DOH_NO_STATUS);
		if (data.Status !== DNS_RCODE_NOERROR && data.Status !== DNS_RCODE_NXDOMAIN) {
			return blocked(dohResolverFailure(data.Status));
		}
		const mxCount = data.Answer?.filter((r) => r.type === 15).length ?? 0;
		// NOERROR or NXDOMAIN: the resolver answered, so this is an observation
		// either way — records found, or a real published absence.
		return mxCount >= 1 ? present(mxCount) : absent();
	} catch {
		return blocked(DOH_NO_ANSWER); // timeout / network error — nothing observed
	}
}

/**
 * Check MX records for a domain, deduplicating concurrent lookups.
 * Same domain in the same process/isolate shares a single fetch.
 *
 * Only observations are memoized. A blocked lookup is evicted once it resolves,
 * so a single DNS incident cannot pin a domain to "not observed" for the life
 * of the isolate. That adds retries strictly on failure paths; the steady state
 * is unchanged, and every retry still passes the caller's per-resolution
 * `maxDomains` ceiling first.
 */
function checkMx(domain: string): Promise<MxFact> {
	const cached = mxCache.get(domain);
	if (cached) return cached;
	// Annotated because the callback closes over `promise`; without it the
	// inference is circular.
	const promise: Promise<MxFact> = domainHasMx(domain).then((f) => {
		// Concurrent callers already read the map before this resolves, so
		// in-flight dedup is unaffected. The identity check keeps an earlier
		// failure from evicting a later lookup's entry for the same domain.
		if (f.state === 'blocked' && mxCache.get(domain) === promise) mxCache.delete(domain);
		return f;
	});
	mxCache.set(domain, promise);
	return promise;
}

/**
 * The single site where "did we look?" is decided. Only a retrieval that ran to
 * a parsed answer counts — `present` (records found) or `absent` (none
 * published). Every stopped, refused or skipped path is not an observation.
 */
function wasObserved(f: Fact<unknown>): boolean {
	return f.state === 'present' || f.state === 'absent';
}

/** The single site where `mxObserved` is assigned — never a hand-written literal. */
function resultFrom(
	email: string,
	f: Fact<unknown>,
	verdict: EmailVerdict,
	reason: string
): EmailVerificationResult {
	return { email, verdict, mxObserved: wasObserved(f), reason };
}

/** Verdict + reason for a lookup that reached `checkMx`. */
function mxOutcome(domain: string, f: MxFact): { verdict: EmailVerdict; reason: string } {
	switch (f.state) {
		case 'present':
			// 'risky' not 'deliverable': an MX record proves the domain accepts
			// mail, not that this mailbox exists. Survivors are kept, not stripped.
			return { verdict: 'risky', reason: `MX lookup passed for ${domain}` };
		case 'absent':
			// A parsed answer with no mail exchanger — a real, observed absence.
			return { verdict: 'undeliverable', reason: `No MX records for ${domain}` };
		case 'blocked':
		case 'withheld':
			// Nothing was observed. Fail open so a DNS incident never deletes a
			// real recipient. (`withheld` is unreachable for DNS, which has no
			// disclosure policy, but the switch stays total.)
			return { verdict: 'risky', reason: `MX lookup unavailable for ${domain} — ${f.why}` };
		default: {
			const _never: never = f;
			return _never;
		}
	}
}

// ============================================================================
// Batch Verification
// ============================================================================

/**
 * Verify a batch of email addresses.
 *
 * 1. Syntax check — invalid → undeliverable
 * 2. MX record check — no MX → undeliverable, DOH error → risky (not observed)
 *
 * Deduplicates MX lookups across emails sharing a domain.
 *
 * `options.maxDomains` caps the number of DISTINCT domains admitted to an MX
 * lookup in this call. Addresses beyond the ceiling resolve to risky/not
 * observed rather than being dropped. The ceiling is per-call (a local Set), so
 * `checkMx` invocations ≤ `maxDomains` holds for every resolution independently
 * of what the isolate-scoped memo already holds. Omitting it keeps the previous
 * unbounded behaviour.
 */
export async function verifyEmailBatch(
	emails: string[],
	options?: { maxDomains?: number }
): Promise<Map<string, EmailVerificationResult>> {
	const results = new Map<string, EmailVerificationResult>();
	const mxChecks: Array<{ email: string; domain: string }> = [];
	const maxDomains =
		options?.maxDomains !== undefined &&
		Number.isSafeInteger(options.maxDomains) &&
		options.maxDomains > 0
			? options.maxDomains
			: null;
	const admittedDomains = new Set<string>();

	// Pass 1: syntax, plus the per-call distinct-domain ceiling
	for (const email of emails) {
		const isValidSyntax = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
		if (!isValidSyntax) {
			// Blocked, not absent — there was no domain to query, so we never
			// looked. The verdict is undeliverable regardless of any lookup.
			results.set(
				email,
				resultFrom(
					email,
					blocked('invalid email syntax — no domain to query'),
					'undeliverable',
					'Invalid email syntax'
				)
			);
		} else {
			const domain = email.split('@')[1].toLowerCase();
			if (
				maxDomains !== null &&
				admittedDomains.size >= maxDomains &&
				!admittedDomains.has(domain)
			) {
				// Blocked, not absent — we never looked at this domain.
				const ceiling = blocked('per-resolution domain ceiling reached');
				results.set(
					email,
					resultFrom(
						email,
						ceiling,
						'risky',
						`MX lookup skipped for ${domain} — ${ceiling.why}`
					)
				);
			} else {
				admittedDomains.add(domain);
				mxChecks.push({ email, domain });
			}
		}
	}

	// Pass 2: MX (parallel, deduplicated by domain)
	const mxResults = await Promise.all(
		mxChecks.map(async ({ email, domain }) => {
			const observation = await checkMx(domain);
			return { email, domain, observation };
		})
	);

	for (const { email, domain, observation } of mxResults) {
		const { verdict, reason } = mxOutcome(domain, observation);
		results.set(email, resultFrom(email, observation, verdict, reason));
	}

	return results;
}

/**
 * Verify a single email address.
 */
export async function verifyEmail(email: string): Promise<EmailVerificationResult> {
	const results = await verifyEmailBatch([email]);
	return results.get(email)!;
}
