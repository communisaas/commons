/**
 * Browser-side encryption for identity blobs
 *
 * Implements XChaCha20-Poly1305 authenticated encryption for address data.
 * Blobs are encrypted to TEE public key before storage.
 *
 * Phase 1: Convex storage (platform cannot decrypt)
 * Phase 2: IPFS storage + on-chain pointers (portable credentials)
 */

import sodium from 'libsodium-wrappers';

/**
 * Identity blob contents (encrypted to TEE)
 */
export interface IdentityBlob {
	// REQUIRED: Congressional delivery
	address: {
		street: string;
		city: string;
		state: string;
		zip: string;
	};

	// REQUIRED: Identity verification proof
	verificationCredential: {
		provider: 'digital-credentials-api';
		credentialHash: string;
		issuedAt: number;
		expiresAt?: number;
	};

	// OPTIONAL: Enhanced functionality
	district?: {
		congressional: string; // "TX-21"
		stateSenate?: string;
		stateHouse?: string;
		cityCouncil?: string;
	};

	// OPTIONAL: Template personalization
	templateData?: {
		preferredName?: string;
		customSignature?: string;
		savedTemplates?: string[]; // IPFS hashes
	};
}

/**
 * Encrypted blob format
 */
export interface EncryptedBlob {
	ciphertext: string; // Base64-encoded
	nonce: string; // Base64-encoded
	publicKey: string; // TEE public key used (Base64-encoded)
	version: string; // Encryption version
	timestamp: number; // Unix timestamp
}

/**
 * TEE public key (fetched from server)
 */
export interface TEEPublicKey {
	publicKey: Uint8Array;
	keyId: string;
	expiresAt?: number;
}

/**
 * Initialize libsodium (must be called before encryption)
 */
export async function initCrypto(): Promise<void> {
	await sodium.ready;
}

/**
 * Fetch TEE public key from server
 *
 * In Phase 1, this fetches AWS Nitro Enclave public key.
 * In Phase 2, this might be cached on-chain.
 */
export async function fetchTEEPublicKey(): Promise<TEEPublicKey> {
	const response = await fetch('/api/tee/public-key');
	if (!response.ok) {
		throw new Error(`Failed to fetch TEE public key: ${response.statusText}`);
	}

	const data = await response.json();

	// /api/tee/public-key returns hex-encoded X25519 key (0x-prefixed)
	const hexKey = (data.publicKey as string).replace(/^0x/, '');
	const keyBytes = new Uint8Array(hexKey.length / 2);
	for (let i = 0; i < hexKey.length; i += 2) {
		keyBytes[i / 2] = parseInt(hexKey.substr(i, 2), 16);
	}

	return {
		publicKey: keyBytes,
		keyId: data.keyId,
		expiresAt: data.expiresAt
	};
}

/**
 * Encrypt identity blob to TEE public key
 *
 * Uses XChaCha20-Poly1305 authenticated encryption:
 * - 192-bit nonce (safe for random generation)
 * - 256-bit key derived from X25519 key exchange
 * - Authenticated encryption (prevents tampering)
 *
 * @param blob - Identity data to encrypt
 * @param teePublicKey - TEE public key (from fetchTEEPublicKey)
 * @returns Encrypted blob ready for storage
 */
export async function encryptIdentityBlob(
	blob: IdentityBlob,
	teePublicKey: TEEPublicKey
): Promise<EncryptedBlob> {
	await initCrypto();

	// Generate ephemeral keypair for this encryption
	const ephemeralKeypair = sodium.crypto_box_keypair();

	// Serialize blob to JSON and convert to Uint8Array
	const plaintext = JSON.stringify(blob);

	// Generate random nonce for crypto_box (24 bytes)
	const nonce = sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES);

	// Encrypt using crypto_box (X25519-XChaCha20-Poly1305)
	// This combines X25519 key exchange with XChaCha20-Poly1305 authenticated encryption
	const ciphertext = sodium.crypto_box_easy(
		plaintext,
		nonce,
		teePublicKey.publicKey,
		ephemeralKeypair.privateKey
	);

	return {
		ciphertext: sodium.to_base64(ciphertext, sodium.base64_variants.ORIGINAL),
		nonce: sodium.to_base64(nonce, sodium.base64_variants.ORIGINAL),
		publicKey: sodium.to_base64(ephemeralKeypair.publicKey, sodium.base64_variants.ORIGINAL),
		version: '1.0.0',
		timestamp: Date.now()
	};
}

/**
 * Storage interface for encrypted blobs
 *
 * Phase 1: Convex via API
 * Phase 2: IPFS + on-chain pointer
 */
export interface BlobStorage {
	store(userId: string, blob: EncryptedBlob): Promise<string>; // Returns blob ID or CID
	retrieve(userId: string): Promise<EncryptedBlob | null>;
	delete(userId: string): Promise<void>;
}

/**
 * Phase 1: Convex-backed blob storage (HTTP-bridged from browser to /api/identity/*)
 */
export class ServerBlobStorage implements BlobStorage {
	async store(userId: string, blob: EncryptedBlob): Promise<string> {
		const response = await fetch('/api/identity/store-blob', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ userId, blob })
		});

		if (!response.ok) {
			throw new Error(`Failed to store encrypted blob: ${response.statusText}`);
		}

		const data = await response.json();
		return data.blobId;
	}

	async retrieve(userId: string): Promise<EncryptedBlob | null> {
		const response = await fetch(
			`/api/identity/retrieve-blob?userId=${encodeURIComponent(userId)}`
		);

		if (response.status === 404) {
			return null;
		}

		if (!response.ok) {
			throw new Error(`Failed to retrieve encrypted blob: ${response.statusText}`);
		}

		const data = await response.json();
		return data.blob;
	}

	async delete(userId: string): Promise<void> {
		const response = await fetch('/api/identity/delete-blob', {
			method: 'DELETE',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ userId })
		});

		if (!response.ok) {
			throw new Error(`Failed to delete encrypted blob: ${response.statusText}`);
		}
	}
}

/**
 * Get active storage implementation
 *
 * Phase 1: Always server-backed (Convex via `/api/identity/*`)
 * Phase 2: IPFS for new users, server-backed for legacy
 */
export function getBlobStorage(): BlobStorage {
	// TODO: Phase 2 - Check feature flag or user preference
	return new ServerBlobStorage();
}

/**
 * Validate encrypted blob structure
 *
 * Checks that all required fields are present and have valid types.
 * Does NOT validate cryptographic integrity (that requires the TEE private key).
 *
 * @param blob - Object to validate
 * @returns true if blob has valid EncryptedBlob structure
 */
export function isValidEncryptedBlob(blob: unknown): blob is EncryptedBlob {
	if (blob === null || blob === undefined || typeof blob !== 'object') {
		return false;
	}

	const candidate = blob as Record<string, unknown>;

	// Check required fields exist and have correct types
	if (typeof candidate.ciphertext !== 'string' || candidate.ciphertext.length === 0) {
		return false;
	}

	if (typeof candidate.nonce !== 'string' || candidate.nonce.length === 0) {
		return false;
	}

	if (typeof candidate.publicKey !== 'string' || candidate.publicKey.length === 0) {
		return false;
	}

	if (typeof candidate.version !== 'string' || candidate.version.length === 0) {
		return false;
	}

	if (typeof candidate.timestamp !== 'number' || candidate.timestamp <= 0) {
		return false;
	}

	return true;
}
