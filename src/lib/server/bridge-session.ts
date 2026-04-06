/**
 * Cross-Device Verification Bridge — Session Model
 *
 * Ephemeral KV-backed sessions that mediate verification between
 * Device A (desktop, no DC-API) and Device B (phone, has DC-API).
 *
 * The bridge session replaces authentication on Device B:
 * sessionId + secret IS the authorization (QR = shared secret,
 * same security model as CTAP2 hybrid transport).
 *
 * Privacy: raw credential data never reaches Device A. Phone → server
 * privacy boundary → derived facts only via SSE. Stronger than same-device.
 *
 * Encryption: Sensitive fields (secret, ephemeralPrivateKeyJwk, desktopUserLabel,
 * requests, nonce) are AES-256-GCM encrypted before KV storage when an encryption
 * key is available. See bridge-crypto.ts.
 *
 * TTL: 5 minutes. One-time transitions: pending → claimed → completed.
 */

import {
	encryptBridgeFields,
	decryptBridgeFields,
	type EncryptedBlob,
	type SensitiveFields
} from './bridge-crypto.js';

// Dev fallback (mirrors verify-mdl/_dev-session-store.ts pattern)
const devBridgeStore = new Map<string, { data: string; expires: number }>();
if (typeof setInterval !== 'undefined') {
	setInterval(() => {
		const now = Date.now();
		for (const [key, value] of devBridgeStore) {
			if (value.expires < now) devBridgeStore.delete(key);
		}
	}, 60_000);
}

// ---------- Types ----------

export interface BridgeSession {
	id: string;
	desktopUserId: string;
	/** User-recognizable display string (email/name) — anti-phishing on mobile */
	desktopUserLabel: string;
	secret: string; // 32-byte hex — HMAC key + QR proof
	nonce: string; // replay protection, passed to mDL start
	/** Human-verifiable pairing code (3 words). User visually matches across devices. */
	pairingCode: string;
	ephemeralPrivateKeyJwk: JsonWebKey;
	/** Dual-protocol mDL request configs (org-iso-mdoc + openid4vp) */
	requests: Array<{ protocol: string; data: unknown }>;
	status: 'pending' | 'claimed' | 'completed' | 'failed';
	result?: BridgeResult;
	createdAt: number;
	claimedAt?: number;
	completedAt?: number;
	errorMessage?: string;
	/** AES-256-GCM encrypted blob of sensitive fields (when encryption key available) */
	encrypted?: EncryptedBlob;
}

/** BIP39-inspired wordlist for pairing codes — short, unambiguous, memorable */
const PAIRING_WORDS = [
	'apple', 'bridge', 'candle', 'dolphin', 'ember', 'forest', 'garden', 'harbor',
	'island', 'jungle', 'kettle', 'lantern', 'meadow', 'needle', 'ocean', 'pillar',
	'quartz', 'river', 'sunset', 'thunder', 'umbrella', 'valley', 'window', 'yellow',
	'zebra', 'arrow', 'beacon', 'compass', 'dagger', 'engine', 'feather', 'glacier',
	'hammer', 'iron', 'journey', 'knot', 'ladder', 'mirror', 'nectar', 'orbit',
	'prism', 'quill', 'ribbon', 'shadow', 'temple', 'velvet', 'walnut', 'anchor',
	'blanket', 'crystal', 'desert', 'echo', 'fabric', 'granite', 'hollow', 'ivory',
	'jasper', 'kernel', 'lumber', 'marble', 'nomad', 'opal', 'pebble', 'quiet'
];

function generatePairingCode(): string {
	const bytes = new Uint8Array(3);
	crypto.getRandomValues(bytes);
	return [
		PAIRING_WORDS[bytes[0] % PAIRING_WORDS.length],
		PAIRING_WORDS[bytes[1] % PAIRING_WORDS.length],
		PAIRING_WORDS[bytes[2] % PAIRING_WORDS.length]
	].join('-');
}

export interface BridgeResult {
	district: string;
	state: string;
	credentialHash: string;
	cellId?: string;
	identityCommitment?: string;
	identityCommitmentBound?: boolean;
}

type KV = { get(key: string): Promise<string | null>; put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>; delete(key: string): Promise<void> };
type Platform = { env?: { BRIDGE_SESSION_KV?: KV; DC_SESSION_KV?: KV } };

const BRIDGE_TTL = 300; // 5 minutes
const KV_PREFIX = 'bridge:';

// ---------- KV helpers ----------

function getKv(platform?: Platform): KV | null {
	return platform?.env?.BRIDGE_SESSION_KV ?? platform?.env?.DC_SESSION_KV ?? null;
}

async function kvPut(key: string, session: BridgeSession, platform?: Platform): Promise<void> {
	// Encrypt sensitive fields if an encryption key is available
	const sensitiveFields: SensitiveFields = {
		secret: session.secret,
		ephemeralPrivateKeyJwk: session.ephemeralPrivateKeyJwk,
		desktopUserLabel: session.desktopUserLabel,
		requests: session.requests,
		nonce: session.nonce
	};
	const blob = await encryptBridgeFields(session.id, sensitiveFields);

	let toStore: BridgeSession;
	if (blob) {
		// Store encrypted blob, redact sensitive plaintext fields
		toStore = {
			...session,
			encrypted: blob,
			secret: '',
			ephemeralPrivateKeyJwk: {} as JsonWebKey,
			desktopUserLabel: '',
			requests: [],
			nonce: ''
		};
	} else {
		// No encryption key — store plaintext (dev only)
		toStore = session;
	}

	const data = JSON.stringify(toStore);
	const kv = getKv(platform);
	if (kv) {
		await kv.put(KV_PREFIX + key, data, { expirationTtl: BRIDGE_TTL });
	} else {
		devBridgeStore.set(KV_PREFIX + key, {
			data,
			expires: Date.now() + BRIDGE_TTL * 1000
		});
	}
}

async function kvGet(key: string, platform?: Platform): Promise<BridgeSession | null> {
	const kv = getKv(platform);
	let raw: string | null = null;
	if (kv) {
		raw = await kv.get(KV_PREFIX + key);
	} else {
		const stored = devBridgeStore.get(KV_PREFIX + key);
		if (stored && stored.expires > Date.now()) {
			raw = stored.data;
		} else if (stored) {
			devBridgeStore.delete(KV_PREFIX + key);
		}
	}
	if (!raw) return null;
	try {
		const session = JSON.parse(raw) as BridgeSession;
		// Decrypt sensitive fields if encrypted blob is present
		if (session.encrypted) {
			const fields = await decryptBridgeFields(session.id, session.encrypted);
			session.secret = fields.secret;
			session.ephemeralPrivateKeyJwk = fields.ephemeralPrivateKeyJwk;
			session.desktopUserLabel = fields.desktopUserLabel;
			session.requests = fields.requests;
			session.nonce = fields.nonce;
			delete session.encrypted;
		}
		return session;
	} catch {
		return null;
	}
}

async function kvDelete(key: string, platform?: Platform): Promise<void> {
	const kv = getKv(platform);
	if (kv) {
		await kv.delete(KV_PREFIX + key);
	} else {
		devBridgeStore.delete(KV_PREFIX + key);
	}
}

// ---------- HMAC ----------

async function computeHmac(secret: string, ...parts: string[]): Promise<string> {
	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey(
		'raw',
		hexToBytes(secret) as BufferSource,
		{ name: 'HMAC', hash: { name: 'SHA-256' } } as HmacImportParams,
		false,
		['sign']
	);
	const message = parts.join('|');
	const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
	return bytesToHex(new Uint8Array(sig));
}

export async function verifyHmac(
	secret: string,
	hmac: string,
	...parts: string[]
): Promise<boolean> {
	const expected = await computeHmac(secret, ...parts);
	// Constant-time comparison
	if (expected.length !== hmac.length) return false;
	let diff = 0;
	for (let i = 0; i < expected.length; i++) {
		diff |= expected.charCodeAt(i) ^ hmac.charCodeAt(i);
	}
	return diff === 0;
}

export async function generateHmac(secret: string, ...parts: string[]): Promise<string> {
	return computeHmac(secret, ...parts);
}

// ---------- Lifecycle ----------

export async function createBridgeSession(
	desktopUserId: string,
	desktopUserLabel: string,
	requests: Array<{ protocol: string; data: unknown }>,
	ephemeralPrivateKeyJwk: JsonWebKey,
	nonce: string,
	origin: string,
	platform?: Platform
): Promise<{ sessionId: string; secret: string; qrUrl: string; pairingCode: string; expiresAt: number }> {
	const sessionId = crypto.randomUUID();
	const secretBytes = new Uint8Array(32);
	crypto.getRandomValues(secretBytes);
	const secret = bytesToHex(secretBytes);
	const pairingCode = generatePairingCode();

	const session: BridgeSession = {
		id: sessionId,
		desktopUserId,
		desktopUserLabel,
		secret,
		nonce,
		pairingCode,
		ephemeralPrivateKeyJwk,
		requests,
		status: 'pending',
		createdAt: Date.now()
	};

	await kvPut(sessionId, session, platform);

	// Secret in URL fragment — fragments never hit the server, never appear
	// in logs, never leak via Referer headers. Mobile page reads via window.location.hash.
	const qrUrl = `${origin}/verify-bridge/${sessionId}#${secret}`;
	return { sessionId, secret, qrUrl, pairingCode, expiresAt: Date.now() + BRIDGE_TTL * 1000 };
}

/**
 * Best-effort claim transition. Returns false if session not in pending state.
 * Note: Workers KV is eventually consistent — this read-modify-write is NOT
 * atomic. Defense-in-depth via HMAC + /complete 409. True atomicity requires
 * Durable Objects; see docs/design/CROSS-DEVICE-BRIDGE.md for upgrade path.
 */
export async function claimBridgeSessionBestEffort(
	sessionId: string,
	platform?: Platform
): Promise<boolean> {
	const session = await kvGet(sessionId, platform);
	if (!session) return false;
	if (session.status !== 'pending') return false;

	session.status = 'claimed';
	session.claimedAt = Date.now();
	await kvPut(sessionId, session, platform);
	return true;
}

export async function completeBridgeSession(
	sessionId: string,
	result: BridgeResult,
	platform?: Platform
): Promise<void> {
	const session = await kvGet(sessionId, platform);
	if (!session) throw new Error('Bridge session not found or expired');
	if (session.status !== 'claimed') throw new Error(`Cannot complete session in ${session.status} state`);

	session.status = 'completed';
	session.result = result;
	session.completedAt = Date.now();
	// Clear sensitive material — result is the only thing SSE needs now
	session.secret = '';
	session.ephemeralPrivateKeyJwk = {} as JsonWebKey;
	await kvPut(sessionId, session, platform);
}

export async function failBridgeSession(
	sessionId: string,
	errorMessage: string,
	platform?: Platform
): Promise<void> {
	const session = await kvGet(sessionId, platform);
	if (!session) return; // Already expired
	// Guard: never overwrite a completed session (race with successful completion)
	if (session.status === 'completed') return;
	session.status = 'failed';
	session.errorMessage = errorMessage;
	// Clear sensitive material
	session.secret = '';
	session.ephemeralPrivateKeyJwk = {} as JsonWebKey;
	await kvPut(sessionId, session, platform);
}

export async function getBridgeSession(
	sessionId: string,
	platform?: Platform
): Promise<BridgeSession | null> {
	return kvGet(sessionId, platform);
}

export async function deleteBridgeSession(
	sessionId: string,
	platform?: Platform
): Promise<void> {
	await kvDelete(sessionId, platform);
}

// ---------- Utilities ----------

function hexToBytes(hex: string): Uint8Array {
	const bytes = new Uint8Array(hex.length / 2);
	for (let i = 0; i < hex.length; i += 2) {
		bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
	}
	return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
	return Array.from(bytes)
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}
