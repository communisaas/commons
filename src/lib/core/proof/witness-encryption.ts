/**
 * Witness Encryption Module
 *
 * Encrypts witness data (address + proof inputs) to TEE public key
 * Uses XChaCha20-Poly1305 for authenticated encryption via libsodium
 *
 * Flow:
 * 1. Generate ephemeral X25519 keypair
 * 2. Derive shared secret (X25519 ECDH with TEE public key)
 * 3. Derive encryption key (BLAKE2b)
 * 4. Encrypt witness with XChaCha20-Poly1305 (24-byte nonce)
 * 5. Return ciphertext + nonce + ephemeral public key
 *
 * Per COMMONS-ZK-IMPLEMENTATION-SPEC.md Phase 2
 */

import sodium from 'libsodium-wrappers';

/**
 * Witness data structure (v0.4.0 — three-tree architecture)
 * Contains all inputs needed for proof generation in TEE.
 * Matches ThreeTreeProofInputs: Tree 1 (user identity) + Tree 2 (cell-district SMT) + Tree 3 (engagement).
 * Nullifier computed IN-CIRCUIT from identityCommitment + actionDomain.
 */
export interface WitnessData {
	// Public inputs
	/** Root of Tree 1 (user identity Merkle tree) */
	userRoot: string;
	/** Root of Tree 2 (cell-district mapping sparse Merkle tree) */
	cellMapRoot: string;
	/** All 24 district IDs for this cell */
	districts: string[];
	/** Anti-double-vote nullifier */
	nullifier: string;
	/** Contract-controlled action scope */
	actionDomain: string;
	/** User's voting tier (1-5) */
	authorityLevel: 1 | 2 | 3 | 4 | 5;
	/** Root of Tree 3 (engagement data tree) */
	engagementRoot: string;
	/** User's engagement tier (0-4) */
	engagementTier: 0 | 1 | 2 | 3 | 4;

	// Private inputs
	/** User's secret key material */
	userSecret: string;
	/** Cell ID as 0x-hex BN254 field element (for the leaf hash + circuit). */
	cellId: string;
	/**
	 * H3 cell string at H3_RESOLUTION — same hex-cell as cellId in a different
	 * encoding. Carried alongside cellId so the TEE delivery resolver can
	 * compare H3-to-H3 with the address-derived H3 from resolveAddress (G7).
	 * Optional during the migration window — pre-G7 credentials don't have it,
	 * and the resolver falls through to the prior comparison path with a
	 * warning when missing.
	 */
	h3Cell?: string;
	/** Random salt from registration */
	registrationSalt: string;
	/** Identity commitment for nullifier derivation and engagement binding */
	identityCommitment: string;

	// Tree 1 proof data
	/** Tree 1 Merkle siblings */
	userPath: string[];
	/** Leaf position in Tree 1 */
	userIndex: number;

	// Tree 2 proof data (Sparse Merkle Tree)
	/** Tree 2 SMT siblings */
	cellMapPath: string[];
	/** Tree 2 SMT direction bits */
	cellMapPathBits: number[];

	// Tree 3 proof data (Engagement Tree)
	/** Tree 3 Merkle siblings */
	engagementPath: string[];
	/** Leaf position in Tree 3 */
	engagementIndex: number;
	/** Cumulative action count */
	actionCount: string;
	/** Shannon diversity score */
	diversityScore: string;

	/** Delivery data for congressional message (encrypted, not used in proof) */
	deliveryAddress?: {
		name: string;
		email: string;
		street: string;
		city: string;
		state: string;
		zip: string;
		phone?: string;
		congressional_district?: string;
	};
}

/**
 * Encrypted witness result
 */
export interface EncryptedWitness {
	/** Base64-encoded ciphertext */
	ciphertext: string;
	/** Base64-encoded nonce (24 bytes for XChaCha20) */
	nonce: string;
	/** Hex-encoded ephemeral public key for ECDH */
	ephemeralPublicKey: string;
	/** TEE key ID used for encryption */
	teeKeyId: string;
}

/**
 * Server public key for witness encryption (fetched from /api/tee/public-key)
 */
interface TEEPublicKey {
	keyId: string;
	publicKey: string; // Hex-encoded X25519 public key
}

// Cache TEE public key for 1 hour
let cachedTEEKey: TEEPublicKey | null = null;
let cacheExpiry: number = 0;

/**
 * Fetch TEE public key from backend
 * Cached for 1 hour to reduce API calls
 */
async function getTEEPublicKey(): Promise<TEEPublicKey> {
	const now = Date.now();

	// Return cached key if still valid
	if (cachedTEEKey && now < cacheExpiry) {
		return cachedTEEKey;
	}

	// Fetch fresh key with retries
	const maxAttempts = 3;
	let lastError: Error | undefined;

	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		try {
			const response = await fetch('/api/tee/public-key', {
				signal: AbortSignal.timeout(5000),
			});

			if (response.status === 503 && attempt < maxAttempts - 1) {
				await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
				continue;
			}

			if (!response.ok) {
				throw new Error(`TEE key fetch failed (${response.status})`);
			}

			const data = await response.json();

			if (!data.success || !data.keyId || !data.publicKey) {
				throw new Error('Invalid TEE public key response');
			}

			cachedTEEKey = {
				keyId: data.keyId,
				publicKey: data.publicKey
			};

			cacheExpiry = now + 60 * 60 * 1000;

			return cachedTEEKey;
		} catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error));
			if (attempt < maxAttempts - 1) {
				await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
			}
		}
	}

	throw new Error(`Witness encryption service unavailable: ${lastError?.message}`);
}

/**
 * Encrypt witness data to TEE public key
 *
 * Uses XChaCha20-Poly1305 for authenticated encryption via libsodium.
 * Derives shared secret via X25519 ECDH with ephemeral keypair.
 *
 * @param witness - Witness data to encrypt
 * @returns Encrypted witness with nonce and ephemeral public key
 */
export async function encryptWitness(witness: WitnessData): Promise<EncryptedWitness> {
	try {
		await sodium.ready;

		// Step 1: Get TEE public key (X25519)
		const teeKey = await getTEEPublicKey();

		// Step 2: Generate ephemeral X25519 keypair
		const ephemeralKeypair = sodium.crypto_box_keypair();

		// Step 3: Derive shared secret via X25519 ECDH
		const teePublicKeyBytes = hexToBytes(teeKey.publicKey);
		const sharedSecret = sodium.crypto_scalarmult(
			ephemeralKeypair.privateKey,
			teePublicKeyBytes
		);

		// Step 4: Derive encryption key from shared secret (BLAKE2b keyed hash)
		const encryptionKey = sodium.crypto_generichash(
			32, // 32 bytes for XChaCha20-Poly1305
			sharedSecret,
			// FROZEN: changing this domain would break decryption of existing witness ciphertexts
			sodium.from_string('commons-witness-encryption-v1')
		);

		// Step 5: Generate random 24-byte nonce (full XChaCha20 nonce, no truncation)
		const nonce = sodium.randombytes_buf(
			sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES // 24 bytes
		);

		// Step 6: Serialize witness to JSON
		const witnessBytes = sodium.from_string(JSON.stringify(witness));

		// Step 7: Encrypt with XChaCha20-Poly1305 (AEAD)
		const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
			witnessBytes,
			null, // no additional authenticated data
			null, // no secret nonce
			nonce,
			encryptionKey
		);

		// Step 8: Return encrypted witness
		return {
			ciphertext: sodium.to_base64(ciphertext, sodium.base64_variants.ORIGINAL),
			nonce: sodium.to_base64(nonce, sodium.base64_variants.ORIGINAL),
			ephemeralPublicKey: bytesToHex(ephemeralKeypair.publicKey),
			teeKeyId: teeKey.keyId
		};
	} catch (error) {
		console.error('[Witness Encryption] Encryption failed:', error);
		throw new Error(
			`Failed to encrypt witness: ${error instanceof Error ? error.message : 'Unknown error'}`
		);
	}
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Convert hex string to Uint8Array
 */
function hexToBytes(hex: string): Uint8Array {
	const cleanHex = hex.replace(/^0x/, '');
	const bytes = new Uint8Array(cleanHex.length / 2);
	for (let i = 0; i < cleanHex.length; i += 2) {
		bytes[i / 2] = parseInt(cleanHex.substr(i, 2), 16);
	}
	return bytes;
}

/**
 * Convert Uint8Array to hex string
 */
function bytesToHex(bytes: Uint8Array): string {
	return (
		'0x' +
		Array.from(bytes)
			.map((b) => b.toString(16).padStart(2, '0'))
			.join('')
	);
}

/**
 * Convert base64 string to Uint8Array
 */
export function base64ToBytes(base64: string): Uint8Array {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}
