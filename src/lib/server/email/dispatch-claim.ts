// Server-signed dispatch claim for the Lambda bulk-send path. Without this,
// a compromised editor session with a 15-minute STS credential could direct
// the Lambda to send arbitrary HTML to arbitrary recipients . The
// claim binds the Lambda invocation to (orgId, blastId, allowed recipient
// hashes), and the Lambda verifies before each SendEmail.
//
// Claim shape: base64url(payload) + "." + base64url(HMAC-SHA256(secret, payload))
// where payload is JSON `{orgId, blastId, allowedHashes[], iat, exp}`.
//
// allowedHashes are SHA-256(orgId + ":email:" + normalizedEmail) — the same
// `computeOrgScopedEmailHash` Convex uses on supporter rows. Lambda recomputes
// the same hash per recipient and checks set membership.

import { createHmac, timingSafeEqual } from 'node:crypto';

const CLAIM_TTL_MS = 30 * 60 * 1000; // 30 minutes — covers a long-running blast

export interface DispatchClaimPayload {
	orgId: string;
	blastId: string;
	allowedHashes: string[];
	iat: number;
	exp: number;
}

function bytesToBase64Url(buf: Buffer): string {
	return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(s: string): Buffer | null {
	const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
	try {
		return Buffer.from(b64, 'base64');
	} catch {
		return null;
	}
}

const MIN_SECRET_BYTES = 32;

export function signDispatchClaim(
	payload: { orgId: string; blastId: string; allowedHashes: string[] },
	secret: string
): string {
	if (!secret) throw new Error('BLAST_DISPATCH_SECRET not configured');
	if (secret.length < MIN_SECRET_BYTES) {
		throw new Error(`BLAST_DISPATCH_SECRET must be >= ${MIN_SECRET_BYTES} bytes`);
	}
	const now = Date.now();
	const fullPayload: DispatchClaimPayload = {
		orgId: payload.orgId,
		blastId: payload.blastId,
		allowedHashes: payload.allowedHashes,
		iat: now,
		exp: now + CLAIM_TTL_MS
	};
	const payloadJson = JSON.stringify(fullPayload);
	const payloadB64 = bytesToBase64Url(Buffer.from(payloadJson, 'utf-8'));
	const sig = createHmac('sha256', secret).update(payloadB64).digest();
	return `${payloadB64}.${bytesToBase64Url(sig)}`;
}

// Verify and parse a claim. Returns the payload only when signature is valid
// (against ANY of the supplied secrets) AND not expired. Used in tests; the
// Lambda mirrors this logic with the SAME multi-secret semantics so a
// rotation window where SvelteKit and Lambda hold different active secrets
// doesn't break in-flight blasts.
//
// `secrets` accepts a string (single-secret operation, default) or an array
// (rotation window: pass [activeSecret, previousSecret]). The active secret
// MUST be the first entry. Per-candidate compare uses `crypto.timingSafeEqual`
// (constant-time WITHIN one candidate); the OUTER loop short-circuits on
// match so an attacker observing wall-clock could in principle distinguish
// "matched active" from "matched previous" during a rotation window. Both
// outcomes verify the same payload, so the leak reveals only which secret
// signed a VALID token, not the secret itself.
export function verifyDispatchClaim(
	claim: string,
	secrets: string | string[]
): DispatchClaimPayload | null {
	const candidates = (Array.isArray(secrets) ? secrets : [secrets]).filter(
		(s): s is string => typeof s === 'string' && s.length > 0
	);
	if (candidates.length === 0 || !claim) return null;
	const [payloadB64, sigB64] = claim.split('.');
	if (!payloadB64 || !sigB64) return null;
	const got = base64UrlToBytes(sigB64);
	if (!got) return null;
	let signatureMatches = false;
	for (const secret of candidates) {
		const expected = createHmac('sha256', secret).update(payloadB64).digest();
		if (got.length !== expected.length) continue;
		if (timingSafeEqual(got, expected)) {
			signatureMatches = true;
			break;
		}
	}
	if (!signatureMatches) return null;
	const payloadBytes = base64UrlToBytes(payloadB64);
	if (!payloadBytes) return null;
	let payload: DispatchClaimPayload;
	try {
		payload = JSON.parse(payloadBytes.toString('utf-8'));
	} catch {
		return null;
	}
	if (
		typeof payload.orgId !== 'string' ||
		typeof payload.blastId !== 'string' ||
		!Array.isArray(payload.allowedHashes) ||
		typeof payload.iat !== 'number' ||
		typeof payload.exp !== 'number'
	) {
		return null;
	}
	if (Date.now() > payload.exp) return null;
	return payload;
}
