import type { PlatformSource } from '$lib/data/platform-export-profiles';

const VERSION = 'platform-api-token-v1';
const SALT = 'commons-platform-api-token-custody-v1';
const KEY_ENV = 'PLATFORM_API_CREDENTIAL_ENCRYPTION_KEY';
const FALLBACK_KEY_ENV = 'OAUTH_ENCRYPTION_KEY';

export type PlatformApiSource = Exclude<PlatformSource, 'csv'>;

export type EncryptedPlatformApiCredential = {
	version: typeof VERSION;
	source: PlatformApiSource;
	ciphertext: string;
	iv: string;
	storedAt: number;
	keySource: typeof KEY_ENV | typeof FALLBACK_KEY_ENV;
};

function getMasterKey(): { hex: string; source: typeof KEY_ENV | typeof FALLBACK_KEY_ENV } | null {
	const platformKey = process.env[KEY_ENV];
	if (platformKey) return { hex: platformKey, source: KEY_ENV };
	const fallback = process.env[FALLBACK_KEY_ENV];
	if (fallback) return { hex: fallback, source: FALLBACK_KEY_ENV };
	return null;
}

export function hasPlatformApiCredentialKey(): boolean {
	const key = getMasterKey();
	return Boolean(key && normalizeHexKey(key.hex).length === 64);
}

function normalizeHexKey(hex: string): string {
	return hex.startsWith('0x') ? hex.slice(2) : hex;
}

function hexToBytes(hex: string): Uint8Array {
	const clean = normalizeHexKey(hex);
	if (clean.length !== 64) {
		throw new Error(`${KEY_ENV} must be 32 bytes encoded as 64 hex characters`);
	}
	const bytes = new Uint8Array(clean.length / 2);
	for (let i = 0; i < bytes.length; i++) {
		bytes[i] = Number.parseInt(clean.substring(i * 2, i * 2 + 2), 16);
	}
	return bytes;
}

async function importMasterKey(hex: string): Promise<CryptoKey> {
	return crypto.subtle.importKey('raw', hexToBytes(hex) as BufferSource, 'HKDF', false, [
		'deriveKey'
	]);
}

async function deriveCredentialKey(
	masterKey: CryptoKey,
	orgSlug: string,
	source: PlatformApiSource
): Promise<CryptoKey> {
	const encoder = new TextEncoder();
	return crypto.subtle.deriveKey(
		{
			name: 'HKDF',
			hash: 'SHA-256',
			salt: encoder.encode(SALT),
			info: encoder.encode(`${VERSION}:${orgSlug}:${source}`)
		},
		masterKey,
		{ name: 'AES-GCM', length: 256 },
		false,
		['encrypt', 'decrypt']
	);
}

function bytesToBase64(bytes: Uint8Array): string {
	let binary = '';
	for (let i = 0; i < bytes.length; i++) {
		binary += String.fromCharCode(bytes[i]);
	}
	return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

export async function sealPlatformApiCredential(
	plaintext: string,
	input: { orgSlug: string; source: PlatformApiSource; storedAt?: number }
): Promise<EncryptedPlatformApiCredential> {
	const key = getMasterKey();
	if (!key) {
		throw new Error(`${KEY_ENV} is not configured`);
	}
	const masterKey = await importMasterKey(key.hex);
	const credentialKey = await deriveCredentialKey(masterKey, input.orgSlug, input.source);
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const ciphertext = await crypto.subtle.encrypt(
		{ name: 'AES-GCM', iv },
		credentialKey,
		new TextEncoder().encode(plaintext)
	);

	return {
		version: VERSION,
		source: input.source,
		ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
		iv: bytesToBase64(iv),
		storedAt: input.storedAt ?? Date.now(),
		keySource: key.source
	};
}

export async function openPlatformApiCredential(
	encrypted: EncryptedPlatformApiCredential,
	input: { orgSlug: string }
): Promise<string> {
	const key = getMasterKey();
	if (!key) {
		throw new Error(`${KEY_ENV} is not configured`);
	}
	const masterKey = await importMasterKey(key.hex);
	const credentialKey = await deriveCredentialKey(masterKey, input.orgSlug, encrypted.source);
	const iv = base64ToBytes(encrypted.iv) as BufferSource;
	const ciphertext = base64ToBytes(encrypted.ciphertext) as BufferSource;
	const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, credentialKey, ciphertext);
	return new TextDecoder().decode(plaintext);
}
