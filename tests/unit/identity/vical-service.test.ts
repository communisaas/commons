/**
 * Unit tests for VICAL fetch service (runtime IACA root extraction)
 *
 * Tests cover:
 *   - VICAL CBOR parsing (extractVICALRoots)
 *   - KV cache behavior (fetchAndCacheVICAL)
 *   - Merge function (getExpandedIACARoots)
 *   - Edge cases (P-384, expired, empty, malformed)
 *
 * Uses synthetic VICAL payloads — does NOT hit real AAMVA endpoints.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { encode } from 'cbor-web';
import type { IACACertificate } from '$lib/core/identity/iaca-roots';

// ---------------------------------------------------------------------------
// Synthetic X.509 DER certificate builders (reused from cose-verify tests)
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
	if (len < 0x80) return new Uint8Array([len]);
	if (len < 0x100) return new Uint8Array([0x81, len]);
	return new Uint8Array([0x82, (len >> 8) & 0xff, len & 0xff]);
}

function wrapDERSequence(content: Uint8Array): Uint8Array {
	const lenBytes = encodeDERLength(content.length);
	const result = new Uint8Array(1 + lenBytes.length + content.length);
	result[0] = 0x30;
	result.set(lenBytes, 1);
	result.set(content, 1 + lenBytes.length);
	return result;
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
	let binary = '';
	for (let i = 0; i < bytes.length; i++) {
		binary += String.fromCharCode(bytes[i]);
	}
	return btoa(binary);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	return bytes.slice().buffer as ArrayBuffer;
}

/**
 * Build a synthetic X.509 DER certificate with the given EC curve OID.
 * Contains just enough DER structure for extractVICALRoots' curve detection
 * and validity/CN extraction to work.
 */
function buildSyntheticCert(options: {
	curve: 'P-256' | 'P-384';
	cn?: string;
	state?: string;
	notBeforeUTC?: string;
	notAfterUTC?: string;
}): Uint8Array {
	const {
		curve,
		cn = 'Test IACA Root',
		state = 'TX',
		notBeforeUTC = '250101000000Z',
		notAfterUTC = '351231235959Z'
	} = options;

	// EC OID
	const ecOid = new Uint8Array([0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01]);

	// Curve OID
	let curveOidBytes: Uint8Array;
	let keySize: number;
	if (curve === 'P-256') {
		curveOidBytes = new Uint8Array([0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07]);
		keySize = 65; // 04 + 32 + 32
	} else {
		curveOidBytes = new Uint8Array([0x06, 0x05, 0x2b, 0x81, 0x04, 0x00, 0x22]);
		keySize = 97; // 04 + 48 + 48
	}

	// AlgorithmIdentifier
	const algId = wrapDERSequence(concatBytes(ecOid, curveOidBytes));

	// Fake public key (uncompressed point)
	const fakeKey = new Uint8Array(keySize);
	fakeKey[0] = 0x04;
	// Fill with deterministic-looking bytes
	for (let i = 1; i < keySize; i++) fakeKey[i] = (i * 7 + 0x42) & 0xff;
	const bitStringContent = concatBytes(new Uint8Array([0x00]), fakeKey);
	const bitString = new Uint8Array([0x03, ...encodeDERLength(bitStringContent.length), ...bitStringContent]);
	const spki = wrapDERSequence(concatBytes(algId, bitString));

	// TBS Certificate structure
	const version = new Uint8Array([0xa0, 0x03, 0x02, 0x01, 0x02]);
	const serial = new Uint8Array([0x02, 0x01, 0x01]);

	// sigAlg: ecdsaWithSHA256
	const sigAlgOid = new Uint8Array([0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x02]);
	const sigAlg = wrapDERSequence(sigAlgOid);

	// Issuer DN with CN and ST
	const cnOid = new Uint8Array([0x06, 0x03, 0x55, 0x04, 0x03]); // 2.5.4.3
	const cnBytes = new TextEncoder().encode(cn);
	const cnValue = new Uint8Array([0x0c, cnBytes.length, ...cnBytes]); // UTF8String
	const cnSeq = wrapDERSequence(concatBytes(cnOid, cnValue));
	const cnSet = new Uint8Array([0x31, ...encodeDERLength(cnSeq.length), ...cnSeq]);

	const stOid = new Uint8Array([0x06, 0x03, 0x55, 0x04, 0x08]); // 2.5.4.8
	const stBytes = new TextEncoder().encode(state);
	const stValue = new Uint8Array([0x13, stBytes.length, ...stBytes]); // PrintableString
	const stSeq = wrapDERSequence(concatBytes(stOid, stValue));
	const stSet = new Uint8Array([0x31, ...encodeDERLength(stSeq.length), ...stSeq]);

	const issuer = wrapDERSequence(concatBytes(cnSet, stSet));

	// Validity
	const nbBytes = new TextEncoder().encode(notBeforeUTC);
	const notBefore = new Uint8Array([0x17, nbBytes.length, ...nbBytes]);
	const naBytes = new TextEncoder().encode(notAfterUTC);
	const notAfter = new Uint8Array([0x17, naBytes.length, ...naBytes]);
	const validity = wrapDERSequence(concatBytes(notBefore, notAfter));

	// Subject = same as issuer (self-signed root)
	const subject = issuer;

	const tbsCert = wrapDERSequence(
		concatBytes(version, serial, sigAlg, issuer, validity, subject, spki)
	);

	// Dummy signature
	const dummySig = new Uint8Array([0x03, 0x03, 0x00, 0x30, 0x00]);
	return wrapDERSequence(concatBytes(tbsCert, sigAlg, dummySig));
}

// ---------------------------------------------------------------------------
// Synthetic VICAL CBOR payload builder
// ---------------------------------------------------------------------------

interface SyntheticVICALEntry {
	certificate: Uint8Array;
	docType?: string | string[];
	stateOrProvinceName?: string;
	issuingAuthority?: string;
	notAfter?: Date | string;
}

/**
 * Build a synthetic VICAL CBOR payload (COSE_Sign1 structure).
 * The signature is fake — tests only exercise parsing, not verification.
 *
 * @param entries  CertificateInfo entries to include
 * @param useMapFormat  If true, use CBOR Map format; if false, use object format
 */
function buildSyntheticVICAL(entries: SyntheticVICALEntry[], useMapFormat = true): Uint8Array {
	// Build payload (the VICAL data)
	let payloadData: unknown;

	if (useMapFormat) {
		const certInfos = entries.map((e) => {
			const m = new Map<string, unknown>();
			m.set('certificate', e.certificate);
			if (e.docType !== undefined) m.set('docType', e.docType);
			if (e.stateOrProvinceName !== undefined) m.set('stateOrProvinceName', e.stateOrProvinceName);
			if (e.issuingAuthority !== undefined) m.set('issuingAuthority', e.issuingAuthority);
			if (e.notAfter !== undefined) m.set('notAfter', e.notAfter);
			return m;
		});

		const payload = new Map<string, unknown>();
		payload.set('version', 1);
		payload.set('vicalProvider', 'AAMVA');
		payload.set('date', '2026-03-04');
		payload.set('vicalIssueID', 12345);
		payload.set('certificateInfos', certInfos);
		payloadData = payload;
	} else {
		const certInfos = entries.map((e) => ({
			certificate: e.certificate,
			...(e.docType !== undefined && { docType: e.docType }),
			...(e.stateOrProvinceName !== undefined && { stateOrProvinceName: e.stateOrProvinceName }),
			...(e.issuingAuthority !== undefined && { issuingAuthority: e.issuingAuthority }),
			...(e.notAfter !== undefined && { notAfter: e.notAfter })
		}));

		payloadData = {
			version: 1,
			vicalProvider: 'AAMVA',
			date: '2026-03-04',
			vicalIssueID: 12345,
			certificateInfos: certInfos
		};
	}

	const payloadBytes = new Uint8Array(encode(payloadData));

	// Build COSE_Sign1 = [protectedHeaders, unprotectedHeaders, payload, signature]
	const protectedHeaders = new Map<number, number>();
	protectedHeaders.set(1, -7); // alg: ES256
	const protectedHeadersCBOR = new Uint8Array(encode(protectedHeaders));

	const coseSign1 = [
		protectedHeadersCBOR,
		new Map(),         // unprotected headers (empty)
		payloadBytes,      // payload
		new Uint8Array(64) // dummy signature
	];

	return new Uint8Array(encode(coseSign1));
}

// ---------------------------------------------------------------------------
// Mock KV Namespace
// ---------------------------------------------------------------------------

function createMockKV(): {
	kv: { get: ReturnType<typeof vi.fn>; put: ReturnType<typeof vi.fn> };
	store: Map<string, ArrayBuffer>;
} {
	const store = new Map<string, ArrayBuffer>();
	const kv = {
		get: vi.fn(async (key: string, _type?: string) => {
			return store.get(key) ?? null;
		}),
		put: vi.fn(async (key: string, value: ArrayBuffer | Uint8Array, _options?: { expirationTtl?: number }) => {
			const buf = value instanceof ArrayBuffer ? value : value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
			store.set(key, buf as ArrayBuffer);
		})
	};
	return { kv, store };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('VICAL Service', () => {
	// Reset module-level cache between tests by re-importing
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	// -----------------------------------------------------------------------
	// 1. VICAL CBOR Parsing (extractVICALRoots)
	// -----------------------------------------------------------------------

	describe('extractVICALRoots — CBOR parsing', () => {
		it('should extract P-256 certificates from Map-based VICAL CBOR', async () => {
			const { extractVICALRoots } = await import('$lib/core/identity/vical-service');

			const txCert = buildSyntheticCert({ curve: 'P-256', cn: 'Texas DPS IACA', state: 'TX' });
			const nyCert = buildSyntheticCert({ curve: 'P-256', cn: 'NY DMV IACA', state: 'NY' });

			const vicalBytes = buildSyntheticVICAL([
				{
					certificate: txCert,
					docType: 'org.iso.18013.5.1.mDL',
					stateOrProvinceName: 'US-TX',
					issuingAuthority: 'cn=Texas DPS IACA,o=Texas DPS',
					notAfter: new Date('2035-12-31T23:59:59Z')
				},
				{
					certificate: nyCert,
					docType: 'org.iso.18013.5.1.mDL',
					stateOrProvinceName: 'NY',
					issuingAuthority: 'cn=NY DMV IACA',
					notAfter: '2034-06-15T00:00:00Z'
				}
			], true);

			const roots = await extractVICALRoots(vicalBytes);

			expect(roots.length).toBe(2);
			expect(roots[0].state).toBe('TX');
			expect(roots[0].issuer).toBe('Texas DPS IACA');
			expect(roots[0].expiresAt).toContain('2035');
			expect(roots[0].certificateB64).toBeTruthy();
			expect(roots[0].derBytes).toBeInstanceOf(Uint8Array);

			expect(roots[1].state).toBe('NY');
			expect(roots[1].issuer).toBe('NY DMV IACA');
			expect(roots[1].expiresAt).toContain('2034');
		});

		it('should extract certificates from object-based VICAL CBOR', async () => {
			const { extractVICALRoots } = await import('$lib/core/identity/vical-service');

			const wvCert = buildSyntheticCert({ curve: 'P-256', cn: 'WV DMV IACA', state: 'WV' });

			const vicalBytes = buildSyntheticVICAL([
				{
					certificate: wvCert,
					docType: 'org.iso.18013.5.1.mDL',
					stateOrProvinceName: 'WV',
					issuingAuthority: 'cn=WV DMV IACA',
					notAfter: new Date('2033-01-01T00:00:00Z')
				}
			], false); // object format

			const roots = await extractVICALRoots(vicalBytes);

			expect(roots.length).toBe(1);
			expect(roots[0].state).toBe('WV');
			expect(roots[0].issuer).toBe('WV DMV IACA');
		});

		it('should filter out non-mDL docTypes', async () => {
			const { extractVICALRoots } = await import('$lib/core/identity/vical-service');

			const mdlCert = buildSyntheticCert({ curve: 'P-256', cn: 'mDL Root', state: 'TX' });
			const nonMdlCert = buildSyntheticCert({ curve: 'P-256', cn: 'Vehicle Title Root', state: 'TX' });

			const vicalBytes = buildSyntheticVICAL([
				{
					certificate: mdlCert,
					docType: 'org.iso.18013.5.1.mDL',
					stateOrProvinceName: 'TX',
					issuingAuthority: 'cn=mDL Root'
				},
				{
					certificate: nonMdlCert,
					docType: 'org.example.vehicle_title',
					stateOrProvinceName: 'TX',
					issuingAuthority: 'cn=Vehicle Title Root'
				}
			]);

			const roots = await extractVICALRoots(vicalBytes);

			expect(roots.length).toBe(1);
			expect(roots[0].issuer).toBe('mDL Root');
		});

		it('should handle docType as array of strings', async () => {
			const { extractVICALRoots } = await import('$lib/core/identity/vical-service');

			const cert = buildSyntheticCert({ curve: 'P-256', cn: 'Array DocType Root', state: 'FL' });

			const vicalBytes = buildSyntheticVICAL([
				{
					certificate: cert,
					docType: ['org.iso.18013.5.1.mDL', 'org.iso.18013.7.1.mID'],
					stateOrProvinceName: 'FL',
					issuingAuthority: 'cn=Array DocType Root'
				}
			]);

			const roots = await extractVICALRoots(vicalBytes);

			expect(roots.length).toBe(1);
			expect(roots[0].state).toBe('FL');
		});

		it('should extract state from DER subject when VICAL metadata is missing', async () => {
			const { extractVICALRoots } = await import('$lib/core/identity/vical-service');

			const cert = buildSyntheticCert({ curve: 'P-256', cn: 'Oregon DMV IACA', state: 'OR' });

			// No stateOrProvinceName in VICAL metadata — should fall back to DER ST field
			const vicalBytes = buildSyntheticVICAL([
				{
					certificate: cert,
					docType: 'org.iso.18013.5.1.mDL',
					issuingAuthority: 'cn=Oregon DMV IACA'
				}
			]);

			const roots = await extractVICALRoots(vicalBytes);

			expect(roots.length).toBe(1);
			expect(roots[0].state).toBe('OR');
		});

		it('should extract issuer CN from DER when VICAL issuingAuthority is missing', async () => {
			const { extractVICALRoots } = await import('$lib/core/identity/vical-service');

			const cert = buildSyntheticCert({ curve: 'P-256', cn: 'Maine BMV IACA', state: 'ME' });

			const vicalBytes = buildSyntheticVICAL([
				{
					certificate: cert,
					docType: 'org.iso.18013.5.1.mDL',
					stateOrProvinceName: 'ME'
					// No issuingAuthority — should fall back to extractSubjectCN
				}
			]);

			const roots = await extractVICALRoots(vicalBytes);

			expect(roots.length).toBe(1);
			expect(roots[0].issuer).toBe('Maine BMV IACA');
		});

		it('should extract expiry from DER validity when VICAL notAfter is missing', async () => {
			const { extractVICALRoots } = await import('$lib/core/identity/vical-service');

			const cert = buildSyntheticCert({
				curve: 'P-256',
				cn: 'NH IACA',
				state: 'NH',
				notAfterUTC: '321215235959Z' // 2032-12-15
			});

			const vicalBytes = buildSyntheticVICAL([
				{
					certificate: cert,
					docType: 'org.iso.18013.5.1.mDL',
					stateOrProvinceName: 'NH'
					// No notAfter — should fall back to DER validity
				}
			]);

			const roots = await extractVICALRoots(vicalBytes);

			expect(roots.length).toBe(1);
			expect(roots[0].expiresAt).toContain('2032');
		});

		it('should normalize US-XX state format to XX', async () => {
			const { extractVICALRoots } = await import('$lib/core/identity/vical-service');

			const cert = buildSyntheticCert({ curve: 'P-256', cn: 'KY IACA', state: 'KY' });

			const vicalBytes = buildSyntheticVICAL([
				{
					certificate: cert,
					docType: 'org.iso.18013.5.1.mDL',
					stateOrProvinceName: 'US-KY',
					issuingAuthority: 'cn=KY IACA'
				}
			]);

			const roots = await extractVICALRoots(vicalBytes);

			expect(roots.length).toBe(1);
			expect(roots[0].state).toBe('KY');
		});
	});

	// -----------------------------------------------------------------------
	// 2. KV Cache Behavior (fetchAndCacheVICAL)
	// -----------------------------------------------------------------------

	describe('fetchAndCacheVICAL — cache behavior', () => {
		it('should return cached VICAL bytes from KV without fetching', async () => {
			const { fetchAndCacheVICAL } = await import('$lib/core/identity/vical-service');

			const cert = buildSyntheticCert({ curve: 'P-256', cn: 'Cached Root', state: 'WV' });
			const vicalBytes = buildSyntheticVICAL([
				{ certificate: cert, docType: 'org.iso.18013.5.1.mDL', stateOrProvinceName: 'WV' }
			]);

			const { kv, store } = createMockKV();
			store.set('vical:current', toArrayBuffer(vicalBytes));

			// Mock fetch — should NOT be called
			const mockFetch = vi.fn();
			vi.stubGlobal('fetch', mockFetch);

			const result = await fetchAndCacheVICAL(kv as never);

			expect(result).toBeInstanceOf(Uint8Array);
			expect(result!.length).toBe(vicalBytes.length);
			expect(kv.get).toHaveBeenCalledWith('vical:current', 'arrayBuffer');
			expect(mockFetch).not.toHaveBeenCalled();
		});

		it('should fetch VICAL and store in KV on cache miss', async () => {
			const { fetchAndCacheVICAL } = await import('$lib/core/identity/vical-service');

			const cert = buildSyntheticCert({ curve: 'P-256', cn: 'Fresh Root', state: 'KY' });
			const vicalBytes = buildSyntheticVICAL([
				{ certificate: cert, docType: 'org.iso.18013.5.1.mDL', stateOrProvinceName: 'KY' }
			]);

			const { kv } = createMockKV();

			// Mock fetch: listing page returns link, VICAL download returns bytes
			const mockFetch = vi.fn()
				.mockResolvedValueOnce({
					ok: true,
					text: async () => '<html><a href="/vical/vc/vc-2026-03-04-test">Download</a></html>'
				})
				.mockResolvedValueOnce({
					ok: true,
					arrayBuffer: async () => toArrayBuffer(vicalBytes)
				});
			vi.stubGlobal('fetch', mockFetch);

			const result = await fetchAndCacheVICAL(kv as never);

			expect(result).toBeInstanceOf(Uint8Array);
			expect(result!.length).toBe(vicalBytes.length);
			expect(mockFetch).toHaveBeenCalledTimes(2);
			// Verify listing URL was fetched
			expect(mockFetch.mock.calls[0][0]).toContain('vical.dts.aamva.org/currentVical');
			// Verify VICAL URL was fetched
			expect(mockFetch.mock.calls[1][0]).toContain('vc-2026-03-04-test');
			// Verify stored in KV
			expect(kv.put).toHaveBeenCalledWith(
				'vical:current',
				expect.any(Uint8Array),
				expect.objectContaining({ expirationTtl: expect.any(Number) })
			);
		});

		it('should return null gracefully when fetch fails', async () => {
			const { fetchAndCacheVICAL } = await import('$lib/core/identity/vical-service');

			const { kv } = createMockKV();

			// Mock fetch failure
			const mockFetch = vi.fn().mockResolvedValueOnce({
				ok: false,
				status: 503
			});
			vi.stubGlobal('fetch', mockFetch);

			const result = await fetchAndCacheVICAL(kv as never);

			expect(result).toBeNull();
		});

		it('should return null when no VICAL link found on listing page', async () => {
			const { fetchAndCacheVICAL } = await import('$lib/core/identity/vical-service');

			const { kv } = createMockKV();

			const mockFetch = vi.fn().mockResolvedValueOnce({
				ok: true,
				text: async () => '<html><p>No downloads available</p></html>'
			});
			vi.stubGlobal('fetch', mockFetch);

			const result = await fetchAndCacheVICAL(kv as never);

			expect(result).toBeNull();
		});

		it('should work without KV binding (no caching)', async () => {
			const { fetchAndCacheVICAL } = await import('$lib/core/identity/vical-service');

			const cert = buildSyntheticCert({ curve: 'P-256', cn: 'No KV Root', state: 'ID' });
			const vicalBytes = buildSyntheticVICAL([
				{ certificate: cert, docType: 'org.iso.18013.5.1.mDL', stateOrProvinceName: 'ID' }
			]);

			const mockFetch = vi.fn()
				.mockResolvedValueOnce({
					ok: true,
					text: async () => '<a href="/vical/vc/vc-test-123">DL</a>'
				})
				.mockResolvedValueOnce({
					ok: true,
					arrayBuffer: async () => toArrayBuffer(vicalBytes)
				});
			vi.stubGlobal('fetch', mockFetch);

			const result = await fetchAndCacheVICAL(undefined);

			expect(result).toBeInstanceOf(Uint8Array);
			expect(result!.length).toBe(vicalBytes.length);
		});

		it('should handle KV read errors gracefully and fall through to fetch', async () => {
			const { fetchAndCacheVICAL } = await import('$lib/core/identity/vical-service');

			const cert = buildSyntheticCert({ curve: 'P-256', cn: 'KV Error Root', state: 'WY' });
			const vicalBytes = buildSyntheticVICAL([
				{ certificate: cert, docType: 'org.iso.18013.5.1.mDL', stateOrProvinceName: 'WY' }
			]);

			const kv = {
				get: vi.fn().mockRejectedValueOnce(new Error('KV read timeout')),
				put: vi.fn().mockResolvedValue(undefined)
			};

			const mockFetch = vi.fn()
				.mockResolvedValueOnce({
					ok: true,
					text: async () => '<a href="/vical/vc/vc-recovery">DL</a>'
				})
				.mockResolvedValueOnce({
					ok: true,
					arrayBuffer: async () => toArrayBuffer(vicalBytes)
				});
			vi.stubGlobal('fetch', mockFetch);

			const result = await fetchAndCacheVICAL(kv as never);

			expect(result).toBeInstanceOf(Uint8Array);
			expect(kv.get).toHaveBeenCalled();
			expect(mockFetch).toHaveBeenCalledTimes(2);
		});

		it('should return null gracefully on network error', async () => {
			const { fetchAndCacheVICAL } = await import('$lib/core/identity/vical-service');

			const { kv } = createMockKV();

			const mockFetch = vi.fn().mockRejectedValueOnce(new Error('Network unreachable'));
			vi.stubGlobal('fetch', mockFetch);

			const result = await fetchAndCacheVICAL(kv as never);

			expect(result).toBeNull();
		});
	});

	// -----------------------------------------------------------------------
	// 3. Merge Function (getExpandedIACARoots)
	// -----------------------------------------------------------------------

	describe('getExpandedIACARoots — merge static + VICAL', () => {
		// These tests need module isolation because vical-service.ts has module-level
		// memory cache (cachedRoots, cacheTimestamp) that persists across calls.
		// We use vi.resetModules() to get a fresh module instance for each test.
		beforeEach(() => {
			vi.resetModules();
		});

		it('should return static roots when KV is not provided', async () => {
			const { getExpandedIACARoots } = await import('$lib/core/identity/vical-service');

			// No KV → loadVICALRoots will still attempt fetch (fetchAndCacheVICAL(undefined))
			// Mock fetch to fail — graceful degradation should return static roots only
			const mockFetch = vi.fn().mockRejectedValue(new Error('No network'));
			vi.stubGlobal('fetch', mockFetch);

			const roots = await getExpandedIACARoots(undefined);

			// Should contain at least the static CA and NM roots
			const states = roots.map((r) => r.state);
			expect(states).toContain('CA');
			expect(states).toContain('NM');
			// Graceful degradation: fetch was attempted but failed, static roots still returned
			expect(roots.length).toBeGreaterThan(0);
		});

		it('should include VICAL roots for states not in static trust store', async () => {
			// Fresh module — no cached roots
			const { getExpandedIACARoots } = await import('$lib/core/identity/vical-service');

			// Build a VICAL with WV (not in static store) and CA (IS in static store)
			const wvCert = buildSyntheticCert({ curve: 'P-256', cn: 'WV IACA', state: 'WV' });
			const caCert = buildSyntheticCert({ curve: 'P-256', cn: 'CA IACA Duplicate', state: 'CA' });

			const vicalBytes = buildSyntheticVICAL([
				{
					certificate: wvCert,
					docType: 'org.iso.18013.5.1.mDL',
					stateOrProvinceName: 'WV',
					issuingAuthority: 'cn=WV IACA',
					notAfter: new Date('2033-01-01T00:00:00Z')
				},
				{
					certificate: caCert,
					docType: 'org.iso.18013.5.1.mDL',
					stateOrProvinceName: 'CA',
					issuingAuthority: 'cn=CA IACA Duplicate',
					notAfter: new Date('2033-01-01T00:00:00Z')
				}
			]);

			const { kv, store } = createMockKV();
			store.set('vical:current', toArrayBuffer(vicalBytes));

			// Mock fetch — should not be called since KV has cached bytes
			const mockFetch = vi.fn();
			vi.stubGlobal('fetch', mockFetch);

			const roots = await getExpandedIACARoots(kv as never);

			const states = roots.map((r) => r.state);
			// WV should be included (not in static)
			expect(states).toContain('WV');
			// CA should appear but only from static (VICAL CA should be filtered as duplicate)
			const caRoots = roots.filter((r) => r.state === 'CA');
			// All CA roots should be from static store (not our synthetic one)
			for (const r of caRoots) {
				expect(r.issuer).not.toBe('CA IACA Duplicate');
			}
		});

		it('should return only static roots when VICAL fetch fails', async () => {
			const { getExpandedIACARoots } = await import('$lib/core/identity/vical-service');

			const { kv } = createMockKV();
			// No cached VICAL, fetch will fail
			const mockFetch = vi.fn().mockRejectedValueOnce(new Error('Network down'));
			vi.stubGlobal('fetch', mockFetch);

			const roots = await getExpandedIACARoots(kv as never);

			// Should still have static roots
			const states = roots.map((r) => r.state);
			expect(states).toContain('CA');
			expect(states).toContain('NM');
			// Should not throw
		});
	});

	// -----------------------------------------------------------------------
	// 4. Edge Cases
	// -----------------------------------------------------------------------

	describe('edge cases', () => {
		it('should extract P-384 certificates from VICAL', async () => {
			const { extractVICALRoots } = await import('$lib/core/identity/vical-service');

			const p384Cert = buildSyntheticCert({ curve: 'P-384', cn: 'Alaska DMV IACA', state: 'AK' });

			const vicalBytes = buildSyntheticVICAL([
				{
					certificate: p384Cert,
					docType: 'org.iso.18013.5.1.mDL',
					stateOrProvinceName: 'AK',
					issuingAuthority: 'cn=Alaska DMV IACA',
					notAfter: new Date('2035-02-10T23:22:37Z')
				}
			]);

			const roots = await extractVICALRoots(vicalBytes);

			// P-384 certificates should be extracted (AK uses P-384)
			expect(roots.length).toBe(1);
			expect(roots[0].state).toBe('AK');
		});

		it('should still extract expired certificates (expiry monitoring is separate)', async () => {
			const { extractVICALRoots } = await import('$lib/core/identity/vical-service');

			const expiredCert = buildSyntheticCert({
				curve: 'P-256',
				cn: 'Expired State IACA',
				state: 'ZZ',
				notBeforeUTC: '200101000000Z',
				notAfterUTC: '200201000000Z' // Expired in 2002
			});

			const vicalBytes = buildSyntheticVICAL([
				{
					certificate: expiredCert,
					docType: 'org.iso.18013.5.1.mDL',
					stateOrProvinceName: 'ZZ',
					issuingAuthority: 'cn=Expired State IACA',
					notAfter: new Date('2002-01-01T00:00:00Z')
				}
			]);

			const roots = await extractVICALRoots(vicalBytes);

			expect(roots.length).toBe(1);
			expect(roots[0].state).toBe('ZZ');
			expect(roots[0].expiresAt).toContain('2002');
		});

		it('should return empty array for VICAL with no certificateInfos', async () => {
			const { extractVICALRoots } = await import('$lib/core/identity/vical-service');

			// Build a VICAL with empty certificateInfos
			const payload = new Map<string, unknown>();
			payload.set('version', 1);
			payload.set('vicalProvider', 'AAMVA');
			payload.set('certificateInfos', []);
			const payloadBytes = new Uint8Array(encode(payload));

			const protHeaders = new Uint8Array(encode(new Map([[1, -7]])));
			const coseSign1 = [protHeaders, new Map(), payloadBytes, new Uint8Array(64)];
			const vicalBytes = new Uint8Array(encode(coseSign1));

			const roots = await extractVICALRoots(vicalBytes);
			expect(roots).toEqual([]);
		});

		it('should throw on malformed CBOR (not a COSE_Sign1 4-element array)', async () => {
			const { extractVICALRoots } = await import('$lib/core/identity/vical-service');

			// Encode something that's not a 4-element array
			const badBytes = new Uint8Array(encode({ notAnArray: true }));

			await expect(extractVICALRoots(badBytes)).rejects.toThrow('COSE_Sign1');
		});

		it('should throw when payload has no certificateInfos', async () => {
			const { extractVICALRoots } = await import('$lib/core/identity/vical-service');

			// Valid COSE_Sign1 structure but payload lacks certificateInfos
			const payload = new Map<string, unknown>();
			payload.set('version', 1);
			payload.set('vicalProvider', 'AAMVA');
			// No certificateInfos!
			const payloadBytes = new Uint8Array(encode(payload));

			const protHeaders = new Uint8Array(encode(new Map([[1, -7]])));
			const coseSign1 = [protHeaders, new Map(), payloadBytes, new Uint8Array(64)];
			const vicalBytes = new Uint8Array(encode(coseSign1));

			await expect(extractVICALRoots(vicalBytes)).rejects.toThrow('certificateInfos');
		});

		it('should skip entries with no certificate bytes', async () => {
			const { extractVICALRoots } = await import('$lib/core/identity/vical-service');

			const goodCert = buildSyntheticCert({ curve: 'P-256', cn: 'Good Root', state: 'WA' });

			// One valid entry, one with no certificate bytes
			const certInfos = [
				(() => {
					const m = new Map<string, unknown>();
					m.set('certificate', goodCert);
					m.set('docType', 'org.iso.18013.5.1.mDL');
					m.set('stateOrProvinceName', 'WA');
					return m;
				})(),
				(() => {
					const m = new Map<string, unknown>();
					// No 'certificate' key
					m.set('docType', 'org.iso.18013.5.1.mDL');
					m.set('stateOrProvinceName', 'XX');
					return m;
				})()
			];

			const payload = new Map<string, unknown>();
			payload.set('version', 1);
			payload.set('certificateInfos', certInfos);
			const payloadBytes = new Uint8Array(encode(payload));

			const protHeaders = new Uint8Array(encode(new Map([[1, -7]])));
			const vicalBytes = new Uint8Array(encode([protHeaders, new Map(), payloadBytes, new Uint8Array(64)]));

			const roots = await extractVICALRoots(vicalBytes);

			expect(roots.length).toBe(1);
			expect(roots[0].state).toBe('WA');
		});

		it('should skip entries with non-EC certificates (no curve OID)', async () => {
			const { extractVICALRoots } = await import('$lib/core/identity/vical-service');

			const p256Cert = buildSyntheticCert({ curve: 'P-256', cn: 'Good EC Root', state: 'MT' });

			// Build a fake "RSA" cert that has no EC OID
			const rsaOid = new Uint8Array([0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01]);
			const rsaCert = wrapDERSequence(wrapDERSequence(rsaOid));

			const certInfos = [
				(() => {
					const m = new Map<string, unknown>();
					m.set('certificate', p256Cert);
					m.set('docType', 'org.iso.18013.5.1.mDL');
					m.set('stateOrProvinceName', 'MT');
					return m;
				})(),
				(() => {
					const m = new Map<string, unknown>();
					m.set('certificate', rsaCert);
					m.set('docType', 'org.iso.18013.5.1.mDL');
					m.set('stateOrProvinceName', 'XX');
					return m;
				})()
			];

			const payload = new Map<string, unknown>();
			payload.set('version', 1);
			payload.set('certificateInfos', certInfos);
			const payloadBytes = new Uint8Array(encode(payload));

			const protHeaders = new Uint8Array(encode(new Map([[1, -7]])));
			const vicalBytes = new Uint8Array(encode([protHeaders, new Map(), payloadBytes, new Uint8Array(64)]));

			const roots = await extractVICALRoots(vicalBytes);

			expect(roots.length).toBe(1);
			expect(roots[0].state).toBe('MT');
		});
	});
});
