import { describe, it, expect } from 'vitest';
import { groupByDomain, bandDomId, type DomainGroup } from '$lib/core/topic/domain-grouping';
import type { Template } from '$lib/types/template';

/**
 * Minimal Template factory — only the fields the grouper reads.
 * `createdAt` is fixed far in the past so the recency boost is inert and the
 * within-band order is governed by send_count alone, keeping assertions about
 * "civic-relevance order" stable and behaviour-level.
 */
function makeTemplate(over: Partial<Template> & { domain: string }): Template {
	return {
		id: over.slug ?? over.domain.toLowerCase().replace(/\s+/g, '-'),
		slug: over.slug ?? over.domain.toLowerCase().replace(/\s+/g, '-'),
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
		preview: '',
		createdAt: new Date('2020-01-01T00:00:00Z'),
		updatedAt: new Date('2020-01-01T00:00:00Z'),
		...over
	} as Template;
}

/** Hue resolver keyed off domain label so bands resolve to fixed, distinct hues. */
const HUE_BY_DOMAIN: Record<string, number> = {
	Transportation: 35,
	Housing: 55,
	Governance: 85,
	Environment: 150,
	Healthcare: 240,
	Education: 290,
	Justice: 320
};
const hueOf = (t: Template) => HUE_BY_DOMAIN[t.domain] ?? 0;

describe('groupByDomain', () => {
	it('orders bands by ascending resolved hue', () => {
		const templates = [
			makeTemplate({ domain: 'Healthcare', slug: 'h1' }), // 240
			makeTemplate({ domain: 'Transportation', slug: 't1' }), // 35
			makeTemplate({ domain: 'Environment', slug: 'e1' }), // 150
			makeTemplate({ domain: 'Housing', slug: 'ho1' }) // 55
		];

		const groups = groupByDomain(templates, { hueOf });
		const hues = groups.map((g) => g.hue);

		expect(hues).toEqual([...hues].sort((a, b) => a - b));
		expect(groups.map((g) => g.domain)).toEqual([
			'Transportation',
			'Housing',
			'Environment',
			'Healthcare'
		]);
	});

	it('stamps a zero-based emergent order matching the spectrum position', () => {
		const groups = groupByDomain(
			[
				makeTemplate({ domain: 'Justice', slug: 'j1' }), // 320
				makeTemplate({ domain: 'Governance', slug: 'g1' }) // 85
			],
			{ hueOf }
		);

		expect(groups.map((g) => g.order)).toEqual([0, 1]);
		expect(groups[0].domain).toBe('Governance');
		expect(groups[1].domain).toBe('Justice');
	});

	it('is deterministic: two runs over the same input return identical order', () => {
		const templates = [
			makeTemplate({ domain: 'Education', slug: 'ed1', send_count: 3 }),
			makeTemplate({ domain: 'Healthcare', slug: 'h1', send_count: 10 }),
			makeTemplate({ domain: 'Education', slug: 'ed2', send_count: 9 }),
			makeTemplate({ domain: 'Housing', slug: 'ho1', send_count: 1 })
		];

		const shape = (groups: DomainGroup[]) =>
			groups.map((g) => ({
				domain: g.domain,
				hue: g.hue,
				order: g.order,
				count: g.count,
				slugs: g.templates.map((t) => t.slug)
			}));

		const first = groupByDomain(templates, { hueOf });
		const second = groupByDomain([...templates].reverse(), { hueOf });

		expect(shape(first)).toEqual(shape(second));
	});

	it('drops domains with zero templates (emergent — only present domains appear)', () => {
		const groups = groupByDomain(
			[makeTemplate({ domain: 'Healthcare', slug: 'h1' })],
			{ hueOf }
		);

		const domains = groups.map((g) => g.domain);
		expect(domains).toEqual(['Healthcare']);
		expect(domains).not.toContain('Education');
		expect(domains).not.toContain('Transportation');
	});

	it('sorts templates within a band by civic-relevance score, descending', () => {
		const templates = [
			makeTemplate({ domain: 'Healthcare', slug: 'low', send_count: 1 }),
			makeTemplate({ domain: 'Healthcare', slug: 'high', send_count: 500 }),
			makeTemplate({ domain: 'Healthcare', slug: 'mid', send_count: 25 })
		];

		const [band] = groupByDomain(templates, { hueOf });

		expect(band.templates.map((t) => t.slug)).toEqual(['high', 'mid', 'low']);
		expect(band.count).toBe(3);
	});

	it('sets each band hue from its lead (highest-relevance) template', () => {
		// Lead template carries the band's own domainHue when present; the band
		// hue echoes that lead tile, not a trailing one.
		const leadHue = (t: Template) => t.domainHue ?? hueOf(t);
		const templates = [
			makeTemplate({ domain: 'Healthcare', slug: 'trailing', send_count: 1, domainHue: 200 }),
			makeTemplate({ domain: 'Healthcare', slug: 'lead', send_count: 500, domainHue: 245 })
		];

		const [band] = groupByDomain(templates, { hueOf: leadHue });

		expect(band.templates[0].slug).toBe('lead');
		expect(band.hue).toBe(245);
	});

	it('buckets untagged templates into a stable "Other" band at the spectrum end', () => {
		const templates = [
			makeTemplate({ domain: 'Healthcare', slug: 'h1' }), // 240
			makeTemplate({ domain: '', slug: 'empty' }),
			makeTemplate({ domain: '   ', slug: 'whitespace' }),
			makeTemplate({ domain: 'Transportation', slug: 't1' }) // 35
		];

		const groups = groupByDomain(templates, { hueOf });
		const last = groups[groups.length - 1];

		expect(last.domain).toBe('Other');
		expect(last.count).toBe(2);
		expect(last.templates.map((t) => t.slug).sort()).toEqual(['empty', 'whitespace']);
		// Untagged templates are never dropped silently.
		expect(groups.flatMap((g) => g.templates)).toHaveLength(4);
	});

	it('keeps "Other" last even when its hue would sort it earlier', () => {
		// hueOf returns 0 for unknown/Other domains — lower than every real band —
		// yet "Other" must still be pinned to the end, not floated to the front.
		const groups = groupByDomain(
			[
				makeTemplate({ domain: '', slug: 'untagged' }),
				makeTemplate({ domain: 'Transportation', slug: 't1' }) // 35
			],
			{ hueOf }
		);

		expect(groups[0].domain).toBe('Transportation');
		expect(groups[groups.length - 1].domain).toBe('Other');
	});

	it('returns an empty array for empty input', () => {
		expect(groupByDomain([], { hueOf })).toEqual([]);
	});

	it('defaults to the real clock so coordination is not swamped by recency', () => {
		// No explicit `now`: a stale epoch default would invert the math — recency
		// boost becomes enormous and a fresh low-send template buries a popular
		// older one. createdAt is recent (relative to the run) so the default clock
		// actually participates in the score.
		const day = 86400000;
		const daysAgo = (n: number) => new Date(Date.now() - n * day);
		const templates = [
			makeTemplate({
				domain: 'Healthcare',
				slug: 'popular-older',
				send_count: 500,
				createdAt: daysAgo(13),
				updatedAt: daysAgo(13)
			}),
			makeTemplate({
				domain: 'Healthcare',
				slug: 'fresh-quiet',
				send_count: 1,
				createdAt: daysAgo(1),
				updatedAt: daysAgo(1)
			})
		];

		const [band] = groupByDomain(templates, { hueOf });
		// A 500-send template past the recency window still leads a 1-send fresh one.
		expect(band.templates[0].slug).toBe('popular-older');
	});

	it('is pure — no wall-clock dependency in the grouping shape', () => {
		const templates = [makeTemplate({ domain: 'Healthcare', slug: 'h1', send_count: 5 })];
		const a = groupByDomain(templates, { hueOf, now: new Date('2020-06-01T00:00:00Z') });
		const b = groupByDomain(templates, { hueOf, now: new Date('2030-06-01T00:00:00Z') });
		expect(a.map((g) => g.domain)).toEqual(b.map((g) => g.domain));
		expect(a[0].hue).toBe(b[0].hue);
	});
});

describe('bandDomId', () => {
	it('derives a valid, slugged anchor id from a domain label', () => {
		// Lowercased, non-alphanumerics folded to single dashes, prefixed — a clean
		// anchor the overview map and the band can both compute to find each other.
		expect(bandDomId('Healthcare')).toBe('band-healthcare');
		expect(bandDomId('Affordable Housing & Zoning')).toBe('band-affordable-housing-zoning');
		expect(bandDomId('  Open  Government  Data ')).toBe('band-open-government-data');
	});

	it('is deterministic — the same label always yields the same id', () => {
		// The overview and the band each compute the id independently; they must
		// land on the identical string or the jump can never find its target.
		expect(bandDomId('Transportation')).toBe(bandDomId('Transportation'));
	});

	it('never emits a dangling prefix for an all-symbol or empty label', () => {
		// A degenerate label still produces a usable anchor, never "band-".
		expect(bandDomId('')).toBe('band-other');
		expect(bandDomId('—')).toBe('band-other');
	});
});
