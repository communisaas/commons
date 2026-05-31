/**
 * Agent trace writer — persists pipeline events to Convex `agentTraces`.
 *
 * Threaded through the message-generation pipeline (and any future agent
 * pipeline) so an operator can replay a flow event-by-event from the
 * Convex database. Replaces the no-op stub that previously made the
 * trace surface look wired when nothing actually persisted.
 *
 * Posture
 * -------
 * - Fire-and-forget: every public function returns void synchronously
 *   and queues the write in the background. Persistence failures must
 *   never break the caller's flow.
 * - Off by default: `AGENT_TRACE_ENABLED=true` flips it on. Production
 *   ships with the flag off until smoke-tested.
 * - Sampling decided once per traceId — sub-1.0 rates skip the entire
 *   trace, not individual events, so flows aren't half-captured.
 * - Integrity-only credential scrub at this boundary (auth headers,
 *   OAuth tokens, API keys, the exact `_secret` arg + string-content
 *   regexes for Bearer/Basic/AWS-SigV4/AKIA/Stripe/GitHub/Google/Groq/
 *   JWT shapes). NOT a PII filter — privacy is carried by TTL +
 *   `_secret` gate on the read side.
 * - Convex 1 MiB doc cap enforced via dynamic-truncation pass that
 *   targets the largest string field first; common case is a no-op.
 * - Failure surfaces: `[agent-trace] CONFIG_ERROR` (logged once per
 *   process when INTERNAL_API_SECRET is missing/invalid — indicates a
 *   deploy gap, not transient downtime). `[agent-trace] PERSIST_FAILED`
 *   (per-call, indicates Convex transient errors). Distinct categories
 *   so operators can grep/alert appropriately.
 *
 * Env vars
 * --------
 *   AGENT_TRACE_ENABLED       'true' enables; anything else disables.
 *   AGENT_TRACE_TTL_DAYS      Integer; default 7. Convex `record` clamps
 *                             to MAX_TTL_MS (30d) defensively.
 *   AGENT_TRACE_SAMPLE_RATE   0.0-1.0; default 1.0. Decided per traceId.
 *
 * Operator commands (after deploy + ramp)
 * ---------------------------------------
 *   npx convex run agentTraces:recentByEndpoint --prod -- \
 *     '{"_secret":"$INTERNAL_API_SECRET","endpoint":"message-generation","limit":20}'
 *   npx convex run agentTraces:listByTrace --prod -- \
 *     '{"_secret":"$INTERNAL_API_SECRET","traceId":"abc-..."}'
 *   npx convex run agentTraces:findStuck --prod -- \
 *     '{"_secret":"$INTERNAL_API_SECRET","endpoint":"message-generation","olderThanMs":300000}'
 */

import { env } from '$env/dynamic/private';
import { serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';
import { getInternalSecret } from '$lib/server/internal/secret-auth';

// ============================================================================
// Config (read lazily so env changes during tests take effect)
// ============================================================================

interface TraceConfig {
	enabled: boolean;
	ttlMs: number;
	sampleRate: number;
}

const DEFAULT_TTL_DAYS = 7;
const DEFAULT_SAMPLE_RATE = 1.0;

export function getTraceConfig(): TraceConfig {
	const enabled = env.AGENT_TRACE_ENABLED === 'true';
	const rawTtl = Number.parseInt(env.AGENT_TRACE_TTL_DAYS ?? String(DEFAULT_TTL_DAYS), 10);
	const ttlDays = Number.isFinite(rawTtl) && rawTtl > 0 ? rawTtl : DEFAULT_TTL_DAYS;
	const rawSample = Number.parseFloat(env.AGENT_TRACE_SAMPLE_RATE ?? String(DEFAULT_SAMPLE_RATE));
	const sampleRate = Number.isFinite(rawSample) ? Math.max(0, Math.min(1, rawSample)) : DEFAULT_SAMPLE_RATE;
	return {
		enabled,
		ttlMs: ttlDays * 86_400_000,
		sampleRate
	};
}

// ============================================================================
// Sampling — LRU map keyed by traceId
// ============================================================================

const SAMPLE_MAP_CAP = 10_000;
const SAMPLE_DECISIONS = new Map<string, boolean>();

export function shouldSample(traceId: string, rate: number): boolean {
	if (rate >= 1) return true;
	if (rate <= 0) return false;
	const existing = SAMPLE_DECISIONS.get(traceId);
	if (existing !== undefined) {
		// Refresh recency so this traceId survives subsequent evictions.
		SAMPLE_DECISIONS.delete(traceId);
		SAMPLE_DECISIONS.set(traceId, existing);
		return existing;
	}
	const decision = Math.random() < rate;
	if (SAMPLE_DECISIONS.size >= SAMPLE_MAP_CAP) {
		// Map iteration order is insertion order in JS — first key is LRU.
		const oldest = SAMPLE_DECISIONS.keys().next().value;
		if (oldest !== undefined) SAMPLE_DECISIONS.delete(oldest);
	}
	SAMPLE_DECISIONS.set(traceId, decision);
	return decision;
}

/** Test hook — drop all sampling decisions. Not exported in the runtime path. */
export function _resetSamplingForTest(): void {
	SAMPLE_DECISIONS.clear();
}

// ============================================================================
// Credential scrub — depth-recursive, key-based
// ============================================================================

// Lower-cased for case-insensitive match. Categories:
//   Auth headers (Authorization, Proxy-Authorization, WWW-Authenticate)
//   Cookie family (Cookie, Set-Cookie, Set-Cookie2)
//   API key headers (X-API-Key, X-Auth-Token, X-Amz-Security-Token,
//                    X-Goog-Api-Key, ApiKey, Api-Key)
//   OAuth/OIDC token names (access_token, refresh_token, id_token, code)
//   Generic credential names (password, secret, token, private_key,
//                             client_secret, bearer)
//   The exact `_secret` arg used by Convex public-function gates
const CREDENTIAL_KEYS = new Set([
	'authorization',
	'proxy-authorization',
	'www-authenticate',
	'cookie',
	'set-cookie',
	'set-cookie2',
	'x-api-key',
	'x-auth-token',
	'x-amz-security-token',
	'x-goog-api-key',
	'apikey',
	'api-key',
	'access_token',
	'refresh_token',
	'id_token',
	'password',
	'secret',
	'token',
	'private_key',
	'client_secret',
	'bearer',
	'_secret'
]);

// String-content patterns for known credential shapes. Catches credentials
// that arrive embedded in error messages, stack traces, or stringified
// upstream-API response bodies — places the key-based filter cannot reach
// because the credential is inside the string, not its key.
//
// Patterns are conservative: high-prefix, fixed-shape, low false-positive.
// Order matters — more-specific patterns first so a Bearer-wrapped JWT
// resolves to the Bearer match (more readable).
const CREDENTIAL_VALUE_PATTERNS: RegExp[] = [
	/Bearer\s+[A-Za-z0-9._~+/-]{20,}/g,
	/Basic\s+[A-Za-z0-9+/=]{20,}/g,
	/AWS4-HMAC-SHA256\s+Credential=\S+/g, // AWS SigV4 (ses-proxy errors land these)
	/AKIA[0-9A-Z]{16}/g, // AWS Access Key ID
	/ASIA[0-9A-Z]{16}/g, // AWS temporary session keys
	/sk_live_[A-Za-z0-9]{20,}/g,
	/rk_live_[A-Za-z0-9]{20,}/g,
	/pk_live_[A-Za-z0-9]{20,}/g,
	/sk_test_[A-Za-z0-9]{20,}/g,
	/rk_test_[A-Za-z0-9]{20,}/g,
	/whsec_[A-Za-z0-9]{20,}/g, // Stripe webhook signing secret
	/t=\d{10},v1=[a-f0-9]{64}/g, // Stripe-Signature header value
	/ghp_[A-Za-z0-9]{36}/g, // GitHub personal access token (classic)
	/github_pat_[A-Za-z0-9_]{82}/g, // GitHub fine-grained PAT
	/gho_[A-Za-z0-9]{36}/g, // GitHub OAuth token
	/AIza[0-9A-Za-z_-]{35}/g, // Google API
	/gsk_[A-Za-z0-9]{40,}/g, // Groq
	/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{20,}/g // JWT
];

function scrubStringValue(s: string): string {
	let out = s;
	for (const re of CREDENTIAL_VALUE_PATTERNS) {
		out = out.replace(re, '[redacted-credential]');
	}
	return out;
}

const SCRUB_DEPTH_CAP = 20;

export function scrubCredentials(value: unknown, depth = 0): unknown {
	if (depth >= SCRUB_DEPTH_CAP) return value;
	if (typeof value === 'string') {
		return scrubStringValue(value);
	}
	if (Array.isArray(value)) {
		return value.map((v) => scrubCredentials(v, depth + 1));
	}
	if (value && typeof value === 'object') {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value)) {
			if (CREDENTIAL_KEYS.has(k.toLowerCase())) {
				out[k] = '[redacted]';
			} else {
				out[k] = scrubCredentials(v, depth + 1);
			}
		}
		return out;
	}
	return value;
}

// ============================================================================
// Size cap — Convex 1 MiB doc physics
// ============================================================================

const DOC_MAX_BYTES = 1_048_576; // 1 MiB
const ENVELOPE_RESERVATION = 8 * 1024; // 8 KB for traceId/userId/timestamps/etc.
const PAYLOAD_BUDGET = DOC_MAX_BYTES - ENVELOPE_RESERVATION; // ~1,040,384 bytes
const FIELD_TRUNCATE_FLOOR = 1024; // never truncate below 1 KB
const TRUNCATE_MAX_ATTEMPTS = 32;

function byteSize(s: string): number {
	return new TextEncoder().encode(s).length;
}

interface LargestStringFound {
	path: (string | number)[];
	length: number;
	value: string;
}

function findLargestString(
	value: unknown,
	depth = 0,
	path: (string | number)[] = []
): LargestStringFound | null {
	if (depth > 10) return null;
	if (typeof value === 'string') {
		return { path, length: value.length, value };
	}
	let best: LargestStringFound | null = null;
	if (Array.isArray(value)) {
		for (let i = 0; i < value.length; i++) {
			const r = findLargestString(value[i], depth + 1, [...path, i]);
			if (r && (!best || r.length > best.length)) best = r;
		}
	} else if (value && typeof value === 'object') {
		for (const [k, v] of Object.entries(value)) {
			const r = findLargestString(v, depth + 1, [...path, k]);
			if (r && (!best || r.length > best.length)) best = r;
		}
	}
	return best;
}

function setAtPath(target: unknown, path: (string | number)[], next: unknown): unknown {
	if (path.length === 0) return next;
	const [head, ...rest] = path;
	if (Array.isArray(target)) {
		const copy = [...target];
		const idx = typeof head === 'number' ? head : Number(head);
		copy[idx] = setAtPath(copy[idx], rest, next);
		return copy;
	}
	if (target && typeof target === 'object') {
		const obj = target as Record<string, unknown>;
		const key = String(head);
		return { ...obj, [key]: setAtPath(obj[key], rest, next) };
	}
	return target;
}

/**
 * Enforce Convex's 1 MiB document limit.
 *
 * Common case: payload fits, returns input unchanged.
 *
 * Pathological case: find the largest string field, truncate it. If
 * still over, repeat. After `TRUNCATE_MAX_ATTEMPTS` or when no string
 * exceeds `FIELD_TRUNCATE_FLOOR`, wrap with an overflow marker so the
 * trace still records *something* about the original payload.
 */
export function enforceConvexSizeCap(payload: unknown): unknown {
	const initial = JSON.stringify(payload);
	let size = byteSize(initial);
	if (size <= PAYLOAD_BUDGET) return payload;

	let working: unknown = payload;
	let attempts = 0;
	const originalSize = size;

	while (size > PAYLOAD_BUDGET && attempts < TRUNCATE_MAX_ATTEMPTS) {
		const largest = findLargestString(working);
		if (!largest || largest.length < FIELD_TRUNCATE_FLOOR) {
			return {
				_truncationOverflow: true,
				_originalSize: originalSize,
				_lastAttemptSize: size
			};
		}
		const overage = size - PAYLOAD_BUDGET;
		// Drop enough chars to cover overage + a 4 KB cushion to handle
		// JSON quoting overhead and avoid oscillating around the limit.
		const reduction = Math.max(overage + 4096, Math.floor(largest.length * 0.25));
		const newLength = Math.max(FIELD_TRUNCATE_FLOOR, largest.length - reduction);
		working = setAtPath(working, largest.path, {
			_truncated: true,
			_originalLength: largest.length,
			value: largest.value.slice(0, newLength)
		});
		size = byteSize(JSON.stringify(working));
		attempts++;
	}

	return working;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Mark the beginning of a pipeline run.
 * Emits `trace.start` with the full input payload.
 */
export function traceStart(
	traceId: string,
	endpoint: string,
	userId: string | undefined,
	data?: unknown
): void {
	const cfg = getTraceConfig();
	if (!cfg.enabled) return;
	if (!shouldSample(traceId, cfg.sampleRate)) return;
	queueWrite({
		traceId,
		endpoint,
		eventType: 'trace.start',
		userId,
		payload: data ?? {},
		expiresAt: Date.now() + cfg.ttlMs
	});
}

/**
 * Mark the end of a pipeline run (success or error).
 *
 * `costUsd` (when known) is hoisted to the top-level column so
 * `recentByEndpoint` summaries can show per-trace cost without joining
 * to the separate `completion` event that `traceCompletion` emits.
 * Pass `undefined` if the cost isn't known yet at trace.end time.
 */
export function traceEnd(
	traceId: string,
	endpoint: string,
	success: boolean,
	durationMs: number,
	data?: unknown,
	costUsd?: number
): void {
	const cfg = getTraceConfig();
	if (!cfg.enabled) return;
	if (!shouldSample(traceId, cfg.sampleRate)) return;
	queueWrite({
		traceId,
		endpoint,
		eventType: 'trace.end',
		payload: data ?? {},
		success,
		durationMs,
		costUsd,
		expiresAt: Date.now() + cfg.ttlMs
	});
}

/**
 * Record an event in an agent trace.
 *
 * Existing callers (source-discovery, etc.) pass `pipeline` as what we
 * now call `endpoint` and `event` as what we now call `eventType`. The
 * signature is preserved.
 */
export function traceEvent(
	traceId: string,
	pipeline: string,
	event: string,
	data?: unknown
): void {
	const cfg = getTraceConfig();
	if (!cfg.enabled) return;
	if (!shouldSample(traceId, cfg.sampleRate)) return;
	queueWrite({
		traceId,
		endpoint: pipeline,
		eventType: event,
		payload: data ?? {},
		expiresAt: Date.now() + cfg.ttlMs
	});
}

/**
 * Record an LLM completion's cost data against a trace.
 *
 * Existing caller is `llm-cost-protection.logLLMOperation`. We persist
 * a `completion` event with cost/token detail in `payload` plus the
 * top-level `success/durationMs/costUsd` summary fields.
 */
export function traceCompletion(
	traceId: string,
	operation: string,
	costData?: unknown,
	meta?: unknown
): void {
	const cfg = getTraceConfig();
	if (!cfg.enabled) return;
	if (!shouldSample(traceId, cfg.sampleRate)) return;

	const metaObj = meta && typeof meta === 'object' ? (meta as Record<string, unknown>) : {};
	const userIdRaw = metaObj.userId;
	const userId = typeof userIdRaw === 'string' ? userIdRaw : undefined;
	const durationRaw = metaObj.durationMs;
	const durationMs = typeof durationRaw === 'number' ? durationRaw : undefined;
	const successRaw = metaObj.success;
	const success = typeof successRaw === 'boolean' ? successRaw : undefined;
	const costRaw = metaObj.costUsd;
	const costUsd = typeof costRaw === 'number' ? costRaw : undefined;

	queueWrite({
		traceId,
		endpoint: 'message-generation',
		eventType: 'completion',
		userId,
		payload: { operation, costData, meta },
		success,
		durationMs,
		costUsd,
		expiresAt: Date.now() + cfg.ttlMs
	});
}

// ============================================================================
// Internal — fire-and-forget Convex write
// ============================================================================

interface WriteArgs {
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

// Misconfiguration (e.g. AGENT_TRACE_ENABLED=true but INTERNAL_API_SECRET
// missing) would otherwise log once per write — drowning out the actual
// signal. Cache the warning and emit it exactly once per process so an
// operator scanning CF Pages logs sees a single distinctive line.
let configWarned = false;

/** Test hook — re-arms the config-warned latch. */
export function _resetConfigWarnedForTest(): void {
	configWarned = false;
}

function isConfigError(err: unknown): boolean {
	if (!(err instanceof Error)) return false;
	return err.message.includes('INTERNAL_API_SECRET');
}

function queueWrite(args: WriteArgs): void {
	// Schedule the persistence in the background — explicitly do not
	// await. The promise chain must never throw out of this call site;
	// `.catch` swallows so we never reach an unhandled rejection.
	void persist(args).catch((err) => {
		console.warn('[agent-trace] persist threw outside catch:', err);
	});
}

async function persist(args: WriteArgs): Promise<void> {
	try {
		const scrubbed = scrubCredentials(args.payload);
		const sized = enforceConvexSizeCap(scrubbed);
		await serverMutation(api.agentTraces.record, {
			_secret: getInternalSecret(),
			traceId: args.traceId,
			endpoint: args.endpoint,
			eventType: args.eventType,
			userId: args.userId,
			payload: sized,
			success: args.success,
			durationMs: args.durationMs,
			costUsd: args.costUsd,
			expiresAt: args.expiresAt
		});
	} catch (err) {
		// Never throw — trace failures must not break the pipeline.
		// Distinguish config errors (one-shot, indicates deploy/secret
		// issue) from runtime errors (per-call, indicates Convex
		// downtime). The category prefix is grep-able / alertable.
		if (isConfigError(err)) {
			if (!configWarned) {
				configWarned = true;
				console.error(
					'[agent-trace] CONFIG_ERROR: AGENT_TRACE_ENABLED=true but ' +
						'INTERNAL_API_SECRET is missing or under-length. Traces will ' +
						'silently fail until this is fixed. This warning fires once ' +
						'per process; subsequent failures are suppressed.',
					{ err: err instanceof Error ? err.message : String(err) }
				);
			}
			return;
		}
		console.warn('[agent-trace] PERSIST_FAILED', {
			traceId: args.traceId,
			endpoint: args.endpoint,
			eventType: args.eventType,
			err: err instanceof Error ? err.message : String(err)
		});
	}
}
