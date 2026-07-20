/**
 * Agent trace event log — persistent observability for agent pipelines
 * (message generation, source discovery, etc.).
 *
 * Each event is one row keyed by `traceId`. A pipeline run emits:
 *   trace.start  → endpoint, userId, full inputs in payload
 *   phase events → source-search, source-fetch, source-evaluation,
 *                  message-write, error, ...
 *   trace.end    → success, durationMs, costUsd, finalPhase
 *
 * Access model
 * ------------
 * All public functions gated by `requireInternalSecret(args._secret)` as
 * the first statement — anonymous browsers cannot reach this surface.
 * Mirrors the F-157 pattern across convex/{authOps, users, supporters,
 * email, ...}.ts.
 *
 * SvelteKit writes via `serverMutation(api.agentTraces.record, ...)`
 * fire-and-forget. Operators read via `npx convex run` with the
 * INTERNAL_API_SECRET in scope.
 *
 * Privacy
 * -------
 * Full inputs/outputs/prompts/responses captured (replay fidelity is the
 * point). TTL is the privacy primitive — the SvelteKit-side writer sets
 * `expiresAt` from `AGENT_TRACE_TTL_DAYS` (default 7), and the `record`
 * handler clamps to `MAX_TTL_MS` (30d) defensively so a writer bug or
 * misconfigured env cannot extend retention silently. Integrity
 * exclusions (Authorization/Cookie headers + `_secret` keys) are scrubbed
 * at the SvelteKit boundary before payloads cross the wire.
 *
 * Account deletion is not launched. The historical `deleteByUserId` helper is
 * a pre-I/O tombstone because its partial batches could delete the only
 * user-stamped anchor before deleting the rest of a trace. Until a durable
 * erasure coordinator ships, deletion relies on the 7-day TTL.
 *
 * Accepted residual
 * -----------------
 * Anyone holding `INTERNAL_API_SECRET` (or with Convex prod-admin
 * dashboard access) can read every trace via the queries below. There is
 * no per-read audit log here — this surface inherits the same trust
 * boundary as the ~20 other `_secret`-gated public functions in this
 * repo (F-157 cure). If operator-read auditing becomes required, it
 * should be added across all gated surfaces, not just this one.
 *
 * Operator commands
 * -----------------
 *   npx convex run agentTraces:recentByEndpoint --prod -- \
 *     '{"_secret":"$INTERNAL_API_SECRET","endpoint":"message-generation","limit":20}'
 *
 *   npx convex run agentTraces:listByTrace --prod -- \
 *     '{"_secret":"$INTERNAL_API_SECRET","traceId":"abc-def-..."}'
 *
 *   npx convex run agentTraces:findStuck --prod -- \
 *     '{"_secret":"$INTERNAL_API_SECRET","endpoint":"message-generation","olderThanMs":300000,"asOf":1784462400000}'
 */

import { mutation, query, internalMutation } from './_generated/server';
import { v } from 'convex/values';
import { requireInternalSecret } from './_internalAuth';

// Hourly cron deletes this many rows per tick. At 1000/hour = 24,000/day,
// which gives ~2.4x headroom over a 10k events/day projection (1000 traces
// × ~10 events). If `expire` saturates the batch, it logs a warn so an
// operator can see backlog forming in Convex function logs.
const EXPIRE_BATCH_SIZE = 1000;

// Operator reads are cursor-paged and byte-bounded even though they require the
// internal secret. A trace may straddle page boundaries; the response makes
// that pagination explicit instead of hiding a multi-thousand-row scan.
const TRACE_EVENT_PAGE_SIZE = 500;
const TRACE_EVENT_PAGE_MAX_BYTES = 512 * 1024;
const STUCK_RESULT_CAP = 50;

// Hard cap on TTL to defend against a caller passing
// `Number.MAX_SAFE_INTEGER` or a misconfigured `AGENT_TRACE_TTL_DAYS`.
// The SvelteKit writer defaults to 7 days; this 30-day cap is the
// physical ceiling enforced at the database boundary regardless of the
// writer's policy. The "TTL is the privacy primitive" claim depends on
// this clamp existing.
const MAX_TTL_MS = 30 * 86_400_000;

/**
 * Record one agent trace event.
 *
 * Public mutation so SvelteKit's `serverMutation` can call it via the
 * Convex HTTP API. The `_secret` gate is the first statement; anonymous
 * callers cannot reach the `ctx.db.insert`.
 */
export const record = mutation({
	args: {
		_secret: v.string(),
		traceId: v.string(),
		endpoint: v.string(),
		eventType: v.string(),
		userId: v.optional(v.string()),
		payload: v.any(),
		success: v.optional(v.boolean()),
		durationMs: v.optional(v.number()),
		costUsd: v.optional(v.float64()),
		expiresAt: v.number()
	},
	handler: async (ctx, args) => {
		requireInternalSecret(args._secret);
		// Clamp `expiresAt` server-side so a writer bug or misconfigured
		// AGENT_TRACE_TTL_DAYS cannot convert "7-day retention" into
		// effectively-permanent retention of full prompts/responses.
		const clampedExpiresAt = Math.min(args.expiresAt, Date.now() + MAX_TTL_MS);
		await ctx.db.insert('agentTraces', {
			traceId: args.traceId,
			endpoint: args.endpoint,
			eventType: args.eventType,
			userId: args.userId,
			payload: args.payload,
			success: args.success,
			durationMs: args.durationMs,
			costUsd: args.costUsd,
			expiresAt: clampedExpiresAt
		});
	}
});

/**
 * Return one byte-bounded page of events for one `traceId`, oldest first.
 *
 * The first event is returned separately as authorization metadata so the
 * caller can authenticate every cursor page without rehydrating the full
 * trace. Replay clients follow `continueCursor`; no operator read is allowed
 * to turn a large trace into one unbounded database transaction.
 */
export const listByTrace = query({
	args: {
		_secret: v.string(),
		traceId: v.string(),
		cursor: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		requireInternalSecret(args._secret);
		if (!args.traceId || args.traceId.length > 128) {
			throw new Error('INVALID_TRACE_ID');
		}
		const trace = ctx.db
			.query('agentTraces')
			.withIndex('by_traceId', (q) => q.eq('traceId', args.traceId))
			.order('asc');
		const [firstEvent, page] = await Promise.all([
			trace.first(),
			trace.paginate({
				cursor: args.cursor ?? null,
				numItems: TRACE_EVENT_PAGE_SIZE,
				maximumRowsRead: TRACE_EVENT_PAGE_SIZE,
				maximumBytesRead: TRACE_EVENT_PAGE_MAX_BYTES
			})
		]);
		return {
			firstEvent,
			events: page.page,
			isDone: page.isDone,
			continueCursor: page.isDone ? null : page.continueCursor
		};
	}
});

/**
 * Summarize the most recent traces for an endpoint.
 *
 * Folds the flat event log into one row per `traceId` by pairing
 * `trace.start` with `trace.end` (when present). Cheap enough for an
 * operator's first look at recent activity.
 */
export const recentByEndpoint = query({
	args: {
		_secret: v.string(),
		endpoint: v.string(),
		limit: v.optional(v.number()),
		cursor: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		requireInternalSecret(args._secret);
		const cap = Math.min(args.limit ?? 20, 200);

		const eventPage = await ctx.db
			.query('agentTraces')
			.withIndex('by_endpoint', (q) => q.eq('endpoint', args.endpoint))
			.order('desc')
			.paginate({
				cursor: args.cursor ?? null,
				numItems: TRACE_EVENT_PAGE_SIZE,
				maximumRowsRead: TRACE_EVENT_PAGE_SIZE,
				maximumBytesRead: TRACE_EVENT_PAGE_MAX_BYTES
			});
		const events = eventPage.page;

		const byTrace = new Map<string, typeof events>();
		for (const e of events) {
			const bucket = byTrace.get(e.traceId);
			if (bucket) {
				bucket.push(e);
			} else {
				byTrace.set(e.traceId, [e]);
			}
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
		return {
			summaries: summaries.slice(0, cap),
			scanned: events.length,
			isDone: eventPage.isDone,
			continueCursor: eventPage.isDone ? null : eventPage.continueCursor
		};
	}
});

/**
 * Find traces with `trace.start` but no `trace.end` past `olderThanMs`.
 *
 * Operator-invoked diagnostic (no cron alert in v1). Sentry catches
 * uncaught throws and the try/finally in stream-message guarantees
 * `trace.end` on normal exits — so a stuck trace generally means a
 * worker died mid-action. Rare; useful when it happens.
 *
 * Implementation: pull recent endpoint events, filter to old
 * `trace.start`s, then per-trace check the latest event. N+1 by design
 * — bounded by `STUCK_RESULT_CAP` and run only when an operator asks.
 */
export const findStuck = query({
	args: {
		_secret: v.string(),
		endpoint: v.string(),
		olderThanMs: v.number(),
		asOf: v.number(),
		cursor: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		requireInternalSecret(args._secret);
		if (!Number.isSafeInteger(args.asOf) || args.asOf <= 0) throw new Error('INVALID_AS_OF');
		if (!Number.isFinite(args.olderThanMs) || args.olderThanMs < 0) {
			throw new Error('INVALID_OLDER_THAN_MS');
		}
		const cutoff = args.asOf - args.olderThanMs;

		const eventPage = await ctx.db
			.query('agentTraces')
			.withIndex('by_endpoint', (q) => q.eq('endpoint', args.endpoint))
			.order('desc')
			.paginate({
				cursor: args.cursor ?? null,
				numItems: TRACE_EVENT_PAGE_SIZE,
				maximumRowsRead: TRACE_EVENT_PAGE_SIZE,
				maximumBytesRead: TRACE_EVENT_PAGE_MAX_BYTES
			});
		const events = eventPage.page;

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
			const latest = await ctx.db
				.query('agentTraces')
				.withIndex('by_traceId', (q) => q.eq('traceId', start.traceId))
				.order('desc')
				.first();
			if (latest && latest.eventType !== 'trace.end') {
				stuck.push({
					traceId: start.traceId,
					userId: start.userId ?? null,
					startedAt: start._creationTime,
					latestEventType: latest.eventType,
					ageMs: args.asOf - start._creationTime
				});
			}
		}

		stuck.sort((a, b) => b.ageMs - a.ageMs);
		return {
			stuck,
			scanned: events.length,
			isDone: eventPage.isDone,
			continueCursor: eventPage.isDone ? null : eventPage.continueCursor
		};
	}
});

/**
 * Hourly cron — delete rows past `expiresAt` in `EXPIRE_BATCH_SIZE`
 * batches.
 *
 * Mirrors `messageJobs.cleanupExpired` and `intelligence.markExpired`.
 * The batch size keeps a single cron tick under Convex's per-mutation
 * op budget; rows older than the batch are picked up on subsequent
 * ticks. If a tick fills the batch, that's a backlog signal — we log
 * a warning so the operator sees it in Convex function logs and can
 * tighten cron frequency or batch size before the table grows
 * unbounded.
 */
export const expire = internalMutation({
	args: {},
	handler: async (ctx) => {
		const now = Date.now();
		const expired = await ctx.db
			.query('agentTraces')
			.withIndex('by_expiresAt', (q) => q.lt('expiresAt', now))
			.take(EXPIRE_BATCH_SIZE);

		// Per-row try/catch so a malformed or migration-orphaned row can't
		// poison the whole batch — if one delete throws (deterministic
		// failure), the rest of the batch still completes and we move on.
		// The alternative (whole-batch rollback) would leave the bad row
		// stuck forever and block any expiry behind it.
		let deleted = 0;
		let failed = 0;
		for (const row of expired) {
			try {
				await ctx.db.delete(row._id);
				deleted++;
			} catch (err) {
				failed++;
				console.warn(
					`[agentTraces.expire] Delete failed for _id=${row._id}: ${
						err instanceof Error ? err.message : String(err)
					}`
				);
			}
		}

		if (expired.length === EXPIRE_BATCH_SIZE) {
			console.warn(
				`[agentTraces.expire] Saturated batch (${EXPIRE_BATCH_SIZE} rows). ` +
					`Backlog forming — consider raising frequency or batch size.`
			);
		}

		return { deleted, failed };
	}
});

/**
 * @deprecated Account deletion is not launched. A safe replacement needs a
 * durable trace-level erasure ledger so losing the user-stamped start row can
 * never orphan phase/end rows across transaction boundaries.
 */
export const deleteByUserId = internalMutation({
	args: { userId: v.string() },
	handler: async () => {
		throw new Error('AGENT_TRACE_USER_ERASURE_NOT_LAUNCHED');
	}
});
