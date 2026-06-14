import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/svelte';
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

/** The per-segment wayfinding controls (one per band), in render order. */
function jumps(container: HTMLElement): HTMLButtonElement[] {
	return Array.from(container.querySelectorAll('.spectrum-overview__jump'));
}

/** The single on-demand caption line that names the band the eye is on. */
function caption(container: HTMLElement): HTMLElement {
	return container.querySelector('.spectrum-overview__caption') as HTMLElement;
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
		// One wayfinding control per band — the map stays 1:1 with the field.
		expect(jumps(container).length).toBe(bands.length);
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
		// Each control likewise carries its band hue as --card-hue (drives the
		// hover lift + focus ring at the band's own colour).
		const [firstJump, secondJump] = jumps(container);
		expect(firstJump.style.getPropertyValue('--card-hue')).toBe('240');
		expect(secondJump.style.getPropertyValue('--card-hue')).toBe('55');
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

	it('makes each segment a focusable wayfinding control (one per band)', () => {
		const bands = [makeBand('Healthcare', 240, 2), makeBand('Housing', 55, 1)];
		const { container } = render(SpectrumOverview, { props: { bands } });
		const controls = jumps(container);
		// One control per band — the map stays 1:1 with the field.
		expect(controls.length).toBe(bands.length);
		// Native buttons: focusable and keyboard-activatable for free.
		for (const control of controls) {
			expect(control.tagName).toBe('BUTTON');
			expect(control.getAttribute('type')).toBe('button');
		}
	});

	it('activating a segment asks the field to travel to that band (by domain)', async () => {
		const onFocusBand = vi.fn();
		const bands = [makeBand('Healthcare', 240, 1), makeBand('Housing', 55, 1)];
		const { container } = render(SpectrumOverview, { props: { bands, onFocusBand } });
		await fireEvent.click(jumps(container)[1]);
		// It names the SECOND band's domain — the target the eye pointed at.
		expect(onFocusBand).toHaveBeenCalledWith('Housing');
	});

	// ─── The on-demand caption: names the band the eye is on, by its OWN heading ──

	it('names each segment by its OWN band heading, not a canonical anchor name', () => {
		// The heading the field shows below is the descriptive domain wording; the
		// map's accessible name and tooltip must cite the SAME words, so the map and
		// the band you land on agree — not a generic anchor like "Transportation".
		const bands = [
			makeBand('Bike Infrastructure & Public Health', 35, 1),
			makeBand('Affordable Housing Vacancy Tax', 55, 1)
		];
		const { container } = render(SpectrumOverview, { props: { bands } });
		const [first, second] = jumps(container);
		expect(first.getAttribute('aria-label')).toBe(
			'Jump to Bike Infrastructure & Public Health'
		);
		expect(first.getAttribute('title')).toBe('Bike Infrastructure & Public Health');
		expect(second.getAttribute('aria-label')).toBe('Jump to Affordable Housing Vacancy Tax');
		expect(second.getAttribute('title')).toBe('Affordable Housing Vacancy Tax');
	});

	it('gives every segment a distinct, non-empty accessible name (no collapsed labels)', () => {
		// Two adjacent bands that share a hue used to collapse to one visible label,
		// leaving an empty accessible name on the second. Each band has a UNIQUE
		// domain, so every control is now distinctly and fully named.
		const bands = [
			makeBand('Affordable Housing', 55, 2),
			makeBand('Zoning Reform', 55, 1),
			makeBand('Bike Lane Expansion', 35, 1)
		];
		const { container } = render(SpectrumOverview, { props: { bands } });
		const names = jumps(container).map((j) => j.getAttribute('aria-label'));
		expect(names).toEqual([
			'Jump to Affordable Housing',
			'Jump to Zoning Reform',
			'Jump to Bike Lane Expansion'
		]);
		// No empty accessible name on any control.
		for (const name of names) {
			expect(name).toBeTruthy();
			expect(name).not.toBe('Jump to ');
		}
		// And no segment renders empty visible text inside it (the label is the
		// caption line, not text crammed into a narrow segment).
		for (const jump of jumps(container)) {
			expect(jump.textContent?.trim()).toBe('');
		}
	});

	it('starts with a quiet neutral hint, asserting no band until the eye lands', () => {
		const bands = [makeBand('Healthcare', 240, 1), makeBand('Housing', 55, 1)];
		const { container } = render(SpectrumOverview, { props: { bands } });
		const line = caption(container);
		// The caption exists and reads as a hint at rest — it does not name a band
		// nobody picked.
		expect(line).toBeTruthy();
		expect(line.classList.contains('spectrum-overview__caption--hint')).toBe(true);
		expect(line.textContent).not.toContain('Healthcare');
		expect(line.textContent).not.toContain('Housing');
	});

	it("captions the HOVERED band by its own heading (the band you would land on)", async () => {
		const bands = [
			makeBand('Veterans Healthcare Access', 240, 1),
			makeBand('Affordable Housing Vacancy Tax', 55, 1)
		];
		const { container } = render(SpectrumOverview, { props: { bands } });
		await fireEvent.pointerEnter(jumps(container)[1]);
		expect(caption(container).textContent?.trim()).toBe('Affordable Housing Vacancy Tax');
		// Leaving returns the line to its quiet hint — no band asserted at rest.
		await fireEvent.pointerLeave(jumps(container)[1]);
		expect(caption(container).classList.contains('spectrum-overview__caption--hint')).toBe(true);
	});

	it('captions the FOCUSED band by its own heading (keyboard parity with hover)', async () => {
		const bands = [
			makeBand('Veterans Healthcare Access', 240, 1),
			makeBand('Urban Freeway Removal', 35, 1)
		];
		const { container } = render(SpectrumOverview, { props: { bands } });
		await fireEvent.focus(jumps(container)[1]);
		expect(caption(container).textContent?.trim()).toBe('Urban Freeway Removal');
	});

	it("captions the place-lens band by its precision tier, not a topic", async () => {
		// In the place lens the band heading is the geographic tier (e.g.
		// "Nationwide"); the caption must read that, never a topic word, so the map
		// agrees with the place band below it.
		const bands = [makeBand('In Your State', 240, 1), makeBand('Nationwide', 55, 1)];
		const { container } = render(SpectrumOverview, { props: { bands } });
		await fireEvent.pointerEnter(jumps(container)[1]);
		expect(caption(container).textContent?.trim()).toBe('Nationwide');
	});
});
