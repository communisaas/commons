import { dev } from '$app/environment';
import type { Handle, HandleServerError } from '@sveltejs/kit';
import { error } from '@sveltejs/kit';
import {
	getRateLimiter,
	findRateLimitConfig,
	createRateLimitHeaders,
	SlidingWindowRateLimiter
} from '$lib/core/security/rate-limiter';
import { deriveTrustTier } from '$lib/core/identity/authority-level';
import { trackForRejection } from '$lib/services/rejectionMonitor';
import { configure } from '$lib/core/shadow-atlas/ipfs-store';
import { initCloudflareSentryHandle, sentryHandle, handleErrorWithSentry } from '@sentry/sveltekit';
import * as Sentry from '@sentry/sveltekit';
import { initConvex, serverQuery, serverMutation } from '$lib/server/convex-work-budget';
import { PUBLIC_CONVEX_URL } from '$env/static/public';
import { mintConvexToken } from '$lib/server/convex-jwt';
import { getInternalSecret } from '$lib/server/internal/secret-auth';
import { api } from '$lib/convex';
import {
	API_V1_EDGE_PROTOCOL_VERSION,
	API_V1_EDGE_REQUEST_HEADER,
	API_V1_RATE_TIER_HEADER,
	getApiV1RateTierSignal,
	withApiV1RateTierSignal
} from '$lib/server/api-v1/rate-tier-signal';
import { evaluateSessionWindow } from '$lib/server/session-authority';
import {
	querySessionAuthorityFromCookie,
	resolveSessionCookieSigningSecrets,
	sealSessionCookie
} from '$lib/server/auth/session-cookie';
import { dispatchRuntimeRequest } from '$lib/server/runtime-containment';
import { handlePublicDiscoveryManifestRefreshCapability } from '$lib/server/public-discovery-manifest-refresh-hook';
import {
	classifyPublicTemplateCostPath,
	PUBLIC_TEMPLATE_DETAIL_RATE_LIMIT
} from '$lib/server/public-template-detail-path';
import { createProductionHostAuthorityHandle } from '$lib/server/production-host-authority';
import { handleConvexWorkBudgetResponses } from '$lib/server/convex-work-budget-response';

const handleProductionHostAuthority = createProductionHostAuthorityHandle({
	allowLocalDevelopment: dev
});

// ─── DUAL-STACK: Initialize Convex server-side client ───
// Stores the deployment URL so serverQuery()/serverMutation()/serverAction()
// can create ConvexHttpClient instances. The ConvexClient itself is disabled
// (IS_BROWSER=false) — only the URL is needed for HTTP calls.
const APPROVED_CONVEX_RUNTIME_URLS = new Set([
	PUBLIC_CONVEX_URL,
	'https://outstanding-firefly-831.convex.cloud',
	'https://quirky-chinchilla-352.convex.cloud'
]);
let convexInitializedUrl: string | null = null;
function ensureConvexInitialized(configured: unknown): void {
	if (typeof configured !== 'string' || !APPROVED_CONVEX_RUNTIME_URLS.has(configured)) {
		throw new Error('PUBLIC_CONVEX_URL is not an approved runtime realm');
	}
	if (convexInitializedUrl !== null) {
		if (convexInitializedUrl !== configured) {
			throw new Error('Convex runtime realm changed inside one Worker isolate');
		}
		return;
	}
	initConvex(configured);
	convexInitializedUrl = configured;
}

const handleConvexInitialization: Handle = async ({ event, resolve }) => {
	ensureConvexInitialized(event.platform?.env?.PUBLIC_CONVEX_URL ?? PUBLIC_CONVEX_URL);
	return resolve(event);
};

/**
 * Sentry error handler — captures unhandled errors with PII scrubbing.
 * Must be exported as `handleError` for SvelteKit to pick it up.
 */
export const handleError = handleErrorWithSentry((input: Parameters<HandleServerError>[0]) => {
	const { error: err } = input;
	console.error('[handleError]', err);
	// Surface the Sentry event ID on the page error object so /+error.svelte
	// can render it as a copy-able reference. The wrapping
	// handleErrorWithSentry runs the capture before our handler, so
	// lastEventId() resolves to the just-captured event.
	const eventId = Sentry.lastEventId();
	return {
		message: 'Internal Error',
		eventId
	};
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

		// Wire Shadow Atlas content sources from env vars.
		// R2 is the primary read path; IPFS activates when CID + gateways are set.
		// EXPECTED_CELL_MAP_ROOT + EXPECTED_CELL_MAP_DEPTH (F-1.1): pinned Tree 2
		// SMT root and depth used to detect poisoned-gateway / poisoned-R2
		// attacks. Refresh at every quarterly atlas release. Empty in dev only —
		// production callers fail-closed when unset.
		const depthRaw = process.env.EXPECTED_CELL_MAP_DEPTH;
		const depth = depthRaw ? Number.parseInt(depthRaw, 10) : 0;
		configure({
			atlasBaseUrl: process.env.ATLAS_BASE_URL || '',
			ipfsCid: process.env.IPFS_CID_ROOT || '',
			merkleSnapshotCid: process.env.IPFS_CID_MERKLE_SNAPSHOT || '',
			ipfsGateways: (process.env.IPFS_GATEWAYS || '')
				.split(',')
				.map((s) => s.trim())
				.filter(Boolean),
			expectedCellMapRoot: process.env.EXPECTED_CELL_MAP_ROOT || '',
			expectedCellMapDepth: Number.isFinite(depth) && depth > 0 ? depth : 0
		});
	}
	return resolve(event);
};

const SESSION_COOKIE = 'auth-session';
const SESSION_AUTHORITY_INDEPENDENT_OPERATIONAL_PATHS = new Set([
	'/api/live',
	'/api/health',
	'/api/containment-readiness'
]);

/**
 * These exact operational handlers do not consume application identity.
 * Liveness is dependency-free; readiness authenticates its own operator
 * capability before performing any intended dependency work. A browser cookie
 * must therefore never add a session-authority query ahead of either handler.
 */
export function bypassSessionAuthorityForOperationalPath(pathname: string): boolean {
	return SESSION_AUTHORITY_INDEPENDENT_OPERATIONAL_PATHS.has(pathname);
}

/**
 * Return the authenticated rate tier only to the dedicated API edge Worker.
 * AsyncLocalStorage keeps concurrent requests isolated; direct Pages requests
 * never receive the internal header unless they opt into the edge protocol.
 */
export const handleApiV1RateTierSignal: Handle = async ({ event, resolve }) => {
	if (
		!event.url.pathname.startsWith('/api/v1/') ||
		event.request.headers.get(API_V1_EDGE_REQUEST_HEADER) !== API_V1_EDGE_PROTOCOL_VERSION
	) {
		return resolve(event);
	}
	return withApiV1RateTierSignal(async () => {
		const response = await resolve(event);
		const signal = getApiV1RateTierSignal();
		if (signal) response.headers.set(API_V1_RATE_TIER_HEADER, signal);
		return response;
	});
};

/**
 * Reject malformed or abusive anonymous template-detail traffic before auth
 * can consult Convex and before a route can invoke Convex or Sharp. This
 * per-isolate/optional-Redis limiter is defense-in-depth; the matching
 * Cloudflare WAF rule remains the cross-isolate launch boundary.
 */
export const handlePublicTemplateDetailCostShield: Handle = async ({ event, resolve }) => {
	const method = event.request.method;
	if (method !== 'GET' && method !== 'HEAD') return resolve(event);

	const route = classifyPublicTemplateCostPath(event.url.pathname);
	if (!route) return resolve(event);
	if (!route.validSlug) {
		return new Response(method === 'HEAD' ? null : 'Not found', {
			status: 404,
			headers: { 'Cache-Control': 'private, no-store, max-age=0' }
		});
	}

	const clientIP = event.getClientAddress();
	const result = await getRateLimiter().check(
		SlidingWindowRateLimiter.generateKey(PUBLIC_TEMPLATE_DETAIL_RATE_LIMIT, clientIP),
		PUBLIC_TEMPLATE_DETAIL_RATE_LIMIT
	);
	const headers = createRateLimitHeaders(result);
	if (!result.allowed) {
		return new Response(
			method === 'HEAD'
				? null
				: JSON.stringify({
						error: 'Too many requests',
						message: `Rate limit exceeded. Please try again in ${result.retryAfter} seconds.`,
						retryAfter: result.retryAfter
					}),
			{
				status: 429,
				headers: {
					...(method === 'HEAD' ? {} : { 'Content-Type': 'application/json' }),
					'Cache-Control': 'private, no-store, max-age=0',
					...headers
				}
			}
		);
	}

	const response = await resolve(event);
	for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
	return response;
};

export const handleAuth: Handle = async ({ event, resolve }) => {
	if (event.locals.publicDiscoveryManifestRefreshAuthenticated) return resolve(event);
	if (bypassSessionAuthorityForOperationalPath(event.url.pathname)) {
		event.locals.user = null;
		event.locals.session = null;
		event.locals.convexToken = undefined;
		return resolve(event);
	}
	try {
		const requestNow = Date.now();
		const cookieValue = event.cookies.get(SESSION_COOKIE);
		const cookieSecrets = cookieValue
			? resolveSessionCookieSigningSecrets({
					activeSecret: process.env.SESSION_COOKIE_SIGNING_SECRET,
					previousSecret: process.env.SESSION_COOKIE_SIGNING_SECRET_PREVIOUS || undefined,
					sessionCreationSecret: process.env.SESSION_CREATION_SECRET,
					previousSessionCreationSecret: process.env.SESSION_CREATION_SECRET_PREVIOUS || undefined
				})
			: { activeSecret: undefined, previousSecret: undefined };
		const cookieAuth = await querySessionAuthorityFromCookie({
			cookieValue,
			activeSecret: cookieSecrets.activeSecret,
			previousSecret: cookieSecrets.previousSecret,
			now: requestNow,
			onInvalid: () => event.cookies.delete(SESSION_COOKIE, { path: '/' }),
			queryAuthority: (verifiedSessionId) =>
				serverQuery(api.sessionAuthority.get, {
					_secret: getInternalSecret(),
					sessionId: verifiedSessionId
				})
		});
		if (cookieAuth.status !== 'verified') {
			event.locals.user = null;
			event.locals.session = null;
			return resolve(event);
		}
		const { sessionId, authority: result } = cookieAuth;

		if (result.status === 'invalid') {
			event.cookies.delete(SESSION_COOKIE, { path: '/' });
			event.locals.user = null;
			event.locals.session = null;
			return resolve(event);
		}
		if (result.status === 'not_ready') {
			throw new Error(result.reason);
		}

		const { session, authority: user } = result;
		const sessionWindow = evaluateSessionWindow(session, requestNow);
		if (!sessionWindow.valid) {
			event.cookies.delete(SESSION_COOKIE, { path: '/' });
			event.locals.user = null;
			event.locals.session = null;
			return resolve(event);
		}
		const { renewed, effectiveExpiresAt, renewTo } = sessionWindow;
		const userEmail = user.email;

		if (!userEmail) {
			console.warn(
				'[hooks.server] Valid session resolved to user without email; clearing auth cookie for user=' +
					(user.userId as string).slice(0, 8) +
					'...'
			);
			event.cookies.delete(SESSION_COOKIE, { path: '/' });
			event.locals.user = null;
			event.locals.session = null;
			return resolve(event);
		}

		if (renewed || cookieAuth.needsReseal || cookieAuth.cookieExpiresAt !== effectiveExpiresAt) {
			// Renewal, rotation, and any expiry drift always re-emit an active-key
			// envelope. A raw database id is never written to the cookie.
			const signedCookie = await sealSessionCookie(
				session.id as string,
				effectiveExpiresAt,
				cookieSecrets.activeSecret
			);
			event.cookies.set(SESSION_COOKIE, signedCookie, {
				path: '/',
				sameSite: 'lax',
				httpOnly: true,
				expires: new Date(effectiveExpiresAt),
				secure: !dev
			});
		}
		if (renewed) {
			// Log Convex renewal failures rather than swallowing silently.
			// The cookie expiry has been extended on the response, but if the
			// Convex renewal fails (transient outage, schema drift, race
			// with revocation) the DB row stays at the OLD expiry. Every
			// subsequent request will see the renewal flag re-fire and
			// the same failure will repeat, masking a real outage. Logging
			// restores observability without changing the request outcome
			// (cookie was already set).
			serverMutation(api.authOps.renewSession, {
				_secret: getInternalSecret(),
				sessionId,
				renewTo: renewTo ?? undefined
			}).catch((err) => {
				console.warn(
					'[hooks.server] Session renewal failed for sessionId=' + sessionId.slice(0, 8) + '...:',
					err instanceof Error ? err.message : String(err)
				);
			});
		}

		event.locals.user = {
			id: user.userId as string,
			email: userEmail,
			name: user.name ?? null,
			avatar: user.avatar ?? null,
			// PII custody
			email_hash: null,
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
			did_key: null,
			// ZK identity
			identity_commitment: user.identityCommitment ?? null,
			// District
			district_hash: user.districtHash ?? null,
			district_verified: user.districtVerified ?? false,
			address_verified_at: user.addressVerifiedAt ? new Date(user.addressVerifiedAt) : null,
			// Profile
			role: null,
			organization: null,
			location: null,
			connection: null,
			profile_completed_at: null,
			profile_visibility: 'private',
			// Reputation
			trust_score: user.trustScore ?? 0,
			reputation_tier: 'new',
			// Wallet
			wallet_address: user.walletAddress ?? null,
			wallet_type: null,
			near_account_id: null,
			near_derived_scroll_address: null,
			// Timestamps
			createdAt: new Date(user.userCreatedAt),
			updatedAt: new Date(user.userCreatedAt)
		};
		event.locals.session = {
			id: session.id as string,
			userId: session.userId,
			createdAt: new Date(session.createdAt),
			expiresAt: new Date(effectiveExpiresAt)
		};

		// Mint Convex JWT for authenticated server-side queries
		if (event.locals.user && (event.platform?.env?.PUBLIC_CONVEX_URL ?? PUBLIC_CONVEX_URL)) {
			try {
				const token = await mintConvexToken(event.locals.user);
				if (token) {
					event.locals.convexToken = token;
					if (!user.tokenIdentifier) {
						serverMutation(api.authOps.backfillTokenIdentifier, {}).catch((err) => {
							console.warn(
								'[hooks.server] tokenIdentifier backfill failed for user=' +
									(user.userId as string).slice(0, 8) +
									'...:',
								err instanceof Error ? err.message : String(err)
							);
						});
					}
				}
			} catch (err) {
				console.warn(
					'[Hooks] Convex JWT minting failed:',
					err instanceof Error ? err.message : String(err)
				);
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

	// COOP/COEP for SharedArrayBuffer (ZK proving) — only on routes that need it.
	// Setting COEP: require-corp globally blocks JS module loading because CF Pages
	// serves static assets without Cross-Origin-Resource-Policy headers.
	const needsCrossOriginIsolation =
		event.url.pathname.startsWith('/s/') || event.url.pathname.startsWith('/profile');
	response.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
	if (needsCrossOriginIsolation && !isEmbed) {
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
 *   - Runs after authentication so user-keyed rules receive the verified user ID
 *   - Dedicated public cost shields run before authentication where pre-I/O rejection is required
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

	// Get the verified user ID populated by handleAuth when a rule is user-keyed.
	// Requests without an accepted session deliberately fall back to their IP.
	let userId: string | undefined;
	if (config.keyStrategy === 'user') {
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
		| {
				get(key: string): Promise<string | null>;
				put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
		  }
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

	// Read the environment tag from `SENTRY_ENVIRONMENT` (CF Pages secret,
	// canonical) with `PUBLIC_SENTRY_ENVIRONMENT` as fallback so server and
	// client init pick up the same string from the same source family. The
	// previous read of `ENVIRONMENT` was wrong — that var isn't set on CF
	// Pages, so every prod event was tagged `development` and indistinguishable
	// from local dev in the Sentry dashboard.
	const env =
		(event.platform?.env?.SENTRY_ENVIRONMENT as string) ||
		(event.platform?.env?.PUBLIC_SENTRY_ENVIRONMENT as string) ||
		'development';
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
 * 1. handleProductionHostAuthority - stop noncanonical production aliases before all I/O
 * 2. handlePublicDiscoveryManifestRefreshCapability - reject refresh traffic before dependency I/O
 * 3. handleConvexInitialization - Initialize Convex only after capability rejection
 * 4. handleSentryInit - Initialize Sentry SDK from platform.env
 * 5. handlePlatformEnv - Copy platform.env to process.env + init IPFS CIDs
 * 6. handleConvexWorkBudgetResponses - Own typed denial for every downstream Convex reservation
 * 7. sentryHandle - Wrap request for Sentry error/trace capture
 * 8. handleApiV1RateTierSignal - Isolate the edge-only response hint
 * 9. handlePublicTemplateDetailCostShield - Reject exact public-detail abuse before Convex I/O
 * 10. handleAuth - Validate session via Convex, populate locals.user/session
 * 11. handleRateLimit - Check remaining route limits (can use user ID from auth)
 * 12. handleCsrfGuard - CSRF protection for sensitive endpoints
 * 13. handleSecurityHeaders - Add COOP/COEP + CSP headers
 * 14. handleRejectionMonitoring - Track rejection rates (async, zero latency impact)
 */
const applicationHandle = sequence(
	handleProductionHostAuthority,
	handlePublicDiscoveryManifestRefreshCapability,
	handleConvexInitialization,
	handleSentryInit,
	handlePlatformEnv,
	handleConvexWorkBudgetResponses,
	sentryHandle(),
	handleApiV1RateTierSignal,
	handlePublicTemplateDetailCostShield,
	handleAuth,
	handleRateLimit,
	handleCsrfGuard,
	handleSecurityHeaders,
	handleRejectionMonitoring
);

/**
 * Runtime containment is the outermost boundary. In maintenance artifacts it
 * returns before Convex initialization and before every application hook; only
 * the two explicitly I/O-free operational routes reach SvelteKit routing.
 */
export const handle: Handle = (input) => dispatchRuntimeRequest(input, applicationHandle);
