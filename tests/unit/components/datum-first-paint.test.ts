/**
 * Datum first-paint honesty.
 *
 * Datum is the design-system primitive for verifiable numeric claims.
 * Its spring must initialize at the incoming value so the first paint
 * (and server-rendered HTML, which shares the same initial state) carries
 * the real number — a spring that starts at 0 would claim "0" for every
 * count until the animation loop catches up.
 */

import { describe, it, expect } from 'vitest';
import { render, waitFor } from '@testing-library/svelte';

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

const Datum = (await import('$lib/design/Datum.svelte')).default;

describe('Datum first paint', () => {
	it('paints the real value immediately when animated, not a transient 0', () => {
		const { container } = render(Datum, { props: { value: 1248, animate: true } });
		expect(container.textContent?.trim()).toBe('1,248');
	});

	it('paints the real value immediately when static', () => {
		const { container } = render(Datum, { props: { value: 5 } });
		expect(container.textContent?.trim()).toBe('5');
	});

	it('paints fixed-decimal values immediately', () => {
		const { container } = render(Datum, {
			props: { value: 0.94, decimals: 2, animate: true }
		});
		expect(container.textContent?.trim()).toBe('0.94');
	});

	it('renders an em-dash for null, never a number', () => {
		const { container } = render(Datum, { props: { value: null } });
		expect(container.textContent?.trim()).toBe('—');
	});

	it('renders a real 0 when the value is actually 0', () => {
		const { container } = render(Datum, { props: { value: 0, animate: true } });
		expect(container.textContent?.trim()).toBe('0');
	});

	it('still springs through intermediate values on change', async () => {
		const { container, rerender } = render(Datum, {
			props: { value: 100, animate: true }
		});
		expect(container.textContent?.trim()).toBe('100');

		await rerender({ value: 200 });
		// The spring eases toward the target rather than jumping.
		expect(container.textContent?.trim()).not.toBe('200');
		await waitFor(() => expect(container.textContent?.trim()).toBe('200'));
	});

	it('jumps straight to the new value when animation is off', async () => {
		const { container, rerender } = render(Datum, { props: { value: 100 } });
		await rerender({ value: 200 });
		expect(container.textContent?.trim()).toBe('200');
	});
});
