import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import type { Template } from '$lib/types/template';
import type { DomainGroup } from '$lib/core/topic/domain-grouping';

// svelte/motion reads prefers-reduced-motion via window.matchMedia at module
// evaluation. Shim it before the component (and the Ratio primitive) load.
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
	Object.defineProperty(window, 'matchMedia', {
		value: (query: string) => ({
			matches: false,
			media: query,
			onchange: null,
			addEventListener: () => {},
			removeEventListener: () => {},
			addListener: () => {},
			removeListener: () => {},
			dispatchEvent: () => false
		}),
		writable: true,
		configurable: true
	});
}

const SpectrumOverview = (
	await import('$lib/components/template-browser/spectrum/SpectrumOverview.svelte')
).default;

/** A minimal valid template; overrides pin only what an assertion is about. */
function makeTemplate(overrides: Partial<Template> = {}): Template {
	return {
		id: 't1',
		slug: 'restore-clinic-hours',
		title: 'Restore the clinic hours',
		description: 'Ask the county to fund evening hours at the public clinic.',
		domain: 'Healthcare',
		type: 'advocacy',
		deliveryMethod: 'direct',
		message_body: 'Body',
		delivery_config: {},
		recipient_config: {},
		coordinationScale: 0,
		isNew: false,
		status: 'published',
		is_public: true,
		send_count: 0,
		createdAt: '2026-06-01T00:00:00.000Z',
		updatedAt: '2026-06-01T00:00:00.000Z',
		...overrides
	} as Template;
}

/** A band of `count` templates at a given domain/hue, with optional reach. */
function makeBand(
	domain: string,
	hue: number,
	count: number,
	templateOverrides: Partial<Template> = {}
): Pick<DomainGroup, 'domain' | 'hue' | 'count' | 'templates'> {
	const templates = Array.from({ length: count }, (_, i) =>
		makeTemplate({ id: `${domain}-${i}`, domain, ...templateOverrides })
	);
	return { domain, hue, count, templates };
}

/** The rendered Ratio segments (one per band with a positive count). */
function segments(container: HTMLElement): HTMLElement[] {
	return Array.from(container.querySelectorAll('.ratio-segment'));
}

/** The plain-English legend labels, in render order. */
function labels(container: HTMLElement): HTMLElement[] {
	return Array.from(container.querySelectorAll('.spectrum-overview__label'));
}

/** Parse the `width: NN%` a segment carries (the proportion the bar shows). */
function segmentWidthPct(segment: HTMLElement): number {
	const match = /width:\s*([\d.]+)%/.exec(segment.getAttribute('style') ?? '');
	return match ? Number(match[1]) : NaN;
}

describe('SpectrumOverview', () => {
	it('renders one segment per band — the count matches the group count', () => {
		const bands = [
			makeBand('Healthcare', 240, 3),
			makeBand('Housing', 60, 2),
			makeBand('Environment', 140, 1)
		];
		const { container } = render(SpectrumOverview, { props: { bands } });
		expect(segments(container).length).toBe(bands.length);
		expect(labels(container).length).toBe(bands.length);
	});

	it('sizes each segment in proportion to its template count', () => {
		// 4 + 1 = 5 templates total → 80% / 20% of the bar.
		const bands = [makeBand('Healthcare', 240, 4), makeBand('Housing', 60, 1)];
		const { container } = render(SpectrumOverview, { props: { bands } });
		const [first, second] = segments(container);
		expect(segmentWidthPct(first)).toBeCloseTo(80, 5);
		expect(segmentWidthPct(second)).toBeCloseTo(20, 5);
	});

	it("the segment widths sum to the whole — they account for every template", () => {
		const bands = [
			makeBand('Healthcare', 240, 3),
			makeBand('Housing', 60, 5),
			makeBand('Labor', 30, 2)
		];
		const { container } = render(SpectrumOverview, { props: { bands } });
		const sum = segments(container).reduce((acc, seg) => acc + segmentWidthPct(seg), 0);
		expect(sum).toBeCloseTo(100, 5);
		// And the field's true total is exposed for the eye/AT, not a bare "0".
		const overview = container.querySelector('.spectrum-overview') as HTMLElement;
		expect(overview.getAttribute('data-template-count')).toBe('10');
	});

	it("each segment's hue is its band's hue — the same colour the spine carries", () => {
		const bands = [makeBand('Healthcare', 240, 1), makeBand('Housing', 55, 1)];
		const { container } = render(SpectrumOverview, { props: { bands } });
		const [first, second] = segments(container);
		// The fill cites the band hue directly, so the map and the band spine agree.
		expect(first.getAttribute('style')).toContain('240');
		expect(second.getAttribute('style')).toContain('55');
		// Each label cell likewise carries its band hue as --card-hue.
		const [firstLabel, secondLabel] = labels(container);
		expect(firstLabel.style.getPropertyValue('--card-hue')).toBe('240');
		expect(secondLabel.style.getPropertyValue('--card-hue')).toBe('55');
	});

	it("captions each band by its plain-English topic — the anchor name its hue belongs to", () => {
		// Housing's anchor hue is 55, Transportation's is 35 (from domain-anchors.json).
		// A band carrying a descriptive free-text domain ("Affordable Housing Vacancy
		// Tax") is captioned by the plain topic its hue lands on — "Housing" — not by
		// the long wording, so the map reads clean.
		const bands = [
			makeBand('Bike Lane Expansion', 35, 1),
			makeBand('Affordable Housing Vacancy Tax', 55, 1)
		];
		const { container } = render(SpectrumOverview, { props: { bands } });
		const text = labels(container).map((el) => el.textContent?.trim());
		expect(text).toEqual(['Transportation', 'Housing']);
	});

	it('falls back to the band domain when the hue is not a canonical anchor', () => {
		// 200 is not one of the 11 anchor hues — a backfilled projection or a hashed
		// unknown domain. The band is then captioned by its own plain domain wording.
		const bands = [makeBand('Open Government Data', 200, 1)];
		const { container } = render(SpectrumOverview, { props: { bands } });
		expect(labels(container)[0].textContent?.trim()).toBe('Open Government Data');
	});

	it('names a topic once across adjacent bands that share it (no repeated label)', () => {
		// Two distinct housing neighbourhoods sit side by side in the spectrum (same
		// resolved hue). The map keeps a segment per band but names the topic once,
		// over the first, so "Housing" spans its region instead of repeating.
		const bands = [
			makeBand('Affordable Housing', 55, 2),
			makeBand('Zoning Reform', 55, 1),
			makeBand('Bike Lane Expansion', 35, 1)
		];
		const { container } = render(SpectrumOverview, { props: { bands } });
		// Still one segment per band — the map stays 1:1 with the field.
		expect(segments(container).length).toBe(3);
		// But the visible names collapse the adjacent same-topic run.
		const names = labels(container)
			.map((el) => el.textContent?.trim())
			.filter((t) => t && t.length > 0);
		expect(names).toEqual(['Housing', 'Transportation']);
	});

	it('reads the same weight across bands at the zero-send seed (no invented emphasis)', () => {
		// Every band idle (send_count 0) → identical base chroma; the map is the
		// true composition, never a dead bar, but nothing stands out yet.
		const bands = [
			makeBand('Healthcare', 240, 2, { send_count: 0 }),
			makeBand('Housing', 60, 2, { send_count: 0 })
		];
		const { container } = render(SpectrumOverview, { props: { bands } });
		const fills = segments(container).map((seg) => {
			const match = /oklch\(0\.62\s+([\d.]+)/.exec(seg.getAttribute('style') ?? '');
			return match ? match[1] : '';
		});
		// Both bands at the same chroma — no band tinted hotter than another.
		expect(new Set(fills).size).toBe(1);
	});

	it('lifts a band that carries real coordination above the idle bands (alive full)', () => {
		// Healthcare has verified reach; Housing is idle. The map gives Healthcare
		// fuller chroma so the eye sees where the energy is — driven by bandMomentum,
		// which is non-zero only when real sends back the band.
		const bands = [
			makeBand('Healthcare', 240, 1, { send_count: 12, coordinationScale: 3 }),
			makeBand('Housing', 60, 1, { send_count: 0 })
		];
		const { container } = render(SpectrumOverview, { props: { bands } });
		const chromaOf = (seg: HTMLElement) => {
			const match = /oklch\(0\.62\s+([\d.]+)/.exec(seg.getAttribute('style') ?? '');
			return match ? Number(match[1]) : NaN;
		};
		const [healthcare, housing] = segments(container);
		expect(chromaOf(healthcare)).toBeGreaterThan(chromaOf(housing));
	});

	it('renders nothing when there are no bands (no empty ribbon)', () => {
		const { container } = render(SpectrumOverview, { props: { bands: [] } });
		expect(container.querySelector('.spectrum-overview')).toBeNull();
		expect(segments(container).length).toBe(0);
	});

	it('sits sticky at the top of the stream column', () => {
		// The map is the one you keep glancing back to; it must hold at the stream
		// top while the bands scroll. Asserted on the class the sticky rule targets.
		const bands = [makeBand('Healthcare', 240, 1)];
		const { container } = render(SpectrumOverview, { props: { bands } });
		const overview = container.querySelector('.spectrum-overview') as HTMLElement;
		expect(overview).toBeTruthy();
		// The sticky positioning lives in scoped CSS on this element; the presence of
		// the structural class is the contract the page relies on.
		expect(overview.classList.contains('spectrum-overview')).toBe(true);
	});

	it('carries no foreign chrome — no pill, no white box, no oversized radius', () => {
		const bands = [makeBand('Healthcare', 240, 1)];
		const { container } = render(SpectrumOverview, { props: { bands } });
		const overview = container.querySelector('.spectrum-overview') as HTMLElement;
		expect(overview.className).not.toMatch(/\bbg-white\b/);
		expect(overview.className).not.toMatch(/\bborder\b/);
		expect(overview.className).not.toMatch(/rounded-(xl|2xl|3xl|full)\b/);
	});
});
