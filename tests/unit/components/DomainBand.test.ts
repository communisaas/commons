import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/svelte';
import type { Template } from '$lib/types/template';
import type { DomainGroup } from '$lib/core/topic/domain-grouping';
import { bandDomId } from '$lib/core/topic/domain-grouping';
import { topicHue } from '$lib/utils/topic-hue';

// svelte/motion reads prefers-reduced-motion via window.matchMedia at module
// evaluation. Shim it before the component (and its TemplateTile children) load.
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

const DomainBand = (
	await import('$lib/components/template-browser/spectrum/DomainBand.svelte')
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

/** A band over the given templates; hue defaults to a healthcare-like angle. */
function makeGroup(templates: Template[], overrides: Partial<DomainGroup> = {}): DomainGroup {
	return {
		domain: 'Healthcare',
		hue: 240,
		order: 0,
		templates,
		count: templates.length,
		...overrides
	};
}

/** The band-level aggregate Pulse (distinct from each tile's own mini-Pulse). */
function bandPulses(container: HTMLElement): Element[] {
	return Array.from(container.querySelectorAll('svg.band-pulse'));
}

/** Tiles render as template buttons. */
function tiles(container: HTMLElement): Element[] {
	return Array.from(container.querySelectorAll('[data-template-button]'));
}

describe('DomainBand', () => {
	it('renders the domain name, a count, and a hue spine', () => {
		const group = makeGroup([makeTemplate({ id: 'a' }), makeTemplate({ id: 'b' })]);
		const { container } = render(DomainBand, {
			props: { group, onSelect: vi.fn() }
		});

		// Name is the band's strong centre (the heading, not a tile's provenance).
		const name = container.querySelector('.band-name') as HTMLElement;
		expect(name?.textContent?.trim()).toBe('Healthcare');
		// Count reads the group count.
		const count = container.querySelector('.band-count') as HTMLElement;
		expect(count?.textContent).toContain('2');
		expect(count?.textContent).toContain('templates');
		// The spine carries the band hue as --card-hue.
		const spine = container.querySelector('.band-spine') as HTMLElement;
		expect(spine).toBeTruthy();
		expect(spine.style.getPropertyValue('--card-hue')).toBe('240');
	});

	it('renders one tile per template in the group', () => {
		const group = makeGroup([
			makeTemplate({ id: 'a' }),
			makeTemplate({ id: 'b' }),
			makeTemplate({ id: 'c' })
		]);
		const { container } = render(DomainBand, {
			props: { group, onSelect: vi.fn(), initialVisible: 12 }
		});
		expect(tiles(container).length).toBe(group.count);
	});

	it('omits the aggregate Pulse at the zero-send seed (alive empty, never a dead line)', () => {
		const group = makeGroup([
			makeTemplate({ id: 'a', send_count: 0, daily_arrivals: [] }),
			makeTemplate({ id: 'b', send_count: 0 })
		]);
		const { container } = render(DomainBand, { props: { group, onSelect: vi.fn() } });
		expect(bandPulses(container).length).toBe(0);
	});

	it('renders the aggregate Pulse only once real arrivals back the band', () => {
		const group = makeGroup([
			makeTemplate({ id: 'a', send_count: 6, daily_arrivals: [1, 2, 3] }),
			makeTemplate({ id: 'b', send_count: 4, daily_arrivals: [0, 1, 2] })
		]);
		const { container } = render(DomainBand, { props: { group, onSelect: vi.fn() } });
		expect(bandPulses(container).length).toBe(1);
	});

	it('shows the lead tiles and reveals the rest via "more"', async () => {
		const templates = Array.from({ length: 9 }, (_, i) => makeTemplate({ id: `t${i}` }));
		const group = makeGroup(templates);
		const { container } = render(DomainBand, {
			props: { group, onSelect: vi.fn(), initialVisible: 6 }
		});

		// Only the lead tiles are visible at first.
		expect(tiles(container).length).toBe(6);
		// The affordance counts the remainder.
		const more = container.querySelector('.band-more') as HTMLButtonElement;
		expect(more).toBeTruthy();
		expect(more.textContent).toContain('3');

		await fireEvent.click(more);

		// All tiles are now revealed.
		expect(tiles(container).length).toBe(9);
		// And the affordance is gone once the band is fully shown.
		expect(container.querySelector('.band-more')).toBeNull();
	});

	it('shows no "more" affordance when the band fits in the lead set', () => {
		const group = makeGroup([makeTemplate({ id: 'a' }), makeTemplate({ id: 'b' })]);
		const { container } = render(DomainBand, {
			props: { group, onSelect: vi.fn(), initialVisible: 6 }
		});
		expect(container.querySelector('.band-more')).toBeNull();
	});

	it('reveals an oversized band in bounded steps — one click never mounts the whole tail', async () => {
		// A pathologically large band (well past a hundred tiles) must not dump its
		// entire remainder into the DOM on a single click — that would stall the
		// frame. The reveal grows in bounded steps, so each click mounts a capped
		// batch and the affordance promises only what it will actually reveal.
		const templates = Array.from({ length: 260 }, (_, i) => makeTemplate({ id: `t${i}` }));
		const group = makeGroup(templates);
		const { container } = render(DomainBand, {
			props: { group, onSelect: vi.fn(), initialVisible: 6 }
		});

		// Lead set only, and the affordance offers a bounded batch, not all 254 left.
		expect(tiles(container).length).toBe(6);
		const more = () => container.querySelector('.band-more') as HTMLButtonElement | null;
		expect(more()?.textContent).toContain('100');
		expect(more()?.textContent).not.toContain('254');

		// First click reveals one bounded step on top of the lead set.
		await fireEvent.click(more()!);
		expect(tiles(container).length).toBe(106);
		// Still more to reveal, still bounded.
		expect(more()).not.toBeNull();
		expect(more()?.textContent).toContain('100');

		// Subsequent clicks walk the rest in, never exceeding a step per click.
		await fireEvent.click(more()!);
		expect(tiles(container).length).toBe(206);
		await fireEvent.click(more()!);
		// The final partial step reveals the remainder and retires the affordance.
		expect(tiles(container).length).toBe(260);
		expect(more()).toBeNull();
	});

	it('reveals an ordinary band fully in one click (no needless stepping below the cap)', async () => {
		// A band comfortably under one reveal step shows its whole remainder on the
		// first click — the bounded reveal engages only where the data is large,
		// never adding clicks to a normal-sized neighbourhood.
		const templates = Array.from({ length: 40 }, (_, i) => makeTemplate({ id: `t${i}` }));
		const group = makeGroup(templates);
		const { container } = render(DomainBand, {
			props: { group, onSelect: vi.fn(), initialVisible: 6 }
		});
		const more = container.querySelector('.band-more') as HTMLButtonElement;
		// The affordance promises the full remainder (34), not a capped batch.
		expect(more.textContent).toContain('34');
		await fireEvent.click(more);
		expect(tiles(container).length).toBe(40);
		expect(container.querySelector('.band-more')).toBeNull();
	});

	it('tags tiles revealed past the lead set so their entrance respects reduced motion', async () => {
		// Tiles brought in by "more" carry the reveal entrance (a fade + small rise).
		// That entrance is neutralized under prefers-reduced-motion in the tile's own
		// CSS, so a vestibular-sensitive reader sees the band grow without motion. The
		// band's job is to TAG the freshly revealed tiles; jsdom does not apply scoped
		// <style> layout, so this pins that the tag is set (the reduced-motion
		// neutralization of the tagged class is asserted at the tile level).
		const templates = Array.from({ length: 9 }, (_, i) => makeTemplate({ id: `t${i}` }));
		const group = makeGroup(templates);
		const { container } = render(DomainBand, {
			props: { group, onSelect: vi.fn(), initialVisible: 6 }
		});
		await fireEvent.click(container.querySelector('.band-more') as HTMLButtonElement);
		const revealed = Array.from(container.querySelectorAll('[data-template-button].newly-revealed'));
		// The three tiles past the initial six are tagged for the reveal entrance.
		expect(revealed.length).toBe(3);
	});

	it('threads selection and activation down to its tiles', async () => {
		const onSelect = vi.fn();
		const group = makeGroup([makeTemplate({ id: 'a' }), makeTemplate({ id: 'b' })]);
		const { container, getByTestId } = render(DomainBand, {
			props: { group, selectedId: 'a', onSelect }
		});

		// The selected tile carries the selected class.
		const selected = container.querySelector('[data-template-id="a"]');
		expect(selected?.classList.contains('card-selected')).toBe(true);

		// Activating a tile reports its id up.
		await fireEvent.click(getByTestId('template-button-b'));
		expect(onSelect).toHaveBeenCalledWith('b');
	});

	it('carries no card chrome — no decorative border, pill, or white box around the band', () => {
		const group = makeGroup([makeTemplate({ id: 'a' })]);
		const { container } = render(DomainBand, { props: { group, onSelect: vi.fn() } });
		const band = container.querySelector('.domain-band') as HTMLElement;
		// The band is structure + void, not a boxed card.
		expect(band.className).not.toMatch(/\bborder\b/);
		expect(band.className).not.toMatch(/\bbg-white\b/);
		expect(band.className).not.toMatch(/rounded-(xl|2xl|3xl|full)\b/);
	});

	it('carries a stable scroll-target id the overview map can jump to', () => {
		const group = makeGroup([makeTemplate({ id: 'a' })], { domain: 'Affordable Housing' });
		const { container } = render(DomainBand, { props: { group, onSelect: vi.fn() } });
		const band = container.querySelector('.domain-band') as HTMLElement;
		// The band's id is the same one the overview computes from its domain, so a
		// tapped segment can find this neighbourhood.
		expect(band.id).toBe(bandDomId('Affordable Housing'));
	});

	it('exposes a bloom channel on the spine that lifts when the field jumps here', async () => {
		const group = makeGroup([makeTemplate({ id: 'a' })]);
		const { container, rerender } = render(DomainBand, {
			props: { group, onSelect: vi.fn(), blooming: false }
		});
		const spine = () => container.querySelector('.band-spine') as HTMLElement;
		// At rest the spine is not blooming — base spectrum weight.
		expect(spine().classList.contains('band-spine--blooming')).toBe(false);

		// When the field jumps here, the bloom amount rises on the entrance spring
		// and the spine flares (the blooming class engages as --bloom crosses zero).
		await rerender({ group, onSelect: vi.fn(), blooming: true });
		await waitFor(() => {
			expect(spine().classList.contains('band-spine--blooming')).toBe(true);
		});

		// And settles back to rest once the field releases the bloom.
		await rerender({ group, onSelect: vi.fn(), blooming: false });
		await waitFor(() => {
			expect(spine().classList.contains('band-spine--blooming')).toBe(false);
		});
	});

	it('lays all its tiles as direct siblings in one tile container so they can reflow multi-up', () => {
		// The reflow (one-up → two-up → more) is a grid rule on `.band-tiles`; for it
		// to flow the tiles side by side they must be direct children of that one
		// container, not nested in per-row wrappers. This pins that structure (the
		// grid track behaviour itself is exercised at real widths in the responsive
		// pass, not in jsdom which does not resolve scoped <style> layout).
		const group = makeGroup([
			makeTemplate({ id: 'a' }),
			makeTemplate({ id: 'b' }),
			makeTemplate({ id: 'c' })
		]);
		const { container } = render(DomainBand, {
			props: { group, onSelect: vi.fn(), initialVisible: 12 }
		});
		const tilesWrap = container.querySelector('.band-tiles') as HTMLElement;
		const directTiles = Array.from(tilesWrap.children).filter((el) =>
			el.matches('[data-template-button]')
		);
		expect(directTiles.length).toBe(group.count);
	});

	it('tints tiles with the band hue authority, so the spine and tiles never clash', () => {
		// "Bike Infrastructure & Public Health" resolves to Transportation via the
		// landscape resolver (resolveDomainHue, longest keyword "infrastruc") but to
		// a different hue via the list resolver (topicHue). The band must tint its
		// tiles with its OWN authority so the spine and the tiles agree (one hue
		// for the load-bearing axis — Axis-1).
		const domain = 'Bike Infrastructure & Public Health';
		const bandHue = 35; // Transportation — the band's resolved hue
		// Precondition: the two resolvers genuinely diverge here (else the test is moot).
		expect(topicHue(domain)).not.toBe(bandHue);

		const group = makeGroup([makeTemplate({ id: 'a', domain, domainHue: undefined })], {
			domain,
			hue: bandHue
		});
		const { container } = render(DomainBand, { props: { group, onSelect: vi.fn() } });

		const spine = container.querySelector('.band-spine') as HTMLElement;
		const tile = container.querySelector('[data-template-button]') as HTMLElement;
		expect(spine.style.getPropertyValue('--card-hue')).toBe(String(bandHue));
		expect(tile.style.getPropertyValue('--card-hue')).toBe(String(bandHue));
	});
});
