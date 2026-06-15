/**
 * L1 individual AI-authoring cap (3 / calendar month).
 *
 * "Individuals free forever" is refined to: free forever to ACT (send, sign,
 * personalize-and-deliver existing messages), bounded on AI GENERATION. The
 * expensive person-layer path is authoring a NEW template (subject + grounded
 * decision-maker resolution + grounded message, ~$0.12–0.22 each), so an
 * un-orged individual may AI-author up to 3 templates per calendar month.
 *
 * The cap is enforced in `convex/templates.ts:createTemplate` (the individual
 * create fence), in the `else` (no-org) branch — org members are governed by
 * their plan's `maxTemplatesMonth`. It counts the user's own templates created
 * month-to-date via the `templates.by_userId` index (query-time aggregation
 * from `_creationTime`, NOT a denormalized counter), then delegates the
 * allow/deny decision to the pure helper pinned here.
 *
 * ACTING on / SENDING an existing template never touches `createTemplate`
 * (campaign-action / submit paths), so it is intentionally never gated by this
 * cap — there is no `createTemplate` call to reach the cap on the action path.
 */

import { describe, it, expect } from 'vitest';
import {
	FREE_INDIVIDUAL_TEMPLATES_PER_MONTH,
	startOfMonthUTC,
	nextMonthResetDate,
	decideIndividualAuthoring
} from '../../../convex/_individualAuthoringCap';

const JAN_15 = Date.UTC(2026, 0, 15, 12, 0, 0); // mid-January 2026
const DEC_20 = Date.UTC(2026, 11, 20, 12, 0, 0); // mid-December (year-rollover case)

describe('FREE_INDIVIDUAL_TEMPLATES_PER_MONTH', () => {
	it('is 3', () => {
		expect(FREE_INDIVIDUAL_TEMPLATES_PER_MONTH).toBe(3);
	});
});

describe('startOfMonthUTC', () => {
	it('floors to the first instant of the calendar month (UTC)', () => {
		expect(startOfMonthUTC(JAN_15)).toBe(Date.UTC(2026, 0, 1));
		expect(startOfMonthUTC(DEC_20)).toBe(Date.UTC(2026, 11, 1));
	});
});

describe('nextMonthResetDate', () => {
	it('returns the first day of next month as an ISO date', () => {
		expect(nextMonthResetDate(JAN_15)).toBe('2026-02-01');
	});
	it('rolls the year over from December', () => {
		expect(nextMonthResetDate(DEC_20)).toBe('2027-01-01');
	});
});

describe('decideIndividualAuthoring', () => {
	it('ALLOWS the 1st, 2nd, and 3rd template in a month', () => {
		expect(decideIndividualAuthoring(0, JAN_15).ok).toBe(true);
		expect(decideIndividualAuthoring(1, JAN_15).ok).toBe(true);
		expect(decideIndividualAuthoring(2, JAN_15).ok).toBe(true);
	});

	it('BLOCKS the 4th creation in the same month (3 already authored)', () => {
		const d = decideIndividualAuthoring(3, JAN_15);
		expect(d.ok).toBe(false);
		if (!d.ok) {
			expect(d.message).toContain('3 free messages this month');
			expect(d.message).toContain('resets 2026-02-01');
			expect(d.message).toContain('Higher-volume individual authoring is coming');
		}
	});

	it('stays blocked beyond the cap', () => {
		expect(decideIndividualAuthoring(4, JAN_15).ok).toBe(false);
		expect(decideIndividualAuthoring(99, JAN_15).ok).toBe(false);
	});
});
