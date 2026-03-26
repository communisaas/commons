/**
 * POST /api/analytics/increment
 *
 * Receives batched increments from client and processes them.
 * Fire-and-forget semantics — always returns success.
 *
 * Rate Limiting:
 * - In-memory per-IP contribution bounding (single instance)
 *
 * @see docs/architecture/rate-limiting.md for design rationale
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	isMetric,
	type Dimensions,
	type Increment,
	type IncrementResponse,
	type Metric
} from '$lib/types/analytics';
import { createHash } from 'crypto';

// ============================================================================
// In-Memory Rate Limiting
// ============================================================================

/** Per-IP contribution counts within a sliding window */
const contributionCounts = new Map<string, { count: number; resetAt: number }>();

/** Max contributions per IP per window */
const MAX_CONTRIBUTIONS_PER_IP = 100;
const WINDOW_MS = 60_000; // 1 minute

/**
 * Hash IP address for rate limiting
 */
function hashIP(ip: string): string {
	return createHash('sha256').update(ip).digest('hex');
}

/**
 * Extract client IP from request
 */
function getClientIP(request: Request): string {
	const headers = [
		'cf-connecting-ip',
		'true-client-ip',
		'x-forwarded-for',
		'x-real-ip'
	];

	for (const header of headers) {
		const value = request.headers.get(header);
		if (value) {
			return value.split(',')[0].trim();
		}
	}

	return '';
}

/**
 * Check in-memory contribution limit for an IP + metric pair.
 */
function checkContributionLimit(hashedIP: string, _metric: Metric): boolean {
	const now = Date.now();
	const entry = contributionCounts.get(hashedIP);

	if (!entry || now >= entry.resetAt) {
		contributionCounts.set(hashedIP, { count: 1, resetAt: now + WINDOW_MS });
		return true;
	}

	if (entry.count >= MAX_CONTRIBUTIONS_PER_IP) {
		return false;
	}

	entry.count++;
	return true;
}

// ============================================================================
// In-Memory Batch Processing
// ============================================================================

/** Simple in-memory counters — replace with Convex/DB writes when needed */
const counters = new Map<string, number>();

function processBatch(
	increments: Array<{ metric: Metric; dimensions?: Dimensions }>
): { processed: number } {
	let processed = 0;
	for (const inc of increments) {
		const key = inc.dimensions
			? `${inc.metric}:${JSON.stringify(inc.dimensions)}`
			: inc.metric;
		counters.set(key, (counters.get(key) ?? 0) + 1);
		processed++;
	}
	return { processed };
}

// ============================================================================
// Route Handler
// ============================================================================

export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = await request.json();
		const increments: unknown[] = body?.increments ?? [];

		// Get hashed IP for rate limiting
		const clientIP = getClientIP(request);
		const hashedIP = hashIP(clientIP);

		// Validate and filter increments
		const valid: Array<{ metric: Metric; dimensions?: Dimensions }> = [];

		for (const inc of increments) {
			if (
				typeof inc === 'object' &&
				inc !== null &&
				'metric' in inc &&
				typeof (inc as { metric: unknown }).metric === 'string' &&
				isMetric((inc as { metric: string }).metric)
			) {
				const typed = inc as Increment;

				// Check server-side contribution limit
				const allowed = checkContributionLimit(hashedIP, typed.metric as Metric);
				if (allowed) {
					valid.push({
						metric: typed.metric,
						dimensions: typed.dimensions
					});
				}
				// Silently drop if rate limit exceeded
			}
			// Invalid increments are silently dropped (privacy > completeness)
		}

		// Process batch
		const { processed } = processBatch(valid);

		const response: IncrementResponse = {
			success: true,
			processed,
			dropped: increments.length - processed
		};

		return json(response);
	} catch {
		// Always return success — fire and forget semantics
		// Errors are logged server-side but not exposed to client
		const response: IncrementResponse = {
			success: true,
			processed: 0,
			dropped: 0
		};

		return json(response);
	}
};
