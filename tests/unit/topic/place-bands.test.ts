import { describe, it, expect } from 'vitest';
import { toPlaceBands } from '$lib/core/topic/place-bands';
import type { Template, TemplateGroup } from '$lib/types/template';

/**
 * Minimal template factory — only the fields the adapter and the hue resolver
 * read. The adapter does not score or reorder templates, so timestamps are
 * inert here; it only buckets the precision groups into band shape.
 */
function makeTemplate(over: Partial<Template> & { slug: string }): Template {
	return {
		title: 'Template',
		description: '',
		domain: 'Healthcare',
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
		createdAt: new Date('2020-01-01T00:00:00Z'),
		updatedAt: new Date('2020-01-01T00:00:00Z'),
		...over,
		id: over.slug
	} as Template;
}

function makeGroup(over: Partial<TemplateGroup> & { title: string; templates: Template[] }): TemplateGroup {
	return {
		minScore: 0,
		level: 'nationwide',
		coordinationCount: 0,
		...over
	};
}

/** Hue resolver keyed off domain so a band's spine hue is predictable. */
const HUE_BY_DOMAIN: Record<string, number> = {
	Healthcare: 240,
	Housing: 55,
	Environment: 150
};
const hueOf = (t: Template) => HUE_BY_DOMAIN[t.domain ?? ''] ?? 0;

describe('toPlaceBands', () => {
	it('preserves the precision-tier order the grouper produced', () => {
		const groups = [
			makeGroup({ title: 'In Your District', level: 'district', templates: [makeTemplate({ slug: 'd1' })] }),
			makeGroup({ title: 'In Your State', level: 'state', templates: [makeTemplate({ slug: 's1' })] }),
			makeGroup({ title: 'Nationwide', level: 'nationwide', templates: [makeTemplate({ slug: 'n1' })] })
		];

		const bands = toPlaceBands(groups, { hueOf });

		expect(bands.map((b) => b.domain)).toEqual([
			'In Your District',
			'In Your State',
			'Nationwide'
		]);
		expect(bands.map((b) => b.order)).toEqual([0, 1, 2]);
	});

	it('carries the tier title as both the band name and the place chip label', () => {
		const bands = toPlaceBands(
			[makeGroup({ title: 'Nationwide', templates: [makeTemplate({ slug: 'n1' })] })],
			{ hueOf }
		);
		expect(bands[0].domain).toBe('Nationwide');
		expect(bands[0].place).toBe('Nationwide');
	});

	it('derives each band spine hue from its lead template DOMAIN hue (hue stays domain)', () => {
		const bands = toPlaceBands(
			[
				makeGroup({
					title: 'Nationwide',
					templates: [
						makeTemplate({ slug: 'lead', domain: 'Housing' }),
						makeTemplate({ slug: 'trailing', domain: 'Healthcare' })
					]
				})
			],
			{ hueOf }
		);
		// Lead template's domain is Housing → the band hue is Housing's hue, not place.
		expect(bands[0].hue).toBe(HUE_BY_DOMAIN.Housing);
	});

	it('passes the tier templates through unchanged — order and identity preserved', () => {
		const t1 = makeTemplate({ slug: 'a' });
		const t2 = makeTemplate({ slug: 'b' });
		const t3 = makeTemplate({ slug: 'c' });
		const groups = [makeGroup({ title: 'Nationwide', templates: [t1, t2, t3] })];

		const [band] = toPlaceBands(groups, { hueOf });

		// Same references, same order — the adapter never reorders or clones.
		expect(band.templates).toEqual([t1, t2, t3]);
		expect(band.count).toBe(3);
	});

	it('drops tiers with no templates', () => {
		const bands = toPlaceBands(
			[
				makeGroup({ title: 'In Your District', templates: [] }),
				makeGroup({ title: 'Nationwide', templates: [makeTemplate({ slug: 'n1' })] })
			],
			{ hueOf }
		);
		expect(bands.map((b) => b.domain)).toEqual(['Nationwide']);
	});

	it('returns an empty array for no groups', () => {
		expect(toPlaceBands([], { hueOf })).toEqual([]);
	});
});
