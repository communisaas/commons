/**
 * District Credential Issuance & Verification
 *
 * W3C Verifiable Credential 2.0 implementation for district residency attestation.
 * Tier 2 in the Graduated Trust Architecture.
 *
 * Signing:
 *   Ed25519 using IDENTITY_SIGNING_KEY env var (hex-encoded 32-byte seed).
 *   Backward-compatible verification accepts HMAC-SHA256 (IDENTITY_HASH_SALT)
 *   for credentials issued before the migration.
 *
 * Uses @noble/curves for Ed25519 (pure JS, CF Workers compatible).
 * Web Crypto API used only for legacy HMAC fallback and SHA-256 hashing.
 */

import { ed25519 } from '@noble/curves/ed25519';
import { TIER_CREDENTIAL_TTL } from '$lib/core/identity/credential-policy';

/** Type-safe BufferSource conversion — Uint8Array is a valid BufferSource at runtime;
 *  this helper avoids cross-realm type issues in test environments (vitest/jsdom). */
function toBufferSource(data: Uint8Array | ArrayBuffer): BufferSource {
	return data as BufferSource;
}

// ============================================================================
// Types
// ============================================================================

export interface DistrictMembership {
	congressional: string; // e.g., "CA-12"
	stateSenate?: string;
	stateAssembly?: string;
}

export interface DistrictResidencyCredential {
	'@context': ['https://www.w3.org/ns/credentials/v2'];
	type: ['VerifiableCredential', 'DistrictResidencyCredential'];
	issuer: string; // 'did:web:commons.email'
	issuanceDate: string; // ISO 8601
	expirationDate: string; // ISO 8601 (6 months from issuance)
	credentialSubject: {
		id: string; // user's did:key or fallback user ID
		districtMembership: DistrictMembership;
	};
	proof: {
		type: 'Ed25519Signature2020';
		created: string;
		verificationMethod: string;
		proofPurpose: 'assertionMethod';
		proofValue: string; // base64url-encoded Ed25519 signature
	};
}

export interface IssueDistrictCredentialParams {
	userId: string;
	didKey: string | null;
	congressional: string | null;
	stateSenate?: string;
	stateAssembly?: string;
	verificationMethod: 'civic_api' | 'postal' | 'shadow_atlas';
}

// ============================================================================
// Constants
// ============================================================================

const ISSUER_DID = 'did:web:commons.email';
const VERIFICATION_METHOD = `${ISSUER_DID}#district-attestation-key`;

// ============================================================================
// Internal Helpers (CF Workers compatible)
// ============================================================================

const encoder = new TextEncoder();

/**
 * Get Ed25519 signing key pair from environment.
 * IDENTITY_SIGNING_KEY is a hex-encoded 32-byte Ed25519 private key (seed).
 * Returns hex string for private key (accepted by @noble/curves) and
 * Uint8Array for public key.
 */
function getSigningKeyPair(): { privateKeyHex: string; publicKey: Uint8Array } {
	const keyHex = process.env.IDENTITY_SIGNING_KEY;
	if (!keyHex) {
		throw new Error(
			'IDENTITY_SIGNING_KEY environment variable not configured. ' +
				'Generate with: openssl rand -hex 32'
		);
	}
	const publicKey = ed25519.getPublicKey(keyHex);
	return { privateKeyHex: keyHex, publicKey };
}

/**
 * Encode a Uint8Array as base64url (no padding), CF Workers compatible.
 */
function base64urlEncode(bytes: Uint8Array): string {
	// Use a manual approach that works on CF Workers (no btoa dependency issues)
	const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
	let result = '';
	const len = bytes.length;
	for (let i = 0; i < len; i += 3) {
		const b0 = bytes[i];
		const b1 = i + 1 < len ? bytes[i + 1] : 0;
		const b2 = i + 2 < len ? bytes[i + 2] : 0;
		result += CHARS[(b0 >> 2) & 0x3f];
		result += CHARS[((b0 << 4) | (b1 >> 4)) & 0x3f];
		if (i + 1 < len) result += CHARS[((b1 << 2) | (b2 >> 6)) & 0x3f];
		if (i + 2 < len) result += CHARS[b2 & 0x3f];
	}
	// Convert to base64url: replace + with -, / with _, strip =
	return result.replace(/\+/g, '-').replace(/\//g, '_');
}

/**
 * Decode base64url string to Uint8Array, CF Workers compatible.
 */
export function base64urlDecode(str: string): Uint8Array {
	// Convert base64url back to standard base64
	let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
	// Add padding
	while (base64.length % 4 !== 0) {
		base64 += '=';
	}

	const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
	const lookup = new Uint8Array(128);
	for (let i = 0; i < CHARS.length; i++) {
		lookup[CHARS.charCodeAt(i)] = i;
	}

	const len = base64.length;
	const padCount = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
	const byteLen = (len * 3) / 4 - padCount;
	const bytes = new Uint8Array(byteLen);

	let j = 0;
	for (let i = 0; i < len; i += 4) {
		const a = lookup[base64.charCodeAt(i)];
		const b = lookup[base64.charCodeAt(i + 1)];
		const c = lookup[base64.charCodeAt(i + 2)];
		const d = lookup[base64.charCodeAt(i + 3)];

		bytes[j++] = (a << 2) | (b >> 4);
		if (j < byteLen) bytes[j++] = ((b & 0x0f) << 4) | (c >> 2);
		if (j < byteLen) bytes[j++] = ((c & 0x03) << 6) | d;
	}

	return bytes;
}

/**
 * Build the credential body (everything EXCEPT the proof field).
 * This is the data that gets signed/verified.
 */
function buildCredentialBody(
	params: IssueDistrictCredentialParams,
	issuanceDate: string,
	expirationDate: string
): Omit<DistrictResidencyCredential, 'proof'> {
	const membership: DistrictMembership = {
		congressional: params.congressional
	};
	if (params.stateSenate) membership.stateSenate = params.stateSenate;
	if (params.stateAssembly) membership.stateAssembly = params.stateAssembly;

	return {
		'@context': ['https://www.w3.org/ns/credentials/v2'],
		type: ['VerifiableCredential', 'DistrictResidencyCredential'],
		issuer: ISSUER_DID,
		issuanceDate,
		expirationDate,
		credentialSubject: {
			id: params.didKey ?? `urn:commons:user:${params.userId}`,
			districtMembership: membership
		}
	};
}

/**
 * Deep-sort object keys for canonical JSON (recursive).
 */
function deepSortKeys(obj: unknown): unknown {
	if (obj === null || typeof obj !== 'object') return obj;
	if (Array.isArray(obj)) return obj.map(deepSortKeys);
	const sorted: Record<string, unknown> = {};
	for (const key of Object.keys(obj as Record<string, unknown>).sort()) {
		sorted[key] = deepSortKeys((obj as Record<string, unknown>)[key]);
	}
	return sorted;
}

/**
 * Produce deterministic JSON of any object (recursive key sort).
 */
function deterministicJSON(obj: unknown): string {
	return JSON.stringify(deepSortKeys(obj));
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Issue a W3C VC 2.0 DistrictResidencyCredential.
 *
 * Signs the credential body with Ed25519 using the IDENTITY_SIGNING_KEY.
 * Expiration is TIER_CREDENTIAL_TTL[2] (6 months) from now.
 */
export async function issueDistrictCredential(
	params: IssueDistrictCredentialParams
): Promise<DistrictResidencyCredential> {
	const now = new Date();
	const ttl = TIER_CREDENTIAL_TTL[2]; // 6 months in ms
	const expiry = new Date(now.getTime() + ttl);

	const issuanceDate = now.toISOString();
	const expirationDate = expiry.toISOString();

	const body = buildCredentialBody(params, issuanceDate, expirationDate);

	// Sign the canonical body with Ed25519
	// Note: pass privateKey as hex string and wrap bodyBytes to avoid
	// cross-realm Uint8Array issues (jsdom vs Node.js globals)
	const { privateKeyHex } = getSigningKeyPair();
	const bodyBytes = new Uint8Array(encoder.encode(deterministicJSON(body)));
	const signature = ed25519.sign(bodyBytes, privateKeyHex);
	const proofValue = base64urlEncode(signature);

	const credential: DistrictResidencyCredential = {
		...body,
		proof: {
			type: 'Ed25519Signature2020',
			created: issuanceDate,
			verificationMethod: VERIFICATION_METHOD,
			proofPurpose: 'assertionMethod',
			proofValue
		}
	};

	return credential;
}

/**
 * Verify a DistrictResidencyCredential.
 *
 * Tries Ed25519 verification first (current signing method).
 * Falls back to legacy HMAC-SHA256 for credentials issued before migration.
 * Returns true if the credential is valid and untampered.
 */
export async function verifyDistrictCredential(
	credential: DistrictResidencyCredential
): Promise<boolean> {
	try {
		const { proof: _proof, ...body } = credential;
		const bodyBytes = new Uint8Array(encoder.encode(deterministicJSON(body)));
		const signatureBytes = new Uint8Array(base64urlDecode(credential.proof.proofValue));

		// Try Ed25519 verification first
		try {
			const { publicKey } = getSigningKeyPair();
			const valid = ed25519.verify(signatureBytes, bodyBytes, publicKey);
			if (valid) return true;
		} catch {
			// Ed25519 verification failed — try HMAC fallback
		}

		// Backward compatibility: try HMAC-SHA256 verification
		// This handles credentials signed before the Ed25519 migration
		return await verifyWithHmac(bodyBytes, signatureBytes);
	} catch {
		return false;
	}
}

/**
 * Legacy HMAC-SHA256 verification for pre-migration credentials.
 * Will be removed after credential TTL expires (90 days from migration).
 */
async function verifyWithHmac(
	bodyBytes: Uint8Array,
	signatureBytes: Uint8Array
): Promise<boolean> {
	try {
		const salt = process.env.IDENTITY_HASH_SALT;
		if (!salt) return false;

		const key = await crypto.subtle.importKey(
			'raw',
			encoder.encode(salt),
			{ name: 'HMAC', hash: 'SHA-256' },
			false,
			['verify']
		);

		return crypto.subtle.verify(
			'HMAC',
			key,
			toBufferSource(signatureBytes),
			toBufferSource(bodyBytes)
		);
	} catch {
		return false;
	}
}

/**
 * Compute SHA-256 hash of a credential for integrity tracking.
 *
 * The hash covers the ENTIRE credential (including proof) so that any
 * modification — even to metadata — is detectable.
 *
 * Returns a lowercase hex string.
 */
export async function hashCredential(
	credential: DistrictResidencyCredential
): Promise<string> {
	const bytes = encoder.encode(deterministicJSON(credential));
	const digest = await crypto.subtle.digest('SHA-256', bytes);
	const arr = new Uint8Array(digest);
	return Array.from(arr)
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

/**
 * Compute HMAC-SHA256 hash of a district string for privacy-preserving storage.
 *
 * Used for User.district_hash — rainbow-table resistant (requires ENV key),
 * deterministic across users (same district → same hash for aggregate queries).
 *
 * Returns a lowercase hex string.
 */
export async function hashDistrict(district: string): Promise<string> {
	const key = process.env.DISTRICT_HASH_KEY;
	if (key) {
		// HMAC with server-side key — rainbow-table resistant
		const keyBytes = encoder.encode(key);
		const cryptoKey = await crypto.subtle.importKey(
			'raw',
			keyBytes,
			{ name: 'HMAC', hash: 'SHA-256' },
			false,
			['sign']
		);
		const sig = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(district));
		const arr = new Uint8Array(sig);
		return Array.from(arr)
			.map((b) => b.toString(16).padStart(2, '0'))
			.join('');
	}
	// Fallback: plain SHA-256 (dev environments without DISTRICT_HASH_KEY)
	const bytes = encoder.encode(district);
	const digest = await crypto.subtle.digest('SHA-256', bytes);
	const arr = new Uint8Array(digest);
	return Array.from(arr)
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}
