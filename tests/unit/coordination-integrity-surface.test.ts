import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	BURST_VELOCITY_REVIEW_THRESHOLD,
	assessIntegrity,
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

	it('states the real score threshold — the computations go live at two verified actions', () => {
		// computeALD / computeTemporalField / computeCAI all return null below
		// two actions and compute from two on (src/lib/server/verification-packet.ts).
		expect(source).toContain('two or more verified actions');
		expect(source).not.toMatch(/\b10\+/);
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
