/**
 * Session Credential Storage (v3 — Per-User Isolation + Identity/TreeState Split)
 *
 * Stores Shadow Atlas registration data in IndexedDB for client-side proof generation.
 *
 * v3 changes:
 * - Per-user HKDF-derived encryption keys (multi-user device isolation)
 * - HMAC-based record IDs (enumeration protection)
 * - IdentitySecrets split from TreeState:
 *   - IdentitySecrets: userSecret, registrationSalt, identityCommitment — NO TTL, never pruned
 *   - TreeState: merklePath, merkleRoot, leafIndex, engagement — refreshable TTL
 *
 * Privacy Design:
 * - NO PII stored (address encrypted separately)
 * - Only merkle_path + proof generation metadata
 * - User B cannot read or discover User A's records (HMAC record IDs)
 *
 * Security:
 * - Per-user AES-256-GCM via HKDF(deviceMasterKey, userId)
 * - Device-bound master key (non-exportable from IndexedDB)
 * - Derived keys held in-memory only, discarded on logout
 */

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import {
	encryptCredential,
	decryptCredential,
	decryptLegacyCredential,
	isEncryptionAvailable,
	computeRecordId,
	type EncryptedCredential
} from './credential-encryption';

// ============================================================================
// Types
// ============================================================================

/**
 * Identity secrets — NEVER expire, NEVER pruned.
 *
 * These are the cryptographic foundation of a user's on-chain identity.
 * If lost, the identity commitment changes and all on-chain history
 * (debates, reputation, stakes) is permanently orphaned.
 */
export interface IdentitySecrets {
	/** User secret used for leaf computation (client-side only) */
	userSecret: string;

	/** Registration salt used for leaf computation (client-side only) */
	registrationSalt: string;

	/** Identity commitment (SHA-256 mod BN254, deterministic per verified person) */
	identityCommitment: string;

	/** Authority level (1-5), cryptographically bound into user leaf via H4 */
	authorityLevel?: 1 | 2 | 3 | 4 | 5;

	/**
	 * Ed25519 signed receipt from the Shadow Atlas operator.
	 * Anti-censorship proof — persists with identity.
	 */
	receipt?: { data: string; sig: string };

	/** Verification method used */
	verificationMethod: 'self.xyz' | 'didit' | 'digital-credentials-api';

	/** When identity was first established */
	createdAt: Date;
}

/**
 * Tree state — refreshable TTL, can expire and be re-fetched.
 *
 * Contains Merkle proofs and engagement data that change as the
 * Shadow Atlas trees are updated. Safe to prune and re-fetch.
 */
export interface TreeState {
	/** Position in Tree 1 (User Identity Merkle tree, depth 20) */
	leafIndex: number;

	/** Tree 1 Merkle siblings for proof generation (depth 20 default) */
	merklePath: string[];

	/** Tree 1 Merkle root (verification anchor) */
	merkleRoot: string;

	/** Congressional district (e.g., "CA-12") */
	congressionalDistrict: string;

	/**
	 * Credential type discriminator
	 * - 'three-tree': User identity + cell-district map + engagement tree (production)
	 */
	credentialType?: 'three-tree';

	/** Census Block GEOID (15-digit cell identifier) */
	cellId?: string;

	/** Tree 2 (Cell-District Map) root hash */
	cellMapRoot?: string;

	/** Tree 2 SMT siblings (depth elements, hex-encoded) */
	cellMapPath?: string[];

	/** Tree 2 SMT direction bits (0=left, 1=right) */
	cellMapPathBits?: number[];

	/** All 24 district IDs for this cell (hex-encoded) */
	districts?: string[];

	// Tree 3 (Engagement) Fields
	/** Tree 3 (Engagement) root hash */
	engagementRoot?: string;

	/** Tree 3 Merkle siblings (depth elements, hex-encoded) */
	engagementPath?: string[];

	/** Leaf position in Tree 3 */
	engagementIndex?: number;

	/** Engagement tier [0-4] (New/Active/Established/Veteran/Pillar) */
	engagementTier?: 0 | 1 | 2 | 3 | 4;

	/** Cumulative action count for engagement score (hex-encoded field element) */
	actionCount?: string;

	/** Shannon diversity score for engagement breadth (hex-encoded field element) */
	diversityScore?: string;

	/** When tree state was fetched */
	createdAt: Date;

	/** When tree state expires (re-fetch required) */
	expiresAt: Date;
}

/**
 * Combined SessionCredential — backward-compatible view over IdentitySecrets + TreeState.
 *
 * Consumers (proof-input-mapper, shadow-atlas-handler, GroundCard) continue to
 * use this interface. Internally it's stored as two separate encrypted records.
 */
export interface SessionCredential {
	/** User ID (for multi-user support) */
	userId: string;

	/** Identity commitment (SHA-256 mod BN254, deterministic per verified person) */
	identityCommitment: string;

	/** Position in Tree 1 (User Identity Merkle tree, depth 20) */
	leafIndex: number;

	/** Tree 1 Merkle siblings for proof generation (depth 20 default) */
	merklePath: string[];

	/** Tree 1 Merkle root (verification anchor) */
	merkleRoot: string;

	/** Congressional district (e.g., "CA-12") */
	congressionalDistrict: string;

	credentialType?: 'three-tree';
	cellId?: string;
	cellMapRoot?: string;
	cellMapPath?: string[];
	cellMapPathBits?: number[];
	districts?: string[];
	authorityLevel?: 1 | 2 | 3 | 4 | 5;
	registrationSalt?: string;
	userSecret?: string;

	engagementRoot?: string;
	engagementPath?: string[];
	engagementIndex?: number;
	engagementTier?: 0 | 1 | 2 | 3 | 4;
	actionCount?: string;
	diversityScore?: string;

	/** Verification method used ('self.xyz' and 'didit' retained for database backward compatibility) */
	verificationMethod: 'self.xyz' | 'didit' | 'digital-credentials-api';

	receipt?: { data: string; sig: string };

	/** When credential was created */
	createdAt: Date;

	/** When credential expires (tree state expiry — identity secrets never expire) */
	expiresAt: Date;
}

// ============================================================================
// Constants
// ============================================================================

/** Sentinel expiry date for identity secrets (year 9999). Never reached by cleanup. */
const IDENTITY_SENTINEL_EXPIRY = new Date('9999-12-31T23:59:59.999Z');

// ============================================================================
// Internal Storage Types
// ============================================================================

/**
 * Stored record wrapper — uses HMAC(userId) as key, encrypted payload inside.
 */
interface StoredRecord {
	/** HMAC(userId, masterKey) — opaque record identifier */
	recordId: string;

	/** 'identity' or 'tree-state' */
	kind: 'identity' | 'tree-state';

	/** Encrypted payload (v2 per-user encryption) */
	encrypted?: EncryptedCredential;

	/** Expiration date (plaintext for index queries). Far-future sentinel for identity secrets. */
	expiresAt: Date;

	// Legacy fields for v1 migration detection
	userId?: string;
	identityCommitment?: string;
	leafIndex?: number;
	merklePath?: string[];
	merkleRoot?: string;
	congressionalDistrict?: string;
	verificationMethod?: 'self.xyz' | 'didit' | 'digital-credentials-api';
	createdAt?: Date;
}

interface SessionCredentialDB extends DBSchema {
	credentials: {
		key: string; // recordId
		value: StoredRecord;
		indexes: {
			'by-expires': Date;
			'by-kind': string;
		};
	};
}

// ============================================================================
// Database Management
// ============================================================================

const DB_NAME = 'commons-session';
const DB_VERSION = 3; // Bumped for per-user isolation + identity/tree-state split
const STORE_NAME = 'credentials';

let dbInstance: IDBPDatabase<SessionCredentialDB> | null = null;

// ============================================================================
// v1/v2 → v3 Migration (B1 fix: preserve identity secrets across DB upgrade)
// ============================================================================

/**
 * Read legacy v1/v2 records BEFORE the v3 upgrade destroys them.
 *
 * Opens the database at its current version (no upgrade triggered) to read records.
 * For fresh installs (no existing DB), aborts the phantom v1 creation and returns null.
 *
 * This is the critical fix: v1/v2 used 'userId' as keyPath, v3 uses 'recordId'.
 * IndexedDB doesn't allow keyPath changes, so the store must be recreated.
 * Without reading first, userSecret + registrationSalt are permanently lost,
 * orphaning the user's on-chain identity — the exact problem the v3 rework
 * was designed to prevent.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function readLegacyRecords(): Promise<any[] | null> {
	if (typeof indexedDB === 'undefined') {
		return null;
	}

	// Short-circuit via databases() API if available
	try {
		if (typeof indexedDB.databases === 'function') {
			const dbs = await indexedDB.databases();
			const existing = dbs.find((d: IDBDatabaseInfo) => d.name === DB_NAME);
			if (!existing || !existing.version || existing.version >= DB_VERSION) {
				return null;
			}
		}
	} catch {
		// databases() not supported — proceed with open
	}

	return new Promise((resolve) => {
		const request = indexedDB.open(DB_NAME);

		request.onerror = () => resolve(null);

		// If the DB doesn't exist, upgradeneeded fires — abort to prevent
		// phantom v1 creation that would confuse the real upgrade handler
		request.onupgradeneeded = () => {
			request.transaction?.abort();
		};

		request.onsuccess = () => {
			const db = request.result;

			if (db.version >= DB_VERSION || !db.objectStoreNames.contains(STORE_NAME)) {
				db.close();
				resolve(null);
				return;
			}

			try {
				const tx = db.transaction(STORE_NAME, 'readonly');
				const store = tx.objectStore(STORE_NAME);
				const getAll = store.getAll();

				getAll.onsuccess = () => {
					db.close();
					resolve(getAll.result || []);
				};

				getAll.onerror = () => {
					db.close();
					resolve(null);
				};
			} catch {
				db.close();
				resolve(null);
			}
		};
	});
}

/**
 * Migrate v1/v2 legacy records into v3 format.
 *
 * Handles both plaintext v1 records and v1-encrypted records (via legacy device key).
 * The critical invariant: userSecret + registrationSalt are NEVER silently destroyed.
 * If decryption fails (missing legacy key), logs an explicit error — never swallows.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function migrateLegacyRecords(records: any[]): Promise<void> {
	if (!dbInstance) return;

	let migrated = 0;
	let failed = 0;

	for (const record of records) {
		try {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			let credential: any;

			if (record.encrypted) {
				// v1 encrypted — decrypt with legacy device key
				try {
					credential = await decryptLegacyCredential(record.encrypted);
				} catch (decryptErr) {
					console.error(
						'[Session Credentials] CRITICAL: Cannot decrypt v1 record.',
						'Legacy device key missing or corrupt.',
						'Identity secrets LOST for this user. Manual re-registration required.',
						decryptErr
					);
					failed++;
					continue;
				}
				// userId was the keyPath in v1, may not be in the encrypted payload
				credential.userId = credential.userId || record.userId;
			} else if (record.userSecret || record.identityCommitment) {
				// Plaintext v1 record — fields directly on record
				credential = record;
			} else {
				continue;
			}

			const userId = credential.userId;
			if (!userId) {
				console.warn('[Session Credentials] v1 record missing userId, skipping');
				failed++;
				continue;
			}

			// Migrate identity secrets — the critical data that must not be lost
			if (credential.userSecret && credential.registrationSalt) {
				const identity: IdentitySecrets = {
					userSecret: credential.userSecret,
					registrationSalt: credential.registrationSalt,
					identityCommitment: credential.identityCommitment,
					authorityLevel: credential.authorityLevel,
					receipt: credential.receipt,
					verificationMethod: credential.verificationMethod || 'self.xyz',
					createdAt: credential.createdAt ? new Date(credential.createdAt) : new Date()
				};

				const encryptedIdentity = await encryptCredential(identity, userId);
				const idKey = await identityRecordId(userId);

				await dbInstance.put(STORE_NAME, {
					recordId: idKey,
					kind: 'identity' as const,
					encrypted: encryptedIdentity,
					expiresAt: IDENTITY_SENTINEL_EXPIRY
				});
			}

			// Migrate tree state if present (safe to lose — re-fetchable)
			if (credential.leafIndex !== undefined && credential.merklePath) {
				const treeState: TreeState = {
					leafIndex: credential.leafIndex,
					merklePath: credential.merklePath,
					merkleRoot: credential.merkleRoot,
					congressionalDistrict: credential.congressionalDistrict,
					credentialType: credential.credentialType,
					cellId: credential.cellId,
					cellMapRoot: credential.cellMapRoot,
					cellMapPath: credential.cellMapPath,
					cellMapPathBits: credential.cellMapPathBits,
					districts: credential.districts,
					engagementRoot: credential.engagementRoot,
					engagementPath: credential.engagementPath,
					engagementIndex: credential.engagementIndex,
					engagementTier: credential.engagementTier,
					actionCount: credential.actionCount,
					diversityScore: credential.diversityScore,
					createdAt: credential.createdAt ? new Date(credential.createdAt) : new Date(),
					expiresAt: credential.expiresAt
						? new Date(credential.expiresAt)
						: calculateExpirationDate()
				};

				const encryptedTreeState = await encryptCredential(treeState, userId);
				const tsKey = await treeStateRecordId(userId);

				await dbInstance.put(STORE_NAME, {
					recordId: tsKey,
					kind: 'tree-state' as const,
					encrypted: encryptedTreeState,
					expiresAt: treeState.expiresAt
				});
			}

			migrated++;
		} catch (err) {
			console.error('[Session Credentials] v1/v2 record migration failed:', err);
			failed++;
		}
	}

	if (migrated > 0 || failed > 0) {
		console.debug('[Session Credentials] v1/v2 → v3 migration:', { migrated, failed });
		if (failed > 0) {
			console.error(
				`[Session Credentials] ${failed} record(s) could not be migrated.`,
				'These users will need to re-register. Identity secrets were lost.'
			);
		}
	}
}

// ============================================================================
// Database Management
// ============================================================================

async function getDB(): Promise<IDBPDatabase<SessionCredentialDB>> {
	if (dbInstance) {
		return dbInstance;
	}

	// B1 FIX: Read v1/v2 records BEFORE the upgrade destroys them.
	// The upgrade must delete the old store (keyPath changed), but we
	// read identity secrets out first so they survive the transition.
	const legacyRecords = await readLegacyRecords();

	dbInstance = await openDB<SessionCredentialDB>(DB_NAME, DB_VERSION, {
		upgrade(db, oldVersion) {
			if (oldVersion >= 1 && oldVersion < 3) {
				if (db.objectStoreNames.contains(STORE_NAME)) {
					db.deleteObjectStore(STORE_NAME);
					console.debug('[Session Credentials] Dropped v1/v2 store for v3 keyPath migration');
				}
			}

			if (!db.objectStoreNames.contains(STORE_NAME)) {
				const store = db.createObjectStore(STORE_NAME, {
					keyPath: 'recordId'
				});
				store.createIndex('by-expires', 'expiresAt');
				store.createIndex('by-kind', 'kind');
				console.debug('[Session Credentials] Database initialized (v3)');
			}
		},
		blocked() {
			console.warn('[Session Credentials] Database upgrade blocked - close other tabs');
		},
		blocking() {
			console.warn('[Session Credentials] Blocking database upgrade - this tab will close');
			dbInstance?.close();
			dbInstance = null;
		},
		terminated() {
			console.error('[Session Credentials] Database connection terminated');
			dbInstance = null;
		}
	});

	// B1 FIX: Migrate legacy records into v3 format (per-user HKDF encryption)
	if (legacyRecords && legacyRecords.length > 0) {
		await migrateLegacyRecords(legacyRecords);
	}

	return dbInstance;
}

/**
 * Close the held IndexedDB connection so deleteDatabase() isn't blocked.
 * Called by performLogout() before clearing caches.
 */
export function closeDatabase(): void {
	if (dbInstance) {
		dbInstance.close();
		dbInstance = null;
	}
}

// ============================================================================
// Record ID Helpers
// ============================================================================

async function identityRecordId(userId: string): Promise<string> {
	const base = await computeRecordId(userId);
	return `id:${base}`;
}

async function treeStateRecordId(userId: string): Promise<string> {
	const base = await computeRecordId(userId);
	return `ts:${base}`;
}

// ============================================================================
// Splitting Logic
// ============================================================================

function extractIdentitySecrets(credential: SessionCredential): IdentitySecrets {
	return {
		userSecret: credential.userSecret!,
		registrationSalt: credential.registrationSalt!,
		identityCommitment: credential.identityCommitment,
		authorityLevel: credential.authorityLevel,
		receipt: credential.receipt,
		verificationMethod: credential.verificationMethod,
		createdAt: credential.createdAt instanceof Date
			? credential.createdAt
			: new Date(credential.createdAt)
	};
}

function extractTreeState(credential: SessionCredential): TreeState {
	return {
		leafIndex: credential.leafIndex,
		merklePath: credential.merklePath,
		merkleRoot: credential.merkleRoot,
		congressionalDistrict: credential.congressionalDistrict,
		credentialType: credential.credentialType,
		cellId: credential.cellId,
		cellMapRoot: credential.cellMapRoot,
		cellMapPath: credential.cellMapPath,
		cellMapPathBits: credential.cellMapPathBits,
		districts: credential.districts,
		engagementRoot: credential.engagementRoot,
		engagementPath: credential.engagementPath,
		engagementIndex: credential.engagementIndex,
		engagementTier: credential.engagementTier,
		actionCount: credential.actionCount,
		diversityScore: credential.diversityScore,
		createdAt: credential.createdAt instanceof Date
			? credential.createdAt
			: new Date(credential.createdAt),
		expiresAt: credential.expiresAt instanceof Date
			? credential.expiresAt
			: new Date(credential.expiresAt)
	};
}

function mergeToSessionCredential(
	userId: string,
	identity: IdentitySecrets,
	treeState: TreeState
): SessionCredential {
	return {
		userId,
		identityCommitment: identity.identityCommitment,
		leafIndex: treeState.leafIndex,
		merklePath: treeState.merklePath,
		merkleRoot: treeState.merkleRoot,
		congressionalDistrict: treeState.congressionalDistrict,
		credentialType: treeState.credentialType,
		cellId: treeState.cellId,
		cellMapRoot: treeState.cellMapRoot,
		cellMapPath: treeState.cellMapPath,
		cellMapPathBits: treeState.cellMapPathBits,
		districts: treeState.districts,
		authorityLevel: identity.authorityLevel,
		registrationSalt: identity.registrationSalt,
		userSecret: identity.userSecret,
		engagementRoot: treeState.engagementRoot,
		engagementPath: treeState.engagementPath,
		engagementIndex: treeState.engagementIndex,
		engagementTier: treeState.engagementTier,
		actionCount: treeState.actionCount,
		diversityScore: treeState.diversityScore,
		verificationMethod: identity.verificationMethod,
		receipt: identity.receipt,
		createdAt: identity.createdAt,
		expiresAt: treeState.expiresAt
	};
}

// ============================================================================
// CRUD Operations
// ============================================================================

/**
 * Store session credential in IndexedDB.
 *
 * Splits into IdentitySecrets (permanent) and TreeState (expiring),
 * encrypts each with per-user HKDF-derived key, stores under HMAC record IDs.
 *
 * @param credential - Credential to store
 * @throws Error if Web Crypto API is unavailable
 */
export async function storeSessionCredential(credential: SessionCredential): Promise<void> {
	try {
		const db = await getDB();

		if (!isEncryptionAvailable()) {
			throw new Error(
				'[Session Credentials] Cannot store credentials: Web Crypto API is unavailable. ' +
				'Refusing to store credentials in plaintext.'
			);
		}

		const normalizedCredential: SessionCredential = {
			...credential,
			createdAt:
				credential.createdAt instanceof Date
					? credential.createdAt
					: new Date(credential.createdAt),
			expiresAt:
				credential.expiresAt instanceof Date ? credential.expiresAt : new Date(credential.expiresAt)
		};

		const userId = credential.userId;

		// Split into identity secrets and tree state
		const identity = extractIdentitySecrets(normalizedCredential);
		const treeState = extractTreeState(normalizedCredential);

		// Encrypt each separately with per-user key
		const [encryptedIdentity, encryptedTreeState] = await Promise.all([
			encryptCredential(identity, userId),
			encryptCredential(treeState, userId)
		]);

		// Compute HMAC-based record IDs
		const [idRecordId, tsRecordId] = await Promise.all([
			identityRecordId(userId),
			treeStateRecordId(userId)
		]);

		// Store both records
		const tx = db.transaction(STORE_NAME, 'readwrite');

		tx.store.put({
			recordId: idRecordId,
			kind: 'identity',
			encrypted: encryptedIdentity,
			expiresAt: IDENTITY_SENTINEL_EXPIRY // Identity secrets effectively never expire
		});

		tx.store.put({
			recordId: tsRecordId,
			kind: 'tree-state',
			encrypted: encryptedTreeState,
			expiresAt: normalizedCredential.expiresAt
		});

		await tx.done;

		console.debug('[Session Credentials] Stored (split, per-user encrypted):', {
			userId,
			district: credential.congressionalDistrict,
			treeStateExpiresAt: normalizedCredential.expiresAt.toISOString()
		});
	} catch (error) {
		console.error('[Session Credentials] Store failed:', error);
		throw new Error('Failed to store session credential');
	}
}

/**
 * Retrieve session credential from IndexedDB.
 *
 * Reassembles from IdentitySecrets + TreeState. If tree state is expired,
 * returns null (caller should re-fetch tree state). Identity secrets are
 * never pruned.
 *
 * @param userId - User ID to look up
 * @returns Credential if found and tree state valid, null otherwise
 */
export async function getSessionCredential(userId: string): Promise<SessionCredential | null> {
	try {
		const db = await getDB();

		// Compute HMAC record IDs
		const [idRecordId, tsRecordId] = await Promise.all([
			identityRecordId(userId),
			treeStateRecordId(userId)
		]);

		const [identityRecord, treeStateRecord] = await Promise.all([
			db.get(STORE_NAME, idRecordId),
			db.get(STORE_NAME, tsRecordId)
		]);

		if (!identityRecord?.encrypted || !treeStateRecord?.encrypted) {
			console.debug('[Session Credentials] Not found:', { userId: userId.slice(0, 8) });
			return null;
		}

		// Check tree state expiration
		if (treeStateRecord.expiresAt) {
			const expiresAt = treeStateRecord.expiresAt instanceof Date
				? treeStateRecord.expiresAt
				: new Date(treeStateRecord.expiresAt);
			if (expiresAt < new Date()) {
				console.debug('[Session Credentials] Tree state expired:', {
					userId: userId.slice(0, 8),
					expiredAt: expiresAt.toISOString()
				});
				// Delete only tree state, keep identity secrets
				await db.delete(STORE_NAME, tsRecordId);
				return null;
			}
		}

		// Decrypt both
		let identity: IdentitySecrets;
		let treeState: TreeState;

		try {
			[identity, treeState] = await Promise.all([
				decryptCredential<IdentitySecrets>(identityRecord.encrypted, userId),
				decryptCredential<TreeState>(treeStateRecord.encrypted, userId)
			]);

			// Ensure dates are Date objects after deserialization
			identity.createdAt = new Date(identity.createdAt);
			treeState.createdAt = new Date(treeState.createdAt);
			treeState.expiresAt = new Date(treeState.expiresAt);
		} catch (decryptError) {
			console.error('[Session Credentials] Decryption failed:', decryptError);
			return null;
		}

		const credential = mergeToSessionCredential(userId, identity, treeState);

		const now = new Date();
		console.debug('[Session Credentials] Retrieved:', {
			userId: userId.slice(0, 8),
			district: credential.congressionalDistrict,
			remainingDays: Math.floor(
				(credential.expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
			)
		});

		return credential;
	} catch (error) {
		console.error('[Session Credentials] Retrieval failed:', error);
		return null;
	}
}

/**
 * Get identity secrets only (never expires).
 *
 * Use this when you need just the identity commitment and secrets,
 * without requiring fresh tree state.
 *
 * @param userId - User ID
 * @returns IdentitySecrets if found, null otherwise
 */
export async function getIdentitySecrets(userId: string): Promise<IdentitySecrets | null> {
	try {
		const db = await getDB();
		const recordId = await identityRecordId(userId);
		const record = await db.get(STORE_NAME, recordId);

		if (!record?.encrypted) {
			return null;
		}

		const identity = await decryptCredential<IdentitySecrets>(record.encrypted, userId);
		identity.createdAt = new Date(identity.createdAt);
		return identity;
	} catch (error) {
		console.error('[Session Credentials] getIdentitySecrets failed:', error);
		return null;
	}
}

/**
 * Get tree state only.
 *
 * @param userId - User ID
 * @returns TreeState if found and not expired, null otherwise
 */
export async function getTreeState(userId: string): Promise<TreeState | null> {
	try {
		const db = await getDB();
		const recordId = await treeStateRecordId(userId);
		const record = await db.get(STORE_NAME, recordId);

		if (!record?.encrypted) {
			return null;
		}

		if (record.expiresAt) {
			const expiresAt = record.expiresAt instanceof Date
				? record.expiresAt
				: new Date(record.expiresAt);
			if (expiresAt < new Date()) {
				await db.delete(STORE_NAME, recordId);
				return null;
			}
		}

		const treeState = await decryptCredential<TreeState>(record.encrypted, userId);
		treeState.createdAt = new Date(treeState.createdAt);
		treeState.expiresAt = new Date(treeState.expiresAt);
		return treeState;
	} catch (error) {
		console.error('[Session Credentials] getTreeState failed:', error);
		return null;
	}
}

/**
 * Update tree state only (identity secrets unchanged).
 *
 * @param userId - User ID
 * @param treeState - New tree state to store
 */
export async function updateTreeState(userId: string, treeState: TreeState): Promise<void> {
	const db = await getDB();
	const recordId = await treeStateRecordId(userId);

	const encrypted = await encryptCredential(treeState, userId);

	await db.put(STORE_NAME, {
		recordId,
		kind: 'tree-state',
		encrypted,
		expiresAt: treeState.expiresAt
	});

	console.debug('[Session Credentials] Tree state updated:', { userId: userId.slice(0, 8) });
}

/**
 * Check if user has valid (non-expired tree state) session credential.
 */
export async function hasValidCredential(userId: string): Promise<boolean> {
	const credential = await getSessionCredential(userId);
	return credential !== null;
}

/**
 * Check if user has identity secrets (regardless of tree state expiry).
 */
export async function hasIdentitySecrets(userId: string): Promise<boolean> {
	const secrets = await getIdentitySecrets(userId);
	return secrets !== null;
}

/**
 * Clear session credential (both identity secrets and tree state).
 *
 * WARNING: Clearing identity secrets orphans the user's on-chain history.
 * Prefer clearTreeState() for normal expiration flows.
 */
export async function clearSessionCredential(userId: string): Promise<void> {
	try {
		const db = await getDB();
		const [idRecordId, tsRecordId] = await Promise.all([
			identityRecordId(userId),
			treeStateRecordId(userId)
		]);

		const tx = db.transaction(STORE_NAME, 'readwrite');
		tx.store.delete(idRecordId);
		tx.store.delete(tsRecordId);
		await tx.done;

		console.debug('[Session Credentials] Cleared:', { userId: userId.slice(0, 8) });
	} catch (error) {
		console.error('[Session Credentials] Clear failed:', error);
		throw new Error('Failed to clear session credential');
	}
}

/**
 * Clear only tree state (identity secrets preserved).
 */
export async function clearTreeState(userId: string): Promise<void> {
	try {
		const db = await getDB();
		const recordId = await treeStateRecordId(userId);
		await db.delete(STORE_NAME, recordId);
		console.debug('[Session Credentials] Tree state cleared:', { userId: userId.slice(0, 8) });
	} catch (error) {
		console.error('[Session Credentials] clearTreeState failed:', error);
		throw new Error('Failed to clear tree state');
	}
}

/**
 * Clear ALL expired tree state credentials (cleanup task).
 *
 * IMPORTANT: Only prunes tree-state records. Identity secrets are NEVER pruned.
 *
 * @returns Number of credentials cleared
 */
export async function clearExpiredCredentials(): Promise<number> {
	try {
		const db = await getDB();
		const now = new Date();

		const tx = db.transaction(STORE_NAME, 'readwrite');
		const index = tx.store.index('by-expires');

		const expiredKeys: string[] = [];
		for await (const cursor of index.iterate(IDBKeyRange.upperBound(now))) {
			// Only prune tree-state records, never identity secrets
			if (cursor.value.kind === 'tree-state') {
				expiredKeys.push(cursor.value.recordId);
			}
		}

		for (const recordId of expiredKeys) {
			await tx.store.delete(recordId);
		}

		await tx.done;

		if (expiredKeys.length > 0) {
			console.debug('[Session Credentials] Cleared expired tree state:', {
				count: expiredKeys.length
			});
		}

		return expiredKeys.length;
	} catch (error) {
		console.error('[Session Credentials] Cleanup failed:', error);
		return 0;
	}
}

// ============================================================================
// Legacy Migration Entry Point
// ============================================================================

/**
 * No-op. Kept for backward compatibility with callers that invoke on startup.
 * Actual v1/v2 → v3 migration happens automatically in getDB() via
 * readLegacyRecords() + migrateLegacyRecords().
 */
export async function migrateToEncrypted(): Promise<number> {
	return 0;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Calculate expiration date for tree state (6 months from now).
 *
 * NOTE: This applies only to TreeState. IdentitySecrets never expire.
 */
export function calculateExpirationDate(): Date {
	const now = new Date();
	const expiresAt = new Date(now);
	expiresAt.setMonth(expiresAt.getMonth() + 6);
	return expiresAt;
}

// ============================================================================
// Auto-cleanup on Load
// ============================================================================

// Run cleanup on module load (background task) — only prunes tree state, never identity
if (typeof window !== 'undefined') {
	clearExpiredCredentials().catch((error) => {
		console.error('[Session Credentials] Auto-initialization failed:', error);
	});
}
