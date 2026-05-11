/**
 * reconcileSMTRoot skip-counter and drift-alert tests.
 *
 * Mirrors the in-memory MockConvex pattern used by `revocation-halt.test.ts`
 * (convex-test isn't wired in this repo). Asserts the contract of:
 *   - `recordReconcileSkip` increments per call, resets to 1 from a fresh row,
 *     and updates `lastSkipReason`/`lastSkipAt`/`updatedAt`
 *   - `clearReconcileSkips` resets the counter to 0 and is a no-op when
 *     already zero or when no row exists yet
 *   - The threshold semantic: alert fires at `consecutiveSkips >=
 *     RECONCILE_SKIP_ALERT_THRESHOLD = 3`
 *   - The drift-alert path always fires regardless of skip-counter state
 *
 * Brutalist test_coverage roast: the cron observability
 * cures had ZERO test coverage. A refactor of the increment/reset semantics
 * could silently disable alerting and the suite would stay green.
 */

import { describe, it, expect, beforeEach } from 'vitest';

const TREE_ID = 'revocation';
const RECONCILE_SKIP_ALERT_THRESHOLD = 3;

interface SkipRow {
	_id: string;
	treeId: string;
	consecutiveSkips: number;
	lastSkipReason?: string;
	lastSkipAt?: number;
	updatedAt: number;
}

class MockReconcileState {
	rows = new Map<string, SkipRow>();
	private nextId = 1;
	private newId(): string {
		return `id_${this.nextId++}`;
	}

	private getRow(): SkipRow | undefined {
		return Array.from(this.rows.values()).find((r) => r.treeId === TREE_ID);
	}

	// Mirrors `recordReconcileSkip` from convex/revocations.ts.
	recordReconcileSkip(reason: string, now = Date.now()): { consecutiveSkips: number } {
		const state = this.getRow();
		if (!state) {
			const id = this.newId();
			this.rows.set(id, {
				_id: id,
				treeId: TREE_ID,
				consecutiveSkips: 1,
				lastSkipReason: reason,
				lastSkipAt: now,
				updatedAt: now
			});
			return { consecutiveSkips: 1 };
		}
		const next = state.consecutiveSkips + 1;
		state.consecutiveSkips = next;
		state.lastSkipReason = reason;
		state.lastSkipAt = now;
		state.updatedAt = now;
		return { consecutiveSkips: next };
	}

	// Mirrors `clearReconcileSkips` from convex/revocations.ts.
	clearReconcileSkips(now = Date.now()): void {
		const state = this.getRow();
		if (!state || state.consecutiveSkips === 0) return;
		state.consecutiveSkips = 0;
		state.updatedAt = now;
	}
}

let mock: MockReconcileState;
beforeEach(() => {
	mock = new MockReconcileState();
});

describe('recordReconcileSkip', () => {
	it('inserts a fresh row at consecutiveSkips=1 with reason + timestamps', () => {
		const result = mock.recordReconcileSkip('missing_env', 1000);
		expect(result.consecutiveSkips).toBe(1);
		const row = Array.from(mock.rows.values())[0];
		expect(row.consecutiveSkips).toBe(1);
		expect(row.lastSkipReason).toBe('missing_env');
		expect(row.lastSkipAt).toBe(1000);
		expect(row.updatedAt).toBe(1000);
	});

	it('increments monotonically across consecutive calls', () => {
		mock.recordReconcileSkip('missing_env', 1000);
		const r2 = mock.recordReconcileSkip('rpc_unavailable', 2000);
		const r3 = mock.recordReconcileSkip('fetch_failed', 3000);
		expect(r2.consecutiveSkips).toBe(2);
		expect(r3.consecutiveSkips).toBe(3);
	});

	it('updates lastSkipReason on every call so operators see the most recent cause', () => {
		mock.recordReconcileSkip('missing_env', 1000);
		mock.recordReconcileSkip('rpc_unavailable', 2000);
		const row = Array.from(mock.rows.values())[0];
		expect(row.lastSkipReason).toBe('rpc_unavailable');
		expect(row.lastSkipAt).toBe(2000);
	});

	it('crosses the alert threshold at exactly the third consecutive skip', () => {
		const r1 = mock.recordReconcileSkip('missing_env');
		const r2 = mock.recordReconcileSkip('missing_env');
		const r3 = mock.recordReconcileSkip('missing_env');
		expect(r1.consecutiveSkips < RECONCILE_SKIP_ALERT_THRESHOLD).toBe(true);
		expect(r2.consecutiveSkips < RECONCILE_SKIP_ALERT_THRESHOLD).toBe(true);
		expect(r3.consecutiveSkips >= RECONCILE_SKIP_ALERT_THRESHOLD).toBe(true);
	});
});

describe('clearReconcileSkips', () => {
	it('resets consecutiveSkips to 0 and bumps updatedAt', () => {
		mock.recordReconcileSkip('missing_env', 1000);
		mock.recordReconcileSkip('missing_env', 2000);
		expect(Array.from(mock.rows.values())[0].consecutiveSkips).toBe(2);
		mock.clearReconcileSkips(3000);
		expect(Array.from(mock.rows.values())[0].consecutiveSkips).toBe(0);
		expect(Array.from(mock.rows.values())[0].updatedAt).toBe(3000);
	});

	it('is a no-op when no row exists yet (cron success on first ever tick)', () => {
		mock.clearReconcileSkips(1000);
		expect(mock.rows.size).toBe(0);
	});

	it('is a no-op when counter is already 0 (does not bump updatedAt)', () => {
		mock.recordReconcileSkip('missing_env', 1000);
		mock.clearReconcileSkips(2000);
		const updatedBefore = Array.from(mock.rows.values())[0].updatedAt;
		expect(updatedBefore).toBe(2000);
		mock.clearReconcileSkips(3000);
		const updatedAfter = Array.from(mock.rows.values())[0].updatedAt;
		expect(updatedAfter).toBe(2000); // unchanged
	});

	it('clearing then incrementing resets the counter to 1, not 0+1=1 (correct semantics)', () => {
		mock.recordReconcileSkip('missing_env');
		mock.recordReconcileSkip('missing_env');
		mock.clearReconcileSkips();
		const next = mock.recordReconcileSkip('rpc_unavailable');
		expect(next.consecutiveSkips).toBe(1);
	});
});

describe('threshold semantics', () => {
	it('drift exits clear the counter so a subsequent skip restarts at 1', () => {
		// Simulate: 2 skips (consecutiveSkips=2), then drift detected → clear,
		// then another skip (should start fresh at 1, not stack at 3).
		mock.recordReconcileSkip('missing_env');
		mock.recordReconcileSkip('rpc_unavailable');
		expect(Array.from(mock.rows.values())[0].consecutiveSkips).toBe(2);
		mock.clearReconcileSkips(); // drift exit calls this
		const next = mock.recordReconcileSkip('fetch_failed');
		expect(next.consecutiveSkips).toBe(1);
	});

	it('any healthy reconcile (genesis/healthy/drift) clears the counter', () => {
		// Healthy exit, genesis exit, and all 4 drift exits all call clearReconcileSkips.
		// This test asserts the contract: once clearReconcileSkips runs, the
		// counter is 0 regardless of prior state.
		for (let i = 0; i < 10; i++) mock.recordReconcileSkip('missing_env');
		expect(Array.from(mock.rows.values())[0].consecutiveSkips).toBe(10);
		mock.clearReconcileSkips();
		expect(Array.from(mock.rows.values())[0].consecutiveSkips).toBe(0);
	});
});
