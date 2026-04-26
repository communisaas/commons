/**
 * COSE_Sign1 Verification for ISO 18013-5 mDL Credentials
 *
 * Implements RFC 9052 Section 4.2 (COSE_Sign1) signature verification
 * using Web Crypto API ECDSA P-256/P-384 — Cloudflare Workers compatible.
 *
 * COSE_Sign1 = [protectedHeaders, unprotectedHeaders, payload, signature]
 * Sig_structure = ["Signature1", protectedHeaders, externalAad, payload]
 *
 * The issuer's X.509 certificate is extracted from unprotectedHeaders (key 33 = x5chain),
 * its ECDSA public key (P-256 or P-384) is parsed via minimal ASN.1/DER extraction,
 * then imported into Web Crypto for signature verification.
 *
 * Dependencies: cbor-web (CBOR encode/decode), Web Crypto API (ECDSA verification)
 * No Node.js crypto, no Buffer — runs on CF Workers.
 */

import type { IACACertificate } from './iaca-roots';

/** Type-safe BufferSource conversion — Uint8Array is a valid BufferSource at runtime;
 *  this helper avoids cross-realm type issues in test environments (vitest/jsdom). */
function toBufferSource(data: Uint8Array | ArrayBuffer): BufferSource {
	return data as BufferSource;
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type CoseVerificationResult =
	| { valid: true; mso: MobileSecurityObject }
	| { valid: false; reason: string };

export type CertificateTrustResult = { trusted: true } | { trusted: false; reason: string };

export interface MobileSecurityObject {
	version: string;
	digestAlgorithm: string;
	/** namespace -> { digestID -> digest } */
	valueDigests: Map<string, Map<number, Uint8Array>>;
	validityInfo: {
		signed: Date;
		validFrom: Date;
		validUntil: Date;
	};
	/** Raw DER bytes of the issuer certificate */
	issuerCertificate: Uint8Array;
}

// ---------------------------------------------------------------------------
// COSE algorithm identifiers (RFC 9053)
// ---------------------------------------------------------------------------

/** ES256 = ECDSA w/ SHA-256 using P-256 */
const COSE_ALG_ES256 = -7;

/** ES384 = ECDSA w/ SHA-384 using P-384 */
const COSE_ALG_ES384 = -35;

/** COSE header key for algorithm */
const COSE_HEADER_ALG = 1;

/** COSE unprotected header key for x5chain (X.509 certificate chain) */
const COSE_HEADER_X5CHAIN = 33;

// ---------------------------------------------------------------------------
// ASN.1 OIDs for X.509 EC public key extraction
// ---------------------------------------------------------------------------

/** OID 1.2.840.10045.2.1 — id-ecPublicKey */
const EC_PUBLIC_KEY_OID = new Uint8Array([0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01]);

/** OID 1.2.840.10045.3.1.7 — prime256v1 (P-256) */
const P256_CURVE_OID = new Uint8Array([0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07]);

/** OID 1.3.132.0.34 — secp384r1 (P-384) */
const P384_CURVE_OID = new Uint8Array([0x2b, 0x81, 0x04, 0x00, 0x22]);

/** Supported EC curves with their parameters */
export type EcCurve = 'P-256' | 'P-384';

export interface EcPublicKeyInfo {
	keyBytes: Uint8Array;
	curve: EcCurve;
}

/** Curve → hash algorithm mapping */
const CURVE_PARAMS: Record<EcCurve, { hash: string; sigSize: number; componentSize: number }> = {
	'P-256': { hash: 'SHA-256', sigSize: 64, componentSize: 32 },
	'P-384': { hash: 'SHA-384', sigSize: 96, componentSize: 48 }
};

// ---------------------------------------------------------------------------
// Main verification function
// ---------------------------------------------------------------------------

/**
 * Verify a COSE_Sign1 structure from an mDL issuerAuth.
 *
 * @param issuerAuth  COSE_Sign1 array [protectedHeadersCBOR, unprotectedHeaders, payload, signature]
 * @param trustedRoots  Array of IACA root certificates to verify against
 * @returns Verification result with parsed MSO on success
 */
export async function verifyCoseSign1(
	issuerAuth: unknown[],
	trustedRoots: IACACertificate[]
): Promise<CoseVerificationResult> {
	const { decode, encode } = await import('cbor-web');

	// --- Validate COSE_Sign1 structure ---
	if (!Array.isArray(issuerAuth) || issuerAuth.length !== 4) {
		return { valid: false, reason: 'COSE_Sign1 must be a 4-element array' };
	}

	const [protectedHeadersRaw, unprotectedHeaders, payloadRaw, signature] = issuerAuth;

	// --- Protected headers: CBOR-encoded bstr ---
	let protectedHeadersCBOR: Uint8Array;
	if (protectedHeadersRaw instanceof Uint8Array) {
		protectedHeadersCBOR = protectedHeadersRaw;
	} else if (protectedHeadersRaw instanceof ArrayBuffer) {
		protectedHeadersCBOR = new Uint8Array(protectedHeadersRaw);
	} else {
		return { valid: false, reason: 'Protected headers must be a byte string' };
	}

	// Decode protected headers to check algorithm
	let protectedHeaders: Map<number, unknown>;
	try {
		const decoded = decode(protectedHeadersCBOR);
		if (decoded instanceof Map) {
			protectedHeaders = decoded;
		} else if (typeof decoded === 'object' && decoded !== null) {
			protectedHeaders = new Map(Object.entries(decoded).map(([k, v]) => [Number(k), v]));
		} else {
			return { valid: false, reason: 'Protected headers did not decode to a map' };
		}
	} catch {
		return { valid: false, reason: 'Failed to decode protected headers CBOR' };
	}

	const algorithm = protectedHeaders.get(COSE_HEADER_ALG);
	if (algorithm !== COSE_ALG_ES256 && algorithm !== COSE_ALG_ES384) {
		return {
			valid: false,
			reason: `Unsupported COSE algorithm: ${algorithm} (expected ES256 = -7 or ES384 = -35)`
		};
	}

	const coseAlgCurve: EcCurve = algorithm === COSE_ALG_ES384 ? 'P-384' : 'P-256';
	const coseAlgParams = CURVE_PARAMS[coseAlgCurve];

	// --- Signature must be bytes ---
	let signatureBytes: Uint8Array;
	if (signature instanceof Uint8Array) {
		signatureBytes = signature;
	} else if (signature instanceof ArrayBuffer) {
		signatureBytes = new Uint8Array(signature);
	} else {
		return { valid: false, reason: 'Signature must be a byte string' };
	}

	// Verify signature length matches algorithm (ES256=64, ES384=96)
	if (signatureBytes.length !== coseAlgParams.sigSize) {
		return {
			valid: false,
			reason: `Invalid signature length: ${signatureBytes.length} (expected ${coseAlgParams.sigSize} for ${coseAlgCurve})`
		};
	}

	// --- Payload (MSO) ---
	let payloadCBOR: Uint8Array;
	if (payloadRaw instanceof Uint8Array) {
		payloadCBOR = payloadRaw;
	} else if (payloadRaw instanceof ArrayBuffer) {
		payloadCBOR = new Uint8Array(payloadRaw);
	} else if (payloadRaw === null) {
		// Detached payload — not supported for mDL
		return { valid: false, reason: 'Detached COSE_Sign1 payload not supported' };
	} else {
		return { valid: false, reason: 'Payload must be a byte string' };
	}

	// --- Extract issuer certificate from unprotected headers ---
	let issuerCertDER: Uint8Array;
	try {
		issuerCertDER = extractIssuerCert(unprotectedHeaders);
	} catch (err) {
		return {
			valid: false,
			reason: `Failed to extract issuer certificate: ${err instanceof Error ? err.message : String(err)}`
		};
	}

	// --- Trust store check: verify issuer cert chains to a trusted root ---
	const trustResult = await verifyCertificateAgainstIacaRoots(issuerCertDER, trustedRoots);
	if (!trustResult.trusted) {
		return { valid: false, reason: trustResult.reason };
	}

	// --- Extract ECDSA public key from issuer certificate ---
	let publicKey: CryptoKey;
	let certCurve: EcCurve;
	try {
		const keyInfo = extractEcPublicKeyFromDER(issuerCertDER);
		certCurve = keyInfo.curve;
		publicKey = await crypto.subtle.importKey(
			'raw',
			toBufferSource(keyInfo.keyBytes),
			{ name: 'ECDSA', namedCurve: keyInfo.curve },
			false,
			['verify']
		);
	} catch (err) {
		return {
			valid: false,
			reason: `Failed to extract/import public key: ${err instanceof Error ? err.message : String(err)}`
		};
	}

	// --- Build Sig_structure and verify ---
	// Sig_structure = ["Signature1", protectedHeadersCBOR, externalAad, payloadCBOR]
	const sigStructure = ['Signature1', protectedHeadersCBOR, new Uint8Array(0), payloadCBOR];

	let sigStructureEncoded: Uint8Array;
	try {
		sigStructureEncoded = new Uint8Array(encode(sigStructure));
	} catch {
		return { valid: false, reason: 'Failed to CBOR-encode Sig_structure' };
	}

	// COSE signature is raw format (r || s). Length depends on curve.
	// Web Crypto API also uses raw (IEEE P1363) format for ECDSA — pass directly.
	const verifyHash = CURVE_PARAMS[certCurve].hash;
	let valid: boolean;
	try {
		valid = await crypto.subtle.verify(
			{ name: 'ECDSA', hash: verifyHash },
			publicKey,
			toBufferSource(signatureBytes),
			toBufferSource(sigStructureEncoded)
		);
	} catch (err) {
		return {
			valid: false,
			reason: `Signature verification threw: ${err instanceof Error ? err.message : String(err)}`
		};
	}

	if (!valid) {
		return { valid: false, reason: 'ECDSA signature verification failed' };
	}

	// --- Parse MSO from payload ---
	let mso: MobileSecurityObject;
	try {
		mso = parseMobileSecurityObject(payloadCBOR, issuerCertDER, decode);
	} catch (err) {
		return {
			valid: false,
			reason: `Failed to parse MSO: ${err instanceof Error ? err.message : String(err)}`
		};
	}

	return { valid: true, mso };
}

// ---------------------------------------------------------------------------
// MSO digest validation
// ---------------------------------------------------------------------------

/**
 * Validate MSO digests against actual IssuerSignedItem elements.
 *
 * For each field in the namespace, compute SHA-256 of the CBOR-encoded
 * IssuerSignedItem and verify it matches the corresponding valueDigest entry
 * in the MSO.
 *
 * @param mso  Parsed MobileSecurityObject with valueDigests
 * @param namespaceElements  { namespace: [IssuerSignedItem CBOR bytes, ...] }
 * @param decode  CBOR decode function
 * @param encode  CBOR encode function
 * @returns true if all digests match
 */
export async function validateMsoDigests(
	mso: MobileSecurityObject,
	namespaceElements: Record<string, unknown[]>,
	decode: (data: Uint8Array) => unknown,
	encode: (data: unknown) => Uint8Array
): Promise<boolean> {
	for (const [namespace, elements] of Object.entries(namespaceElements)) {
		const nsDigests = mso.valueDigests.get(namespace);
		if (!nsDigests) {
			// Namespace not in MSO — cannot validate
			continue;
		}

		for (const element of elements) {
			let elementBytes: Uint8Array;
			let item: Record<string, unknown>;

			if (element instanceof Uint8Array) {
				elementBytes = element;
				item = decode(element) as Record<string, unknown>;
			} else if (typeof element === 'object' && element !== null) {
				// Handle CBOR Tagged values (tag 24)
				const tagged = element as { tag?: number; value?: Uint8Array };
				if (tagged.tag === 24 && tagged.value instanceof Uint8Array) {
					elementBytes = tagged.value;
					item = decode(tagged.value) as Record<string, unknown>;
				} else {
					// Already decoded object — encode it for hashing
					elementBytes = new Uint8Array(encode(element));
					item = element as Record<string, unknown>;
				}
			} else {
				continue;
			}

			const digestID =
				typeof item.digestID === 'number'
					? item.digestID
					: typeof item.digestId === 'number'
						? item.digestId
						: null;

			if (digestID === null) continue;

			const expectedDigest = nsDigests.get(digestID);
			if (!expectedDigest) {
				// Digest ID not in MSO — element was not signed
				return false;
			}

			// Compute SHA-256 of the CBOR-encoded IssuerSignedItem
			const actualDigest = new Uint8Array(
				await crypto.subtle.digest('SHA-256', toBufferSource(elementBytes))
			);

			if (!uint8ArrayEqual(actualDigest, expectedDigest)) {
				return false;
			}
		}
	}

	return true;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Extract the issuer certificate (DER bytes) from COSE unprotected headers.
 * The certificate is at key 33 (x5chain).
 */
function extractIssuerCert(unprotectedHeaders: unknown): Uint8Array {
	if (!unprotectedHeaders || typeof unprotectedHeaders !== 'object') {
		throw new Error('No unprotected headers');
	}

	let cert: unknown;

	if (unprotectedHeaders instanceof Map) {
		cert = unprotectedHeaders.get(COSE_HEADER_X5CHAIN);
	} else {
		const headers = unprotectedHeaders as Record<string | number, unknown>;
		cert = headers[COSE_HEADER_X5CHAIN] ?? headers['33'];
	}

	if (!cert) {
		throw new Error('No x5chain (key 33) in unprotected headers');
	}

	// x5chain can be a single cert (bstr) or array of certs
	if (cert instanceof Uint8Array) {
		return cert;
	}
	if (cert instanceof ArrayBuffer) {
		return new Uint8Array(cert);
	}
	if (Array.isArray(cert) && cert.length > 0) {
		const first = cert[0];
		if (first instanceof Uint8Array) return first;
		if (first instanceof ArrayBuffer) return new Uint8Array(first);
	}

	throw new Error('x5chain value is not a byte string or array of byte strings');
}

/**
 * Verify that a DSC (Document Signer Certificate) chains to a trusted IACA root.
 *
 * ISO 18013-5 chain structure: IACA Root → DSC → MSO
 * The COSE_Sign1 x5chain contains the DSC. The DSC is signed by the IACA root.
 *
 * Verification strategy:
 * 1. Fast path: byte equality (backward compat with self-signed test certs)
 * 2. Real path: verify DSC's ECDSA signature using the IACA root's public key
 *
 * ISO 18013-5 §9.3.2 specifies a flat chain (no intermediates): root signs DSC directly.
 */
async function verifyDscAgainstRoot(
	dscDER: Uint8Array,
	trustedRoots: IACACertificate[]
): Promise<boolean> {
	for (const root of trustedRoots) {
		const rootDER = root.derBytes ?? base64ToUint8Array(root.certificateB64);

		// Fast path: DSC IS the root (self-signed test certs)
		if (uint8ArrayEqual(dscDER, rootDER)) {
			return true;
		}

		// Real path: verify DSC was signed by this IACA root
		try {
			const rootKeyInfo = extractEcPublicKeyFromDER(rootDER);
			const rootCurveParams = CURVE_PARAMS[rootKeyInfo.curve];
			const rootPublicKey = await crypto.subtle.importKey(
				'raw',
				toBufferSource(rootKeyInfo.keyBytes),
				{ name: 'ECDSA', namedCurve: rootKeyInfo.curve },
				false,
				['verify']
			);

			const { tbsBytes, signatureDER } = extractTBSAndSignature(dscDER);
			const signatureRaw = derEcdsaSigToRaw(signatureDER, rootCurveParams.componentSize);

			const valid = await crypto.subtle.verify(
				{ name: 'ECDSA', hash: rootCurveParams.hash },
				rootPublicKey,
				toBufferSource(signatureRaw),
				toBufferSource(tbsBytes)
			);

			if (valid) {
				return true;
			}
		} catch {
			// Parsing or crypto failure for this root — try next
			continue;
		}
	}

	return false;
}

/**
 * Verify that an issuer/DSC certificate chains to a trusted IACA root and is currently valid.
 *
 * This is shared by the raw mdoc COSE path and OpenID4VP JWT x5c path so both
 * lanes use the same issuer trust anchor.
 */
export async function verifyCertificateAgainstIacaRoots(
	certDER: Uint8Array,
	trustedRoots: IACACertificate[]
): Promise<CertificateTrustResult> {
	const trusted = await verifyDscAgainstRoot(certDER, trustedRoots);
	if (!trusted) {
		return { trusted: false, reason: 'Issuer certificate not found in IACA trust store' };
	}

	try {
		const { notBefore, notAfter } = extractValidityPeriod(certDER);
		const now = new Date();
		if (now < notBefore) {
			return {
				trusted: false,
				reason: `DSC not yet valid (notBefore: ${notBefore.toISOString()})`
			};
		}
		if (now > notAfter) {
			return {
				trusted: false,
				reason: `DSC expired (notAfter: ${notAfter.toISOString()})`
			};
		}
	} catch (err) {
		return {
			trusted: false,
			reason: `DSC validity period could not be parsed (${err instanceof Error ? err.message : 'unknown'})`
		};
	}

	return { trusted: true };
}

/**
 * Minimal ASN.1/DER parser to extract an EC public key from an X.509 certificate.
 *
 * Searches for the SubjectPublicKeyInfo structure containing:
 *   - OID 1.2.840.10045.2.1 (id-ecPublicKey)
 *   - OID 1.2.840.10045.3.1.7 (prime256v1 / P-256) OR
 *   - OID 1.3.132.0.34 (secp384r1 / P-384)
 *
 * Then extracts the uncompressed point (04 || x || y) from the BIT STRING.
 * P-256: 65 bytes (04 + 32x + 32y), P-384: 97 bytes (04 + 48x + 48y)
 */
export function extractEcPublicKeyFromDER(certDER: Uint8Array): EcPublicKeyInfo {
	// Find the EC public key OID
	const ecOidIndex = findBytes(certDER, EC_PUBLIC_KEY_OID);
	if (ecOidIndex === -1) {
		throw new Error('EC public key OID not found in certificate');
	}

	// Detect curve: try P-256, then P-384
	let curve: EcCurve;
	let curveOidEnd: number;

	const p256Index = findBytes(certDER, P256_CURVE_OID, ecOidIndex);
	const p384Index = findBytes(certDER, P384_CURVE_OID, ecOidIndex);

	if (p256Index !== -1 && (p384Index === -1 || p256Index < p384Index)) {
		curve = 'P-256';
		curveOidEnd = p256Index + P256_CURVE_OID.length;
	} else if (p384Index !== -1) {
		curve = 'P-384';
		curveOidEnd = p384Index + P384_CURVE_OID.length;
	} else {
		throw new Error('Supported curve OID not found in certificate (need P-256 or P-384)');
	}

	const params = CURVE_PARAMS[curve];
	// Uncompressed point: 04 + x + y
	const keySize = 1 + 2 * params.componentSize; // 65 for P-256, 97 for P-384
	const bitStringContentLen = keySize + 1; // +1 for 0x00 unused bits byte

	// After the curve OID, find the BIT STRING containing the public key.
	for (let i = curveOidEnd; i < certDER.length - keySize; i++) {
		if (certDER[i] === 0x03) {
			// BIT STRING tag
			const len = parseDERLength(certDER, i + 1);
			if (!len) continue;

			const contentStart = len.offset;
			const contentLen = len.length;

			// BIT STRING for EC key: first byte is 0x00 (unused bits),
			// then 0x04 (uncompressed point), then coordinate bytes
			if (
				contentLen === bitStringContentLen &&
				certDER[contentStart] === 0x00 &&
				certDER[contentStart + 1] === 0x04
			) {
				return {
					keyBytes: certDER.slice(contentStart + 1, contentStart + 1 + keySize),
					curve
				};
			}
		}
	}

	throw new Error(`Could not find uncompressed EC ${curve} public key in certificate`);
}

/**
 * Extract TBSCertificate raw bytes and DER-encoded signature from an X.509 certificate.
 *
 * X.509 DER structure:
 *   SEQUENCE (Certificate) {
 *     SEQUENCE (TBSCertificate)        ← raw bytes including tag+length
 *     SEQUENCE (signatureAlgorithm)
 *     BIT STRING (signatureValue)      ← DER-encoded ECDSA signature
 *   }
 */
export function extractTBSAndSignature(certDER: Uint8Array): {
	tbsBytes: Uint8Array;
	signatureDER: Uint8Array;
} {
	if (certDER[0] !== 0x30) {
		throw new Error('Certificate does not start with SEQUENCE tag');
	}
	const outerLen = parseDERLength(certDER, 1);
	if (!outerLen) throw new Error('Invalid outer SEQUENCE length');

	// TBSCertificate SEQUENCE
	const tbsTagPos = outerLen.offset;
	if (certDER[tbsTagPos] !== 0x30) {
		throw new Error('TBSCertificate does not start with SEQUENCE tag');
	}
	const tbsLen = parseDERLength(certDER, tbsTagPos + 1);
	if (!tbsLen) throw new Error('Invalid TBSCertificate length');
	const tbsEnd = tbsLen.offset + tbsLen.length;
	const tbsBytes = certDER.slice(tbsTagPos, tbsEnd);

	// signatureAlgorithm SEQUENCE (skip it)
	let pos = tbsEnd;
	if (certDER[pos] !== 0x30) {
		throw new Error('signatureAlgorithm does not start with SEQUENCE tag');
	}
	const sigAlgLen = parseDERLength(certDER, pos + 1);
	if (!sigAlgLen) throw new Error('Invalid signatureAlgorithm length');
	pos = sigAlgLen.offset + sigAlgLen.length;

	// Signature BIT STRING
	if (certDER[pos] !== 0x03) {
		throw new Error('Signature is not a BIT STRING');
	}
	const sigBsLen = parseDERLength(certDER, pos + 1);
	if (!sigBsLen) throw new Error('Invalid signature BIT STRING length');

	// First byte of BIT STRING content = unused bits count (must be 0)
	if (certDER[sigBsLen.offset] !== 0x00) {
		throw new Error(`Unexpected unused bits in signature: ${certDER[sigBsLen.offset]}`);
	}
	const signatureDER = certDER.slice(sigBsLen.offset + 1, sigBsLen.offset + sigBsLen.length);

	return { tbsBytes, signatureDER };
}

/**
 * Convert a DER-encoded ECDSA signature to raw format (r || s).
 *
 * DER: SEQUENCE { INTEGER r, INTEGER s }
 * Raw: r (componentSize bytes, zero-padded) || s (componentSize bytes, zero-padded)
 *
 * @param componentSize  Byte length of each component (32 for P-256, 48 for P-384). Default: 32.
 *
 * Handles:
 * - Leading 0x00 padding on positive integers with high bit set (strip it)
 * - Short integers < componentSize bytes (left-zero-pad)
 */
export function derEcdsaSigToRaw(derSig: Uint8Array, componentSize = 32): Uint8Array {
	if (derSig[0] !== 0x30) {
		throw new Error('DER signature does not start with SEQUENCE tag');
	}
	const seqLen = parseDERLength(derSig, 1);
	if (!seqLen) throw new Error('Invalid DER signature SEQUENCE length');

	let pos = seqLen.offset;

	// Parse r INTEGER
	if (derSig[pos] !== 0x02) {
		throw new Error('Expected INTEGER tag for r');
	}
	const rLen = parseDERLength(derSig, pos + 1);
	if (!rLen) throw new Error('Invalid r INTEGER length');
	let rBytes = derSig.slice(rLen.offset, rLen.offset + rLen.length);
	pos = rLen.offset + rLen.length;

	// Parse s INTEGER
	if (derSig[pos] !== 0x02) {
		throw new Error('Expected INTEGER tag for s');
	}
	const sLen = parseDERLength(derSig, pos + 1);
	if (!sLen) throw new Error('Invalid s INTEGER length');
	let sBytes = derSig.slice(sLen.offset, sLen.offset + sLen.length);

	// Strip leading 0x00 padding (DER uses it when high bit is set)
	if (rBytes.length > componentSize && rBytes[0] === 0x00) {
		rBytes = rBytes.slice(rBytes.length - componentSize);
	}
	if (sBytes.length > componentSize && sBytes[0] === 0x00) {
		sBytes = sBytes.slice(sBytes.length - componentSize);
	}

	// Left-pad to componentSize bytes if shorter
	const r = new Uint8Array(componentSize);
	const s = new Uint8Array(componentSize);
	r.set(rBytes, componentSize - rBytes.length);
	s.set(sBytes, componentSize - sBytes.length);

	const raw = new Uint8Array(componentSize * 2);
	raw.set(r, 0);
	raw.set(s, componentSize);
	return raw;
}

/**
 * Extract the validity period (notBefore, notAfter) from an X.509 DER certificate.
 *
 * Walks the TBSCertificate structure:
 *   version [0] → serialNumber → signatureAlgorithm → issuer → validity { notBefore, notAfter }
 */
export function extractValidityPeriod(certDER: Uint8Array): {
	notBefore: Date;
	notAfter: Date;
} {
	if (certDER[0] !== 0x30) throw new Error('Not a certificate SEQUENCE');
	const outerLen = parseDERLength(certDER, 1);
	if (!outerLen) throw new Error('Invalid certificate length');

	// Enter TBSCertificate SEQUENCE
	let pos = outerLen.offset;
	if (certDER[pos] !== 0x30) throw new Error('Invalid TBSCertificate');
	const tbsLen = parseDERLength(certDER, pos + 1);
	if (!tbsLen) throw new Error('Invalid TBS length');

	pos = tbsLen.offset; // start of TBS content

	// Skip version [0] EXPLICIT (context tag 0xa0, present in v3 certs)
	if (certDER[pos] === 0xa0) {
		const vLen = parseDERLength(certDER, pos + 1);
		if (!vLen) throw new Error('Invalid version');
		pos = vLen.offset + vLen.length;
	}

	// Skip serialNumber (INTEGER 0x02)
	if (certDER[pos] !== 0x02) throw new Error('Expected serial INTEGER');
	const serialLen = parseDERLength(certDER, pos + 1);
	if (!serialLen) throw new Error('Invalid serial');
	pos = serialLen.offset + serialLen.length;

	// Skip signatureAlgorithm (SEQUENCE 0x30)
	if (certDER[pos] !== 0x30) throw new Error('Expected sigAlg SEQUENCE');
	const sigAlgLen = parseDERLength(certDER, pos + 1);
	if (!sigAlgLen) throw new Error('Invalid sigAlg');
	pos = sigAlgLen.offset + sigAlgLen.length;

	// Skip issuer (SEQUENCE 0x30)
	if (certDER[pos] !== 0x30) throw new Error('Expected issuer SEQUENCE');
	const issuerLen = parseDERLength(certDER, pos + 1);
	if (!issuerLen) throw new Error('Invalid issuer');
	pos = issuerLen.offset + issuerLen.length;

	// Validity SEQUENCE
	if (certDER[pos] !== 0x30) throw new Error('Expected validity SEQUENCE');
	const validityLen = parseDERLength(certDER, pos + 1);
	if (!validityLen) throw new Error('Invalid validity');

	// Parse notBefore and notAfter inside the validity SEQUENCE
	let vPos = validityLen.offset;
	const nb = parseDERTime(certDER, vPos);
	vPos = nb.nextOffset;
	const na = parseDERTime(certDER, vPos);

	return { notBefore: nb.date, notAfter: na.date };
}

/**
 * Parse a DER-encoded time value (UTCTime or GeneralizedTime).
 *
 * UTCTime (0x17):        YYMMDDHHMMSSZ  — year < 50 → 20xx, else 19xx
 * GeneralizedTime (0x18): YYYYMMDDHHMMSSZ
 */
function parseDERTime(data: Uint8Array, offset: number): { date: Date; nextOffset: number } {
	const tag = data[offset];
	if (tag !== 0x17 && tag !== 0x18) {
		throw new Error(`Expected time tag (0x17 or 0x18), got 0x${tag.toString(16)}`);
	}

	const len = parseDERLength(data, offset + 1);
	if (!len) throw new Error('Invalid time length');

	const timeStr = new TextDecoder().decode(data.slice(len.offset, len.offset + len.length));

	let date: Date;
	if (tag === 0x17) {
		// UTCTime: YYMMDDHHMMSSZ
		const yy = parseInt(timeStr.slice(0, 2), 10);
		const year = yy < 50 ? 2000 + yy : 1900 + yy;
		date = new Date(
			`${year}-${timeStr.slice(2, 4)}-${timeStr.slice(4, 6)}T` +
				`${timeStr.slice(6, 8)}:${timeStr.slice(8, 10)}:${timeStr.slice(10, 12)}Z`
		);
	} else {
		// GeneralizedTime: YYYYMMDDHHMMSSZ
		date = new Date(
			`${timeStr.slice(0, 4)}-${timeStr.slice(4, 6)}-${timeStr.slice(6, 8)}T` +
				`${timeStr.slice(8, 10)}:${timeStr.slice(10, 12)}:${timeStr.slice(12, 14)}Z`
		);
	}

	return { date, nextOffset: len.offset + len.length };
}

/**
 * Parse the MSO (MobileSecurityObject) from CBOR payload bytes.
 *
 * The payload may be wrapped in CBOR tag 24 (encoded CBOR data item).
 */
function parseMobileSecurityObject(
	payloadCBOR: Uint8Array,
	issuerCertDER: Uint8Array,
	decode: (data: Uint8Array) => unknown
): MobileSecurityObject {
	let msoData = decode(payloadCBOR) as unknown;

	// Unwrap tag 24 if present (CBOR bstr-wrapped data)
	if (msoData && typeof msoData === 'object' && 'tag' in (msoData as Record<string, unknown>)) {
		const tagged = msoData as { tag: number; value: unknown };
		if (tagged.tag === 24) {
			if (tagged.value instanceof Uint8Array) {
				msoData = decode(tagged.value);
			} else {
				msoData = tagged.value;
			}
		}
	}

	const mso = msoData as Record<string, unknown>;

	// Extract version
	const version = String(mso.version ?? '1.0');

	// Extract digest algorithm
	const digestAlgorithm = String(mso.digestAlgorithm ?? 'SHA-256');

	// Extract valueDigests: Map<string, Map<number, Uint8Array>>
	const valueDigests = new Map<string, Map<number, Uint8Array>>();
	const rawDigests = mso.valueDigests;

	if (rawDigests instanceof Map) {
		Array.from(rawDigests.entries()).forEach(([ns, digests]) => {
			const nsMap = new Map<number, Uint8Array>();
			if (digests instanceof Map) {
				Array.from((digests as Map<unknown, unknown>).entries()).forEach(([id, digest]) => {
					if (digest instanceof Uint8Array) {
						nsMap.set(Number(id), digest);
					}
				});
			}
			valueDigests.set(String(ns), nsMap);
		});
	} else if (typeof rawDigests === 'object' && rawDigests !== null) {
		for (const [ns, digests] of Object.entries(rawDigests as Record<string, unknown>)) {
			const nsMap = new Map<number, Uint8Array>();
			if (digests instanceof Map) {
				Array.from((digests as Map<unknown, unknown>).entries()).forEach(([id, digest]) => {
					if (digest instanceof Uint8Array) {
						nsMap.set(Number(id), digest);
					}
				});
			} else if (typeof digests === 'object' && digests !== null) {
				for (const [id, digest] of Object.entries(digests as Record<string, unknown>)) {
					if (digest instanceof Uint8Array) {
						nsMap.set(Number(id), digest);
					}
				}
			}
			valueDigests.set(ns, nsMap);
		}
	}

	// Extract validityInfo
	const rawValidity = mso.validityInfo as Record<string, unknown> | undefined;
	const validityInfo = {
		signed: parseDate(rawValidity?.signed),
		validFrom: parseDate(rawValidity?.validFrom),
		validUntil: parseDate(rawValidity?.validUntil)
	};

	return {
		version,
		digestAlgorithm,
		valueDigests,
		validityInfo,
		issuerCertificate: issuerCertDER
	};
}

// ---------------------------------------------------------------------------
// Byte-level helpers
// ---------------------------------------------------------------------------

/**
 * Find a byte sequence within a larger array, starting from an offset.
 */
function findBytes(haystack: Uint8Array, needle: Uint8Array, fromIndex = 0): number {
	const limit = haystack.length - needle.length;
	outer: for (let i = fromIndex; i <= limit; i++) {
		for (let j = 0; j < needle.length; j++) {
			if (haystack[i + j] !== needle[j]) {
				continue outer;
			}
		}
		return i;
	}
	return -1;
}

/**
 * Parse a DER length field starting at the given offset.
 * Returns the decoded length and the offset where content begins.
 */
function parseDERLength(
	data: Uint8Array,
	offset: number
): { length: number; offset: number } | null {
	if (offset >= data.length) return null;

	const first = data[offset];
	if (first < 0x80) {
		// Short form
		return { length: first, offset: offset + 1 };
	}

	const numBytes = first & 0x7f;
	if (numBytes === 0 || numBytes > 4) return null;
	if (offset + 1 + numBytes > data.length) return null;

	let length = 0;
	for (let i = 0; i < numBytes; i++) {
		length = (length << 8) | data[offset + 1 + i];
	}

	return { length, offset: offset + 1 + numBytes };
}

/** Parse a date from various CBOR representations */
function parseDate(value: unknown): Date {
	if (value instanceof Date) return value;
	if (typeof value === 'string') return new Date(value);
	if (typeof value === 'number') return new Date(value * 1000);
	// CBOR tagged date-time (tag 0 = text, tag 1 = epoch)
	if (value && typeof value === 'object' && 'value' in (value as Record<string, unknown>)) {
		return parseDate((value as { value: unknown }).value);
	}
	return new Date(0);
}

/** Compare two Uint8Arrays for equality */
function uint8ArrayEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		if (a[i] !== b[i]) return false;
	}
	return true;
}

/** Decode base64 string to Uint8Array (Workers-compatible, no Buffer) */
function base64ToUint8Array(base64: string): Uint8Array {
	const binaryString = atob(base64);
	const bytes = new Uint8Array(binaryString.length);
	for (let i = 0; i < binaryString.length; i++) {
		bytes[i] = binaryString.charCodeAt(i);
	}
	return bytes;
}
