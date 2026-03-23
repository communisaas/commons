/**
 * Campaign Pseudonym — HMAC-SHA256 pseudonymous user identifier for template_campaign records.
 *
 * Deterministic but not reversible without the key. Prevents direct user_id → political action
 * correlation in the event of a database breach.
 */

import { createHmac } from 'crypto';

// Static fallback for dev/test environments where CAMPAIGN_PSEUDONYM_KEY is not configured.
// NOT cryptographically meaningful — exists solely to keep dev environments functional.
const DEV_FALLBACK_KEY = 'commons-dev-campaign-pseudonym-fallback-not-for-production';

let _warnedFallback = false;

/**
 * Compute a pseudonymous identifier for a user in campaign records.
 *
 * @param userId - Raw user ID (CUID)
 * @returns 64-character hex string (HMAC-SHA256 digest)
 */
export function computeCampaignPseudonym(userId: string): string {
	const key = process.env.CAMPAIGN_PSEUDONYM_KEY;

	if (!key) {
		if (process.env.NODE_ENV === 'production') {
			throw new Error(
				'CAMPAIGN_PSEUDONYM_KEY environment variable not configured. ' +
					'Generate with: openssl rand -hex 32'
			);
		}
		if (!_warnedFallback) {
			console.warn(
				'[Security] CAMPAIGN_PSEUDONYM_KEY not set — using dev fallback (not for production)'
			);
			_warnedFallback = true;
		}
	}

	const effectiveKey = key || DEV_FALLBACK_KEY;
	return createHmac('sha256', effectiveKey).update(userId).digest('hex');
}
