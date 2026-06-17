import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// svelte/motion (pulled in transitively by the design primitives) reads
// prefers-reduced-motion via window.matchMedia at module evaluation. Shim it
// before the component loads so the import does not throw under jsdom.
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

const DescentDive = (
	await import('$lib/components/template-browser/DescentDive.svelte')
).default;

const COMPONENT_PATH = 'src/lib/components/template-browser/DescentDive.svelte';

/** A `dive` snippet standing in for the page's preview: a labelled button so the
 *  focus-into-dive and focus-trap behaviour have a real focusable to land on. */
function diveSnippet(label = 'Send this message') {
	return createRawSnippet(() => ({
		render: () => `<button type="button" data-testid="dive-cta">${label}</button>`
	}));
}

/** The risen dialog (the Artifact-wrapped preview floating over the field). The
 *  descent layer portals to document.body (so the full-viewport scrim escapes any
 *  ancestor stacking/overflow context), so look there, not in the container. */
function diveDialog(container: HTMLElement): HTMLElement | null {
	return container.ownerDocument.body.querySelector('[role="dialog"]');
}

/** The full-viewport backdrop scrim — the single plane that recedes the WHOLE page
 *  behind the dive, and the way back. */
function scrim(container: HTMLElement): HTMLButtonElement | null {
	return container.ownerDocument.body.querySelector('.dive-scrim');
}

describe('DescentDive — the one shared Artifact-over-scrim descent', () => {
	it('renders nothing while closed — the page is at rest', () => {
		const { container } = render(DescentDive, {
			props: { dive: diveSnippet(), open: false, onClose: vi.fn() }
		});
		expect(diveDialog(container)).toBeNull();
		expect(scrim(container)).toBeNull();
	});

	it('opens: the preview rises in a modal dialog over a single full-viewport scrim', () => {
		const { container, getByTestId } = render(DescentDive, {
			props: { dive: diveSnippet(), open: true, onClose: vi.fn() }
		});
		const dialog = diveDialog(container);
		expect(dialog).toBeTruthy();
		expect(dialog?.getAttribute('aria-modal')).toBe('true');
		// The supplied preview is mounted inside the risen surface, not forked.
		expect(getByTestId('dive-cta')).toBeTruthy();
		// Exactly one scrim plane (which blurs the whole page as one), not a per-
		// column filter.
		expect(container.ownerDocument.body.querySelectorAll('.dive-scrim').length).toBe(1);
	});

	it('floats the preview in an Artifact (the only bounded white surface), no foreign chrome', () => {
		const { container } = render(DescentDive, {
			props: { dive: diveSnippet(), open: true, onClose: vi.fn() }
		});
		// The risen surface wraps its content in an Artifact, not a hand-rolled box.
		expect(diveDialog(container)?.querySelector('.artifact')).toBeTruthy();
		// No oversized radius or pill chrome on the descent layer.
		const layer = container.ownerDocument.body.querySelector('.dive-layer') as HTMLElement;
		expect(layer.className).not.toMatch(/rounded-(xl|2xl|3xl|full)\b/);
	});

	it('moves focus into the risen preview on open', async () => {
		const { container, getByTestId } = render(DescentDive, {
			props: { dive: diveSnippet(), open: true, onClose: vi.fn() }
		});
		await waitFor(() => expect(document.activeElement).toBe(getByTestId('dive-cta')));
		expect(diveDialog(container)?.contains(document.activeElement)).toBe(true);
	});

	it('climbs out on escape — reporting the close up so the surface can restore', async () => {
		const onClose = vi.fn();
		const { container } = render(DescentDive, {
			props: { dive: diveSnippet(), open: true, onClose }
		});
		await fireEvent.keyDown(diveDialog(container)!.parentElement!, { key: 'Escape' });
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it('climbs out when the scrim is tapped (back to the field)', async () => {
		const onClose = vi.fn();
		const { container } = render(DescentDive, {
			props: { dive: diveSnippet(), open: true, onClose }
		});
		const back = scrim(container)!;
		expect(back.getAttribute('aria-label')).toBe('Back to the field');
		await fireEvent.click(back);
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it('round-trips: closing the descent tears down the dialog and scrim, page restored', async () => {
		// Reversible with no hidden state — re-render with `open` false (what the page
		// does on close) and the dialog and scrim are gone, exactly as before the dive.
		const { container, rerender } = render(DescentDive, {
			props: { dive: diveSnippet(), open: true, onClose: vi.fn() }
		});
		expect(diveDialog(container)).toBeTruthy();
		expect(scrim(container)).toBeTruthy();

		await rerender({ dive: diveSnippet(), open: false, onClose: vi.fn() });

		expect(diveDialog(container)).toBeNull();
		expect(scrim(container)).toBeNull();
	});

	it('returns focus to the originating element on close (the field comes back where it left)', async () => {
		// A node/tile in the document the dive rose from. On close the descent must
		// return focus to it via the supplied selector, so the surface lands back on
		// the exact element — not stranded on <body>.
		const origin = document.createElement('button');
		origin.setAttribute('data-template-id', 'origin-node');
		origin.textContent = 'origin';
		document.body.appendChild(origin);
		origin.focus();

		try {
			const { rerender, getByTestId } = render(DescentDive, {
				props: {
					dive: diveSnippet(),
					open: true,
					onClose: vi.fn(),
					restoreFocusSelector: '[data-template-id="origin-node"]'
				}
			});
			// Focus moved into the risen preview on open.
			await waitFor(() => expect(document.activeElement).toBe(getByTestId('dive-cta')));

			// Close → focus climbs back out to the originating element.
			await rerender({
				dive: diveSnippet(),
				open: false,
				onClose: vi.fn(),
				restoreFocusSelector: '[data-template-id="origin-node"]'
			});
			await waitFor(() => expect(document.activeElement).toBe(origin));
		} finally {
			origin.remove();
		}
	});

	it('uses motion.ts timing for the ascent (no off-token literal)', () => {
		const src = readFileSync(resolve(process.cwd(), COMPONENT_PATH), 'utf8');
		// The ascent rides motion.ts TIMING/EASING (imported, not inlined ms/cubic).
		expect(src).toMatch(/from\s+['"]\$lib\/design\/motion['"]/);
		expect(src).toMatch(/TIMING\.SLOW/);
		// No hand-rolled millisecond literal on the ascent animation.
		expect(src).not.toMatch(/animation:\s*dive-ascend\s+\d+ms/);
	});

	it('honors reduced motion: the scrim blur is dropped, the warm dim stays', () => {
		// The blur is the expensive, vestibular channel. Under prefers-reduced-motion
		// the scrim drops its backdrop-filter while the (cheap, non-vestibular) warm
		// dim remains. The scoped CSS is not injected into jsdom, so assert the
		// structural contract against the source.
		const src = readFileSync(resolve(process.cwd(), COMPONENT_PATH), 'utf8');
		const scrimRule = src.match(/\.dive-scrim\s*\{[^}]*\}/s)?.[0] ?? '';
		expect(scrimRule).toMatch(/backdrop-filter:\s*blur/);
		const reducedBlock =
			src.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{.*\}/s)?.[0] ?? '';
		const reducedScrim = reducedBlock.match(/\.dive-scrim\s*\{[^}]*\}/s)?.[0] ?? '';
		expect(reducedScrim).toMatch(/backdrop-filter:\s*none/);
		// The rise is also stilled under reduced motion (no travel).
		const reducedSurface = reducedBlock.match(/\.dive-surface\s*\{[^}]*\}/s)?.[0] ?? '';
		expect(reducedSurface).toMatch(/animation:\s*none/);
	});

	it('is the single descent vocabulary — no second Artifact-over-scrim implementation', () => {
		// The whole landing speaks ONE modal vocabulary for the dive. The spectrum and
		// the relation map both mount this component rather than forking their own
		// scrim. Assert the dive surface (.dive-surface) is declared in exactly one
		// component source across the template-browser surfaces.
		const surfaces = [
			'src/lib/components/template-browser/DescentDive.svelte',
			'src/lib/components/template-browser/spectrum/SpectrumLandscape.svelte',
			'src/lib/components/template-browser/relation/RelationGraph.svelte'
		];
		const declarers = surfaces.filter((p) => {
			const src = readFileSync(resolve(process.cwd(), p), 'utf8');
			// A real CSS declaration of the scrim plane (the rule body), not a prose
			// mention. The shared component is the only place it lives.
			return /\.dive-scrim\s*\{/.test(src);
		});
		expect(declarers).toEqual(['src/lib/components/template-browser/DescentDive.svelte']);
	});
});
