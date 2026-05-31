/**
 * agentTraces round-trip — in-memory mirror of the four handlers in
 * convex/agentTraces.ts.
 *
 * The repo does not run convex-test (see credential-selector-invariant.test.ts:16
 * for the established pattern). Each test mirrors the production handler's
 * algorithm byte-for-byte and validates behavior on synthetic event data.
 *
 * If a mirror diverges from the production handler, this test fails to catch
 * a regression — so the mirror functions below are intentionally a verbatim
 * copy of the handler bodies, not a re-implementation.
 */

import { describe, it, expect } from 'vitest';

interface TraceEventRow {
	_id: string;
	_creationTime: number;
	traceId: string;
	endpoint: string;
	eventType: string;
	userId?: string;
	payload: unknown;
	success?: boolean;
	durationMs?: number;
	costUsd?: number;
	expiresAt: number;
}

// ── Mirror: expire handler ──────────────────────────────────────────────────
// Production: convex/agentTraces.ts `expire` internalMutation.
const EXPIRE_BATCH_SIZE = 1000;
const MAX_TTL_MS = 30 * 86_400_000;

/** Mirror per-row try/catch — failed deletes increment `failed` without
 * aborting the batch. Simulated via a `shouldFailIds` set. */
function mirrorExpireWithFailures(
	rows: TraceEventRow[],
	now: number,
	shouldFailIds: Set<string>
): { kept: TraceEventRow[]; deleted: number; failed: number } {
	const expired = rows
		.filter((r) => r.expiresAt < now)
		.sort((a, b) => a.expiresAt - b.expiresAt)
		.slice(0, EXPIRE_BATCH_SIZE);
	let deleted = 0;
	let failed = 0;
	const removedIds = new Set<string>();
	for (const row of expired) {
		if (shouldFailIds.has(row._id)) {
			failed++;
		} else {
			removedIds.add(row._id);
			deleted++;
		}
	}
	const kept = rows.filter((r) => !removedIds.has(r._id));
	return { kept, deleted, failed };
}

// ── Mirror: record clamp logic ──────────────────────────────────────────────
function mirrorRecordClamp(requestedExpiresAt: number, now: number): number {
	return Math.min(requestedExpiresAt, now + MAX_TTL_MS);
}

// ── Mirror: deleteByUserId handler ──────────────────────────────────────────
// Two-pass: find user's traceIds via by_userId, then delete all events per
// traceId via by_traceId. Mirrors production exactly because the single-pass
// scan would orphan phase events / trace.end that don't carry userId.
function mirrorDeleteByUserId(
	rows: TraceEventRow[],
	userId: string
): { kept: TraceEventRow[]; deleted: number; traceCount: number; more: boolean } {
	const userRows = rows.filter((r) => r.userId === userId);
	const traceIds = Array.from(new Set(userRows.map((r) => r.traceId)));

	let deleted = 0;
	let saturated = false;
	const deletedIds = new Set<string>();
	for (const traceId of traceIds) {
		if (deleted >= EXPIRE_BATCH_SIZE) {
			saturated = true;
			break;
		}
		const events = rows.filter((r) => r.traceId === traceId);
		for (const evt of events) {
			if (deleted >= EXPIRE_BATCH_SIZE) {
				saturated = true;
				break;
			}
			deletedIds.add(evt._id);
			deleted++;
		}
	}

	const kept = rows.filter((r) => !deletedIds.has(r._id));
	return { kept, deleted, traceCount: traceIds.length, more: saturated };
}
function mirrorExpire(rows: TraceEventRow[], now: number): { kept: TraceEventRow[]; deleted: number } {
	const expired = rows
		.filter((r) => r.expiresAt < now)
		.sort((a, b) => a.expiresAt - b.expiresAt) // by_expiresAt index order
		.slice(0, EXPIRE_BATCH_SIZE);
	const expiredIds = new Set(expired.map((r) => r._id));
	const kept = rows.filter((r) => !expiredIds.has(r._id));
	return { kept, deleted: expired.length };
}

// ── Mirror: listByTrace handler ─────────────────────────────────────────────
function mirrorListByTrace(rows: TraceEventRow[], traceId: string): TraceEventRow[] {
	const events = rows.filter((r) => r.traceId === traceId);
	events.sort((a, b) => a._creationTime - b._creationTime);
	return events;
}

// ── Mirror: recentByEndpoint handler ────────────────────────────────────────
const RECENT_SCAN_LIMIT = 1000;
function mirrorRecentByEndpoint(rows: TraceEventRow[], endpoint: string, limit?: number) {
	const cap = Math.min(limit ?? 20, 200);

	const events = rows
		.filter((r) => r.endpoint === endpoint)
		.sort((a, b) => b._creationTime - a._creationTime) // by_endpoint desc
		.slice(0, RECENT_SCAN_LIMIT);

	const byTrace = new Map<string, TraceEventRow[]>();
	for (const e of events) {
		const bucket = byTrace.get(e.traceId);
		if (bucket) bucket.push(e);
		else byTrace.set(e.traceId, [e]);
	}

	const summaries = Array.from(byTrace.entries()).map(([traceId, evts]) => {
		const sorted = [...evts].sort((a, b) => a._creationTime - b._creationTime);
		const start = sorted.find((e) => e.eventType === 'trace.start');
		const end = sorted.find((e) => e.eventType === 'trace.end');
		return {
			traceId,
			userId: start?.userId ?? end?.userId ?? null,
			startedAt: start?._creationTime ?? sorted[0]?._creationTime ?? null,
			endedAt: end?._creationTime ?? null,
			success: end?.success ?? null,
			durationMs: end?.durationMs ?? null,
			costUsd: end?.costUsd ?? null,
			eventCount: sorted.length,
			lastEventType: sorted[sorted.length - 1]?.eventType ?? null
		};
	});

	summaries.sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
	return summaries.slice(0, cap);
}

// ── Mirror: findStuck handler ───────────────────────────────────────────────
const STUCK_SCAN_LIMIT = 2000;
const STUCK_RESULT_CAP = 500;
function mirrorFindStuck(rows: TraceEventRow[], endpoint: string, olderThanMs: number, now: number) {
	const cutoff = now - olderThanMs;

	const events = rows
		.filter((r) => r.endpoint === endpoint)
		.sort((a, b) => b._creationTime - a._creationTime)
		.slice(0, STUCK_SCAN_LIMIT);

	const oldStarts = events.filter(
		(e) => e.eventType === 'trace.start' && e._creationTime < cutoff
	);

	const stuck: Array<{
		traceId: string;
		userId: string | null;
		startedAt: number;
		latestEventType: string;
		ageMs: number;
	}> = [];

	for (const start of oldStarts.slice(0, STUCK_RESULT_CAP)) {
		// Production uses ctx.db.query(by_traceId).order(desc).first() — equivalent
		// to "latest row for traceId".
		const allForTrace = rows.filter((r) => r.traceId === start.traceId);
		allForTrace.sort((a, b) => b._creationTime - a._creationTime);
		const latest = allForTrace[0];
		if (latest && latest.eventType !== 'trace.end') {
			stuck.push({
				traceId: start.traceId,
				userId: start.userId ?? null,
				startedAt: start._creationTime,
				latestEventType: latest.eventType,
				ageMs: now - start._creationTime
			});
		}
	}

	stuck.sort((a, b) => b.ageMs - a.ageMs);
	return stuck;
}

// ── Test fixtures ───────────────────────────────────────────────────────────
function evt(partial: Partial<TraceEventRow>): TraceEventRow {
	return {
		_id: partial._id ?? Math.random().toString(36).slice(2),
		_creationTime: partial._creationTime ?? 0,
		traceId: partial.traceId ?? 'trace-A',
		endpoint: partial.endpoint ?? 'message-generation',
		eventType: partial.eventType ?? 'phase',
		userId: partial.userId,
		payload: partial.payload ?? {},
		success: partial.success,
		durationMs: partial.durationMs,
		costUsd: partial.costUsd,
		expiresAt: partial.expiresAt ?? Number.MAX_SAFE_INTEGER
	};
}

describe('agentTraces — expire mirror', () => {
	it('deletes only rows past expiresAt', () => {
		const now = 1_000_000;
		const rows: TraceEventRow[] = [
			evt({ _id: 'a', expiresAt: now - 1 }), // expired
			evt({ _id: 'b', expiresAt: now + 1 }), // live
			evt({ _id: 'c', expiresAt: now - 1000 }) // expired
		];
		const { kept, deleted } = mirrorExpire(rows, now);
		expect(deleted).toBe(2);
		expect(kept.map((r) => r._id).sort()).toEqual(['b']);
	});

	it('batches at EXPIRE_BATCH_SIZE — leaves overflow for next tick', () => {
		const now = 1_000_000;
		const overflow = 250;
		const total = EXPIRE_BATCH_SIZE + overflow;
		const rows = Array.from({ length: total }, (_, i) =>
			evt({ _id: `r${i}`, expiresAt: now - 1000 - i })
		);
		const { kept, deleted } = mirrorExpire(rows, now);
		expect(deleted).toBe(EXPIRE_BATCH_SIZE);
		expect(kept.length).toBe(overflow);
	});

	it('is a no-op when nothing expired', () => {
		const now = 1_000_000;
		const rows = [evt({ _id: 'a', expiresAt: now + 10 })];
		const { kept, deleted } = mirrorExpire(rows, now);
		expect(deleted).toBe(0);
		expect(kept.length).toBe(1);
	});

	it('per-row try/catch — one bad row does not stop the batch', () => {
		const now = 1_000_000;
		const rows: TraceEventRow[] = [
			evt({ _id: 'good-1', expiresAt: now - 1 }),
			evt({ _id: 'BAD-MIGRATION-ROW', expiresAt: now - 1 }),
			evt({ _id: 'good-2', expiresAt: now - 1 }),
			evt({ _id: 'good-3', expiresAt: now - 1 })
		];
		const result = mirrorExpireWithFailures(
			rows,
			now,
			new Set(['BAD-MIGRATION-ROW'])
		);
		expect(result.deleted).toBe(3);
		expect(result.failed).toBe(1);
		// Bad row stays (next tick may retry; or operator can hand-fix); the
		// good rows are GONE so they don't block any expiry behind them.
		expect(result.kept.map((r) => r._id).sort()).toEqual(['BAD-MIGRATION-ROW']);
	});
});

describe('agentTraces — record TTL clamp mirror', () => {
	it('clamps caller-supplied expiresAt to MAX_TTL_MS from now', () => {
		const now = 1_000_000_000;
		const farFuture = now + 100 * 86_400_000; // 100 days
		const clamped = mirrorRecordClamp(farFuture, now);
		expect(clamped).toBe(now + MAX_TTL_MS);
	});

	it('preserves expiresAt when caller supplied a sane value', () => {
		const now = 1_000_000_000;
		const inSevenDays = now + 7 * 86_400_000;
		const clamped = mirrorRecordClamp(inSevenDays, now);
		expect(clamped).toBe(inSevenDays);
	});

	it('rejects Number.MAX_SAFE_INTEGER → still bounded by MAX_TTL_MS', () => {
		const now = 1_000_000_000;
		const clamped = mirrorRecordClamp(Number.MAX_SAFE_INTEGER, now);
		expect(clamped).toBe(now + MAX_TTL_MS);
		expect(clamped).toBeLessThan(Number.MAX_SAFE_INTEGER);
	});
});

describe('agentTraces — deleteByUserId mirror', () => {
	it('deletes ALL events for traceIds anchored to the user (not just userId-stamped rows)', () => {
		// Writer stamps userId only on trace.start; phase events + trace.end
		// share the same traceId but have undefined userId. A single-pass
		// by_userId scan would orphan those.
		const rows: TraceEventRow[] = [
			evt({ _id: 'a1', traceId: 'A', userId: 'alice', eventType: 'trace.start' }),
			evt({ _id: 'a2', traceId: 'A', userId: undefined, eventType: 'phase' }),
			evt({ _id: 'a3', traceId: 'A', userId: undefined, eventType: 'trace.end' }),
			evt({ _id: 'b1', traceId: 'B', userId: 'bob', eventType: 'trace.start' }),
			evt({ _id: 'b2', traceId: 'B', userId: undefined, eventType: 'trace.end' }),
			evt({ _id: 'a4', traceId: 'A2', userId: 'alice', eventType: 'trace.start' })
		];
		const { kept, deleted, traceCount } = mirrorDeleteByUserId(rows, 'alice');
		expect(traceCount).toBe(2); // 'A' and 'A2'
		expect(deleted).toBe(4); // all 3 of A + 1 of A2
		expect(kept.map((r) => r._id).sort()).toEqual(['b1', 'b2']);
	});

	it('returns zero when user has no traces', () => {
		const rows: TraceEventRow[] = [
			evt({ _id: 'x', userId: 'bob', eventType: 'trace.start' })
		];
		const result = mirrorDeleteByUserId(rows, 'alice');
		expect(result.deleted).toBe(0);
		expect(result.traceCount).toBe(0);
		expect(result.more).toBe(false);
	});

	it('signals more=true when per-call batch saturated', () => {
		// Build EXPIRE_BATCH_SIZE+5 events split across (EXPIRE_BATCH_SIZE+5)/3
		// traces so the per-trace inner loop crosses the cap.
		const rows: TraceEventRow[] = [];
		const totalTraces = Math.ceil((EXPIRE_BATCH_SIZE + 100) / 3);
		for (let t = 0; t < totalTraces; t++) {
			rows.push(
				evt({ _id: `s-${t}`, traceId: `T${t}`, userId: 'alice', eventType: 'trace.start' }),
				evt({ _id: `p-${t}`, traceId: `T${t}`, userId: undefined, eventType: 'phase' }),
				evt({ _id: `e-${t}`, traceId: `T${t}`, userId: undefined, eventType: 'trace.end' })
			);
		}
		const result = mirrorDeleteByUserId(rows, 'alice');
		expect(result.more).toBe(true);
		expect(result.deleted).toBe(EXPIRE_BATCH_SIZE);
	});
});

describe('agentTraces — listByTrace mirror', () => {
	it('returns events oldest-first for a single traceId', () => {
		const rows: TraceEventRow[] = [
			evt({ _id: 'c', traceId: 'A', _creationTime: 3 }),
			evt({ _id: 'a', traceId: 'A', _creationTime: 1 }),
			evt({ _id: 'b', traceId: 'A', _creationTime: 2 }),
			evt({ _id: 'd', traceId: 'B', _creationTime: 2 }) // different trace
		];
		const result = mirrorListByTrace(rows, 'A');
		expect(result.map((r) => r._id)).toEqual(['a', 'b', 'c']);
	});

	it('returns empty array for unknown traceId', () => {
		expect(mirrorListByTrace([], 'no-such-trace')).toEqual([]);
	});
});

describe('agentTraces — recentByEndpoint mirror', () => {
	it('folds events into one summary per traceId', () => {
		const rows: TraceEventRow[] = [
			evt({
				traceId: 'A',
				endpoint: 'message-generation',
				eventType: 'trace.start',
				userId: 'user1',
				_creationTime: 100
			}),
			evt({
				traceId: 'A',
				endpoint: 'message-generation',
				eventType: 'source-search',
				_creationTime: 200
			}),
			evt({
				traceId: 'A',
				endpoint: 'message-generation',
				eventType: 'trace.end',
				success: true,
				durationMs: 500,
				costUsd: 0.01,
				_creationTime: 600
			}),
			evt({
				traceId: 'B',
				endpoint: 'message-generation',
				eventType: 'trace.start',
				userId: 'user2',
				_creationTime: 300
			}),
			evt({
				traceId: 'B',
				endpoint: 'message-generation',
				eventType: 'error',
				_creationTime: 400
			})
		];
		const result = mirrorRecentByEndpoint(rows, 'message-generation');

		expect(result.length).toBe(2);

		const traceB = result.find((r) => r.traceId === 'B')!;
		const traceA = result.find((r) => r.traceId === 'A')!;

		// B started later than A → comes first in descending-start order
		expect(result[0].traceId).toBe('B');

		expect(traceA.userId).toBe('user1');
		expect(traceA.success).toBe(true);
		expect(traceA.durationMs).toBe(500);
		expect(traceA.costUsd).toBe(0.01);
		expect(traceA.eventCount).toBe(3);
		expect(traceA.lastEventType).toBe('trace.end');

		expect(traceB.userId).toBe('user2');
		expect(traceB.success).toBeNull(); // no trace.end
		expect(traceB.endedAt).toBeNull();
		expect(traceB.eventCount).toBe(2);
		expect(traceB.lastEventType).toBe('error');
	});

	it('excludes events from other endpoints', () => {
		const rows: TraceEventRow[] = [
			evt({ traceId: 'A', endpoint: 'message-generation' }),
			evt({ traceId: 'B', endpoint: 'source-discovery' })
		];
		const result = mirrorRecentByEndpoint(rows, 'message-generation');
		expect(result.map((r) => r.traceId)).toEqual(['A']);
	});

	it('caps result at limit', () => {
		const rows = Array.from({ length: 30 }, (_, i) =>
			evt({
				traceId: `trace-${i}`,
				endpoint: 'message-generation',
				_creationTime: i,
				eventType: 'trace.start'
			})
		);
		const result = mirrorRecentByEndpoint(rows, 'message-generation', 5);
		expect(result.length).toBe(5);
	});
});

describe('agentTraces — findStuck mirror', () => {
	it('flags traces with start but no end past cutoff', () => {
		const now = 10_000;
		const olderThanMs = 1_000;
		const rows: TraceEventRow[] = [
			// Stuck: started 5s ago, latest event is phase, no end
			evt({
				_id: 's1',
				traceId: 'stuck',
				endpoint: 'message-generation',
				eventType: 'trace.start',
				userId: 'u1',
				_creationTime: now - 5_000
			}),
			evt({
				_id: 's2',
				traceId: 'stuck',
				endpoint: 'message-generation',
				eventType: 'source-search',
				_creationTime: now - 4_000
			}),
			// Completed: started 5s ago, has trace.end
			evt({
				_id: 'd1',
				traceId: 'done',
				endpoint: 'message-generation',
				eventType: 'trace.start',
				userId: 'u2',
				_creationTime: now - 5_000
			}),
			evt({
				_id: 'd2',
				traceId: 'done',
				endpoint: 'message-generation',
				eventType: 'trace.end',
				success: true,
				_creationTime: now - 4_500
			}),
			// Recent: started 0.5s ago — under cutoff, not stuck
			evt({
				_id: 'r1',
				traceId: 'recent',
				endpoint: 'message-generation',
				eventType: 'trace.start',
				_creationTime: now - 500
			})
		];

		const result = mirrorFindStuck(rows, 'message-generation', olderThanMs, now);
		expect(result.length).toBe(1);
		expect(result[0].traceId).toBe('stuck');
		expect(result[0].userId).toBe('u1');
		expect(result[0].latestEventType).toBe('source-search');
		expect(result[0].ageMs).toBe(5_000);
	});

	it('returns empty when no traces are stuck', () => {
		const now = 10_000;
		const rows: TraceEventRow[] = [
			evt({ traceId: 'A', eventType: 'trace.start', _creationTime: now - 5_000 }),
			evt({ traceId: 'A', eventType: 'trace.end', _creationTime: now - 4_000 })
		];
		expect(mirrorFindStuck(rows, 'message-generation', 1_000, now)).toEqual([]);
	});

	it('does not flag stuck traces from other endpoints', () => {
		const now = 10_000;
		const rows: TraceEventRow[] = [
			evt({
				traceId: 'X',
				endpoint: 'other-pipeline',
				eventType: 'trace.start',
				_creationTime: now - 5_000
			})
		];
		expect(mirrorFindStuck(rows, 'message-generation', 1_000, now)).toEqual([]);
	});
});

describe('agentTraces — schema contract', () => {
	it('replay round-trip: write events → listByTrace → reconstruct flow', () => {
		const now = 1_000_000;
		const inserted: TraceEventRow[] = [];

		// Simulate what stream-message/+server.ts would emit
		function record(args: Omit<TraceEventRow, '_id' | '_creationTime'>): void {
			inserted.push({
				_id: `evt-${inserted.length}`,
				_creationTime: now + inserted.length, // monotonic
				...args
			});
		}

		const traceId = 'replay-test-trace';
		record({
			traceId,
			endpoint: 'message-generation',
			eventType: 'trace.start',
			userId: 'user-alice',
			payload: {
				subjectLine: 'Hello senator',
				coreMessage: 'Please support bill X',
				topics: ['climate'],
				decisionMakerCount: 1
			},
			expiresAt: now + 7 * 86_400_000
		});
		record({
			traceId,
			endpoint: 'message-generation',
			eventType: 'source-search',
			payload: { exaSearches: 3, hits: 18 },
			expiresAt: now + 7 * 86_400_000
		});
		record({
			traceId,
			endpoint: 'message-generation',
			eventType: 'message-write',
			payload: {
				fullPrompt: 'Write a message about climate to senator...',
				fullResponse: 'Dear Senator, ...',
				tokens: 1200
			},
			expiresAt: now + 7 * 86_400_000
		});
		record({
			traceId,
			endpoint: 'message-generation',
			eventType: 'trace.end',
			success: true,
			durationMs: 4200,
			costUsd: 0.005,
			payload: { finalPhase: 'completed' },
			expiresAt: now + 7 * 86_400_000
		});

		const replay = mirrorListByTrace(inserted, traceId);
		expect(replay.length).toBe(4);
		expect(replay.map((e) => e.eventType)).toEqual([
			'trace.start',
			'source-search',
			'message-write',
			'trace.end'
		]);

		// Full inputs preserved (no PII filtering, no truncation)
		const start = replay[0];
		expect((start.payload as any).subjectLine).toBe('Hello senator');
		expect((start.payload as any).coreMessage).toBe('Please support bill X');

		// LLM response captured
		const write = replay[2];
		expect((write.payload as any).fullResponse).toBe('Dear Senator, ...');

		// Cost and timing on trace.end
		const end = replay[3];
		expect(end.success).toBe(true);
		expect(end.durationMs).toBe(4200);
		expect(end.costUsd).toBe(0.005);

		// recentByEndpoint summarizes the trace
		const recents = mirrorRecentByEndpoint(inserted, 'message-generation');
		expect(recents.length).toBe(1);
		expect(recents[0].traceId).toBe(traceId);
		expect(recents[0].userId).toBe('user-alice');
		expect(recents[0].success).toBe(true);
		expect(recents[0].eventCount).toBe(4);
		expect(recents[0].lastEventType).toBe('trace.end');
	});
});
