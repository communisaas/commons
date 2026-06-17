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
	effectivelyActive,
	effectivePlanWithGrace,
	isCoalitionPlan,
	isValidAccentHex,
	decideAccentWrite,
	logoWriteAllowed,
	whiteLabelWriteAllowed
} from '../../../convex/_brandingGate';

const GRACE = 7 * 24 * 60 * 60 * 1000;

describe('effectivePlan', () => {
	it('treats active/trialing subscriptions as their paid plan', () => {
		expect(effectivePlan({ status: 'active', plan: 'coalition' })).toBe('coalition');
		expect(effectivePlan({ status: 'trialing', plan: 'coalition' })).toBe('coalition');
		expect(effectivePlan({ status: 'active', plan: 'organization' })).toBe('organization');
	});

	it('treats canceled/past_due/missing as the gated inactive floor', () => {
		expect(effectivePlan({ status: 'canceled', plan: 'coalition' })).toBe('inactive');
		expect(effectivePlan({ status: 'past_due', plan: 'coalition' })).toBe('inactive');
		expect(effectivePlan(null)).toBe('inactive');
		expect(effectivePlan(undefined)).toBe('inactive');
		expect(effectivePlan({ status: 'active' })).toBe('inactive');
	});
});

describe('isCoalitionPlan', () => {
	it('is true only for coalition', () => {
		expect(isCoalitionPlan('coalition')).toBe(true);
		expect(isCoalitionPlan('organization')).toBe(false);
		expect(isCoalitionPlan('starter')).toBe(false);
		expect(isCoalitionPlan('inactive')).toBe(false);
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
	it('REJECTS a non-empty accent below Coalition tier (inactive floor)', () => {
		const d = decideAccentWrite('inactive', '#0d9488');
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
		for (const plan of ['inactive', 'organization', 'coalition']) {
			expect(decideAccentWrite(plan, '')).toEqual({ ok: true, cleared: true });
			expect(decideAccentWrite(plan, null)).toEqual({ ok: true, cleared: true });
			expect(decideAccentWrite(plan, undefined)).toEqual({ ok: true, cleared: true });
		}
	});
});

describe('logoWriteAllowed — Coalition gate', () => {
	it('REJECTS setting a logo below Coalition tier', () => {
		expect(logoWriteAllowed('inactive', false)).toBe(false);
		expect(logoWriteAllowed('organization', false)).toBe(false);
	});
	it('ALLOWS setting a logo at Coalition tier', () => {
		expect(logoWriteAllowed('coalition', false)).toBe(true);
	});
	it('ALLOWS clearing a logo at ANY tier', () => {
		expect(logoWriteAllowed('inactive', true)).toBe(true);
		expect(logoWriteAllowed('organization', true)).toBe(true);
		expect(logoWriteAllowed('coalition', true)).toBe(true);
	});
});

describe('whiteLabelWriteAllowed — Coalition gate', () => {
	it('REJECTS enabling white-label below Coalition tier', () => {
		expect(whiteLabelWriteAllowed('inactive', true)).toBe(false);
		expect(whiteLabelWriteAllowed('organization', true)).toBe(false);
	});
	it('ALLOWS enabling white-label at Coalition tier', () => {
		expect(whiteLabelWriteAllowed('coalition', true)).toBe(true);
	});
	it('ALLOWS disabling white-label at ANY tier (re-attach Commons branding)', () => {
		expect(whiteLabelWriteAllowed('inactive', false)).toBe(true);
		expect(whiteLabelWriteAllowed('organization', false)).toBe(true);
		expect(whiteLabelWriteAllowed('coalition', false)).toBe(true);
	});
});

describe('effectivelyActive — single grace-bearing predicate', () => {
	const NOW = 1_000_000_000_000;

	it('active / trialing confer access regardless of pastDueSince', () => {
		expect(effectivelyActive({ status: 'active', plan: 'coalition' }, NOW)).toBe(true);
		expect(effectivelyActive({ status: 'trialing', plan: 'starter' }, NOW)).toBe(true);
	});

	it('canceled / none / null / undefined do NOT confer access', () => {
		expect(effectivelyActive({ status: 'canceled', plan: 'coalition' }, NOW)).toBe(false);
		expect(effectivelyActive(null, NOW)).toBe(false);
		expect(effectivelyActive(undefined, NOW)).toBe(false);
		expect(effectivelyActive({}, NOW)).toBe(false);
	});

	it('past_due grace boundary is a strict 7-day window', () => {
		const within = { status: 'past_due', plan: 'coalition', pastDueSince: NOW - (GRACE - 1) };
		const exact = { status: 'past_due', plan: 'coalition', pastDueSince: NOW - GRACE };
		const expired = { status: 'past_due', plan: 'coalition', pastDueSince: NOW - (GRACE + 1) };
		expect(effectivelyActive(within, NOW)).toBe(true);
		expect(effectivelyActive(exact, NOW)).toBe(false); // strict <
		expect(effectivelyActive(expired, NOW)).toBe(false);
	});

	it('past_due with undefined pastDueSince does NOT silently grant grace', () => {
		expect(effectivelyActive({ status: 'past_due', plan: 'coalition' }, NOW)).toBe(false);
	});

	it('a FUTURE pastDueSince does NOT grant indefinite grace — the clock runs forward', () => {
		// Anomalous data: pastDueSince after `now`. Without the >= guard, now - future
		// is negative (< GRACE) → grace forever.
		const future = { status: 'past_due', plan: 'coalition', pastDueSince: NOW + GRACE };
		expect(effectivelyActive(future, NOW)).toBe(false);
	});

	it('pastDueSince=0 is a real timestamp, not a falsy "no grace" sentinel', () => {
		// At epoch the window is open; far in the future it is closed. This pins the
		// harmonization of the previously-divergent truthy vs strict-undefined guards.
		expect(effectivelyActive({ status: 'past_due', plan: 'coalition', pastDueSince: 0 }, 0)).toBe(
			true
		);
		expect(
			effectivelyActive({ status: 'past_due', plan: 'coalition', pastDueSince: 0 }, GRACE + 1)
		).toBe(false);
	});
});

describe('branding vs billing grace asymmetry (documented, pinned)', () => {
	const NOW = 1_000_000_000_000;
	const pastDueInGrace = {
		status: 'past_due',
		plan: 'coalition',
		pastDueSince: NOW - (GRACE - 1)
	};

	it('billing keeps the plan during grace; branding retracts it', () => {
		// Billing path (grace-bearing) → still Coalition.
		expect(effectivePlanWithGrace(pastDueInGrace, NOW)).toBe('coalition');
		// Branding path (no grace) → inactive the instant payment lapses.
		expect(effectivePlan(pastDueInGrace)).toBe('inactive');
	});
});
