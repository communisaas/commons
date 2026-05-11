/**
 * Address-resolution token: HMAC-bound link between a coordinate-issuing
 * endpoint (`/api/location/resolve-address` or `/api/location/resolve`) and
 * the credential-issuing endpoint (`/api/identity/verify-address`). The
 * verify-address handler requires this token whenever the client supplies
 * `coordinates` so an attacker cannot substitute coordinates between the
 * two requests.
 *
 * Two modes encode WHICH coordinate-issuing path produced the token (the
 * mode is part of the HMAC input so the server cannot be tricked by a
 * geo-mode token presented as an addr-mode token):
 *
 *   - `addr` — minted by `/api/location/resolve-address`. Binds
 *     (mode, userId, lat, lng, addressHash, expiresAt). The addressHash
 *     pins the geocoded coordinates to the user-supplied address so an
 *     attacker cannot cherry-pick coordinates across multiple
 *     resolve-address calls without also accepting the corresponding
 *     addressHash chain in the token.
 *
 *   - `geo` — minted by `/api/location/resolve` (browser geolocation).
 *     Binds (mode, userId, lat, lng, expiresAt). No addressHash because
 *     the browser-geolocation flow has no plaintext address. This mode
 *     does NOT prevent a malicious client from spoofing
 *     `navigator.geolocation` — that's a known limitation of any
 *     client-supplied-coordinate design and is downstream-gated by
 *     `reconcileCellGate` re-geocoding the witness address at submission.
 *     The geo-mode token's value is closing the omit-the-token bypass
 *     against the manual-address gate, not GPS authenticity.
 *
 * Format: `<version>.<mode>.<expiresAtMs>.<hexHmac>` — opaque to clients.
 *
 * Constant-time signature comparison via XOR-accumulator.
 */

import { timingSafeEqual } from 'node:crypto';
import { env } from '$env/dynamic/private';
import { createHmacProof } from './session-proof';

const TOKEN_VERSION = 'v1';
const TOKEN_TTL_MS = 30 * 60 * 1000;
const PAYLOAD_SEPARATOR = '|';

export type AddressTokenMode = 'addr' | 'geo';

export interface AddressCanonicalParts {
	street: string;
	city: string;
	state: string;
	zip: string;
	country?: string;
}

/**
 * Canonicalize an address for hashing. Lowercases street/city, uppercases
 * country/state/zip, normalizes whitespace. Pipe-separates fields so a
 * crafted address can't masquerade as a different field via embedded
 * separators (the country code is restricted to a 2-letter set elsewhere
 * but defense-in-depth: '|' would still produce a different canonical).
 */
export function canonicalizeAddress(parts: AddressCanonicalParts): string {
	const country = (parts.country ?? 'US').toUpperCase();
	const state = parts.state.toUpperCase().trim();
	const zip = parts.zip.toUpperCase().replace(/\s+/g, '');
	const city = parts.city.toLowerCase().trim().replace(/\s+/g, ' ');
	const street = parts.street.toLowerCase().trim().replace(/\s+/g, ' ');
	return [country, state, zip, city, street].join(PAYLOAD_SEPARATOR);
}

export async function computeAddressHash(parts: AddressCanonicalParts): Promise<string> {
	const canonical = canonicalizeAddress(parts);
	const data = new TextEncoder().encode(canonical);
	const digest = await crypto.subtle.digest('SHA-256', data);
	return Array.from(new Uint8Array(digest))
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('');
}

/**
 * Active secret used by `issueAddressResolutionToken` /
 * `issueGeolocationResolutionToken`. Always the current secret. Throws if
 * unset or under-length so a misconfigured deploy fails loud rather than
 * silently issuing weak tokens.
 */
function tokenSecret(): string {
	const secret = env.ADDRESS_RESOLUTION_TOKEN_SECRET;
	if (!secret || secret.length < 32) {
		throw new Error(
			'ADDRESS_RESOLUTION_TOKEN_SECRET must be set (>= 32 bytes) to issue or verify address-resolution tokens'
		);
	}
	return secret;
}

/**
 * Optional previous secret read by `verifyAddressResolutionToken` during a
 * rotation window. The verifier tries the active secret first; on mismatch,
 * retries against `ADDRESS_RESOLUTION_TOKEN_SECRET_PREVIOUS` if set. This
 * lets operators rotate without invalidating in-flight tokens:
 *
 *   1. Set `_PREVIOUS = current_value`.
 *   2. Set `ADDRESS_RESOLUTION_TOKEN_SECRET = new_value`. Deploy.
 *   3. Wait at least `TOKEN_TTL_MS` (30 minutes) so any token minted under
 *      the old secret has expired.
 *   4. Remove `_PREVIOUS`. Deploy.
 *
 * Returns null when not configured (single-secret operation, the default).
 * Same length floor as the active secret — operators rotating to a weaker
 * key gets caught.
 */
function previousTokenSecret(): string | null {
	const secret = env.ADDRESS_RESOLUTION_TOKEN_SECRET_PREVIOUS;
	if (!secret) return null;
	if (secret.length < 32) {
		// Bad _PREVIOUS must NOT brick active-secret verification — log
		// loud and treat as unset. An operator typo would otherwise take
		// down every valid in-flight token, not just rotation continuity.
		console.warn(
			'[address-resolution-token] ADDRESS_RESOLUTION_TOKEN_SECRET_PREVIOUS is set but < 32 bytes; ignoring (active-secret verification continues)'
		);
		return null;
	}
	return secret;
}

function payloadMessage(args: {
	mode: AddressTokenMode;
	userId: string;
	lat: number;
	lng: number;
	addressHash: string | null;
	expiresAt: number;
}): string {
	// Round coordinates to 6 decimals (~11 cm precision). Anything finer is
	// noise from the geocoder and would make tokens fragile to float
	// re-serialization across the wire.
	const lat = args.lat.toFixed(6);
	const lng = args.lng.toFixed(6);
	const parts: string[] = [
		TOKEN_VERSION,
		args.mode,
		args.userId,
		lat,
		lng
	];
	if (args.mode === 'addr') {
		if (!args.addressHash) {
			throw new Error('addr-mode token requires addressHash');
		}
		parts.push(args.addressHash);
	}
	parts.push(String(args.expiresAt));
	return parts.join(PAYLOAD_SEPARATOR);
}

export interface IssuedAddressToken {
	token: string;
	addressHash: string | null;
	expiresAt: number;
}

export async function issueAddressResolutionToken(args: {
	userId: string;
	lat: number;
	lng: number;
	address: AddressCanonicalParts;
}): Promise<IssuedAddressToken & { addressHash: string }> {
	const expiresAt = Date.now() + TOKEN_TTL_MS;
	const addressHash = await computeAddressHash(args.address);
	const message = payloadMessage({
		mode: 'addr',
		userId: args.userId,
		lat: args.lat,
		lng: args.lng,
		addressHash,
		expiresAt
	});
	const signature = await createHmacProof(message, tokenSecret());
	return {
		token: `${TOKEN_VERSION}.addr.${expiresAt}.${signature}`,
		addressHash,
		expiresAt
	};
}

/**
 * Mint a geo-mode token (browser geolocation, no plaintext address). Bound
 * to (userId, lat, lng, expiresAt) only. Cannot be presented as an
 * addr-mode token because the mode is part of the HMAC input.
 */
export async function issueGeolocationResolutionToken(args: {
	userId: string;
	lat: number;
	lng: number;
}): Promise<IssuedAddressToken> {
	const expiresAt = Date.now() + TOKEN_TTL_MS;
	const message = payloadMessage({
		mode: 'geo',
		userId: args.userId,
		lat: args.lat,
		lng: args.lng,
		addressHash: null,
		expiresAt
	});
	const signature = await createHmacProof(message, tokenSecret());
	return {
		token: `${TOKEN_VERSION}.geo.${expiresAt}.${signature}`,
		addressHash: null,
		expiresAt
	};
}

export type AddressTokenVerifyFailure =
	| 'malformed'
	| 'unsupported_version'
	| 'unsupported_mode'
	| 'mode_mismatch'
	| 'expired'
	| 'signature_mismatch';

export interface AddressTokenVerifyResult {
	valid: boolean;
	mode?: AddressTokenMode;
	reason?: AddressTokenVerifyFailure;
}

export async function verifyAddressResolutionToken(args: {
	token: string;
	userId: string;
	lat: number;
	lng: number;
	/** Required for addr-mode tokens, ignored for geo-mode. */
	addressHash?: string | null;
}): Promise<AddressTokenVerifyResult> {
	const segments = args.token.split('.');
	if (segments.length !== 4) {
		return { valid: false, reason: 'malformed' };
	}
	const [version, mode, expiresAtStr, signature] = segments;
	if (version !== TOKEN_VERSION) {
		return { valid: false, reason: 'unsupported_version' };
	}
	if (mode !== 'addr' && mode !== 'geo') {
		return { valid: false, reason: 'unsupported_mode' };
	}
	const tokenMode = mode as AddressTokenMode;
	// addr-mode requires the caller to supply the addressHash that was
	// bound at issuance; geo-mode rejects an addressHash claim because it
	// wasn't part of issuance and accepting it could let an attacker
	// upgrade a geo-mode token into a faux-addr-mode by adding a hash.
	if (tokenMode === 'addr' && !args.addressHash) {
		return { valid: false, mode: tokenMode, reason: 'mode_mismatch' };
	}
	if (tokenMode === 'geo' && args.addressHash) {
		return { valid: false, mode: tokenMode, reason: 'mode_mismatch' };
	}
	const expiresAt = Number(expiresAtStr);
	if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
		return { valid: false, mode: tokenMode, reason: 'expired' };
	}
	const expectedMessage = payloadMessage({
		mode: tokenMode,
		userId: args.userId,
		lat: args.lat,
		lng: args.lng,
		addressHash: args.addressHash ?? null,
		expiresAt
	});
	// Try the active secret first; on mismatch, retry against the optional
	// rotation-window previous secret. Constant-time compare via Node's
	// `crypto.timingSafeEqual` over Buffers (the canonical primitive —
	// V8's `charCodeAt`-over-strings has variable timing on UTF-16-backed
	// strings, though hex output is ASCII-only in practice).
	// `timingSafeEqual` throws on length mismatch, so we early-return there.
	const sigBuf = Buffer.from(signature, 'utf8');
	const candidates: string[] = [tokenSecret()];
	const previous = previousTokenSecret();
	if (previous) candidates.push(previous);
	for (const secret of candidates) {
		const expectedSignature = await createHmacProof(expectedMessage, secret);
		if (signature.length !== expectedSignature.length) continue;
		const expectedBuf = Buffer.from(expectedSignature, 'utf8');
		if (timingSafeEqual(sigBuf, expectedBuf)) {
			return { valid: true, mode: tokenMode };
		}
	}
	return { valid: false, mode: tokenMode, reason: 'signature_mismatch' };
}
