/**
 * Client-Side PII Encryption — user-custodied keys
 *
 * Derives a PII-specific AES-256-GCM key from the device master key
 * (already in IndexedDB) via HKDF with a distinct salt. The server
 * never holds this key — it stores opaque ciphertext.
 *
 * Key derivation:
 *   HKDF(deviceMasterKey, salt="commons-pii-v1", info=userId) → AES-256-GCM
 *
 * Domain separation from credential encryption:
 *   credentials: salt="commons-credential-v2"
 *   PII:         salt="commons-pii-v1"
 *
 * Same master key, cryptographically independent derived keys.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const PII_HKDF_SALT = encoder.encode('commons-pii-v1');

export interface ClientEncryptedPii {
	ciphertext: string; // base64
	iv: string; // base64
	v: 'client-1'; // version tag — server uses this to distinguish from server-encrypted blobs
}

// Re-use the existing device master key infrastructure
async function getDeviceMasterBytes(): Promise<ArrayBuffer> {
	// Dynamic import to avoid SSR — this module is client-only
	const { getOrCreateMasterBytes } = await import('$lib/core/identity/credential-encryption');
	return getOrCreateMasterBytes();
}

async function derivePiiKey(userId: string): Promise<CryptoKey> {
	const masterBytes = await getDeviceMasterBytes();

	const hkdfKey = await crypto.subtle.importKey(
		'raw',
		masterBytes,
		{ name: 'HKDF' },
		false,
		['deriveKey']
	);

	return crypto.subtle.deriveKey(
		{
			name: 'HKDF',
			hash: 'SHA-256',
			salt: PII_HKDF_SALT,
			info: encoder.encode(userId)
		},
		hkdfKey,
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

/**
 * Encrypt a PII field with the user's device-held key.
 * Returns an opaque blob the server cannot decrypt.
 */
export async function encryptPiiClient(
	plaintext: string,
	userId: string,
	fieldName: string
): Promise<ClientEncryptedPii> {
	const key = await derivePiiKey(userId);
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const aad = encoder.encode(`${userId}:${fieldName}`);

	const ciphertext = await crypto.subtle.encrypt(
		{ name: 'AES-GCM', iv, additionalData: aad },
		key,
		encoder.encode(plaintext)
	);

	return {
		ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
		iv: bytesToBase64(iv),
		v: 'client-1'
	};
}

/**
 * Decrypt a PII field with the user's device-held key.
 * Returns null if decryption fails (wrong device, cleared storage).
 */
export async function decryptPiiClient(
	encrypted: ClientEncryptedPii,
	userId: string,
	fieldName: string
): Promise<string | null> {
	try {
		const key = await derivePiiKey(userId);
		const ciphertext = base64ToBytes(encrypted.ciphertext);
		const iv = base64ToBytes(encrypted.iv);
		const aad = encoder.encode(`${userId}:${fieldName}`);

		const plaintext = await crypto.subtle.decrypt(
			{ name: 'AES-GCM', iv, additionalData: aad },
			key,
			ciphertext
		);

		return decoder.decode(plaintext);
	} catch {
		return null;
	}
}

/**
 * Encrypt email + name for upload to server.
 * Returns JSON-serialized encrypted blobs ready for storeClientEncryptedPii.
 */
export async function encryptUserPiiClient(
	email: string,
	name: string | null,
	userId: string
): Promise<{ encryptedEmail: string; encryptedName: string | null }> {
	const encEmail = await encryptPiiClient(email, userId, 'email');
	const encName = name ? await encryptPiiClient(name, userId, 'name') : null;

	return {
		encryptedEmail: JSON.stringify(encEmail),
		encryptedName: encName ? JSON.stringify(encName) : null
	};
}

/**
 * Decrypt email + name from server-returned encrypted blobs.
 * Returns null fields if decryption fails (device key unavailable).
 */
export async function decryptUserPiiClient(
	encryptedEmail: string | null,
	encryptedName: string | null,
	userId: string
): Promise<{ email: string | null; name: string | null }> {
	let email: string | null = null;
	let name: string | null = null;

	if (encryptedEmail) {
		try {
			const parsed: ClientEncryptedPii = JSON.parse(encryptedEmail);
			if (parsed.v === 'client-1') {
				email = await decryptPiiClient(parsed, userId, 'email');
			}
		} catch {
			// Not client-encrypted or parse failure
		}
	}

	if (encryptedName) {
		try {
			const parsed: ClientEncryptedPii = JSON.parse(encryptedName);
			if (parsed.v === 'client-1') {
				name = await decryptPiiClient(parsed, userId, 'name');
			}
		} catch {
			// Not client-encrypted or parse failure
		}
	}

	return { email, name };
}

/**
 * Check if client-side PII encryption is available.
 * Requires secure context + Web Crypto + IndexedDB.
 */
export function isClientPiiAvailable(): boolean {
	return (
		typeof globalThis !== 'undefined' &&
		typeof crypto?.subtle !== 'undefined' &&
		typeof indexedDB !== 'undefined' &&
		(globalThis.isSecureContext ?? true)
	);
}
