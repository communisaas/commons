/**
 * commons-api-v1-edge
 *
 * A zero-storage, per-location cost prefilter in front of the Pages API. Worker
 * Rate Limiting bindings are permissive/eventually consistent and therefore
 * NEVER authorization or accounting authority. Every request that passes this
 * layer is proxied to Pages, where Convex atomically authenticates the key and
 * consumes the exact global plan bucket.
 */

export const EDGE_PROTOCOL_HEADER = 'x-commons-api-v1-edge';
export const EDGE_PROTOCOL_VERSION = 'v1';
export const RATE_TIER_RESPONSE_HEADER = 'x-commons-internal-api-rate-tier';
export const RATE_WINDOW_SECONDS = 60;
export const TIER_HINT_TTL_MS = 60_000;
export const NEGATIVE_HINT_TTL_MS = 10_000;

type PlanTier = 'inactive' | 'starter' | 'organization' | 'coalition';

export interface RateLimitBinding {
	limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
	COLD_TOKEN_LIMIT?: RateLimitBinding;
	COLD_IP_LIMIT?: RateLimitBinding;
	TIER_100_LIMIT?: RateLimitBinding;
	TIER_300_LIMIT?: RateLimitBinding;
	TIER_1000_LIMIT?: RateLimitBinding;
	TIER_3000_LIMIT?: RateLimitBinding;
}

export interface EdgeCache {
	match(request: Request): Promise<Response | undefined>;
	put(request: Request, response: Response): Promise<void>;
}

export interface Runtime {
	cache?: EdgeCache;
	fetch(request: Request): Promise<Response>;
	now(): number;
}

type Hint<T> = { value: T; cachedAt: number };

type CacheStorageWithDefault = CacheStorage & { default?: Cache };

const PLAN_LIMITS: Record<PlanTier, number> = {
	inactive: 100,
	starter: 300,
	organization: 1_000,
	coalition: 3_000
};

function jsonError(code: string, message: string, status: number): Response {
	return new Response(JSON.stringify({ data: null, error: { code, message } }), {
		status,
		headers: {
			'Cache-Control': 'no-store',
			'Content-Type': 'application/json',
			...(status === 429 || status === 503 ? { 'Retry-After': String(RATE_WINDOW_SECONDS) } : {})
		}
	});
}

function bearerFrom(request: Request): string | null {
	const header = request.headers.get('Authorization');
	if (!header) return null;
	const match = /^Bearer\s+([^\s]+)$/i.exec(header.trim());
	if (!match) return null;
	const token = match[1];
	if (!/^ck_live_[0-9a-f]{32}$/.test(token)) return null;
	return token;
}

async function sha256(value: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function cacheKey(request: Request, kind: string, tokenHash: string, suffix?: string): Request {
	const url = new URL(request.url);
	url.pathname = `/.internal-cache/api-v1-edge/v1/${kind}/${tokenHash}${suffix ? `/${suffix}` : ''}`;
	url.search = '';
	return new Request(url, { method: 'GET' });
}

async function readHint<T extends string | number>(
	cache: EdgeCache,
	key: Request,
	now: number,
	ttlMs: number,
	validate: (value: unknown) => value is T
): Promise<T | undefined> {
	const response = await cache.match(key);
	if (!response) return undefined;
	try {
		const hint = (await response.json()) as Partial<Hint<T>>;
		if (
			!validate(hint.value) ||
			!Number.isSafeInteger(hint.cachedAt) ||
			(hint.cachedAt as number) > now ||
			now - (hint.cachedAt as number) >= ttlMs
		) {
			return undefined;
		}
		return hint.value;
	} catch {
		return undefined;
	}
}

async function writeHint<T extends string | number>(
	cache: EdgeCache,
	key: Request,
	value: T,
	now: number,
	ttlMs: number
): Promise<void> {
	await cache.put(
		key,
		new Response(JSON.stringify({ value, cachedAt: now } satisfies Hint<T>), {
			headers: {
				'Cache-Control': `public, max-age=${Math.floor(ttlMs / 1_000)}`,
				'Content-Type': 'application/json'
			}
		})
	);
}

function isPlanTier(value: unknown): value is PlanTier {
	return (
		value === 'inactive' || value === 'starter' || value === 'organization' || value === 'coalition'
	);
}

function isNegativeStatus(value: unknown): value is 401 | 403 {
	return value === 401 || value === 403;
}

function allBindings(env: Env): env is Required<Env> {
	return Boolean(
		env.COLD_TOKEN_LIMIT &&
		env.COLD_IP_LIMIT &&
		env.TIER_100_LIMIT &&
		env.TIER_300_LIMIT &&
		env.TIER_1000_LIMIT &&
		env.TIER_3000_LIMIT
	);
}

function bindingForTier(env: Required<Env>, tier: PlanTier): RateLimitBinding {
	switch (tier) {
		case 'inactive':
			return env.TIER_100_LIMIT;
		case 'starter':
			return env.TIER_300_LIMIT;
		case 'organization':
			return env.TIER_1000_LIMIT;
		case 'coalition':
			return env.TIER_3000_LIMIT;
	}
}

function requiresApiKey(pathname: string): boolean {
	if (!pathname.startsWith('/api/v1/')) return false;
	return !(
		pathname === '/api/v1/' ||
		pathname === '/api/v1/docs' ||
		pathname.startsWith('/api/v1/docs/') ||
		pathname === '/api/v1/keys' ||
		pathname.startsWith('/api/v1/keys/')
	);
}

async function routeFingerprint(request: Request): Promise<string> {
	const url = new URL(request.url);
	return sha256(`${request.method.toUpperCase()}\n${url.pathname}`);
}

async function callLimiter(binding: RateLimitBinding, key: string): Promise<boolean> {
	const result = await binding.limit({ key });
	return result.success === true;
}

function proxyRequest(request: Request): Request {
	const headers = new Headers(request.headers);
	// Replace any client-supplied protocol marker with the canonical hop marker.
	headers.set(EDGE_PROTOCOL_HEADER, EDGE_PROTOCOL_VERSION);
	return new Request(request, { headers });
}

function stripInternalHeader(response: Response): Response {
	if (!response.headers.has(RATE_TIER_RESPONSE_HEADER)) return response;
	const headers = new Headers(response.headers);
	headers.delete(RATE_TIER_RESPONSE_HEADER);
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers
	});
}

/** Pure/testable request handler; default export only supplies Worker globals. */
export async function handleRequest(
	request: Request,
	env: Env,
	runtime: Runtime
): Promise<Response> {
	const url = new URL(request.url);
	if (request.method === 'OPTIONS' || !requiresApiKey(url.pathname)) {
		return runtime.fetch(request);
	}
	if (!allBindings(env) || !runtime.cache) {
		return jsonError('EDGE_RATE_LIMIT_UNAVAILABLE', 'API edge protection is unavailable.', 503);
	}
	const bearer = bearerFrom(request);
	if (!bearer) {
		return jsonError(
			'UNAUTHORIZED',
			'Missing or invalid Authorization header. Use: Bearer <api_key>',
			401
		);
	}
	const ip = request.headers.get('cf-connecting-ip');
	if (!ip || ip.length > 128) {
		return jsonError('EDGE_CLIENT_ID_UNAVAILABLE', 'API edge client identity is unavailable.', 503);
	}

	const now = runtime.now();
	let tokenHash: string;
	let fingerprint: string;
	try {
		tokenHash = await sha256(bearer);
		fingerprint = await routeFingerprint(request);
	} catch {
		return jsonError('EDGE_RATE_LIMIT_UNAVAILABLE', 'API edge protection is unavailable.', 503);
	}
	const globalNegativeKey = cacheKey(request, 'negative-global', tokenHash);
	const routeNegativeKey = cacheKey(request, 'negative-route', tokenHash, fingerprint);
	let routeNegative: 401 | 403 | undefined;
	try {
		const globalNegative = await readHint(
			runtime.cache,
			globalNegativeKey,
			now,
			NEGATIVE_HINT_TTL_MS,
			isNegativeStatus
		);
		routeNegative =
			globalNegative ??
			(await readHint(
				runtime.cache,
				routeNegativeKey,
				now,
				NEGATIVE_HINT_TTL_MS,
				isNegativeStatus
			));
	} catch {
		return jsonError('EDGE_RATE_LIMIT_UNAVAILABLE', 'API edge protection is unavailable.', 503);
	}
	if (routeNegative) {
		return jsonError(
			routeNegative === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN',
			routeNegative === 401 ? 'Invalid API key' : 'API key is not authorized for this route',
			routeNegative
		);
	}

	const tierKey = cacheKey(request, 'tier', tokenHash);
	let tier: PlanTier | undefined;
	try {
		tier = await readHint(runtime.cache, tierKey, now, TIER_HINT_TTL_MS, isPlanTier);
	} catch {
		return jsonError('EDGE_RATE_LIMIT_UNAVAILABLE', 'API edge protection is unavailable.', 503);
	}
	try {
		if (tier) {
			if (!(await callLimiter(bindingForTier(env, tier), `api-v1:${tokenHash}`))) {
				return jsonError(
					'RATE_LIMITED',
					`Per-location API cost shield exceeded (${PLAN_LIMITS[tier]}/minute).`,
					429
				);
			}
		} else {
			const [tokenAllowed, ipAllowed] = await Promise.all([
				callLimiter(env.COLD_TOKEN_LIMIT, `api-v1:cold-token:${tokenHash}`),
				callLimiter(env.COLD_IP_LIMIT, `api-v1:cold-ip:${ip}`)
			]);
			if (!tokenAllowed || !ipAllowed) {
				return jsonError('RATE_LIMITED', 'Per-location API cost shield exceeded.', 429);
			}
		}
	} catch {
		return jsonError('EDGE_RATE_LIMIT_UNAVAILABLE', 'API edge protection is unavailable.', 503);
	}

	let originResponse: Response;
	try {
		originResponse = await runtime.fetch(proxyRequest(request));
	} catch {
		return jsonError('ORIGIN_UNAVAILABLE', 'API origin is unavailable.', 502);
	}
	const signal = originResponse.headers.get(RATE_TIER_RESPONSE_HEADER);
	const writes: Promise<void>[] = [];
	if (isPlanTier(signal))
		writes.push(writeHint(runtime.cache, tierKey, signal, now, TIER_HINT_TTL_MS));
	if (originResponse.status === 401 && signal === 'invalid') {
		writes.push(writeHint(runtime.cache, globalNegativeKey, 401, now, NEGATIVE_HINT_TTL_MS));
	} else if (originResponse.status === 403 && isPlanTier(signal)) {
		writes.push(writeHint(runtime.cache, routeNegativeKey, 403, now, NEGATIVE_HINT_TTL_MS));
	}
	// Cache hints are optimization state, never authority. Once exact origin
	// auth has answered, a transient cache-write failure must not replace that
	// authoritative response; the next request safely falls back to cold limits.
	if (writes.length > 0) {
		try {
			await Promise.all(writes);
		} catch {
			// Deliberately no credential-bearing logs.
		}
	}
	return stripInternalHeader(originResponse);
}

function defaultRuntime(): Runtime {
	const cache =
		typeof caches === 'undefined'
			? undefined
			: ((caches as CacheStorageWithDefault).default as unknown as EdgeCache | undefined);
	return { cache, fetch: (request) => fetch(request), now: () => Date.now() };
}

export default {
	fetch(request: Request, env: Env): Promise<Response> {
		return handleRequest(request, env, defaultRuntime());
	}
};
