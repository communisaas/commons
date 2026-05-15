/**
 * Shared-secret auth for Convex public functions that must only be callable
 * from trusted SvelteKit server code (not from browsers).
 *
 * Pattern: SvelteKit passes `INTERNAL_API_SECRET` as the `_secret` arg;
 * the Convex function calls `requireInternalSecret(secret)` before doing
 * anything else. Constant-time comparison via crypto.timingSafeEqual.
 *
 * Mirrors src/lib/server/internal/secret-auth.ts (which guards the inbound
 * Convex→SvelteKit direction). This module guards SvelteKit→Convex for
 * Convex functions that can't be `internalQuery`/`internalMutation` (those
 * aren't reachable via the public HTTP API used by ConvexHttpClient).
 *
 * Dual-secret rotation: accepts either `INTERNAL_API_SECRET` (active) or
 * `INTERNAL_API_SECRET_PREVIOUS` (rotation window), matching the pattern
 * shared with the other 5 HMAC secrets (cycle 195).
 */

const MIN_SECRET_BYTES = 32;

function bufferEq(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	// Convex runtime doesn't expose node:crypto.timingSafeEqual; emulate
	// constant-time over the equal-length case (length-mismatch was already
	// rejected — leaks only the length class, which is fixed by the
	// MIN_SECRET_BYTES floor).
	let mismatch = 0;
	for (let i = 0; i < a.length; i++) {
		mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}
	return mismatch === 0;
}

export function requireInternalSecret(presented: string | undefined | null): void {
	const active = process.env.INTERNAL_API_SECRET;
	if (typeof active !== 'string' || active.length < MIN_SECRET_BYTES) {
		throw new Error('INTERNAL_API_SECRET not configured');
	}
	if (!presented) {
		throw new Error('Unauthorized');
	}
	if (bufferEq(presented, active)) return;
	const previous = process.env.INTERNAL_API_SECRET_PREVIOUS;
	if (typeof previous === 'string' && previous.length >= MIN_SECRET_BYTES) {
		if (bufferEq(presented, previous)) return;
	}
	throw new Error('Unauthorized');
}
