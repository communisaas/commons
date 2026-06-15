import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/svelte';
import type { Template } from '$lib/types/template';

// svelte/motion reads prefers-reduced-motion via window.matchMedia at module
// evaluation — before the shared beforeEach mock from tests/config/setup.ts
// applies. Shim it first, then import the component dynamically.
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

const TemplateTile = (
	await import('$lib/components/template-browser/spectrum/TemplateTile.svelte')
).default;

/**
 * Build a minimal valid Template. Overrides let each test pin only the fields
 * the assertion is about; everything else is a quiet, valid default.
 */
function makeTemplate(overrides: Partial<Template> = {}): Template {
	return {
		id: 't1',
		slug: 'test-template',
		title: 'Restore the clinic hours',
		description: 'Ask the county to fund evening hours at the public clinic.',
		domain: 'Public Health',
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

/** The Pulse primitive renders an SVG with this aria-label prefix. */
function pulses(container: HTMLElement): Element[] {
	return Array.from(container.querySelectorAll('svg[aria-label^="Rhythm"]'));
}

describe('TemplateTile', () => {
	it('renders the template title', () => {
		const { getByText } = render(TemplateTile, {
			props: { template: makeTemplate(), selected: false, onSelect: vi.fn() }
		});
		expect(getByText('Restore the clinic hours')).toBeTruthy();
	});

	it('renders a target line derived from delivery — direct email reads as direct delivery', () => {
		const { getByText, container } = render(TemplateTile, {
			props: { template: makeTemplate({ deliveryMethod: 'direct' }), onSelect: vi.fn() }
		});
		// The target presentation surfaces a label and an accompanying icon.
		expect(getByText('Direct delivery')).toBeTruthy();
		expect(container.querySelector('.card-icon, .card-icon-muted')).toBeTruthy();
	});

	it('renders the congressional target line for cwc delivery', () => {
		const { getByText } = render(TemplateTile, {
			props: { template: makeTemplate({ deliveryMethod: 'cwc' }), onSelect: vi.fn() }
		});
		expect(getByText('Your 3 representatives')).toBeTruthy();
	});

	it('omits the rhythm Pulse when there are no sends (alive empty, never a dead line)', () => {
		const { container } = render(TemplateTile, {
			props: {
				template: makeTemplate({ send_count: 0, daily_arrivals: [] }),
				onSelect: vi.fn()
			}
		});
		expect(pulses(container).length).toBe(0);
	});

	it('renders the rhythm Pulse only once sends and daily arrivals back it', () => {
		const { container } = render(TemplateTile, {
			props: {
				template: makeTemplate({ send_count: 12, daily_arrivals: [1, 3, 2, 6, 4] }),
				onSelect: vi.fn()
			}
		});
		expect(pulses(container).length).toBe(1);
	});

	it('does not render the Pulse when sends exist but no daily arrivals are present', () => {
		const { container } = render(TemplateTile, {
			props: {
				template: makeTemplate({ send_count: 12, daily_arrivals: [] }),
				onSelect: vi.fn()
			}
		});
		expect(pulses(container).length).toBe(0);
	});

	it('applies the selected class when selected and not otherwise', () => {
		const { container: selectedContainer } = render(TemplateTile, {
			props: { template: makeTemplate(), selected: true, onSelect: vi.fn() }
		});
		expect(selectedContainer.querySelector('.card-selected')).toBeTruthy();

		const { container: unselectedContainer } = render(TemplateTile, {
			props: { template: makeTemplate(), selected: false, onSelect: vi.fn() }
		});
		expect(unselectedContainer.querySelector('.card-selected')).toBeNull();
	});

	it('derives the weight class from delivery — congressional is heavy, the rest light', () => {
		const { container: heavy } = render(TemplateTile, {
			props: { template: makeTemplate({ deliveryMethod: 'cwc' }), onSelect: vi.fn() }
		});
		expect(heavy.querySelector('.card-weight-heavy')).toBeTruthy();
		expect(heavy.querySelector('.card-weight-light')).toBeNull();

		const { container: light } = render(TemplateTile, {
			props: { template: makeTemplate({ deliveryMethod: 'direct' }), onSelect: vi.fn() }
		});
		expect(light.querySelector('.card-weight-light')).toBeTruthy();
		expect(light.querySelector('.card-weight-heavy')).toBeNull();
	});

	it('sets the card hue from the template domain so the tint cites a real field', () => {
		const { container } = render(TemplateTile, {
			props: { template: makeTemplate({ domain: 'Public Health' }), onSelect: vi.fn() }
		});
		const button = container.querySelector('[data-template-button]') as HTMLElement;
		expect(button.style.getPropertyValue('--card-hue')).not.toBe('');
	});

	it('calls onSelect with the template id when activated', async () => {
		const onSelect = vi.fn();
		const { getByTestId } = render(TemplateTile, {
			props: { template: makeTemplate({ id: 'abc' }), onSelect }
		});
		await fireEvent.click(getByTestId('template-button-abc'));
		expect(onSelect).toHaveBeenCalledWith('abc');
	});

	it('reports hover to the list so it can preload', async () => {
		const onHover = vi.fn();
		const { getByTestId } = render(TemplateTile, {
			props: { template: makeTemplate({ id: 'abc' }), onSelect: vi.fn(), onHover }
		});
		const button = getByTestId('template-button-abc');
		await fireEvent.mouseEnter(button);
		expect(onHover).toHaveBeenCalledWith('abc', true);
		await fireEvent.mouseLeave(button);
		expect(onHover).toHaveBeenCalledWith('abc', false);
	});

	it('shows the deliberation signal only when a debate is active', () => {
		const { queryByText, rerender } = render(TemplateTile, {
			props: { template: makeTemplate({ hasActiveDebate: false }), onSelect: vi.fn() }
		});
		expect(queryByText('Deliberating')).toBeNull();

		rerender({ template: makeTemplate({ hasActiveDebate: true }), onSelect: vi.fn() });
		expect(queryByText('Deliberating')).toBeTruthy();
	});

	it('tags each dimension mark by role so a narrow tile can shed the right ones', () => {
		// With sends behind all three marks, the tile carries the rhythm (Pulse),
		// districts (Ratio) and depth (Rings). The marks the narrow-tile rule sheds
		// (districts + depth) carry their own role classes, and the rhythm — the one
		// that stays — is tagged distinctly. The shedding itself is a container-width
		// rule; this pins the structure that rule targets.
		const { container } = render(TemplateTile, {
			props: {
				template: makeTemplate({
					send_count: 30,
					daily_arrivals: [2, 4, 3, 6, 5],
					district_counts: [
						{ code: 'CA-12', count: 9 },
						{ code: 'NY-08', count: 7 }
					],
					tier_counts: [0, 0, 4, 6, 0, 0]
				}),
				onSelect: vi.fn()
			}
		});
		// The mark that stays on a narrow tile.
		expect(container.querySelector('.template-dimension--rhythm')).toBeTruthy();
		// The marks that step aside when the tile narrows.
		expect(container.querySelector('.template-dimension--districts')).toBeTruthy();
		expect(container.querySelector('.template-dimension--depth')).toBeTruthy();
	});

	it('keeps the dimension marks inside the tile card so shedding tracks the tile width', () => {
		// The narrow-tile shedding reads the TILE's width (a container-query on the
		// card), so the dimension row must live inside the tile button — not in some
		// outer wrapper whose width the tile cannot see. This pins that containment;
		// the width threshold itself is exercised at real tile widths in the
		// responsive pass (jsdom does not resolve scoped container-query layout).
		const { container } = render(TemplateTile, {
			props: {
				template: makeTemplate({
					send_count: 30,
					daily_arrivals: [2, 4, 3, 6, 5],
					district_counts: [
						{ code: 'CA-12', count: 9 },
						{ code: 'NY-08', count: 7 }
					],
					tier_counts: [0, 0, 4, 6, 0, 0]
				}),
				onSelect: vi.fn()
			}
		});
		const button = container.querySelector('[data-template-button]') as HTMLElement;
		const dims = button.querySelector('.template-dimensions');
		expect(dims).toBeTruthy();
		// Each sheddable mark sits within the tile card, so the card's own width
		// governs whether it sheds.
		expect(button.querySelector('.template-dimension--districts')).toBeTruthy();
		expect(button.querySelector('.template-dimension--depth')).toBeTruthy();
	});
});
