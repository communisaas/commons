/**
 * CredibilityLadder (P1: verification ladder shown as a ladder, not walls) +
 * its two wirings. Source-pin coverage of the load-bearing invariants:
 * honesty (target-aware payoff, no false send-now, no false next-step in the
 * mDL dead-end), a11y (focus-visible, SR labels, reduced-motion), and the
 * send-nudge gating (only where a lower-tier send is genuinely permitted).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

describe('CredibilityLadder — honesty + a11y + motion', () => {
	const ladder = src('src/lib/components/auth/CredibilityLadder.svelte');

	it('District payoff is target-aware — the "offices prioritize constituents" claim is guarded by electedTarget', () => {
		expect(ladder).toContain('electedTarget');
		// the elected-specific claim only appears inside the electedTarget ternary
		expect(ladder).toMatch(/electedTarget[\s\S]{0,120}offices prioritize confirmed constituents/);
		// the default (institutional/direct) payoff makes no constituent claim
		expect(ladder).toContain("Confirms you're a real local resident");
	});

	it('the ceiling fallback is honest — highest AVAILABLE today, not highest absolute', () => {
		expect(ladder).toContain('the highest level available today');
		expect(ladder).not.toContain('the highest live tier');
	});

	it('stops are focusable buttons with a screen-reader label; the detail line is announced', () => {
		expect(ladder).toContain('<button');
		expect(ladder).toMatch(/aria-label=\{`\$\{s\.label\}/);
		expect(ladder).toContain('aria-live="polite"');
	});

	it('the compact CTA has a focus-visible indicator (keyboard a11y)', () => {
		expect(ladder).toContain('.cl-link:focus-visible');
	});

	it('the compact status has a guest fallback (never a blank span)', () => {
		const compact = ladder.slice(ladder.indexOf('cl-compact-status'), ladder.indexOf('</span>', ladder.indexOf('cl-compact-status')));
		expect(compact).toContain('Sign in to send');
	});

	it('reduced-motion gates the pulse animation AND the active-stop scale', () => {
		const i = ladder.indexOf('prefers-reduced-motion');
		expect(i).toBeGreaterThan(-1);
		const block = ladder.slice(i, i + 420);
		expect(block).toContain('animation: none'); // pulse off
		expect(block).toMatch(/cl-stop--active \.cl-dot \{ transform: none/); // scale off
	});
});

describe('CredibilityLadder wiring — verification gate (walls → ladder, P5 fold-in)', () => {
	const gate = src('src/lib/components/auth/VerificationGate.svelte');

	it('replaces the binary "Verify X to Send" wall headers with the ladder', () => {
		expect(gate).toContain('<CredibilityLadder');
		expect(gate).not.toContain('Verify Your Address to Send');
		expect(gate).not.toContain('Verify Your Identity to Send');
	});

	it('the gate ladder is the elected context and carries NO false lower-tier send-now escape', () => {
		const start = gate.indexOf('<CredibilityLadder');
		const tag = gate.slice(start, gate.indexOf('/>', start));
		expect(tag).toContain('electedTarget={true}');
		expect(tag).not.toContain('onSendNow'); // hard-required gate: lower-tier send isn't an option here
	});

	it('does NOT render the climbable ladder in the mdlGated dead-end (no false next step)', () => {
		// the action requires unavailable gov-ID, so a "confirm district" climb would mislead
		expect(gate).toMatch(/\{#if !mdlGated\}[\s\S]{0,400}<CredibilityLadder/);
	});
});

describe('CredibilityLadder wiring — /s/[slug] send nudge', () => {
	const slug = src('src/routes/s/[slug]/+page.svelte');

	it('the nudge only shows where a lower-tier send is permitted (signed-in, tier in [1,2), non-CWC)', () => {
		expect(slug).toMatch(
			/showLadderNudge\s*=\s*\$derived\([\s\S]{0,160}ladderNudgeTier >= 1 && ladderNudgeTier < 2 && !isCongressional/
		);
	});

	it('the nudge is the compact ladder with a climb only — never a duplicate send-now', () => {
		const start = slug.indexOf('{#if showLadderNudge}');
		const block = slug.slice(start, slug.indexOf('{/if}', start));
		expect(block).toContain('<CredibilityLadder');
		expect(block).toContain('compact');
		expect(block).toContain('onClimb');
		expect(block).not.toContain('onSendNow');
	});
});
