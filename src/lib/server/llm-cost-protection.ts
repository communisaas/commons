/**
 * LLM Cost Protection System
 *
 * Defense-in-depth rate limiting for expensive AI operations.
 * Implements trust tiers that scale with user accountability.
 *
 * Philosophy: A civic engagement app should welcome exploration
 * but require accountability for expensive operations. Users
 * earn capacity through trust signals (auth, verification).
 *
 * Trust Tiers:
 * - Guest: Paid model work is disabled until a globally coordinated admission
 *   boundary exists
 * - Authenticated: Reasonable quotas for genuine use
 * - Verified: Higher limits for proven constituents
 *
 * Dollar telemetry is an estimate, not a billing authority. Public work stays
 * inside the shared free-plan envelope; organization capacity is admitted only
 * against the balance minted by a settled subscription payment.
 */

import { rateLimiter } from './rate-limiter';
import type { RequestEvent } from '@sveltejs/kit';
import {
	reservePaidProviderBudget,
	type PaidOrgProviderGrant,
	type PaidProviderBudgetResult
} from '$lib/server/paid-provider-budget-client';
import {
	paidProviderBudgetPolicyFor,
	type PaidProviderBudgetScope,
	type PaidProviderTrustTier
} from '$lib/server/paid-provider-budget-policy';
import { paidProviderOperatorConfigured } from '$lib/server/paid-provider-runtime-readiness';

// ============================================
// Trust Tier Definitions
// ============================================

export type LLMTrustTier = 'guest' | 'authenticated' | 'verified';

/**
 * Quota configuration per operation and trust tier
 *
 * Format: [requests, windowMs]
 * Window is in milliseconds (1 hour = 3600000)
 */
/**
 * COGS-protective rate limits, NOT revenue gates.
 * See docs/strategy/monetization-policy.md for rationale.
 *
 * Calibrated against real civic engagement data:
 * - Resistbot lifetime avg: 5 letters/user (50M letters / 10M users)
 * - M+R Benchmarks: 0.13 advocacy actions/subscriber/year
 * - 15 ops/day verified = ~5 letters/day, covers 99%+ of real usage
 * - Worst-case COGS: 15 ops/day * $0.22 = $3.30/day per verified user
 *
 * Verification is the upgrade path, not payment. Production admissions are
 * serialized by one SQLite Durable Object; the local limiter is development
 * defense-in-depth only.
 */
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

// ============================================
// Trust Tier Resolution
// ============================================

interface UserContext {
	userId: string | null;
	isAuthenticated: boolean;
	isVerified: boolean;
	tier: LLMTrustTier;
	providerTier?: PaidProviderTrustTier;
	identifier: string; // For rate limit key (userId or IP)
}

function isPaidProviderOperator(event: RequestEvent, userId: string | null): boolean {
	return paidProviderOperatorConfigured(event.platform?.env, userId);
}

/**
 * Extract user context from request event
 *
 * Determines trust tier based on:
 * 1. Authentication status (session exists)
 * 2. Verification status (identity verified via SELF/government ID)
 *
 * SECURITY: Uses SvelteKit's getClientAddress() which respects adapter trust proxy
 * settings, NOT raw x-forwarded-for header (which is attacker-controlled).
 */
export function getUserContext(event: RequestEvent): UserContext {
	const session = event.locals.session;
	const userId = session?.userId || null;

	// SECURITY FIX: Use SvelteKit's trusted client address extraction.
	// Falls back to CF/proxy headers only if truly unavailable.
	let ip: string;
	try {
		ip = event.getClientAddress();
	} catch {
		// getClientAddress() can throw if not available (e.g., in tests)
		// Fall back to platform-specific headers in priority order
		const headers = event.request.headers;
		ip =
			headers.get('cf-connecting-ip') || // Cloudflare's trusted header
			headers.get('x-real-ip') || // Common reverse proxy header
			'unknown';
	}

	// Check verification status from graduated trust tier model
	// Tier 2+ (address-attested) qualifies for verified quotas
	const user = event.locals.user;
	const isVerified = (user?.trust_tier ?? 0) >= 2;

	const isAuthenticated = !!userId;

	let tier: LLMTrustTier = 'guest';
	if (isVerified) {
		tier = 'verified';
	} else if (isAuthenticated) {
		tier = 'authenticated';
	}

	return {
		userId,
		isAuthenticated,
		isVerified,
		tier,
		providerTier: isPaidProviderOperator(event, userId)
			? 'operator'
			: tier === 'verified'
				? 'verified'
				: 'authenticated',
		identifier: userId || `ip:${ip}`
	};
}

// ============================================
// Rate Limit Check
// ============================================

export interface RateLimitCheck {
	allowed: boolean;
	remaining: number;
	limit: number;
	resetAt: Date;
	tier: LLMTrustTier;
	reason?: string;
	status?: 429 | 503;
	providerCeiling?: PaidProviderBudgetResult['providerCeiling'];
	/** Whose capacity ran out — only ever set where the limiter measured it. */
	budgetScope?: PaidProviderBudgetScope;
}

/**
 * Check if user is allowed to perform an operation
 *
 * @param operation - Operation type (subject-line, decision-makers, etc.)
 * @param context - User context from getUserContext()
 * @returns Rate limit check result
 */
export async function checkRateLimit(
	operation: string,
	context: UserContext
): Promise<RateLimitCheck> {
	const policyTier: PaidProviderTrustTier =
		context.providerTier ?? (context.tier === 'verified' ? 'verified' : 'authenticated');
	const reviewed = paidProviderBudgetPolicyFor(operation, policyTier);

	if (!reviewed) {
		// SECURITY FIX: Fail CLOSED for unknown operations
		// This prevents typos or new endpoints from bypassing rate limiting
		console.error(`[LLM-Protection] BLOCKED: Unknown operation "${operation}" - failing closed`);
		return {
			allowed: false,
			remaining: 0,
			limit: 0,
			resetAt: new Date(Date.now() + 3600000),
			tier: context.tier,
			reason: `Operation "${operation}" is not configured for rate limiting. Contact support.`
		};
	}

	const max = context.tier === 'guest' ? 0 : reviewed.hourlyReservations;
	const windowMs = HOUR_MS;

	// Zero quota = blocked for this tier
	if (max === 0) {
		return {
			allowed: false,
			remaining: 0,
			limit: 0,
			resetAt: new Date(Date.now()),
			tier: context.tier,
			reason: getBlockedReason(operation, context.tier),
			// These fallback limiters are keyed on this caller's own identifier, so
			// naming the actor here is a measurement rather than a default.
			budgetScope: 'actor'
		};
	}

	// Check operation-specific limit
	const key = `llm:${operation}:${context.identifier}`;
	const result = await rateLimiter.limit(key, max, windowMs);

	// Short-circuit: don't consume daily token if operation already rejected
	if (!result.success) {
		return {
			allowed: false,
			remaining: 0,
			limit: max,
			resetAt: new Date(result.reset),
			tier: context.tier,
			reason: getRateLimitReason(operation, context.tier, result, { success: true, reset: 0 }),
			budgetScope: 'actor'
		};
	}

	// Local development fallback. Production uses the Durable Object path in
	// enforceLLMRateLimit so operation + actor-day + platform caps are one atomic
	// reservation. Payment never raises this abuse/cost ceiling: a published-
	// template cap cannot bound regenerations or abandoned provider calls.
	const dailyQuota: [number, number] = [reviewed.actorDailyReservations, DAY_MS];
	const dailyKey = `llm:daily:${context.identifier}`;
	const dailyResult = await rateLimiter.limit(dailyKey, dailyQuota[0], dailyQuota[1]);

	// Use the more restrictive of the two
	const allowed = dailyResult.success;
	const remaining = Math.min(result.remaining, dailyResult.remaining);

	// When daily limit trips, show daily reset time (not operation reset)
	const effectiveResetAt = !dailyResult.success
		? new Date(dailyResult.reset)
		: new Date(result.reset);

	return {
		allowed,
		remaining,
		limit: max,
		resetAt: effectiveResetAt,
		tier: context.tier,
		reason: allowed ? undefined : getRateLimitReason(operation, context.tier, result, dailyResult),
		budgetScope: allowed ? undefined : 'actor'
	};
}

/**
 * Get human-readable reason for blocked operation
 */
function getBlockedReason(operation: string, tier: LLMTrustTier): string {
	if (tier === 'guest') {
		switch (operation) {
			case 'decision-makers':
				return 'Finding decision-makers requires an account. Sign in to continue.';
			case 'message-generation':
				return 'Generating messages requires an account. Sign in to continue.';
			default:
				return 'This action requires an account.';
		}
	}
	return 'This action is not available for your account type.';
}

/**
 * Get human-readable reason for rate limit exceeded
 */
function getRateLimitReason(
	operation: string,
	tier: LLMTrustTier,
	opResult: { success: boolean; reset: number },
	dailyResult: { success: boolean; reset: number }
): string {
	const verifyHint = tier === 'authenticated' ? ' Verify your identity for higher limits.' : '';

	if (!dailyResult.success) {
		const resetTime = new Date(dailyResult.reset).toLocaleTimeString();
		return `Daily limit reached. Resets at ${resetTime}.${verifyHint}`;
	}

	const resetTime = new Date(opResult.reset).toLocaleTimeString();

	switch (operation) {
		case 'subject-line':
			return `Subject line limit reached. Try again after ${resetTime}.${verifyHint}`;
		case 'decision-makers':
			return `Decision-maker lookup limit reached. Try again after ${resetTime}.${verifyHint}`;
		case 'message-generation':
			return `Message generation limit reached. Try again after ${resetTime}.${verifyHint}`;
		default:
			return `Rate limit exceeded. Try again after ${resetTime}.${verifyHint}`;
	}
}

// ============================================
// Middleware Helper
// ============================================

/**
 * Check rate limit for an operation.
 *
 * ```typescript
 * const check = await enforceLLMRateLimit(event, 'decision-makers');
 * if (!check.allowed) return rateLimitResponse(check);
 * ```
 */
/**
 * Check rate limit and return the result.
 *
 * Does NOT throw — returns the check so the caller can build a proper
 * Response with the full JSON body (tier, resetAt, etc.) instead of
 * relying on SvelteKit's error() which strips extra fields.
 */
export async function enforceLLMRateLimit(
	event: RequestEvent,
	operation: string,
	paidOrg?: PaidOrgProviderGrant
): Promise<RateLimitCheck> {
	const context = getUserContext(event);
	let check: RateLimitCheck;
	if (context.tier === 'guest') {
		check = await checkRateLimit(operation, context);
	} else if (event.platform?.env !== undefined || process.env.NODE_ENV === 'production') {
		const reservation = await reservePaidProviderBudget({
			event,
			identifier: context.identifier,
			operation,
			tier: context.providerTier ?? (context.tier === 'verified' ? 'verified' : 'authenticated'),
			paidOrg
		});
		check = {
			allowed: reservation.allowed,
			remaining: reservation.remaining,
			limit: reservation.limit,
			resetAt: reservation.resetAt,
			tier: context.tier,
			reason: reservation.reason,
			providerCeiling: reservation.providerCeiling,
			budgetScope: reservation.budgetScope,
			...(reservation.status === 200 ? {} : { status: reservation.status })
		};
	} else {
		check = await checkRateLimit(operation, context);
	}

	if (!check.allowed) {
		console.debug(`[LLM-Protection] Rate limit blocked: ${operation} for ${context.identifier}`);
	} else {
		console.debug(
			`[LLM-Protection] Allowed: ${operation} for ${context.identifier} (${check.remaining}/${check.limit} remaining)`
		);
	}

	return check;
}

/**
 * Build a 429 JSON response from a failed rate-limit check.
 * Includes tier, resetAt, and remaining so the frontend can
 * distinguish guest-blocked from authenticated-rate-limited.
 */
export function rateLimitResponse(check: RateLimitCheck): Response {
	return new Response(
		JSON.stringify({
			error: check.reason || 'Rate limit exceeded',
			tier: check.tier,
			remaining: check.remaining,
			limit: check.limit,
			resetAt: check.resetAt.toISOString(),
			// Never `?? 'actor'`: an unmeasured denial must not be reported to a
			// person as capacity they spent themselves.
			budgetScope: check.budgetScope ?? 'blocked'
		}),
		{
			status: check.status ?? 429,
			headers: { 'Content-Type': 'application/json' }
		}
	);
}

/**
 * Add rate limit headers to response
 *
 * Call after successful operation to inform client of remaining quota
 */
export function addRateLimitHeaders(headers: Headers, check: RateLimitCheck): void {
	headers.set('X-RateLimit-Limit', String(check.limit));
	headers.set('X-RateLimit-Remaining', String(check.remaining));
	headers.set('X-RateLimit-Reset', check.resetAt.toISOString());
	headers.set('X-RateLimit-Tier', check.tier);
}

// ============================================
// Cost Tracking
// ============================================

import type { TokenUsage, ExternalApiCounts, CostBreakdown } from '$lib/core/agents/types';
import { emptyExternalCounts } from '$lib/core/agents/types';
import { traceCompletion } from '$lib/server/agent-trace';

/**
 * Canonical pricing — single source of truth.
 * Update this table when provider prices change; all cost calculations follow.
 */
export const API_PRICING = {
	gemini: {
		inputPer1M: 0.5,
		outputPer1M: 3.0,
		thinkingPer1M: 3.0 // thinking tokens billed at output rate
	},
	exa: { searchPer1K: 7.0, contentsPerPage: 0.001 },
	// Firecrawl Free has no pay-per-use: credits are the governing meter.
	firecrawl: { freePlanUsdPerCredit: 0 },
	grounding: { searchPer1K: 14.0, freeMonthly: 5000 },
	// Groq dollar cost is zero only under the required Free-plan, billing-disabled, no-PAYG posture.
	groq: { freePlanModerationPerCall: 0 }
} as const;

/**
 * Compute full cost breakdown from token counts + external API counts.
 *
 * Gemini 3 Flash Preview pricing:
 * - Input:    $0.50 per 1M tokens
 * - Output:   $3.00 per 1M tokens (candidatesTokens, EXCLUSIVE of thinking)
 * - Thinking: $3.00 per 1M tokens (thoughtsTokens, separate counter)
 *
 * Returns undefined if no data is available.
 */
export function computeCostUsd(
	tokenUsage?: TokenUsage,
	externalCounts?: ExternalApiCounts
): CostBreakdown | undefined {
	if (!tokenUsage && !externalCounts) return undefined;

	const ext = externalCounts ?? emptyExternalCounts();

	const geminiInput = tokenUsage
		? (tokenUsage.promptTokens / 1_000_000) * API_PRICING.gemini.inputPer1M
		: 0;
	const geminiOutput = tokenUsage
		? (tokenUsage.candidatesTokens / 1_000_000) * API_PRICING.gemini.outputPer1M
		: 0;
	const geminiThinking = tokenUsage?.thoughtsTokens
		? (tokenUsage.thoughtsTokens / 1_000_000) * API_PRICING.gemini.thinkingPer1M
		: 0;
	const exaSearch = (ext.exaSearches / 1000) * API_PRICING.exa.searchPer1K;
	// `firecrawlReads` is also the maximum number of Exa contents fallback
	// pages. Counting every read as a fallback is deliberately conservative.
	const exaContents = ext.firecrawlReads * API_PRICING.exa.contentsPerPage;
	const firecrawlRead = ext.firecrawlReads * API_PRICING.firecrawl.freePlanUsdPerCredit;
	const groundingSearch = (ext.groundingSearches / 1000) * API_PRICING.grounding.searchPer1K;
	const groqModeration = ext.groqModerations * API_PRICING.groq.freePlanModerationPerCall;

	return {
		tokenUsage,
		externalCounts: ext,
		totalCostUsd:
			geminiInput +
			geminiOutput +
			geminiThinking +
			exaSearch +
			exaContents +
			firecrawlRead +
			groundingSearch +
			groqModeration,
		components: {
			geminiInput,
			geminiOutput,
			geminiThinking,
			exaSearch,
			exaContents,
			firecrawlRead,
			groundingSearch,
			groqModeration
		}
	};
}

/**
 * Log LLM operation with real token usage and persist cost via trace system.
 */
export function logLLMOperation(
	operation: string,
	context: UserContext,
	details: {
		durationMs: number;
		success: boolean;
		tokenUsage?: TokenUsage;
		externalCounts?: ExternalApiCounts;
	},
	traceId?: string
): void {
	const breakdown = computeCostUsd(details.tokenUsage, details.externalCounts);

	console.log(`[LLM-Cost] ${operation}`, {
		user: context.identifier,
		tier: context.tier,
		durationMs: details.durationMs,
		success: details.success,
		...(details.tokenUsage && {
			inputTokens: details.tokenUsage.promptTokens,
			outputTokens: details.tokenUsage.candidatesTokens,
			thinkingTokens: details.tokenUsage.thoughtsTokens ?? 0,
			totalTokens: details.tokenUsage.totalTokens
		}),
		...(details.externalCounts && {
			exaSearches: details.externalCounts.exaSearches,
			firecrawlReads: details.externalCounts.firecrawlReads,
			firecrawlCredits: details.externalCounts.firecrawlReads,
			groundingSearches: details.externalCounts.groundingSearches,
			groqModerations: details.externalCounts.groqModerations
		}),
		costUsd: breakdown ? `$${breakdown.totalCostUsd.toFixed(6)}` : 'no token data',
		costBasis:
			'estimate: Gemini/Exa list prices; every provider requires Free-plan, billing-disabled, no-PAYG posture'
	});

	// Persist to agent_trace (fire-and-forget) — always write when traceId exists,
	// even without cost data, so completion traces are never silently dropped.
	if (traceId) {
		traceCompletion(
			traceId,
			operation,
			{ components: breakdown?.components, externalCounts: breakdown?.externalCounts },
			{
				userId: context.userId,
				durationMs: details.durationMs,
				success: details.success,
				costUsd: breakdown?.totalCostUsd,
				inputTokens: details.tokenUsage?.promptTokens,
				outputTokens: details.tokenUsage?.candidatesTokens,
				thoughtsTokens: details.tokenUsage?.thoughtsTokens,
				totalTokens: details.tokenUsage?.totalTokens
			}
		);
	}
}
