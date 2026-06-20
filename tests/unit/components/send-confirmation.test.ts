/**
 * SendConfirmation (P2: the engineered send peak + the honesty confirm) and its
 * /s/[slug] wiring. A mailto handoff only reveals the mail app OPENED, never that
 * mail was sent — so "contacted" must be set ONLY on an explicit user confirm, and
 * the copy must never claim delivery the system can't observe. Source-pin coverage.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

describe('SendConfirmation — honest peak', () => {
	const sc = src('src/lib/components/action/SendConfirmation.svelte');

	it('is honest: "opened your mail app", never claims delivery it cannot observe', () => {
		expect(sc).toContain('opened your mail app');
		expect(sc).toContain("we can't see your mail app");
		expect(sc).not.toMatch(/\b(delivered|received by|reached their inbox)\b/i);
	});

	it('marks contact only via an explicit confirm — contact FIRST, then advance to success', () => {
		const start = sc.indexOf('function confirmSent');
		const fn = sc.slice(start, sc.indexOf('}', start) + 1);
		expect(fn).toContain('onConfirmSent()');
		expect(fn.indexOf('onConfirmSent()')).toBeLessThan(fn.indexOf("stage = 'sent'"));
	});

	it('is an accessible modal: role=dialog, Escape close, Tab-trap, focus-into-dialog', () => {
		expect(sc).toContain('role="dialog"');
		expect(sc).toContain('aria-modal="true"');
		expect(sc).toMatch(/key === 'Escape'/);
		expect(sc).toMatch(/e\.key !== 'Tab'/); // trap
		expect(sc).toContain("querySelector<HTMLElement>('button:not(.sc-close)')"); // focus-into on open
	});

	it('reduced-motion gates the rise; the copy stage has a manual-select fallback', () => {
		const i = sc.indexOf('prefers-reduced-motion');
		expect(i).toBeGreaterThan(-1);
		expect(sc.slice(i, i + 180)).toContain('animation: none');
		expect(sc).toContain('sc-copy-text');
		expect(sc).toContain('readonly');
		expect(sc).toContain('copyFailed'); // clipboard-denied feedback
	});
});

describe('SendConfirmation wiring — /s/[slug] honesty + lifecycle', () => {
	const slug = src('src/routes/s/[slug]/+page.svelte');

	it('the tab-return auto-promote settle effect is GONE (no heuristic "contacted")', () => {
		expect(slug).not.toContain('...contactedRecipients, ...departingRecipients'); // old settle promotion
		expect(slug).not.toContain('contactedRecipients, member.id'); // old optimistic single mark
	});

	it('contact is promoted ONLY by the explicit confirm handler', () => {
		expect(slug).toMatch(
			/function confirmSendContacted\(\)[\s\S]{0,320}contactedRecipients = new Set\(\[\.\.\.contactedRecipients, \.\.\.ids\]\)/
		);
	});

	it('a send sets in-flight then opens the peak (never optimistic contacted)', () => {
		expect(slug).toMatch(
			/departingRecipients = new Set\(\[\.\.\.departingRecipients, member\.id\]\)[\s\S]{0,700}sendConfirmation = \{/
		);
	});

	it('guards a concurrent send while a peak is pending', () => {
		expect(slug).toContain('if (sendConfirmation) return;');
	});

	it('renders the peak wired to the confirm + close handlers', () => {
		const start = slug.indexOf('<SendConfirmation');
		const tag = slug.slice(start, slug.indexOf('/>', start));
		expect(tag).toContain('onConfirmSent={confirmSendContacted}');
		expect(tag).toContain('onClose={closeSendConfirmation}');
	});
});
