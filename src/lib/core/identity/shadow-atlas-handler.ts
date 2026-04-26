/**
 * Shadow Atlas Registration Handler (Three-Tree Architecture)
 *
 * Orchestrates the three-tree registration flow after identity verification:
 *
 * 1. User completes identity verification (Digital Credentials API / mDL)
 * 2. Browser generates user_secret and registration_salt
 * 3. Browser computes leaf = Poseidon2_H4(user_secret, cell_id, registration_salt, authority_level)
 * 4. Browser sends ONLY the leaf hash to commons server
 * 5. Server proxies to Shadow Atlas POST /v1/register → Tree 1 proof
 * 6. Browser requests Tree 2 cell proof (separate call)
 * 7. Tree 3 (engagement) starts with defaults (tier 0), updated by civic actions
 * 8. All credentials stored encrypted in IndexedDB
 *
 * PRIVACY: The commons server never receives user_secret, cell_id,
 * or registration_salt. It sees only the leaf hash.
 *
 * SPEC REFERENCE: WAVE-17-19-IMPLEMENTATION-PLAN.md Section 17c
 * SPEC REFERENCE: COMMONS-INTEGRATION-SPEC.md Section 2.3
 */

import {
	storeSessionCredential,
	calculateExpirationDate,
	type SessionCredential
} from './session-credentials';
import { BN254_MODULUS } from '$lib/core/crypto/bn254';
import { poseidon2Sponge24 } from '$lib/core/crypto/poseidon';

// ============================================================================
// BN254 Validation (browser-safe — cannot import from server-only client.ts)
// ============================================================================

function isValidBN254Hex(value: string): boolean {
	if (typeof value !== 'string' || !/^0x[0-9a-fA-F]+$/.test(value)) return false;
	try { return BigInt(value) < BN254_MODULUS; } catch { return false; }
}

function isValidBN254HexArray(values: string[]): boolean {
	return Array.isArray(values) && values.every(isValidBN254Hex);
}

// ============================================================================
// Types
// ============================================================================

export interface ThreeTreeRegistrationRequest {
	/** User ID */
	userId: string;
	/** Precomputed leaf hash (hex with 0x prefix).
	 *  MUST be computed using the same cellId provided below:
	 *  leaf = H4(userSecret, cellId, registrationSalt, authorityLevel) */
	leaf: string;
	/** Cell ID as 0x-hex BN254 field element (from IPFS cell chunk `c` field).
	 *  The caller resolves this via getFullCellDataFromBrowser() BEFORE
	 *  computing the leaf, ensuring consistency across Tree 1 and Tree 2. */
	cellId: string;
	/** Pre-resolved Tree 2 proof data from IPFS.
	 *  Must be resolved via getFullCellDataFromBrowser() before calling. */
	tree2: {
		cellMapRoot: string;
		cellMapPath: string[];
		cellMapPathBits: number[];
		districts: string[];
	};
	/** User secret (stored client-side only, never sent to server) */
	userSecret: string;
	/** Registration salt (stored client-side only, never sent to server) */
	registrationSalt: string;
	/** Verification method used */
	verificationMethod: 'digital-credentials-api';
	/** Human-readable district code for display (e.g., "CA-12") */
	verifiedDistrict?: string;
}

export interface ThreeTreeRegistrationResult {
	success: boolean;
	sessionCredential?: SessionCredential;
	error?: string;
}

export interface ThreeTreeRecoveryRequest {
	/** User ID */
	userId: string;
	/** Fresh leaf hash (new random inputs) */
	leaf: string;
	/** Cell ID as 0x-hex BN254 field element */
	cellId: string;
	/** Pre-resolved Tree 2 proof data from IPFS.
	 *  Must be resolved via getFullCellDataFromBrowser() before calling. */
	tree2: {
		cellMapRoot: string;
		cellMapPath: string[];
		cellMapPathBits: number[];
		districts: string[];
	};
	/** New random user secret */
	userSecret: string;
	/** New random registration salt */
	registrationSalt: string;
	/** Verification method (carried from original registration) */
	verificationMethod: 'digital-credentials-api';
	/** Human-readable district code for display (e.g., "CA-12") */
	verifiedDistrict?: string;
}

// ============================================================================
// Retry Utility
// ============================================================================

async function fetchWithRetry(
	input: RequestInfo,
	init?: RequestInit,
	maxAttempts = 3
): Promise<Response> {
	const delays = [1000, 2000, 4000];
	let lastError: Error | undefined;

	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		try {
			const response = await fetch(input, {
				...init,
				signal: AbortSignal.timeout(10_000),
			});

			if (response.status >= 500 && attempt < maxAttempts - 1) {
				await new Promise((r) => setTimeout(r, delays[attempt]));
				continue;
			}

			return response;
		} catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error));
			if (attempt < maxAttempts - 1) {
				await new Promise((r) => setTimeout(r, delays[attempt]));
			}
		}
	}

	throw lastError ?? new Error('fetchWithRetry: all attempts failed');
}

// ============================================================================
// District Commitment (Stage 2.5 — F2 closure)
// ============================================================================

/**
 * Compute `districtCommitment = Poseidon2_sponge_24(districts)` for binding into
 * the v2 action-domain preimage.
 *
 * Mirrors what `AddressVerificationFlow.svelte` computes for the server-side
 * `districtCredentials.districtCommitment` row, so the client and server agree
 * on the commitment without any on-the-wire exchange. If the districts array is
 * not exactly 24 slots (malformed cell data), returns `undefined` — the
 * SessionCredential then lacks the field and downstream callers route the user
 * through CREDENTIAL_MIGRATION_REQUIRED re-verify.
 */
async function computeDistrictCommitment(
	districts: string[] | undefined
): Promise<string | undefined> {
	if (!Array.isArray(districts) || districts.length !== 24) {
		console.warn(
			'[Shadow Atlas] districts array is not 24 slots; skipping districtCommitment',
			{ length: districts?.length }
		);
		return undefined;
	}
	try {
		return await poseidon2Sponge24(districts);
	} catch (err) {
		console.error('[Shadow Atlas] poseidon2Sponge24 failed; districtCommitment will be absent', err);
		return undefined;
	}
}

// ============================================================================
// Engagement Data (Tree 3)
// ============================================================================

const ZERO_HASH = '0x0000000000000000000000000000000000000000000000000000000000000000';

/** Default engagement depth (must match circuit tree depth) */
const DEFAULT_ENGAGEMENT_DEPTH = 20;

interface EngagementData {
	engagementRoot: string;
	engagementPath: string[];
	engagementIndex: number;
	engagementTier: number;
	actionCount: string;
	diversityScore: string;
}

/**
 * Fetch engagement data from the proxy endpoint.
 * Non-blocking: returns tier-0 defaults on any failure so that
 * Tree 1 + Tree 2 registration is never disrupted.
 */
async function fetchEngagementData(identityCommitment: string): Promise<EngagementData> {
	const defaults: EngagementData = {
		engagementRoot: ZERO_HASH,
		engagementPath: Array(DEFAULT_ENGAGEMENT_DEPTH).fill(ZERO_HASH),
		engagementIndex: 0,
		engagementTier: 0,
		actionCount: '0',
		diversityScore: '0',
	};

	try {
		const response = await fetchWithRetry('/api/shadow-atlas/engagement', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ identityCommitment }),
		});

		if (!response.ok) {
			console.warn(`[Shadow Atlas] Engagement fetch returned ${response.status}, using tier-0 defaults`);
			return defaults;
		}

		const data = await response.json();

		// Validate required fields are present
		if (!data.engagementRoot || !data.engagementPath || !Array.isArray(data.engagementPath)) {
			console.warn('[Shadow Atlas] Engagement response missing required fields, using tier-0 defaults');
			return defaults;
		}

		return {
			engagementRoot: data.engagementRoot,
			engagementPath: data.engagementPath,
			engagementIndex: data.engagementIndex ?? 0,
			engagementTier: data.engagementTier ?? 0,
			actionCount: data.actionCount ?? '0',
			diversityScore: data.diversityScore ?? '0',
		};
	} catch (error) {
		console.warn('[Shadow Atlas] Engagement fetch failed, using tier-0 defaults:', error);
		return defaults;
	}
}

// ============================================================================
// Main Handler
// ============================================================================

/**
 * Register user in the three-tree architecture.
 *
 * Sends only the leaf hash to the server (Tree 1 registration),
 * then fetches the cell proof (Tree 2) for the user's cell_id.
 * Stores all credentials in encrypted IndexedDB.
 *
 * @param request - Registration data (includes private inputs stored locally)
 * @returns Session credential for ZK proof generation
 */
export async function registerThreeTree(
	request: ThreeTreeRegistrationRequest
): Promise<ThreeTreeRegistrationResult> {
	try {
		// Step 1: Register leaf hash in Tree 1 (server sees only the hash)
		const tree1Response = await fetchWithRetry('/api/shadow-atlas/register', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ leaf: request.leaf }),
		});

		if (!tree1Response.ok) {
			const errorData = await tree1Response.json().catch(() => ({ error: 'Unknown error' }));
			return {
				success: false,
				error: errorData.error || `Tree 1 registration failed (${tree1Response.status})`,
			};
		}

		const tree1Data = await tree1Response.json();

		// Bug 4 fix: If already registered, the server returns the OLD proof for the
		// old leaf. Storing new secrets alongside the old proof would corrupt the
		// credential — the secrets wouldn't match the leaf in the tree, causing
		// circuit verification to fail. Return an error instead.
		if (tree1Data.alreadyRegistered) {
			return {
				success: false,
				error: 'Already registered. Your existing credential is still valid. Use recovery to re-register with new secrets.',
			};
		}

		if (tree1Data.leafIndex === undefined || !tree1Data.userRoot || !tree1Data.userPath || !tree1Data.pathIndices || !tree1Data.identityCommitment) {
			return {
				success: false,
				error: 'Invalid Tree 1 registration response',
			};
		}

		// Step 2: Use pre-resolved Tree 2 cell proof from IPFS (zero server leaks)
		// The server never learns the user's cell_id — all data fetched from
		// content-addressed IPFS via Storacha CDN.
		const tree2Data = request.tree2;

		// Step 2a: Compute district commitment over the 24-slot districts array
		// (F2 closure — Stage 2.5). Bound into the v2 action-domain preimage so
		// nullifier scope is cryptographically tied to the witnessed districts.
		const districtCommitment = await computeDistrictCommitment(tree2Data.districts);

		// Step 2b: Fetch Tree 3 engagement data (non-blocking — defaults to tier 0 on failure)
		let engagementData = await fetchEngagementData(tree1Data.identityCommitment);

		// Validate Tree 3 BN254 field elements (engagement data comes from untrusted proxy)
		if (!isValidBN254Hex(engagementData.engagementRoot) || !isValidBN254HexArray(engagementData.engagementPath)) {
			console.warn('[Shadow Atlas] Engagement data failed BN254 validation, using tier-0 defaults');
			engagementData = {
				engagementRoot: ZERO_HASH,
				engagementPath: Array(DEFAULT_ENGAGEMENT_DEPTH).fill(ZERO_HASH),
				engagementIndex: 0,
				engagementTier: 0,
				actionCount: '0',
				diversityScore: '0',
			};
		}

		// Step 3: Construct session credential with ALL three tree proofs
		const now = new Date();
		const sessionCredential: SessionCredential = {
			userId: request.userId,
			// NUL-001: Server returns canonical identity commitment (from User.identity_commitment).
			// Deterministic per verified person — ensures same nullifier across re-registrations.
			identityCommitment: tree1Data.identityCommitment,
			leafIndex: tree1Data.leafIndex,
			merklePath: tree1Data.userPath, // Tree 1 siblings
			merkleRoot: tree1Data.userRoot, // Tree 1 root
			// Use human-readable district code (e.g. "CA-12"), not the hex field element
			congressionalDistrict: request.verifiedDistrict ?? 'unknown',

			// Three-tree specific fields
			credentialType: 'three-tree',
			cellId: request.cellId,
			cellMapRoot: tree2Data.cellMapRoot,
			cellMapPath: tree2Data.cellMapPath,
			cellMapPathBits: tree2Data.cellMapPathBits,
			districts: tree2Data.districts,
			// Stage 2.5: bind district commitment into the credential so the
			// v2 action-domain builder can produce a nullifier scope tied to
			// these exact 24 districts. Absent only if sponge-24 failed above.
			districtCommitment,

			// Tree 3 engagement fields
			engagementRoot: engagementData.engagementRoot,
			engagementPath: engagementData.engagementPath,
			engagementIndex: engagementData.engagementIndex,
			engagementTier: engagementData.engagementTier as 0 | 1 | 2 | 3 | 4,
			actionCount: engagementData.actionCount,
			diversityScore: engagementData.diversityScore,

			// Private inputs (stored client-side only, NEVER sent to server)
			userSecret: request.userSecret,
			registrationSalt: request.registrationSalt,

			verificationMethod: request.verificationMethod,
			// Server-derived authority level (from trustTier via getIdentityForAtlas)
			authorityLevel: tree1Data.authorityLevel as 1 | 2 | 3 | 4 | 5 | undefined,
			// Signed receipt from operator (anti-censorship proof)
			receipt: tree1Data.receipt,
			createdAt: now,
			expiresAt: calculateExpirationDate(),
		};

		// Step 4: Store encrypted in IndexedDB
		await storeSessionCredential(sessionCredential);

		console.debug('[Shadow Atlas] Three-tree registration successful:', {
			userId: request.userId,
			leafIndex: tree1Data.leafIndex,
			districts: tree2Data.districts.length,
			engagementTier: engagementData.engagementTier,
			expiresAt: sessionCredential.expiresAt,
		});

		return {
			success: true,
			sessionCredential,
		};
	} catch (error) {
		console.error('[Shadow Atlas] Three-tree registration failed:', error);
		return {
			success: false,
			error: error instanceof Error ? error.message : 'Unknown error',
		};
	}
}

/**
 * Recover a user's credential after browser clear / device loss.
 *
 * Sends replace: true to the registration endpoint which:
 * 1. Looks up the user's existing registration in Convex
 * 2. Calls Shadow Atlas POST /v1/register/replace to zero the old leaf
 * 3. Updates Convex with the new leaf index and proof
 * 4. Returns fresh Tree 1 proof
 *
 * Then fetches fresh Tree 2 cell proof and stores all credentials in IndexedDB.
 *
 * @param request - Recovery data (includes private inputs stored locally)
 * @returns Session credential for ZK proof generation
 */
export async function recoverThreeTree(
	request: ThreeTreeRecoveryRequest
): Promise<ThreeTreeRegistrationResult> {
	try {
		// Step 1: Replace leaf in Tree 1 (sends replace: true)
		const tree1Response = await fetchWithRetry('/api/shadow-atlas/register', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ leaf: request.leaf, replace: true }),
		});

		if (!tree1Response.ok) {
			const errorData = await tree1Response.json().catch(() => ({ error: 'Unknown error' }));
			return {
				success: false,
				error: errorData.error || `Tree 1 leaf replacement failed (${tree1Response.status})`,
			};
		}

		const tree1Data = await tree1Response.json();

		if (tree1Data.leafIndex === undefined || !tree1Data.userRoot || !tree1Data.userPath || !tree1Data.pathIndices || !tree1Data.identityCommitment) {
			return {
				success: false,
				error: 'Invalid Tree 1 replacement response',
			};
		}

		// Step 2: Use pre-resolved Tree 2 proof from IPFS (zero server leaks)
		const tree2Data = request.tree2;

		// Step 2a: Recompute districtCommitment on recovery so the restored
		// SessionCredential carries the Stage-2.5 F2-closure field even when
		// the original registration predated it.
		const districtCommitment = await computeDistrictCommitment(tree2Data.districts);

		// Step 2b: Fetch Tree 3 engagement data (non-blocking — defaults to tier 0 on failure)
		let engagementData = await fetchEngagementData(tree1Data.identityCommitment);

		// Validate Tree 3 BN254 field elements (engagement data comes from untrusted proxy)
		if (!isValidBN254Hex(engagementData.engagementRoot) || !isValidBN254HexArray(engagementData.engagementPath)) {
			console.warn('[Shadow Atlas] Engagement data failed BN254 validation, using tier-0 defaults');
			engagementData = {
				engagementRoot: ZERO_HASH,
				engagementPath: Array(DEFAULT_ENGAGEMENT_DEPTH).fill(ZERO_HASH),
				engagementIndex: 0,
				engagementTier: 0,
				actionCount: '0',
				diversityScore: '0',
			};
		}

		// Step 3: Construct session credential with ALL three tree proofs
		const now = new Date();
		const sessionCredential: SessionCredential = {
			userId: request.userId,
			// NUL-001: Server returns canonical identity commitment (from User.identity_commitment).
			// Recovery now produces the same nullifier as original registration.
			identityCommitment: tree1Data.identityCommitment,
			leafIndex: tree1Data.leafIndex,
			merklePath: tree1Data.userPath,
			merkleRoot: tree1Data.userRoot,
			// Use human-readable district code (e.g. "CA-12"), not the hex field element
			congressionalDistrict: request.verifiedDistrict ?? 'unknown',

			credentialType: 'three-tree',
			cellId: request.cellId,
			cellMapRoot: tree2Data.cellMapRoot,
			cellMapPath: tree2Data.cellMapPath,
			cellMapPathBits: tree2Data.cellMapPathBits,
			districts: tree2Data.districts,
			// Stage 2.5: thread recomputed commitment through the recovery path
			// so post-recovery credentials bind action domains to their witnessed
			// districts exactly like a fresh registration.
			districtCommitment,

			// Tree 3 engagement fields
			engagementRoot: engagementData.engagementRoot,
			engagementPath: engagementData.engagementPath,
			engagementIndex: engagementData.engagementIndex,
			engagementTier: engagementData.engagementTier as 0 | 1 | 2 | 3 | 4,
			actionCount: engagementData.actionCount,
			diversityScore: engagementData.diversityScore,

			userSecret: request.userSecret,
			registrationSalt: request.registrationSalt,

			verificationMethod: request.verificationMethod,
			// Server-derived authority level (from trustTier via getIdentityForAtlas)
			authorityLevel: tree1Data.authorityLevel as 1 | 2 | 3 | 4 | 5 | undefined,
			// W40-010: Thread receipt from recovery path
			receipt: tree1Data.receipt,
			createdAt: now,
			expiresAt: calculateExpirationDate(),
		};

		// Step 4: Store encrypted in IndexedDB
		await storeSessionCredential(sessionCredential);

		console.debug('[Shadow Atlas] Three-tree recovery successful:', {
			userId: request.userId,
			leafIndex: tree1Data.leafIndex,
			districts: tree2Data.districts.length,
			engagementTier: engagementData.engagementTier,
			expiresAt: sessionCredential.expiresAt,
		});

		return {
			success: true,
			sessionCredential,
		};
	} catch (error) {
		console.error('[Shadow Atlas] Three-tree recovery failed:', error);
		return {
			success: false,
			error: error instanceof Error ? error.message : 'Unknown error',
		};
	}
}

// ============================================================================
// Identity Commitment Generation
// ============================================================================

/**
 * Generate identity commitment from verification provider data.
 *
 * Uses Poseidon hash to create a pseudonymous identity commitment
 * compatible with on-chain verification.
 *
 * SECURITY (NUL-001): The commitment MUST be deterministic per verified person.
 * Same person re-verifying must produce the SAME commitment so nullifiers match.
 * Therefore we hash ONLY provider + credentialHash (which is deterministic per
 * document), and EXCLUDE issuedAt/timestamps which would break Sybil prevention.
 *
 * @param providerData - Verification provider data
 * @returns Identity commitment (hex string with 0x prefix)
 */
export async function generateIdentityCommitment(providerData: {
	provider: 'digital-credentials-api';
	credentialHash: string;
}): Promise<string> {
	const { poseidonHash } = await import('../crypto/poseidon');
	const input = `${providerData.provider}:${providerData.credentialHash}`;
	return await poseidonHash(input);
}

export { registerThreeTree as registerInShadowAtlas };
