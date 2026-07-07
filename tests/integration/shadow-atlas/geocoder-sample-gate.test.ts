/**
 * SOURCE-POPULATION GATE — SEAM-CONTRACT v1 §6 (consumer side).
 *
 * Runs ALL SIX acceptance checks against the producer's REAL published
 * DE/RI/DC sample artifact, through the consumer's OWN fetch path
 * (configure() → ipfs-store → geocoder). Fixtures alone never satisfy this
 * gate: it verifies the SOURCE population, not the seam.
 *
 *   1. Every chunk validates against §2 (shape, 5-dp coords, fromHn ≤ toHn,
 *      parity enum, src enum) — enforced by the store's fail-closed reader.
 *   2. Every chunk's sha256 matches chunk-index.json; normalization.json's
 *      sha256 matches the manifest pin.
 *   3. norm() idempotence holds on every assertion input; normVersion
 *      handshake per §3.
 *   4. 100% of assertions produce the expected matchClass and coords within
 *      tolDeg; the MUST-MISS cases return no-match (never 0.6).
 *   5. Manifest clocks: addressIndexGenerated parses ISO-8601; the boundary
 *      and officials clocks are never borrowed from or collapsed into it;
 *      degrade-to-null verified on a mutated copy ('unknown' → null).
 *   6. Chunk-size guard (§1): p95 raw ≤ 256 KB, max ≤ 1 MB over
 *      chunkIndex bytes.
 *
 * Env: SAMPLE_ATLAS_BASE_URL must point at the published sample root (the
 * directory containing `US/` and `assertions.json`, e.g.
 * https://atlas.commons.email/sample/address-index/v1). When it is UNSET the
 * suite skips with a loud warning — an unrun gate never counts as a pass.
 * When it IS set, any failing check FAILS the suite (no silent skip).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
	configure,
	clearCache,
	getManifest,
	getManifestVintage,
	getAddressChunk,
	getNormalizationTable,
	type ChunkManifest,
	type NormalizationTable,
} from '$lib/core/shadow-atlas/ipfs-store';
import {
	geocodeAddress,
	normalizeStreet,
	setMatchOutcomeSink,
	ADDRESS_NOT_FOUND_MESSAGE,
} from '$lib/core/shadow-atlas/geocoder';

const BASE = (process.env.SAMPLE_ATLAS_BASE_URL ?? '').replace(/\/$/, '');

if (!BASE) {
	// LOUD: this gate is the node's final acceptance against the real
	// producer artifact. Skipping it does NOT satisfy the node.
	console.warn(
		'\n' +
			'⚠️  ⚠️  ⚠️  SOURCE-POPULATION GATE SKIPPED  ⚠️  ⚠️  ⚠️\n' +
			'SAMPLE_ATLAS_BASE_URL is not set — the §6 gate against the REAL\n' +
			'producer sample artifact DID NOT RUN. A skipped gate never counts as a pass.\n' +
			'Set SAMPLE_ATLAS_BASE_URL to the published sample root, e.g.\n' +
			'  SAMPLE_ATLAS_BASE_URL=https://atlas.commons.email/sample/address-index/v1 \\\n' +
			'    npx vitest run tests/integration/shadow-atlas/geocoder-sample-gate.test.ts\n',
	);
}

const gate = BASE ? describe : describe.skip;

interface AssertionEntry {
	label: string;
	covers: string[];
	input: { street: string; city: string; state: string; postalcode: string };
	expect: { matchClass: string; lat?: number; lng?: number; tolDeg?: number };
}

interface AssertionsDoc {
	version: number;
	schema: string;
	normVersion: number;
	assertions: AssertionEntry[];
}

type ChunkIndexDoc = Record<string, { streetCount: number; bytes: number; sha256: string }>;

async function fetchGateArtifact<T>(path: string): Promise<T> {
	const res = await fetch(`${BASE}/${path}`);
	if (!res.ok) throw new Error(`Gate artifact fetch failed: ${path} → ${res.status}`);
	return (await res.json()) as T;
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
	const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

gate('§6 source-population gate — real producer sample artifact', () => {
	let manifest: ChunkManifest;
	let addressIndex: NonNullable<ChunkManifest['addressIndex']>;
	let chunkIndex: ChunkIndexDoc;
	let assertionsDoc: AssertionsDoc;
	let normTable: NormalizationTable;

	beforeAll(async () => {
		await clearCache();
		configure({ atlasBaseUrl: BASE });
		setMatchOutcomeSink(() => {}); // keep gate output readable; metric is unit-tested

		manifest = await getManifest('US');
		if (!manifest.addressIndex) throw new Error('Sample manifest has no addressIndex section');
		addressIndex = manifest.addressIndex;
		chunkIndex = await fetchGateArtifact<ChunkIndexDoc>(`US/${addressIndex.chunkIndex.path}`);
		assertionsDoc = await fetchGateArtifact<AssertionsDoc>('assertions.json');
		normTable = await getNormalizationTable('US');
	}, 120_000);

	afterAll(() => {
		setMatchOutcomeSink(null);
	});

	it('gate input sanity: ≥25 assertions incl. at least one MUST-MISS', () => {
		expect(assertionsDoc.assertions.length).toBeGreaterThanOrEqual(25);
		expect(
			assertionsDoc.assertions.filter((a) => a.expect.matchClass === 'miss').length,
		).toBeGreaterThanOrEqual(1);
		expect(Object.keys(chunkIndex).length).toBe(addressIndex.totalChunks);
	});

	it(
		'check 1 — every chunk validates against §2 through the consumer fail-closed reader',
		async () => {
			for (const zip5 of Object.keys(chunkIndex)) {
				// getAddressChunk hard-validates §2 (shape, 5-dp coords,
				// fromHn ≤ toHn, parity enum, src enum) and throws on violation.
				// NOTE (§1 v2): a call with no normalizedStreet only fetches the
				// ONE shard '' hashes into for a SPLIT ZIP, so the streetCount
				// equality below assumes every chunk in this sample is unsplit —
				// true for the small DE/RI/DC sample this gate targets, but not a
				// general invariant once a national build's split ZIPs are
				// published under this gate's BASE.
				const chunk = await getAddressChunk(zip5, 'US');
				expect(chunk, `chunk ${zip5} missing despite chunk-index entry`).not.toBeNull();
				expect(chunk!.zip).toBe(zip5);
				expect(Object.keys(chunk!.streets).length).toBe(chunkIndex[zip5].streetCount);
			}
		},
		600_000,
	);

	it(
		'check 2 — chunk sha256s match chunk-index.json; normalization.json sha256 matches the manifest',
		async () => {
			for (const [zip5, entry] of Object.entries(chunkIndex)) {
				const res = await fetch(`${BASE}/US/addresses/${zip5}.json`);
				expect(res.ok, `raw fetch of chunk ${zip5} failed (${res.status})`).toBe(true);
				const bytes = await res.arrayBuffer();
				expect(bytes.byteLength, `chunk ${zip5} byte length`).toBe(entry.bytes);
				expect(await sha256Hex(bytes), `chunk ${zip5} sha256`).toBe(entry.sha256);

				// §1 v2: for a SPLIT ZIP the index entry above pins the stub;
				// each shard file must byte-match the stub's own shardHashes pins.
				const body = JSON.parse(new TextDecoder().decode(bytes)) as {
					v?: number;
					shards?: number;
					shardHashes?: { bytes: number; sha256: string }[];
				};
				if (body.v === 2) {
					expect(
						body.shardHashes?.length,
						`stub ${zip5} shardHashes count`,
					).toBe(body.shards);
					for (const [idx, pin] of (body.shardHashes ?? []).entries()) {
						const shardRes = await fetch(`${BASE}/US/addresses/${zip5}.${idx}.json`);
						expect(shardRes.ok, `raw fetch of shard ${zip5}.${idx} failed (${shardRes.status})`).toBe(
							true,
						);
						const shardBytes = await shardRes.arrayBuffer();
						expect(shardBytes.byteLength, `shard ${zip5}.${idx} byte length`).toBe(pin.bytes);
						expect(await sha256Hex(shardBytes), `shard ${zip5}.${idx} sha256`).toBe(pin.sha256);
					}
				}
			}

			const normRes = await fetch(`${BASE}/US/${addressIndex.normTable.path}`);
			expect(normRes.ok).toBe(true);
			const normBytes = await normRes.arrayBuffer();
			expect(normBytes.byteLength).toBe(addressIndex.normTable.bytes);
			expect(await sha256Hex(normBytes)).toBe(addressIndex.normTable.sha256);
		},
		600_000,
	);

	it('check 3 — norm() idempotence on every assertion input + normVersion handshake', () => {
		// Handshake: manifest section, shipped table, and assertions doc all
		// agree on normVersion 1 (getNormalizationTable already hard-asserted
		// the table and manifest; this pins the assertions doc too).
		expect(addressIndex.normVersion).toBe(1);
		expect(normTable.normVersion).toBe(1);
		expect(assertionsDoc.normVersion).toBe(1);

		for (const { input } of assertionsDoc.assertions) {
			const once = normalizeStreet(input.street, normTable);
			expect(
				normalizeStreet(once, normTable),
				`idempotence failure on "${input.street}"`,
			).toBe(once);
		}
	});

	it(
		'check 4 — 100% of assertions match (class + coords within tolDeg); MUST-MISS returns no-match',
		async () => {
			const failures: string[] = [];

			for (const assertion of assertionsDoc.assertions) {
				const { input, expect: expected, label } = assertion;
				const address = {
					street: input.street,
					city: input.city,
					state: input.state,
					zip: input.postalcode,
				};

				if (expected.matchClass === 'miss') {
					const err = await geocodeAddress(address).then(
						() => null,
						(e: unknown) => e,
					);
					if (!(err instanceof Error) || err.message !== ADDRESS_NOT_FOUND_MESSAGE) {
						failures.push(`${label}: expected MUST-MISS, got ${err ? String(err) : 'a result'}`);
					}
					continue;
				}

				try {
					const result = await geocodeAddress(address);
					if (result.matchClass !== expected.matchClass) {
						failures.push(
							`${label}: matchClass ${result.matchClass}, expected ${expected.matchClass}`,
						);
						continue;
					}
					const tol = expected.tolDeg ?? 0;
					const dLat = Math.abs(result.lat - (expected.lat ?? NaN));
					const dLng = Math.abs(result.lng - (expected.lng ?? NaN));
					if (!(dLat <= tol) || !(dLng <= tol)) {
						failures.push(`${label}: dLat=${dLat} dLng=${dLng} exceeds tolDeg=${tol}`);
					}
				} catch (err) {
					failures.push(`${label}: unexpected throw ${String(err)}`);
				}
			}

			expect(failures, `\n${failures.join('\n')}`).toEqual([]);
		},
		600_000,
	);

	it("check 5 — manifest clocks: ISO-8601 third clock, never borrowed, degrade-to-null on 'unknown'", async () => {
		// addressIndexGenerated parses as ISO-8601.
		const stamp = manifest.addressIndexGenerated ?? '';
		expect(stamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/);
		expect(Number.isFinite(Date.parse(stamp))).toBe(true);

		// The boundary and officials clocks are UNTOUCHED by the address publish:
		// each reads its OWN manifest field (or degrades to null) — the address
		// clock is NEVER borrowed to fill either of them.
		const raw = manifest as Partial<ChunkManifest>;
		const vintage = await getManifestVintage('US');
		expect(vintage.generated).toBe(
			typeof raw.generated === 'string' && raw.generated !== '' ? raw.generated : null,
		);
		expect(vintage.officialsGenerated).toBe(
			typeof raw.officialsGenerated === 'string' &&
			raw.officialsGenerated.trim() !== '' &&
			raw.officialsGenerated.trim() !== 'unknown'
				? raw.officialsGenerated
				: null,
		);
		if (raw.generated === undefined) expect(vintage.generated).toBeNull();
		if (raw.officialsGenerated === undefined) expect(vintage.officialsGenerated).toBeNull();

		// Degrade-to-null discipline, verified on a MUTATED COPY of the real
		// manifest served through the consumer's own reader: 'unknown' → null,
		// never fabricated, never borrowed from the address clock.
		const mutated = { ...manifest, tigerVintage: 'unknown', officialsGenerated: 'unknown' };
		const realFetch = globalThis.fetch;
		try {
			await clearCache();
			globalThis.fetch = (async (input: RequestInfo | URL) => {
				if (String(input).endsWith('US/manifest.json')) {
					return new Response(JSON.stringify(mutated), {
						status: 200,
						headers: { 'Content-Type': 'application/json' },
					});
				}
				return realFetch(input);
			}) as typeof fetch;

			const degraded = await getManifestVintage('US');
			// null = honestly-unknown; never fabricated, never borrowed from the
			// (still-present) address clock.
			expect(degraded.tigerVintage).toBeNull();
			expect(degraded.officialsGenerated).toBeNull();
		} finally {
			globalThis.fetch = realFetch;
			await clearCache();
			configure({ atlasBaseUrl: BASE });
		}
	});

	it('check 6 — §1 chunk-size guard: p95 ≤ 256 KB raw, max ≤ 1 MB over chunkIndex bytes', () => {
		const sizes = Object.values(chunkIndex)
			.map((entry) => entry.bytes)
			.sort((a, b) => a - b);
		expect(sizes.length).toBeGreaterThan(0);

		const p95 = sizes[Math.min(sizes.length - 1, Math.ceil(sizes.length * 0.95) - 1)];
		const max = sizes[sizes.length - 1];

		expect(p95).toBeLessThanOrEqual(256 * 1024);
		expect(max).toBeLessThanOrEqual(1024 * 1024);
	});
});
