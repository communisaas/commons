import { timingSafeEqual } from 'crypto';

/**
 * Verify cron endpoint authorization using constant-time comparison.
 * Prevents timing attacks that could extract CRON_SECRET byte-by-byte.
 */
export function verifyCronSecret(authHeader: string | null, cronSecret: string): boolean {
	const expected = `Bearer ${cronSecret}`;
	if (!authHeader || authHeader.length !== expected.length) return false;
	return timingSafeEqual(Buffer.from(authHeader), Buffer.from(expected));
}

/**
 * Verify a raw secret value (e.g. from x-cron-secret header) using constant-time comparison.
 */
export function verifyCronSecretRaw(value: string | null, cronSecret: string): boolean {
	if (!value || value.length !== cronSecret.length) return false;
	return timingSafeEqual(Buffer.from(value), Buffer.from(cronSecret));
}
