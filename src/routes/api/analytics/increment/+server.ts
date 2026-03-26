// CONVEX: Keep SvelteKit — fire-and-forget analytics with IP-based rate limiting (hashed IP,
// in-memory or Postgres), batch processing via processBatch/checkContributionLimit.
// No matching Convex function — analytics pipeline is SvelteKit-native.
/**
 * POST /api/analytics/increment
 *
 * Receives batched increments from client and processes them.
 * Fire-and-forget semantics — always returns success.
 *
 * Rate Limiting:
 * - Default: In-memory rate limiting (single instance)
 * - With RATE_LIMIT_USE_DB=true: Postgres-based (multi-instance)
 *
 * @see docs/architecture/rate-limiting.md for design rationale
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { processBatch, checkContributionLimit } from '$lib/core/analytics/aggregate';
import {
	checkContributionLimitHybrid,
	isDBRateLimitEnabled
} from '$lib/core/analytics/rate-limit-db';
import {
	isMetric,
	type Dimensions,
	type Increment,
	type IncrementResponse,
	type Metric
} from '$lib/types/analytics';
import { createHash } from 'crypto';

/**
 * Hash IP address for rate limiting
 *
 * @param ip - Client IP address
 * @returns SHA-256 hash of IP (hex string)
 */
function hashIP(ip: string): string {
	return createHash('sha256').update(ip).digest('hex');
}

/**
 * Extract client IP from request
 *
 * @param request - SvelteKit request object
 * @returns Client IP address
 */
function getClientIP(request: Request): string {
	// Check common proxy headers (in order of preference — Cloudflare-set headers first)
	const headers = [
		'cf-connecting-ip', // Cloudflare (cannot be spoofed by client)
		'true-client-ip', // Cloudflare Enterprise
		'x-forwarded-for', // Standard proxy header
		'x-real-ip' // Nginx proxy
	];

	for (const header of headers) {
		const value = request.headers.get(header);
		if (value) {
			// x-forwarded-for can contain multiple IPs, take the first one
			return value.split(',')[0].trim();
		}
	}

	// Fallback to empty string if no IP found
	return '';
}

/**
 * Check rate limit using appropriate implementation
 *
 * Uses Postgres-based rate limiting when RATE_LIMIT_USE_DB=true,
 * otherwise falls back to in-memory rate limiting.
 *
 * @param hashedIP - SHA-256 hash of client IP
 * @param metric - Metric being incremented
 * @returns true if contribution is allowed
 */
async function checkRateLimit(hashedIP: string, metric: Metric): Promise<boolean> {
	if (isDBRateLimitEnabled()) {
		// Postgres-based: works across multiple instances
		const result = await checkContributionLimitHybrid(hashedIP, metric);
		return result.allowed;
	} else {
		// In-memory: fast but single-instance only
		return checkContributionLimit(hashedIP, metric);
	}
}

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

				// Check server-side contribution limit (in-memory or Postgres based on flag)
				const allowed = await checkRateLimit(hashedIP, typed.metric as Metric);
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
		const { processed } = await processBatch(valid);

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
