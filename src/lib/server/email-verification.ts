/**
 * Email Verification — DNS MX record check via Cloudflare DOH.
 *
 * Works in all runtimes (Node, Cloudflare Workers, local dev).
 * Syntax failures → undeliverable. No MX records → undeliverable.
 * DOH errors → risky (fail open, don't block pipeline).
 */

// ============================================================================
// Types
// ============================================================================

export type EmailVerdict = 'deliverable' | 'risky' | 'undeliverable';

export interface EmailVerificationResult {
	email: string;
	verdict: EmailVerdict;
	reason?: string;
}

// ============================================================================
// MX lookup via DNS-over-HTTPS
// ============================================================================

/** Deduplicated in-flight + resolved cache: domain → promise of has-MX. */
const mxCache = new Map<string, Promise<boolean>>();

async function domainHasMx(domain: string): Promise<boolean> {
	try {
		const res = await fetch(
			`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=MX`,
			{
				headers: { Accept: 'application/dns-json' },
				signal: AbortSignal.timeout(1000),
			}
		);
		if (!res.ok) return true; // DOH unavailable — fail open
		const data: { Answer?: { type: number }[] } = await res.json();
		return data.Answer?.some((r) => r.type === 15) ?? false;
	} catch {
		return true; // timeout / network error — fail open
	}
}

/**
 * Check MX records for a domain, deduplicating concurrent lookups.
 * Same domain in the same process/isolate shares a single fetch.
 */
function checkMx(domain: string): Promise<boolean> {
	const cached = mxCache.get(domain);
	if (cached) return cached;
	const promise = domainHasMx(domain);
	mxCache.set(domain, promise);
	return promise;
}

// ============================================================================
// Batch Verification
// ============================================================================

/**
 * Verify a batch of email addresses.
 *
 * 1. Syntax check — invalid → undeliverable
 * 2. MX record check — no MX → undeliverable, DOH error → risky
 *
 * Deduplicates MX lookups across emails sharing a domain.
 */
export async function verifyEmailBatch(
	emails: string[]
): Promise<Map<string, EmailVerificationResult>> {
	const results = new Map<string, EmailVerificationResult>();
	const mxChecks: Array<{ email: string; domain: string }> = [];

	// Pass 1: syntax
	for (const email of emails) {
		const isValidSyntax = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
		if (!isValidSyntax) {
			results.set(email, { email, verdict: 'undeliverable', reason: 'Invalid email syntax' });
		} else {
			const domain = email.split('@')[1].toLowerCase();
			mxChecks.push({ email, domain });
		}
	}

	// Pass 2: MX (parallel, deduplicated by domain)
	const mxResults = await Promise.all(
		mxChecks.map(async ({ email, domain }) => {
			const hasMx = await checkMx(domain);
			return { email, domain, hasMx };
		})
	);

	for (const { email, domain, hasMx } of mxResults) {
		if (hasMx === true) {
			// MX found OR DOH failed open — we can't distinguish.
			// Use 'risky' so Phase 3.5 doesn't strip it but the verdict is honest.
			results.set(email, { email, verdict: 'risky', reason: `MX lookup passed for ${domain}` });
		} else {
			results.set(email, { email, verdict: 'undeliverable', reason: `No MX records for ${domain}` });
		}
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
