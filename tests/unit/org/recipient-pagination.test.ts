/**
 * Blast/SMS recipient resolution paginates the supporter roster — never an
 * unbounded `.collect()`.
 *
 * The send path previously `.collect()`ed every supporter to filter-then-send,
 * which throws past the per-read ~16K document cap once an org's roster is
 * large (and the older `getBlastRecipients` `.take(10000)` silently DROPPED
 * recipients past the ceiling with no signal). These exercise the shared
 * helpers against a fake `ctx.db` whose `.collect()` THROWS and whose
 * `.paginate()` honors the cursor — so they pin both the behavior (every
 * matching recipient is enumerated across page boundaries, none dropped) and
 * the source invariant (no scalable collection is `.collect()`ed).
 *
 * The no-filter path is used so `applyEmailRecipientFilter` makes no DB calls
 * (it only filters `emailStatus === 'subscribed'` in memory), isolating the
 * pagination machinery under test.
 */

import { describe, it, expect } from 'vitest';
import {
	pageFilteredRecipients,
	collectFilteredRecipients,
	countFilteredRecipients,
	RECIPIENT_COHORT_CAP
} from '../../../convex/_emailRecipientFilter';

type Supporter = {
	_id: string;
	orgId: string;
	emailStatus: string;
	emailHash: string;
	source?: string;
};

const ORG = 'org_1' as unknown as Parameters<typeof collectFilteredRecipients>[1];

/**
 * Fake of the Convex query chain backing `.paginate()`. Pages the supplied row
 * set by an opaque numeric cursor (the absolute index of the next row). Throws
 * if `.collect()` is reached, so any unbounded scan fails the test loudly.
 */
function fakeCtx(rows: Supporter[], pageSize: number) {
	let collectCalled = false;
	return {
		get collectCalled() {
			return collectCalled;
		},
		ctx: {
			db: {
				query(_table: string) {
					return {
						withIndex(_name: string, fn: (q: unknown) => unknown) {
							const q = {
								eq() {
									return q;
								}
							};
							fn(q);
							const builder = {
								order() {
									return builder;
								},
								async paginate({
									cursor,
									numItems
								}: {
									cursor: string | null;
									numItems: number;
								}) {
									// Cursor is the absolute start index encoded as a string.
									const start = cursor ? Number(cursor) : 0;
									const end = start + numItems;
									const page = rows.slice(start, end);
									const isDone = end >= rows.length;
									return {
										page,
										isDone,
										continueCursor: isDone ? null : String(end)
									};
								},
								async collect() {
									collectCalled = true;
									throw new Error('recipient resolution must not .collect() the supporter roster');
								},
								async take() {
									throw new Error('recipient resolution must paginate, not take()');
								}
							};
							// The fake's page size is fixed by the helper's internal
							// RECIPIENT_SCAN_PAGE; numItems is honored above regardless.
							void pageSize;
							return builder;
						}
					};
				}
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
			} as any
		}
	};
}

function makeRoster(total: number, subscribedEvery = 1): Supporter[] {
	return Array.from({ length: total }, (_, i) => ({
		_id: `s${String(i).padStart(6, '0')}`,
		orgId: 'org_1',
		emailStatus: i % subscribedEvery === 0 ? 'subscribed' : 'unsubscribed',
		emailHash: `${'a'.repeat(63)}${(i % 16).toString(16)}`,
		source: i % 3 === 0 ? 'csv' : 'widget'
	}));
}

describe('collectFilteredRecipients (bounded must-enumerate scan)', () => {
	it('enumerates EVERY subscribed recipient across many page boundaries — none dropped', async () => {
		// 3500 supporters, all subscribed; helper page size is 1000, so this
		// crosses 4 page boundaries. A correct cursor walk returns all 3500.
		const roster = makeRoster(3500);
		const { ctx, collectCalled } = fakeCtx(roster, 1000);
		const { recipients, truncated } = await collectFilteredRecipients(ctx, ORG, {});
		expect(collectCalled).toBe(false);
		expect(recipients).toHaveLength(3500);
		expect(truncated).toBe(false);
		// No duplicates, no skips: the returned id set equals the input id set.
		expect(new Set(recipients.map((r) => r._id)).size).toBe(3500);
		expect(recipients[0]._id).toBe('s000000');
		expect(recipients[3499]._id).toBe('s003499');
	});

	it('only counts subscribed rows — unsubscribed are filtered per page', async () => {
		// Every 2nd supporter subscribed → 1250 of 2500.
		const roster = makeRoster(2500, 2);
		const { ctx } = fakeCtx(roster, 1000);
		const { recipients } = await collectFilteredRecipients(ctx, ORG, {});
		expect(recipients).toHaveLength(1250);
		expect(recipients.every((r) => r.emailStatus === 'subscribed')).toBe(true);
	});

	it('truncates at the cohort cap and flags a floor (no silent drop without signal)', async () => {
		const roster = makeRoster(RECIPIENT_COHORT_CAP + 250);
		const { ctx } = fakeCtx(roster, 1000);
		const { recipients, truncated } = await collectFilteredRecipients(ctx, ORG, {});
		expect(truncated).toBe(true);
		expect(recipients).toHaveLength(RECIPIENT_COHORT_CAP);
	});

	it('an empty roster yields no recipients and is not truncated', async () => {
		const { ctx } = fakeCtx([], 1000);
		const { recipients, truncated } = await collectFilteredRecipients(ctx, ORG, {});
		expect(recipients).toHaveLength(0);
		expect(truncated).toBe(false);
	});
});

describe('pageFilteredRecipients (resumable send-batch page)', () => {
	it('the send loop walks the full cohort page-by-page — concatenation drops nothing', async () => {
		// This is the exact send-batch contract: scan page = 100 supporters,
		// resume from continueCursor each batch, finalize on isDone. 2350
		// supporters at 100/page → 24 batches; every one must be seen once, in
		// order, with NO gap (the bug a mid-page match cap would introduce — the
		// cursor would jump past unconsumed supporters and skip them).
		const roster = makeRoster(2350);
		const { ctx } = fakeCtx(roster, 1000);
		const seen: string[] = [];
		let cursor: string | null = null;
		let guard = 0;
		for (;;) {
			if (guard++ > 10000) throw new Error('pagination did not terminate');
			const { recipients, continueCursor, isDone }: Awaited<
				ReturnType<typeof pageFilteredRecipients>
			> = await pageFilteredRecipients(ctx, ORG, {}, cursor, 100);
			for (const r of recipients) seen.push(r._id);
			if (isDone || continueCursor === null) break;
			cursor = continueCursor;
		}
		expect(seen).toHaveLength(2350);
		expect(new Set(seen).size).toBe(2350);
		expect(seen[0]).toBe('s000000');
		expect(seen[2349]).toBe('s002349');
	});

	it('one page scans at most scanPageSize supporters (matches are a subset)', async () => {
		const roster = makeRoster(500);
		const { ctx } = fakeCtx(roster, 1000);
		const { recipients } = await pageFilteredRecipients(ctx, ORG, {}, null, 100);
		// All 100 scanned supporters are subscribed in this roster.
		expect(recipients).toHaveLength(100);
		expect(recipients.length).toBeLessThanOrEqual(100);
	});

	it('a sparse page (mostly filtered out) yields few matches but still advances the cursor', async () => {
		// 1 in 50 subscribed → scanning 100 supporters yields ~2 matches and is
		// NOT done; the send loop must keep going on the cursor (not finalize on
		// the small/zero match count).
		const roster = makeRoster(5000, 50);
		const { ctx } = fakeCtx(roster, 1000);
		const { recipients, isDone, continueCursor } = await pageFilteredRecipients(
			ctx,
			ORG,
			{},
			null,
			100
		);
		expect(recipients.length).toBeLessThan(100);
		expect(recipients.every((r) => r.emailStatus === 'subscribed')).toBe(true);
		expect(isDone).toBe(false);
		expect(continueCursor).not.toBeNull();
	});

	it('the send loop drops nothing even when most pages match zero (sparse cohort)', async () => {
		// 1 in 50 subscribed across 5000 → 100 recipients. Walking 100/page, many
		// pages match 0 but the loop continues on the cursor until isDone.
		const roster = makeRoster(5000, 50);
		const { ctx } = fakeCtx(roster, 1000);
		const seen: string[] = [];
		let cursor: string | null = null;
		let guard = 0;
		for (;;) {
			if (guard++ > 10000) throw new Error('pagination did not terminate');
			const { recipients, continueCursor, isDone }: Awaited<
				ReturnType<typeof pageFilteredRecipients>
			> = await pageFilteredRecipients(ctx, ORG, {}, cursor, 100);
			for (const r of recipients) seen.push(r._id);
			if (isDone || continueCursor === null) break;
			cursor = continueCursor;
		}
		expect(seen).toHaveLength(100);
		expect(new Set(seen).size).toBe(100);
	});
});

describe('countFilteredRecipients (bounded count + source breakdown)', () => {
	it('counts the full subscribed cohort across page boundaries (matches collect)', async () => {
		const roster = makeRoster(3500);
		const { ctx, collectCalled } = fakeCtx(roster, 1000);
		const { totalCount, truncated } = await countFilteredRecipients(ctx, ORG, {});
		expect(collectCalled).toBe(false);
		expect(totalCount).toBe(3500);
		expect(truncated).toBe(false);
	});

	it('source breakdown sums to the total (subscribed only)', async () => {
		const roster = makeRoster(2400); // every 3rd source=csv, rest widget
		const { ctx } = fakeCtx(roster, 1000);
		const { totalCount, sourceCounts } = await countFilteredRecipients(ctx, ORG, {});
		const sum = Object.values(sourceCounts).reduce((a, b) => a + b, 0);
		expect(sum).toBe(totalCount);
		expect(sourceCounts.csv).toBe(800);
		expect(sourceCounts.widget).toBe(1600);
	});

	it('count saturates at the cap and flags truncated (a floor)', async () => {
		const roster = makeRoster(RECIPIENT_COHORT_CAP + 100);
		const { ctx } = fakeCtx(roster, 1000);
		const { totalCount, truncated } = await countFilteredRecipients(ctx, ORG, {});
		expect(totalCount).toBe(RECIPIENT_COHORT_CAP);
		expect(truncated).toBe(true);
	});
});
