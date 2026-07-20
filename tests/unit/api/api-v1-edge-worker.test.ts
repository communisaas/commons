import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
	EDGE_PROTOCOL_HEADER,
	EDGE_PROTOCOL_VERSION,
	RATE_TIER_RESPONSE_HEADER,
	handleRequest,
	type EdgeCache,
	type Env,
	type RateLimitBinding,
	type Runtime
} from '../../../workers/api-v1-edge/src/index';

const TOKEN = 'ck_live_0123456789abcdef0123456789abcdef';
const IP = '203.0.113.10';
const NOW = 1_800_000_000_000;

class FakeCache implements EdgeCache {
	entries = new Map<string, Response>();
	match = vi.fn(async (request: Request) => this.entries.get(request.url)?.clone());
	put = vi.fn(async (request: Request, response: Response) => {
		this.entries.set(request.url, response.clone());
	});
}

function limiter(success = true): RateLimitBinding & { limit: ReturnType<typeof vi.fn> } {
	return { limit: vi.fn().mockResolvedValue({ success }) };
}

function completeEnv() {
	return {
		COLD_TOKEN_LIMIT: limiter(),
		COLD_IP_LIMIT: limiter(),
		TIER_100_LIMIT: limiter(),
		TIER_300_LIMIT: limiter(),
		TIER_1000_LIMIT: limiter(),
		TIER_3000_LIMIT: limiter()
	} satisfies Required<Env>;
}

function apiRequest(path = '/api/v1/events', token = TOKEN): Request {
	return new Request(`https://commons.email${path}`, {
		headers: { Authorization: `Bearer ${token}`, 'cf-connecting-ip': IP }
	});
}

function originResponse(
	status = 200,
	signal?: 'inactive' | 'starter' | 'organization' | 'coalition' | 'invalid'
): Response {
	return new Response(JSON.stringify({ data: status === 200 ? { ok: true } : null }), {
		status,
		headers: {
			'Content-Type': 'application/json',
			...(signal ? { [RATE_TIER_RESPONSE_HEADER]: signal } : {})
		}
	});
}

function runtime(cache: FakeCache, fetchImpl = vi.fn().mockResolvedValue(originResponse())) {
	return {
		cache,
		fetch: fetchImpl,
		now: () => NOW
	} satisfies Runtime & { fetch: ReturnType<typeof vi.fn> };
}

describe('commons-api-v1-edge Worker', () => {
	beforeEach(() => vi.clearAllMocks());

	it('preserves public docs, CORS, and session-auth key management surfaces', async () => {
		const cache = new FakeCache();
		const fetchImpl = vi.fn().mockResolvedValue(originResponse());
		const rt = runtime(cache, fetchImpl);
		for (const request of [
			new Request('https://commons.email/api/v1/'),
			new Request('https://commons.email/api/v1/docs'),
			new Request('https://commons.email/api/v1/keys', { method: 'POST' }),
			new Request('https://commons.email/api/v1/events', { method: 'OPTIONS' })
		]) {
			await expect(handleRequest(request, {}, rt)).resolves.toHaveProperty('status', 200);
		}
		expect(fetchImpl).toHaveBeenCalledTimes(4);
	});

	it('rejects malformed or attacker-sized bearers before bindings and origin', async () => {
		const cache = new FakeCache();
		const env = completeEnv();
		const fetchImpl = vi.fn();
		for (const token of ['wrong', 'ck_live_attacker', `ck_live_${'x'.repeat(32)}`]) {
			const response = await handleRequest(apiRequest('/api/v1/events', token), env, runtime(cache, fetchImpl));
			expect(response.status).toBe(401);
		}
		expect(fetchImpl).not.toHaveBeenCalled();
		expect(env.COLD_TOKEN_LIMIT.limit).not.toHaveBeenCalled();
	});

	it('fails closed when any required binding, Cache API, or client IP is unavailable', async () => {
		const cache = new FakeCache();
		const env = completeEnv();
		const fetchImpl = vi.fn();
		const missingBinding = { ...env, TIER_300_LIMIT: undefined };
		await expect(
			handleRequest(apiRequest(), missingBinding, runtime(cache, fetchImpl))
		).resolves.toHaveProperty('status', 503);
		await expect(
			handleRequest(apiRequest(), env, { fetch: fetchImpl, now: () => NOW })
		).resolves.toHaveProperty('status', 503);
		const noIp = new Request('https://commons.email/api/v1/events', {
			headers: { Authorization: `Bearer ${TOKEN}` }
		});
		await expect(handleRequest(noIp, env, runtime(cache, fetchImpl))).resolves.toHaveProperty(
			'status',
			503
		);
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it('fails closed when the Cache API cannot establish a protection decision', async () => {
		const cache = new FakeCache();
		cache.match.mockRejectedValueOnce(new Error('cache unavailable'));
		const env = completeEnv();
		const fetchImpl = vi.fn();
		const response = await handleRequest(apiRequest(), env, runtime(cache, fetchImpl));
		expect(response.status).toBe(503);
		expect(env.COLD_TOKEN_LIMIT.limit).not.toHaveBeenCalled();
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it('uses bounded token+IP limits on cold miss, stores only a hash tier hint, and strips it', async () => {
		const cache = new FakeCache();
		const env = completeEnv();
		const fetchImpl = vi.fn(async (proxied: Request) => {
			expect(proxied.headers.get('Authorization')).toBe(`Bearer ${TOKEN}`);
			expect(proxied.headers.get(EDGE_PROTOCOL_HEADER)).toBe(EDGE_PROTOCOL_VERSION);
			return originResponse(200, 'starter');
		});
		const response = await handleRequest(apiRequest(), env, runtime(cache, fetchImpl));
		expect(response.status).toBe(200);
		expect(response.headers.has(RATE_TIER_RESPONSE_HEADER)).toBe(false);
		expect(env.COLD_TOKEN_LIMIT.limit).toHaveBeenCalledOnce();
		expect(env.COLD_IP_LIMIT.limit).toHaveBeenCalledOnce();
		expect(env.TIER_300_LIMIT.limit).not.toHaveBeenCalled();

		const tokenLimiterKey = env.COLD_TOKEN_LIMIT.limit.mock.calls[0][0].key as string;
		expect(tokenLimiterKey).toMatch(/^api-v1:cold-token:[a-f0-9]{64}$/);
		expect(tokenLimiterKey).not.toContain(TOKEN);
		for (const [key, value] of cache.entries) {
			expect(key).not.toContain(TOKEN);
			expect(await value.clone().text()).not.toContain(TOKEN);
		}
	});

	it('preserves an exact origin response when an optional hint write fails', async () => {
		const cache = new FakeCache();
		cache.put.mockRejectedValueOnce(new Error('cache write unavailable'));
		const env = completeEnv();
		const fetchImpl = vi.fn().mockResolvedValue(originResponse(200, 'starter'));
		const response = await handleRequest(apiRequest(), env, runtime(cache, fetchImpl));
		expect(response.status).toBe(200);
		expect(response.headers.has(RATE_TIER_RESPONSE_HEADER)).toBe(false);
		expect(fetchImpl).toHaveBeenCalledOnce();
	});

	it('uses the cached tier as a prefilter but still invokes exact origin auth on every pass', async () => {
		const cache = new FakeCache();
		const env = completeEnv();
		const fetchImpl = vi.fn().mockResolvedValue(originResponse(200, 'starter'));
		const rt = runtime(cache, fetchImpl);
		await handleRequest(apiRequest(), env, rt);
		await handleRequest(apiRequest(), env, rt);

		expect(env.COLD_TOKEN_LIMIT.limit).toHaveBeenCalledOnce();
		expect(env.COLD_IP_LIMIT.limit).toHaveBeenCalledOnce();
		expect(env.TIER_300_LIMIT.limit).toHaveBeenCalledOnce();
		expect(fetchImpl).toHaveBeenCalledTimes(2);
	});

	it('returns 429 + Retry-After before origin when a cached-tier binding rejects', async () => {
		const cache = new FakeCache();
		const env = completeEnv();
		const fetchImpl = vi.fn().mockResolvedValue(originResponse(200, 'inactive'));
		const rt = runtime(cache, fetchImpl);
		await handleRequest(apiRequest(), env, rt);
		env.TIER_100_LIMIT.limit.mockResolvedValueOnce({ success: false });
		const rejected = await handleRequest(apiRequest(), env, rt);
		expect(rejected.status).toBe(429);
		expect(rejected.headers.get('Retry-After')).toBe('60');
		expect(fetchImpl).toHaveBeenCalledOnce();
	});

	it('briefly negative-caches an exact invalid-key 401 by token hash', async () => {
		const cache = new FakeCache();
		const env = completeEnv();
		const fetchImpl = vi.fn().mockResolvedValue(originResponse(401, 'invalid'));
		const rt = runtime(cache, fetchImpl);
		const first = await handleRequest(apiRequest(), env, rt);
		const second = await handleRequest(apiRequest('/api/v1/supporters'), env, rt);
		expect(first.status).toBe(401);
		expect(second.status).toBe(401);
		expect(fetchImpl).toHaveBeenCalledOnce();
	});

	it('negative-caches a valid-key 403 only for the same method/path', async () => {
		const cache = new FakeCache();
		const env = completeEnv();
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(originResponse(403, 'starter'))
			.mockResolvedValueOnce(originResponse(200, 'starter'));
		const rt = runtime(cache, fetchImpl);
		const first = await handleRequest(apiRequest('/api/v1/events'), env, rt);
		const repeated = await handleRequest(apiRequest('/api/v1/events'), env, rt);
		const otherRoute = await handleRequest(apiRequest('/api/v1/supporters'), env, rt);
		expect([first.status, repeated.status, otherRoute.status]).toEqual([403, 403, 200]);
		expect(fetchImpl).toHaveBeenCalledTimes(2);
	});

	it('never lets a stale high-tier hint bypass an exact revocation response', async () => {
		const cache = new FakeCache();
		const env = completeEnv();
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(originResponse(200, 'coalition'))
			.mockResolvedValueOnce(originResponse(401, 'invalid'));
		const rt = runtime(cache, fetchImpl);
		await handleRequest(apiRequest(), env, rt);
		const revoked = await handleRequest(apiRequest(), env, rt);
		expect(revoked.status).toBe(401);
		expect(env.TIER_3000_LIMIT.limit).toHaveBeenCalledOnce();
		expect(fetchImpl).toHaveBeenCalledTimes(2);
	});

	it('corrects a stale high-tier hint immediately after an exact downgrade response', async () => {
		const cache = new FakeCache();
		const env = completeEnv();
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(originResponse(200, 'coalition'))
			.mockResolvedValueOnce(originResponse(429, 'inactive'))
			.mockResolvedValueOnce(originResponse(200, 'inactive'));
		const rt = runtime(cache, fetchImpl);
		await handleRequest(apiRequest(), env, rt);
		const downgraded = await handleRequest(apiRequest(), env, rt);
		expect(downgraded.status).toBe(429);
		await handleRequest(apiRequest(), env, rt);
		expect(env.TIER_3000_LIMIT.limit).toHaveBeenCalledOnce();
		expect(env.TIER_100_LIMIT.limit).toHaveBeenCalledOnce();
		expect(fetchImpl).toHaveBeenCalledTimes(3);
	});

	it('fails closed on a binding exception without calling origin', async () => {
		const cache = new FakeCache();
		const env = completeEnv();
		env.COLD_TOKEN_LIMIT.limit.mockRejectedValueOnce(new Error('binding down'));
		const fetchImpl = vi.fn();
		const response = await handleRequest(apiRequest(), env, runtime(cache, fetchImpl));
		expect(response.status).toBe(503);
		expect(fetchImpl).not.toHaveBeenCalled();
	});
});
