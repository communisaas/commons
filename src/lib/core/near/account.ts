/**
 * NEAR Implicit Account Creation & Key Management
 *
 * Server-only module that handles NEAR implicit accounts for non-crypto users.
 * Implicit accounts are free — the hex-encoded Ed25519 public key IS the account ID.
 * No on-chain transaction is needed to "create" the account.
 *
 * Multi-key architecture:
 *   - Primary key (FullAccess): generated at signup, AES-256-GCM encrypted, stored in DB
 *   - Recovery key (FullAccess): separate keypair, server-held,
 *     used to rotate the primary key on device loss. Must be FullAccess because
 *     AddKey/DeleteKey are system-level actions on NEAR that require FullAccess permission.
 *
 * Encryption uses the same encryptEntropy/decryptEntropy pattern from
 * src/lib/core/server/security.ts (AES-256-GCM with ENTROPY_ENCRYPTION_KEY).
 *
 * @module near/account
 */

import { KeyPairEd25519, PublicKey, keyToImplicitAddress } from '@near-js/crypto';
import { KeyPairSigner } from '@near-js/signers';
import { Account } from '@near-js/accounts';
import { JsonRpcProvider } from '@near-js/providers';
import { actionCreators } from '@near-js/transactions';
import { encryptEntropy, decryptEntropy, safeUserId } from '$lib/core/server/security';
import { db } from '$lib/core/db';
import { NEAR_RPC_TESTNET, NEAR_RPC_MAINNET } from '$lib/core/near/chain-signatures';

// =============================================================================
// Types
// =============================================================================

/** Public information about a user's NEAR account */
export interface NearAccountInfo {
	/** NEAR implicit account ID (64-char hex of Ed25519 public key) */
	accountId: string;
	/** Ed25519 public key in NEAR format (ed25519:base58...) */
	publicKey: string;
	/** Whether a recovery key has been provisioned */
	hasRecoveryKey: boolean;
	/** Scroll L2 address derived via NEAR Chain Signatures (if set) */
	scrollAddress: string | null;
}

/** Result of creating a new NEAR implicit account */
export interface NearAccountCreationResult {
	/** Whether the operation succeeded */
	success: boolean;
	/** Account info on success, null on failure */
	account: NearAccountInfo | null;
	/** Error message on failure */
	error?: string;
}

/** Decrypted NEAR keypair for signing operations */
export interface NearKeypairResult {
	/** Whether the operation succeeded */
	success: boolean;
	/** The Ed25519 keypair on success */
	keypair: KeyPairEd25519 | null;
	/** NEAR implicit account ID */
	accountId: string | null;
	/** Error message on failure */
	error?: string;
}

/** Result of key rotation */
export interface NearKeyRotationResult {
	/** Whether the rotation succeeded */
	success: boolean;
	/** New public key after rotation */
	newPublicKey: string | null;
	/** Error message on failure */
	error?: string;
}

/**
 * Internal structure for recovery key storage.
 * Stored as JSON in near_recovery_public_key DB field.
 * The public key is the on-chain portion; the encrypted private key
 * is server-held for recovery operations.
 */
interface RecoveryKeyBundle {
	/** Recovery public key in NEAR format (ed25519:base58...) */
	publicKey: string;
	/** AES-256-GCM encrypted recovery private key (base64) */
	encryptedPrivateKey: string;
}

// =============================================================================
// Constants
// =============================================================================

const LOG_PREFIX = '[near/account]';

/** NEAR testnet network ID */
export const NEAR_NETWORK_ID = 'testnet';

/** Re-export MPC signer constant so the sponsor endpoint import doesn't break. */
export { MPC_SIGNER_TESTNET as NEAR_MPC_SIGNER } from '$lib/core/near/chain-signatures';

// =============================================================================
// Internal Helpers
// =============================================================================

/**
 * Generate a new Ed25519 keypair using @near-js/crypto.
 * Returns the keypair and derived implicit account ID.
 */
function generateKeypair(): {
	keypair: KeyPairEd25519;
	accountId: string;
	publicKeyString: string;
} {
	const keypair = KeyPairEd25519.fromRandom();
	const publicKey = keypair.getPublicKey();
	const publicKeyString = publicKey.toString(); // "ed25519:base58..."
	const accountId = keyToImplicitAddress(publicKey);
	return { keypair, accountId, publicKeyString };
}

/**
 * Encrypt a NEAR private key for DB storage.
 * Uses the same AES-256-GCM pattern as entropy encryption.
 *
 * @param keypair - The Ed25519 keypair to encrypt
 * @returns Encrypted string safe for DB storage
 */
function encryptPrivateKey(keypair: KeyPairEd25519): string {
	// keypair.toString() returns "ed25519:base58EncodedExtendedSecretKey"
	const secretKeyString = keypair.toString();
	return encryptEntropy(secretKeyString);
}

/**
 * Decrypt a NEAR private key from DB storage.
 *
 * @param encrypted - The encrypted private key string from DB
 * @returns Reconstructed Ed25519 keypair
 * @throws If decryption fails or key format is invalid
 */
function decryptPrivateKey(encrypted: string): KeyPairEd25519 {
	const secretKeyString = decryptEntropy(encrypted);
	// KeyPairEd25519 constructor expects the extended secret key (base58)
	// secretKeyString is "ed25519:base58..." from keypair.toString()
	const prefix = 'ed25519:';
	const extendedSecretKey = secretKeyString.startsWith(prefix)
		? secretKeyString.slice(prefix.length)
		: secretKeyString;
	return new KeyPairEd25519(extendedSecretKey);
}

/**
 * Serialize a recovery key bundle to JSON for DB storage.
 */
function serializeRecoveryBundle(bundle: RecoveryKeyBundle): string {
	return JSON.stringify(bundle);
}

/**
 * Deserialize a recovery key bundle from DB storage.
 * Returns null if the stored value is not a valid JSON bundle
 * (handles legacy plain public key strings gracefully).
 */
function deserializeRecoveryBundle(stored: string): RecoveryKeyBundle | null {
	try {
		const parsed = JSON.parse(stored);
		if (
			typeof parsed === 'object' &&
			parsed !== null &&
			typeof parsed.publicKey === 'string' &&
			typeof parsed.encryptedPrivateKey === 'string'
		) {
			return parsed as RecoveryKeyBundle;
		}
		return null;
	} catch {
		// Not JSON — could be a legacy plain public key string
		return null;
	}
}

// =============================================================================
// On-chain Key Rotation
// =============================================================================

/**
 * Submit a batched key rotation transaction on-chain.
 *
 * Sends a single NEAR transaction with 4 actions:
 *   1. AddKey(newPrimaryPublicKey, FullAccess)
 *   2. DeleteKey(oldPrimaryPublicKey)
 *   3. AddKey(newRecoveryPublicKey, FullAccess)
 *   4. DeleteKey(oldRecoveryPublicKey)
 *
 * The transaction is signed by the current recovery keypair (since the primary
 * key is assumed compromised/lost). The receiver is the account itself — key
 * management on NEAR is a self-transaction.
 *
 * Both primary and recovery keys are FullAccess because AddKey/DeleteKey are
 * system-level implicit actions that require FullAccess permission on NEAR.
 *
 * @param accountId - The NEAR implicit account ID
 * @param recoveryKeypair - Current recovery keypair (used as the signer)
 * @param oldPrimaryPublicKey - Public key string of the old primary key to delete
 * @param newPrimaryKeypair - New primary keypair to add
 * @param oldRecoveryPublicKey - Public key string of the old recovery key to delete
 * @param newRecoveryKeypair - New recovery keypair to add
 * @param network - NEAR network ('testnet' or 'mainnet')
 * @throws If the on-chain transaction fails for any reason
 */
async function submitKeyRotationOnChain(
	accountId: string,
	recoveryKeypair: KeyPairEd25519,
	oldPrimaryPublicKey: string,
	newPrimaryKeypair: KeyPairEd25519,
	oldRecoveryPublicKey: string,
	newRecoveryKeypair: KeyPairEd25519,
	network: 'testnet' | 'mainnet' = 'testnet'
): Promise<void> {
	const rpcUrl = network === 'mainnet' ? NEAR_RPC_MAINNET : NEAR_RPC_TESTNET;
	const provider = new JsonRpcProvider({ url: rpcUrl });
	const signer = new KeyPairSigner(recoveryKeypair);
	const account = new Account(accountId, provider, signer);

	// Build the 4 key management actions as a single atomic batch.
	// Order matters: add new keys before deleting old ones to avoid
	// a window where the account has no usable keys.
	const actions = [
		actionCreators.addKey(
			PublicKey.from(newPrimaryKeypair.getPublicKey().toString()),
			actionCreators.fullAccessKey()
		),
		actionCreators.deleteKey(
			PublicKey.from(oldPrimaryPublicKey)
		),
		actionCreators.addKey(
			PublicKey.from(newRecoveryKeypair.getPublicKey().toString()),
			actionCreators.fullAccessKey()
		),
		actionCreators.deleteKey(
			PublicKey.from(oldRecoveryPublicKey)
		)
	];

	console.log(
		`${LOG_PREFIX} Submitting on-chain key rotation for ${accountId} on ${network}. ` +
			`Actions: AddKey(newPrimary), DeleteKey(oldPrimary), AddKey(newRecovery), DeleteKey(oldRecovery)`
	);

	// signAndSendTransaction sends a self-transaction (receiverId = accountId)
	// with the 4 batched actions. NEAR processes them atomically — if any
	// action fails, the entire transaction reverts.
	const outcome = await account.signAndSendTransaction({
		receiverId: accountId,
		actions,
		throwOnFailure: true
	});

	// Verify the transaction succeeded by checking the status
	if (
		typeof outcome.status === 'object' &&
		'Failure' in outcome.status &&
		outcome.status.Failure
	) {
		const errDetail = JSON.stringify(outcome.status.Failure);
		throw new Error(`On-chain key rotation failed: ${errDetail}`);
	}

	const txHash =
		outcome.transaction_outcome?.id ??
		outcome.transaction?.hash ??
		'unknown';

	console.log(
		`${LOG_PREFIX} On-chain key rotation succeeded for ${accountId}. tx: ${txHash}`
	);
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Create a NEAR implicit account for a user.
 *
 * Generates an Ed25519 keypair, encrypts the private key with AES-256-GCM,
 * and stores everything in the User record. The hex-encoded public key
 * becomes the implicit account ID (no on-chain transaction needed).
 *
 * Also generates a recovery keypair whose public key will be added on-chain
 * as a FunctionCall access key (done separately during account funding).
 *
 * @param userId - The Prisma User ID
 * @returns Creation result with account info or error
 */
export async function createNearAccount(
	userId: string
): Promise<NearAccountCreationResult> {
	try {
		// Check if user already has a NEAR account
		const existingUser = await db.user.findUnique({
			where: { id: userId },
			select: {
				near_account_id: true
			}
		});

		if (!existingUser) {
			console.error(`${LOG_PREFIX} User not found: ${safeUserId(userId)}`);
			return { success: false, account: null, error: 'User not found' };
		}

		if (existingUser.near_account_id) {
			console.warn(
				`${LOG_PREFIX} User ${safeUserId(userId)} already has NEAR account: ${existingUser.near_account_id}`
			);
			return {
				success: false,
				account: null,
				error: 'User already has a NEAR account'
			};
		}

		// Generate primary keypair
		const { keypair: primaryKeypair, accountId, publicKeyString } = generateKeypair();
		const encryptedPrimaryKey = encryptPrivateKey(primaryKeypair);

		// Generate recovery keypair
		const { keypair: recoveryKeypair, publicKeyString: recoveryPublicKeyString } =
			generateKeypair();
		const encryptedRecoveryKey = encryptPrivateKey(recoveryKeypair);

		// Bundle recovery key for storage (public + encrypted private)
		const recoveryBundle = serializeRecoveryBundle({
			publicKey: recoveryPublicKeyString,
			encryptedPrivateKey: encryptedRecoveryKey
		});

		// Store in DB
		await db.user.update({
			where: { id: userId },
			data: {
				near_account_id: accountId,
				near_public_key: publicKeyString,
				encrypted_near_private_key: encryptedPrimaryKey,
				near_recovery_public_key: recoveryBundle
			}
		});

		console.log(
			`${LOG_PREFIX} Created NEAR implicit account for user ${safeUserId(userId)}: ${accountId}`
		);

		return {
			success: true,
			account: {
				accountId,
				publicKey: publicKeyString,
				hasRecoveryKey: true,
				scrollAddress: null
			}
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		console.error(`${LOG_PREFIX} Failed to create NEAR account for user ${safeUserId(userId)}:`, message);
		return { success: false, account: null, error: message };
	}
}

/**
 * Retrieve and decrypt the NEAR primary keypair for a user.
 *
 * Use this when you need to sign transactions on behalf of the user
 * (e.g., sending tokens, calling contracts, Chain Signatures).
 *
 * @param userId - The Prisma User ID
 * @returns Decrypted keypair result or error
 */
export async function getNearKeypair(userId: string): Promise<NearKeypairResult> {
	try {
		const user = await db.user.findUnique({
			where: { id: userId },
			select: {
				near_account_id: true,
				encrypted_near_private_key: true
			}
		});

		if (!user) {
			return { success: false, keypair: null, accountId: null, error: 'User not found' };
		}

		if (!user.near_account_id || !user.encrypted_near_private_key) {
			return {
				success: false,
				keypair: null,
				accountId: null,
				error: 'User does not have a NEAR account'
			};
		}

		const keypair = decryptPrivateKey(user.encrypted_near_private_key);

		return {
			success: true,
			keypair,
			accountId: user.near_account_id
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		console.error(`${LOG_PREFIX} Failed to get NEAR keypair for user ${safeUserId(userId)}:`, message);
		return { success: false, keypair: null, accountId: null, error: message };
	}
}

/**
 * Get NEAR account info for a user (public data only, no private keys).
 *
 * @param userId - The Prisma User ID
 * @returns Account info or null if user has no NEAR account
 */
export async function getNearAccountInfo(
	userId: string
): Promise<NearAccountInfo | null> {
	try {
		const user = await db.user.findUnique({
			where: { id: userId },
			select: {
				near_account_id: true,
				near_public_key: true,
				near_recovery_public_key: true,
				near_derived_scroll_address: true
			}
		});

		if (!user || !user.near_account_id || !user.near_public_key) {
			return null;
		}

		// Determine if recovery key exists
		let hasRecoveryKey = false;
		if (user.near_recovery_public_key) {
			const bundle = deserializeRecoveryBundle(user.near_recovery_public_key);
			hasRecoveryKey = bundle !== null;
			// Also handle legacy plain public key strings
			if (!bundle && user.near_recovery_public_key.startsWith('ed25519:')) {
				hasRecoveryKey = true;
			}
		}

		return {
			accountId: user.near_account_id,
			publicKey: user.near_public_key,
			hasRecoveryKey,
			scrollAddress: user.near_derived_scroll_address ?? null
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		console.error(`${LOG_PREFIX} Failed to get NEAR account info for user ${safeUserId(userId)}:`, message);
		return null;
	}
}

/**
 * Rotate the NEAR primary key using the recovery key.
 *
 * This is used when a user loses access to their device. The flow:
 *   1. Decrypt the recovery keypair from server storage
 *   2. Generate new primary and recovery keypairs
 *   3. Submit a batched on-chain transaction (signed by recovery key) with:
 *      - AddKey(newPrimary, FullAccess)
 *      - DeleteKey(oldPrimary)
 *      - AddKey(newRecovery, FullAccess)
 *      - DeleteKey(oldRecovery)
 *   4. On success, update all DB fields to match on-chain state
 *
 * Atomic semantics: the DB is only updated after the on-chain transaction
 * succeeds. If the on-chain rotation fails, the DB is left unchanged.
 *
 * @param userId - The Prisma User ID
 * @returns Rotation result with new public key or error
 */
export async function rotateNearPrimaryKey(
	userId: string
): Promise<NearKeyRotationResult> {
	try {
		const user = await db.user.findUnique({
			where: { id: userId },
			select: {
				near_account_id: true,
				near_public_key: true,
				encrypted_near_private_key: true,
				near_recovery_public_key: true
			}
		});

		if (!user) {
			return { success: false, newPublicKey: null, error: 'User not found' };
		}

		if (!user.near_account_id || !user.near_recovery_public_key) {
			return {
				success: false,
				newPublicKey: null,
				error: 'User does not have a NEAR account or recovery key'
			};
		}

		// Decrypt recovery keypair
		const recoveryBundle = deserializeRecoveryBundle(user.near_recovery_public_key);
		if (!recoveryBundle) {
			return {
				success: false,
				newPublicKey: null,
				error: 'Recovery key bundle is missing or corrupted'
			};
		}

		let recoveryKeypair: KeyPairEd25519;
		try {
			recoveryKeypair = decryptPrivateKey(recoveryBundle.encryptedPrivateKey);
		} catch {
			return {
				success: false,
				newPublicKey: null,
				error: 'Failed to decrypt recovery key'
			};
		}

		// Verify recovery keypair matches stored public key
		const recoveryPublicKeyString = recoveryKeypair.getPublicKey().toString();
		if (recoveryPublicKeyString !== recoveryBundle.publicKey) {
			console.error(
				`${LOG_PREFIX} Recovery key mismatch for user ${safeUserId(userId)}: ` +
					`expected ${recoveryBundle.publicKey}, got ${recoveryPublicKeyString}`
			);
			return {
				success: false,
				newPublicKey: null,
				error: 'Recovery key integrity check failed'
			};
		}

		// Generate new primary keypair
		// NOTE: The account ID does NOT change — implicit account IDs are permanent.
		// The new primary key will be added via AddKey and the old one removed via DeleteKey.
		const newPrimaryKeypair = KeyPairEd25519.fromRandom();
		const newPublicKeyString = newPrimaryKeypair.getPublicKey().toString();
		const encryptedNewPrimaryKey = encryptPrivateKey(newPrimaryKeypair);

		// Generate new recovery keypair (rotate recovery too for forward secrecy)
		const newRecoveryKeypair = KeyPairEd25519.fromRandom();
		const newRecoveryPublicKeyString = newRecoveryKeypair.getPublicKey().toString();
		const encryptedNewRecoveryKey = encryptPrivateKey(newRecoveryKeypair);

		const newRecoveryBundle = serializeRecoveryBundle({
			publicKey: newRecoveryPublicKeyString,
			encryptedPrivateKey: encryptedNewRecoveryKey
		});

		console.log(
			`${LOG_PREFIX} Rotating primary key for user ${safeUserId(userId)}. ` +
				`Old: ${user.near_public_key}, New: ${newPublicKeyString}`
		);

		// Submit on-chain key rotation BEFORE updating the DB.
		// If the on-chain transaction fails, we bail out without touching the DB
		// so that DB state always reflects on-chain reality (atomic semantics).
		try {
			await submitKeyRotationOnChain(
				user.near_account_id,
				recoveryKeypair,
				user.near_public_key!,
				newPrimaryKeypair,
				recoveryBundle.publicKey,
				newRecoveryKeypair,
				NEAR_NETWORK_ID
			);
		} catch (onChainError) {
			const detail = onChainError instanceof Error ? onChainError.message : String(onChainError);
			console.error(
				`${LOG_PREFIX} On-chain key rotation failed for user ${safeUserId(userId)}: ${detail}`
			);
			return {
				success: false,
				newPublicKey: null,
				error: `On-chain key rotation failed: ${detail}`
			};
		}

		// On-chain rotation succeeded — now update DB to match
		await db.user.update({
			where: { id: userId },
			data: {
				near_public_key: newPublicKeyString,
				encrypted_near_private_key: encryptedNewPrimaryKey,
				near_recovery_public_key: newRecoveryBundle
			}
		});

		console.log(`${LOG_PREFIX} Key rotation complete for user ${safeUserId(userId)}`);

		return {
			success: true,
			newPublicKey: newPublicKeyString
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		console.error(
			`${LOG_PREFIX} Failed to rotate NEAR primary key for user ${safeUserId(userId)}:`,
			message
		);
		return { success: false, newPublicKey: null, error: message };
	}
}

/**
 * Check if a user has a NEAR account provisioned.
 *
 * Lightweight check that only queries the account ID field.
 *
 * @param userId - The Prisma User ID
 * @returns true if the user has a NEAR account, false otherwise
 */
export async function hasNearAccount(userId: string): Promise<boolean> {
	try {
		const user = await db.user.findUnique({
			where: { id: userId },
			select: { near_account_id: true }
		});
		return user?.near_account_id != null;
	} catch (error) {
		console.error(`${LOG_PREFIX} Failed to check NEAR account for user ${safeUserId(userId)}:`, error);
		return false;
	}
}

/**
 * Get the recovery keypair for server-side recovery operations.
 *
 * This should ONLY be called during key rotation or account recovery flows.
 * The recovery keypair is never exposed to the client.
 *
 * @param userId - The Prisma User ID
 * @returns Decrypted recovery keypair or null
 */
export async function getRecoveryKeypair(
	userId: string
): Promise<{ keypair: KeyPairEd25519; publicKey: string } | null> {
	try {
		const user = await db.user.findUnique({
			where: { id: userId },
			select: { near_recovery_public_key: true }
		});

		if (!user?.near_recovery_public_key) {
			return null;
		}

		const bundle = deserializeRecoveryBundle(user.near_recovery_public_key);
		if (!bundle) {
			console.warn(
				`${LOG_PREFIX} Recovery key for user ${userId} is not a valid bundle ` +
					`(may be legacy plain public key)`
			);
			return null;
		}

		const keypair = decryptPrivateKey(bundle.encryptedPrivateKey);
		return { keypair, publicKey: bundle.publicKey };
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		console.error(
			`${LOG_PREFIX} Failed to get recovery keypair for user ${userId}:`,
			message
		);
		return null;
	}
}
