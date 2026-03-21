/**
 * Agent Trace Persistence
 *
 * Fire-and-forget trace writes for agent thoughts, completions, and costs.
 * Persists to Postgres via Prisma. Never blocks the SSE stream.
 *
 * Enable: AGENT_TRACE_ENABLED=true
 * Content: AGENT_TRACE_CONTENT=true (stores full message text, off by default)
 * TTL:     AGENT_TRACE_TTL_DAYS=30 (default)
 */

import { db } from '$lib/core/db';
import { env } from '$env/dynamic/private';
import { Prisma } from '@prisma/client';

function isEnabled(): boolean {
	return env.AGENT_TRACE_ENABLED === 'true';
}

function isContentEnabled(): boolean {
	return env.AGENT_TRACE_CONTENT === 'true';
}

function ttlDays(): number {
	const val = parseInt(env.AGENT_TRACE_TTL_DAYS || '30', 10);
	return isNaN(val) ? 30 : val;
}

function expiresAt(): Date {
	const d = new Date();
	d.setDate(d.getDate() + ttlDays());
	return d;
}

/**
 * Write a trace event. Fire-and-forget — never awaited in the hot path.
 * Returns void. Swallows all errors silently.
 */
export function traceEvent(
	traceId: string,
	endpoint: string,
	eventType: string,
	payload: Record<string, unknown>,
	opts?: {
		userId?: string | null;
		success?: boolean;
		durationMs?: number;
		costUsd?: number;
		waitUntil?: (promise: Promise<unknown>) => void;
	}
): void {
	if (!isEnabled()) return;

	const data = {
		traceId,
		userId: opts?.userId ?? null,
		endpoint,
		eventType,
		payload: payload as Prisma.InputJsonValue,
		success: opts?.success ?? null,
		durationMs: opts?.durationMs ?? null,
		costUsd: opts?.costUsd ?? null,
		expiresAt: expiresAt()
	};

	const writePromise = db.agentTrace.create({ data }).catch((err: Error) => {
		// Prisma 6.x PG adapter surfaces SocketTimeout when the pool
		// connection idles out — a variant the WASM engine doesn't
		// recognize. Retry once; the pool establishes a fresh connection.
		if (err?.message?.includes('SocketTimeout') || err?.message?.includes('InvalidArg')) {
			db.agentTrace.create({ data }).catch((retryErr: Error) => {
				console.warn('[agent-trace] Write failed after retry:', retryErr?.message);
			});
		} else {
			console.warn('[agent-trace] Write failed:', err?.message);
		}
	});

	if (opts?.waitUntil) {
		opts.waitUntil(writePromise);
	}
}

/**
 * Trace a completion event with cost data.
 * Cost is pre-computed by the caller using real token counts.
 */
export function traceCompletion(
	traceId: string,
	endpoint: string,
	result: Record<string, unknown>,
	opts: {
		userId?: string | null;
		durationMs: number;
		success: boolean;
		costUsd?: number;
		inputTokens?: number;
		outputTokens?: number;
		thoughtsTokens?: number;
		totalTokens?: number;
		waitUntil?: (promise: Promise<unknown>) => void;
	}
): void {
	traceEvent(
		traceId,
		endpoint,
		'cost',
		{
			...result,
			inputTokens: opts.inputTokens,
			outputTokens: opts.outputTokens,
			thoughtsTokens: opts.thoughtsTokens,
			totalTokens: opts.totalTokens
		},
		{
			userId: opts.userId,
			success: opts.success,
			durationMs: opts.durationMs,
			costUsd: opts.costUsd,
			waitUntil: opts.waitUntil
		}
	);
}

/**
 * Trace request inputs at the start of a pipeline.
 *
 * Always stores structured metadata (topics, scope, counts, lengths).
 * Full message content stored only when AGENT_TRACE_CONTENT=true.
 */
export function traceRequest(
	traceId: string,
	endpoint: string,
	input: {
		metadata: Record<string, unknown>;
		content?: Record<string, unknown>;
	},
	opts?: {
		userId?: string | null;
		waitUntil?: (promise: Promise<unknown>) => void;
	}
): void {
	if (!isEnabled()) return;

	const payload = isContentEnabled()
		? { ...input.metadata, ...input.content }
		: input.metadata;

	traceEvent(traceId, endpoint, 'request', payload, opts);
}

/**
 * Get the original request input for a trace.
 * Returns null if no request event exists (old traces).
 */
export async function getTraceInput(traceId: string): Promise<Record<string, unknown> | null> {
	const row = await db.agentTrace.findFirst({
		where: { traceId, eventType: 'request' },
		select: { payload: true }
	});
	return (row?.payload as Record<string, unknown>) || null;
}

/**
 * Query traces for a specific user (transparency).
 * Cursor-based pagination, max 100 per page.
 */
export async function getUserTraces(
	userId: string,
	opts?: {
		endpoint?: string;
		limit?: number;
		cursor?: string;
	}
): Promise<{
	traces: Array<{
		id: string;
		traceId: string;
		endpoint: string;
		eventType: string;
		payload: unknown;
		success: boolean | null;
		durationMs: number | null;
		createdAt: Date;
	}>;
	nextCursor: string | null;
}> {
	const limit = Math.min(opts?.limit ?? 50, 100);

	const rows = await db.agentTrace.findMany({
		where: {
			userId,
			...(opts?.endpoint && { endpoint: opts.endpoint }),
			...(opts?.cursor && { id: { lt: opts.cursor } })
		},
		orderBy: { createdAt: 'desc' },
		take: limit + 1,
		select: {
			id: true,
			traceId: true,
			endpoint: true,
			eventType: true,
			payload: true,
			success: true,
			durationMs: true,
			createdAt: true
		}
	});

	const hasMore = rows.length > limit;
	const traces = rows.slice(0, limit);

	return {
		traces,
		nextCursor: hasMore ? traces[traces.length - 1].id : null
	};
}

/**
 * Delete expired traces. Called by daily cron.
 */
export async function purgeExpiredTraces(): Promise<number> {
	const result = await db.agentTrace.deleteMany({
		where: { expiresAt: { lt: new Date() } }
	});
	return result.count;
}
