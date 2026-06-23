/**
 * Base-rate relation — the coarse, non-identifying relationship between a
 * page viewer's district and the template author's district.
 *
 * Only three values can ever leave the server: `same`, `diff`, `unknown`.
 * District codes are NEVER emitted. Each code is HMAC'd with a shared secret
 * and the two digests are compared in constant time, so the server derives a
 * 3-valued relation without exposing either district to the client analytics
 * pipeline.
 *
 * Fail-soft contract: any missing input, missing secret, or unexpected error
 * resolves to `unknown`. This function NEVER throws — a thrown error in the
 * page load would otherwise become a hard 500.
 */

import { env } from '$env/dynamic/private';
import { timingSafeEqual } from 'node:crypto';
import { createHmacProof } from '$lib/server/auth/session-proof';

export type BaseRateRelation = 'same' | 'diff' | 'unknown';

/**
 * Compute the viewer-vs-author district relation.
 *
 * @param viewerDistrictCode the viewer's resolved district code, or null
 * @param authorDistrictCode the author's resolved district code, or null
 * @returns 'same' | 'diff' | 'unknown' — never a district identifier
 */
export async function computeBaseRateRelation(
	viewerDistrictCode: string | null | undefined,
	authorDistrictCode: string | null | undefined
): Promise<BaseRateRelation> {
	try {
		if (!viewerDistrictCode || !authorDistrictCode) return 'unknown';

		// Reuse the existing district-scoped HMAC secret. No new secret/domain
		// string is introduced; the digests never leave this function.
		const secret = env.ADDRESS_RESOLUTION_TOKEN_SECRET;
		if (!secret || secret.length < 32) return 'unknown';

		const [viewerDigest, authorDigest] = await Promise.all([
			createHmacProof(viewerDistrictCode, secret),
			createHmacProof(authorDistrictCode, secret)
		]);

		// Both digests are equal-length hex strings of the same secret, so a
		// constant-time compare is well-defined.
		const a = Buffer.from(viewerDigest, 'utf8');
		const b = Buffer.from(authorDigest, 'utf8');
		if (a.length !== b.length) return 'diff';

		return timingSafeEqual(a, b) ? 'same' : 'diff';
	} catch {
		return 'unknown';
	}
}
