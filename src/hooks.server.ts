import { dev } from '$app/environment';
import type { Handle } from '@sveltejs/kit';
import { error } from '@sveltejs/kit';
import {
	getRateLimiter,
	findRateLimitConfig,
	createRateLimitHeaders,
	SlidingWindowRateLimiter
} from '$lib/core/security/rate-limiter';
import { deriveTrustTier } from '$lib/core/identity/authority-level';
import { trackForRejection } from '$lib/services/rejectionMonitor';
import { setCIDs } from '$lib/core/shadow-atlas/ipfs-store';
import {
	initCloudflareSentryHandle,
	sentryHandle,
	handleErrorWithSentry
} from '@sentry/sveltekit';
import { initConvex, serverQuery, serverMutation } from 'convex-sveltekit';
import { PUBLIC_CONVEX_URL } from '$env/static/public';
import { mintConvexToken } from '$lib/server/convex-jwt';
import { api } from '$lib/convex';
import { decryptUserPii } from '$lib/core/crypto/user-pii-encryption';

// ─── DUAL-STACK: Initialize Convex server-side client ───
// Stores the deployment URL so serverQuery()/serverMutation()/serverAction()
// can create ConvexHttpClient instances. The ConvexClient itself is disabled
// (IS_BROWSER=false) — only the URL is needed for HTTP calls.
if (typeof PUBLIC_CONVEX_URL === 'string' && PUBLIC_CONVEX_URL) {
	initConvex(PUBLIC_CONVEX_URL);
}

/**
 * Sentry error handler — captures unhandled errors with PII scrubbing.
 * Must be exported as `handleError` for SvelteKit to pick it up.
 */
export const handleError = handleErrorWithSentry((input) => {
	const { error: err } = input;
	console.error('[handleError]', err);
});

// On Cloudflare Workers, process.env is empty. Secrets are only available
// via event.platform.env. This shim copies them to process.env once so that
// the ~90 call sites using process.env.XXX work without modification.
let envShimApplied = false;
const handlePlatformEnv: Handle = async ({ event, resolve }) => {
	if (!envShimApplied) {
		if (event.platform?.env) {
			for (const [key, value] of Object.entries(event.platform.env as Record<string, unknown>)) {
				if (typeof value === 'string') {
					process.env[key] = value;
				}
			}
		}
		envShimApplied = true;

		// Wire IPFS CIDs from env vars so Shadow Atlas reads go live.
		setCIDs({
			root: process.env.IPFS_CID_ROOT || '',
			merkleSnapshot: process.env.IPFS_CID_MERKLE_SNAPSHOT || '',
		});
	}
	return resolve(event);
};

const SESSION_COOKIE = 'auth-session';

const handleAuth: Handle = async ({ event, resolve }) => {
	try {
		const sessionId = event.cookies.get(SESSION_COOKIE);
		if (!sessionId) {
			event.locals.user = null;
			event.locals.session = null;
			return resolve(event);
		}

		const result = await serverQuery(api.authOps.validateSession, { sessionId });

		if (!result) {
			event.cookies.delete(SESSION_COOKIE, { path: '/' });
			event.locals.user = null;
			event.locals.session = null;
			return resolve(event);
		}

		const { session, user, renewed } = result;

		if (renewed) {
			// Extend cookie expiry to match renewed session
			event.cookies.set(SESSION_COOKIE, session.id, {
				path: '/',
				sameSite: 'lax',
				httpOnly: true,
				expires: new Date(session.expiresAt),
				secure: !dev
			});
			// Fire-and-forget: persist the renewal in Convex
			serverMutation(api.authOps.renewSession, { sessionId }).catch(() => {});
		}

		// Backfill tokenIdentifier for sessions created before the fix.
		// Fire-and-forget — doesn't block the request.
		if (!user.tokenIdentifier) {
			serverMutation(api.authOps.backfillTokenIdentifier, {
				userId: user._id as string,
			}).catch(() => {});
		}

		// No server-side PII decryption — client decrypts locally with device key.
		// Server never holds standing decrypt capability.
		const pii = { email: null as string | null, name: null as string | null };

		event.locals.user = {
			id: user._id as string,
			email: pii.email,
			name: pii.name,
			avatar: user.avatar ?? null,
			// PII custody
			email_hash: user.emailHash ?? null,
			// Verification status
			is_verified: user.isVerified,
			verification_method: user.verificationMethod ?? null,
			verified_at: user.verifiedAt ? new Date(user.verifiedAt) : null,
			// Graduated trust
			trust_tier: deriveTrustTier({
				passkey_credential_id: user.passkeyCredentialId ?? null,
				district_verified: user.districtVerified ?? false,
				address_verified_at: user.addressVerifiedAt ? new Date(user.addressVerifiedAt) : null,
				identity_commitment: user.identityCommitment ?? null,
				document_type: user.documentType ?? null,
				trust_score: user.trustScore ?? 0
			}),
			// Passkey
			passkey_credential_id: user.passkeyCredentialId ?? null,
			did_key: user.didKey ?? null,
			// ZK identity
			identity_commitment: user.identityCommitment ?? null,
			// District
			district_hash: user.districtHash ?? null,
			district_verified: user.districtVerified ?? false,
			// Profile
			role: user.role ?? null,
			organization: user.organization ?? null,
			location: user.location ?? null,
			connection: user.connection ?? null,
			profile_completed_at: user.profileCompletedAt ? new Date(user.profileCompletedAt) : null,
			profile_visibility: user.profileVisibility ?? 'private',
			// Reputation
			trust_score: user.trustScore ?? 0,
			reputation_tier: user.reputationTier ?? 'novice',
			// Wallet
			wallet_address: user.walletAddress ?? null,
			wallet_type: user.walletType ?? null,
			near_account_id: user.nearAccountId ?? null,
			near_derived_scroll_address: user.nearDerivedScrollAddress ?? null,
			// Timestamps
			createdAt: new Date(user._creationTime),
			updatedAt: new Date(user.updatedAt)
		};
		event.locals.session = session;

		// Mint Convex JWT for authenticated server-side queries
		if (event.locals.user && PUBLIC_CONVEX_URL) {
			try {
				const token = await mintConvexToken(event.locals.user);
				if (token) {
					event.locals.convexToken = token;
				}
			} catch (err) {
				console.warn('[Hooks] Convex JWT minting failed:', err instanceof Error ? err.message : String(err));
			}
		}

		return resolve(event);
	} catch (err) {
		// Transient error — do NOT delete the session cookie.
		console.error('[Hooks] Session validation error (transient):', {
			path: event.url.pathname,
			error: err instanceof Error ? err.message : String(err)
		});
		event.locals.user = null;
		event.locals.session = null;
		return resolve(event);
	}
};

/**
 * BA-010: Defense-in-depth CSRF protection for sensitive identity endpoints.
 *
 * SvelteKit's built-in CSRF origin checking (trustedOrigins, see svelte.config.js) already
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
	// calls won't have Origin. SvelteKit's trustedOrigins handles this case, but
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
	const isEmbed = event.url.pathname.startsWith('/embed/');
	const response = await resolve(event);

	// Set COOP/COEP headers for all responses (SharedArrayBuffer support for ZK proving)
	// Skip COEP for embed routes — require-corp prevents embedded pages from loading cross-origin resources
	response.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
	if (!isEmbed) {
		response.headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
	}

	// For embed routes, override frame-ancestors to allow framing
	if (isEmbed) {
		const existingCsp = response.headers.get('Content-Security-Policy');
		if (existingCsp) {
			response.headers.set(
				'Content-Security-Policy',
				existingCsp.replace(/frame-ancestors\s+[^;]+;?/i, 'frame-ancestors *;')
			);
		}
	}

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
 * Sentry init handle — initializes the SDK on Cloudflare Workers using
 * platform.env.SENTRY_DSN. Runs FIRST so all subsequent handles are traced.
 * No-ops gracefully when SENTRY_DSN is not set (dev without Sentry).
 */
const handleSentryInit: Handle = async ({ event, resolve }) => {
	const dsn = event.platform?.env?.SENTRY_DSN as string | undefined;
	if (!dsn) return resolve(event);

	const env = (event.platform?.env?.ENVIRONMENT as string) || 'development';
	return initCloudflareSentryHandle({
		dsn,
		environment: env,
		tracesSampleRate: env === 'production' ? 0.1 : 1.0,
		// PII masking — replace entire user object with redacted stub
		beforeSend(sentryEvent) {
			if (sentryEvent.user) {
				sentryEvent.user = { id: '[redacted]' };
			}
			return sentryEvent;
		}
	})({ event, resolve });
};

/**
 * Hook execution order:
 * 1. handleSentryInit - Initialize Sentry SDK from platform.env
 * 2. handlePlatformEnv - Copy platform.env to process.env + init IPFS CIDs
 * 3. sentryHandle - Wrap request for Sentry error/trace capture
 * 4. handleAuth - Validate session via Convex, populate locals.user/session
 * 5. handleRateLimit - Check rate limits (can use user ID from auth)
 * 6. handleCsrfGuard - CSRF protection for sensitive endpoints
 * 7. handleSecurityHeaders - Add COOP/COEP + CSP headers
 * 8. handleRejectionMonitoring - Track rejection rates (async, zero latency impact)
 */
export const handle = sequence(handleSentryInit, handlePlatformEnv, sentryHandle(), handleAuth, handleRateLimit, handleCsrfGuard, handleSecurityHeaders, handleRejectionMonitoring);
