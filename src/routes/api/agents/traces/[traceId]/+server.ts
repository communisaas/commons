import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { serverQuery } from '$lib/server/convex-work-budget';
import { api } from '$lib/convex';
import { getInternalSecret } from '$lib/server/internal/secret-auth';
import { requireAuthenticatedAgentRequest } from '$lib/server/agent-request-authority';
import { readBoundedAgentRequest } from '$lib/server/agent-request-envelope';

type AgentTraceEvent = {
	_creationTime: number;
	traceId: string;
	userId?: string;
	endpoint: string;
	eventType: string;
	payload: unknown;
	success?: boolean;
	durationMs?: number;
	costUsd?: number;
	expiresAt: number;
};

type TracePayload = Record<string, unknown>;

function internalSecret(): string | null {
	try {
		return getInternalSecret();
	} catch {
		return null;
	}
}

function payloadRecord(payload: unknown): TracePayload {
	return payload && typeof payload === 'object' && !Array.isArray(payload)
		? (payload as TracePayload)
		: {};
}

function numberField(payload: TracePayload, key: string): number | null {
	const value = payload[key];
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringField(payload: TracePayload, key: string): string | null {
	const value = payload[key];
	return typeof value === 'string' && value.trim() ? value : null;
}

function booleanField(payload: TracePayload, key: string): boolean | null {
	const value = payload[key];
	return typeof value === 'boolean' ? value : null;
}

function payloadKeys(payload: unknown): string[] {
	return Object.keys(payloadRecord(payload)).sort().slice(0, 16);
}

function summarizeTracePayload(eventType: string, payload: unknown): string {
	const data = payloadRecord(payload);
	switch (eventType) {
		case 'trace.start': {
			const sizes = payloadRecord(data.sizes);
			const subjectLength = numberField(sizes, 'subjectLength');
			const coreMessageLength = numberField(sizes, 'coreMessageLength');
			const targetCount = numberField(sizes, 'decisionMakerCount');
			return (
				[
					subjectLength !== null ? `${subjectLength} subject chars` : null,
					coreMessageLength !== null ? `${coreMessageLength} core chars` : null,
					targetCount !== null ? `${targetCount} targets supplied` : null,
					booleanField(data, 'hasRecoveryKey') ? 'recovery key present' : null
				]
					.filter((part): part is string => Boolean(part))
					.join('; ') || 'Trace started with redacted input snapshot.'
			);
		}
		case 'source-cache': {
			const hit = booleanField(data, 'cacheHit');
			const sourceCount = numberField(data, 'sourceCount');
			return `${hit ? 'source cache hit' : 'source cache miss'}${
				sourceCount !== null ? `; ${sourceCount} cached sources` : ''
			}`;
		}
		case 'source-discovery-skipped':
			return `Source discovery skipped: ${stringField(data, 'reason') ?? 'recorded boundary'}.`;
		case 'source-evidence': {
			const evaluated = numberField(data, 'evaluatedSourceCount');
			const searchOnly = numberField(data, 'searchOnlySourceCount');
			const sourceCount = numberField(data, 'sourceCount');
			const mode = stringField(data, 'mode');
			const fallback = booleanField(data, 'evaluationFallback');
			return (
				[
					evaluated !== null ? `${evaluated} evaluated` : null,
					searchOnly !== null ? `${searchOnly} search-only` : null,
					evaluated === null && searchOnly === null && sourceCount !== null
						? `${sourceCount} source-ground rows`
						: null,
					mode ? `${mode} mode` : null,
					fallback ? 'evaluation fallback' : null
				]
					.filter((part): part is string => Boolean(part))
					.join('; ') || 'Source evidence event recorded.'
			);
		}
		case 'prompt-injection': {
			const safe = booleanField(data, 'safe');
			const score = numberField(data, 'score');
			return `Prompt safety ${safe ? 'passed' : 'held'}${
				score !== null ? `; score ${score.toFixed(3)}` : ''
			}.`;
		}
		case 'message-write':
			return 'Model message-write event recorded; raw prompt and response stay internal.';
		case 'error':
			return (
				stringField(data, 'errorMessage') ?? stringField(data, 'code') ?? 'Error event recorded.'
			);
		case 'trace.end': {
			const finalPhase = stringField(data, 'finalPhase');
			return finalPhase ? `Trace ended at ${finalPhase}.` : 'Trace ended.';
		}
		default:
			return payloadKeys(payload).length > 0
				? `Event recorded with fields: ${payloadKeys(payload).join(', ')}.`
				: 'Event recorded.';
	}
}

function toReplayEvent(event: AgentTraceEvent) {
	return {
		at: event._creationTime,
		endpoint: event.endpoint,
		eventType: event.eventType,
		success: event.success ?? null,
		durationMs: event.durationMs ?? null,
		costUsd: event.costUsd ?? null,
		expiresAt: event.expiresAt,
		summary: summarizeTracePayload(event.eventType, event.payload),
		payloadKeys: payloadKeys(event.payload)
	};
}

export const GET: RequestHandler = async (event) => {
	const authenticatedUserId = requireAuthenticatedAgentRequest(event);
	if (authenticatedUserId instanceof Response) return authenticatedUserId;
	const requestEnvelope = await readBoundedAgentRequest(event, 'trace-replay');
	if (requestEnvelope instanceof Response) return requestEnvelope;

	const { cursor, traceId } = requestEnvelope;

	const secret = internalSecret();
	if (!secret) {
		return json(
			{
				error: 'Trace replay is not configured',
				code: 'agent_trace_replay_not_configured',
				dependency: 'INTERNAL_API_SECRET'
			},
			{ status: 503 }
		);
	}

	const page = (await serverQuery(api.agentTraces.listByTrace, {
		_secret: secret,
		traceId,
		cursor
	})) as {
		firstEvent: AgentTraceEvent | null;
		events: AgentTraceEvent[];
		isDone: boolean;
		continueCursor: string | null;
	};
	const events = page.events;

	const start = page.firstEvent;
	if (
		!start ||
		start.eventType !== 'trace.start' ||
		start.userId !== authenticatedUserId ||
		start.endpoint !== 'message-generation'
	) {
		return json({ error: 'Trace replay not found' }, { status: 404 });
	}

	return json({
		traceId,
		endpoint: start.endpoint,
		startedAt: start._creationTime,
		expiresAt:
			events.length > 0
				? Math.min(...events.map((traceEvent) => traceEvent.expiresAt))
				: start.expiresAt,
		eventCount: events.length,
		events: events.map(toReplayEvent),
		isDone: page.isDone,
		continueCursor: page.continueCursor
	});
};
