/**
 * Tests for OpenID4VP response processing in mdl-verification.ts
 *
 * Tests encrypted DC API mso_mdoc VP token parsing and address field
 * extraction logic without hitting external APIs.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { encode, Tagged } from 'cbor-web';
import { CompactEncrypt, importJWK } from 'jose';

// Mock Shadow Atlas client BEFORE importing mdl-verification (it uses dynamic import)
const { mockResolveAddress } = vi.hoisted(() => ({
	mockResolveAddress: vi.fn()
}));

vi.mock('$lib/core/shadow-atlas/client', () => ({
	resolveAddress: (...args: unknown[]) => mockResolveAddress(...args)
}));

// We test processCredentialResponse which dispatches to processOid4vpResponse
// Since processOid4vpResponse is internal, we test through the public API
import { processCredentialResponse } from '$lib/core/identity/mdl-verification';
import { IACA_ROOTS } from '$lib/core/identity/iaca-roots';
import { buildOpenId4VpDcApiSessionTranscript } from '$lib/core/identity/oid4vp-dc-api-handover';

beforeAll(() => {
	// Identity commitment computation requires IDENTITY_COMMITMENT_SALT
	process.env.IDENTITY_COMMITMENT_SALT = 'test-salt-for-unit-tests';
});

beforeEach(() => {
	vi.clearAllMocks();
	mockResolveAddress.mockReset();
});

// Helper: encode a string as base64url (no padding)
function base64urlEncode(str: string): string {
	return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function buildJwtWithHeader(
	payload: Record<string, unknown>,
	header: Record<string, unknown>,
	options?: { sign?: boolean }
): Promise<string> {
	const encodedHeader = base64urlEncode(JSON.stringify(header));
	const body = base64urlEncode(JSON.stringify(payload));
	const signature =
		options?.sign === false
			? base64urlEncode('mock-signature')
			: base64urlEncodeBytes(
					new Uint8Array(
						await crypto.subtle.sign(
							{ name: 'ECDSA', hash: 'SHA-256' },
							jwtSigningKeyPair.privateKey,
							new TextEncoder().encode(`${encodedHeader}.${body}`)
						)
					)
				);
	return `${encodedHeader}.${body}.${signature}`;
}

// Helper: build a signed JWT from payload claims using a trusted synthetic x5c certificate.
function buildJwt(payload: Record<string, unknown>): Promise<string> {
	return buildJwtWithHeader(payload, {
		alg: 'ES256',
		typ: 'JWT',
		x5c: [jwtTestCertB64]
	});
}

function base64urlEncodeBytes(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function calculateTestJwkThumbprint(publicJwk: JsonWebKey): Promise<Uint8Array> {
	const canonical = JSON.stringify({
		crv: publicJwk.crv,
		kty: publicJwk.kty,
		x: publicJwk.x,
		y: publicJwk.y
	});
	return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical)));
}

async function encryptDcApiJwt(payload: unknown, publicJwk: JsonWebKey): Promise<string> {
	const encryptionKey = await importJWK(
		{
			kty: publicJwk.kty,
			crv: publicJwk.crv,
			x: publicJwk.x,
			y: publicJwk.y,
			use: 'enc',
			kid: '1',
			alg: 'ECDH-ES'
		},
		'ECDH-ES'
	);
	const payloadBytes = new Uint8Array(new TextEncoder().encode(JSON.stringify(payload)));
	return new CompactEncrypt(payloadBytes)
		.setProtectedHeader({ alg: 'ECDH-ES', enc: 'A256GCM', kid: '1' })
		.encrypt(encryptionKey);
}

async function processSignedDcApiPayload(
	payload: unknown,
	nonce: string,
	options: { verifierOrigin?: string; dcApiJwkThumbprint?: Uint8Array | ArrayBuffer | null } = {}
) {
	const encryptedResponse = await encryptDcApiJwt(payload, ephemeralPublicJwk);
	return processCredentialResponse(
		JSON.stringify({ response: encryptedResponse }),
		'openid4vp-v1-signed',
		ephemeralKey,
		nonce,
		{
			verifierOrigin: options.verifierOrigin,
			dcApiJwkThumbprint: options.dcApiJwkThumbprint ?? ephemeralJwkThumbprint
		}
	);
}

async function processSignedMsoMdocResponse(
	deviceResponse: string,
	nonce: string,
	origin?: string
) {
	return processSignedDcApiPayload(
		{ vp_token: { mdl: [deviceResponse] } },
		nonce,
		{ verifierOrigin: origin }
	);
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary);
}

async function buildMinimalCert(publicKey: CryptoKey): Promise<Uint8Array> {
	const rawKey = new Uint8Array(await crypto.subtle.exportKey('raw', publicKey));
	const ecOid = new Uint8Array([0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01]);
	const curveOid = new Uint8Array([
		0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07
	]);
	const algId = wrapDERSequence(concatBytes(ecOid, curveOid));
	const bitStringContent = concatBytes(new Uint8Array([0x00]), rawKey);
	const bitString = new Uint8Array([
		0x03,
		...encodeDERLength(bitStringContent.length),
		...bitStringContent
	]);
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
	const notBefore = new Uint8Array([0x17, 0x0d, ...new TextEncoder().encode('250101000000Z')]);
	const notAfter = new Uint8Array([0x17, 0x0d, ...new TextEncoder().encode('351231235959Z')]);
	const validity = wrapDERSequence(concatBytes(notBefore, notAfter));
	const tbsCert = wrapDERSequence(
		concatBytes(version, serial, sigAlg, issuer, validity, issuer, spki)
	);
	const dummySig = new Uint8Array([0x03, 0x03, 0x00, 0x30, 0x00]);
	return wrapDERSequence(concatBytes(tbsCert, sigAlg, dummySig));
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
	const totalLength = arrays.reduce((sum, array) => sum + array.length, 0);
	const result = new Uint8Array(totalLength);
	let offset = 0;
	for (const array of arrays) {
		result.set(array, offset);
		offset += array.length;
	}
	return result;
}

function encodeDERLength(len: number): Uint8Array {
	if (len < 0x80) return new Uint8Array([len]);
	if (len < 0x100) return new Uint8Array([0x81, len]);
	return new Uint8Array([0x82, (len >> 8) & 0xff, len & 0xff]);
}

function wrapDERSequence(content: Uint8Array): Uint8Array {
	return new Uint8Array([0x30, ...encodeDERLength(content.length), ...content]);
}

const MDL_DOCTYPE = 'org.iso.18013.5.1.mDL';
const MDL_NAMESPACE = 'org.iso.18013.5.1';

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	return new Uint8Array(bytes).buffer;
}

async function generateEcdsaKeyPair(): Promise<CryptoKeyPair> {
	return crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
		'sign',
		'verify'
	]);
}

async function publicKeyToCoseEc2Key(publicKey: CryptoKey): Promise<Map<number, unknown>> {
	const raw = new Uint8Array(await crypto.subtle.exportKey('raw', publicKey));
	return new Map<number, unknown>([
		[1, 2], // kty: EC2
		[3, -7], // alg: ES256
		[-1, 1], // crv: P-256
		[-2, toArrayBuffer(raw.slice(1, 33))],
		[-3, toArrayBuffer(raw.slice(33, 65))]
	]);
}

async function buildIssuerSignedNameSpaces(fields: Record<string, string>): Promise<{
	nameSpaces: Map<string, unknown[]>;
	valueDigests: Map<string, Map<number, unknown>>;
}> {
	const elements: unknown[] = [];
	const digests = new Map<number, unknown>();
	let digestID = 0;

	for (const [elementIdentifier, elementValue] of Object.entries(fields)) {
		const item = {
			digestID,
			random: toArrayBuffer(new Uint8Array([digestID, 1, 2, 3])),
			elementIdentifier,
			elementValue
		};
		const itemBytes = new Uint8Array(encode(item));
		const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', itemBytes));
		digests.set(digestID, toArrayBuffer(digest));
		elements.push(new Tagged(24, toArrayBuffer(itemBytes)));
		digestID++;
	}

	return {
		nameSpaces: new Map([[MDL_NAMESPACE, elements]]),
		valueDigests: new Map([[MDL_NAMESPACE, digests]])
	};
}

function buildTestMso(
	namespaceDigests: Map<string, Map<number, unknown>>,
	deviceKey: Map<number, unknown>,
	options: {
		docType?: string;
		validFrom?: string;
		validUntil?: string;
	} = {}
): Uint8Array {
	return new Uint8Array(
		encode({
			version: '1.0',
			digestAlgorithm: 'SHA-256',
			docType: options.docType ?? MDL_DOCTYPE,
			valueDigests: namespaceDigests,
			deviceKeyInfo: new Map<string, unknown>([['deviceKey', deviceKey]]),
			validityInfo: {
				signed: '2026-01-01T00:00:00Z',
				validFrom: options.validFrom ?? '2026-01-01T00:00:00Z',
				validUntil: options.validUntil ?? '2027-01-01T00:00:00Z'
			}
		})
	);
}

async function buildCoseSign1(
	payload: Uint8Array,
	privateKey: CryptoKey,
	certDER: Uint8Array
): Promise<unknown[]> {
	const protectedHeadersCBOR = new Uint8Array(encode(new Map<number, number>([[1, -7]])));
	const sigStructure = encodeMdocTestCbor([
		'Signature1',
		protectedHeadersCBOR,
		new Uint8Array(0),
		payload
	]);
	const rawSignature = new Uint8Array(
		await crypto.subtle.sign(
			{ name: 'ECDSA', hash: 'SHA-256' },
			privateKey,
			sigStructure as BufferSource
		)
	);

	return [
		toArrayBuffer(protectedHeadersCBOR),
		new Map<number, unknown>([[33, toArrayBuffer(certDER)]]),
		toArrayBuffer(payload),
		toArrayBuffer(rawSignature)
	];
}

async function buildDeviceSignature(
	deviceAuthenticationBytes: Uint8Array,
	privateKey: CryptoKey
): Promise<unknown[]> {
	const protectedHeadersCBOR = new Uint8Array(encode(new Map<number, number>([[1, -7]])));
	const sigStructure = encodeMdocTestCbor([
		'Signature1',
		protectedHeadersCBOR,
		new Uint8Array(0),
		deviceAuthenticationBytes
	]);
	const rawSignature = new Uint8Array(
		await crypto.subtle.sign(
			{ name: 'ECDSA', hash: 'SHA-256' },
			privateKey,
			sigStructure as BufferSource
		)
	);

	return [
		toArrayBuffer(protectedHeadersCBOR),
		new Map<number, unknown>(),
		null,
		toArrayBuffer(rawSignature)
	];
}

async function buildDeviceAuthenticationBytes({
	origin,
	nonce,
	jwkThumbprint = ephemeralJwkThumbprint,
	docType,
	deviceNameSpacesBytes
}: {
	origin?: string;
	nonce: string;
	jwkThumbprint?: Uint8Array | ArrayBuffer;
	docType: string;
	deviceNameSpacesBytes: Uint8Array;
}): Promise<Uint8Array> {
	const { sessionTranscript } = await buildOpenId4VpDcApiSessionTranscript({
		origin: origin ?? '',
		nonce,
		jwkThumbprint
	});
	const deviceAuthentication = [
		'DeviceAuthentication',
		sessionTranscript,
		docType,
		taggedCborBytesForTest(24, deviceNameSpacesBytes)
	] as const;

	return encodeMdocTestCbor(
		taggedCborBytesForTest(24, encodeMdocTestCbor(deviceAuthentication))
	);
}

async function buildOpenId4VpMsoMdocResponse(
	fields: Record<string, string>,
	options: {
		origin: string;
		nonce: string;
		signingOrigin?: string;
		signingNonce?: string;
		signingJwkThumbprint?: Uint8Array | ArrayBuffer | null;
		msoDocType?: string;
		msoValidFrom?: string;
		msoValidUntil?: string;
		unsignedIssuerFields?: Record<string, string>;
		signedDuplicateIssuerFields?: Record<string, string>;
		useDeviceMac?: boolean;
	}
): Promise<string> {
	const deviceKeyPair = await generateEcdsaKeyPair();
	const deviceKey = await publicKeyToCoseEc2Key(deviceKeyPair.publicKey);
	const { nameSpaces, valueDigests } = await buildIssuerSignedNameSpaces(fields);
	const mdlElements = nameSpaces.get(MDL_NAMESPACE);
	const mdlDigests = valueDigests.get(MDL_NAMESPACE);
	if (!mdlElements || !mdlDigests) throw new Error('mDL namespace fixture missing');
	if (options.signedDuplicateIssuerFields) {
		let digestID = mdlDigests.size;
		for (const [elementIdentifier, elementValue] of Object.entries(
			options.signedDuplicateIssuerFields
		)) {
			const item = {
				digestID,
				random: toArrayBuffer(new Uint8Array([digestID, 9, 8, 7])),
				elementIdentifier,
				elementValue
			};
			const itemBytes = new Uint8Array(encode(item));
			const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', itemBytes));
			mdlDigests.set(digestID, toArrayBuffer(digest));
			mdlElements.push(new Tagged(24, toArrayBuffer(itemBytes)));
			digestID++;
		}
	}
	if (options.unsignedIssuerFields) {
		for (const [elementIdentifier, elementValue] of Object.entries(options.unsignedIssuerFields)) {
			const unsignedItem = {
				random: toArrayBuffer(new Uint8Array([0xff, 0x00])),
				elementIdentifier,
				elementValue
			};
			mdlElements.push(new Tagged(24, toArrayBuffer(new Uint8Array(encode(unsignedItem)))));
		}
	}
	const msoPayload = buildTestMso(valueDigests, deviceKey, {
		docType: options.msoDocType,
		validFrom: options.msoValidFrom,
		validUntil: options.msoValidUntil
	});
	const issuerAuth = await buildCoseSign1(
		msoPayload,
		jwtSigningKeyPair.privateKey,
		jwtTestCertDer
	);
	const deviceNameSpacesBytes = new Uint8Array(encode(new Map()));
	const deviceAuthenticationBytes = await buildDeviceAuthenticationBytes({
		origin: options.signingOrigin ?? options.origin,
		nonce: options.signingNonce ?? options.nonce,
		jwkThumbprint: options.signingJwkThumbprint ?? ephemeralJwkThumbprint,
		docType: MDL_DOCTYPE,
		deviceNameSpacesBytes
	});
	const deviceSignature = await buildDeviceSignature(
		deviceAuthenticationBytes,
		deviceKeyPair.privateKey
	);
	const deviceAuth = options.useDeviceMac
		? { deviceMac: toArrayBuffer(new Uint8Array([1, 2, 3, 4])) }
		: { deviceSignature: new Tagged(18, deviceSignature) };

	const deviceResponse = {
		version: '1.0',
		documents: [
			{
				docType: MDL_DOCTYPE,
				issuerSigned: {
					nameSpaces,
					issuerAuth: new Tagged(18, issuerAuth)
				},
				deviceSigned: {
					nameSpaces: new Tagged(24, toArrayBuffer(deviceNameSpacesBytes)),
					deviceAuth
				}
			}
		]
	};

	return base64urlEncodeBytes(new Uint8Array(encode(deviceResponse)));
}

interface TaggedCborBytesForTest {
	readonly type: 'tagged-cbor-bytes';
	readonly tag: number;
	readonly bytes: Uint8Array;
}

function taggedCborBytesForTest(tag: number, bytes: Uint8Array): TaggedCborBytesForTest {
	return { type: 'tagged-cbor-bytes', tag, bytes: new Uint8Array(bytes) };
}

type MdocTestCborValue =
	| string
	| Uint8Array
	| null
	| TaggedCborBytesForTest
	| readonly MdocTestCborValue[];

function encodeMdocTestCbor(value: MdocTestCborValue): Uint8Array {
	if (typeof value === 'string') {
		return encodeCborBytesForMdocTest(3, new TextEncoder().encode(value));
	}
	if (value instanceof Uint8Array) {
		return encodeCborBytesForMdocTest(2, value);
	}
	if (value === null) {
		return new Uint8Array([0xf6]);
	}
	if (isTaggedCborBytesForTest(value)) {
		return concatBytes(
			encodeCborHeadForMdocTest(6, value.tag),
			encodeCborBytesForMdocTest(2, value.bytes)
		);
	}
	if (Array.isArray(value)) {
		return concatBytes(
			encodeCborHeadForMdocTest(4, value.length),
			...value.map(encodeMdocTestCbor)
		);
	}
	throw new Error('Unsupported test CBOR value');
}

function isTaggedCborBytesForTest(value: unknown): value is TaggedCborBytesForTest {
	return (
		typeof value === 'object' &&
		value !== null &&
		!Array.isArray(value) &&
		(value as { type?: unknown }).type === 'tagged-cbor-bytes' &&
		(value as { bytes?: unknown }).bytes instanceof Uint8Array
	);
}

function encodeCborBytesForMdocTest(majorType: number, bytes: Uint8Array): Uint8Array {
	return concatBytes(encodeCborHeadForMdocTest(majorType, bytes.length), bytes);
}

function encodeCborHeadForMdocTest(majorType: number, length: number): Uint8Array {
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

/** Mock a successful Shadow Atlas resolveAddress() returning a district + cell_id */
function mockShadowAtlasSuccess(state: string, cd: string) {
	const districtCode = `${state.toUpperCase()}-${cd.padStart(2, '0')}`;
	mockResolveAddress.mockResolvedValueOnce({
		geocode: { lat: 34.0522, lng: -118.2437, matched_address: 'MATCHED ADDRESS', confidence: 0.95, country: 'US' },
		district: { id: districtCode, name: `District ${districtCode}`, jurisdiction: 'congressional', district_type: 'congressional' },
		officials: { district_code: districtCode, state: state.toUpperCase(), officials: [], special_status: null, source: 'congress-legislators', cached: true },
		cell_id: '872830828ffffff',
		vintage: 'shadow-atlas-nominatim'
	});
}

// Ephemeral key (unused by OpenID4VP path but required by function signature)
let ephemeralKey: CryptoKey;
let ephemeralPublicJwk: JsonWebKey;
let ephemeralJwkThumbprint: Uint8Array;
let jwtSigningKeyPair: CryptoKeyPair;
let jwtTestCertB64 = '';
let jwtTestCertDer: Uint8Array;

beforeAll(async () => {
	const keyPair = await crypto.subtle.generateKey(
		{ name: 'ECDH', namedCurve: 'P-256' },
		true,
		['deriveKey', 'deriveBits']
	);
	ephemeralKey = keyPair.privateKey;
	ephemeralPublicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
	ephemeralJwkThumbprint = await calculateTestJwkThumbprint(ephemeralPublicJwk);

	jwtSigningKeyPair = await crypto.subtle.generateKey(
		{ name: 'ECDSA', namedCurve: 'P-256' },
		true,
		['sign', 'verify']
	);
	const certDer = await buildMinimalCert(jwtSigningKeyPair.publicKey);
	jwtTestCertDer = certDer;
	jwtTestCertB64 = uint8ArrayToBase64(certDer);
	IACA_ROOTS.UNIT = [
		{
			state: 'UNIT',
			issuer: 'Unit Test IACA',
			certificateB64: jwtTestCertB64,
			derBytes: certDer,
			expiresAt: '2035-12-31T23:59:59Z'
		}
	];
});

describe('OpenID4VP response processing', () => {
	it('should reject JWT vp_tokens for the versioned DC API mso_mdoc protocol', async () => {
		const nonce = 'test-nonce-123';
		const jwt = await buildJwt({
			nonce,
			resident_postal_code: '94110',
			resident_city: 'San Francisco',
			resident_state: 'CA',
			document_number: 'D1234567',
			birth_date: '1990-01-15'
		});

		const result = await processSignedDcApiPayload(
			{ vp_token: jwt },
			nonce,
			{ verifierOrigin: 'https://verifier.example' }
		);

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toBe('invalid_format');
			expect(result.message).toContain('vp_token strings are not accepted');
		}
		expect(mockResolveAddress).not.toHaveBeenCalled();
	});

	it('should reject a versioned DigitalCredential data envelope containing a JWT vp_token', async () => {
		const nonce = 'test-nonce-digital-credential-envelope';
		const jwt = await buildJwt({
			nonce,
			resident_postal_code: '02139',
			resident_city: 'Cambridge',
			resident_state: 'MA',
			document_number: 'D4444444',
			birth_date: '1984-10-12'
		});

		const result = await processCredentialResponse(
			JSON.stringify({
				protocol: 'openid4vp-v1-signed',
				data: { vp_token: jwt }
			}),
			'openid4vp-v1-signed',
			ephemeralKey,
			nonce
		);

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toBe('invalid_format');
			expect(result.message).toContain('vp_token strings are not accepted');
		}
		expect(mockResolveAddress).not.toHaveBeenCalled();
	});

	it('should reject data envelopes that omit protocol binding', async () => {
		const nonce = 'test-nonce-envelope-no-protocol';
		const jwt = await buildJwt({
			nonce,
			resident_postal_code: '94110',
			resident_state: 'CA',
			document_number: 'D5555555',
			birth_date: '1991-02-28'
		});

		const result = await processCredentialResponse(
			JSON.stringify({ data: { vp_token: jwt } }),
			'openid4vp-v1-signed',
			ephemeralKey,
			nonce
		);

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toBe('invalid_format');
			expect(result.message).toContain('missing protocol');
		}
		expect(mockResolveAddress).not.toHaveBeenCalled();
	});

	it('should reject malformed encrypted dc_api.jwt OpenID4VP responses', async () => {
		const result = await processCredentialResponse(
			JSON.stringify({ response: 'jwe-header.encrypted-key.iv.ciphertext.tag' }),
			'openid4vp-v1-signed',
			ephemeralKey,
			'test-nonce-encrypted-response'
		);

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toBe('decryption_failed');
			expect(result.message).toContain('Failed to decrypt');
		}
		expect(mockResolveAddress).not.toHaveBeenCalled();
	});

	it('should fail closed on empty encrypted response markers', async () => {
		const result = await processCredentialResponse(
			JSON.stringify({ response: '' }),
			'openid4vp-v1-signed',
			ephemeralKey,
			'test-nonce-empty-encrypted-response'
		);

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toBe('decryption_failed');
		}
		expect(mockResolveAddress).not.toHaveBeenCalled();
	});

	it('should reject encrypted response envelopes that also contain nested VP data', async () => {
		const nonce = 'test-nonce-mixed-envelope';
		const jwt = await buildJwt({
			nonce,
			resident_postal_code: '94110',
			resident_state: 'CA',
			document_number: 'D5555555',
			birth_date: '1991-02-28'
		});

		const result = await processCredentialResponse(
			JSON.stringify({
				response: 'jwe-header.encrypted-key.iv.ciphertext.tag',
				data: { vp_token: jwt }
			}),
			'openid4vp-v1-signed',
			ephemeralKey,
			nonce
		);

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toBe('invalid_format');
			expect(result.message).toContain('ambiguous');
		}
		expect(mockResolveAddress).not.toHaveBeenCalled();
	});

	it('should reject encrypted response envelopes with a mismatched top-level protocol', async () => {
		const result = await processCredentialResponse(
			JSON.stringify({
				protocol: 'org-iso-mdoc',
				response: 'jwe-header.encrypted-key.iv.ciphertext.tag'
			}),
			'openid4vp-v1-signed',
			ephemeralKey,
			'test-nonce-encrypted-protocol-mismatch'
		);

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toBe('invalid_format');
			expect(result.message).toContain('protocol mismatch');
		}
		expect(mockResolveAddress).not.toHaveBeenCalled();
	});

	it('should reject ambiguous envelopes that contain both vp_token and nested data', async () => {
		const nonce = 'test-nonce-ambiguous-envelope';
		const jwt = await buildJwt({
			nonce,
			resident_postal_code: '94110',
			resident_state: 'CA',
			document_number: 'D5555555',
			birth_date: '1991-02-28'
		});

		const result = await processCredentialResponse(
			JSON.stringify({
				protocol: 'openid4vp-v1-signed',
				vp_token: 'jwe-header.encrypted-key.iv.ciphertext.tag',
				data: { vp_token: jwt }
			}),
			'openid4vp-v1-signed',
			ephemeralKey,
			nonce
		);

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toBe('invalid_format');
			expect(result.message).toContain('ambiguous');
		}
		expect(mockResolveAddress).not.toHaveBeenCalled();
	});

	it('should fail closed on nested encrypted dc_api.jwt response envelopes', async () => {
		const result = await processCredentialResponse(
			JSON.stringify({
				protocol: 'openid4vp-v1-signed',
				data: { response: 'jwe-header.encrypted-key.iv.ciphertext.tag' }
			}),
			'openid4vp-v1-signed',
			ephemeralKey,
			'test-nonce-nested-encrypted-response'
		);

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toBe('decryption_failed');
		}
		expect(mockResolveAddress).not.toHaveBeenCalled();
	});

	it('should reject data envelopes nested beyond the parser depth cap', async () => {
		const nonce = 'test-nonce-depth-cap';
		const jwt = await buildJwt({
			nonce,
			resident_postal_code: '94110',
			resident_state: 'CA',
			document_number: 'D5555555',
			birth_date: '1991-02-28'
		});

		const result = await processCredentialResponse(
			JSON.stringify({
				protocol: 'openid4vp-v1-signed',
				data: {
					protocol: 'openid4vp-v1-signed',
					data: {
						protocol: 'openid4vp-v1-signed',
						data: {
							protocol: 'openid4vp-v1-signed',
							data: { vp_token: jwt }
						}
					}
				}
			}),
			'openid4vp-v1-signed',
			ephemeralKey,
			nonce
		);

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toBe('invalid_format');
			expect(result.message).toContain('nested too deeply');
		}
		expect(mockResolveAddress).not.toHaveBeenCalled();
	});

	it('should fail closed on compact JWE supplied as a vp_token string', async () => {
		const result = await processCredentialResponse(
			JSON.stringify({ vp_token: 'jwe-header.encrypted-key.iv.ciphertext.tag' }),
			'openid4vp-v1-signed',
			ephemeralKey,
			'test-nonce-vp-token-jwe'
		);

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toBe('invalid_format');
			expect(result.message).toContain('vp_token strings are not accepted');
		}
		expect(mockResolveAddress).not.toHaveBeenCalled();
	});

	it('should fail closed on raw compact JWE strings outside the dc_api envelope', async () => {
		const result = await processCredentialResponse(
			'jwe-header.encrypted-key.iv.ciphertext.tag',
			'openid4vp-v1-signed',
			ephemeralKey,
			'test-nonce-raw-jwe'
		);

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toBe('invalid_format');
			expect(result.message).toContain('dc_api response envelope');
		}
		expect(mockResolveAddress).not.toHaveBeenCalled();
	});

	it('should fail closed on identityToken encrypted response envelopes', async () => {
		const result = await processCredentialResponse(
			JSON.stringify({ identityToken: 'jwe-header.encrypted-key.iv.ciphertext.tag' }),
			'openid4vp-v1-signed',
			ephemeralKey,
			'test-nonce-identity-token'
		);

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toBe('invalid_format');
			expect(result.message).toContain('identityToken envelopes are not accepted');
		}
		expect(mockResolveAddress).not.toHaveBeenCalled();
	});

	it('should reject encrypted dc_api.jwt responses with unsupported JOSE headers', async () => {
		const unsupportedHeader = base64urlEncode(
			JSON.stringify({ alg: 'ECDH-ES', enc: 'A128GCM', kid: '1' })
		);
		const result = await processCredentialResponse(
			JSON.stringify({ response: `${unsupportedHeader}.encrypted-key.iv.ciphertext.tag` }),
			'openid4vp-v1-signed',
			ephemeralKey,
			'test-nonce-unsupported-jwe-header'
		);

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toBe('decryption_failed');
			expect(result.message).toContain('Unsupported');
		}
		expect(mockResolveAddress).not.toHaveBeenCalled();
	});

	it('should reject encrypted dc_api.jwt responses with a non-string JWK kid', async () => {
		const unsupportedHeader = base64urlEncode(
			JSON.stringify({ alg: 'ECDH-ES', enc: 'A256GCM', kid: 1 })
		);
		const result = await processCredentialResponse(
			JSON.stringify({ response: `${unsupportedHeader}.encrypted-key.iv.ciphertext.tag` }),
			'openid4vp-v1-signed',
			ephemeralKey,
			'test-nonce-unsupported-jwe-kid'
		);

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toBe('decryption_failed');
			expect(result.message).toContain('Unsupported');
		}
		expect(mockResolveAddress).not.toHaveBeenCalled();
	});

	it('should reject encrypted dc_api.jwt responses that omit the advertised JWK kid', async () => {
		const unsupportedHeader = base64urlEncode(JSON.stringify({ alg: 'ECDH-ES', enc: 'A256GCM' }));
		const result = await processCredentialResponse(
			JSON.stringify({ response: `${unsupportedHeader}.encrypted-key.iv.ciphertext.tag` }),
			'openid4vp-v1-signed',
			ephemeralKey,
			'test-nonce-missing-jwe-kid'
		);

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toBe('decryption_failed');
			expect(result.message).toContain('Unsupported');
		}
		expect(mockResolveAddress).not.toHaveBeenCalled();
	});

	it('should reject unencrypted vp_token payloads for the signed DC API protocol', async () => {
		const result = await processCredentialResponse(
			JSON.stringify({
				vp_token: {
					mdl: ['o2dkb2NzdoJvcmcuaXNvLjE4MDEzLjUuMS5tREw']
				}
			}),
			'openid4vp-v1-signed',
			ephemeralKey,
			'test-nonce-signed-plaintext-mso-mdoc',
			{ verifierOrigin: 'https://verifier.example', dcApiJwkThumbprint: ephemeralJwkThumbprint }
		);

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toBe('invalid_format');
			expect(result.message).toContain('must be encrypted');
		}
		expect(mockResolveAddress).not.toHaveBeenCalled();
	});

	it('should fail closed on mso_mdoc VP token arrays without the stored DC API origin', async () => {
		const result = await processSignedDcApiPayload(
			{ vp_token: { mdl: ['o2dkb2NzdoJvcmcuaXNvLjE4MDEzLjUuMS5tREw'] } },
			'test-nonce-mso-mdoc'
		);

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toBe('replay_protection_missing');
			expect(result.message).toContain('SessionTranscript');
			expect(result.message).toContain('DeviceAuth');
		}
		expect(mockResolveAddress).not.toHaveBeenCalled();
	});

	it('should reject mdoc-shaped VP token arrays under unexpected credential ids', async () => {
		const result = await processSignedDcApiPayload(
			{ vp_token: { cred1: ['o2dkb2NzdoJvcmcuaXNvLjE4MDEzLjUuMS5tREw'] } },
			'test-nonce-unexpected-credential-id',
			{ verifierOrigin: 'https://verifier.example' }
		);

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toBe('invalid_format');
			expect(result.message).toContain('does not contain an mso_mdoc');
			expect(result.message).not.toContain('DeviceAuth');
		}
		expect(mockResolveAddress).not.toHaveBeenCalled();
	});

	it('should fail closed on nested mso_mdoc VP token arrays without the stored DC API origin', async () => {
		const result = await processSignedDcApiPayload(
			{
				protocol: 'openid4vp-v1-signed',
				data: {
					vp_token: {
						mdl: ['o2dkb2NzdoJvcmcuaXNvLjE4MDEzLjUuMS5tREw']
					}
				}
			},
			'test-nonce-nested-mso-mdoc'
		);

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toBe('replay_protection_missing');
			expect(result.message).toContain('DeviceAuth');
		}
		expect(mockResolveAddress).not.toHaveBeenCalled();
	});

	it('should reject ambiguous mso_mdoc DeviceResponses with multiple documents', async () => {
		const nonce = 'test-nonce-mso-mdoc-multiple-documents';
		const origin = 'https://verifier.example';
		const deviceResponse = base64urlEncodeBytes(
			new Uint8Array(encode({ documents: [{}, {}] }))
		);

		const result = await processSignedMsoMdocResponse(deviceResponse, nonce, origin);

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toBe('invalid_format');
			expect(result.message).toContain('exactly one mDL document');
		}
		expect(mockResolveAddress).not.toHaveBeenCalled();
	});

	it('should verify mso_mdoc DeviceResponse through DC API DeviceAuth', async () => {
		const nonce = 'test-nonce-mso-mdoc-success';
		const origin = 'https://verifier.example';
		const deviceResponse = await buildOpenId4VpMsoMdocResponse(
			{
				resident_postal_code: '94110',
				resident_city: 'San Francisco',
				resident_state: 'CA',
				document_number: 'D7777777',
				birth_date: '1990-05-17'
			},
			{ origin, nonce }
		);

		mockShadowAtlasSuccess('ca', '12');

		const result = await processSignedMsoMdocResponse(deviceResponse, nonce, origin);

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.district).toBe('CA-12');
			expect(result.state).toBe('CA');
			expect(result.verificationMethod).toBe('mdl');
			expect(result.credentialHash).toMatch(/^[0-9a-f]{64}$/);
			expect(result.identityCommitment).toMatch(/^[0-9a-f]{64}$/);
			expect(result.cellId).toBe('872830828ffffff');
		}
	});

	it('should decrypt signed dc_api.jwt responses before verifying mso_mdoc DeviceAuth', async () => {
		const nonce = 'test-nonce-encrypted-mso-mdoc-success';
		const origin = 'https://verifier.example';
		const deviceResponse = await buildOpenId4VpMsoMdocResponse(
			{
				resident_postal_code: '94110',
				resident_city: 'San Francisco',
				resident_state: 'CA',
				document_number: 'D7777778',
				birth_date: '1990-05-17'
			},
			{ origin, nonce, signingJwkThumbprint: ephemeralJwkThumbprint }
		);
		const encryptedResponse = await encryptDcApiJwt(
			{ vp_token: { mdl: [deviceResponse] } },
			ephemeralPublicJwk
		);

		mockShadowAtlasSuccess('ca', '12');

		const result = await processCredentialResponse(
			JSON.stringify({ response: encryptedResponse }),
			'openid4vp-v1-signed',
			ephemeralKey,
			nonce,
			{ verifierOrigin: origin, dcApiJwkThumbprint: ephemeralJwkThumbprint }
		);

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.district).toBe('CA-12');
			expect(result.state).toBe('CA');
			expect(result.credentialHash).toMatch(/^[0-9a-f]{64}$/);
			expect(result.identityCommitment).toMatch(/^[0-9a-f]{64}$/);
		}
	});

	it('should reject signed encrypted mso_mdoc responses without the stored JWK thumbprint', async () => {
		const nonce = 'test-nonce-encrypted-mso-mdoc-missing-thumbprint';
		const origin = 'https://verifier.example';
		const deviceResponse = await buildOpenId4VpMsoMdocResponse(
			{
				resident_postal_code: '94110',
				resident_city: 'San Francisco',
				resident_state: 'CA',
				document_number: 'D7777779',
				birth_date: '1990-05-17'
			},
			{ origin, nonce, signingJwkThumbprint: ephemeralJwkThumbprint }
		);
		const encryptedResponse = await encryptDcApiJwt(
			{ vp_token: { mdl: [deviceResponse] } },
			ephemeralPublicJwk
		);

		const result = await processCredentialResponse(
			JSON.stringify({ response: encryptedResponse }),
			'openid4vp-v1-signed',
			ephemeralKey,
			nonce,
			{ verifierOrigin: origin }
		);

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toBe('invalid_format');
			expect(result.message).toContain('32-byte encryption JWK thumbprint');
		}
		expect(mockResolveAddress).not.toHaveBeenCalled();
	});

	it('should reject replayed mso_mdoc DeviceAuth signed for a different nonce', async () => {
		const nonce = 'test-nonce-mso-mdoc-replay';
		const origin = 'https://verifier.example';
		const deviceResponse = await buildOpenId4VpMsoMdocResponse(
			{
				resident_postal_code: '94110',
				resident_city: 'San Francisco',
				resident_state: 'CA',
				document_number: 'D8888888',
				birth_date: '1988-08-08'
			},
			{ origin, nonce, signingNonce: `${nonce}-captured` }
		);

		const result = await processSignedMsoMdocResponse(deviceResponse, nonce, origin);

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toBe('signature_invalid');
			expect(result.message).toContain('DeviceAuth.deviceSignature');
		}
		expect(mockResolveAddress).not.toHaveBeenCalled();
	});

	it('should reject unsigned issuer-signed item injection in mso_mdoc namespaces', async () => {
		const nonce = 'test-nonce-mso-mdoc-unsigned-field';
		const origin = 'https://verifier.example';
		const deviceResponse = await buildOpenId4VpMsoMdocResponse(
			{
				resident_postal_code: '94110',
				resident_city: 'San Francisco',
				resident_state: 'CA',
				document_number: 'D7777777',
				birth_date: '1990-05-17'
			},
			{
				origin,
				nonce,
				unsignedIssuerFields: {
					resident_state: 'NY',
					document_number: 'FORGED'
				}
			}
		);

		const result = await processSignedMsoMdocResponse(deviceResponse, nonce, origin);

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toBe('signature_invalid');
			expect(result.message).toContain('MSO digest validation failed');
		}
		expect(mockResolveAddress).not.toHaveBeenCalled();
	});

	it('should reject duplicate signed mDL element identifiers in mso_mdoc namespaces', async () => {
		const nonce = 'test-nonce-mso-mdoc-duplicate-signed-field';
		const origin = 'https://verifier.example';
		const deviceResponse = await buildOpenId4VpMsoMdocResponse(
			{
				resident_postal_code: '94110',
				resident_city: 'San Francisco',
				resident_state: 'CA',
				document_number: 'D7777777',
				birth_date: '1990-05-17'
			},
			{
				origin,
				nonce,
				signedDuplicateIssuerFields: {
					resident_state: 'NY'
				}
			}
		);

		const result = await processSignedMsoMdocResponse(deviceResponse, nonce, origin);

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toBe('signature_invalid');
			expect(result.message).toContain('Duplicate signed mDL element identifier');
		}
		expect(mockResolveAddress).not.toHaveBeenCalled();
	});

	it('should reject expired mso_mdoc MSOs', async () => {
		const nonce = 'test-nonce-mso-mdoc-expired';
		const origin = 'https://verifier.example';
		const deviceResponse = await buildOpenId4VpMsoMdocResponse(
			{
				resident_postal_code: '94110',
				resident_city: 'San Francisco',
				resident_state: 'CA',
				document_number: 'D1010101',
				birth_date: '1991-01-01'
			},
			{ origin, nonce, msoValidUntil: '2026-01-01T00:00:00Z' }
		);

		const result = await processSignedMsoMdocResponse(deviceResponse, nonce, origin);

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toBe('expired');
			expect(result.message).toContain('MSO has expired');
		}
		expect(mockResolveAddress).not.toHaveBeenCalled();
	});

	it('should reject mso_mdoc MSO docType mismatches', async () => {
		const nonce = 'test-nonce-mso-mdoc-doctype';
		const origin = 'https://verifier.example';
		const deviceResponse = await buildOpenId4VpMsoMdocResponse(
			{
				resident_postal_code: '94110',
				resident_city: 'San Francisco',
				resident_state: 'CA',
				document_number: 'D2020202',
				birth_date: '1992-02-02'
			},
			{ origin, nonce, msoDocType: 'org.example.not-mdl' }
		);

		const result = await processSignedMsoMdocResponse(deviceResponse, nonce, origin);

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toBe('signature_invalid');
			expect(result.message).toContain('MSO docType');
		}
		expect(mockResolveAddress).not.toHaveBeenCalled();
	});

	it('should fail closed on mso_mdoc DeviceMac until MAC verification is implemented', async () => {
		const nonce = 'test-nonce-mso-mdoc-device-mac';
		const origin = 'https://verifier.example';
		const deviceResponse = await buildOpenId4VpMsoMdocResponse(
			{
				resident_postal_code: '94110',
				resident_city: 'San Francisco',
				resident_state: 'CA',
				document_number: 'D9999999',
				birth_date: '1999-09-09'
			},
			{ origin, nonce, useDeviceMac: true }
		);

		const result = await processSignedMsoMdocResponse(deviceResponse, nonce, origin);

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toBe('replay_protection_missing');
			expect(result.message).toContain('DeviceAuth.deviceSignature');
		}
		expect(mockResolveAddress).not.toHaveBeenCalled();
	});

	it('should reject mismatched DigitalCredential envelope protocols', async () => {
		const nonce = 'test-nonce-protocol-mismatch';
		const jwt = await buildJwt({
			nonce,
			resident_postal_code: '94110',
			resident_state: 'CA',
			document_number: 'D5555555',
			birth_date: '1991-02-28'
		});

		const result = await processCredentialResponse(
			JSON.stringify({
				protocol: 'org-iso-mdoc',
				data: { vp_token: jwt }
			}),
			'openid4vp-v1-signed',
			ephemeralKey,
			nonce
		);

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toBe('invalid_format');
			expect(result.message).toContain('protocol mismatch');
		}
		expect(mockResolveAddress).not.toHaveBeenCalled();
	});

	it('should reject non-mdoc VP token objects without DeviceAuth messaging', async () => {
		const result = await processSignedDcApiPayload(
			{ vp_token: { mdl: [42] } },
			'test-nonce-non-mdoc-object',
			{ verifierOrigin: 'https://verifier.example' }
		);

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toBe('invalid_format');
			expect(result.message).toContain('does not contain an mso_mdoc');
			expect(result.message).not.toContain('DeviceAuth');
		}
		expect(mockResolveAddress).not.toHaveBeenCalled();
	});

	it('should fail closed when identity commitment salt is not configured', async () => {
		const previousSalt = process.env.IDENTITY_COMMITMENT_SALT;
		delete process.env.IDENTITY_COMMITMENT_SALT;
		const nonce = 'test-nonce-no-salt';
		const origin = 'https://verifier.example';
		const deviceResponse = await buildOpenId4VpMsoMdocResponse(
			{
				resident_postal_code: '94110',
				resident_city: 'San Francisco',
				resident_state: 'CA',
				document_number: 'D5555555',
				birth_date: '1991-02-28'
			},
			{ origin, nonce, signingJwkThumbprint: ephemeralJwkThumbprint }
		);

		mockShadowAtlasSuccess('ca', '12');

		try {
			const result = await processSignedDcApiPayload(
				{ vp_token: { mdl: [deviceResponse] } },
				nonce,
				{ verifierOrigin: origin }
			);

			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error).toBe('identity_commitment_failed');
			}
		} finally {
			if (previousSalt === undefined) {
				delete process.env.IDENTITY_COMMITMENT_SALT;
			} else {
				process.env.IDENTITY_COMMITMENT_SALT = previousSalt;
			}
		}
	});

	it('should reject legacy OpenID4VP protocol values', async () => {
		const result = await processCredentialResponse('not-a-jwt', 'openid4vp', ephemeralKey, 'some-nonce');

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toBe('unsupported_protocol');
		}
	});

	it('should handle district lookup failure gracefully', async () => {
		const nonce = 'test-nonce-fail';
		const origin = 'https://verifier.example';
		const deviceResponse = await buildOpenId4VpMsoMdocResponse(
			{
				resident_postal_code: '00000',
				resident_city: 'Nowhere',
				resident_state: 'XX',
				document_number: 'D0000000',
				birth_date: '2000-01-01'
			},
			{ origin, nonce, signingJwkThumbprint: ephemeralJwkThumbprint }
		);

		mockResolveAddress.mockRejectedValueOnce(new Error('Shadow Atlas unavailable'));

		const result = await processSignedDcApiPayload(
			{ vp_token: { mdl: [deviceResponse] } },
			nonce,
			{ verifierOrigin: origin }
		);

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toBe('district_lookup_failed');
		}
	});
});
