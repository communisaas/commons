const SESSION_COOKIE_VERSION = 'v1' as const;
const SESSION_COOKIE_DOMAIN = 'commons:auth-session-cookie:v1';
const SESSION_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const SIGNATURE_RE = /^[A-Za-z0-9_-]{43}$/;
const EXPIRY_RE = /^[1-9][0-9]{9,12}$/;
const SESSION_COOKIE_MAX_LENGTH = 192;
const SESSION_COOKIE_MAX_FUTURE_MS = 91 * 24 * 60 * 60 * 1000;
const SESSION_SECRET_MIN_BYTES = 32;
const SESSION_SECRET_MAX_BYTES = 1024;

type ParsedSessionCookie = {
	version: typeof SESSION_COOKIE_VERSION;
	sessionId: string;
	expiresAt: number;
	signature: string;
};

export type SessionCookieVerification =
	| {
			valid: true;
			sessionId: string;
			expiresAt: number;
			needsReseal: boolean;
	  }
	| { valid: false; reason: string };

type SessionCookieAuthorityResult<T> =
	| { status: 'missing' }
	| { status: 'invalid'; reason: string }
	| {
			status: 'verified';
			sessionId: string;
			cookieExpiresAt: number;
			needsReseal: boolean;
			authority: T;
	  };

type SessionCookieSigningSecrets = {
	activeSecret: string;
	previousSecret?: string;
};

function assertSecret(secret: string | undefined, label: string): string {
	if (!secret) throw new Error(`${label}_NOT_CONFIGURED`);
	const bytes = new TextEncoder().encode(secret).byteLength;
	if (bytes < SESSION_SECRET_MIN_BYTES) throw new Error(`${label}_TOO_SHORT`);
	if (bytes > SESSION_SECRET_MAX_BYTES) throw new Error(`${label}_TOO_LARGE`);
	return secret;
}

/**
 * Resolve the Pages-only cookie keys and reject any reuse of a Convex session-
 * creation proof key. Cookie rotation may need a long overlap; creation-proof
 * rotation must remain a short in-flight window, so the domains cannot share
 * either their active or previous material.
 */
export function resolveSessionCookieSigningSecrets(input: {
	activeSecret: string | undefined;
	previousSecret?: string;
	sessionCreationSecret: string | undefined;
	previousSessionCreationSecret?: string;
}): SessionCookieSigningSecrets {
	const activeSecret = assertSecret(input.activeSecret, 'SESSION_COOKIE_SIGNING_SECRET');
	const sessionCreationSecret = assertSecret(
		input.sessionCreationSecret,
		'SESSION_CREATION_SECRET'
	);
	const disallowedCreationSecrets = new Set([sessionCreationSecret]);
	if (input.previousSessionCreationSecret !== undefined) {
		disallowedCreationSecrets.add(
			assertSecret(input.previousSessionCreationSecret, 'SESSION_CREATION_SECRET_PREVIOUS')
		);
	}
	if (disallowedCreationSecrets.has(activeSecret)) {
		throw new Error('SESSION_COOKIE_SIGNING_SECRET_REUSES_SESSION_CREATION_KEY');
	}

	if (input.previousSecret === undefined) return { activeSecret };
	const previousSecret = assertSecret(
		input.previousSecret,
		'SESSION_COOKIE_SIGNING_SECRET_PREVIOUS'
	);
	if (previousSecret === activeSecret) {
		throw new Error('SESSION_COOKIE_SIGNING_SECRET_PREVIOUS_EQUALS_ACTIVE');
	}
	if (disallowedCreationSecrets.has(previousSecret)) {
		throw new Error('SESSION_COOKIE_SIGNING_SECRET_PREVIOUS_REUSES_SESSION_CREATION_KEY');
	}
	return { activeSecret, previousSecret };
}

function signingInput(sessionId: string, expiresAt: number): Uint8Array {
	return new TextEncoder().encode(`${SESSION_COOKIE_DOMAIN}\0${sessionId}\0${expiresAt}`);
}

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	const copy = new Uint8Array(bytes.byteLength);
	copy.set(bytes);
	return copy.buffer;
}

function bytesToBase64Url(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value: string): Uint8Array | null {
	if (!SIGNATURE_RE.test(value)) return null;
	try {
		const padded =
			value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
		const binary = atob(padded);
		const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
		if (bytes.byteLength !== 32 || bytesToBase64Url(bytes) !== value) return null;
		return bytes;
	} catch {
		return null;
	}
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
	return crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign', 'verify']
	);
}

/**
 * Parse and bound every attacker-controlled field before any cryptographic
 * work. Raw legacy session IDs deliberately fail this envelope parser.
 */
export function parseSessionCookieEnvelope(value: string, now: number): ParsedSessionCookie | null {
	if (!Number.isSafeInteger(now) || now < 0) return null;
	if (!value || value.length > SESSION_COOKIE_MAX_LENGTH) return null;
	const parts = value.split('.');
	if (parts.length !== 4) return null;
	const [version, sessionId, expiresAtRaw, signature] = parts;
	if (version !== SESSION_COOKIE_VERSION) return null;
	if (!SESSION_ID_RE.test(sessionId)) return null;
	if (!EXPIRY_RE.test(expiresAtRaw)) return null;
	if (!SIGNATURE_RE.test(signature)) return null;
	const expiresAt = Number(expiresAtRaw);
	if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) return null;
	if (expiresAt - now > SESSION_COOKIE_MAX_FUTURE_MS) return null;
	return { version, sessionId, expiresAt, signature };
}

/** Sign a versioned, purpose-bound cookie with the active cookie-only key. */
export async function sealSessionCookie(
	sessionId: string,
	expiresAt: number,
	secret: string | undefined
): Promise<string> {
	if (!SESSION_ID_RE.test(sessionId)) throw new Error('SESSION_COOKIE_SESSION_ID_INVALID');
	if (!Number.isSafeInteger(expiresAt) || expiresAt <= 0) {
		throw new Error('SESSION_COOKIE_EXPIRY_INVALID');
	}
	const activeSecret = assertSecret(secret, 'SESSION_COOKIE_SIGNING_SECRET');
	const key = await importHmacKey(activeSecret);
	const signature = bytesToBase64Url(
		new Uint8Array(
			await crypto.subtle.sign('HMAC', key, asArrayBuffer(signingInput(sessionId, expiresAt)))
		)
	);
	const value = `${SESSION_COOKIE_VERSION}.${sessionId}.${expiresAt}.${signature}`;
	if (value.length > SESSION_COOKIE_MAX_LENGTH)
		throw new Error('SESSION_COOKIE_ENVELOPE_TOO_LARGE');
	return value;
}

/**
 * Verify locally against the active secret, then the optional rotation secret.
 * Database authority remains mandatory after this cheap authenticity gate.
 */
export async function verifySessionCookie(
	value: string,
	options: {
		activeSecret: string | undefined;
		previousSecret?: string;
		now: number;
	}
): Promise<SessionCookieVerification> {
	const parsed = parseSessionCookieEnvelope(value, options.now);
	if (!parsed) return { valid: false, reason: 'SESSION_COOKIE_MALFORMED_OR_EXPIRED' };
	const signature = base64UrlToBytes(parsed.signature);
	if (!signature) return { valid: false, reason: 'SESSION_COOKIE_SIGNATURE_MALFORMED' };
	const activeSecret = assertSecret(options.activeSecret, 'SESSION_COOKIE_SIGNING_SECRET');
	const input = signingInput(parsed.sessionId, parsed.expiresAt);
	const activeKey = await importHmacKey(activeSecret);
	if (
		await crypto.subtle.verify('HMAC', activeKey, asArrayBuffer(signature), asArrayBuffer(input))
	) {
		return {
			valid: true,
			sessionId: parsed.sessionId,
			expiresAt: parsed.expiresAt,
			needsReseal: false
		};
	}
	if (options.previousSecret !== undefined) {
		const previousSecret = assertSecret(
			options.previousSecret,
			'SESSION_COOKIE_SIGNING_SECRET_PREVIOUS'
		);
		const previousKey = await importHmacKey(previousSecret);
		if (
			await crypto.subtle.verify(
				'HMAC',
				previousKey,
				asArrayBuffer(signature),
				asArrayBuffer(input)
			)
		) {
			return {
				valid: true,
				sessionId: parsed.sessionId,
				expiresAt: parsed.expiresAt,
				needsReseal: true
			};
		}
	}
	return { valid: false, reason: 'SESSION_COOKIE_SIGNATURE_INVALID' };
}

/**
 * The only bridge from an untrusted cookie string to database session
 * authority. Invalid cookies are deleted and cannot invoke `queryAuthority`.
 */
export async function querySessionAuthorityFromCookie<T>(input: {
	cookieValue: string | undefined;
	activeSecret: string | undefined;
	previousSecret?: string;
	now: number;
	onInvalid: () => void;
	queryAuthority: (sessionId: string) => Promise<T>;
}): Promise<SessionCookieAuthorityResult<T>> {
	if (!input.cookieValue) return { status: 'missing' };
	const verified = await verifySessionCookie(input.cookieValue, {
		activeSecret: input.activeSecret,
		previousSecret: input.previousSecret,
		now: input.now
	});
	if (!verified.valid) {
		input.onInvalid();
		return { status: 'invalid', reason: verified.reason };
	}
	const authority = await input.queryAuthority(verified.sessionId);
	return {
		status: 'verified',
		sessionId: verified.sessionId,
		cookieExpiresAt: verified.expiresAt,
		needsReseal: verified.needsReseal,
		authority
	};
}
