import { timingSafeEqual } from 'node:crypto';
import { env } from '$env/dynamic/private';

/**
 * Constant-time match of a presented secret against the active
 * `INTERNAL_API_SECRET` and the optional rotation-window
 * `INTERNAL_API_SECRET_PREVIOUS`. Used by all 7 SvelteKit `/api/internal/*`
 * endpoints to verify the `x-internal-secret` header sent by Convex
 * actions (and Lambda forwards).
 *
 * Mirrors the dual-secret pattern from `address-resolution-token.ts`,
 * `unsubscribe.ts`, etc. Convex sends only the active secret; Lambda
 * sends only the active secret. Verifier accepts either so a rotation
 * window where SvelteKit and Convex/Lambda hold different active secrets
 * doesn't break in-flight requests.
 *
 * Length-mismatch early-return is ACCEPTABLE: it leaks the secret's
 * length class, but the secret format pins to a known length anyway
 * (32-byte minimum enforced).
 *
 * Returns:
 *   - `{ ok: true }` on match.
 *   - `{ ok: false, reason: 'not_configured' }` when active secret is missing
 *     or under-length.
 *   - `{ ok: false, reason: 'invalid' }` when presented secret matches
 *     neither active nor previous.
 */
export type InternalSecretMatchResult =
	| { ok: true }
	| { ok: false; reason: 'not_configured' | 'invalid' };

const MIN_SECRET_BYTES = 32;

function isStringSecret(value: string | undefined | null): value is string {
	return typeof value === 'string' && value.length >= MIN_SECRET_BYTES;
}

export function matchInternalSecret(presented: string | null | undefined): InternalSecretMatchResult {
	const active = env.INTERNAL_API_SECRET;
	if (!isStringSecret(active)) {
		return { ok: false, reason: 'not_configured' };
	}
	if (!presented) {
		return { ok: false, reason: 'invalid' };
	}
	const presentedBytes = Buffer.from(presented, 'utf8');
	const candidates: string[] = [active];
	const previous = env.INTERNAL_API_SECRET_PREVIOUS;
	if (typeof previous === 'string') {
		if (previous.length < MIN_SECRET_BYTES) {
			// Bad _PREVIOUS must NOT brick active-secret verification — log
			// loud and skip.
			console.warn(
				`[internal-auth] INTERNAL_API_SECRET_PREVIOUS is set but < ${MIN_SECRET_BYTES} bytes; ignoring`
			);
		} else {
			candidates.push(previous);
		}
	}
	for (const secret of candidates) {
		const secretBytes = Buffer.from(secret, 'utf8');
		if (presentedBytes.length !== secretBytes.length) continue;
		if (timingSafeEqual(presentedBytes, secretBytes)) {
			return { ok: true };
		}
	}
	return { ok: false, reason: 'invalid' };
}
