/**
 * Action Domain Builder Unit Tests
 *
 * Validates deterministic action domain computation, BN254 field element
 * compliance, input validation, and cross-jurisdiction correctness.
 */

import { describe, it, expect } from 'vitest';
import {
	buildActionDomain,
	buildDebateActionDomain,
	buildCommunityFieldEpochDomain,
	isValidActionDomain,
	type ActionDomainParams
} from '$lib/core/zkp/action-domain-builder';

const BN254_MODULUS =
	21888242871839275222246405745257275088548364400416034343698204186575808495617n;

// Representative district commitments. These do not need to be "real" sponge
// outputs for the action-domain builder to exercise its binding — they just
// need to be valid BN254 field elements. Real commitments live in
// districtCredentials.districtCommitment (Convex) and are produced by the
// Poseidon2 sponge-24 over the user's 24 district slots.
const DC_A = '0x' + '0a'.repeat(32); // 0x0a0a…0a
const DC_B = '0x' + '0b'.repeat(32); // 0x0b0b…0b
const DC_RAW = '0c'.repeat(32); // raw (no 0x prefix), exercise normalization

describe('buildActionDomain', () => {
	const baseParams: ActionDomainParams = {
		country: 'US',
		jurisdictionType: 'federal',
		recipientSubdivision: 'US-CA',
		templateId: 'climate-action-2026',
		sessionId: '119th-congress',
		districtCommitment: DC_A
	};

	it('produces a valid BN254 field element', () => {
		const domain = buildActionDomain(baseParams);

		expect(domain).toMatch(/^0x[0-9a-f]{64}$/);
		expect(BigInt(domain)).toBeLessThan(BN254_MODULUS);
		expect(BigInt(domain)).toBeGreaterThanOrEqual(0n);
	});

	it('is deterministic — same params produce same domain', () => {
		const domain1 = buildActionDomain(baseParams);
		const domain2 = buildActionDomain({ ...baseParams });

		expect(domain1).toBe(domain2);
	});

	it('different countries produce different domains', () => {
		const domainUS = buildActionDomain(baseParams);
		const domainGB = buildActionDomain({ ...baseParams, country: 'GB' });

		expect(domainUS).not.toBe(domainGB);
	});

	it('different jurisdiction types produce different domains', () => {
		const domainFederal = buildActionDomain(baseParams);
		const domainState = buildActionDomain({ ...baseParams, jurisdictionType: 'state' });

		expect(domainFederal).not.toBe(domainState);
	});

	it('different recipient subdivisions produce different domains', () => {
		const domainCA = buildActionDomain(baseParams);
		const domainNY = buildActionDomain({ ...baseParams, recipientSubdivision: 'US-NY' });

		expect(domainCA).not.toBe(domainNY);
	});

	it('different templates produce different domains', () => {
		const domain1 = buildActionDomain(baseParams);
		const domain2 = buildActionDomain({ ...baseParams, templateId: 'healthcare-reform' });

		expect(domain1).not.toBe(domain2);
	});

	it('different sessions produce different domains', () => {
		const domain1 = buildActionDomain(baseParams);
		const domain2 = buildActionDomain({ ...baseParams, sessionId: '120th-congress' });

		expect(domain1).not.toBe(domain2);
	});

	it('handles all jurisdiction types', () => {
		const types = ['federal', 'state', 'local', 'international'] as const;
		const domains = new Set<string>();

		for (const jurisdictionType of types) {
			const domain = buildActionDomain({ ...baseParams, jurisdictionType });
			expect(BigInt(domain)).toBeLessThan(BN254_MODULUS);
			domains.add(domain);
		}

		expect(domains.size).toBe(4);
	});

	it('handles international jurisdiction', () => {
		const domain = buildActionDomain({
			country: 'BE',
			jurisdictionType: 'international',
			recipientSubdivision: 'EU',
			templateId: 'digital-markets-act',
			sessionId: '2024-2029',
			districtCommitment: DC_A
		});

		expect(domain).toMatch(/^0x[0-9a-f]{64}$/);
		expect(BigInt(domain)).toBeLessThan(BN254_MODULUS);
	});

	it('handles local jurisdiction', () => {
		const domain = buildActionDomain({
			country: 'US',
			jurisdictionType: 'local',
			recipientSubdivision: 'US-CA-san-francisco',
			templateId: 'housing-density',
			sessionId: '2026-board',
			districtCommitment: DC_A
		});

		expect(domain).toMatch(/^0x[0-9a-f]{64}$/);
		expect(BigInt(domain)).toBeLessThan(BN254_MODULUS);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// F2 closure: district_commitment binding tests
// ═══════════════════════════════════════════════════════════════════════════

describe('buildActionDomain — district_commitment binding (F2 closure)', () => {
	const base: ActionDomainParams = {
		country: 'US',
		jurisdictionType: 'federal',
		recipientSubdivision: 'US-CA-12',
		templateId: 'climate-action-2026',
		sessionId: '119th-congress',
		districtCommitment: DC_A
	};

	it('same inputs but DIFFERENT district_commitments produce DISTINCT domains', () => {
		// This is the core F2 structural closure: a user who re-verifies their
		// address to a new district MUST NOT produce the same nullifier scope
		// as before, even if template, session, and subdivision are identical.
		const domainA = buildActionDomain({ ...base, districtCommitment: DC_A });
		const domainB = buildActionDomain({ ...base, districtCommitment: DC_B });
		expect(domainA).not.toBe(domainB);
	});

	it('is deterministic when district_commitment is held constant', () => {
		const d1 = buildActionDomain(base);
		const d2 = buildActionDomain({ ...base });
		expect(d1).toBe(d2);
	});

	it('normalizes 0x-prefixed and raw hex district_commitments identically', () => {
		const prefixed = buildActionDomain({
			...base,
			districtCommitment: '0x' + DC_RAW
		});
		const raw = buildActionDomain({
			...base,
			districtCommitment: DC_RAW
		});
		expect(prefixed).toBe(raw);
	});

	it('district_commitment change overrides otherwise identical (template, session, subdivision)', () => {
		// Explicit attack-surface test: the old action_domain recipe made the
		// returned domain identical across any credential rotation since
		// (template, session, subdivision) were client-stable. With
		// district_commitment binding, a rotated credential (new commitment)
		// guarantees a new domain.
		const pre = buildActionDomain({
			country: 'US',
			jurisdictionType: 'federal',
			recipientSubdivision: 'US-CA-12',
			templateId: 'climate-action-2026',
			sessionId: '119th-congress',
			districtCommitment: DC_A
		});
		const post = buildActionDomain({
			country: 'US',
			jurisdictionType: 'federal',
			recipientSubdivision: 'US-CA-12', // client might report the same string
			templateId: 'climate-action-2026',
			sessionId: '119th-congress',
			districtCommitment: DC_B // but commitment changed on re-verification
		});
		expect(pre).not.toBe(post);
	});

	it('different district_commitments cannot accidentally collide for the same base tuple', () => {
		const s = new Set<string>();
		const commitments = [
			'0x' + '01'.repeat(32),
			'0x' + '02'.repeat(32),
			'0x' + '03'.repeat(32),
			'0x' + '04'.repeat(32),
			'0x' + '05'.repeat(32)
		];
		for (const dc of commitments) {
			s.add(buildActionDomain({ ...base, districtCommitment: dc }));
		}
		expect(s.size).toBe(commitments.length);
	});

	it('produces a BN254 field element for any valid commitment', () => {
		for (const dc of [DC_A, DC_B, '0x' + DC_RAW]) {
			const domain = buildActionDomain({ ...base, districtCommitment: dc });
			expect(domain).toMatch(/^0x[0-9a-f]{64}$/);
			expect(BigInt(domain)).toBeLessThan(BN254_MODULUS);
			expect(BigInt(domain)).toBeGreaterThanOrEqual(0n);
		}
	});
});

describe('buildActionDomain validation', () => {
	it('rejects empty country', () => {
		expect(() =>
			buildActionDomain({
				country: '',
				jurisdictionType: 'federal',
				recipientSubdivision: 'national',
				templateId: 'test',
				sessionId: 'test',
				districtCommitment: DC_A
			})
		).toThrow('country is required');
	});

	it('rejects non-2-char country code', () => {
		expect(() =>
			buildActionDomain({
				country: 'USA',
				jurisdictionType: 'federal',
				recipientSubdivision: 'national',
				templateId: 'test',
				sessionId: 'test',
				districtCommitment: DC_A
			})
		).toThrow('must be 2-character ISO code');
	});

	it('rejects invalid jurisdiction type', () => {
		expect(() =>
			buildActionDomain({
				country: 'US',
				jurisdictionType: 'municipal' as any,
				recipientSubdivision: 'national',
				templateId: 'test',
				sessionId: 'test',
				districtCommitment: DC_A
			})
		).toThrow('jurisdictionType must be one of');
	});

	it('rejects empty recipientSubdivision', () => {
		expect(() =>
			buildActionDomain({
				country: 'US',
				jurisdictionType: 'federal',
				recipientSubdivision: '',
				templateId: 'test',
				sessionId: 'test',
				districtCommitment: DC_A
			})
		).toThrow('recipientSubdivision is required');
	});

	it('rejects empty templateId', () => {
		expect(() =>
			buildActionDomain({
				country: 'US',
				jurisdictionType: 'federal',
				recipientSubdivision: 'national',
				templateId: '',
				sessionId: 'test',
				districtCommitment: DC_A
			})
		).toThrow('templateId is required');
	});

	it('rejects empty sessionId', () => {
		expect(() =>
			buildActionDomain({
				country: 'US',
				jurisdictionType: 'federal',
				recipientSubdivision: 'national',
				templateId: 'test',
				sessionId: '',
				districtCommitment: DC_A
			})
		).toThrow('sessionId is required');
	});

	it('rejects missing districtCommitment', () => {
		expect(() =>
			buildActionDomain({
				country: 'US',
				jurisdictionType: 'federal',
				recipientSubdivision: 'national',
				templateId: 'test',
				sessionId: 'test'
				// districtCommitment deliberately omitted
			} as unknown as ActionDomainParams)
		).toThrow('districtCommitment is required');
	});

	it('rejects empty districtCommitment', () => {
		expect(() =>
			buildActionDomain({
				country: 'US',
				jurisdictionType: 'federal',
				recipientSubdivision: 'national',
				templateId: 'test',
				sessionId: 'test',
				districtCommitment: ''
			})
		).toThrow('districtCommitment is required');
	});

	it('rejects malformed districtCommitment (non-hex)', () => {
		expect(() =>
			buildActionDomain({
				country: 'US',
				jurisdictionType: 'federal',
				recipientSubdivision: 'national',
				templateId: 'test',
				sessionId: 'test',
				districtCommitment: 'not-hex-not-hex-not-hex-not-hex-not-hex-not-hex-not-hex-not-hex-'
			})
		).toThrow('districtCommitment must be 64-hex chars');
	});

	it('rejects districtCommitment with wrong length', () => {
		expect(() =>
			buildActionDomain({
				country: 'US',
				jurisdictionType: 'federal',
				recipientSubdivision: 'national',
				templateId: 'test',
				sessionId: 'test',
				districtCommitment: '0xdead' // too short
			})
		).toThrow('districtCommitment must be 64-hex chars');
	});

	it('rejects districtCommitment >= BN254_MODULUS', () => {
		// BN254_MODULUS is ~254 bits, so all-0xff (256 bits of 1s) exceeds it.
		expect(() =>
			buildActionDomain({
				country: 'US',
				jurisdictionType: 'federal',
				recipientSubdivision: 'national',
				templateId: 'test',
				sessionId: 'test',
				districtCommitment: '0x' + 'ff'.repeat(32)
			})
		).toThrow('valid BN254 field element');
	});

	it('accepts districtCommitment = modulus - 1 (max valid)', () => {
		const maxValid = '0x' + (BN254_MODULUS - 1n).toString(16).padStart(64, '0');
		const domain = buildActionDomain({
			country: 'US',
			jurisdictionType: 'federal',
			recipientSubdivision: 'national',
			templateId: 'test',
			sessionId: 'test',
			districtCommitment: maxValid
		});
		expect(domain).toMatch(/^0x[0-9a-f]{64}$/);
	});

	it('accepts districtCommitment = 0 (valid edge case)', () => {
		// Note: in practice the sponge-24 construction with DOMAIN_SPONGE_24 in
		// the capacity slot cannot realistically produce 0, but the builder
		// itself must not reject 0 as it is a valid field element.
		const domain = buildActionDomain({
			country: 'US',
			jurisdictionType: 'federal',
			recipientSubdivision: 'national',
			templateId: 'test',
			sessionId: 'test',
			districtCommitment: '0x' + '0'.repeat(64)
		});
		expect(domain).toMatch(/^0x[0-9a-f]{64}$/);
	});
});

describe('isValidActionDomain', () => {
	it('validates correct field elements', () => {
		const domain = buildActionDomain({
			country: 'US',
			jurisdictionType: 'federal',
			recipientSubdivision: 'US-CA',
			templateId: 'test',
			sessionId: 'test',
			districtCommitment: DC_A
		});

		expect(isValidActionDomain(domain)).toBe(true);
	});

	it('rejects values >= BN254 modulus', () => {
		const tooLarge = '0x' + BN254_MODULUS.toString(16);
		expect(isValidActionDomain(tooLarge)).toBe(false);
	});

	it('accepts zero', () => {
		expect(isValidActionDomain('0x' + '0'.repeat(64))).toBe(true);
	});

	it('accepts modulus - 1', () => {
		const maxValid = '0x' + (BN254_MODULUS - 1n).toString(16).padStart(64, '0');
		expect(isValidActionDomain(maxValid)).toBe(true);
	});

	it('rejects invalid hex', () => {
		expect(isValidActionDomain('not-hex')).toBe(false);
	});

	it('works without 0x prefix', () => {
		const domain = buildActionDomain({
			country: 'US',
			jurisdictionType: 'federal',
			recipientSubdivision: 'US-CA',
			templateId: 'test',
			sessionId: 'test',
			districtCommitment: DC_A
		});

		expect(isValidActionDomain(domain.slice(2))).toBe(true);
	});
});

describe('buildDebateActionDomain', () => {
	const baseDomain = buildActionDomain({
		country: 'US',
		jurisdictionType: 'federal',
		recipientSubdivision: 'US-CA',
		templateId: 'climate-action-2026',
		sessionId: '119th-congress',
		districtCommitment: DC_A
	});
	const propositionHash = '0x' + 'ab'.repeat(32);

	it('produces a valid BN254 field element', () => {
		const debateDomain = buildDebateActionDomain(baseDomain, propositionHash);
		expect(debateDomain).toMatch(/^0x[0-9a-f]{64}$/);
		expect(isValidActionDomain(debateDomain)).toBe(true);
	});

	it('is deterministic', () => {
		const d1 = buildDebateActionDomain(baseDomain, propositionHash);
		const d2 = buildDebateActionDomain(baseDomain, propositionHash);
		expect(d1).toBe(d2);
	});

	it('differs from the base domain', () => {
		const debateDomain = buildDebateActionDomain(baseDomain, propositionHash);
		expect(debateDomain).not.toBe(baseDomain);
	});

	it('different propositions produce different debate domains', () => {
		const hash1 = '0x' + 'ab'.repeat(32);
		const hash2 = '0x' + 'cd'.repeat(32);
		const d1 = buildDebateActionDomain(baseDomain, hash1);
		const d2 = buildDebateActionDomain(baseDomain, hash2);
		expect(d1).not.toBe(d2);
	});

	it('different base domains produce different debate domains', () => {
		const base2 = buildActionDomain({
			country: 'GB',
			jurisdictionType: 'federal',
			recipientSubdivision: 'national',
			templateId: 'nhs-reform',
			sessionId: '2024-parliament',
			districtCommitment: DC_A
		});
		const d1 = buildDebateActionDomain(baseDomain, propositionHash);
		const d2 = buildDebateActionDomain(base2, propositionHash);
		expect(d1).not.toBe(d2);
	});

	it('rejects invalid baseDomain', () => {
		expect(() => buildDebateActionDomain('not-a-domain', propositionHash))
			.toThrow('Invalid baseDomain');
	});

	it('rejects invalid propositionHash', () => {
		expect(() => buildDebateActionDomain(baseDomain, 'short'))
			.toThrow('Invalid propositionHash');
	});
});

describe('buildCommunityFieldEpochDomain', () => {
	const baseDomain = buildActionDomain({
		country: 'US',
		jurisdictionType: 'federal',
		recipientSubdivision: 'US-CA',
		templateId: 'climate-action-2026',
		sessionId: '119th-congress',
		districtCommitment: DC_A
	});

	it('produces a valid BN254 field element', () => {
		const domain = buildCommunityFieldEpochDomain(baseDomain, new Date('2026-03-02T12:00:00Z'));
		expect(domain).toMatch(/^0x[0-9a-f]{64}$/);
		expect(BigInt(domain)).toBeLessThan(BN254_MODULUS);
	});

	it('is deterministic for same date', () => {
		const d1 = buildCommunityFieldEpochDomain(baseDomain, new Date('2026-03-02T08:00:00Z'));
		const d2 = buildCommunityFieldEpochDomain(baseDomain, new Date('2026-03-02T23:59:59Z'));
		// Same date (2026-03-02) → same domain regardless of time
		expect(d1).toBe(d2);
	});

	it('different dates produce different domains', () => {
		const d1 = buildCommunityFieldEpochDomain(baseDomain, new Date('2026-03-02T00:00:00Z'));
		const d2 = buildCommunityFieldEpochDomain(baseDomain, new Date('2026-03-03T00:00:00Z'));
		expect(d1).not.toBe(d2);
	});

	it('different base domains produce different epoch domains', () => {
		const otherBase = buildActionDomain({
			country: 'US',
			jurisdictionType: 'state',
			recipientSubdivision: 'US-NY',
			templateId: 'housing-reform-2026',
			sessionId: '2026-session',
			districtCommitment: DC_A
		});
		const d1 = buildCommunityFieldEpochDomain(baseDomain, new Date('2026-03-02T00:00:00Z'));
		const d2 = buildCommunityFieldEpochDomain(otherBase, new Date('2026-03-02T00:00:00Z'));
		expect(d1).not.toBe(d2);
	});

	it('rejects invalid baseDomain', () => {
		expect(() => buildCommunityFieldEpochDomain('not-valid', new Date()))
			.toThrow('Invalid baseDomain');
	});
});
