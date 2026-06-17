/**
 * D1 perceptual surface — signal merge honesty, switch direction, and the static
 * contracts (pulse SSOT, window-scroll restore, reduced-motion gates, never
 * display:none). Pure helpers + source pins; no Svelte runtime.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mergeSignal, spaceSwitchDirection } from '$lib/components/org/os/perceptual';

const src = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

const kernel = (id: string, event: string, t: number) => ({ id, event, emittedAt: t });

describe('mergeSignal (honesty + non-clobber)', () => {
	it('interleaves both sources newest-first and tags each source', () => {
		const merged = mergeSignal(
			[kernel('srv1', 'supporter.created', 100)],
			[kernel('sig-1', 'Composed "X"', 200)]
		);
		expect(merged.rows.map((r) => r.id)).toEqual(['sig-1', 'srv1']); // newest first
		expect(merged.rows[0].source).toBe('kernel');
		expect(merged.rows[1].source).toBe('server');
		expect(merged.count).toBe(2); // honest union
	});

	it('server-null + kernel events shows the LIVE count, never a fabricated server read', () => {
		const merged = mergeSignal(null, [kernel('sig-1', 'Composed "X"', 1)]);
		expect(merged.count).toBe(1); // live-only, not 'unread'
		expect(merged.rows).toHaveLength(1);
	});

	it('server-null + no kernel stays unread (null), never a fabricated 0', () => {
		expect(mergeSignal(null, []).count).toBeNull();
	});

	it('never drops server rows when kernel rows exist (no clobber)', () => {
		const server = [kernel('s1', 'supporter.created', 1), kernel('s2', 'donation.completed', 2)];
		const merged = mergeSignal(server, [kernel('sig-1', 'Composed "X"', 3)]);
		expect(merged.rows.filter((r) => r.source === 'server')).toHaveLength(2);
		expect(merged.count).toBe(3);
	});

	it('caps the RENDER but keeps the count honest (union beyond the window)', () => {
		const kernelEvents = Array.from({ length: 20 }, (_, i) => kernel(`sig-${i}`, `e${i}`, i));
		const merged = mergeSignal([kernel('s1', 'supporter.created', 999)], kernelEvents, 12);
		expect(merged.rows).toHaveLength(12); // render capped
		expect(merged.count).toBe(21); // count is the true union
		expect(merged.rows[0].id).toBe('s1'); // newest (emittedAt 999) survives the cap
	});
});

describe('spaceSwitchDirection', () => {
	it('is +1 rightward, -1 leftward, 0 for same/unknown', () => {
		expect(spaceSwitchDirection('studio', 'landscape')).toBe(1);
		expect(spaceSwitchDirection('return', 'studio')).toBe(-1);
		expect(spaceSwitchDirection('base', 'base')).toBe(0);
		expect(spaceSwitchDirection(null, 'studio')).toBe(0);
	});
});

describe('pulse SSOT (D1 §e)', () => {
	const sites = [
		'src/lib/components/org/os/ProcessDock.svelte',
		'src/lib/components/org/WorkspaceSwitcher.svelte',
		'src/lib/components/org/os/StudioSpace.svelte',
		'src/lib/components/org/studio/StudioReasoning.svelte'
	].map(src);

	it('no 1.6s/2s animation literal survives in the four pulse sites', () => {
		for (const s of sites) {
			expect(s).toMatch(/var\(--pulse-duration\)/);
			expect(s).not.toMatch(/animation:[^;]*\b(1\.6s|2s)\b/);
		}
	});

	it('the pulse tempo is defined once in app.css', () => {
		expect(src('src/app.css')).toContain('--pulse-duration:');
	});
});

describe('OrgShell scroll memory + transition contracts', () => {
	const shell = src('src/lib/components/org/os/OrgShell.svelte');

	it('restores window scroll (not main.scrollTop), instantly, browser-guarded', () => {
		expect(shell).toContain('window.scrollTo');
		expect(shell).toContain("behavior: 'auto'");
		expect(shell).not.toContain("behavior: 'smooth'");
		expect(shell).not.toMatch(/scrollTop\s*=/); // no main.scrollTop WRITE (comment mention is fine)
		expect(shell).toContain('if (!browser');
	});

	it('inactive spaces use visibility, NEVER display:none (stream never stranded)', () => {
		expect(shell).toContain('visibility: hidden');
		expect(shell).not.toMatch(/\.org-space\[hidden\]\s*{[^}]*display:\s*none/);
	});

	it('the switch transition is zeroed under prefers-reduced-motion at MATCHING specificity', () => {
		const i = shell.indexOf('prefers-reduced-motion');
		expect(i).toBeGreaterThanOrEqual(0);
		const rmBlock = shell.slice(i, i + 320);
		// The override MUST target the per-state [data-active] selectors so it ties
		// the (0,2,0) animating selectors and wins on source order. A bare
		// `.org-space` (0,1,0) is OUTRANKED → the fade/translate still run under
		// reduced-motion (the RG-3 catch). This pins the specificity-tier fix.
		expect(rmBlock).toContain("[data-active='true']");
		expect(rmBlock).toMatch(/transition:\s*none/);
		expect(rmBlock).toMatch(/transform:\s*none/);
	});
});

describe('SignalWell enter is reduced-motion gated', () => {
	it('the signal-row enter animation is disabled under reduced motion', () => {
		const well = src('src/lib/components/org/SignalWell.svelte');
		expect(well).toMatch(/prefers-reduced-motion:\s*reduce/);
		expect(well).toContain('signal-enter');
	});
});
