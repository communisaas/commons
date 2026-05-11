/**
 * Pre-send boundary-cell honesty banner (NON-modal).
 *
 * Static source verification: confirms the canonical render surface
 * (ProofGenerator.svelte) carries the boundary banner with the required
 * shape:
 *   - non-modal (no aria-modal="true" on the banner element)
 *   - gated on `cellStraddles` (not on `trustTier`, `district`, or any
 *     other field that would block send on a soft signal)
 *   - cites the measured population number (16% / California)
 *   - readable with the send button still functional below it
 *
 * Component-level rendering tests were skipped because the project's
 * @testing-library/svelte + vitest infrastructure has known
 * incompatibilities with Svelte 5. Static-source assertions are the
 * pragmatic floor.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';

describe('Boundary-cell honesty banner (NON-modal)', () => {
	const componentPath = path.resolve(
		process.cwd(),
		'src/lib/components/template/ProofGenerator.svelte'
	);

	it('renders the banner conditionally on cellStraddles, not on tier or district', async () => {
		const source = await fs.readFile(componentPath, 'utf8');
		// The banner is gated by `{#if cellStraddles}`. Gating VISIBILITY on
		// cellStraddles is fine; gating SEND on it would be a reversal of the
		// soft-signal stance. Assert the visibility condition is exactly the
		// straddle flag and nothing more.
		expect(source).toMatch(/\{#if cellStraddles\}/);
		// Confirm there is no `disabled={cellStraddles}` or similar pattern
		// on the send button — i.e., the banner does not gate send.
		expect(source).not.toMatch(/disabled=\{[^}]*cellStraddles[^}]*\}/);
	});

	it('uses an inline aside (non-modal) and not a blocking dialog', async () => {
		const source = await fs.readFile(componentPath, 'utf8');
		// The banner element is an <aside>, not a <dialog>, and explicitly
		// not flagged aria-modal="true". A modal here would block send.
		const banner = source.split('{#if cellStraddles}')[1]?.split('{/if}')[0] ?? '';
		expect(banner).toMatch(/<aside/);
		expect(banner).not.toMatch(/role="dialog"/);
		expect(banner).not.toMatch(/aria-modal="true"/);
	});

	it('cites the G3-measured population number for the launch state (CA)', async () => {
		const source = await fs.readFile(componentPath, 'utf8');
		// Measurement reports ~16.4% boundary-cell rate for California. The
		// copy MUST cite a specific number (not "some" / "a few" / "many"),
		// MUST attribute to California specifically (other states have not
		// been measured), and MUST acknowledge "other states pending." A
		// launch-state-honest banner is what makes the non-modal banner
		// trustworthy.
		expect(source).toMatch(/16%/);
		expect(source).toMatch(/California/);
		expect(source).toMatch(/other states pending/i);
	});

	it('keeps the send button reachable below the banner', async () => {
		const source = await fs.readFile(componentPath, 'utf8');
		// Lexical order matters: banner first, then the button row, all
		// inside the same idle-state container. Guards against accidental
		// "hide send under banner."
		const idleStart = source.indexOf("proofState.status === 'idle'");
		const sendButton = source.indexOf('Send to Representative', idleStart);
		const bannerStart = source.indexOf('{#if cellStraddles}', idleStart);
		expect(idleStart).toBeGreaterThan(0);
		expect(bannerStart).toBeGreaterThan(idleStart);
		expect(sendButton).toBeGreaterThan(bannerStart);
	});

	it('autoStart does NOT skip idle state when cellStraddles=true', async () => {
		const source = await fs.readFile(componentPath, 'utf8');
		// TemplateModal sets autoStart={true} on the canonical send path. If
		// autoStart unconditionally skipped idle, the banner would never
		// render for the very users who need it. The onMount logic must
		// guard `if (autoStart && !resolvedCellStraddles)`. Anything weaker
		// (e.g. plain `if (autoStart)`) regresses the banner.
		expect(source).toMatch(/if \(autoStart && !resolvedCellStraddles\)/);
	});
});

describe('DebateProofGenerator boundary-banner parity', () => {
	const debatePath = path.resolve(
		process.cwd(),
		'src/lib/components/debate/DebateProofGenerator.svelte'
	);

	it('renders the same boundary banner gated on cellStraddles', async () => {
		const source = await fs.readFile(debatePath, 'utf8');
		expect(source).toMatch(/\{#if cellStraddles\}/);
		expect(source).toMatch(/16%/);
		expect(source).toMatch(/California/);
	});

	it('honors the autoStart contract on the debate path too', async () => {
		const source = await fs.readFile(debatePath, 'utf8');
		expect(source).toMatch(/if \(autoStart && !resolvedCellStraddles\)/);
	});

	it('uses an aside, not a dialog, for the debate boundary banner', async () => {
		const source = await fs.readFile(debatePath, 'utf8');
		const banner = source.split('{#if cellStraddles}')[1]?.split('{/if}')[0] ?? '';
		expect(banner).toMatch(/<aside/);
		expect(banner).not.toMatch(/aria-modal="true"/);
	});
});
