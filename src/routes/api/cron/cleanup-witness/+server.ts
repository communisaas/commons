/**
 * Daily Witness Cleanup Cron Endpoint
 *
 * SCHEDULE: Run daily at 01:00 UTC
 *
 * NULLs out encrypted_witness, witness_nonce, and ephemeral_public_key
 * for submissions where witness_expires_at < NOW().
 *
 * Preserves: delivery_status, proof_hex, nullifier, public_inputs (not PII).
 * Data minimization: encrypted witness contains user address (PII).
 *
 * AUTHENTICATION:
 * - Requires CRON_SECRET environment variable in production
 * - Pass as Bearer token: Authorization: Bearer <CRON_SECRET>
 *
 * USAGE:
 * ```bash
 * curl -X GET https://commons.email/api/cron/cleanup-witness \
 *   -H "Authorization: Bearer $CRON_SECRET"
 * ```
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { prisma } from '$lib/core/db';
import { env } from '$env/dynamic/private';
import { verifyCronSecret } from '$lib/server/cron-auth';

export const GET: RequestHandler = async ({ request }) => {
	// Authenticate cron requests — fail-closed if not configured
	const cronSecret = env.CRON_SECRET;
	if (!cronSecret) {
		throw error(500, 'CRON_SECRET not configured');
	}

	const authHeader = request.headers.get('authorization');
	if (!verifyCronSecret(authHeader, cronSecret)) {
		throw error(401, 'Invalid cron secret');
	}

	try {
		const now = new Date();

		// Find and clean expired witnesses in batches
		const result = await prisma.submission.updateMany({
			where: {
				witness_expires_at: { lt: now },
				encrypted_witness: { not: '' } // Only process non-empty witnesses
			},
			data: {
				encrypted_witness: '',
				witness_nonce: null,
				ephemeral_public_key: null
			}
		});

		console.log('[Cron:cleanup-witness] Cleaned', result.count, 'expired witness records');

		return json({
			success: true,
			cleaned: result.count,
			timestamp: now.toISOString()
		});
	} catch (err) {
		console.error('[Cron:cleanup-witness] Failed:', err);
		throw error(500, 'Witness cleanup failed');
	}
};
