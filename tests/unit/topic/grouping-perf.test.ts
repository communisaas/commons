import { describe, it, expect } from 'vitest';
import { groupByDomain } from '$lib/core/topic/domain-grouping';
import { aggregateArrivals, bandMomentum } from '$lib/core/topic/band-signals';
import { resolveDomainHue } from '$lib/utils/domain-hue';
import type { Template } from '$lib/types/template';

/**
 * Performance budget for the topical field's compute path.
 *
 * The landscape recomputes, per render, the whole grouping pipeline: bucket the
 * templates into hue-ordered domain bands (`groupByDomain` + the injected hue
 * resolver), then roll each band up into its aggregate rhythm and coordination
 * weight (`aggregateArrivals` + `bandMomentum`). That whole pass must clear the
 * causality budget (<100ms) so grouping feels instant — on the real seed AND on a
 * field an order of magnitude larger than launch. These assertions measure the
 * pass and pin a ceiling well inside the budget so a regression that makes the
 * pipeline super-linear (or accidentally O(n^2)) fails the gate rather than just
 * feeling slow.
 *
 * The budget is generous relative to the measured cost (the pass is sub-millisecond
 * on these inputs) precisely so the test is not flaky on a loaded CI box — it
 * guards the asymptotic shape, not a micro-benchmark.
 */
const BUDGET_MS = 100;

/** The full per-render field compute the landscape does over a template list. */
function computeField(templates: Template[]): number {
	const bands = groupByDomain(templates, { hueOf: resolveDomainHue });
	// Every band rolls up its two aggregate signals, exactly as the field renders.
	for (const band of bands) {
		aggregateArrivals(band.templates);
		bandMomentum(band.templates);
	}
	return bands.length;
}

/** Median of repeated runs — robust to a single GC pause on a shared runner. */
function medianMs(run: () => void, iterations = 9): number {
	const samples: number[] = [];
	for (let i = 0; i < iterations; i++) {
		const start = performance.now();
		run();
		samples.push(performance.now() - start);
	}
	samples.sort((a, b) => a - b);
	return samples[Math.floor(samples.length / 2)];
}

function makeTemplate(over: Partial<Template> & { domain: string; slug: string }): Template {
	return {
		id: over.slug,
		title: 'Template',
		description: '',
		type: 'advocacy',
		deliveryMethod: 'email',
		message_body: '',
		delivery_config: {},
		recipient_config: {},
		coordinationScale: 0,
		isNew: false,
		status: 'published',
		is_public: true,
		send_count: 0,
		createdAt: new Date('2025-06-01T00:00:00Z'),
		updatedAt: new Date('2025-06-01T00:00:00Z'),
		...over
	} as Template;
}

/**
 * The real seed shape: ~15 public templates, all US/federal scope, ZERO sends —
 * the pre-launch landing exactly as it ships. No arrivals, no coordination, so
 * the aggregate roll-ups all return absence. This is the honest baseline the
 * budget must clear.
 */
function seedField(): Template[] {
	const domains = [
		'Healthcare',
		'Environment',
		'Housing',
		'Education',
		'Labor',
		'Immigration',
		'Justice',
		'Governance',
		'Technology',
		'Transportation',
		'Indigenous Rights'
	];
	return Array.from({ length: 15 }, (_, i) =>
		makeTemplate({ domain: domains[i % domains.length], slug: `seed-${i}` })
	);
}

/**
 * A synthetic field an order of magnitude past launch: 200 templates spread
 * across the anchor domains, each carrying a real 30-day arrival rhythm and some
 * verified reach — so the aggregate roll-ups actually do work (they sum arrays
 * and reach), not short-circuit on absence. This is the stress case the budget
 * must still clear.
 */
function syntheticField(size = 200): Template[] {
	const domains = [
		'Healthcare',
		'Environment',
		'Housing',
		'Education',
		'Labor',
		'Immigration',
		'Justice',
		'Governance',
		'Technology',
		'Transportation',
		'Indigenous Rights',
		'Unlisted Local Cause' // outside the anchors → exercises the hash fallback
	];
	return Array.from({ length: size }, (_, i) =>
		makeTemplate({
			domain: domains[i % domains.length],
			slug: `syn-${i}`,
			send_count: (i % 50) * 3,
			coordinationScale: (i % 7) / 2,
			daily_arrivals: Array.from({ length: 30 }, (_, d) => ((i + d) % 5))
		})
	);
}

describe('topical field compute budget', () => {
	it('groups + aggregates the real seed well under the causality budget', () => {
		const templates = seedField();
		const elapsed = medianMs(() => computeField(templates));
		// Recorded for the perf evidence note — surfaced in the runner output.
		console.log(`[perf] seed field (${templates.length} templates): ${elapsed.toFixed(3)}ms`);
		expect(elapsed).toBeLessThan(BUDGET_MS);
		// The pass produces a real, non-trivial field (more than one band).
		expect(computeField(templates)).toBeGreaterThan(1);
	});

	it('groups + aggregates a 200-template synthetic field under the budget', () => {
		const templates = syntheticField(200);
		const elapsed = medianMs(() => computeField(templates));
		console.log(`[perf] synthetic field (${templates.length} templates): ${elapsed.toFixed(3)}ms`);
		expect(elapsed).toBeLessThan(BUDGET_MS);
	});

	it('stays well-behaved as the field grows — no super-linear blow-up', () => {
		// Doubling the field must not quadruple the cost: an accidental O(n^2)
		// (e.g. a per-template scan inside a per-template loop) would fail here long
		// before either absolute budget did.
		const small = syntheticField(100);
		const large = syntheticField(400);
		const smallMs = medianMs(() => computeField(small));
		const largeMs = medianMs(() => computeField(large));
		console.log(
			`[perf] scaling 100→400: ${smallMs.toFixed(3)}ms → ${largeMs.toFixed(3)}ms`
		);
		// Even the 4x field clears the absolute budget…
		expect(largeMs).toBeLessThan(BUDGET_MS);
		// …and the growth stays sub-quadratic with generous headroom for jitter on a
		// loaded runner (a true O(n^2) would be ~16x, not the < ~8x allowed here).
		const floor = 0.05; // ignore sub-50µs noise where the ratio is meaningless
		if (smallMs > floor) {
			expect(largeMs).toBeLessThan(smallMs * 8);
		}
	});
});
