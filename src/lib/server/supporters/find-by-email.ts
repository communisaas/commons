/**
 * Supporter Email Lookup Helper (S-6)
 *
 * Looks up a supporter by (orgId, email) using email_hash.
 * Post-backfill: all supporters have email_hash — no plaintext fallback.
 */

import { db as defaultDb } from '$lib/core/db';
import { computeEmailHash } from '$lib/core/crypto/user-pii-encryption';

type SupporterClient = { findUnique: typeof defaultDb.supporter.findUnique };
type SupporterSelect = Parameters<typeof defaultDb.supporter.findUnique>[0]['select'];

/**
 * Find a supporter by (orgId, email) using email_hash lookup.
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

	if (!emailHash) {
		throw new Error('[PII] EMAIL_LOOKUP_KEY not set — cannot compute email_hash for lookup');
	}

	return supporter.findUnique({
		where: { orgId_email_hash: { orgId, email_hash: emailHash } },
		...(select ? { select } : {})
	});
}
