/**
 * District/postal anonymization: one keyed scheme, four producers.
 *
 * The point of this suite is not that hashing "works" — it is that the schemes
 * this module replaced were forgeable, and that the replacement is not. The
 * attack is carried here literally rather than described: every deleted scheme
 * is reimplemented as an oracle, the ~435-code district space is enumerated
 * against it, and the victim's district is recovered. The same enumeration is
 * then run against the keyed scheme and finds nothing.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
	hashDistrictCode,
	hashPostalCode,
	normalizeDistrictCode,
	normalizePostalCode
} from '../../convex/lib/districtHash';
import { hashDistrict } from '$lib/core/identity/district-credential';

const REPO_ROOT = resolve(__dirname, '../..');

const VICTIM_DISTRICT = 'CA-12';
const HEX64 = /^[0-9a-f]{64}$/;

// ---------------------------------------------------------------------------
// The adversary's candidate set
// ---------------------------------------------------------------------------

const STATES = [
	'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
	'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
	'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
	'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
	'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
	'DC'
];

function buildCandidates(): string[] {
	const out: string[] = [];
	for (const st of STATES) {
		out.push(`${st}-AL`);
		for (let n = 1; n <= 53; n++) {
			out.push(`${st}-${String(n).padStart(2, '0')}`);
		}
	}
	return out;
}

const CANDIDATES = buildCandidates();

// ---------------------------------------------------------------------------
// The deleted schemes, reimplemented verbatim as attacker oracles
// ---------------------------------------------------------------------------

const encoder = new TextEncoder();

async function sha256hex(input: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', encoder.encode(input));
	return Array.from(new Uint8Array(digest))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

/** The RSVP route's scheme: plain SHA-256 over the lowercased value. */
function legacyUnsalted(code: string): Promise<string> {
	return sha256hex(code.toLowerCase().trim());
}

/** The campaign-action scheme: SHA-256 over a HARDCODED, therefore public, salt. */
function legacyPublicSalt(code: string): Promise<string> {
	return sha256hex('commons-district-v1:' + code.toLowerCase());
}

/** The district-credential fallback: plain SHA-256 over the raw value. */
function legacyRawSha(code: string): Promise<string> {
	return sha256hex(code);
}

type Oracle = (code: string) => Promise<string>;

const ORACLES: Array<[string, Oracle]> = [
	['unsalted SHA-256', legacyUnsalted],
	['hardcoded-salt SHA-256', legacyPublicSalt],
	['raw SHA-256', legacyRawSha]
];

/** Hash every candidate under `oracle`, return those whose digest equals `stored`. */
async function enumerate(oracle: Oracle, stored: string): Promise<string[]> {
	const hits: string[] = [];
	for (const candidate of CANDIDATES) {
		if ((await oracle(candidate)) === stored) hits.push(candidate);
	}
	return hits;
}

/** HMAC-SHA256 under an arbitrary key — the adversary guessing the secret. */
async function hmacUnder(key: string, preimage: string): Promise<string> {
	const cryptoKey = await crypto.subtle.importKey(
		'raw',
		encoder.encode(key),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	const sig = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(preimage));
	return Array.from(new Uint8Array(sig))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

// ---------------------------------------------------------------------------

describe('district hash candidate set', () => {
	it('covers the full enumerable district space', () => {
		expect(CANDIDATES.length).toBeGreaterThanOrEqual(435);
		expect(CANDIDATES).toContain(VICTIM_DISTRICT);
	});
});

describe('the deleted schemes were forgeable', () => {
	for (const [name, oracle] of ORACLES) {
		it(`${name}: enumeration recovers the victim's district`, async () => {
			const victimHash = await oracle(VICTIM_DISTRICT);
			const hits = await enumerate(oracle, victimHash);
			expect(hits).toContain(VICTIM_DISTRICT);
		});
	}
});

describe('the keyed scheme defeats the same enumeration', () => {
	for (const [name, oracle] of ORACLES) {
		it(`${name}: zero candidates match the stored keyed hash`, async () => {
			const stored = await hashDistrictCode(VICTIM_DISTRICT);
			const hits = await enumerate(oracle, stored);
			expect(hits).toEqual([]);
			expect(stored).not.toBe(await oracle(VICTIM_DISTRICT));
		});
	}

	it('a wrong-key HMAC enumeration matches nothing', async () => {
		const stored = await hashDistrictCode(VICTIM_DISTRICT);
		const wrongKey = 'f'.repeat(64);
		const hits: string[] = [];
		for (const candidate of CANDIDATES) {
			if ((await hmacUnder(wrongKey, `district:${candidate}`)) === stored) {
				hits.push(candidate);
			}
		}
		expect(hits).toEqual([]);
	});
});

describe('truncation is not a mitigation', () => {
	it('a 12-hex prefix still uniquely recovers the district under a public salt', async () => {
		const victimPrefix = (await legacyPublicSalt(VICTIM_DISTRICT)).slice(0, 12);
		const hits: string[] = [];
		for (const candidate of CANDIDATES) {
			if ((await legacyPublicSalt(candidate)).slice(0, 12) === victimPrefix) {
				hits.push(candidate);
			}
		}
		expect(hits).toEqual([VICTIM_DISTRICT]);
	});

	it('the same 12-hex prefix recovers nothing under the keyed scheme', async () => {
		const storedPrefix = (await hashDistrictCode(VICTIM_DISTRICT)).slice(0, 12);
		const hits: string[] = [];
		for (const candidate of CANDIDATES) {
			if ((await legacyPublicSalt(candidate)).slice(0, 12) === storedPrefix) {
				hits.push(candidate);
			}
		}
		expect(hits).toEqual([]);
	});
});

describe('fail-closed without a key', () => {
	// Captured in beforeEach, not at collection time: the global test setup
	// installs the key in its own beforeEach, which runs first.
	let saved: string | undefined;

	beforeEach(() => {
		saved = process.env.DISTRICT_HASH_KEY;
	});

	afterEach(() => {
		if (saved === undefined) delete process.env.DISTRICT_HASH_KEY;
		else process.env.DISTRICT_HASH_KEY = saved;
	});

	it('hashDistrictCode rejects when the key is absent', async () => {
		delete process.env.DISTRICT_HASH_KEY;
		await expect(hashDistrictCode(VICTIM_DISTRICT)).rejects.toThrow(/DISTRICT_HASH_KEY/);
	});

	it('hashPostalCode rejects when the key is absent', async () => {
		delete process.env.DISTRICT_HASH_KEY;
		await expect(hashPostalCode('90210')).rejects.toThrow(/DISTRICT_HASH_KEY/);
	});
});

describe('cross-runtime and normalization contract', () => {
	it('the SvelteKit export and the shared module agree byte-for-byte', async () => {
		expect(await hashDistrict(VICTIM_DISTRICT)).toBe(await hashDistrictCode(VICTIM_DISTRICT));
	});

	it('normalizes case and surrounding whitespace', async () => {
		expect(await hashDistrictCode('ca-12')).toBe(await hashDistrictCode('  CA-12  '));
		expect(normalizeDistrictCode('  ca-12 ')).toBe('CA-12');
		expect(normalizePostalCode('  k1a 0b1 ')).toBe('K1A 0B1');
	});

	it('district and postal domains are separated', async () => {
		expect(await hashDistrictCode('90210')).not.toBe(await hashPostalCode('90210'));
	});

	it('every output is 64 lowercase hex characters', async () => {
		expect(await hashDistrictCode(VICTIM_DISTRICT)).toMatch(HEX64);
		expect(await hashPostalCode('90210')).toMatch(HEX64);
		expect(await hashDistrict(VICTIM_DISTRICT)).toMatch(HEX64);
	});
});

describe('every producer routes through the shared module', () => {
	function source(rel: string): string {
		return readFileSync(resolve(REPO_ROOT, rel), 'utf-8');
	}

	const PRODUCERS: Array<[string, string]> = [
		['convex/campaigns.ts', "./lib/districtHash"],
		['convex/donations.ts', "./lib/districtHash"],
		['src/routes/api/e/[id]/rsvp/+server.ts', '$convex/lib/districtHash'],
		['src/lib/core/identity/district-credential.ts', '$convex/lib/districtHash']
	];

	for (const [file, specifier] of PRODUCERS) {
		it(`${file} imports ${specifier}`, () => {
			expect(source(file)).toContain(`from '${specifier}'`);
		});
	}

	it('the hardcoded public salt is gone from both producers', () => {
		expect(source('convex/campaigns.ts')).not.toContain('commons-district-v1');
		expect(source('convex/donations.ts')).not.toContain('commons-district-v1');
	});

	it('donations no longer carries a local digest helper', () => {
		expect(source('convex/donations.ts')).not.toContain('sha256Hex');
	});

	it('the RSVP route no longer reaches for node:crypto', () => {
		const rsvp = source('src/routes/api/e/[id]/rsvp/+server.ts');
		expect(rsvp).not.toContain('node:crypto');
		expect(rsvp).not.toContain('createHash');
	});

	it('district-credential keeps no local unkeyed fallback', () => {
		const dc = source('src/lib/core/identity/district-credential.ts');
		expect(dc).not.toContain('Fallback: plain SHA-256');
	});

	it('the shared module stays runtime-neutral and reads the key lazily', () => {
		const mod = source('convex/lib/districtHash.ts');
		expect(mod).not.toContain('node:crypto');
		expect(mod).not.toContain("from '$lib");
		expect(mod).not.toContain("from '../src");
		// The key read must sit inside a function body, never at module scope —
		// `process.env` is empty at module scope on Cloudflare Workers.
		for (const line of mod.split('\n')) {
			if (line.includes('process.env.DISTRICT_HASH_KEY')) {
				expect(line.startsWith(' ') || line.startsWith('\t')).toBe(true);
			}
		}
	});
});
