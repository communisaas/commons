/**
 * Attestation verifier — byte-parity + recipient-block parsing (A1).
 *
 * The browser verifier reproduces the committed packetDigest from the values the
 * recipient pastes out of the email's "Verify offline" block. Two guarantees
 * are locked here:
 *  1. `buildCanonicalPreimage` (client) is byte-identical to `canonicalPreimage`
 *     (server) — the SSOT-drift failure that shipped the false-mismatch bug.
 *  2. `parseOfflineVerifyBlock` reconstructs a struct that reproduces the hash,
 *     including the display-token mappings ((no identity breakdown)/(empty)) and
 *     the trailing empty debate field.
 */
import { describe, it, expect } from 'vitest';
import {
	buildCanonicalPreimage,
	parseOfflineVerifyBlock,
	parseGeography,
	parseIdentity,
	parseAuthorship,
	type AttestationPreimage
} from '$lib/core/crypto/attestation-verify';
import { canonicalPreimage, renderReport } from '$lib/server/email/report-template';
import type { VerificationPacket } from '$lib/types/verification-packet';

function preimageFor(ov: Partial<AttestationPreimage> = {}): AttestationPreimage {
	return {
		campaignId: 'camp_123',
		campaignTitle: 'Protect the Watershed',
		orgName: 'Rivers Coalition',
		verified: 42,
		districtCount: 7,
		authorship: { individual: 30, shared: 12, explicit: true },
		dateRange: { earliest: '2026-01-01', latest: '2026-02-01', spanDays: 31 },
		identityBreakdown: { govId: 5, addressVerified: 20, emailOnly: 17 },
		geography: [
			{ hash: 'h2', count: 9 },
			{ hash: 'h1', count: 9 },
			{ hash: 'h3', count: 3 }
		],
		debate: null,
		...ov
	};
}

// canonicalPreimage only reads {campaignId, campaignTitle, orgName, packet:{...}}.
function ctxFor(p: AttestationPreimage) {
	return {
		campaignId: p.campaignId,
		campaignTitle: p.campaignTitle,
		orgName: p.orgName,
		packet: {
			verified: p.verified,
			districtCount: p.districtCount,
			authorship: { ...p.authorship, unknown: 0 },
			dateRange: p.dateRange,
			identityBreakdown: p.identityBreakdown,
			geography: p.geography,
			debate: p.debate
		}
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
	} as any;
}

describe('byte-parity: buildCanonicalPreimage === canonicalPreimage', () => {
	const cases: Array<[string, Partial<AttestationPreimage>]> = [
		['baseline', {}],
		['null identity', { identityBreakdown: null }],
		['empty geography', { geography: [] }],
		['null geography', { geography: null }],
		['single district', { geography: [{ hash: 'h1', count: 5 }] }],
		[
			'unsorted multi-district (tie on count)',
			{
				geography: [
					{ hash: 'b', count: 2 },
					{ hash: 'a', count: 9 },
					{ hash: 'c', count: 9 }
				]
			}
		],
		[
			'present debate',
			{
				debate: {
					marketPosition: 'support',
					totalStake: '100',
					topArgumentScore: '5',
					aiPanelConsensus: 0.7,
					participantCount: 12,
					resolutionHash: 'rh'
				}
			}
		]
	];
	it.each(cases)('byte-identical: %s', (_name, ov) => {
		const p = preimageFor(ov);
		expect(buildCanonicalPreimage(p)).toBe(canonicalPreimage(ctxFor(p)));
	});
});

describe('field parsers', () => {
	it('identity: tokens and empty map to null', () => {
		expect(parseIdentity('(no identity breakdown)')).toBeNull();
		expect(parseIdentity('')).toBeNull();
		expect(parseIdentity('5|20|17')).toEqual({ govId: 5, addressVerified: 20, emailOnly: 17 });
		expect(() => parseIdentity('5|20')).toThrow();
	});
	it('geography: tokens map to [], pairs parse, garbage rejected', () => {
		expect(parseGeography('(empty)')).toEqual([]);
		expect(parseGeography('')).toEqual([]);
		expect(parseGeography('h1=9,h2=3')).toEqual([
			{ hash: 'h1', count: 9 },
			{ hash: 'h2', count: 3 }
		]);
		expect(() => parseGeography('h1=9,garbage')).toThrow();
	});
	it('authorship: explicit flag is 1/0', () => {
		expect(parseAuthorship('30|12|1')).toEqual({ individual: 30, shared: 12, explicit: true });
		expect(parseAuthorship('30|12|0')).toEqual({ individual: 30, shared: 12, explicit: false });
	});
});

describe('whole-block round-trip', () => {
	function block(p: AttestationPreimage, geoOrder?: AttestationPreimage['geography']): string {
		const ib = p.identityBreakdown
			? `${p.identityBreakdown.govId}|${p.identityBreakdown.addressVerified}|${p.identityBreakdown.emailOnly}`
			: '(no identity breakdown)';
		const auth = `${p.authorship.individual}|${p.authorship.shared}|${p.authorship.explicit ? 1 : 0}`;
		const dr = `${p.dateRange.earliest}|${p.dateRange.latest}|${p.dateRange.spanDays}`;
		const geo =
			(geoOrder ?? p.geography ?? []).map((g) => `${g.hash}=${g.count}`).join(',') || '(empty)';
		return [
			'    voter-protocol-report-v1',
			`    campaign:${p.campaignId}`,
			`    ${p.campaignTitle}`,
			`    ${p.orgName}`,
			`    ${p.verified}`,
			`    ${p.districtCount}`,
			`    ${ib}`,
			`    ${auth}`,
			`    ${dr}`,
			`    ${geo}`
		].join('\n');
	}

	it('a pasted block reproduces the committed preimage', () => {
		const p = preimageFor();
		const parsed = parseOfflineVerifyBlock(block(p));
		expect('error' in parsed).toBe(false);
		expect(buildCanonicalPreimage(parsed as AttestationPreimage)).toBe(canonicalPreimage(ctxFor(p)));
	});

	it('a REORDERED geography paste still verifies (client re-sorts)', () => {
		const p = preimageFor();
		const shuffled = [
			{ hash: 'h3', count: 3 },
			{ hash: 'h1', count: 9 },
			{ hash: 'h2', count: 9 }
		];
		const parsed = parseOfflineVerifyBlock(block(p, shuffled));
		expect(buildCanonicalPreimage(parsed as AttestationPreimage)).toBe(canonicalPreimage(ctxFor(p)));
	});

	it('null-identity + empty-geography campaign still verifies via the tokens', () => {
		const p = preimageFor({ identityBreakdown: null, geography: [] });
		const parsed = parseOfflineVerifyBlock(block(p));
		expect(buildCanonicalPreimage(parsed as AttestationPreimage)).toBe(canonicalPreimage(ctxFor(p)));
	});

	it('missing marker → typed error, not a silent partial', () => {
		expect(parseOfflineVerifyBlock('nothing useful here')).toHaveProperty('error');
	});
});

describe('email-to-verifier loop (render → parse → hash)', () => {
	function fullPacket(ov: Partial<VerificationPacket> = {}): VerificationPacket {
		return {
			verified: 42,
			total: 50,
			verifiedPct: 84,
			districtCount: 7,
			authorship: { individual: 30, shared: 12, unknown: 0, explicit: true },
			dateRange: { earliest: '2026-01-01', latest: '2026-02-01', spanDays: 31 },
			identityBreakdown: { govId: 5, addressVerified: 20, emailOnly: 17, unverified: 8 },
			gds: 0.8,
			ald: 0.9,
			temporalEntropy: 0.7,
			burstVelocity: 1.2,
			cai: 0.5,
			tiers: [{ tier: 2, label: 'Address verified', count: 20 }],
			geography: [
				{ hash: 'h2', count: 9 },
				{ hash: 'h1', count: 9 },
				{ hash: 'h3', count: 3 }
			],
			cells: null,
			temporal: null,
			driftCount: null,
			driftPct: null,
			debate: null,
			lastUpdated: '2026-02-01',
			...ov
		};
	}

	it('the printed offline block reproduces the rendered attestation hash', async () => {
		const packet = fullPacket();
		const rendered = await renderReport({
			campaignId: 'camp_123',
			campaignTitle: 'Protect the Watershed',
			orgName: 'Rivers Coalition',
			packet,
			verificationUrl: 'https://commons.email/v/camp_123'
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
		} as any);
		const parsed = parseOfflineVerifyBlock(rendered.text);
		expect('error' in parsed).toBe(false);
		const { computeAttestationHash } = await import('$lib/core/crypto/attestation-verify');
		const recomputed = await computeAttestationHash(parsed as AttestationPreimage);
		expect(recomputed).toBe(rendered.attestationHash);
	});

	it('a DEBATE campaign closes the loop (debate field printed + parsed)', async () => {
		const packet = fullPacket({
			debate: {
				marketPosition: 'support',
				totalStake: '100',
				topArgumentScore: '5',
				aiPanelConsensus: 0.7,
				participantCount: 12,
				resolutionHash: 'rh'
			}
		});
		const rendered = await renderReport({
			campaignId: 'camp_d',
			campaignTitle: 'Debate Campaign',
			orgName: 'Org',
			packet,
			verificationUrl: 'https://commons.email/v/camp_d'
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
		} as any);
		const parsed = parseOfflineVerifyBlock(rendered.text);
		expect('error' in parsed).toBe(false);
		expect((parsed as AttestationPreimage).debate).not.toBeNull();
		const { computeAttestationHash } = await import('$lib/core/crypto/attestation-verify');
		expect(await computeAttestationHash(parsed as AttestationPreimage)).toBe(
			rendered.attestationHash
		);
	});

	it('a null-identity / empty-geography report still closes the loop', async () => {
		const packet = fullPacket({ identityBreakdown: null, geography: [] });
		const rendered = await renderReport({
			campaignId: 'camp_x',
			campaignTitle: 'Edge Case',
			orgName: 'Org',
			packet,
			verificationUrl: 'https://commons.email/v/camp_x'
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
		} as any);
		const parsed = parseOfflineVerifyBlock(rendered.text);
		const { computeAttestationHash } = await import('$lib/core/crypto/attestation-verify');
		expect(await computeAttestationHash(parsed as AttestationPreimage)).toBe(rendered.attestationHash);
	});
});
