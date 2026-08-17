/**
 * The public recipient attestation: an HMAC over every field the anonymous
 * detail projection may publish about one recipient.
 *
 * The preimage is back at its v2 shape — eleven elements, no reach term. An
 * attested `reaches: 'seat'` judgment was carried here for a while and is gone:
 * no consumer of the verified claims ever read it, and the policy that was
 * supposed to has three closed sockets and reads it nowhere, so it was a signed
 * field with nobody on the other end of it. That is the same defect this module
 * already recorded for the office label it dropped one revision earlier, and
 * repeating it in the file that documents it would be worse than not noticing.
 * The producer still mints the judgment (`resolveEmailReachesClaim`) and the row
 * still carries it; it simply is not signed and does not cross to the public.
 *
 * `ATTESTATION_KEYS` is KEPT rather than reverted with the rest. It is a
 * fail-closed property this shape did not have before — an attestation whose key
 * set exceeds what the issuer writes is refused outright — and it costs one loop
 * over three keys. Reverting a safety property because the feature that prompted
 * it went away would be a regression dressed as tidiness.
 */
const PUBLIC_RECIPIENT_PROVENANCE_PURPOSE = 'commons:public-template-recipient:v2';
export const PUBLIC_RECIPIENT_PROVENANCE_VERSION = 2 as const;
export const PUBLIC_RECIPIENT_PROVENANCE_TTL_MS = 24 * 60 * 60 * 1000;
const PUBLIC_RECIPIENT_PROVENANCE_CLOCK_SKEW_MS = 60 * 1000;
const MAX_SECRET_CACHE_ENTRIES = 4;

const textEncoder = new TextEncoder();
const hmacKeyCache = new Map<string, Promise<CryptoKey>>();

export type PublicRecipientProvenance = {
	version: typeof PUBLIC_RECIPIENT_PROVENANCE_VERSION;
	expiresAt: number;
	signature: string;
};

export type PublicRecipientProvenanceClaims = {
	email: string;
	emailSource: string;
	name: string;
	title: string;
	organization: string;
	role?: string;
	shortName?: string;
	roleCategory?: string;
};

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

function normalizedText(value: unknown, maxBytes: number): string | undefined {
	if (typeof value !== 'string') return undefined;
	const normalized = value.normalize('NFKC').replace(/\s+/g, ' ').trim();
	if (normalized.length === 0 || textEncoder.encode(normalized).byteLength > maxBytes) {
		return undefined;
	}
	return normalized;
}

function normalizedEmail(value: unknown): string | undefined {
	if (typeof value !== 'string') return undefined;
	const normalized = value.normalize('NFKC').trim().toLowerCase();
	if (
		textEncoder.encode(normalized).byteLength > 320 ||
		!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)
	) {
		return undefined;
	}
	return normalized;
}

function normalizedPublicSource(value: unknown): string | undefined {
	if (typeof value !== 'string' || textEncoder.encode(value).byteLength > 8_192) return undefined;
	try {
		const url = new URL(value);
		// Real contact and directory URLs carry queries; fragments never reach the publisher.
		if (
			url.protocol !== 'https:' ||
			url.username.length > 0 ||
			url.password.length > 0 ||
			url.hash.length > 0
		) {
			return undefined;
		}
		return url.toString();
	} catch {
		return undefined;
	}
}

/**
 * Canonicalize every field the anonymous detail projection may publish. The
 * attestation binds this complete shape, so changing identity or send copy
 * after issuance invalidates the proof rather than silently widening output.
 *
 * This deliberately does NOT read the row's `emailReachesClaim` /
 * `emailReachesLabel`. Those are the producer's own judgment about what a
 * mailbox reaches; nothing here signs them, nothing publishes them, and no
 * policy consults them, so an author who edits them changes nothing at all
 * about what verifies or what an anonymous visitor sees.
 */
export function normalizePublicRecipientProvenanceClaims(
	value: unknown
): PublicRecipientProvenanceClaims | null {
	if (!isPlainRecord(value)) return null;
	const email = normalizedEmail(value.email);
	const emailSource = normalizedPublicSource(value.emailSource);
	const name = normalizedText(value.name, 2_048);
	const title = normalizedText(value.title, 2_048);
	const organization = normalizedText(value.organization, 2_048);
	if (!email || !emailSource || !name || !title || !organization) return null;

	const role = normalizedText(value.role, 2_048);
	const shortName = normalizedText(value.shortName, 2_048);
	const roleCategory = normalizedText(value.roleCategory, 2_048);
	return {
		email,
		emailSource,
		name,
		title,
		organization,
		...(role === undefined ? {} : { role }),
		...(shortName === undefined ? {} : { shortName }),
		...(roleCategory === undefined ? {} : { roleCategory })
	};
}

function canonicalPayload(
	claims: PublicRecipientProvenanceClaims,
	userId: string,
	expiresAt: number
): string {
	return JSON.stringify([
		PUBLIC_RECIPIENT_PROVENANCE_PURPOSE,
		userId,
		expiresAt,
		claims.email,
		claims.emailSource,
		claims.name,
		claims.title,
		claims.organization,
		claims.role ?? null,
		claims.shortName ?? null,
		claims.roleCategory ?? null
	]);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function bytesToHex(bytes: Uint8Array): string {
	return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(value: string): Uint8Array | null {
	if (!/^[a-f0-9]{64}$/.test(value)) return null;
	const bytes = new Uint8Array(value.length / 2);
	for (let index = 0; index < bytes.length; index += 1) {
		bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
	}
	return bytes;
}

function hmacKey(secret: string): Promise<CryptoKey> {
	const existing = hmacKeyCache.get(secret);
	if (existing) return existing;
	if (hmacKeyCache.size >= MAX_SECRET_CACHE_ENTRIES) hmacKeyCache.clear();
	const imported = crypto.subtle.importKey(
		'raw',
		toArrayBuffer(textEncoder.encode(secret)),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign', 'verify']
	);
	hmacKeyCache.set(secret, imported);
	return imported;
}

function usableSecret(secret: string | undefined): secret is string {
	return typeof secret === 'string' && textEncoder.encode(secret).byteLength >= 32;
}

/** Issue only for a trusted agent result whose email was grounded before this call. */
export async function issuePublicRecipientProvenance(
	value: unknown,
	userId: string,
	secret: string,
	now = Date.now()
): Promise<PublicRecipientProvenance | null> {
	if (
		!isPlainRecord(value) ||
		value.isAiResolved !== true ||
		value.emailGrounded !== true ||
		!isPlainRecord(value.publicEmailGrounding) ||
		value.publicEmailGrounding.version !== 1 ||
		value.publicEmailGrounding.method !== 'page-read'
	) {
		return null;
	}
	if (!usableSecret(secret) || userId.length === 0) return null;
	const claims = normalizePublicRecipientProvenanceClaims(value);
	const groundingSource = normalizedPublicSource(value.publicEmailGrounding.source);
	if (!claims || !groundingSource || groundingSource !== claims.emailSource) return null;

	const expiresAt = now + PUBLIC_RECIPIENT_PROVENANCE_TTL_MS;
	const signature = new Uint8Array(
		await crypto.subtle.sign(
			'HMAC',
			await hmacKey(secret),
			toArrayBuffer(textEncoder.encode(canonicalPayload(claims, userId, expiresAt)))
		)
	);
	return {
		version: PUBLIC_RECIPIENT_PROVENANCE_VERSION,
		expiresAt,
		signature: bytesToHex(signature)
	};
}

/** Every key this issuer can have written onto an attestation. Nothing else. */
const ATTESTATION_KEYS = new Set(['version', 'expiresAt', 'signature']);

/**
 * Refuse an attestation whose key set exceeds what the issuer writes.
 *
 * A closed key ALLOWLIST rather than a check on any named term: whatever the
 * extra key is called, the whole verification fails closed on it. Silently
 * ignoring an unknown key instead would be a second way to hand a reader an
 * object that says more than the issuer ever asserted, while the subset the MAC
 * actually covers verifies cleanly.
 */
function attestationKeysAreClosed(attestation: Record<string, unknown>): boolean {
	for (const key of Object.keys(attestation)) {
		if (!ATTESTATION_KEYS.has(key)) return false;
	}
	return true;
}

/**
 * Verify all rotation candidates without an early exit, then return only signed claims.
 *
 * Nothing is sourced from `value` except the claim set the preimage binds: the
 * row's own `emailReachesClaim` / `emailReachesLabel` are read nowhere in this
 * module, so an author who edits them changes nothing about what verifies.
 */
export async function verifyPublicRecipientProvenance(
	value: unknown,
	userId: string,
	secrets: readonly (string | undefined)[],
	now = Date.now()
): Promise<PublicRecipientProvenanceClaims | null> {
	if (!isPlainRecord(value) || !isPlainRecord(value.publicRecipientProvenance)) return null;
	const attestation = value.publicRecipientProvenance;
	if (
		attestation.version !== PUBLIC_RECIPIENT_PROVENANCE_VERSION ||
		typeof attestation.expiresAt !== 'number' ||
		!Number.isSafeInteger(attestation.expiresAt) ||
		attestation.expiresAt < now - PUBLIC_RECIPIENT_PROVENANCE_CLOCK_SKEW_MS ||
		attestation.expiresAt >
			now + PUBLIC_RECIPIENT_PROVENANCE_TTL_MS + PUBLIC_RECIPIENT_PROVENANCE_CLOCK_SKEW_MS ||
		typeof attestation.signature !== 'string' ||
		userId.length === 0
	) {
		return null;
	}
	const signature = hexToBytes(attestation.signature);
	const claims = normalizePublicRecipientProvenanceClaims(value);
	if (!signature || !claims || !attestationKeysAreClosed(attestation)) return null;
	const signed = claims;
	const payload = toArrayBuffer(
		textEncoder.encode(canonicalPayload(signed, userId, attestation.expiresAt))
	);
	let valid = false;
	for (const secret of secrets) {
		if (!usableSecret(secret)) continue;
		const matches = await crypto.subtle.verify(
			'HMAC',
			await hmacKey(secret),
			toArrayBuffer(signature),
			payload
		);
		valid = matches || valid;
	}
	return valid ? signed : null;
}
