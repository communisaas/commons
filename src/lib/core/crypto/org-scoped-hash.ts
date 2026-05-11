/**
 * Org-scoped deterministic hashing for dedup — NO server-held keys.
 *
 * Replaces server-HMAC `computeEmailHash()` for org-layer entities
 * (supporters, invites, RSVPs, bounces). The hash is for dedup only,
 * not confidentiality — the org already knows the emails they imported.
 *
 * SHA-256(orgId + ":" + normalize(value)) — deterministic, no secret key.
 * Scoped per-org so the same email in two orgs produces different hashes,
 * preventing cross-org correlation.
 */

const encoder = new TextEncoder();

function bytesToHex(bytes: Uint8Array): string {
	return Array.from(bytes)
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

export function normalizeEmail(email: string): string {
	return email.trim().toLowerCase();
}

/**
 * Normalize phone for consistent hashing.
 * Requires E.164-ish format: leading '+', digits only, 7-15 digits.
 * "+1 (555) 123-4567" → "+15551234567"
 *
 * Throws on invalid input to prevent silent hash divergence.
 */
export function normalizePhone(phone: string): string {
	const trimmed = phone.trim();
	if (!trimmed.startsWith('+')) {
		throw new Error(
			`Phone must start with '+' country code for consistent hashing: got "${trimmed.slice(0, 4)}..."`
		);
	}
	// Strip everything except digits after the leading '+'
	const digits = trimmed.slice(1).replace(/\D/g, '');
	if (digits.length < 7 || digits.length > 15) {
		throw new Error(
			`Phone has ${digits.length} digits after '+' — expected 7-15 for E.164`
		);
	}
	return '+' + digits;
}

/**
 * Org-scoped deterministic email hash for dedup lookups.
 * SHA-256(orgId + ":email:" + normalize(email))
 */
export async function computeOrgScopedEmailHash(orgId: string, email: string): Promise<string> {
	const normalized = normalizeEmail(email);
	const data = encoder.encode(orgId + ':email:' + normalized);
	const hash = await crypto.subtle.digest('SHA-256', data);
	return bytesToHex(new Uint8Array(hash));
}

/**
 * Org-scoped deterministic phone hash for dedup lookups.
 * SHA-256(orgId + ":phone:" + normalize(phone))
 * Domain-separated from email hashes via the ":phone:" infix.
 */
export async function computeOrgScopedPhoneHash(orgId: string, phone: string): Promise<string> {
	const normalized = normalizePhone(phone);
	const data = encoder.encode(orgId + ':phone:' + normalized);
	const hash = await crypto.subtle.digest('SHA-256', data);
	return bytesToHex(new Uint8Array(hash));
}

/**
 * Global (cross-org) email hash for inbound webhook lookup.
 *
 * Stored on the supporter row alongside the org-scoped `emailHash`. The SES
 * bounce/complaint webhook only has the recipient email (no org context) —
 * it has to find ALL supporters across orgs to mark the address bounced.
 * This is the hash it queries via `by_globalEmailHash`.
 *
 * Same normalization as the org-scoped helper above. Domain prefix
 * `"email:"` (no orgId) keeps it distinct from phone hashes. Mirrors
 * `convex/_orgHash.ts:computeGlobalEmailHash`.
 */
export async function computeGlobalEmailHash(email: string): Promise<string> {
	const normalized = normalizeEmail(email);
	const data = encoder.encode('email:' + normalized);
	const hash = await crypto.subtle.digest('SHA-256', data);
	return bytesToHex(new Uint8Array(hash));
}

/**
 * Global (cross-org) phone hash for inbound webhook lookup.
 *
 * Stored on the supporter row alongside the org-scoped `phoneHash`. The
 * Twilio inbound webhook (TCPA STOP/START) only has the `From` phone (no
 * org context) — it has to find ALL supporters across orgs. This is the
 * hash it queries via `by_globalPhoneHash`. Mirrors
 * `convex/_orgHash.ts:computeGlobalPhoneHash`.
 *
 * Throws on non-E.164 input (delegates to `normalizePhone`) — TCPA opt-outs
 * from a poorly-normalized phone must NOT silently produce a different hash
 * that fails to find the supporter.
 */
export async function computeGlobalPhoneHash(phone: string): Promise<string> {
	const normalized = normalizePhone(phone);
	const data = encoder.encode('phone:' + normalized);
	const hash = await crypto.subtle.digest('SHA-256', data);
	return bytesToHex(new Uint8Array(hash));
}
