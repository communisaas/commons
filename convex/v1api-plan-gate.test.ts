/// <reference types="vite/client" />
/**
 * Plan-status gate for v1 API key auth (`authenticateApiKey.planSlug`).
 *
 * Two layers:
 *
 *  1. Behavior — exercised against the REAL `effectivePlanWithGrace` from
 *     `./_brandingGate`, the single grace-bearing plan resolver: canceled
 *     floors to 'inactive', past_due keeps the plan inside the 7-day runway
 *     and floors after it, active/trialing keep the plan, and a missing row
 *     never fabricates one.
 *
 *  2. Source — reads the real `convex/v1api.ts` text (not a fixture) and
 *     asserts planSlug is routed through that helper, and that the raw
 *     `sub?.plan ?? 'inactive'` (which surfaced a stale plan on canceled
 *     rows) is gone. The subscriptions read stays unfiltered by status:
 *     canceled rows are READ, then floored by the helper — never skipped.
 *
 * The source text arrives via Vite's `?raw` static import (typed by the
 * vite/client reference above) — no fs access and no dynamic import, so the
 * file stays clean under both `tsc -p convex` (no @types/node there) and the
 * convex-dir no-dynamic-imports invariant.
 */

import { describe, it, expect } from 'vitest';
import { effectivePlanWithGrace } from './_brandingGate';
import v1apiSource from './v1api.ts?raw';

const DAY = 24 * 60 * 60 * 1000;
// Fixed reference clock — the grace window is arithmetic on `now`, so the
// assertions are deterministic regardless of wall time.
const NOW = 1_750_000_000_000;

describe('v1 API plan-status gate — real effectivePlanWithGrace', () => {
	it('canceled subscription floors to inactive (stale plan never surfaces)', () => {
		expect(effectivePlanWithGrace({ status: 'canceled', plan: 'coalition' }, NOW)).toBe(
			'inactive'
		);
	});

	it('past_due inside the 7-day grace keeps the plan', () => {
		expect(
			effectivePlanWithGrace(
				{ status: 'past_due', plan: 'organization', pastDueSince: NOW - 1 * DAY },
				NOW
			)
		).toBe('organization');
	});

	it('past_due beyond the 7-day grace floors to inactive', () => {
		expect(
			effectivePlanWithGrace(
				{ status: 'past_due', plan: 'organization', pastDueSince: NOW - 8 * DAY },
				NOW
			)
		).toBe('inactive');
	});

	it('active and trialing keep the plan', () => {
		expect(effectivePlanWithGrace({ status: 'active', plan: 'starter' }, NOW)).toBe('starter');
		expect(effectivePlanWithGrace({ status: 'trialing', plan: 'coalition' }, NOW)).toBe(
			'coalition'
		);
	});

	it('absent subscription resolves to inactive — a plan is never fabricated', () => {
		expect(effectivePlanWithGrace(null, NOW)).toBe('inactive');
		expect(effectivePlanWithGrace(undefined, NOW)).toBe('inactive');
	});
});

describe('v1api.ts source — planSlug routes through the shared gate', () => {
	const source = v1apiSource;

	it('imports the helper from _brandingGate and calls it with (sub, Date.now())', () => {
		expect(source).toContain("import { effectivePlanWithGrace } from './_brandingGate';");
		expect(source).toContain('effectivePlanWithGrace(sub, Date.now())');
	});

	it('no longer resolves planSlug from the raw subscription row', () => {
		expect(source).not.toContain("sub?.plan ?? 'inactive'");
	});

	it('keeps the subscriptions read unfiltered (canceled rows read, then floored)', () => {
		// The by_orgId read must stay a plain `.first()` with no status filter —
		// the floor is applied by the helper, not by skipping rows at the query.
		expect(source).toMatch(
			/query\('subscriptions'\)\s*\.withIndex\('by_orgId', \(q\) => q\.eq\('orgId', org\._id\)\)\s*\.first\(\)/
		);
	});
});
