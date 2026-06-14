import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/svelte';
import type { Template } from '$lib/types/template';
import { resolveDomainHue } from '$lib/utils/domain-hue';

// svelte/motion reads prefers-reduced-motion via window.matchMedia at module
// evaluation. Shim it before the component (and its band/tile children) load.
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

const SpectrumLandscape = (
	await import('$lib/components/template-browser/spectrum/SpectrumLandscape.svelte')
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

/** Band headings, in render order. */
function bandNames(container: HTMLElement): string[] {
	return Array.from(container.querySelectorAll('.band-name')).map(
		(el) => el.textContent?.trim() ?? ''
	);
}

/** Tiles render as template buttons, in document (field) order. */
function tiles(container: HTMLElement): Element[] {
	return Array.from(container.querySelectorAll('[data-template-button]'));
}

/** The band-level aggregate Pulse (distinct from each tile's own mini-Pulse). */
function bandPulses(container: HTMLElement): Element[] {
	return Array.from(container.querySelectorAll('svg.band-pulse'));
}

describe('SpectrumLandscape', () => {
	it('renders one band per occupied domain', () => {
		const templates = [
			makeTemplate({ id: 'a', domain: 'Healthcare' }),
			makeTemplate({ id: 'b', domain: 'Housing' }),
			makeTemplate({ id: 'c', domain: 'Healthcare' })
		];
		const { container } = render(SpectrumLandscape, {
			props: { templates, onSelect: vi.fn() }
		});
		const names = bandNames(container);
		expect(names).toContain('Healthcare');
		expect(names).toContain('Housing');
		// Healthcare appears once, not once per template.
		expect(names.filter((n) => n === 'Healthcare').length).toBe(1);
	});

	it('orders the bands by resolved hue (the spectrum axis), not by input order', () => {
		// Three domains whose anchor hues are known to differ; feed them in an
		// order that is NOT their hue order, and assert the field reorders them.
		const domains = ['Technology', 'Healthcare', 'Environment'];
		const templates = domains.map((domain, i) => makeTemplate({ id: `t${i}`, domain }));

		const { container } = render(SpectrumLandscape, {
			props: { templates, onSelect: vi.fn() }
		});

		const rendered = bandNames(container);
		// The expectation is whatever the resolver dictates — verified against the
		// resolver, never hardcoded vibes.
		const expected = [...domains].sort(
			(a, b) =>
				resolveDomainHue(makeTemplate({ domain: a })) -
				resolveDomainHue(makeTemplate({ domain: b }))
		);
		expect(rendered).toEqual(expected);
	});

	it('lays every template into a band — none are dropped', () => {
		const templates = Array.from({ length: 7 }, (_, i) =>
			makeTemplate({ id: `t${i}`, domain: i % 2 === 0 ? 'Healthcare' : 'Housing' })
		);
		const { container } = render(SpectrumLandscape, {
			props: { templates, onSelect: vi.fn(), initialVisible: 12 }
		});
		expect(tiles(container).length).toBe(7);
	});

	it('threads selection down and reports activation up', async () => {
		const onSelect = vi.fn();
		const templates = [
			makeTemplate({ id: 'a', domain: 'Healthcare' }),
			makeTemplate({ id: 'b', domain: 'Housing' })
		];
		const { container, getByTestId } = render(SpectrumLandscape, {
			props: { templates, selectedId: 'a', onSelect }
		});

		// The selected tile carries the selected class — selection is passed down.
		const selected = container.querySelector('[data-template-id="a"]');
		expect(selected?.classList.contains('card-selected')).toBe(true);

		// Activating a tile reports its id up.
		await fireEvent.click(getByTestId('template-button-b'));
		expect(onSelect).toHaveBeenCalledWith('b');
	});

	it('activates a tile from the keyboard (Enter), reporting the id up', async () => {
		const onSelect = vi.fn();
		const templates = [makeTemplate({ id: 'a', domain: 'Healthcare' })];
		const { getByTestId } = render(SpectrumLandscape, {
			props: { templates, onSelect }
		});
		await fireEvent.keyDown(getByTestId('template-button-a'), { key: 'Enter' });
		expect(onSelect).toHaveBeenCalledWith('a');
	});

	it('is alive empty: at the zero-send seed it draws no momentum Pulse', () => {
		const templates = [
			makeTemplate({ id: 'a', domain: 'Healthcare', send_count: 0, daily_arrivals: [] }),
			makeTemplate({ id: 'b', domain: 'Housing', send_count: 0 })
		];
		const { container } = render(SpectrumLandscape, {
			props: { templates, onSelect: vi.fn() }
		});
		// The field is still a structured topical space — bands and tiles render…
		expect(bandNames(container).length).toBe(2);
		expect(tiles(container).length).toBe(2);
		// …but no band draws a dead rhythm where there is no coordination.
		expect(bandPulses(container).length).toBe(0);
	});

	it('comes alive as sends arrive: a band with real arrivals draws its rhythm', () => {
		const templates = [
			makeTemplate({
				id: 'a',
				domain: 'Healthcare',
				send_count: 10,
				daily_arrivals: [1, 2, 3]
			})
		];
		const { container } = render(SpectrumLandscape, {
			props: { templates, onSelect: vi.fn() }
		});
		expect(bandPulses(container).length).toBe(1);
	});

	it('renders an honest empty state when there are no templates', () => {
		const { container, getByText } = render(SpectrumLandscape, {
			props: { templates: [], onSelect: vi.fn() }
		});
		expect(tiles(container).length).toBe(0);
		// Plain English, no dead "0 templates" counter.
		expect(getByText('No templates yet.')).toBeTruthy();
		expect(container.textContent).not.toMatch(/\b0\s+templates\b/);
	});

	it('carries no foreign chrome — no pill, no white box, no oversized radius', () => {
		const templates = [makeTemplate({ id: 'a', domain: 'Healthcare' })];
		const { container } = render(SpectrumLandscape, {
			props: { templates, onSelect: vi.fn() }
		});
		const field = container.querySelector('.spectrum-landscape') as HTMLElement;
		expect(field).toBeTruthy();
		expect(field.className).not.toMatch(/\bbg-white\b/);
		expect(field.className).not.toMatch(/rounded-(xl|2xl|3xl|full)\b/);
	});
});

/** A lens segment by its target lens, for clicking / reading active state. */
function lensButton(container: HTMLElement, lens: 'topic' | 'place'): HTMLButtonElement {
	return container.querySelector(`[data-lens="${lens}"]`) as HTMLButtonElement;
}

/** Place chips rendered on the tiles (place lens only), in document order. */
function placeChips(container: HTMLElement): string[] {
	return Array.from(container.querySelectorAll('.place-chip')).map(
		(el) => el.textContent?.trim() ?? ''
	);
}

/**
 * Build precision groups the way the page passes them: the existing
 * `groupByPrecision` shape (title + level + ordered templates). The lens toggle
 * organises the SAME templates by these geographic tiers instead of by topic.
 */
type PlaceGroup = {
	title: string;
	level: 'district' | 'city' | 'county' | 'state' | 'nationwide';
	templates: Template[];
	minScore: number;
	coordinationCount: number;
};
function makePlaceGroup(title: string, level: PlaceGroup['level'], templates: Template[]): PlaceGroup {
	return { title, level, templates, minScore: 0, coordinationCount: 0 };
}

describe('SpectrumLandscape — lens toggle (topic ↔ place)', () => {
	const templates = [
		makeTemplate({ id: 'a', domain: 'Healthcare' }),
		makeTemplate({ id: 'b', domain: 'Housing' })
	];
	// The same templates, organised by geographic precision (place lens input).
	const placeGroups = [
		makePlaceGroup('In Your State', 'state', [templates[0]]),
		makePlaceGroup('Nationwide', 'nationwide', [templates[1]])
	];

	function renderField() {
		return render(SpectrumLandscape, {
			props: { templates, placeGroups, onSelect: vi.fn() }
		});
	}

	// `clearMocks`/`restoreMocks` reset the sessionStorage mock between tests, so
	// each test starts from the default `getItem → null` (the topic default).

	it('offers both lenses in plain English, defaulting to topic', () => {
		const { container } = renderField();
		const topic = lensButton(container, 'topic');
		const place = lensButton(container, 'place');
		expect(topic).toBeTruthy();
		expect(place).toBeTruthy();
		expect(topic.textContent?.trim()).toBe('topic');
		expect(place.textContent?.trim()).toBe('place');
		// Topic is the default lens.
		expect(topic.getAttribute('aria-pressed')).toBe('true');
		expect(place.getAttribute('aria-pressed')).toBe('false');
	});

	it('toggling place changes the group set from domains to geographic tiers', async () => {
		const { container } = renderField();
		// Topic lens: bands are domains.
		expect(bandNames(container)).toEqual(
			expect.arrayContaining(['Healthcare', 'Housing'])
		);
		expect(bandNames(container)).not.toContain('Nationwide');

		await fireEvent.click(lensButton(container, 'place'));

		// Place lens: bands are the precision tiers — a different group set.
		const placeBands = bandNames(container);
		expect(placeBands).toEqual(['In Your State', 'Nationwide']);
		expect(placeBands).not.toContain('Healthcare');
	});

	it('keeps every template in the field across both lenses (none dropped)', async () => {
		const { container } = renderField();
		expect(tiles(container).length).toBe(2);
		await fireEvent.click(lensButton(container, 'place'));
		expect(tiles(container).length).toBe(2);
	});

	it('hue stays domain-derived in the place lens (spine = lead template domain hue)', async () => {
		const { container } = renderField();
		await fireEvent.click(lensButton(container, 'place'));
		// Each place band's spine carries a --card-hue equal to its lead template's
		// resolved DOMAIN hue — colour still encodes topic, never place.
		const spines = Array.from(container.querySelectorAll('.band-spine')) as HTMLElement[];
		const stateSpineHue = spines[0].style.getPropertyValue('--card-hue').trim();
		// Healthcare leads the "In Your State" tier; its domain hue drives the spine.
		expect(stateSpineHue).toBe(String(resolveDomainHue(makeTemplate({ domain: 'Healthcare' }))));
	});

	it('shows a place chip on each tile in the place lens, absent in topic', async () => {
		const { container } = renderField();
		// Topic lens: no place chips.
		expect(placeChips(container)).toHaveLength(0);

		await fireEvent.click(lensButton(container, 'place'));
		// Place lens: each tile carries its tier as a chip.
		expect(placeChips(container)).toEqual(['In Your State', 'Nationwide']);
	});

	it('writes the chosen lens to sessionStorage so it can persist across reloads', async () => {
		const { container } = renderField();
		await fireEvent.click(lensButton(container, 'place'));
		// The choice is persisted under a stable key for a later visit to restore.
		expect(sessionStorage.setItem).toHaveBeenCalledWith('commons:landing-lens', 'place');

		await fireEvent.click(lensButton(container, 'topic'));
		expect(sessionStorage.setItem).toHaveBeenLastCalledWith('commons:landing-lens', 'topic');
	});

	it('restores the persisted lens on a fresh mount (a reload)', async () => {
		// A prior visit chose place; the store carries it across the reload.
		vi.mocked(sessionStorage.getItem).mockReturnValue('place');

		const { container } = renderField();
		// The mount effect reads the stored choice and opens on the place lens.
		await waitFor(() =>
			expect(lensButton(container, 'place').getAttribute('aria-pressed')).toBe('true')
		);
		expect(bandNames(container)).toEqual(['In Your State', 'Nationwide']);
	});
});
