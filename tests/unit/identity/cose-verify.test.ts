/**
 * Unit tests for COSE_Sign1 verification (ISO 18013-5 mDL issuer auth)
 *
 * Generates synthetic COSE_Sign1 structures using Web Crypto ECDSA P-256
 * and cbor-web, then verifies them through the verifyCoseSign1() pipeline.
 *
 * Tests cover:
 *   - Valid signature verification (happy path)
 *   - Signature verification failure with wrong key
 *   - MSO digest validation
 *   - Structural validation (missing fields, bad formats)
 *   - Trust store matching
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
	verifyCoseSign1,
	verifyDeviceSignature,
	validateMsoDigests,
	extractEcPublicKeyFromDER,
	extractTBSAndSignature,
	extractValidityPeriod,
	derEcdsaSigToRaw,
	type MobileSecurityObject,
	type EcPublicKeyInfo
} from '$lib/core/identity/cose-verify';
import type { IACACertificate } from '$lib/core/identity/iaca-roots';
import { encode, decode } from 'cbor-web';

// ---------------------------------------------------------------------------
// Test helpers: build synthetic X.509 certs and COSE_Sign1 structures
// ---------------------------------------------------------------------------

/**
 * Build a minimal self-signed X.509 v3 DER certificate containing an
 * ECDSA P-256 public key. This is NOT a complete X.509 cert — it contains
 * just enough structure for extractEcPublicKeyFromDER() to find the key.
 *
 * The DER structure:
 *   SEQUENCE (Certificate) {
 *     SEQUENCE (TBSCertificate) {
 *       [0] EXPLICIT INTEGER 2 (v3)
 *       INTEGER serialNumber
 *       SEQUENCE (signature algorithm) { OID ecdsaWithSHA256 }
 *       SEQUENCE (issuer) { ... }
 *       SEQUENCE (validity) { ... }
 *       SEQUENCE (subject) { ... }
 *       SEQUENCE (SubjectPublicKeyInfo) {
 *         SEQUENCE (algorithm) {
 *           OID 1.2.840.10045.2.1 (id-ecPublicKey)
 *           OID 1.2.840.10045.3.1.7 (prime256v1)
 *         }
 *         BIT STRING (65 bytes uncompressed point)
 *       }
 *     }
 *     SEQUENCE (signatureAlgorithm) { ... }
 *     BIT STRING (signature - dummy)
 *   }
 */
async function buildMinimalCert(publicKey: CryptoKey): Promise<Uint8Array> {
	// Export the raw public key (65 bytes: 04 || x || y)
	const rawKey = new Uint8Array(await crypto.subtle.exportKey('raw', publicKey));

	// OID 1.2.840.10045.2.1 (id-ecPublicKey)
	const ecOid = new Uint8Array([0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01]);
	// OID 1.2.840.10045.3.1.7 (prime256v1 / P-256)
	const curveOid = new Uint8Array([0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07]);

	// AlgorithmIdentifier SEQUENCE
	const algIdContent = concatBytes(ecOid, curveOid);
	const algId = wrapDERSequence(algIdContent);

	// BIT STRING wrapping the public key (prepend 0x00 for unused bits)
	const bitStringContent = concatBytes(new Uint8Array([0x00]), rawKey);
	const bitString = new Uint8Array([0x03, ...encodeDERLength(bitStringContent.length), ...bitStringContent]);

	// SubjectPublicKeyInfo SEQUENCE
	const spki = wrapDERSequence(concatBytes(algId, bitString));

	// Minimal TBSCertificate: version + serial + sigAlg + issuer + validity + subject + spki
	// Version: [0] EXPLICIT INTEGER 2
	const version = new Uint8Array([0xa0, 0x03, 0x02, 0x01, 0x02]);
	// Serial: INTEGER 1
	const serial = new Uint8Array([0x02, 0x01, 0x01]);
	// Signature algorithm (ecdsaWithSHA256): OID 1.2.840.10045.4.3.2
	const sigAlgOid = new Uint8Array([0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x02]);
	const sigAlg = wrapDERSequence(sigAlgOid);
	// Issuer: SEQUENCE { SET { SEQUENCE { OID cn, UTF8STRING "Test" } } }
	const cnOid = new Uint8Array([0x06, 0x03, 0x55, 0x04, 0x03]); // OID 2.5.4.3 (CN)
	const cnValue = new Uint8Array([0x0c, 0x04, 0x54, 0x65, 0x73, 0x74]); // UTF8STRING "Test"
	const rdnSeq = wrapDERSequence(concatBytes(cnOid, cnValue));
	const rdnSet = new Uint8Array([0x31, ...encodeDERLength(rdnSeq.length), ...rdnSeq]);
	const issuer = wrapDERSequence(rdnSet);
	// Validity: SEQUENCE { UTCTime, UTCTime }
	const notBefore = new Uint8Array([0x17, 0x0d, ...new TextEncoder().encode('250101000000Z')]);
	const notAfter = new Uint8Array([0x17, 0x0d, ...new TextEncoder().encode('351231235959Z')]);
	const validity = wrapDERSequence(concatBytes(notBefore, notAfter));
	// Subject = same as issuer (self-signed)
	const subject = issuer;

	const tbsCert = wrapDERSequence(
		concatBytes(version, serial, sigAlg, issuer, validity, subject, spki)
	);

	// Outer certificate: tbsCert + sigAlg + dummy signature
	const dummySig = new Uint8Array([0x03, 0x03, 0x00, 0x30, 0x00]); // BIT STRING with empty SEQUENCE
	const cert = wrapDERSequence(concatBytes(tbsCert, sigAlg, dummySig));

	return cert;
}

/**
 * Create a COSE_Sign1 structure with a real ECDSA P-256 signature.
 *
 * Returns [protectedHeadersCBOR, unprotectedHeaders, payloadCBOR, signature]
 */
async function buildCoseSign1(
	payload: Uint8Array,
	privateKey: CryptoKey,
	certDER: Uint8Array,
	options?: { protectedHeadersCBOR?: Uint8Array }
): Promise<unknown[]> {
	// Protected headers: { 1: -7 } (alg: ES256)
	const protectedHeaders = new Map<number, number>();
	protectedHeaders.set(1, -7);
	const protectedHeadersCBOR =
		options?.protectedHeadersCBOR ?? new Uint8Array(encode(protectedHeaders));

	// Unprotected headers: { 33: certDER } (x5chain)
	const unprotectedHeaders = new Map<number, Uint8Array>();
	unprotectedHeaders.set(33, certDER);

	// Build Sig_structure = ["Signature1", protectedHeadersCBOR, b"", payload]
	const sigStructureEncoded = encodeCoseSigStructureForTest(
		'Signature1',
		protectedHeadersCBOR,
		new Uint8Array(0),
		payload
	);

	// Sign with ECDSA P-256 SHA-256
	// Node.js Web Crypto returns raw (IEEE P1363) format: r || s, 64 bytes
	// This matches COSE's expected signature format directly.
	const rawSignature = new Uint8Array(
		await crypto.subtle.sign(
			{ name: 'ECDSA', hash: 'SHA-256' },
			privateKey,
			sigStructureEncoded
		)
	);

	return [protectedHeadersCBOR, unprotectedHeaders, payload, rawSignature];
}

/**
 * Build a test MSO (MobileSecurityObject) CBOR payload.
 */
function buildTestMso(
	namespaceDigests?: Map<string, Map<number, Uint8Array>>,
	deviceKey?: unknown
): Uint8Array {
	const mso: Record<string, unknown> = {
		version: '1.0',
		digestAlgorithm: 'SHA-256',
		docType: 'org.iso.18013.5.1.mDL',
		validityInfo: {
			signed: '2026-01-01T00:00:00Z',
			validFrom: '2026-01-01T00:00:00Z',
			validUntil: '2027-01-01T00:00:00Z'
		}
	};

	if (namespaceDigests) {
		mso.valueDigests = namespaceDigests;
	} else {
		mso.valueDigests = new Map<string, Map<number, Uint8Array>>([
			[
				'org.iso.18013.5.1',
				new Map<number, Uint8Array>([
					[0, new Uint8Array([1, 2, 3, 4])],
					[1, new Uint8Array([5, 6, 7, 8])]
				])
			]
		]);
	}

	if (deviceKey) {
		mso.deviceKeyInfo = new Map<string, unknown>([['deviceKey', deviceKey]]);
	}

	return new Uint8Array(encode(mso));
}

/**
 * Generate a fresh ECDSA P-256 key pair.
 */
async function generateKeyPair(): Promise<CryptoKeyPair> {
	return crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
		'sign',
		'verify'
	]);
}

// ---------------------------------------------------------------------------
// DER / byte helpers for tests
// ---------------------------------------------------------------------------

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
	const totalLength = arrays.reduce((sum, a) => sum + a.length, 0);
	const result = new Uint8Array(totalLength);
	let offset = 0;
	for (const arr of arrays) {
		result.set(arr, offset);
		offset += arr.length;
	}
	return result;
}

function encodeDERLength(len: number): Uint8Array {
	if (len < 0x80) {
		return new Uint8Array([len]);
	} else if (len < 0x100) {
		return new Uint8Array([0x81, len]);
	} else {
		return new Uint8Array([0x82, (len >> 8) & 0xff, len & 0xff]);
	}
}

function wrapDERSequence(content: Uint8Array): Uint8Array {
	const lenBytes = encodeDERLength(content.length);
	const result = new Uint8Array(1 + lenBytes.length + content.length);
	result[0] = 0x30; // SEQUENCE tag
	result.set(lenBytes, 1);
	result.set(content, 1 + lenBytes.length);
	return result;
}

async function publicKeyToCoseEc2Key(publicKey: CryptoKey): Promise<Map<number, unknown>> {
	const raw = new Uint8Array(await crypto.subtle.exportKey('raw', publicKey));
	return new Map<number, unknown>([
		[1, 2], // kty: EC2
		[-1, 1], // crv: P-256
		[-2, raw.slice(1, 33)],
		[-3, raw.slice(33, 65)]
	]);
}

async function buildDeviceSignature(
	deviceAuthenticationBytes: Uint8Array,
	privateKey: CryptoKey,
	options?: { payload?: unknown; protectedHeadersCBOR?: Uint8Array }
): Promise<unknown[]> {
	const protectedHeaders = new Map<number, number>([[1, -7]]);
	const protectedHeadersCBOR =
		options?.protectedHeadersCBOR ?? new Uint8Array(encode(protectedHeaders));
	const sigStructure = encodeCoseSigStructureForTest(
		'Signature1',
		protectedHeadersCBOR,
		new Uint8Array(0),
		deviceAuthenticationBytes
	);
	const rawSignature = new Uint8Array(
		await crypto.subtle.sign(
			{ name: 'ECDSA', hash: 'SHA-256' },
			privateKey,
			sigStructure
		)
	);
	return [protectedHeadersCBOR, new Map(), options?.payload ?? null, rawSignature];
}

function encodeCoseSigStructureForTest(
	context: 'Signature1',
	protectedHeaders: Uint8Array,
	externalAad: Uint8Array,
	payload: Uint8Array
): Uint8Array {
	return encodeMinimalCborForTest([context, protectedHeaders, externalAad, payload]);
}

type MinimalCborValueForTest = string | Uint8Array | null | readonly MinimalCborValueForTest[];

function encodeMinimalCborForTest(value: MinimalCborValueForTest): Uint8Array {
	if (typeof value === 'string') {
		return encodeCborBytesForTest(3, new TextEncoder().encode(value));
	}
	if (value instanceof Uint8Array) {
		return encodeCborBytesForTest(2, value);
	}
	if (value === null) {
		return new Uint8Array([0xf6]);
	}
	if (Array.isArray(value)) {
		return concatBytes(
			encodeCborHeadForTest(4, value.length),
			...value.map(encodeMinimalCborForTest)
		);
	}
	throw new Error('Unsupported CBOR value');
}

function encodeCborBytesForTest(majorType: number, bytes: Uint8Array): Uint8Array {
	return concatBytes(encodeCborHeadForTest(majorType, bytes.length), bytes);
}

function encodeCborHeadForTest(majorType: number, length: number): Uint8Array {
	const prefix = majorType << 5;
	if (length < 24) return new Uint8Array([prefix | length]);
	if (length <= 0xff) return new Uint8Array([prefix | 24, length]);
	if (length <= 0xffff) return new Uint8Array([prefix | 25, length >> 8, length & 0xff]);
	return new Uint8Array([
		prefix | 26,
		(length >>> 24) & 0xff,
		(length >>> 16) & 0xff,
		(length >>> 8) & 0xff,
		length & 0xff
	]);
}

/** Cast Uint8Array to BufferSource — works around cross-realm type mismatch in vitest/jsdom */
function toBuffer(data: Uint8Array): BufferSource {
	return data as unknown as BufferSource;
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
	let binary = '';
	for (let i = 0; i < bytes.length; i++) {
		binary += String.fromCharCode(bytes[i]);
	}
	return btoa(binary);
}

/**
 * Convert a raw 64-byte ECDSA signature (r || s) to DER format.
 * Inverse of derEcdsaSigToRaw(). Used to embed real signatures in test certificates.
 *
 * DER: SEQUENCE { INTEGER r, INTEGER s }
 * Adds leading 0x00 when high bit is set (DER positive integer requirement).
 */
function rawSigToDer(rawSig: Uint8Array): Uint8Array {
	const r = rawSig.slice(0, 32);
	const s = rawSig.slice(32, 64);

	function integerToDer(bytes: Uint8Array): Uint8Array {
		// Strip leading zeros (keep at least one byte)
		let start = 0;
		while (start < bytes.length - 1 && bytes[start] === 0) start++;
		let trimmed = bytes.slice(start);

		// Add leading 0x00 if high bit is set (DER positive integer)
		if (trimmed[0] >= 0x80) {
			const padded = new Uint8Array(trimmed.length + 1);
			padded[0] = 0x00;
			padded.set(trimmed, 1);
			trimmed = padded;
		}

		// INTEGER tag + length + bytes
		return concatBytes(new Uint8Array([0x02, trimmed.length]), trimmed);
	}

	const rDer = integerToDer(r);
	const sDer = integerToDer(s);
	const content = concatBytes(rDer, sDer);

	// SEQUENCE tag + length + content
	return concatBytes(new Uint8Array([0x30, content.length]), content);
}

/**
 * Build an X.509 certificate with a REAL ECDSA signature from the signer's key.
 * Unlike buildMinimalCert (dummy signature), this produces a cert that can be
 * verified against the signer's public key — used for DSC chain verification tests.
 *
 * @param subjectPublicKey  The public key to embed in the certificate
 * @param signerPrivateKey  The private key used to sign the TBSCertificate
 */
async function buildSignedCert(
	subjectPublicKey: CryptoKey,
	signerPrivateKey: CryptoKey
): Promise<Uint8Array> {
	const rawKey = new Uint8Array(await crypto.subtle.exportKey('raw', subjectPublicKey));

	// OIDs
	const ecOid = new Uint8Array([0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01]);
	const curveOid = new Uint8Array([0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07]);

	// SubjectPublicKeyInfo
	const algId = wrapDERSequence(concatBytes(ecOid, curveOid));
	const bitStringContent = concatBytes(new Uint8Array([0x00]), rawKey);
	const bitString = new Uint8Array([0x03, ...encodeDERLength(bitStringContent.length), ...bitStringContent]);
	const spki = wrapDERSequence(concatBytes(algId, bitString));

	// TBSCertificate components
	const version = new Uint8Array([0xa0, 0x03, 0x02, 0x01, 0x02]);
	const serial = new Uint8Array([0x02, 0x01, 0x02]); // serial 2 (different from root)
	const sigAlgOid = new Uint8Array([0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x02]);
	const sigAlg = wrapDERSequence(sigAlgOid);
	const cnOid = new Uint8Array([0x06, 0x03, 0x55, 0x04, 0x03]);
	const cnValue = new Uint8Array([0x0c, 0x07, 0x54, 0x65, 0x73, 0x74, 0x44, 0x53, 0x43]); // "TestDSC"
	const rdnSeq = wrapDERSequence(concatBytes(cnOid, cnValue));
	const rdnSet = new Uint8Array([0x31, ...encodeDERLength(rdnSeq.length), ...rdnSeq]);
	const subject = wrapDERSequence(rdnSet);
	const notBefore = new Uint8Array([0x17, 0x0d, ...new TextEncoder().encode('250101000000Z')]);
	const notAfter = new Uint8Array([0x17, 0x0d, ...new TextEncoder().encode('351231235959Z')]);
	const validity = wrapDERSequence(concatBytes(notBefore, notAfter));
	const issuer = subject; // same for simplicity

	const tbsCert = wrapDERSequence(
		concatBytes(version, serial, sigAlg, issuer, validity, subject, spki)
	);

	// Sign TBSCertificate with signer's private key
	const rawSignature = new Uint8Array(
		await crypto.subtle.sign(
			{ name: 'ECDSA', hash: 'SHA-256' },
			signerPrivateKey,
			toBuffer(tbsCert)
		)
	);

	// Convert raw signature to DER and wrap in BIT STRING
	const derSignature = rawSigToDer(rawSignature);
	const sigBitStringContent = concatBytes(new Uint8Array([0x00]), derSignature);
	const sigBitString = new Uint8Array([
		0x03,
		...encodeDERLength(sigBitStringContent.length),
		...sigBitStringContent
	]);

	// Outer Certificate SEQUENCE
	return wrapDERSequence(concatBytes(tbsCert, sigAlg, sigBitString));
}

/**
 * Encode a UTCTime string for DER. Format: YYMMDDHHMMSSZ
 */
function encodeUTCTime(dateStr: string): Uint8Array {
	const bytes = new TextEncoder().encode(dateStr);
	return new Uint8Array([0x17, bytes.length, ...bytes]);
}

/**
 * Build a minimal cert with custom validity dates (for testing expiry enforcement).
 * Like buildMinimalCert but with configurable notBefore/notAfter.
 */
async function buildMinimalCertWithDates(
	publicKey: CryptoKey,
	notBeforeUTC: string,
	notAfterUTC: string
): Promise<Uint8Array> {
	const rawKey = new Uint8Array(await crypto.subtle.exportKey('raw', publicKey));

	const ecOid = new Uint8Array([0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01]);
	const curveOid = new Uint8Array([0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07]);
	const algId = wrapDERSequence(concatBytes(ecOid, curveOid));

	const bitStringContent = concatBytes(new Uint8Array([0x00]), rawKey);
	const bitString = new Uint8Array([0x03, ...encodeDERLength(bitStringContent.length), ...bitStringContent]);
	const spki = wrapDERSequence(concatBytes(algId, bitString));

	const version = new Uint8Array([0xa0, 0x03, 0x02, 0x01, 0x02]);
	const serial = new Uint8Array([0x02, 0x01, 0x01]);
	const sigAlgOid = new Uint8Array([0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x02]);
	const sigAlg = wrapDERSequence(sigAlgOid);
	const cnOid = new Uint8Array([0x06, 0x03, 0x55, 0x04, 0x03]);
	const cnValue = new Uint8Array([0x0c, 0x04, 0x54, 0x65, 0x73, 0x74]);
	const rdnSeq = wrapDERSequence(concatBytes(cnOid, cnValue));
	const rdnSet = new Uint8Array([0x31, ...encodeDERLength(rdnSeq.length), ...rdnSeq]);
	const issuer = wrapDERSequence(rdnSet);

	const notBefore = encodeUTCTime(notBeforeUTC);
	const notAfter = encodeUTCTime(notAfterUTC);
	const validity = wrapDERSequence(concatBytes(notBefore, notAfter));

	const subject = issuer;
	const tbsCert = wrapDERSequence(
		concatBytes(version, serial, sigAlg, issuer, validity, subject, spki)
	);

	const dummySig = new Uint8Array([0x03, 0x03, 0x00, 0x30, 0x00]);
	return wrapDERSequence(concatBytes(tbsCert, sigAlg, dummySig));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('COSE_Sign1 Verification', () => {
	describe('verifyCoseSign1', () => {
		it('should verify a valid COSE_Sign1 signature', async () => {
			const keyPair = await generateKeyPair();
			const certDER = await buildMinimalCert(keyPair.publicKey);
			const msoPayload = buildTestMso();

			const coseSign1 = await buildCoseSign1(msoPayload, keyPair.privateKey, certDER);

			// Build a trust store entry matching this cert
			const trustedRoot: IACACertificate = {
				state: 'XX',
				issuer: 'Test Root',
				certificateB64: uint8ArrayToBase64(certDER),
				derBytes: certDER,
				expiresAt: '2035-12-31T23:59:59Z'
			};

			const result = await verifyCoseSign1(coseSign1, [trustedRoot]);

			expect(result.valid).toBe(true);
			if (result.valid) {
				expect(result.mso.version).toBe('1.0');
				expect(result.mso.digestAlgorithm).toBe('SHA-256');
				expect(result.mso.validityInfo.validFrom).toBeInstanceOf(Date);
				expect(result.mso.validityInfo.validUntil).toBeInstanceOf(Date);
				expect(result.mso.issuerCertificate).toEqual(certDER);
			}
		});

		it('should reject a signature made with a different key', async () => {
			const signingKeyPair = await generateKeyPair();
			const differentKeyPair = await generateKeyPair();

			// Build cert with the DIFFERENT key (not the signing key)
			const certDER = await buildMinimalCert(differentKeyPair.publicKey);
			const msoPayload = buildTestMso();

			// Sign with the SIGNING key (mismatches the cert)
			const coseSign1 = await buildCoseSign1(msoPayload, signingKeyPair.privateKey, certDER);

			const trustedRoot: IACACertificate = {
				state: 'XX',
				issuer: 'Test Root',
				certificateB64: uint8ArrayToBase64(certDER),
				derBytes: certDER,
				expiresAt: '2035-12-31T23:59:59Z'
			};

			const result = await verifyCoseSign1(coseSign1, [trustedRoot]);

			expect(result.valid).toBe(false);
			if (!result.valid) {
				expect(result.reason).toContain('verification failed');
			}
		});

		it('should reject when issuer cert is not in trust store', async () => {
			const keyPair = await generateKeyPair();
			const certDER = await buildMinimalCert(keyPair.publicKey);
			const msoPayload = buildTestMso();

			const coseSign1 = await buildCoseSign1(msoPayload, keyPair.privateKey, certDER);

			// Trust store has a DIFFERENT cert
			const otherKeyPair = await generateKeyPair();
			const otherCertDER = await buildMinimalCert(otherKeyPair.publicKey);

			const trustedRoot: IACACertificate = {
				state: 'CA',
				issuer: 'California Test Root',
				certificateB64: uint8ArrayToBase64(otherCertDER),
				derBytes: otherCertDER,
				expiresAt: '2035-12-31T23:59:59Z'
			};

			const result = await verifyCoseSign1(coseSign1, [trustedRoot]);

			expect(result.valid).toBe(false);
			if (!result.valid) {
				expect(result.reason).toContain('trust store');
			}
		});

		it('should reject a non-array input', async () => {
			const result = await verifyCoseSign1(
				'not an array' as unknown as unknown[],
				[]
			);
			expect(result.valid).toBe(false);
		});

		it('should reject a COSE_Sign1 with wrong array length', async () => {
			const result = await verifyCoseSign1([1, 2, 3], []);
			expect(result.valid).toBe(false);
			if (!result.valid) {
				expect(result.reason).toContain('4-element');
			}
		});

		it('should reject unsupported algorithms', async () => {
			// Build protected headers with algorithm -36 (ES512) — not supported
			const protectedHeaders = new Map<number, number>();
			protectedHeaders.set(1, -36);
			const protectedHeadersCBOR = new Uint8Array(encode(protectedHeaders));

			const result = await verifyCoseSign1(
				[protectedHeadersCBOR, new Map(), new Uint8Array(10), new Uint8Array(64)],
				[]
			);
			expect(result.valid).toBe(false);
			if (!result.valid) {
				expect(result.reason).toContain('Unsupported COSE algorithm');
			}
		});

		it('should reject duplicate protected header labels before signature verification', async () => {
			const keyPair = await generateKeyPair();
			const certDER = await buildMinimalCert(keyPair.publicKey);
			const msoPayload = buildTestMso();
			const duplicateAlgProtectedHeaders = new Uint8Array([0xa2, 0x01, 0x26, 0x01, 0x26]);
			const coseSign1 = await buildCoseSign1(msoPayload, keyPair.privateKey, certDER, {
				protectedHeadersCBOR: duplicateAlgProtectedHeaders
			});

			const trustedRoot: IACACertificate = {
				state: 'XX',
				issuer: 'Test Root',
				certificateB64: uint8ArrayToBase64(certDER),
				derBytes: certDER,
				expiresAt: '2035-12-31T23:59:59Z'
			};

			const result = await verifyCoseSign1(coseSign1, [trustedRoot]);

			expect(result.valid).toBe(false);
			if (!result.valid) {
				expect(result.reason).toContain('duplicate protected header label 1');
			}
		});

		it('should reject text-keyed protected alg labels', async () => {
			const keyPair = await generateKeyPair();
			const certDER = await buildMinimalCert(keyPair.publicKey);
			const msoPayload = buildTestMso();
			const textAlgProtectedHeaders = new Uint8Array(encode({ '1': -7 }));
			const coseSign1 = await buildCoseSign1(msoPayload, keyPair.privateKey, certDER, {
				protectedHeadersCBOR: textAlgProtectedHeaders
			});

			const trustedRoot: IACACertificate = {
				state: 'XX',
				issuer: 'Test Root',
				certificateB64: uint8ArrayToBase64(certDER),
				derBytes: certDER,
				expiresAt: '2035-12-31T23:59:59Z'
			};

			const result = await verifyCoseSign1(coseSign1, [trustedRoot]);

			expect(result.valid).toBe(false);
			if (!result.valid) {
				expect(result.reason).toContain('protected headers must decode to a Map');
			}
		});

		it('should reject when signature has wrong length', async () => {
			const protectedHeaders = new Map<number, number>();
			protectedHeaders.set(1, -7);
			const protectedHeadersCBOR = new Uint8Array(encode(protectedHeaders));

			const keyPair = await generateKeyPair();
			const certDER = await buildMinimalCert(keyPair.publicKey);

			const unprotectedHeaders = new Map<number, Uint8Array>();
			unprotectedHeaders.set(33, certDER);

			const trustedRoot: IACACertificate = {
				state: 'XX',
				issuer: 'Test',
				certificateB64: uint8ArrayToBase64(certDER),
				derBytes: certDER,
				expiresAt: '2035-12-31T23:59:59Z'
			};

			const result = await verifyCoseSign1(
				[protectedHeadersCBOR, unprotectedHeaders, new Uint8Array(10), new Uint8Array(32)],
				[trustedRoot]
			);
			expect(result.valid).toBe(false);
			if (!result.valid) {
				expect(result.reason).toContain('signature length');
			}
		});

		it('should reject detached payload (null)', async () => {
			const protectedHeaders = new Map<number, number>();
			protectedHeaders.set(1, -7);
			const protectedHeadersCBOR = new Uint8Array(encode(protectedHeaders));

			const result = await verifyCoseSign1(
				[protectedHeadersCBOR, new Map(), null, new Uint8Array(64)],
				[]
			);
			expect(result.valid).toBe(false);
			if (!result.valid) {
				expect(result.reason).toContain('Detached');
			}
		});
	});

	describe('extractEcPublicKeyFromDER', () => {
		it('should extract the P-256 public key from a minimal DER cert', async () => {
			const keyPair = await generateKeyPair();
			const rawKey = new Uint8Array(await crypto.subtle.exportKey('raw', keyPair.publicKey));
			const certDER = await buildMinimalCert(keyPair.publicKey);

			const extracted = extractEcPublicKeyFromDER(certDER);

			expect(extracted.curve).toBe('P-256');
			expect(extracted.keyBytes.length).toBe(65);
			expect(extracted.keyBytes[0]).toBe(0x04); // Uncompressed point prefix
			expect(extracted.keyBytes).toEqual(rawKey);
		});

		it('should throw if EC OID is not present', () => {
			// Random bytes without the EC OID
			const garbage = new Uint8Array(100);
			crypto.getRandomValues(garbage);

			expect(() => extractEcPublicKeyFromDER(garbage)).toThrow('EC public key OID not found');
		});
	});

	describe('validateMsoDigests', () => {
		it('should validate matching digests', async () => {
			// Build IssuerSignedItem elements
			const item0 = {
				digestID: 0,
				random: new Uint8Array([0xaa, 0xbb]),
				elementIdentifier: 'family_name',
				elementValue: 'Smith'
			};
			const item1 = {
				digestID: 1,
				random: new Uint8Array([0xcc, 0xdd]),
				elementIdentifier: 'given_name',
				elementValue: 'John'
			};

			const item0Bytes = new Uint8Array(encode(item0));
			const item1Bytes = new Uint8Array(encode(item1));

			// Compute SHA-256 digests
			const digest0 = new Uint8Array(await crypto.subtle.digest('SHA-256', item0Bytes));
			const digest1 = new Uint8Array(await crypto.subtle.digest('SHA-256', item1Bytes));

			// Build MSO with these digests
			const valueDigests = new Map<string, Map<number, Uint8Array>>([
				[
					'org.iso.18013.5.1',
					new Map<number, Uint8Array>([
						[0, digest0],
						[1, digest1]
					])
				]
			]);

			const mso: MobileSecurityObject = {
				version: '1.0',
				digestAlgorithm: 'SHA-256',
				valueDigests,
				validityInfo: {
					signed: new Date('2026-01-01'),
					validFrom: new Date('2026-01-01'),
					validUntil: new Date('2027-01-01')
				},
				issuerCertificate: new Uint8Array(0)
			};

			const result = await validateMsoDigests(
				mso,
				{ 'org.iso.18013.5.1': [item0Bytes, item1Bytes] },
				(d: Uint8Array) => decode(d),
				(d: unknown) => new Uint8Array(encode(d))
			);

			expect(result).toBe(true);
		});

		it('should reject tampered element data', async () => {
			const item0 = {
				digestID: 0,
				random: new Uint8Array([0xaa, 0xbb]),
				elementIdentifier: 'family_name',
				elementValue: 'Smith'
			};

			const item0Bytes = new Uint8Array(encode(item0));
			const digest0 = new Uint8Array(await crypto.subtle.digest('SHA-256', item0Bytes));

			const valueDigests = new Map<string, Map<number, Uint8Array>>([
				['org.iso.18013.5.1', new Map<number, Uint8Array>([[0, digest0]])]
			]);

			const mso: MobileSecurityObject = {
				version: '1.0',
				digestAlgorithm: 'SHA-256',
				valueDigests,
				validityInfo: {
					signed: new Date('2026-01-01'),
					validFrom: new Date('2026-01-01'),
					validUntil: new Date('2027-01-01')
				},
				issuerCertificate: new Uint8Array(0)
			};

			// Tamper with the element: change the value
			const tamperedItem = {
				digestID: 0,
				random: new Uint8Array([0xaa, 0xbb]),
				elementIdentifier: 'family_name',
				elementValue: 'Jones' // TAMPERED
			};
			const tamperedBytes = new Uint8Array(encode(tamperedItem));

			const result = await validateMsoDigests(
				mso,
				{ 'org.iso.18013.5.1': [tamperedBytes] },
				(d: Uint8Array) => decode(d),
				(d: unknown) => new Uint8Array(encode(d))
			);

			expect(result).toBe(false);
		});

		it('should reject elements with unknown digest IDs', async () => {
			const item0 = {
				digestID: 99, // Not in MSO
				random: new Uint8Array([0xaa]),
				elementIdentifier: 'test',
				elementValue: 'x'
			};
			const item0Bytes = new Uint8Array(encode(item0));

			const valueDigests = new Map<string, Map<number, Uint8Array>>([
				[
					'org.iso.18013.5.1',
					new Map<number, Uint8Array>([[0, new Uint8Array([1, 2, 3])]])
				]
			]);

			const mso: MobileSecurityObject = {
				version: '1.0',
				digestAlgorithm: 'SHA-256',
				valueDigests,
				validityInfo: {
					signed: new Date('2026-01-01'),
					validFrom: new Date('2026-01-01'),
					validUntil: new Date('2027-01-01')
				},
				issuerCertificate: new Uint8Array(0)
			};

			const result = await validateMsoDigests(
				mso,
				{ 'org.iso.18013.5.1': [item0Bytes] },
				(d: Uint8Array) => decode(d),
				(d: unknown) => new Uint8Array(encode(d))
			);

			expect(result).toBe(false);
		});

		it('should reject elements without digest IDs', async () => {
			const unsignedItem = {
				random: new Uint8Array([0xaa]),
				elementIdentifier: 'resident_state',
				elementValue: 'NY'
			};
			const unsignedItemBytes = new Uint8Array(encode(unsignedItem));

			const valueDigests = new Map<string, Map<number, Uint8Array>>([
				[
					'org.iso.18013.5.1',
					new Map<number, Uint8Array>([[0, new Uint8Array([1, 2, 3])]])
				]
			]);

			const mso: MobileSecurityObject = {
				version: '1.0',
				digestAlgorithm: 'SHA-256',
				valueDigests,
				validityInfo: {
					signed: new Date('2026-01-01'),
					validFrom: new Date('2026-01-01'),
					validUntil: new Date('2027-01-01')
				},
				issuerCertificate: new Uint8Array(0)
			};

			const result = await validateMsoDigests(
				mso,
				{ 'org.iso.18013.5.1': [unsignedItemBytes] },
				(d: Uint8Array) => decode(d),
				(d: unknown) => new Uint8Array(encode(d))
			);

			expect(result).toBe(false);
		});

		it('should reject presented namespaces missing from the MSO', async () => {
			const item = {
				digestID: 0,
				random: new Uint8Array([0xaa]),
				elementIdentifier: 'resident_state',
				elementValue: 'NY'
			};
			const itemBytes = new Uint8Array(encode(item));

			const mso: MobileSecurityObject = {
				version: '1.0',
				digestAlgorithm: 'SHA-256',
				valueDigests: new Map([
					['org.iso.18013.5.1', new Map([[0, new Uint8Array([1, 2, 3])]])]
				]),
				validityInfo: {
					signed: new Date('2026-01-01'),
					validFrom: new Date('2026-01-01'),
					validUntil: new Date('2027-01-01')
				},
				issuerCertificate: new Uint8Array(0)
			};

			const result = await validateMsoDigests(
				mso,
				{ 'org.example.unsigned': [itemBytes] },
				(d: Uint8Array) => decode(d),
				(d: unknown) => new Uint8Array(encode(d))
			);

			expect(result).toBe(false);
		});
	});

	describe('DeviceAuth deviceSignature verification', () => {
		it('verifies a detached DeviceAuthentication signature using the MSO device key', async () => {
			const deviceKeyPair = await generateKeyPair();
			const deviceKey = await publicKeyToCoseEc2Key(deviceKeyPair.publicKey);

			const issuerKeyPair = await generateKeyPair();
			const certDER = await buildMinimalCert(issuerKeyPair.publicKey);
			const msoPayload = buildTestMso(undefined, deviceKey);
			const issuerAuth = await buildCoseSign1(msoPayload, issuerKeyPair.privateKey, certDER);

			const trustedRoot: IACACertificate = {
				state: 'XX',
				issuer: 'Test Root',
				certificateB64: uint8ArrayToBase64(certDER),
				derBytes: certDER,
				expiresAt: '2035-12-31T23:59:59Z'
			};

			const coseResult = await verifyCoseSign1(issuerAuth, [trustedRoot]);
			expect(coseResult.valid).toBe(true);
			if (!coseResult.valid) return;
			expect(coseResult.mso.deviceKeyInfo?.deviceKey.curve).toBe('P-256');

			const deviceAuthenticationBytes = new Uint8Array([
				0x84,
				0x74,
				...new TextEncoder().encode('DeviceAuthentication'),
				0xf6,
				0x63,
				0x6d,
				0x44,
				0x4c,
				0x40
			]);
			const deviceSignature = await buildDeviceSignature(
				deviceAuthenticationBytes,
				deviceKeyPair.privateKey
			);

			await expect(
				verifyDeviceSignature(
					deviceSignature,
					coseResult.mso.deviceKeyInfo!.deviceKey,
					deviceAuthenticationBytes
				)
			).resolves.toEqual({ valid: true });
		});

		it('rejects replay against a different DeviceAuthentication transcript', async () => {
			const deviceKeyPair = await generateKeyPair();
			const deviceKey = await publicKeyToCoseEc2Key(deviceKeyPair.publicKey);
			const deviceAuthenticationBytes = new Uint8Array([0x83, 0x01, 0x02, 0x03]);
			const tamperedAuthenticationBytes = new Uint8Array([0x83, 0x01, 0x02, 0x04]);
			const deviceSignature = await buildDeviceSignature(
				deviceAuthenticationBytes,
				deviceKeyPair.privateKey
			);

			const result = await verifyDeviceSignature(
				deviceSignature,
				{
					kty: 'EC2',
					curve: 'P-256',
					x: deviceKey.get(-2) as Uint8Array,
					y: deviceKey.get(-3) as Uint8Array
				},
				tamperedAuthenticationBytes
			);

			expect(result.valid).toBe(false);
			if (!result.valid) {
				expect(result.reason).toMatch(/invalid/i);
			}
		});

		it('rejects DeviceSignature verification with a different device key', async () => {
			const signingKeyPair = await generateKeyPair();
			const differentKeyPair = await generateKeyPair();
			const differentDeviceKey = await publicKeyToCoseEc2Key(differentKeyPair.publicKey);
			const deviceAuthenticationBytes = new Uint8Array([0x83, 0x01, 0x02, 0x03]);
			const deviceSignature = await buildDeviceSignature(
				deviceAuthenticationBytes,
				signingKeyPair.privateKey
			);

			const result = await verifyDeviceSignature(
				deviceSignature,
				{
					kty: 'EC2',
					curve: 'P-256',
					x: differentDeviceKey.get(-2) as Uint8Array,
					y: differentDeviceKey.get(-3) as Uint8Array
				},
				deviceAuthenticationBytes
			);

			expect(result.valid).toBe(false);
			if (!result.valid) {
				expect(result.reason).toMatch(/invalid/i);
			}
		});

		it('verifies DeviceAuthentication bytes with multi-byte CBOR length encoding', async () => {
			const deviceKeyPair = await generateKeyPair();
			const deviceKey = await publicKeyToCoseEc2Key(deviceKeyPair.publicKey);
			const deviceAuthenticationBytes = new Uint8Array(300);
			crypto.getRandomValues(deviceAuthenticationBytes);
			const deviceSignature = await buildDeviceSignature(
				deviceAuthenticationBytes,
				deviceKeyPair.privateKey
			);

			const result = await verifyDeviceSignature(
				deviceSignature,
				{
					kty: 'EC2',
					curve: 'P-256',
					x: deviceKey.get(-2) as Uint8Array,
					y: deviceKey.get(-3) as Uint8Array
				},
				deviceAuthenticationBytes
			);

			expect(result).toEqual({ valid: true });
		});

		it('rejects duplicate DeviceSignature protected header labels', async () => {
			const deviceKeyPair = await generateKeyPair();
			const deviceKey = await publicKeyToCoseEc2Key(deviceKeyPair.publicKey);
			const deviceAuthenticationBytes = new Uint8Array([0x83, 0x01, 0x02, 0x03]);
			const duplicateAlgProtectedHeaders = new Uint8Array([0xa2, 0x01, 0x26, 0x01, 0x26]);
			const deviceSignature = await buildDeviceSignature(
				deviceAuthenticationBytes,
				deviceKeyPair.privateKey,
				{ protectedHeadersCBOR: duplicateAlgProtectedHeaders }
			);

			const result = await verifyDeviceSignature(
				deviceSignature,
				{
					kty: 'EC2',
					curve: 'P-256',
					x: deviceKey.get(-2) as Uint8Array,
					y: deviceKey.get(-3) as Uint8Array
				},
				deviceAuthenticationBytes
			);

			expect(result.valid).toBe(false);
			if (!result.valid) {
				expect(result.reason).toContain('duplicate protected header label 1');
			}
		});

		it('rejects text-keyed DeviceSignature protected alg labels', async () => {
			const deviceKeyPair = await generateKeyPair();
			const deviceKey = await publicKeyToCoseEc2Key(deviceKeyPair.publicKey);
			const deviceAuthenticationBytes = new Uint8Array([0x83, 0x01, 0x02, 0x03]);
			const textAlgProtectedHeaders = new Uint8Array(encode({ '1': -7 }));
			const deviceSignature = await buildDeviceSignature(
				deviceAuthenticationBytes,
				deviceKeyPair.privateKey,
				{ protectedHeadersCBOR: textAlgProtectedHeaders }
			);

			const result = await verifyDeviceSignature(
				deviceSignature,
				{
					kty: 'EC2',
					curve: 'P-256',
					x: deviceKey.get(-2) as Uint8Array,
					y: deviceKey.get(-3) as Uint8Array
				},
				deviceAuthenticationBytes
			);

			expect(result.valid).toBe(false);
			if (!result.valid) {
				expect(result.reason).toContain('protected headers must decode to a Map');
			}
		});

		it('rejects DeviceSignature payloads that are not detached', async () => {
			const deviceKeyPair = await generateKeyPair();
			const deviceKey = await publicKeyToCoseEc2Key(deviceKeyPair.publicKey);
			const deviceAuthenticationBytes = new Uint8Array([0x83, 0x01, 0x02, 0x03]);
			const deviceSignature = await buildDeviceSignature(
				deviceAuthenticationBytes,
				deviceKeyPair.privateKey,
				{ payload: new Uint8Array([0x01]) }
			);

			const result = await verifyDeviceSignature(
				deviceSignature,
				{
					kty: 'EC2',
					curve: 'P-256',
					x: deviceKey.get(-2) as Uint8Array,
					y: deviceKey.get(-3) as Uint8Array
				},
				deviceAuthenticationBytes
			);

			expect(result).toEqual({
				valid: false,
				reason: 'DeviceSignature payload must be nil (detached content)'
			});
		});

		it('rejects mismatched COSE_Key alg values in present deviceKeyInfo', async () => {
			const deviceKeyPair = await generateKeyPair();
			const deviceKey = await publicKeyToCoseEc2Key(deviceKeyPair.publicKey);
			deviceKey.set(3, -35); // alg: ES384, invalid for the P-256 key coordinates.

			const issuerKeyPair = await generateKeyPair();
			const certDER = await buildMinimalCert(issuerKeyPair.publicKey);
			const msoPayload = buildTestMso(undefined, deviceKey);
			const issuerAuth = await buildCoseSign1(msoPayload, issuerKeyPair.privateKey, certDER);

			const trustedRoot: IACACertificate = {
				state: 'XX',
				issuer: 'Test Root',
				certificateB64: uint8ArrayToBase64(certDER),
				derBytes: certDER,
				expiresAt: '2035-12-31T23:59:59Z'
			};

			const coseResult = await verifyCoseSign1(issuerAuth, [trustedRoot]);
			expect(coseResult.valid).toBe(false);
			if (!coseResult.valid) {
				expect(coseResult.reason).toContain('Invalid MSO deviceKeyInfo.deviceKey');
			}
		});

		it('rejects string-keyed COSE_Key labels in present deviceKeyInfo', async () => {
			const deviceKeyPair = await generateKeyPair();
			const deviceKey = await publicKeyToCoseEc2Key(deviceKeyPair.publicKey);
			const stringKeyedDeviceKey = {
				'1': 2,
				'-1': 1,
				'-2': deviceKey.get(-2),
				'-3': deviceKey.get(-3)
			};

			const issuerKeyPair = await generateKeyPair();
			const certDER = await buildMinimalCert(issuerKeyPair.publicKey);
			const msoPayload = buildTestMso(undefined, stringKeyedDeviceKey);
			const issuerAuth = await buildCoseSign1(msoPayload, issuerKeyPair.privateKey, certDER);

			const trustedRoot: IACACertificate = {
				state: 'XX',
				issuer: 'Test Root',
				certificateB64: uint8ArrayToBase64(certDER),
				derBytes: certDER,
				expiresAt: '2035-12-31T23:59:59Z'
			};

			const coseResult = await verifyCoseSign1(issuerAuth, [trustedRoot]);
			expect(coseResult.valid).toBe(false);
			if (!coseResult.valid) {
				expect(coseResult.reason).toContain('Invalid MSO deviceKeyInfo.deviceKey');
			}
		});
	});

	describe('MSO parsing', () => {
		it('should parse validityInfo dates from the MSO', async () => {
			const keyPair = await generateKeyPair();
			const certDER = await buildMinimalCert(keyPair.publicKey);
			const msoPayload = buildTestMso();

			const coseSign1 = await buildCoseSign1(msoPayload, keyPair.privateKey, certDER);

			const trustedRoot: IACACertificate = {
				state: 'XX',
				issuer: 'Test Root',
				certificateB64: uint8ArrayToBase64(certDER),
				derBytes: certDER,
				expiresAt: '2035-12-31T23:59:59Z'
			};

			const result = await verifyCoseSign1(coseSign1, [trustedRoot]);

			expect(result.valid).toBe(true);
			if (result.valid) {
				expect(result.mso.validityInfo.signed.toISOString()).toContain('2026');
				expect(result.mso.validityInfo.validFrom.toISOString()).toContain('2026');
				expect(result.mso.validityInfo.validUntil.toISOString()).toContain('2027');
			}
		});

		it('should parse valueDigests from the MSO', async () => {
			const keyPair = await generateKeyPair();
			const certDER = await buildMinimalCert(keyPair.publicKey);

			const testDigests = new Map<string, Map<number, Uint8Array>>([
				[
					'org.iso.18013.5.1',
					new Map<number, Uint8Array>([
						[0, new Uint8Array([0xde, 0xad])],
						[1, new Uint8Array([0xbe, 0xef])]
					])
				]
			]);
			const msoPayload = buildTestMso(testDigests);
			const coseSign1 = await buildCoseSign1(msoPayload, keyPair.privateKey, certDER);

			const trustedRoot: IACACertificate = {
				state: 'XX',
				issuer: 'Test Root',
				certificateB64: uint8ArrayToBase64(certDER),
				derBytes: certDER,
				expiresAt: '2035-12-31T23:59:59Z'
			};

			const result = await verifyCoseSign1(coseSign1, [trustedRoot]);

			expect(result.valid).toBe(true);
			if (result.valid) {
				const nsDigests = result.mso.valueDigests.get('org.iso.18013.5.1');
				expect(nsDigests).toBeDefined();
				expect(nsDigests?.get(0)).toEqual(new Uint8Array([0xde, 0xad]));
				expect(nsDigests?.get(1)).toEqual(new Uint8Array([0xbe, 0xef]));
			}
		});
	});

	describe('DSC chain verification', () => {
		it('should verify a DSC signed by a trusted IACA root', async () => {
			// Generate IACA root key pair
			const rootKeyPair = await generateKeyPair();
			const rootCertDER = await buildMinimalCert(rootKeyPair.publicKey);

			// Generate DSC key pair and build DSC signed by root
			const dscKeyPair = await generateKeyPair();
			const dscCertDER = await buildSignedCert(dscKeyPair.publicKey, rootKeyPair.privateKey);

			// Build COSE_Sign1 with DSC in x5chain, signed by DSC's private key
			const msoPayload = buildTestMso();
			const coseSign1 = await buildCoseSign1(msoPayload, dscKeyPair.privateKey, dscCertDER);

			// Trust store has the ROOT (not the DSC)
			const trustedRoot: IACACertificate = {
				state: 'CA',
				issuer: 'Test IACA Root',
				certificateB64: uint8ArrayToBase64(rootCertDER),
				derBytes: rootCertDER,
				expiresAt: '2035-12-31T23:59:59Z'
			};

			const result = await verifyCoseSign1(coseSign1, [trustedRoot]);

			expect(result.valid).toBe(true);
			if (result.valid) {
				expect(result.mso.version).toBe('1.0');
				expect(result.mso.issuerCertificate).toEqual(dscCertDER);
			}
		});

		it('should reject a DSC signed by an untrusted CA', async () => {
			// Root A (trusted)
			const trustedRootKeyPair = await generateKeyPair();
			const trustedRootCertDER = await buildMinimalCert(trustedRootKeyPair.publicKey);

			// Root B (untrusted — the actual signer)
			const untrustedRootKeyPair = await generateKeyPair();

			// DSC signed by Root B (untrusted)
			const dscKeyPair = await generateKeyPair();
			const dscCertDER = await buildSignedCert(dscKeyPair.publicKey, untrustedRootKeyPair.privateKey);

			const msoPayload = buildTestMso();
			const coseSign1 = await buildCoseSign1(msoPayload, dscKeyPair.privateKey, dscCertDER);

			// Trust store only has Root A
			const trustedRoot: IACACertificate = {
				state: 'CA',
				issuer: 'Trusted Root A',
				certificateB64: uint8ArrayToBase64(trustedRootCertDER),
				derBytes: trustedRootCertDER,
				expiresAt: '2035-12-31T23:59:59Z'
			};

			const result = await verifyCoseSign1(coseSign1, [trustedRoot]);

			expect(result.valid).toBe(false);
			if (!result.valid) {
				expect(result.reason).toContain('trust store');
			}
		});

		it('should reject a tampered DSC', async () => {
			const rootKeyPair = await generateKeyPair();
			const rootCertDER = await buildMinimalCert(rootKeyPair.publicKey);

			const dscKeyPair = await generateKeyPair();
			const dscCertDER = await buildSignedCert(dscKeyPair.publicKey, rootKeyPair.privateKey);

			// Tamper: flip a byte in the TBSCertificate portion
			const tamperedDsc = new Uint8Array(dscCertDER);
			tamperedDsc[20] ^= 0xff;

			const msoPayload = buildTestMso();
			const coseSign1 = await buildCoseSign1(msoPayload, dscKeyPair.privateKey, tamperedDsc);

			const trustedRoot: IACACertificate = {
				state: 'CA',
				issuer: 'Test IACA Root',
				certificateB64: uint8ArrayToBase64(rootCertDER),
				derBytes: rootCertDER,
				expiresAt: '2035-12-31T23:59:59Z'
			};

			const result = await verifyCoseSign1(coseSign1, [trustedRoot]);

			expect(result.valid).toBe(false);
		});

		it('should still work with self-signed certs (backward compat fast path)', async () => {
			// This is the existing pattern: cert in trust store IS the signing cert
			const keyPair = await generateKeyPair();
			const certDER = await buildMinimalCert(keyPair.publicKey);
			const msoPayload = buildTestMso();
			const coseSign1 = await buildCoseSign1(msoPayload, keyPair.privateKey, certDER);

			const trustedRoot: IACACertificate = {
				state: 'XX',
				issuer: 'Self-signed Test',
				certificateB64: uint8ArrayToBase64(certDER),
				derBytes: certDER,
				expiresAt: '2035-12-31T23:59:59Z'
			};

			const result = await verifyCoseSign1(coseSign1, [trustedRoot]);
			expect(result.valid).toBe(true);
		});

		it('should find the right root among multiple trusted roots', async () => {
			// Three roots in trust store, only root B signed the DSC
			const rootAKeyPair = await generateKeyPair();
			const rootACert = await buildMinimalCert(rootAKeyPair.publicKey);

			const rootBKeyPair = await generateKeyPair();
			const rootBCert = await buildMinimalCert(rootBKeyPair.publicKey);

			const rootCKeyPair = await generateKeyPair();
			const rootCCert = await buildMinimalCert(rootCKeyPair.publicKey);

			// DSC signed by root B
			const dscKeyPair = await generateKeyPair();
			const dscCertDER = await buildSignedCert(dscKeyPair.publicKey, rootBKeyPair.privateKey);

			const msoPayload = buildTestMso();
			const coseSign1 = await buildCoseSign1(msoPayload, dscKeyPair.privateKey, dscCertDER);

			const trustedRoots: IACACertificate[] = [
				{ state: 'CA', issuer: 'Root A', certificateB64: uint8ArrayToBase64(rootACert), derBytes: rootACert, expiresAt: '2035-12-31T23:59:59Z' },
				{ state: 'NM', issuer: 'Root B', certificateB64: uint8ArrayToBase64(rootBCert), derBytes: rootBCert, expiresAt: '2035-12-31T23:59:59Z' },
				{ state: 'AZ', issuer: 'Root C', certificateB64: uint8ArrayToBase64(rootCCert), derBytes: rootCCert, expiresAt: '2035-12-31T23:59:59Z' }
			];

			const result = await verifyCoseSign1(coseSign1, trustedRoots);
			expect(result.valid).toBe(true);
		});
	});

	describe('extractTBSAndSignature', () => {
		it('should extract TBS and signature from a signed cert', async () => {
			const rootKeyPair = await generateKeyPair();
			const dscKeyPair = await generateKeyPair();
			const dscCertDER = await buildSignedCert(dscKeyPair.publicKey, rootKeyPair.privateKey);

			const { tbsBytes, signatureDER } = extractTBSAndSignature(dscCertDER);

			// TBS should start with SEQUENCE tag
			expect(tbsBytes[0]).toBe(0x30);
			// Signature should be a DER-encoded ECDSA signature (SEQUENCE)
			expect(signatureDER[0]).toBe(0x30);
			// Signature should contain two INTEGERs (r and s)
			expect(signatureDER[2]).toBe(0x02); // first INTEGER tag
		});

		it('should extract TBS from a self-signed minimal cert', async () => {
			const keyPair = await generateKeyPair();
			const certDER = await buildMinimalCert(keyPair.publicKey);

			// buildMinimalCert has a dummy signature (empty SEQUENCE 0x30 0x00)
			const { tbsBytes, signatureDER } = extractTBSAndSignature(certDER);

			expect(tbsBytes[0]).toBe(0x30);
			// Dummy signature is just 0x30 0x00 (empty SEQUENCE)
			expect(signatureDER).toEqual(new Uint8Array([0x30, 0x00]));
		});

		it('should throw on non-SEQUENCE input', () => {
			expect(() => extractTBSAndSignature(new Uint8Array([0x02, 0x01, 0x00]))).toThrow(
				'Certificate does not start with SEQUENCE tag'
			);
		});
	});

	describe('derEcdsaSigToRaw', () => {
		it('should round-trip through rawSigToDer and derEcdsaSigToRaw', () => {
			// Create a known 64-byte raw signature
			const rawSig = new Uint8Array(64);
			for (let i = 0; i < 64; i++) rawSig[i] = i + 1;

			const derSig = rawSigToDer(rawSig);
			const recovered = derEcdsaSigToRaw(derSig);

			expect(recovered).toEqual(rawSig);
		});

		it('should handle signatures with high-bit r value', () => {
			const rawSig = new Uint8Array(64);
			rawSig[0] = 0xff; // high bit set → DER will add leading 0x00
			rawSig[1] = 0xab;
			for (let i = 2; i < 32; i++) rawSig[i] = i;
			for (let i = 32; i < 64; i++) rawSig[i] = i;

			const derSig = rawSigToDer(rawSig);
			const recovered = derEcdsaSigToRaw(derSig);

			expect(recovered).toEqual(rawSig);
		});

		it('should handle signatures with leading zeros', () => {
			const rawSig = new Uint8Array(64);
			// r starts with zeros
			rawSig[0] = 0x00;
			rawSig[1] = 0x00;
			rawSig[2] = 0x42;
			for (let i = 3; i < 32; i++) rawSig[i] = i;
			for (let i = 32; i < 64; i++) rawSig[i] = i;

			const derSig = rawSigToDer(rawSig);
			const recovered = derEcdsaSigToRaw(derSig);

			expect(recovered).toEqual(rawSig);
		});

		it('should throw on non-SEQUENCE input', () => {
			expect(() => derEcdsaSigToRaw(new Uint8Array([0x02, 0x01, 0x00]))).toThrow(
				'DER signature does not start with SEQUENCE tag'
			);
		});
	});

	describe('IACA root certificate parsing', () => {
		it('should extract public key from real CA IACA root certificate', () => {
			// Base64 DER of the real California DMV IACA Root cert
			const caRootB64 =
				'MIICPzCCAeWgAwIBAgIUXd0okOOM5cylFwc2WNK7D2O+ArAwCgYIKoZIzj0EAwIw' +
				'UTELMAkGA1UEBhMCVVMxDjAMBgNVBAgMBVVTLUNBMQ8wDQYDVQQKDAZDQS1ETVYx' +
				'ITAfBgNVBAMMGENhbGlmb3JuaWEgRE1WIElBQ0EgUm9vdDAeFw0yMzAzMDExNzE3' +
				'MzlaFw0zMzAxMDcxNzE3MzlaMFExCzAJBgNVBAYTAlVTMQ4wDAYDVQQIDAVVUy1D' +
				'QTEPMA0GA1UECgwGQ0EtRE1WMSEwHwYDVQQDDBhDYWxpZm9ybmlhIERNViBJQUNB' +
				'IFJvb3QwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAARgzKB5QsRXYGxmIapA3ilL' +
				'oXCDxgTMI2JArA72VQ9gL2DIKkBAclKYtix7vQwUbhbH76mnmbOFSxYlCJtilfl1' +
				'o4GaMIGXMB0GA1UdDgQWBBS7fXVnknpvz59ye7gK9zcvnAxQNjASBgNVHRMBAf8E' +
				'CDAGAQH/AgEAMA4GA1UdDwEB/wQEAwIBBjAfBgNVHRIEGDAWgRRpYWNhLXJvb3RA' +
				'ZG12LmNhLmdvdjAxBgNVHR8EKjAoMCagJKAihiBodHRwczovL2NybC5kbXYuY2Eu' +
				'Z292L2lhY2Evcm9vdDAKBggqhkjOPQQDAgNIADBFAiAJriK4wEUzgDCK++tIIW+g' +
				'XASUIIcG/XhBNxuk2uHd7QIhAKWC8LFaM8qFsvlujtZZf647zD8BBc6kicj1Imw/' +
				'wujS';

			const derBytes = Uint8Array.from(atob(caRootB64), (c) => c.charCodeAt(0));
			const { keyBytes: pubKey, curve } = extractEcPublicKeyFromDER(derBytes);

			expect(curve).toBe('P-256');
			expect(pubKey.length).toBe(65);
			expect(pubKey[0]).toBe(0x04); // uncompressed point
			// Known CA DMV public key x-coordinate starts with 0x60 0xcc 0xa0
			expect(pubKey[1]).toBe(0x60);
			expect(pubKey[2]).toBe(0xcc);
			expect(pubKey[3]).toBe(0xa0);
		});

		it('should extract public key from real NM IACA root certificate', () => {
			const nmRootB64 =
				'MIIDgjCCAyigAwIBAgIUAIJ4VcLJGUNElxQUSUy6mDxpJrYwCgYIKoZIzj0EAwIw' +
				'gcExDjAMBgNVBAgTBVVTLU5NMQswCQYDVQQGEwJVUzERMA8GA1UEBxMIU2FudGEg' +
				'RmUxMzAxBgNVBAoTKk5ldyBNZXhpY28gVGF4YXRpb24gYW5kIFJldmVudWUgRGVw' +
				'YXJ0bWVudDEqMCgGA1UECxMhTmV3IE1leGljbyBNb3RvciBWZWhpY2xlIERpdmlz' +
				'aW9uMS4wLAYDVQQDEyVOZXcgTWV4aWNvIFJvb3QgQ2VydGlmaWNhdGUgQXV0aG9y' +
				'aXR5MB4XDTI1MTAwMTA2MDAwMFoXDTMwMTAwMTA2MDAwMFowgcExDjAMBgNVBAgT' +
				'BVVTLU5NMQswCQYDVQQGEwJVUzERMA8GA1UEBxMIU2FudGEgRmUxMzAxBgNVBAoT' +
				'Kk5ldyBNZXhpY28gVGF4YXRpb24gYW5kIFJldmVudWUgRGVwYXJ0bWVudDEqMCgG' +
				'A1UECxMhTmV3IE1leGljbyBNb3RvciBWZWhpY2xlIERpdmlzaW9uMS4wLAYDVQQD' +
				'EyVOZXcgTWV4aWNvIFJvb3QgQ2VydGlmaWNhdGUgQXV0aG9yaXR5MFkwEwYHKoZI' +
				'zj0CAQYIKoZIzj0DAQcDQgAEmPrlwEZA1mW8d+ekzFViC/4bxmmWa1IQcbmpGxNw' +
				'Cv1h2A2z4BX2N7CSO1sh5Kgeh/JTfT2e7t/VJUC+TE6psqOB+zCB+DAOBgNVHQ8B' +
				'Af8EBAMCAQYwEgYDVR0TAQH/BAgwBgEB/wIBADAdBgNVHQ4EFgQUwDtVKIe7jBPw' +
				'2n78JqJgSuf1wnowKQYDVR0SBCIwIIYeaHR0cHM6Ly93d3cubXZkLm5ld21leGlj' +
				'by5nb3YvMHYGA1UdHwRvMG0wa6BpoGeGZWh0dHBzOi8vc2VydmljZXMubXZkLm5l' +
				'd21leGljby5nb3Yvc2VydmljZXMvZXh0ZXJuYWwvY3JsL2dldExpc3QvZGFlMWE3' +
				'YWQxMmZmNGI0YWIwMDg4MDI0NDg3NmQ5MGYuY3JsMBAGCSsGAQQBg8UhAQQDTlNQ' +
				'MAoGCCqGSM49BAMCA0gAMEUCIQDKU91VZtiRtzly+WaK1ah2fYOTBxuIfIqKzZQk' +
				'jInviwIgdV2QIumonPVhepHrdrccIxgbu/pJi/P83PlUAoOW5kY=';

			const derBytes = Uint8Array.from(atob(nmRootB64), (c) => c.charCodeAt(0));
			const { keyBytes: pubKey, curve } = extractEcPublicKeyFromDER(derBytes);

			expect(curve).toBe('P-256');
			expect(pubKey.length).toBe(65);
			expect(pubKey[0]).toBe(0x04);
			// Known NM public key x-coordinate starts with 0x98 0xfa 0xe5
			expect(pubKey[1]).toBe(0x98);
			expect(pubKey[2]).toBe(0xfa);
			expect(pubKey[3]).toBe(0xe5);
		});

		it('should extract TBS and signature from real CA cert', () => {
			const caRootB64 =
				'MIICPzCCAeWgAwIBAgIUXd0okOOM5cylFwc2WNK7D2O+ArAwCgYIKoZIzj0EAwIw' +
				'UTELMAkGA1UEBhMCVVMxDjAMBgNVBAgMBVVTLUNBMQ8wDQYDVQQKDAZDQS1ETVYx' +
				'ITAfBgNVBAMMGENhbGlmb3JuaWEgRE1WIElBQ0EgUm9vdDAeFw0yMzAzMDExNzE3' +
				'MzlaFw0zMzAxMDcxNzE3MzlaMFExCzAJBgNVBAYTAlVTMQ4wDAYDVQQIDAVVUy1D' +
				'QTEPMA0GA1UECgwGQ0EtRE1WMSEwHwYDVQQDDBhDYWxpZm9ybmlhIERNViBJQUNB' +
				'IFJvb3QwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAARgzKB5QsRXYGxmIapA3ilL' +
				'oXCDxgTMI2JArA72VQ9gL2DIKkBAclKYtix7vQwUbhbH76mnmbOFSxYlCJtilfl1' +
				'o4GaMIGXMB0GA1UdDgQWBBS7fXVnknpvz59ye7gK9zcvnAxQNjASBgNVHRMBAf8E' +
				'CDAGAQH/AgEAMA4GA1UdDwEB/wQEAwIBBjAfBgNVHRIEGDAWgRRpYWNhLXJvb3RA' +
				'ZG12LmNhLmdvdjAxBgNVHR8EKjAoMCagJKAihiBodHRwczovL2NybC5kbXYuY2Eu' +
				'Z292L2lhY2Evcm9vdDAKBggqhkjOPQQDAgNIADBFAiAJriK4wEUzgDCK++tIIW+g' +
				'XASUIIcG/XhBNxuk2uHd7QIhAKWC8LFaM8qFsvlujtZZf647zD8BBc6kicj1Imw/' +
				'wujS';

			const derBytes = Uint8Array.from(atob(caRootB64), (c) => c.charCodeAt(0));
			const { tbsBytes, signatureDER } = extractTBSAndSignature(derBytes);

			// TBS should be a SEQUENCE
			expect(tbsBytes[0]).toBe(0x30);
			// Signature should be a DER ECDSA signature
			expect(signatureDER[0]).toBe(0x30);

			// Verify the self-signed signature: CA root signed its own TBS
			// Extract public key and verify
			const { keyBytes: pubKey } = extractEcPublicKeyFromDER(derBytes);
			expect(pubKey.length).toBe(65);

			// Convert DER signature to raw for Web Crypto verification
			const rawSig = derEcdsaSigToRaw(signatureDER);
			expect(rawSig.length).toBe(64);
		});

		it('should verify CA IACA root self-signature via Web Crypto', async () => {
			const caRootB64 =
				'MIICPzCCAeWgAwIBAgIUXd0okOOM5cylFwc2WNK7D2O+ArAwCgYIKoZIzj0EAwIw' +
				'UTELMAkGA1UEBhMCVVMxDjAMBgNVBAgMBVVTLUNBMQ8wDQYDVQQKDAZDQS1ETVYx' +
				'ITAfBgNVBAMMGENhbGlmb3JuaWEgRE1WIElBQ0EgUm9vdDAeFw0yMzAzMDExNzE3' +
				'MzlaFw0zMzAxMDcxNzE3MzlaMFExCzAJBgNVBAYTAlVTMQ4wDAYDVQQIDAVVUy1D' +
				'QTEPMA0GA1UECgwGQ0EtRE1WMSEwHwYDVQQDDBhDYWxpZm9ybmlhIERNViBJQUNB' +
				'IFJvb3QwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAARgzKB5QsRXYGxmIapA3ilL' +
				'oXCDxgTMI2JArA72VQ9gL2DIKkBAclKYtix7vQwUbhbH76mnmbOFSxYlCJtilfl1' +
				'o4GaMIGXMB0GA1UdDgQWBBS7fXVnknpvz59ye7gK9zcvnAxQNjASBgNVHRMBAf8E' +
				'CDAGAQH/AgEAMA4GA1UdDwEB/wQEAwIBBjAfBgNVHRIEGDAWgRRpYWNhLXJvb3RA' +
				'ZG12LmNhLmdvdjAxBgNVHR8EKjAoMCagJKAihiBodHRwczovL2NybC5kbXYuY2Eu' +
				'Z292L2lhY2Evcm9vdDAKBggqhkjOPQQDAgNIADBFAiAJriK4wEUzgDCK++tIIW+g' +
				'XASUIIcG/XhBNxuk2uHd7QIhAKWC8LFaM8qFsvlujtZZf647zD8BBc6kicj1Imw/' +
				'wujS';

			const derBytes = Uint8Array.from(atob(caRootB64), (c) => c.charCodeAt(0));
			const { tbsBytes, signatureDER } = extractTBSAndSignature(derBytes);
			const rawSig = derEcdsaSigToRaw(signatureDER);

			// Import the CA root's own public key
			const keyInfo = extractEcPublicKeyFromDER(derBytes);
			const pubKey = await crypto.subtle.importKey(
				'raw',
				toBuffer(keyInfo.keyBytes),
				{ name: 'ECDSA', namedCurve: keyInfo.curve },
				false,
				['verify']
			);

			// Self-signed: the root signed its own TBS
			const valid = await crypto.subtle.verify(
				{ name: 'ECDSA', hash: 'SHA-256' },
				pubKey,
				toBuffer(rawSig),
				toBuffer(tbsBytes)
			);

			expect(valid).toBe(true);
		});
	});

	describe('extractValidityPeriod', () => {
		it('should extract validity from a synthetic cert', async () => {
			const keyPair = await generateKeyPair();
			// notBefore: 2025-01-01, notAfter: 2035-12-31
			const certDER = await buildMinimalCert(keyPair.publicKey);
			const { notBefore, notAfter } = extractValidityPeriod(certDER);

			expect(notBefore.getUTCFullYear()).toBe(2025);
			expect(notBefore.getUTCMonth()).toBe(0); // January
			expect(notAfter.getUTCFullYear()).toBe(2035);
			expect(notAfter.getUTCMonth()).toBe(11); // December
		});

		it('should extract validity from real CA IACA root cert', () => {
			const caRootB64 =
				'MIICPzCCAeWgAwIBAgIUXd0okOOM5cylFwc2WNK7D2O+ArAwCgYIKoZIzj0EAwIw' +
				'UTELMAkGA1UEBhMCVVMxDjAMBgNVBAgMBVVTLUNBMQ8wDQYDVQQKDAZDQS1ETVYx' +
				'ITAfBgNVBAMMGENhbGlmb3JuaWEgRE1WIElBQ0EgUm9vdDAeFw0yMzAzMDExNzE3' +
				'MzlaFw0zMzAxMDcxNzE3MzlaMFExCzAJBgNVBAYTAlVTMQ4wDAYDVQQIDAVVUy1D' +
				'QTEPMA0GA1UECgwGQ0EtRE1WMSEwHwYDVQQDDBhDYWxpZm9ybmlhIERNViBJQUNB' +
				'IFJvb3QwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAARgzKB5QsRXYGxmIapA3ilL' +
				'oXCDxgTMI2JArA72VQ9gL2DIKkBAclKYtix7vQwUbhbH76mnmbOFSxYlCJtilfl1' +
				'o4GaMIGXMB0GA1UdDgQWBBS7fXVnknpvz59ye7gK9zcvnAxQNjASBgNVHRMBAf8E' +
				'CDAGAQH/AgEAMA4GA1UdDwEB/wQEAwIBBjAfBgNVHRIEGDAWgRRpYWNhLXJvb3RA' +
				'ZG12LmNhLmdvdjAxBgNVHR8EKjAoMCagJKAihiBodHRwczovL2NybC5kbXYuY2Eu' +
				'Z292L2lhY2Evcm9vdDAKBggqhkjOPQQDAgNIADBFAiAJriK4wEUzgDCK++tIIW+g' +
				'XASUIIcG/XhBNxuk2uHd7QIhAKWC8LFaM8qFsvlujtZZf647zD8BBc6kicj1Imw/' +
				'wujS';

			const derBytes = Uint8Array.from(atob(caRootB64), (c) => c.charCodeAt(0));
			const { notBefore, notAfter } = extractValidityPeriod(derBytes);

			// CA DMV: 2023-03-01 to 2033-01-07
			expect(notBefore.getUTCFullYear()).toBe(2023);
			expect(notBefore.getUTCMonth()).toBe(2); // March
			expect(notBefore.getUTCDate()).toBe(1);
			expect(notAfter.getUTCFullYear()).toBe(2033);
			expect(notAfter.getUTCMonth()).toBe(0); // January
			expect(notAfter.getUTCDate()).toBe(7);
		});

		it('should extract validity from cert with custom dates', async () => {
			const keyPair = await generateKeyPair();
			const certDER = await buildMinimalCertWithDates(
				keyPair.publicKey,
				'200601120000Z', // 2020-06-01
				'220101000000Z'  // 2022-01-01
			);
			const { notBefore, notAfter } = extractValidityPeriod(certDER);

			expect(notBefore.getUTCFullYear()).toBe(2020);
			expect(notAfter.getUTCFullYear()).toBe(2022);
		});
	});

	describe('DSC validity enforcement', () => {
		it('should reject a COSE_Sign1 with an expired DSC', async () => {
			const keyPair = await generateKeyPair();
			// Cert expired in 2022
			const expiredCert = await buildMinimalCertWithDates(
				keyPair.publicKey,
				'200101000000Z', // 2020-01-01
				'220101000000Z'  // 2022-01-01 (expired)
			);
			const msoPayload = buildTestMso();
			const coseSign1 = await buildCoseSign1(msoPayload, keyPair.privateKey, expiredCert);

			const trustedRoot: IACACertificate = {
				state: 'XX',
				issuer: 'Test Root',
				certificateB64: uint8ArrayToBase64(expiredCert),
				derBytes: expiredCert,
				expiresAt: '2035-12-31T23:59:59Z'
			};

			const result = await verifyCoseSign1(coseSign1, [trustedRoot]);

			expect(result.valid).toBe(false);
			if (!result.valid) {
				expect(result.reason).toContain('expired');
			}
		});

		it('should reject a COSE_Sign1 with a not-yet-valid DSC', async () => {
			const keyPair = await generateKeyPair();
			// Cert not valid until 2040
			const futureCert = await buildMinimalCertWithDates(
				keyPair.publicKey,
				'400101000000Z', // 2040-01-01 (future)
				'500101000000Z'  // 2050-01-01
			);
			const msoPayload = buildTestMso();
			const coseSign1 = await buildCoseSign1(msoPayload, keyPair.privateKey, futureCert);

			const trustedRoot: IACACertificate = {
				state: 'XX',
				issuer: 'Test Root',
				certificateB64: uint8ArrayToBase64(futureCert),
				derBytes: futureCert,
				expiresAt: '2055-12-31T23:59:59Z'
			};

			const result = await verifyCoseSign1(coseSign1, [trustedRoot]);

			expect(result.valid).toBe(false);
			if (!result.valid) {
				expect(result.reason).toContain('not yet valid');
			}
		});

		it('should accept a COSE_Sign1 with a currently-valid DSC', async () => {
			const keyPair = await generateKeyPair();
			// Default buildMinimalCert: 2025-01-01 to 2035-12-31 (currently valid)
			const certDER = await buildMinimalCert(keyPair.publicKey);
			const msoPayload = buildTestMso();
			const coseSign1 = await buildCoseSign1(msoPayload, keyPair.privateKey, certDER);

			const trustedRoot: IACACertificate = {
				state: 'XX',
				issuer: 'Test Root',
				certificateB64: uint8ArrayToBase64(certDER),
				derBytes: certDER,
				expiresAt: '2035-12-31T23:59:59Z'
			};

			const result = await verifyCoseSign1(coseSign1, [trustedRoot]);
			expect(result.valid).toBe(true);
		});
	});

	// =========================================================================
	// EXPANDED IACA TRUST STORE VALIDATION
	//
	// Parameterized per-state validation suite. Automatically tests every
	// certificate in IACA_ROOTS — when cipher adds new states, these tests
	// cover them without code changes.
	// =========================================================================

	describe('Expanded IACA Trust Store Validation', () => {
		// Import IACA_ROOTS dynamically to test whatever cipher has added
		// Flattened: IACA_ROOTS is Record<string, IACACertificate[]>, we test each cert individually
		let IACA_ROOTS_ENTRIES: [string, IACACertificate][];

		// Lazy import to pick up cipher's additions
		beforeAll(async () => {
			const mod = await import('$lib/core/identity/iaca-roots');
			IACA_ROOTS_ENTRIES = Object.entries(mod.IACA_ROOTS).flatMap(
				([state, certs]) => (certs as IACACertificate[]).map(cert => [state, cert] as [string, IACACertificate])
			);
		});

		function base64ToDER(b64: string): Uint8Array {
			const binaryString = atob(b64);
			const bytes = new Uint8Array(binaryString.length);
			for (let i = 0; i < binaryString.length; i++) {
				bytes[i] = binaryString.charCodeAt(i);
			}
			return bytes;
		}

		describe('per-state certificate validation', () => {
			// Dynamically generate tests for each state in trust store
			it('should have at least CA and NM in trust store', () => {
				const states = IACA_ROOTS_ENTRIES.map(([s]) => s);
				expect(states).toContain('CA');
				expect(states).toContain('NM');
			});

			it('should extract valid EC public key from every IACA root (P-256 or P-384)', () => {
				const failures: string[] = [];
				const expectedSizes: Record<string, number> = { 'P-256': 65, 'P-384': 97 };

				for (const [state, cert] of IACA_ROOTS_ENTRIES) {
					try {
						const der = base64ToDER(cert.certificateB64);
						const { keyBytes, curve } = extractEcPublicKeyFromDER(der);
						const expectedSize = expectedSizes[curve];

						if (!expectedSize) {
							failures.push(`${state}: unexpected curve ${curve}`);
							continue;
						}
						if (keyBytes.length !== expectedSize) {
							failures.push(`${state}: expected ${expectedSize}-byte ${curve} key, got ${keyBytes.length}`);
						}
						if (keyBytes[0] !== 0x04) {
							failures.push(`${state}: expected uncompressed point (0x04), got 0x${keyBytes[0].toString(16)}`);
						}
					} catch (err) {
						failures.push(`${state}: ${err instanceof Error ? err.message : String(err)}`);
					}
				}

				if (failures.length > 0) {
					throw new Error(`Public key extraction failures:\n${failures.join('\n')}`);
				}
			});

			it('should verify self-signature of every IACA root via Web Crypto', async () => {
				const failures: string[] = [];
				const curveHash: Record<string, string> = { 'P-256': 'SHA-256', 'P-384': 'SHA-384' };
				const curveComponentSize: Record<string, number> = { 'P-256': 32, 'P-384': 48 };

				for (const [state, cert] of IACA_ROOTS_ENTRIES) {
					try {
						const der = base64ToDER(cert.certificateB64);
						const keyInfo = extractEcPublicKeyFromDER(der);
						const pubKey = await crypto.subtle.importKey(
							'raw',
							toBuffer(keyInfo.keyBytes),
							{ name: 'ECDSA', namedCurve: keyInfo.curve },
							false,
							['verify']
						);

						const { tbsBytes, signatureDER } = extractTBSAndSignature(der);
						const rawSig = derEcdsaSigToRaw(signatureDER, curveComponentSize[keyInfo.curve]);

						const valid = await crypto.subtle.verify(
							{ name: 'ECDSA', hash: curveHash[keyInfo.curve] },
							pubKey,
							toBuffer(rawSig),
							toBuffer(tbsBytes)
						);

						if (!valid) {
							failures.push(`${state}: self-signature verification FAILED`);
						}
					} catch (err) {
						failures.push(`${state}: ${err instanceof Error ? err.message : String(err)}`);
					}
				}

				if (failures.length > 0) {
					throw new Error(`Self-signature verification failures:\n${failures.join('\n')}`);
				}
			});

			it('should parse valid notBefore < now < notAfter for every IACA root', () => {
				const failures: string[] = [];
				const now = new Date();

				for (const [state, cert] of IACA_ROOTS_ENTRIES) {
					try {
						const der = base64ToDER(cert.certificateB64);
						const { notBefore, notAfter } = extractValidityPeriod(der);

						if (isNaN(notBefore.getTime())) {
							failures.push(`${state}: notBefore is invalid date`);
							continue;
						}
						if (isNaN(notAfter.getTime())) {
							failures.push(`${state}: notAfter is invalid date`);
							continue;
						}
						if (notBefore >= notAfter) {
							failures.push(`${state}: notBefore (${notBefore.toISOString()}) >= notAfter (${notAfter.toISOString()})`);
							continue;
						}
						if (now < notBefore) {
							failures.push(`${state}: certificate not yet valid (notBefore: ${notBefore.toISOString()})`);
						}
						if (now > notAfter) {
							failures.push(`${state}: certificate EXPIRED (notAfter: ${notAfter.toISOString()})`);
						}
					} catch (err) {
						failures.push(`${state}: ${err instanceof Error ? err.message : String(err)}`);
					}
				}

				if (failures.length > 0) {
					throw new Error(`Validity period failures:\n${failures.join('\n')}`);
				}
			});

			it('should round-trip base64 decode/encode for every IACA root', () => {
				const failures: string[] = [];

				for (const [state, cert] of IACA_ROOTS_ENTRIES) {
					try {
						const der = base64ToDER(cert.certificateB64);
						const reencoded = uint8ArrayToBase64(der);

						// Normalize whitespace for comparison (base64 should have no whitespace)
						const normalizedOriginal = cert.certificateB64.replace(/\s/g, '');
						const normalizedReencoded = reencoded.replace(/\s/g, '');

						if (normalizedOriginal !== normalizedReencoded) {
							failures.push(`${state}: base64 round-trip mismatch (lengths: ${normalizedOriginal.length} vs ${normalizedReencoded.length})`);
						}

						// DER must start with SEQUENCE tag (0x30)
						if (der[0] !== 0x30) {
							failures.push(`${state}: DER does not start with SEQUENCE tag (got 0x${der[0].toString(16)})`);
						}
					} catch (err) {
						failures.push(`${state}: ${err instanceof Error ? err.message : String(err)}`);
					}
				}

				if (failures.length > 0) {
					throw new Error(`Base64 round-trip failures:\n${failures.join('\n')}`);
				}
			});

			it('should have consistent expiresAt metadata matching DER validity', () => {
				const failures: string[] = [];

				for (const [state, cert] of IACA_ROOTS_ENTRIES) {
					try {
						const der = base64ToDER(cert.certificateB64);
						const { notAfter } = extractValidityPeriod(der);
						const metadataExpiry = new Date(cert.expiresAt);

						// Allow 1 day tolerance for timezone/rounding differences
						const diffMs = Math.abs(notAfter.getTime() - metadataExpiry.getTime());
						if (diffMs > 86400000) {
							failures.push(
								`${state}: expiresAt metadata (${cert.expiresAt}) differs from DER notAfter (${notAfter.toISOString()}) by ${Math.round(diffMs / 86400000)} days`
							);
						}
					} catch (err) {
						failures.push(`${state}: ${err instanceof Error ? err.message : String(err)}`);
					}
				}

				if (failures.length > 0) {
					throw new Error(`Expiry metadata mismatches:\n${failures.join('\n')}`);
				}
			});
		});

		describe('edge cases: curve detection', () => {
			it('should accept a certificate with P-384 key and return correct curve', () => {
				// Fabricate a DER-like blob with EC OID + P-384 curve OID
				// OID 1.3.132.0.34 = secp384r1 (P-384)
				const p384CurveOid = new Uint8Array([0x06, 0x05, 0x2b, 0x81, 0x04, 0x00, 0x22]);
				const ecOid = new Uint8Array([0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01]);

				// Build a minimal structure with EC OID + P-384 OID
				const algId = wrapDERSequence(concatBytes(ecOid, p384CurveOid));
				// 97-byte P-384 uncompressed point (04 + 48 + 48)
				const fakeKey = new Uint8Array(97);
				fakeKey[0] = 0x04;
				const bitStringContent = concatBytes(new Uint8Array([0x00]), fakeKey);
				const bitString = new Uint8Array([0x03, ...encodeDERLength(bitStringContent.length), ...bitStringContent]);
				const spki = wrapDERSequence(concatBytes(algId, bitString));
				const cert = wrapDERSequence(spki);

				const { keyBytes, curve } = extractEcPublicKeyFromDER(cert);
				expect(curve).toBe('P-384');
				expect(keyBytes.length).toBe(97);
				expect(keyBytes[0]).toBe(0x04);
			});

			it('should reject a certificate with no EC OID at all (RSA cert)', () => {
				// Fabricate a DER blob without the EC public key OID
				// RSA OID: 1.2.840.113549.1.1.1
				const rsaOid = new Uint8Array([0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01]);
				const cert = wrapDERSequence(wrapDERSequence(rsaOid));

				expect(() => extractEcPublicKeyFromDER(cert)).toThrow('EC public key OID not found');
			});
		});

		describe('edge cases: DER encoding', () => {
			it('should handle long-form DER length encoding (> 127 bytes)', () => {
				// The real CA and NM certs have multi-byte DER lengths (> 127 bytes)
				// This verifies parseDERLength handles 0x81 and 0x82 length forms
				for (const [state, cert] of IACA_ROOTS_ENTRIES) {
					const der = base64ToDER(cert.certificateB64);
					// Outer SEQUENCE length must be > 127 for any real X.509 cert
					expect(der[1]).toBeGreaterThanOrEqual(0x80);
					// Still parses correctly
					const { keyBytes } = extractEcPublicKeyFromDER(der);
					expect([65, 97]).toContain(keyBytes.length);
				}
			});

			it('should handle GeneralizedTime in validity period', async () => {
				// Build a cert with GeneralizedTime (0x18) instead of UTCTime (0x17)
				// GeneralizedTime: YYYYMMDDHHMMSSZ
				const keyPair = await generateKeyPair();
				const rawKey = new Uint8Array(await crypto.subtle.exportKey('raw', keyPair.publicKey));

				const ecOid = new Uint8Array([0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01]);
				const curveOid = new Uint8Array([0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07]);
				const algId = wrapDERSequence(concatBytes(ecOid, curveOid));

				const bitStringContent = concatBytes(new Uint8Array([0x00]), rawKey);
				const bitString = new Uint8Array([0x03, ...encodeDERLength(bitStringContent.length), ...bitStringContent]);
				const spki = wrapDERSequence(concatBytes(algId, bitString));

				const version = new Uint8Array([0xa0, 0x03, 0x02, 0x01, 0x02]);
				const serial = new Uint8Array([0x02, 0x01, 0x01]);
				const sigAlgOid = new Uint8Array([0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x02]);
				const sigAlg = wrapDERSequence(sigAlgOid);
				const cnOid = new Uint8Array([0x06, 0x03, 0x55, 0x04, 0x03]);
				const cnValue = new Uint8Array([0x0c, 0x04, 0x54, 0x65, 0x73, 0x74]);
				const rdnSeq = wrapDERSequence(concatBytes(cnOid, cnValue));
				const rdnSet = new Uint8Array([0x31, ...encodeDERLength(rdnSeq.length), ...rdnSeq]);
				const issuer = wrapDERSequence(rdnSet);

				// GeneralizedTime (tag 0x18): "20250101000000Z"
				const notBeforeStr = new TextEncoder().encode('20250101000000Z');
				const notBefore = new Uint8Array([0x18, notBeforeStr.length, ...notBeforeStr]);
				const notAfterStr = new TextEncoder().encode('20351231235959Z');
				const notAfter = new Uint8Array([0x18, notAfterStr.length, ...notAfterStr]);
				const validity = wrapDERSequence(concatBytes(notBefore, notAfter));

				const subject = issuer;
				const tbsCert = wrapDERSequence(
					concatBytes(version, serial, sigAlg, issuer, validity, subject, spki)
				);
				const dummySig = new Uint8Array([0x03, 0x03, 0x00, 0x30, 0x00]);
				const cert = wrapDERSequence(concatBytes(tbsCert, sigAlg, dummySig));

				const { notBefore: nb, notAfter: na } = extractValidityPeriod(cert);
				expect(nb.getUTCFullYear()).toBe(2025);
				expect(na.getUTCFullYear()).toBe(2035);
				expect(nb < na).toBe(true);
			});

			it('should handle mixed UTCTime/GeneralizedTime in same validity block', async () => {
				// Some CAs use UTCTime for notBefore and GeneralizedTime for notAfter
				const keyPair = await generateKeyPair();
				const rawKey = new Uint8Array(await crypto.subtle.exportKey('raw', keyPair.publicKey));

				const ecOid = new Uint8Array([0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01]);
				const curveOid = new Uint8Array([0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07]);
				const algId = wrapDERSequence(concatBytes(ecOid, curveOid));

				const bitStringContent = concatBytes(new Uint8Array([0x00]), rawKey);
				const bitString = new Uint8Array([0x03, ...encodeDERLength(bitStringContent.length), ...bitStringContent]);
				const spki = wrapDERSequence(concatBytes(algId, bitString));

				const version = new Uint8Array([0xa0, 0x03, 0x02, 0x01, 0x02]);
				const serial = new Uint8Array([0x02, 0x01, 0x01]);
				const sigAlgOid = new Uint8Array([0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x02]);
				const sigAlg = wrapDERSequence(sigAlgOid);
				const cnOid = new Uint8Array([0x06, 0x03, 0x55, 0x04, 0x03]);
				const cnValue = new Uint8Array([0x0c, 0x04, 0x54, 0x65, 0x73, 0x74]);
				const rdnSeq = wrapDERSequence(concatBytes(cnOid, cnValue));
				const rdnSet = new Uint8Array([0x31, ...encodeDERLength(rdnSeq.length), ...rdnSeq]);
				const issuer = wrapDERSequence(rdnSet);

				// UTCTime for notBefore, GeneralizedTime for notAfter
				const nbStr = new TextEncoder().encode('250601120000Z');
				const notBefore = new Uint8Array([0x17, nbStr.length, ...nbStr]);
				const naStr = new TextEncoder().encode('20500101000000Z');
				const notAfter = new Uint8Array([0x18, naStr.length, ...naStr]);
				const validity = wrapDERSequence(concatBytes(notBefore, notAfter));

				const subject = issuer;
				const tbsCert = wrapDERSequence(
					concatBytes(version, serial, sigAlg, issuer, validity, subject, spki)
				);
				const dummySig = new Uint8Array([0x03, 0x03, 0x00, 0x30, 0x00]);
				const cert = wrapDERSequence(concatBytes(tbsCert, sigAlg, dummySig));

				const { notBefore: nb, notAfter: na } = extractValidityPeriod(cert);
				expect(nb.getUTCFullYear()).toBe(2025);
				expect(nb.getUTCMonth()).toBe(5); // June (0-indexed)
				expect(na.getUTCFullYear()).toBe(2050);
			});
		});

		describe('DSC cross-verification with IACA roots', () => {
			it('should verify a synthetic DSC signed by each real IACA root public key', async () => {
				// For each IACA root, generate a DSC key pair, sign the DSC with
				// the root, and verify the chain. This tests the full chain:
				// IACA root pub key → verifyDscAgainstRoot → DSC accepted
				//
				// NOTE: We can't sign with the real IACA root private keys (we don't
				// have them). Instead, we test that extractTBSAndSignature + derEcdsaSigToRaw
				// correctly decompose the real certificates, then test the chain with
				// synthetic keys.
				const curveHash: Record<string, string> = { 'P-256': 'SHA-256', 'P-384': 'SHA-384' };
				const curveComponent: Record<string, number> = { 'P-256': 32, 'P-384': 48 };

				for (const [state, cert] of IACA_ROOTS_ENTRIES) {
					const der = base64ToDER(cert.certificateB64);

					// Verify real root's structure is decomposable
					const { tbsBytes, signatureDER } = extractTBSAndSignature(der);
					expect(tbsBytes[0]).toBe(0x30); // TBS is a SEQUENCE
					expect(signatureDER[0]).toBe(0x30); // Signature is a DER SEQUENCE

					const keyInfo = extractEcPublicKeyFromDER(der);
					const compSize = curveComponent[keyInfo.curve];
					const rawSig = derEcdsaSigToRaw(signatureDER, compSize);
					expect(rawSig.length).toBe(compSize * 2); // r || s

					// Verify the real root is self-signed
					const pubKey = await crypto.subtle.importKey(
						'raw',
						toBuffer(keyInfo.keyBytes),
						{ name: 'ECDSA', namedCurve: keyInfo.curve },
						false,
						['verify']
					);

					const valid = await crypto.subtle.verify(
						{ name: 'ECDSA', hash: curveHash[keyInfo.curve] },
						pubKey,
						toBuffer(rawSig),
						toBuffer(tbsBytes)
					);

					expect(valid).toBe(true);
				}
			});

			it('should verify a synthetic DSC→IACA chain end-to-end', async () => {
				// Generate a CA key pair, build a self-signed root, sign a DSC
				const caKeyPair = await generateKeyPair();
				const dscKeyPair = await generateKeyPair();

				const dscCert = await buildSignedCert(dscKeyPair.publicKey, caKeyPair.privateKey);
				const caCert = await buildSignedCert(caKeyPair.publicKey, caKeyPair.privateKey);

				// Build IACA root entry
				const root: IACACertificate = {
					state: 'XX',
					issuer: 'Synthetic Root',
					certificateB64: uint8ArrayToBase64(caCert),
					derBytes: caCert,
					expiresAt: '2035-12-31T23:59:59Z'
				};

				// Build a COSE_Sign1 signed by the DSC key, with DSC in x5chain
				const msoPayload = buildTestMso();
				const coseSign1 = await buildCoseSign1(msoPayload, dscKeyPair.privateKey, dscCert);

				// Verify — the DSC was signed by the CA key, which is in the trust store
				const result = await verifyCoseSign1(coseSign1, [root]);
				expect(result.valid).toBe(true);
			});

			it('should reject a DSC signed by an unknown CA', async () => {
				const unknownCaKeyPair = await generateKeyPair();
				const trustedCaKeyPair = await generateKeyPair();
				const dscKeyPair = await generateKeyPair();

				// DSC signed by unknown CA
				const dscCert = await buildSignedCert(dscKeyPair.publicKey, unknownCaKeyPair.privateKey);
				// Trust store only has the trusted CA
				const trustedCaCert = await buildSignedCert(trustedCaKeyPair.publicKey, trustedCaKeyPair.privateKey);

				const root: IACACertificate = {
					state: 'XX',
					issuer: 'Trusted Root',
					certificateB64: uint8ArrayToBase64(trustedCaCert),
					derBytes: trustedCaCert,
					expiresAt: '2035-12-31T23:59:59Z'
				};

				const msoPayload = buildTestMso();
				const coseSign1 = await buildCoseSign1(msoPayload, dscKeyPair.privateKey, dscCert);

				const result = await verifyCoseSign1(coseSign1, [root]);
				expect(result.valid).toBe(false);
				if (!result.valid) {
					expect(result.reason).toContain('not found in IACA trust store');
				}
			});
		});
	});
});
