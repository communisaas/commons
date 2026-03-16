import { dev } from '$app/environment';
import * as auth from '$lib/core/auth/auth.js';
import type { Handle } from '@sveltejs/kit';
import { error } from '@sveltejs/kit';
import {
	getRateLimiter,
	findRateLimitConfig,
	createRateLimitHeaders,
	SlidingWindowRateLimiter
} from '$lib/core/security/rate-limiter';
import { createRequestClient, runWithDb } from '$lib/core/db';
import { deriveTrustTier } from '$lib/core/identity/authority-level';
import { trackForRejection } from '$lib/services/rejectionMonitor';
import { setCIDs } from '$lib/core/shadow-atlas/ipfs-store';

// MongoDB removed — intelligence data now lives in Postgres via pgvector

// On Cloudflare Workers, process.env is empty. Secrets are only available
// via event.platform.env. This shim copies them to process.env once so that
// the ~90 call sites using process.env.XXX work without modification.
let envShimApplied = false;
const handlePlatformEnv: Handle = async ({ event, resolve }) => {
	if (!envShimApplied && event.platform?.env) {
		for (const [key, value] of Object.entries(event.platform.env as Record<string, unknown>)) {
			if (typeof value === 'string') {
				process.env[key] = value;
			}
		}
		envShimApplied = true;

		// Wire IPFS CIDs from env vars so Shadow Atlas reads go live.
		// Quarterly CID updates are automated by push-cids.ts — no manual wrangler needed.
		setCIDs({
			root: process.env.IPFS_CID_ROOT || '',
			merkleSnapshot: process.env.IPFS_CID_MERKLE_SNAPSHOT || '',
		});
	}
	// Initialize per-request PrismaClient with Hyperdrive connection.
	// On Workers, Hyperdrive provides a local connection string to its pool.
	// In dev, wrangler.toml's localConnectionString populates Hyperdrive but
	// points to a local DB that may not exist — prefer DIRECT_URL from .env.
	const hyperdrive = dev ? undefined : event.platform?.env?.HYPERDRIVE;
	const connectionString = hyperdrive?.connectionString || process.env.DIRECT_URL || process.env.DATABASE_URL || '';
	const client = createRequestClient(connectionString);

	// Wrap the entire request in AsyncLocalStorage so all `db.xxx()` calls
	// throughout the request lifecycle resolve to this per-request client.
	return runWithDb(client, () => resolve(event));
};

const handleAuth: Handle = async ({ event, resolve }) => {
	try {
		const sessionId = event.cookies.get(auth.sessionCookieName);
		if (!sessionId) {
			event.locals.user = null;
			event.locals.session = null;
			return resolve(event);
		}

		const { session, user } = await auth.validateSession(sessionId);
		if (session) {
			event.cookies.set(auth.sessionCookieName, session.id, {
				path: '/',
				sameSite: 'lax',
				httpOnly: true,
				expires: session.expiresAt,
				secure: !dev
			});
		} else {
			event.cookies.delete(auth.sessionCookieName, { path: '/' });
		}

		event.locals.user = user
			? {
					id: user.id,
					email: user.email,
					name: user.name,
					avatar: user.avatar,
					// Verification status
					is_verified: user.is_verified,
					verification_method: user.verification_method ?? null,
					verified_at: user.verified_at ?? null,
					// Graduated trust - derived from user verification state
					trust_tier: deriveTrustTier({
						passkey_credential_id: user.passkey_credential_id,
						district_verified: user.district_verified,
						address_verified_at: user.address_verified_at,
						identity_commitment: user.identity_commitment,
						document_type: user.document_type,
						trust_score: user.trust_score
					}),
					// Passkey (security upgrade within Tier 1)
					passkey_credential_id: user.passkey_credential_id ?? null,
					// did:key from WebAuthn public key
					did_key: user.did_key ?? null,
					// Cryptographic identity commitment (Semaphore/ZK)
					identity_commitment: user.identity_commitment ?? null,
					// Privacy-preserving district (hash only, no PII)
					district_hash: user.district_hash ?? null,
					district_verified: user.district_verified ?? false,
					// Profile fields
					role: user.role ?? null,
					organization: user.organization ?? null,
					location: user.location ?? null,
					connection: user.connection ?? null,
					profile_completed_at: user.profile_completed_at ?? null,
					profile_visibility: user.profile_visibility ?? 'private',
					// Reputation
					trust_score: user.trust_score ?? 0,
					reputation_tier: user.reputation_tier ?? 'novice',
					// Wallet integration
					wallet_address: user.wallet_address ?? null,
					wallet_type: user.wallet_type ?? null,
					near_account_id: user.near_account_id ?? null,
					near_derived_scroll_address: user.near_derived_scroll_address ?? null,
					// Timestamps
					createdAt: user.createdAt,
					updatedAt: user.updatedAt
				}
			: null;
		event.locals.session = session;

		return resolve(event);
	} catch (error) {
		// Transient error (DB unreachable, Hyperdrive hiccup, etc.)
		// CRITICAL: Do NOT delete the session cookie here. The session may still
		// be valid — we just couldn't verify it right now. Deleting the cookie
		// would permanently log out the user due to a temporary glitch.
		// Proceed without auth; endpoints handle unauthenticated state gracefully.
		console.error('[Hooks] Session validation error (transient):', {
			path: event.url.pathname,
			error: error instanceof Error ? error.message : String(error)
		});
		event.locals.user = null;
		event.locals.session = null;
		return resolve(event);
	}
};

/**
 * BA-010: Defense-in-depth CSRF protection for sensitive identity endpoints.
 *
 * SvelteKit's built-in csrf.checkOrigin (enabled in svelte.config.js) already
 * rejects non-GET requests with a mismatched Origin header. This handle adds
 * an additional layer specifically for identity verification endpoints:
 *
 * 1. Logs CSRF-relevant metadata on sensitive identity POST requests for audit.
 * 2. Explicitly validates that browser-originated requests to identity endpoints
 *    carry a same-origin Origin header (redundant with SvelteKit's check, but
 *    provides an explicit security boundary if the framework default is ever
 *    changed or bypassed).
 * 3. Validates same-origin for all sensitive identity endpoints.
 */
const SENSITIVE_IDENTITY_PATHS = [
	'/api/identity/store-blob',
	'/api/identity/delete-blob',
	'/api/identity/verify-mdl',
	'/api/auth/passkey/register',
	'/api/auth/passkey/authenticate',
	'/api/location/resolve',
	'/api/wallet/connect',
	'/api/wallet/near/sponsor'
];

const handleCsrfGuard: Handle = async ({ event, resolve }) => {
	const { request, url } = event;
	const method = request.method;
	const pathname = url.pathname;

	// Only check non-GET/HEAD/OPTIONS methods
	if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
		return resolve(event);
	}

	// Check if this is a sensitive identity endpoint
	const isSensitive = SENSITIVE_IDENTITY_PATHS.some((p) => pathname.startsWith(p));
	if (!isSensitive) {
		return resolve(event);
	}

	// Validate Origin header for sensitive identity endpoints
	const origin = request.headers.get('origin');
	if (origin) {
		const expectedOrigin = url.origin;
		if (origin !== expectedOrigin) {
			console.error(
				`[CSRF] Blocked cross-origin ${method} to ${pathname}. ` +
					`Origin: ${origin}, Expected: ${expectedOrigin}`
			);
			throw error(403, 'Cross-origin requests to identity endpoints are forbidden');
		}
	}

	// If no Origin header at all on a sensitive endpoint, this is suspicious
	// for browser requests (browsers always send Origin on POST). Server-to-server
	// calls won't have Origin. SvelteKit's checkOrigin handles this case, but
	// we log it for audit visibility.
	if (!origin && isSensitive) {
		console.warn(
			`[CSRF] ${method} to sensitive path ${pathname} without Origin header. ` +
				`This is expected for server-to-server calls but suspicious for browser requests.`
		);
	}

	return resolve(event);
};

// Add cross-origin isolation + security headers for ZK proving
const handleSecurityHeaders: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);

	// Set COOP/COEP headers for all responses (SharedArrayBuffer support for ZK proving)
	response.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
	response.headers.set('Cross-Origin-Embedder-Policy', 'require-corp');

	// CSP is now managed by SvelteKit's kit.csp in svelte.config.js.
	// SvelteKit auto-injects nonces for its inline scripts (mode: 'auto').

	return response;
};

// Compose multiple handles using SvelteKit's sequence
import { sequence } from '@sveltejs/kit/hooks';

/**
 * BA-014: Sliding Window Rate Limiting for API Endpoints
 *
 * IMPLEMENTED (2026-02-02):
 *
 * Uses sliding window log algorithm from '$lib/core/security/rate-limiter'.
 * Supports Redis backend for production (set REDIS_URL environment variable).
 *
 * PROTECTED ENDPOINTS:
 *
 *   Priority | Path Prefix               | Limit        | Key Strategy | Threat Mitigated
 *   ---------+---------------------------+--------------+--------------+------------------------------------------
 *   P1       | /api/identity/            | 10 req/min   | IP           | Brute-force verification, QR spam
 *   P1       | /api/shadow-atlas/register| 5 req/min    | User         | Shadow Atlas registration abuse
 *   P1       | /api/legislative/submit   | 3 req/hour   | User         | Legislative submission spam
 *   P2       | /api/submissions/         | 5 req/min    | IP           | CWC submission spam
 *
 * ALGORITHM: Sliding Window Log
 *   - More accurate than fixed windows (no burst at boundaries)
 *   - Maintains timestamps of requests within window
 *   - O(n) time, O(n) space where n = max requests
 *
 * STORAGE BACKENDS:
 *   - Development: In-memory Map (zero config)
 *   - Production: Redis (REDIS_URL environment variable)
 *
 * RESPONSE HEADERS (RFC 6585 compliant):
 *   - X-RateLimit-Limit: Maximum requests per window
 *   - X-RateLimit-Remaining: Requests remaining in current window
 *   - X-RateLimit-Reset: Unix timestamp when window resets
 *   - Retry-After: Seconds to wait (only on 429)
 *
 * DESIGN NOTES:
 *   - Runs FIRST in the sequence to reject abusive requests early
 *   - Applies to mutating methods by default (POST, PUT, PATCH, DELETE)
 *   - Routes with `includeGet: true` also rate-limit GET requests (e.g., metrics, confirmation)
 *   - Webhook paths are exempted (server-to-server, HMAC-authenticated)
 *   - User-keyed limits fall back to IP when no session exists
 */

const handleRateLimit: Handle = async ({ event, resolve }) => {
	const { request, url, locals } = event;
	const method = request.method;
	const pathname = url.pathname;

	// Bypass rate limiting for demo user
	if (locals.user?.id === 'user-seed-1') {
		return resolve(event);
	}

	// Skip HEAD/OPTIONS entirely
	if (method === 'HEAD' || method === 'OPTIONS') {
		return resolve(event);
	}

	// Find matching rate limit config
	const config = findRateLimitConfig(pathname);
	if (!config) {
		// No rate limit configured for this path
		return resolve(event);
	}

	// Skip GET unless this route explicitly includes GET rate limiting
	if (method === 'GET' && !config.includeGet) {
		return resolve(event);
	}

	// Get client IP for rate limiting
	// Note: event.getClientAddress() respects X-Forwarded-For behind reverse proxies
	const clientIP = event.getClientAddress();

	// Get user ID if available and config requires user-based limiting
	// Note: Session may not be available yet (rate limit runs before auth)
	// For user-based limits, we need to peek at the session cookie
	let userId: string | undefined;
	if (config.keyStrategy === 'user') {
		// Try to get user from locals (if auth already ran) or session cookie
		userId = locals.session?.userId;

		// If no user ID for a user-keyed limit, fall back to IP
		// This handles unauthenticated requests to protected endpoints
		if (!userId) {
			console.warn(
				`[RateLimit] User-keyed limit for ${pathname} but no session, falling back to IP`
			);
		}
	}

	// Generate rate limit key
	const key = SlidingWindowRateLimiter.generateKey(config, clientIP, userId);

	// Check rate limit using sliding window algorithm
	const rateLimiter = getRateLimiter();
	const result = await rateLimiter.check(key, {
		maxRequests: config.maxRequests,
		windowMs: config.windowMs
	});

	if (!result.allowed) {
		// Rate limit exceeded - return 429 with standard headers
		const windowDescription =
			config.windowMs >= 3600000
				? `${config.windowMs / 3600000} hour(s)`
				: `${config.windowMs / 1000} seconds`;

		console.warn(
			`[RateLimit] Blocked ${method} ${pathname} from ${userId ? `user:${userId}` : `ip:${clientIP}`}. ` +
				`Limit: ${result.limit} req/${windowDescription}, Retry in: ${result.retryAfter}s`
		);

		// Create rate limit headers
		const headers = createRateLimitHeaders(result);

		// Return 429 with headers
		return new Response(
			JSON.stringify({
				error: 'Too many requests',
				message: `Rate limit exceeded. Please try again in ${result.retryAfter} seconds.`,
				retryAfter: result.retryAfter
			}),
			{
				status: 429,
				headers: {
					'Content-Type': 'application/json',
					...headers
				}
			}
		);
	}

	// Request allowed - continue and add rate limit headers to response
	const response = await resolve(event);

	// Add rate limit headers to successful responses
	const headers = createRateLimitHeaders(result);
	for (const [name, value] of Object.entries(headers)) {
		response.headers.set(name, value);
	}

	return response;
};

/**
 * BA-018: Rejection Rate Monitoring
 *
 * Tracks rejection rates for debate/position/submission endpoints.
 * Runs LAST in the sequence — observes the final response status.
 * Uses waitUntil() for async KV writes — zero impact on response latency.
 *
 * Configuration (environment variables):
 *   REJECTION_MONITOR_WEBHOOK_URL  - Webhook URL for threshold alerts
 *   REJECTION_THRESHOLD_PERCENT    - Alert threshold (default: 1%)
 */
const handleRejectionMonitoring: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);

	const pathname = event.url.pathname;

	// Only track API routes (skip pages, assets, etc.)
	if (!pathname.startsWith('/api/')) {
		return response;
	}

	// Fire-and-forget via waitUntil — don't add latency
	const kv = event.platform?.env?.REJECTION_MONITOR_KV as
		| { get(key: string): Promise<string | null>; put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> }
		| undefined;
	const waitUntil = event.platform?.context?.waitUntil?.bind(event.platform.context);

	if (kv && waitUntil) {
		waitUntil(
			trackForRejection({
				pathname,
				status: response.status,
				kv,
				webhookUrl: process.env.REJECTION_MONITOR_WEBHOOK_URL,
				thresholdPercent: parseFloat(process.env.REJECTION_THRESHOLD_PERCENT || '1')
			}).catch((err) => console.error('[RejectionMonitor] Tracking error:', err))
		);
	}

	return response;
};

/**
 * Hook execution order:
 * 1. handlePlatformEnv - Copy platform.env to process.env + init per-request Prisma
 * 2. handleAuth - Populate session/user in locals (needed for user-based rate limits)
 * 3. handleRateLimit - Check rate limits (can use user ID from auth)
 * 4. handleCsrfGuard - CSRF protection for sensitive endpoints
 * 5. handleSecurityHeaders - Add COOP/COEP + CSP headers
 * 6. handleRejectionMonitoring - Track rejection rates (async, zero latency impact)
 *
 * Note: Auth runs first so rate limiting can use user ID for user-keyed limits.
 * Rejection monitoring runs last so it observes the final response status.
 */
export const handle = sequence(handlePlatformEnv, handleAuth, handleRateLimit, handleCsrfGuard, handleSecurityHeaders, handleRejectionMonitoring);
