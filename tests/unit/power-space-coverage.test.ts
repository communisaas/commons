import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	DECISION_MAKER_COVERAGE_SENTENCE,
	NO_FOLLOWED_DECISION_MAKERS_SENTENCE,
	NO_WATCHED_BILLS_SENTENCE,
	POWER_UNAVAILABLE_SENTENCE,
	SCORECARDS_BUILD_SENTENCE,
	describePowerPosition,
	describeRelevantBills,
	describeReportSignals
} from '$lib/components/org/os/power-coverage';

describe('power position headline', () => {
	it('reads followed, watched, and scored in plain words', () => {
		expect(
			describePowerPosition({
				followedCount: 3,
				watchedBillCount: 2,
				scorecardSnapshotCount: 4,
				scorecardAvg: 71,
				legislationEnabled: true
			})
		).toBe('3 decision-makers followed · 2 bills watched · 4 scorecards averaging 71');
	});

	it('omits zero parts instead of rendering bare zeros', () => {
		expect(
			describePowerPosition({
				followedCount: 1,
				watchedBillCount: 0,
				scorecardSnapshotCount: 0,
				scorecardAvg: null,
				legislationEnabled: true
			})
		).toBe('1 decision-maker followed');
	});

	it('keeps bill and scorecard parts off when legislation is not enabled', () => {
		expect(
			describePowerPosition({
				followedCount: 2,
				watchedBillCount: 5,
				scorecardSnapshotCount: 3,
				scorecardAvg: 50,
				legislationEnabled: false
			})
		).toBe('2 decision-makers followed');
	});

	it('returns null when nothing is tracked yet', () => {
		expect(
			describePowerPosition({
				followedCount: 0,
				watchedBillCount: 0,
				scorecardSnapshotCount: 0,
				scorecardAvg: null,
				legislationEnabled: true
			})
		).toBeNull();
	});

	it('formats large counts with locale separators', () => {
		expect(
			describePowerPosition({
				followedCount: 1200,
				watchedBillCount: 0,
				scorecardSnapshotCount: 0,
				scorecardAvg: null,
				legislationEnabled: true
			})
		).toBe('1,200 decision-makers followed');
	});

	it('drops the average when no composite is known', () => {
		expect(
			describePowerPosition({
				followedCount: 0,
				watchedBillCount: 0,
				scorecardSnapshotCount: 2,
				scorecardAvg: null,
				legislationEnabled: true
			})
		).toBe('2 scorecards');
	});
});

describe('relevant bills line', () => {
	it('is silent when the read returned nothing or found nothing', () => {
		expect(describeRelevantBills(null)).toBeNull();
		expect(describeRelevantBills(0)).toBeNull();
	});

	it('uses the singular for one match', () => {
		expect(describeRelevantBills(1)).toBe('1 bill matches your issue areas');
	});

	it('counts matches in plain words', () => {
		expect(describeRelevantBills(4)).toBe('4 bills match your issue areas');
	});
});

describe('report signals sentence', () => {
	it('reads received, opened, and replies in one sentence', () => {
		expect(
			describeReportSignals({ reportsReceived: 212, reportsOpened: 96, repliesLogged: 4 })
		).toBe('212 reports received · 96 opened · 4 replies logged');
	});

	it('omits unknown signals — unknown is not zero', () => {
		expect(
			describeReportSignals({ reportsReceived: 10, reportsOpened: null, repliesLogged: null })
		).toBe('10 reports received');
	});

	it('renders a real zero, because no replies despite reports is information', () => {
		expect(
			describeReportSignals({ reportsReceived: 10, reportsOpened: 5, repliesLogged: 0 })
		).toBe('10 reports received · 5 opened · 0 replies logged');
	});

	it('uses singular nouns for counts of one', () => {
		expect(
			describeReportSignals({ reportsReceived: 1, reportsOpened: null, repliesLogged: 1 })
		).toBe('1 report received · 1 reply logged');
	});
});

describe('coverage and absence sentences', () => {
	it('states decision-maker coverage honestly, congress first', () => {
		expect(DECISION_MAKER_COVERAGE_SENTENCE).toMatch(/^Congress is fully loaded/);
		expect(DECISION_MAKER_COVERAGE_SENTENCE).toContain('State and local officials');
	});

	it('phrases empty follow and watch sets as plain sentences', () => {
		expect(NO_FOLLOWED_DECISION_MAKERS_SENTENCE).toMatch(
			/^You're not following any decision-makers yet/
		);
		expect(NO_WATCHED_BILLS_SENTENCE).toMatch(/^No bills watched yet/);
	});

	it('explains how scorecards come to exist instead of showing a zero', () => {
		expect(SCORECARDS_BUILD_SENTENCE).toMatch(/delivered and answered/);
	});

	it('distinguishes a failed read from an empty result', () => {
		expect(POWER_UNAVAILABLE_SENTENCE).toMatch(/not gone/);
		expect(POWER_UNAVAILABLE_SENTENCE).toMatch(/Reload the page/);
	});
});

// Excised vocabulary is assembled from fragments so it never appears
// verbatim in this file either.
const MACHINERY_IMPORTS = new RegExp(
	[
		'capability-hyper' + 'graph',
		'capability-state-' + 'labels',
		'capability-' + 'clusters',
		'WorkspaceCapability' + 'Strip',
		'GateEvi' + 'dence',
		'Readi' + 'ness'
	].join('|')
);
const ED = 'ed';
const INTERNAL_VOCABULARY = new RegExp(
	`\\b(arm${ED}|not arm${ED}|bound${ED}|draft-on${'ly'}|gat${ED}|postur${'e'}|handof${'f'}|terrai${'n'})\\b`,
	'i'
);

describe('Power surface contract', () => {
	const source = readFileSync('src/lib/components/org/os/LandscapeSpace.svelte', 'utf8');

	it('sections the surface by the org questions in plain words', () => {
		expect(source).toContain('Who decides');
		expect(source).toContain("What they're doing");
		expect(source).toContain('Is your pressure registering');
	});

	it('renders the coverage sentence adjacent to the decision-maker list', () => {
		const coverageAt = source.indexOf('DECISION_MAKER_COVERAGE_SENTENCE}');
		const listAt = source.indexOf('dm-list');
		expect(coverageAt).toBeGreaterThan(-1);
		expect(listAt).toBeGreaterThan(-1);
		expect(coverageAt).toBeLessThan(listAt);
	});

	it('phrases the empty follow set from the shared lead with the find link inline', () => {
		expect(source).toContain('NO_FOLLOWED_DECISION_MAKERS_LEAD');
		expect(source).toContain('>find yours</a>');
	});

	it('keeps the deep links into each tool resolvable', () => {
		expect(source).toContain('{base}/representatives');
		expect(source).toContain('{base}/legislation');
		expect(source).toContain('{base}/scorecards');
	});

	it('imports none of the internal capability machinery', () => {
		expect(source).not.toMatch(MACHINERY_IMPORTS);
	});

	it('carries no internal state vocabulary or planning identifiers', () => {
		expect(source).not.toMatch(INTERNAL_VOCABULARY);
		expect(source).not.toMatch(/\bCP-/);
		expect(source).not.toMatch(/\bT\d+-\d+\b/);
	});

	it('keeps provenance whispers off the surface', () => {
		expect(source).not.toMatch(new RegExp('cite' + '='));
	});
});

describe('Scorecard dashboard contract', () => {
	const source = readFileSync('src/lib/components/org/ScorecardDashboard.svelte', 'utf8');

	it('keeps CSV export and the three sort keys', () => {
		expect(source).toContain('scorecards/export?format=csv');
		expect(source).toContain("'score'");
		expect(source).toContain("'name'");
		expect(source).toContain("'alignment'");
	});

	it('summarizes report signals through the shared sentence helper', () => {
		expect(source).toContain('describeReportSignals');
	});

	it('uses the shared build sentence for the empty state', () => {
		expect(source).toContain('SCORECARDS_BUILD_SENTENCE');
	});

	it('imports none of the internal capability machinery', () => {
		expect(source).not.toMatch(MACHINERY_IMPORTS);
	});

	it('carries no internal state vocabulary or planning identifiers', () => {
		expect(source).not.toMatch(INTERNAL_VOCABULARY);
		expect(source).not.toMatch(/\bCP-/);
		expect(source).not.toMatch(/\bT\d+-\d+\b/);
	});

	it('keeps provenance whispers off the surface', () => {
		expect(source).not.toMatch(new RegExp('cite' + '='));
	});
});

describe('Scorecard card contract', () => {
	const source = readFileSync('src/lib/components/org/ScorecardCard.svelte', 'utf8');

	it('labels the derived response time as an estimate, never as measured', () => {
		expect(source).toContain('Estimated from response rate');
		expect(source).not.toMatch(/Avg:/);
	});

	it('keeps the org-legible engagement labels', () => {
		expect(source).toContain('reports sent');
		expect(source).toContain('opened');
		expect(source).toContain('logged');
	});

	it('carries no internal state vocabulary', () => {
		expect(source).not.toMatch(INTERNAL_VOCABULARY);
		expect(source).not.toMatch(new RegExp('cite' + '='));
	});
});
