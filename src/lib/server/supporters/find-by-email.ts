/**
 * Supporter Email Lookup Helper (S-6)
 *
 * Looks up a supporter by (orgId, email) using email_hash first,
 * falling back to plaintext during the transition period.
 *
 * Once all supporters have email_hash backfilled, the plaintext
 * fallback can be removed and the @@unique([orgId, email]) constraint
 * can be dropped.
 */

import { db as defaultDb } from '$lib/core/db';
import { computeEmailHash } from '$lib/core/crypto/user-pii-encryption';

type SupporterClient = { findUnique: typeof defaultDb.supporter.findUnique };
type SupporterSelect = Parameters<typeof defaultDb.supporter.findUnique>[0]['select'];

/**
 * Find a supporter by (orgId, email) using email_hash-first lookup.
 *
 * 1. Compute HMAC email_hash
 * 2. Try @@unique([orgId, email_hash])
 * 3. Fall back to @@unique([orgId, email]) for pre-backfill rows
 *
 * @param orgId - Organization ID
 * @param email - Raw email (will be normalized internally)
 * @param select - Optional Prisma select clause
 * @param client - Optional Prisma client (for use inside $transaction)
 * @returns Supporter record or null
 */
export async function findSupporterByEmail(
	orgId: string,
	email: string,
	select?: SupporterSelect,
	client?: SupporterClient
) {
	const supporter = (client ?? defaultDb.supporter);
	const normalizedEmail = email.toLowerCase().trim();
	const emailHash = await computeEmailHash(normalizedEmail);

	// Primary: lookup by email_hash (privacy-preserving)
	if (emailHash) {
		const found = await supporter.findUnique({
			where: { orgId_email_hash: { orgId, email_hash: emailHash } },
			...(select ? { select } : {})
		});
		if (found) return found;
	}

	// Fallback: plaintext lookup (transition period — pre-backfill rows)
	const found = await supporter.findUnique({
		where: { orgId_email: { orgId, email: normalizedEmail } },
		...(select ? { select } : {})
	});
	return found;
}
