/**
 * UnifiedModal a11y contracts.
 *
 * Titleless modals (debate, wallet-connect, sign-in,
 * identity-verification) must have ariaLabel fallback, focus capture/
 * restoration, and a Tab/Shift+Tab focus trap — WCAG 2.1 2.4.3 +
 * 2.1.2 + 4.1.2 baselines. Source-text pins fire on regression that
 * drops any of these. Behavioral testing of focus order is achievable
 * but the source-text pin is the cheap defense.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const UNIFIED_MODAL = path.resolve(
	process.cwd(),
	'src/lib/components/ui/UnifiedModal.svelte'
);

function source(): string {
	return fs.readFileSync(UNIFIED_MODAL, 'utf8');
}

describe('UnifiedModal a11y contracts', () => {
	it('has an ariaLabel prop with fallback to "Modal dialog" when title is empty', () => {
		const svelte = source();
		// Prop exists.
		expect(svelte).toMatch(/ariaLabel(\??:\s*string|\s*=\s*['"])/);
		// Fallback string present.
		expect(svelte).toContain("ariaLabel || 'Modal dialog'");
		// aria-label is applied to the dialog element when no title.
		expect(svelte).toMatch(/aria-label=\{!title \? \(ariaLabel \|\| 'Modal dialog'\) : undefined\}/);
	});

	it('captures previously-focused element on open and restores on close', () => {
		const svelte = source();
		expect(svelte).toContain('previouslyFocused');
		// Capture happens inside the open effect.
		expect(svelte).toContain('document.activeElement instanceof HTMLElement');
		// Restoration on close.
		expect(svelte).toContain('previouslyFocused.focus()');
		// Silent catch on restoration (element may have been removed).
		expect(svelte).toMatch(/previouslyFocused\.focus\(\)[\s\S]*?\} catch \{/);
	});

	it('moves focus into the dialog via queueMicrotask on open', () => {
		const svelte = source();
		expect(svelte).toContain('queueMicrotask');
		// Focusable selector covers buttons, inputs, links, etc.
		expect(svelte).toMatch(/button:not\(\[disabled\]\), \[href\], input:not\(\[disabled\]\)/);
		expect(svelte).toContain('first.focus()');
	});

	it('traps Tab/Shift+Tab cycle within the dialog', () => {
		const svelte = source();
		expect(svelte).toContain('handleKeydown');
		// Tab and Shift+Tab handled.
		expect(svelte).toContain("e.key === 'Tab'");
		expect(svelte).toContain('e.shiftKey && active === first');
		expect(svelte).toContain('!e.shiftKey && active === last');
		expect(svelte).toContain('e.preventDefault()');
	});

	it('backdrop is not a Tab target (tabindex=-1)', () => {
		const svelte = source();
		// The backdrop's role+aria-modal remain; tabindex moved to -1
		// so keyboard users land on focusables inside the modal, not
		// on the backdrop itself.
		expect(svelte).toMatch(/tabindex="-1"/);
		// No bare tabindex="0" on the backdrop would re-introduce
		// backdrop-as-Tab-target behavior.
		expect(svelte).not.toMatch(/role="dialog"[\s\S]{0,300}tabindex="0"/);
	});

	it('Escape key still closes the modal when closeOnEscape is true', () => {
		const svelte = source();
		// Escape handling lives in the named `handleKeydown` handler
		// alongside the focus trap, not as an inline `onkeydown` lambda.
		expect(svelte).toContain("e.key === 'Escape' && closeOnEscape");
		expect(svelte).toContain('modal.close()');
	});
});
