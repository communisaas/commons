import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/svelte';
import type { Template } from '$lib/types/template';
import type { DomainGroup } from '$lib/core/topic/domain-grouping';

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
});
