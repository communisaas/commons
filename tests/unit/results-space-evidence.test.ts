import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	NO_REPORTS_DELIVERED_SENTENCE,
	NO_RESPONSES_LOGGED_SENTENCE,
	NO_VERIFIED_ACTIONS_SENTENCE,
	deriveDistrictReach,
	deriveResultsHeadline,
	describeResponseActivity
} from '$lib/components/org/os/results-evidence';
import type {
	ReturnSpaceData,
	ReturnSpaceReceiptSummary
} from '$lib/components/org/os/spaces';
import type { VerificationPacket } from '$lib/types/verification-packet';

function makePacket(overrides: Partial<VerificationPacket> = {}): VerificationPacket {
	return {
		verified: 120,
		total: 150,
		verifiedPct: 80,
		districtCount: 14,
		authorship: { individual: 90, shared: 30, unknown: 30, explicit: true },
		dateRange: { earliest: '2026-05-01', latest: '2026-06-01', spanDays: 31 },
		identityBreakdown: { govId: 40, addressVerified: 80, emailOnly: 20, unverified: 10 },
		gds: 0.8,
		ald: 0.7,
		temporalEntropy: 3.1,
		burstVelocity: 1.4,
		cai: 1.2,
		tiers: [],
		geography: [
			{ hash: 'd1', count: 38 },
			{ hash: 'd2', count: 22 },
			{ hash: 'd3', count: 10 }
		],
		cells: null,
		temporal: null,
		driftCount: null,
		driftPct: null,
		debate: null,
		lastUpdated: '2026-06-01T00:00:00.000Z',
		...overrides
	};
}

function makeReceipts(
	overrides: Partial<ReturnSpaceReceiptSummary> = {}
): ReturnSpaceReceiptSummary {
	return {
		loadedCount: 12,
		pendingCount: 2,
		responseLoggedCount: 3,
		anchorFieldCount: 0,
		proofWeightTotal: 24,
		latestProofDeliveredAt: '2026-03-04T12:00:00.000Z',
		sampleLimit: 200,
		...overrides
	};
}

function makeReturnSpaceData(overrides: Partial<ReturnSpaceData> = {}): ReturnSpaceData {
	return {
		funnel: { imported: 0, postalResolved: 0, identityVerified: 0, districtVerified: 0 },
		tiers: [],
		growth: { thisWeek: 0, lastWeek: 0 },
		campaigns: [],
		topCampaignId: null,
		packet: makePacket(),
		stats: { supporters: 0, campaigns: 0, activeCampaigns: 0, members: 0, sentEmails: 0 },
		receipts: makeReceipts(),
		...overrides
	};
}

describe('results headline numbers', () => {
	it('derives the four numbers from the packet and receipt summary', () => {
		const headline = deriveResultsHeadline(makeReturnSpaceData());
		expect(headline).toEqual({
			verifiedConstituents: 120,
			districtsReached: 14,
			proofReportsDelivered: 12,
			responsesLogged: 3
		});
	});

	it('falls back to per-campaign verified totals when no packet has been computed', () => {
		const headline = deriveResultsHeadline(
			makeReturnSpaceData({
				packet: null,
				campaigns: [
					{
						id: 'c1',
						title: 'One',
						type: 'advocacy',
						status: 'active',
						totalActions: 40,
						verifiedActions: 25,
						updatedAt: '2026-06-01T00:00:00.000Z'
					},
					{
						id: 'c2',
						title: 'Two',
						type: 'advocacy',
						status: 'active',
						totalActions: 20,
						verifiedActions: 11,
						updatedAt: '2026-06-01T00:00:00.000Z'
					}
				]
			})
		);
		expect(headline.verifiedConstituents).toBe(36);
		expect(headline.districtsReached).toBe(0);
	});
});

describe('where it landed', () => {
	it('ranks the top districts with counts and shares', () => {
		const reach = deriveDistrictReach(makePacket().geography);
		expect(reach).toHaveLength(3);
		expect(reach[0]).toMatchObject({ label: 'Top district', count: 38 });
		expect(reach[1].label).toBe('2nd district');
		expect(reach[0].sharePct).toBeGreaterThan(reach[2].sharePct);
	});

	it('returns no rows when the packet carries no geography', () => {
		expect(deriveDistrictReach(null)).toEqual([]);
		expect(deriveDistrictReach([])).toEqual([]);
	});
});

describe('response activity sentence', () => {
	it('reads as a sentence with the logged count and last delivery date', () => {
		const sentence = describeResponseActivity(makeReceipts());
		expect(sentence).toContain('3 responses logged');
		expect(sentence).toContain('awaiting response');
		expect(sentence).toContain('last report delivered');
		expect(sentence).toMatch(/\.$/);
	});

	it('says the sample is bounded when the loaded count hits the cap', () => {
		const sentence = describeResponseActivity(makeReceipts({ loadedCount: 200 }));
		expect(sentence).toContain('of the most recent 200');
	});

	it('is absent (not a zero) when no reports have been delivered', () => {
		expect(
			describeResponseActivity(
				makeReceipts({ loadedCount: 0, responseLoggedCount: 0, pendingCount: 0 })
			)
		).toBeNull();
	});
});

describe('proof-language empty states', () => {
	it('phrases absence as a sentence, never a bare zero', () => {
		expect(NO_VERIFIED_ACTIONS_SENTENCE).toMatch(/^No verified actions yet/);
		expect(NO_RESPONSES_LOGGED_SENTENCE).toMatch(/^No responses logged yet/);
		expect(NO_REPORTS_DELIVERED_SENTENCE).toMatch(/^No proof reports delivered yet/);
	});
});

describe('Results surface contract', () => {
	const source = readFileSync('src/lib/components/org/os/ReturnSpace.svelte', 'utf8');

	it('labels the four headline numbers in staffer-legible words', () => {
		expect(source).toContain('verified constituents');
		expect(source).toContain('districts reached');
		expect(source).toContain('proof reports delivered');
		expect(source).toContain('responses logged');
	});

	it('keeps the proof packet mounted with its anchor targets', () => {
		expect(source).toContain("'$lib/components/org/VerificationPacket.svelte'");
		expect(source).toContain('id="results-packet"');
		expect(source).toContain('id="action-records"');
	});

	// Excised vocabulary is assembled from fragments so it never appears
	// verbatim in this file either.
	const SP = ' ';
	const RAW_COUNTER_LABELS = new RegExp(
		[`receipt${SP}rows`, `active${SP}records`, `packet${SP}verified`].join('|'),
		'i'
	);
	const MACHINERY_IMPORTS = new RegExp(
		[
			'capability-hyper' + 'graph',
			'capability-state-' + 'labels',
			'capability-' + 'clusters',
			'WorkspaceCapability' + 'Strip'
		].join('|')
	);

	it('carries no raw counter labels', () => {
		expect(source).not.toMatch(RAW_COUNTER_LABELS);
	});

	it('imports none of the internal capability machinery', () => {
		expect(source).not.toMatch(MACHINERY_IMPORTS);
	});

	it('keeps provenance whispers off the dashboard numbers', () => {
		expect(source).not.toMatch(new RegExp('cite' + '='));
	});

	it('keeps engagement-tier vocabulary out of the surface', () => {
		expect(source).not.toMatch(/\btiers?\b/i);
		expect(source).not.toMatch(/engagement/i);
	});
});
