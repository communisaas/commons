import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '$env/dynamic/private';

/**
 * HMAC-bound unsubscribe tokens for one-click email opt-out. Tokens land in
 * email links that may sit in inboxes for DAYS — secret rotation without
 * dual-secret support would invalidate every outstanding unsubscribe URL.
 *
 * Pattern matches `address-resolution-token.ts`:
 *   - Mint always uses `UNSUBSCRIBE_SECRET` (active).
 *   - Verify tries the active secret first, then `UNSUBSCRIBE_SECRET_PREVIOUS`
 *     if set, so in-flight email links keep working through a rotation.
 *
 * Rotation procedure (operator):
 *   1. Set _PREVIOUS = current value.
 *   2. Set UNSUBSCRIBE_SECRET = new value. Deploy.
 *   3. Wait long enough for outstanding email links to be opened OR be deemed
 *      stale (operator judgment — typically 30+ days for marketing email).
 *   4. Unset _PREVIOUS. Deploy.
 *
 * Token = hex(HMAC-SHA256(secret, supporterId:orgId)). Deterministic for
 * the same (supporter, org, secret) tuple — same token re-issued for the
 * same email link, idempotent unsubscribe.
 */

const MIN_SECRET_BYTES = 32;

function activeSecret(): string {
	const secret = env.UNSUBSCRIBE_SECRET;
	if (!secret) throw new Error('UNSUBSCRIBE_SECRET env var is required');
	if (secret.length < MIN_SECRET_BYTES) {
		throw new Error(`UNSUBSCRIBE_SECRET must be >= ${MIN_SECRET_BYTES} bytes`);
	}
	return secret;
}

function previousSecret(): string | null {
	const secret = env.UNSUBSCRIBE_SECRET_PREVIOUS;
	if (!secret) return null;
	if (secret.length < MIN_SECRET_BYTES) {
		// Bad _PREVIOUS must NOT brick active-secret verification of in-flight
		// email links. Log loud and treat as unset; operator sees the warning
		// and links keep working under the active secret.
		console.warn(
			`[unsubscribe] UNSUBSCRIBE_SECRET_PREVIOUS is set but < ${MIN_SECRET_BYTES} bytes; ignoring (active-secret verification continues)`
		);
		return null;
	}
	return secret;
}

function computeToken(secret: string, supporterId: string, orgId: string): string {
	const hmac = createHmac('sha256', secret);
	hmac.update(`${supporterId}:${orgId}`);
	return hmac.digest('hex');
}

/**
 * Generate an HMAC unsubscribe token for a supporter under the active
 * secret. Token = hex(HMAC-SHA256(activeSecret, supporterId:orgId)).
 */
export function generateUnsubscribeToken(supporterId: string, orgId: string): string {
	return computeToken(activeSecret(), supporterId, orgId);
}

/**
 * Build the full unsubscribe URL for a supporter.
 */
export function buildUnsubscribeUrl(supporterId: string, orgId: string): string {
	const token = generateUnsubscribeToken(supporterId, orgId);
	const baseUrl = env.PUBLIC_BASE_URL || 'https://commons.email';
	return `${baseUrl}/unsubscribe/${supporterId}/${orgId}/${token}`;
}

/**
 * Verify an unsubscribe token. Tries the active secret first, then the
 * optional rotation-window previous secret. Constant-time compare via
 * `crypto.timingSafeEqual` (canonical primitive for HMAC verification —
 * V8's `charCodeAt`-over-strings has variable timing on UTF-16-backed
 * strings; hex output is ASCII-only so the practical difference is small,
 * but the canonical primitive is the right call).
 */
export function verifyUnsubscribeToken(
	supporterId: string,
	orgId: string,
	token: string
): boolean {
	const tokenBuf = Buffer.from(token, 'utf8');
	const candidates: string[] = [activeSecret()];
	const previous = previousSecret();
	if (previous) candidates.push(previous);
	for (const secret of candidates) {
		const expected = computeToken(secret, supporterId, orgId);
		if (expected.length !== token.length) continue;
		const expectedBuf = Buffer.from(expected, 'utf8');
		if (timingSafeEqual(tokenBuf, expectedBuf)) {
			return true;
		}
	}
	return false;
}
