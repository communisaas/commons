import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { blocked } from '$lib/core/fact';
import {
	ACTION_FLOOR_WITHHELD_REASON,
	BURST_VELOCITY_REVIEW_THRESHOLD,
	DIAGNOSTIC_ACTION_FLOOR,
	TEMPORAL_WINDOW_WITHHELD_REASON,
	assessIntegrity,
	coordinationReadingFacts,
	factExplanation,
	factStatusLabel,
	floorGatedReading,
	hasBurstWarning
} from '$lib/components/org/integrity-assessment';
import type { IntegrityMetrics } from '$lib/types/verification-packet';

function metrics(overrides: Partial<IntegrityMetrics> = {}): IntegrityMetrics {
	return {
		gds: null,
		ald: null,
		temporalEntropy: null,
		burstVelocity: null,
		cai: null,
		...overrides
	};
}

describe('integrity assessment sentence', () => {
	it('warns only when burst velocity exceeds the review threshold', () => {
		expect(hasBurstWarning(metrics())).toBe(false);
		expect(hasBurstWarning(metrics({ burstVelocity: 0 }))).toBe(false);
		expect(hasBurstWarning(metrics({ burstVelocity: BURST_VELOCITY_REVIEW_THRESHOLD }))).toBe(
			false
		);
		expect(
			hasBurstWarning(metrics({ burstVelocity: BURST_VELOCITY_REVIEW_THRESHOLD + 0.01 }))
		).toBe(true);
		expect(hasBurstWarning(metrics({ burstVelocity: 12 }))).toBe(true);
	});

	it('leads with the spike reading when burst velocity crosses the threshold', () => {
		const text = assessIntegrity(metrics({ burstVelocity: 8, gds: 0.9, ald: 0.9 }));
		expect(text).toMatch(/activity spike/i);
		expect(text).not.toMatch(/spread across/);
	});

	it('reads metrics qualitatively in both directions', () => {
		expect(assessIntegrity(metrics({ gds: 0.9 }))).toMatch(/spread across multiple areas/i);
		expect(assessIntegrity(metrics({ gds: 0.2 }))).toMatch(/concentrated in a few areas/i);
		expect(assessIntegrity(metrics({ ald: 0.9 }))).toMatch(/most messages are distinct/i);
		expect(assessIntegrity(metrics({ ald: 0.3 }))).toMatch(/many messages are similar/i);
		expect(assessIntegrity(metrics({ temporalEntropy: 3 }))).toMatch(/submitted over time/i);
	});

	it('falls back to an accumulating-data line when nothing is computed yet', () => {
		expect(assessIntegrity(metrics())).toMatch(/accumulating data/i);
	});

	it('never leaks numerals into the default reading', () => {
		const cases: IntegrityMetrics[] = [
			metrics(),
			metrics({ gds: 0.71, ald: 0.84, temporalEntropy: 3.2, burstVelocity: 1.4, cai: 0.6 }),
			metrics({ gds: 0.12, ald: 0.31 }),
			metrics({ burstVelocity: 9.5, gds: 0.99 })
		];
		for (const m of cases) {
			expect(assessIntegrity(m)).not.toMatch(/\d/);
		}
	});
});

describe('coordination reading facts', () => {
	it('leaves every scalar absent before two actions produce a reading', () => {
		for (const actionCount of [0, 1]) {
			const facts = coordinationReadingFacts(metrics(), actionCount);
			expect(Object.values(facts).map((fact) => fact.state)).toEqual([
				'absent',
				'absent',
				'absent',
				'absent',
				'absent'
			]);
		}
	});

	it('separates a two-action display floor from a two-action temporal window', () => {
		const facts = coordinationReadingFacts(metrics({ ald: 0.4 }), 2);

		expect(facts.sameness).toEqual({
			state: 'withheld',
			why: ACTION_FLOOR_WITHHELD_REASON
		});
		expect(facts.timing).toEqual({
			state: 'withheld',
			why: TEMPORAL_WINDOW_WITHHELD_REASON
		});
		expect(facts.arrival).toEqual({
			state: 'withheld',
			why: TEMPORAL_WINDOW_WITHHELD_REASON
		});
	});

	it('withholds only the ratio values just below the floor and publishes them at the floor', () => {
		const computed = metrics({
			gds: 0.25,
			ald: 0.4,
			temporalEntropy: 0.75,
			burstVelocity: 1,
			cai: 0.5
		});
		const below = coordinationReadingFacts(computed, DIAGNOSTIC_ACTION_FLOOR - 1);
		const at = coordinationReadingFacts(computed, DIAGNOSTIC_ACTION_FLOOR);
		const above = coordinationReadingFacts(computed, DIAGNOSTIC_ACTION_FLOOR + 1);

		expect(below.sameness.state).toBe('withheld');
		expect(below.arrival.state).toBe('withheld');
		expect(below.gds.state).toBe('present');
		expect(below.timing.state).toBe('present');
		expect(below.cai.state).toBe('present');
		expect(at.sameness).toEqual({ state: 'present', value: 0.6 });
		expect(at.arrival).toEqual({ state: 'present', value: 1 });
		expect(above.sameness.state).toBe('present');
		expect(above.arrival.state).toBe('present');
	});

	it('does not dress an uncomputed floor-sized reading as a held-back value', () => {
		const facts = coordinationReadingFacts(metrics(), DIAGNOSTIC_ACTION_FLOOR);

		expect(facts.sameness.state).toBe('absent');
		expect(facts.timing).toEqual({
			state: 'withheld',
			why: TEMPORAL_WINDOW_WITHHELD_REASON
		});
		expect(facts.arrival).toEqual({
			state: 'withheld',
			why: TEMPORAL_WINDOW_WITHHELD_REASON
		});
	});

	it('renders absent, withheld, and blocked facts as distinct answers', () => {
		const missing = coordinationReadingFacts(metrics(), 1).sameness;
		const small = coordinationReadingFacts(metrics({ ald: 0.4 }), 24).sameness;
		const shortWindow = coordinationReadingFacts(metrics(), 25).timing;
		const stopped = blocked('upstream timed out');

		expect(factStatusLabel(missing)).toBe('Not computed');
		expect(factExplanation(missing)).toBe('No reading was computed from the recorded fields.');
		expect(factStatusLabel(small)).toBe('Withheld');
		expect(factExplanation(small)).toBe(ACTION_FLOOR_WITHHELD_REASON);
		expect(factStatusLabel(shortWindow)).toBe('Withheld');
		expect(factExplanation(shortWindow)).toBe(TEMPORAL_WINDOW_WITHHELD_REASON);
		expect(factExplanation(shortWindow)).not.toBe(factExplanation(small));
		expect(factStatusLabel(stopped)).toBe('Blocked');
		expect(factExplanation(stopped)).toBe('Reading blocked before computation: upstream timed out');
		expect(floorGatedReading(stopped, 0)).toBe(stopped);
	});
});

describe('campaign detail integrity surface', () => {
	const page = readFileSync('src/routes/org/[slug]/campaigns/[id]/+page.svelte', 'utf8');
	const assessment = readFileSync('src/lib/components/org/IntegrityAssessment.svelte', 'utf8');

	it('mounts exactly one assessment line as the default reading', () => {
		expect(page).toContain("'$lib/components/org/IntegrityAssessment.svelte'");
		expect(page.match(/<IntegrityAssessment/g)).toHaveLength(1);
	});

	it('keeps the assessment component on the shared sentence source', () => {
		expect(assessment).toContain("from './integrity-assessment'");
		expect(assessment).not.toMatch(/cite=/);
	});
});

describe('coordination audit panel', () => {
	const source = readFileSync('src/lib/components/org/CoordinationIntegrity.svelte', 'utf8');
	const facts = readFileSync('src/lib/components/org/integrity-assessment.ts', 'utf8');

	it('collapses the raw scores behind a closed-by-default audit block', () => {
		expect(source).toContain('<details');
		expect(source).not.toMatch(/<details[^>]*\bopen\b/);
		expect(source).toContain('Coordination audit');
	});

	it('keeps computation provenance on each scalar for the auditor', () => {
		expect(source).toContain('computeGDSFromDistribution');
		expect(source).toContain('computeALD');
		expect(source).toContain('computeEntropyFromBins');
		expect(source).toContain('computeVelocityFromBins');
		expect(source).toContain('computeCAI');
		expect(source).toContain('cite={score.cite}');
	});

	it('keeps the identical-content and absent-geography screens inside the audit', () => {
		expect(source).toContain('IDENTICAL_CONTENT_ALD_THRESHOLD = 0.5');
		expect(source).toContain('Identical-content threshold crossed');
		expect(source).toContain('Geographic signal absent');
		expect(source).toContain('packet.total > 0 && packet.districtCount === 0');
	});

	it('shares the burst threshold with the assessment sentence', () => {
		expect(source).toContain('BURST_VELOCITY_REVIEW_THRESHOLD');
	});

	it('states the real score threshold — the computations go live at two actions', () => {
		// Every gate is on total actions, not verified ones: computeALD /
		// computeTemporalField / computeCAI all return null below two actions and
		// compute from two on (src/lib/server/verification-packet.ts). A published
		// threshold has to be true of the thing it gates.
		expect(source).toContain('two or more actions');
		expect(source).not.toMatch(/\b10\+/);
	});

	it('paints no good state — no green ramp, no quality bar, no praise copy', () => {
		for (const forbidden of [
			'#34d399',
			'#2dd4bf',
			'qualityColor',
			'organic',
			'Higher scores',
			'text-green',
			'bg-green',
			'text-emerald'
		]) {
			expect(source).not.toContain(forbidden);
		}
	});

	it('gates the ratio readings behind the shared action floor', () => {
		expect(source).toContain('DIAGNOSTIC_ACTION_FLOOR');
		expect(source).toContain("from './integrity-assessment'");
		expect(facts).toContain('Not enough actions to read a pattern.');
		expect(source).toContain('neither ratio value renders below the declared action floor');
		expect(source).not.toContain('no value renders below the declared action floor');
	});

	it('tells the org, in the same words each time, which readings carry no action', () => {
		const inert = 'No action available. Both directions of this reading are ambiguous.';
		expect(source.split(inert).length - 1).toBeGreaterThanOrEqual(3);
	});

	it('keeps the by-construction reading on the single-district case', () => {
		expect(source).toContain('by construction, not by measurement');
	});

	it('asks about the arrival shape instead of asserting one', () => {
		expect(source).toContain('Did you run a push?');
	});

	it('keeps the deduplication sentence conditional and unattributed', () => {
		expect(source).toContain('Where an office deduplicates identical text');
	});

	it('renders absent, withheld, and blocked answers apart instead of collapsing them', () => {
		expect(source).toContain('coordinationReadingFacts');
		expect(source).toContain('factStatusLabel');
		expect(source).toContain('factExplanation');
		expect(source).toContain("state === 'present'");
		expect(source).toContain("state === 'withheld'");
		expect(facts).toContain("case 'absent'");
		expect(facts).toContain("case 'blocked'");
		expect(source).not.toContain('computed-nothing');
	});

	it('claims no single clock hour for an arrival shape that never had one', () => {
		// The ratio is null when first and last action sit under an hour APART
		// (src/lib/server/campaign-read-model.ts:83-90), which is satisfied by
		// actions straddling two clock hours. The deleted sentence was false.
		expect(source).not.toContain('Every action arrived inside a single hour');
		expect(facts).toContain('within an hour of each other');
	});

	it('promises the two-action threshold only before any reading can be computed', () => {
		expect(source).toContain('two or more actions');
		expect(source).toContain('packet.total < 2');
		expect(source).not.toContain('Nothing in this campaign has produced a reading yet.');
	});
});

describe('coalition report coordination section', () => {
	const source = readFileSync('src/lib/components/networks/CoalitionReport.svelte', 'utf8');

	it('replaces the scalar headline grid with the shared assessment line', () => {
		expect(source).toContain("'$lib/components/org/integrity-assessment'");
		expect(source).not.toContain('Coordination Scalars');
	});

	it('collapses its raw scores behind a closed-by-default audit block', () => {
		expect(source).toContain('<details');
		expect(source).not.toMatch(/<details[^>]*\bopen\b/);
		expect(source).toContain('Coordination audit');
	});

	it('carries no provenance whispers on the coalition surface', () => {
		expect(source).not.toMatch(new RegExp('cite' + '='));
	});
});

describe('touched surfaces stay free of internal contract vocabulary', () => {
	// Assembled from fragments so the excised vocabulary never appears
	// verbatim in this file either.
	const ED = 'ed';
	const INTERNAL_VOCABULARY = new RegExp(`\\b(arm${ED}|bound${ED}|not arm${ED})\\b`, 'i');
	const files = [
		'src/lib/components/org/IntegrityAssessment.svelte',
		'src/lib/components/org/integrity-assessment.ts',
		'src/lib/components/org/CoordinationIntegrity.svelte',
		'src/lib/components/networks/CoalitionReport.svelte'
	];

	for (const file of files) {
		it(`keeps ${file.split('/').pop()} in plain org words`, () => {
			expect(readFileSync(file, 'utf8')).not.toMatch(INTERNAL_VOCABULARY);
		});
	}
});
