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
 * GDPR cascade: `deleteByUserId` (internalMutation) is provided so the
 * user-deletion pipeline can erase a user's traces immediately on
 * account delete. NOTE: the user-deletion mutation does not yet call
 * this helper — until it does, deletion relies on the 7-day TTL.
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
 *     '{"_secret":"$INTERNAL_API_SECRET","endpoint":"message-generation","olderThanMs":300000}'
 */

import { mutation, query, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { requireInternalSecret } from "./_internalAuth";

// Hourly cron deletes this many rows per tick. At 1000/hour = 24,000/day,
// which gives ~2.4x headroom over a 10k events/day projection (1000 traces
// × ~10 events). If `expire` saturates the batch, it logs a warn so an
// operator can see backlog forming in Convex function logs.
const EXPIRE_BATCH_SIZE = 1000;

// `recentByEndpoint` scans this many recent events to fold into trace
// summaries. With ~10 events per trace, 5000 events yields ~500 trace
// summaries — plenty to satisfy the max 200 cap. If we add many more
// endpoints or per-trace events, replace with a compound
// `[endpoint, eventType]` index and scan trace.start events directly.
const RECENT_SCAN_LIMIT = 5000;

const STUCK_SCAN_LIMIT = 2000;
const STUCK_RESULT_CAP = 500;

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
		expiresAt: v.number(),
	},
	handler: async (ctx, args) => {
		requireInternalSecret(args._secret);
		// Clamp `expiresAt` server-side so a writer bug or misconfigured
		// AGENT_TRACE_TTL_DAYS cannot convert "7-day retention" into
		// effectively-permanent retention of full prompts/responses.
		const clampedExpiresAt = Math.min(args.expiresAt, Date.now() + MAX_TTL_MS);
		await ctx.db.insert("agentTraces", {
			traceId: args.traceId,
			endpoint: args.endpoint,
			eventType: args.eventType,
			userId: args.userId,
			payload: args.payload,
			success: args.success,
			durationMs: args.durationMs,
			costUsd: args.costUsd,
			expiresAt: clampedExpiresAt,
		});
	},
});

/**
 * Return every event for one `traceId`, oldest first.
 *
 * Useful for replay: walk the events in order and reconstruct what the
 * pipeline saw and decided at each phase.
 */
export const listByTrace = query({
	args: {
		_secret: v.string(),
		traceId: v.string(),
	},
	handler: async (ctx, args) => {
		requireInternalSecret(args._secret);
		const events = await ctx.db
			.query("agentTraces")
			.withIndex("by_traceId", (q) => q.eq("traceId", args.traceId))
			.collect();
		events.sort((a, b) => a._creationTime - b._creationTime);
		return events;
	},
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
	},
	handler: async (ctx, args) => {
		requireInternalSecret(args._secret);
		const cap = Math.min(args.limit ?? 20, 200);

		const events = await ctx.db
			.query("agentTraces")
			.withIndex("by_endpoint", (q) => q.eq("endpoint", args.endpoint))
			.order("desc")
			.take(RECENT_SCAN_LIMIT);

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
			const sorted = [...evts].sort(
				(a, b) => a._creationTime - b._creationTime
			);
			const start = sorted.find((e) => e.eventType === "trace.start");
			const end = sorted.find((e) => e.eventType === "trace.end");
			return {
				traceId,
				userId: start?.userId ?? end?.userId ?? null,
				startedAt: start?._creationTime ?? sorted[0]?._creationTime ?? null,
				endedAt: end?._creationTime ?? null,
				success: end?.success ?? null,
				durationMs: end?.durationMs ?? null,
				costUsd: end?.costUsd ?? null,
				eventCount: sorted.length,
				lastEventType: sorted[sorted.length - 1]?.eventType ?? null,
			};
		});

		summaries.sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
		return summaries.slice(0, cap);
	},
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
	},
	handler: async (ctx, args) => {
		requireInternalSecret(args._secret);
		const cutoff = Date.now() - args.olderThanMs;

		const events = await ctx.db
			.query("agentTraces")
			.withIndex("by_endpoint", (q) => q.eq("endpoint", args.endpoint))
			.order("desc")
			.take(STUCK_SCAN_LIMIT);

		const oldStarts = events.filter(
			(e) => e.eventType === "trace.start" && e._creationTime < cutoff
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
				.query("agentTraces")
				.withIndex("by_traceId", (q) => q.eq("traceId", start.traceId))
				.order("desc")
				.first();
			if (latest && latest.eventType !== "trace.end") {
				stuck.push({
					traceId: start.traceId,
					userId: start.userId ?? null,
					startedAt: start._creationTime,
					latestEventType: latest.eventType,
					ageMs: Date.now() - start._creationTime,
				});
			}
		}

		stuck.sort((a, b) => b.ageMs - a.ageMs);
		return stuck;
	},
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
			.query("agentTraces")
			.withIndex("by_expiresAt", (q) => q.lt("expiresAt", now))
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
	},
});

/**
 * GDPR right-to-erasure: delete every trace event for one userId.
 *
 * Internal — called from the user-deletion pipeline. Batches the delete
 * to stay within mutation op budget; returns `more: true` when there
 * are additional rows to delete on the next call. Callers loop until
 * `more === false`.
 *
 * The `by_userId` index makes this an indexed scan rather than a table
 * walk. Without this helper, deleting a user leaves their trace rows
 * to age out via TTL (up to 7 days of plaintext retention after they
 * asked to be forgotten) — which doesn't satisfy "the moment they
 * delete."
 */
export const deleteByUserId = internalMutation({
	args: { userId: v.string() },
	handler: async (ctx, args) => {
		const rows = await ctx.db
			.query("agentTraces")
			.withIndex("by_userId", (q) => q.eq("userId", args.userId))
			.take(EXPIRE_BATCH_SIZE);

		for (const row of rows) {
			await ctx.db.delete(row._id);
		}

		return { deleted: rows.length, more: rows.length === EXPIRE_BATCH_SIZE };
	},
});
