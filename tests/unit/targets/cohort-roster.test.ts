/**
 * Cohort → federal-rep roster (C1a). Behavioral coverage of the pure builder
 * (dedup, unavailable degradation, senator coverage, provenance, no fabrication)
 * + the load-bearing isolation assertion: the cohort path must NOT import the
 * per-sender ZK-gated resolver/witness machinery (RV-C1 vector 1).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	buildCohortRoster,
	normalizeDistrictCode,
	normalizeStateCode,
	type ResolvedDistrict
} from '$lib/core/targets/cohort-roster';

const houseRep = (state: string, district: string, id: string) => ({
	bioguide_id: id,
	name: `Rep ${district}`,
	party: 'D',
	chamber: 'house' as const,
	state,
	district,
	office: `Representative, ${state}`,
	phone: '202-000-0000',
	is_voting: true
});
const senator = (state: string, id: string) => ({
	bioguide_id: id,
	name: `Sen ${id}`,
	party: 'D',
	chamber: 'senate' as const,
	state,
	district: null,
	office: `Senator, ${state}`,
	is_voting: true
});

describe('buildCohortRoster', () => {
	it('dedups senators across a state and counts coverage correctly', () => {
		const hist = { districtCounts: { 'CA-12': 2, 'CA-30': 1 }, stateCounts: { CA: 3 } };
		const resolved: ResolvedDistrict[] = [
			{ code: 'CA-12', ok: true, officials: [houseRep('CA', '12', 'H12'), senator('CA', 'S1'), senator('CA', 'S2')] },
			{ code: 'CA-30', ok: true, officials: [houseRep('CA', '30', 'H30'), senator('CA', 'S1'), senator('CA', 'S2')] }
		];
		const { roster, unavailableDistricts, statesMissingSenators } = buildCohortRoster(hist, resolved);
		// 2 house reps + 2 senators (deduped across both districts)
		expect(roster.filter((r) => r.chamber === 'house')).toHaveLength(2);
		const senators = roster.filter((r) => r.chamber === 'senate');
		expect(senators).toHaveLength(2);
		// house coverage = its district count; senator coverage = the state total (set once)
		expect(roster.find((r) => r.bioguideId === 'H12')!.supporterCount).toBe(2);
		expect(roster.find((r) => r.bioguideId === 'H30')!.supporterCount).toBe(1);
		expect(senators.every((s) => s.supporterCount === 3)).toBe(true);
		expect(unavailableDistricts).toEqual([]);
		expect(statesMissingSenators).toEqual([]);
		expect(roster.every((r) => r.provenance === 'self_declared')).toBe(true);
	});

	it('degrades a missing officials file to unavailable, never fabricating or poisoning siblings', () => {
		const hist = { districtCounts: { 'CA-12': 1, 'ZZ-99': 5 }, stateCounts: { CA: 1, ZZ: 5 } };
		const resolved: ResolvedDistrict[] = [
			{ code: 'CA-12', ok: true, officials: [houseRep('CA', '12', 'H12'), senator('CA', 'S1')] },
			{ code: 'ZZ-99', ok: false, officials: [] }
		];
		const { roster, unavailableDistricts, statesMissingSenators } = buildCohortRoster(hist, resolved);
		expect(unavailableDistricts).toEqual(['ZZ-99']);
		expect(roster.find((r) => r.bioguideId === 'H12')).toBeTruthy(); // sibling still resolves
		expect(roster.some((r) => r.state === 'ZZ')).toBe(false); // no fabricated ZZ rep
		// ZZ has supporters but no resolved senators → honestly flagged, not invented
		expect(statesMissingSenators).toContain('ZZ');
	});

	it('a state with no in-cohort district yields no fabricated senators (honest gap)', () => {
		const hist = { districtCounts: {}, stateCounts: { NY: 4 } };
		const { roster, statesMissingSenators } = buildCohortRoster(hist, []);
		expect(roster).toEqual([]);
		expect(statesMissingSenators).toEqual(['NY']);
	});
});

describe('normalizeDistrictCode (anti-spoof / dedup)', () => {
	it('normalizes case + whitespace so dupes collapse', () => {
		expect(normalizeDistrictCode(' ca-12 ')).toBe('CA-12');
		expect(normalizeDistrictCode('VT-AL')).toBe('VT-AL');
	});
	it('rejects path-traversal / injection / malformed codes', () => {
		expect(normalizeDistrictCode('../../etc')).toBeNull();
		expect(normalizeDistrictCode('CA-12; DROP')).toBeNull();
		expect(normalizeDistrictCode('CA12')).toBeNull();
		expect(normalizeDistrictCode('')).toBeNull();
		expect(normalizeDistrictCode(undefined)).toBeNull();
	});
	it('accepts a valid-format-but-unknown code (resolves to "unavailable" downstream, not rejected here)', () => {
		expect(normalizeDistrictCode('ZZ-99')).toBe('ZZ-99');
	});
	it('normalizeStateCode accepts two letters, rejects junk', () => {
		expect(normalizeStateCode('ca')).toBe('CA');
		expect(normalizeStateCode('California')).toBeNull();
	});
});

describe('cohort path is NOT the per-sender ZK resolver (RV-C1 vector 1)', () => {
	const files = [
		'src/lib/core/targets/cohort-roster.ts',
		'convex/targets.ts',
		'src/routes/api/org/[slug]/representatives/resolve/+server.ts'
	].map((p) => readFileSync(resolve(process.cwd(), p), 'utf8'));

	it('imports none of the resolver/witness/decrypt machinery', () => {
		// Scope to actual import statements — the source comments deliberately NAME
		// these to document what the cohort path must not do.
		const forbidden = [
			'LocalConstituentResolver',
			'constituent-resolver',
			'local-resolver',
			'resolver-gates',
			'reconcileCellGate',
			'witness-decryption',
			'decryptWitness',
			'getConstituentResolver'
		];
		for (const src of files) {
			const imports = src
				.split('\n')
				.filter((l) => /^\s*import\b/.test(l))
				.join('\n');
			for (const f of forbidden) {
				expect(imports, `forbidden import "${f}"`).not.toContain(f);
			}
		}
	});

	it('the endpoint resolves via the stateless getOfficials primitive only', () => {
		const endpoint = files[2];
		expect(endpoint).toContain("getOfficials");
		expect(endpoint).toContain('$lib/core/shadow-atlas/client');
	});
});
