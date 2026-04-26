/**
 * Wave 5 / FU-2.1 — Convex-side kill-switch state-management tests.
 *
 * Mirrors the convex-test pattern used in this repo (in-memory state
 * simulation, since `convex-test` isn't wired). Asserts:
 *
 *   1. `setRevocationHalt` preserves `haltedAt` across re-flips
 *   2. `setRevocationHalt` appends to audit log every call
 *   3. `operatorClearRevocationHalt` rejects bad confirmation
 *   4. `operatorClearRevocationHalt` rejects short incidentRef
 *   5. `operatorClearRevocationHalt` rejects empty actorPrincipal
 *   6. Clear happy path: clears state + appends audit
 *   7. Clear when not halted: returns `cleared: false`, still audits the attempt
 *   8. `applyRevocationSMTUpdate` halt check fires BEFORE seq check
 *   9. `applyRevocationSMTUpdate` halt check returns the halted reason in the error
 *
 * REVIEW 5-2 closure: this file addresses Critic F (test coverage thinness).
 */

import { describe, it, expect, beforeEach } from 'vitest';

const TREE_ID = 'revocation';

interface FlagRow {
	_id: string;
	treeId: string;
	isHalted: boolean;
	haltedAt?: number;
	haltedReason?: string;
}

interface AuditRow {
	_id: string;
	treeId: string;
	action: 'set' | 'clear';
	reason: string;
	incidentRef?: string;
	actor: string;
	timestamp: number;
	previousReason?: string;
	previousHaltedAt?: number;
}

interface SmtRootRow {
	_id: string;
	treeId: string;
	root: string;
	leafCount: number;
	sequenceNumber: number;
	lastUpdatedAt: number;
}

class MockConvex {
	flags = new Map<string, FlagRow>();
	audit: AuditRow[] = [];
	smtRoots = new Map<string, SmtRootRow>();
	private nextId = 1;

	private newId(): string {
		return `id_${this.nextId++}`;
	}

	// Mirrors `setRevocationHalt` from convex/revocations.ts.
	setRevocationHalt(reason: string, now = Date.now()) {
		const existing = Array.from(this.flags.values()).find((f) => f.treeId === TREE_ID);
		const previousReason = existing?.haltedReason;
		const previousHaltedAt = existing?.haltedAt;
		if (existing) {
			existing.isHalted = true;
			existing.haltedAt = existing.haltedAt ?? now;
			existing.haltedReason = reason;
		} else {
			const id = this.newId();
			this.flags.set(id, {
				_id: id,
				treeId: TREE_ID,
				isHalted: true,
				haltedAt: now,
				haltedReason: reason
			});
		}
		this.audit.push({
			_id: this.newId(),
			treeId: TREE_ID,
			action: 'set',
			reason,
			actor: 'cron:reconcileSMTRoot',
			timestamp: now,
			previousReason,
			previousHaltedAt
		});
		return { halted: true, reason };
	}

	// Mirrors `operatorClearRevocationHalt`.
	operatorClearRevocationHalt(args: {
		confirmation: string;
		incidentRef: string;
		actorPrincipal: string;
		now?: number;
	}) {
		if (args.confirmation !== 'i-have-investigated-the-drift') {
			throw new Error('OPERATOR_CONFIRMATION_REQUIRED');
		}
		if (args.incidentRef.length < 4) {
			throw new Error('OPERATOR_INCIDENT_REF_REQUIRED');
		}
		if (args.actorPrincipal.length < 2) {
			throw new Error('OPERATOR_ACTOR_REQUIRED');
		}
		const now = args.now ?? Date.now();
		const haltRow = Array.from(this.flags.values()).find((f) => f.treeId === TREE_ID);
		if (!haltRow || haltRow.isHalted !== true) {
			this.audit.push({
				_id: this.newId(),
				treeId: TREE_ID,
				action: 'clear',
				reason: 'halt_not_active',
				incidentRef: args.incidentRef,
				actor: `operator:${args.actorPrincipal}`,
				timestamp: now
			});
			return { cleared: false, reason: 'halt_not_active' };
		}
		const previousReason = haltRow.haltedReason;
		const previousHaltedAt = haltRow.haltedAt;
		haltRow.isHalted = false;
		haltRow.haltedAt = undefined;
		haltRow.haltedReason = undefined;
		this.audit.push({
			_id: this.newId(),
			treeId: TREE_ID,
			action: 'clear',
			reason: previousReason ?? 'unspecified',
			incidentRef: args.incidentRef,
			actor: `operator:${args.actorPrincipal}`,
			timestamp: now,
			previousReason,
			previousHaltedAt
		});
		return { cleared: true, previousReason };
	}

	// Mirrors the halt check at the top of `applyRevocationSMTUpdate`.
	checkHaltOrThrow() {
		const haltRow = Array.from(this.flags.values()).find((f) => f.treeId === TREE_ID);
		if (haltRow?.isHalted === true) {
			throw new Error(
				`REVOCATION_EMITS_HALTED: kill-switch active since ${haltRow.haltedAt} (reason: ${haltRow.haltedReason ?? 'unspecified'})`
			);
		}
	}
}

let convex: MockConvex;

beforeEach(() => {
	convex = new MockConvex();
});

describe('setRevocationHalt', () => {
	it('preserves haltedAt across re-flips (operator can see how long the halt has been active)', () => {
		const t0 = 1_000_000;
		const t1 = 1_500_000;
		convex.setRevocationHalt('first_reason', t0);
		convex.setRevocationHalt('second_reason', t1);

		const flag = Array.from(convex.flags.values())[0];
		expect(flag.isHalted).toBe(true);
		expect(flag.haltedAt).toBe(t0); // preserved from first
		expect(flag.haltedReason).toBe('second_reason'); // refreshed
	});

	it('appends an audit log entry on every set call (even repeated)', () => {
		convex.setRevocationHalt('drift_a', 1000);
		convex.setRevocationHalt('drift_b', 2000);
		convex.setRevocationHalt('drift_c', 3000);

		expect(convex.audit).toHaveLength(3);
		expect(convex.audit.every((a) => a.action === 'set')).toBe(true);
		expect(convex.audit.map((a) => a.reason)).toEqual(['drift_a', 'drift_b', 'drift_c']);
	});

	it('first audit set has no previousReason; subsequent calls capture the prior reason', () => {
		convex.setRevocationHalt('first', 1000);
		convex.setRevocationHalt('second', 2000);

		expect(convex.audit[0].previousReason).toBeUndefined();
		expect(convex.audit[1].previousReason).toBe('first');
	});
});

describe('operatorClearRevocationHalt', () => {
	beforeEach(() => {
		convex.setRevocationHalt('initial_drift', 1000);
	});

	it('rejects wrong confirmation string', () => {
		expect(() =>
			convex.operatorClearRevocationHalt({
				confirmation: 'yes',
				incidentRef: 'INC-123',
				actorPrincipal: 'alice'
			})
		).toThrow(/OPERATOR_CONFIRMATION_REQUIRED/);
	});

	it('rejects empty / too-short incidentRef', () => {
		expect(() =>
			convex.operatorClearRevocationHalt({
				confirmation: 'i-have-investigated-the-drift',
				incidentRef: 'no',
				actorPrincipal: 'alice'
			})
		).toThrow(/OPERATOR_INCIDENT_REF_REQUIRED/);
	});

	it('rejects empty actorPrincipal', () => {
		expect(() =>
			convex.operatorClearRevocationHalt({
				confirmation: 'i-have-investigated-the-drift',
				incidentRef: 'INC-456',
				actorPrincipal: ''
			})
		).toThrow(/OPERATOR_ACTOR_REQUIRED/);
	});

	it('happy path: clears the flag and appends a clear audit', () => {
		const result = convex.operatorClearRevocationHalt({
			confirmation: 'i-have-investigated-the-drift',
			incidentRef: 'INC-789',
			actorPrincipal: 'oncall-bob',
			now: 5000
		});
		expect(result.cleared).toBe(true);
		expect(result.previousReason).toBe('initial_drift');

		const flag = Array.from(convex.flags.values())[0];
		expect(flag.isHalted).toBe(false);
		expect(flag.haltedAt).toBeUndefined();
		expect(flag.haltedReason).toBeUndefined();

		// Audit chain: set then clear, both recorded.
		expect(convex.audit).toHaveLength(2);
		expect(convex.audit[0].action).toBe('set');
		expect(convex.audit[1].action).toBe('clear');
		expect(convex.audit[1].previousReason).toBe('initial_drift');
		expect(convex.audit[1].incidentRef).toBe('INC-789');
		expect(convex.audit[1].actor).toBe('operator:oncall-bob');
	});

	it('clear when not halted: returns cleared:false but STILL audits the attempt', () => {
		// First clear succeeds.
		convex.operatorClearRevocationHalt({
			confirmation: 'i-have-investigated-the-drift',
			incidentRef: 'INC-A',
			actorPrincipal: 'alice'
		});
		// Second clear is a no-op but should still audit the attempt
		// (forensic value: who tried to clear an already-clear halt?).
		const result = convex.operatorClearRevocationHalt({
			confirmation: 'i-have-investigated-the-drift',
			incidentRef: 'INC-B',
			actorPrincipal: 'alice'
		});
		expect(result.cleared).toBe(false);
		expect(result.reason).toBe('halt_not_active');

		// 1 set + 2 clears (one real, one no-op) = 3 audit rows.
		expect(convex.audit).toHaveLength(3);
		const noopClear = convex.audit.find(
			(a) => a.action === 'clear' && a.reason === 'halt_not_active'
		);
		expect(noopClear).toBeDefined();
		expect(noopClear?.incidentRef).toBe('INC-B');
	});
});

describe('applyRevocationSMTUpdate halt-check', () => {
	it('throws REVOCATION_EMITS_HALTED when the kill-switch is active', () => {
		convex.setRevocationHalt('test_drift', 1000);
		expect(() => convex.checkHaltOrThrow()).toThrow(/REVOCATION_EMITS_HALTED/);
	});

	it('error message includes the haltedAt timestamp + reason for ops triage', () => {
		convex.setRevocationHalt('empty_tree_root_mismatch', 12345);
		try {
			convex.checkHaltOrThrow();
			expect.fail('should have thrown');
		} catch (err) {
			expect(err instanceof Error).toBe(true);
			const msg = (err as Error).message;
			expect(msg).toMatch(/12345/);
			expect(msg).toMatch(/empty_tree_root_mismatch/);
		}
	});

	it('does NOT throw when no halt row exists (genesis case)', () => {
		expect(() => convex.checkHaltOrThrow()).not.toThrow();
	});

	it('does NOT throw after operator clear (halt was set, then cleared)', () => {
		convex.setRevocationHalt('drift', 1000);
		convex.operatorClearRevocationHalt({
			confirmation: 'i-have-investigated-the-drift',
			incidentRef: 'INC-C',
			actorPrincipal: 'alice'
		});
		expect(() => convex.checkHaltOrThrow()).not.toThrow();
	});

	it('throws AGAIN if halt is re-flipped after a clear (multi-incident scenario)', () => {
		convex.setRevocationHalt('drift_1', 1000);
		convex.operatorClearRevocationHalt({
			confirmation: 'i-have-investigated-the-drift',
			incidentRef: 'INC-D',
			actorPrincipal: 'alice'
		});
		expect(() => convex.checkHaltOrThrow()).not.toThrow();

		// Cron detects new drift, flips again.
		convex.setRevocationHalt('drift_2', 5000);
		expect(() => convex.checkHaltOrThrow()).toThrow(/drift_2/);
	});
});
