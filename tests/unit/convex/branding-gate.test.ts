/**
 * D-08 / D-10 — Coalition-tier gate on the branding writers.
 *
 * The branding mutations (`organizations.setBranding`, the `brandingAccent` arm
 * of `organizations.update`) funnel their tier decision through the pure
 * helpers in `convex/_brandingGate.ts`. These tests pin the gate behavior at
 * the helper level — the single source of truth the Convex handlers delegate to
 * — so the "only Coalition can write branding" invariant is covered without a
 * live Convex context.
 *
 * Invariants pinned here:
 *   - accent/logo/whiteLabel writes are REJECTED below Coalition tier;
 *   - the same writes are ALLOWED at Coalition tier;
 *   - clearing (empty accent, null logo, whiteLabel=false) is allowed at ANY
 *     tier so an org can always re-attach Commons branding / drop overrides;
 *   - only active/trialing subscriptions count as a paid plan.
 */

import { describe, it, expect } from 'vitest';
import {
	effectivePlan,
	isCoalitionPlan,
	isValidAccentHex,
	decideAccentWrite,
	logoWriteAllowed,
	whiteLabelWriteAllowed
} from '../../../convex/_brandingGate';

describe('effectivePlan', () => {
	it('treats active/trialing subscriptions as their paid plan', () => {
		expect(effectivePlan({ status: 'active', plan: 'coalition' })).toBe('coalition');
		expect(effectivePlan({ status: 'trialing', plan: 'coalition' })).toBe('coalition');
		expect(effectivePlan({ status: 'active', plan: 'organization' })).toBe('organization');
	});

	it('treats canceled/past_due/missing as free', () => {
		expect(effectivePlan({ status: 'canceled', plan: 'coalition' })).toBe('free');
		expect(effectivePlan({ status: 'past_due', plan: 'coalition' })).toBe('free');
		expect(effectivePlan(null)).toBe('free');
		expect(effectivePlan(undefined)).toBe('free');
		expect(effectivePlan({ status: 'active' })).toBe('free');
	});
});

describe('isCoalitionPlan', () => {
	it('is true only for coalition', () => {
		expect(isCoalitionPlan('coalition')).toBe(true);
		expect(isCoalitionPlan('organization')).toBe(false);
		expect(isCoalitionPlan('starter')).toBe(false);
		expect(isCoalitionPlan('free')).toBe(false);
	});
});

describe('isValidAccentHex', () => {
	it('accepts 3- and 6-digit hex with or without #', () => {
		expect(isValidAccentHex('#0d9488')).toBe(true);
		expect(isValidAccentHex('0d9488')).toBe(true);
		expect(isValidAccentHex('#abc')).toBe(true);
		expect(isValidAccentHex('abc')).toBe(true);
	});
	it('rejects malformed values', () => {
		expect(isValidAccentHex('teal')).toBe(false);
		expect(isValidAccentHex('#12')).toBe(false);
		expect(isValidAccentHex('#1234')).toBe(false);
		expect(isValidAccentHex('javascript:alert(1)')).toBe(false);
	});
});

describe('decideAccentWrite — Coalition gate', () => {
	it('REJECTS a non-empty accent below Coalition tier (free)', () => {
		const d = decideAccentWrite('free', '#0d9488');
		expect(d.ok).toBe(false);
		if (!d.ok) expect(d.reason).toBe('tier');
	});

	it('REJECTS a non-empty accent at organization tier', () => {
		const d = decideAccentWrite('organization', '#0d9488');
		expect(d.ok).toBe(false);
		if (!d.ok) expect(d.reason).toBe('tier');
	});

	it('ALLOWS a valid accent at Coalition tier and normalizes it', () => {
		const d = decideAccentWrite('coalition', '#0d9488');
		expect(d.ok).toBe(true);
		if (d.ok && !d.cleared) expect(d.value).toBe('#0d9488');
	});

	it('REJECTS an invalid hex at Coalition tier (format, not tier)', () => {
		const d = decideAccentWrite('coalition', 'not-a-color');
		expect(d.ok).toBe(false);
		if (!d.ok) expect(d.reason).toBe('format');
	});

	it('ALLOWS clearing (empty/null/undefined) at ANY tier', () => {
		for (const plan of ['free', 'organization', 'coalition']) {
			expect(decideAccentWrite(plan, '')).toEqual({ ok: true, cleared: true });
			expect(decideAccentWrite(plan, null)).toEqual({ ok: true, cleared: true });
			expect(decideAccentWrite(plan, undefined)).toEqual({ ok: true, cleared: true });
		}
	});
});

describe('logoWriteAllowed — Coalition gate', () => {
	it('REJECTS setting a logo below Coalition tier', () => {
		expect(logoWriteAllowed('free', false)).toBe(false);
		expect(logoWriteAllowed('organization', false)).toBe(false);
	});
	it('ALLOWS setting a logo at Coalition tier', () => {
		expect(logoWriteAllowed('coalition', false)).toBe(true);
	});
	it('ALLOWS clearing a logo at ANY tier', () => {
		expect(logoWriteAllowed('free', true)).toBe(true);
		expect(logoWriteAllowed('organization', true)).toBe(true);
		expect(logoWriteAllowed('coalition', true)).toBe(true);
	});
});

describe('whiteLabelWriteAllowed — Coalition gate', () => {
	it('REJECTS enabling white-label below Coalition tier', () => {
		expect(whiteLabelWriteAllowed('free', true)).toBe(false);
		expect(whiteLabelWriteAllowed('organization', true)).toBe(false);
	});
	it('ALLOWS enabling white-label at Coalition tier', () => {
		expect(whiteLabelWriteAllowed('coalition', true)).toBe(true);
	});
	it('ALLOWS disabling white-label at ANY tier (re-attach Commons branding)', () => {
		expect(whiteLabelWriteAllowed('free', false)).toBe(true);
		expect(whiteLabelWriteAllowed('organization', false)).toBe(true);
		expect(whiteLabelWriteAllowed('coalition', false)).toBe(true);
	});
});
