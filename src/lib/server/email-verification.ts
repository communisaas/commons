/**
 * Email Verification — Stub
 *
 * Provides email deliverability verification for the decision-maker
 * resolution pipeline. Returns conservative results (risky/unknown)
 * rather than falsely marking emails as verified.
 *
 * Production note: Wire to a real email verification service
 * (e.g., ZeroBounce, NeverBounce) when budget allows.
 */

// ============================================================================
// Types
// ============================================================================

/** Verdict from email verification */
export type EmailVerdict = 'deliverable' | 'risky' | 'undeliverable' | 'unknown';

export interface EmailVerificationResult {
	email: string;
	verdict: EmailVerdict;
	reason?: string;
}

// ============================================================================
// Batch Verification
// ============================================================================

/**
 * Verify a batch of email addresses for deliverability.
 *
 * Stub implementation: returns 'risky' for all emails (conservative default).
 * This prevents undeliverable emails from being silently accepted while
 * avoiding false positives that would drop valid contacts.
 *
 * @param emails - Array of email addresses to verify
 * @returns Map of email -> verification result
 */
export async function verifyEmailBatch(
	emails: string[]
): Promise<Map<string, EmailVerificationResult>> {
	const results = new Map<string, EmailVerificationResult>();

	for (const email of emails) {
		// Basic syntax check
		const isValidSyntax = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

		results.set(email, {
			email,
			verdict: isValidSyntax ? 'risky' : 'undeliverable',
			reason: isValidSyntax
				? 'Verification service not configured — marked as risky'
				: 'Invalid email syntax'
		});
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
