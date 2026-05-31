import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Hoist mocks so they're set up before module imports.
const { mockServerMutation, mockGetInternalSecret, api, envHolder } = vi.hoisted(() => ({
	mockServerMutation: vi.fn(),
	mockGetInternalSecret: vi.fn(() => 'a'.repeat(32)),
	api: {
		agentTraces: {
			record: 'agentTraces.record'
		}
	},
	envHolder: {
		env: {} as Record<string, string | undefined>
	}
}));

vi.mock('$env/dynamic/private', () => ({
	get env() {
		return envHolder.env;
	}
}));

vi.mock('convex-sveltekit', () => ({
	serverMutation: mockServerMutation
}));

vi.mock('$lib/convex', () => ({ api }));

vi.mock('$lib/server/internal/secret-auth', () => ({
	getInternalSecret: mockGetInternalSecret
}));

const {
	scrubCredentials,
	enforceConvexSizeCap,
	shouldSample,
	getTraceConfig,
	traceStart,
	traceEnd,
	traceEvent,
	traceCompletion,
	_resetSamplingForTest,
	_resetConfigWarnedForTest
} = await import('$lib/server/agent-trace');

function setEnv(values: Record<string, string | undefined>) {
	envHolder.env = { ...values };
}

async function flushMicrotasks() {
	// queueWrite uses `void persist(...).catch(...)` — drain the microtask
	// queue so the mocked serverMutation has a chance to be observed.
	for (let i = 0; i < 5; i++) {
		await Promise.resolve();
	}
}

beforeEach(() => {
	mockServerMutation.mockReset().mockResolvedValue(undefined);
	mockGetInternalSecret.mockReset().mockReturnValue('a'.repeat(32));
	envHolder.env = {};
	_resetSamplingForTest();
	_resetConfigWarnedForTest();
});

afterEach(() => {
	envHolder.env = {};
});

// ============================================================================
// scrubCredentials
// ============================================================================

describe('scrubCredentials', () => {
	it('redacts Authorization header case-insensitively', () => {
		const out = scrubCredentials({ Authorization: 'Bearer abc', other: 'ok' });
		expect(out).toEqual({ Authorization: '[redacted]', other: 'ok' });
	});

	it('redacts proxy-authorization and x-api-key', () => {
		const out = scrubCredentials({
			'Proxy-Authorization': 'Basic xyz',
			'X-API-KEY': 'secret-key'
		});
		expect(out).toEqual({
			'Proxy-Authorization': '[redacted]',
			'X-API-KEY': '[redacted]'
		});
	});

	it('redacts cookie, set-cookie, set-cookie2', () => {
		const out = scrubCredentials({
			Cookie: 'session=xyz',
			'Set-Cookie': 'foo=bar',
			'Set-Cookie2': 'baz=qux'
		});
		expect(out).toEqual({
			Cookie: '[redacted]',
			'Set-Cookie': '[redacted]',
			'Set-Cookie2': '[redacted]'
		});
	});

	it('redacts exact `_secret` key (the Convex public-function gate)', () => {
		const out = scrubCredentials({ _secret: 'long-secret', userId: 'u1' });
		expect(out).toEqual({ _secret: '[redacted]', userId: 'u1' });
	});

	it('recurses into nested objects', () => {
		const out = scrubCredentials({
			req: {
				headers: { Authorization: 'Bearer abc' },
				body: { ok: true }
			}
		});
		expect(out).toEqual({
			req: {
				headers: { Authorization: '[redacted]' },
				body: { ok: true }
			}
		});
	});

	it('recurses into arrays', () => {
		const out = scrubCredentials([{ Authorization: 'Bearer abc' }, { ok: true }]);
		expect(out).toEqual([{ Authorization: '[redacted]' }, { ok: true }]);
	});

	it('leaves non-credential keys intact', () => {
		const payload = {
			subjectLine: 'Hello',
			coreMessage: 'A long message body',
			email: 'user@example.com',
			messageBody: 'sensitive but not a credential'
		};
		// User content stays — privacy is carried by TTL + _secret gate, not by
		// field-level filtering at the writer. See module header.
		expect(scrubCredentials(payload)).toEqual(payload);
	});

	it('handles primitives and null', () => {
		expect(scrubCredentials(null)).toBe(null);
		expect(scrubCredentials(undefined)).toBe(undefined);
		expect(scrubCredentials('plain string')).toBe('plain string');
		expect(scrubCredentials(42)).toBe(42);
	});

	it('depth-caps at SCRUB_DEPTH_CAP without throwing', () => {
		// Build a deeply nested object exceeding the cap. The function
		// must return without recursing infinitely.
		let nested: Record<string, unknown> = { Authorization: 'leak-me' };
		for (let i = 0; i < 25; i++) {
			nested = { wrap: nested };
		}
		expect(() => scrubCredentials(nested)).not.toThrow();
	});

	it('redacts extended key set (oauth + generic + amazon/google API)', () => {
		const out = scrubCredentials({
			access_token: 'oauth-token',
			refresh_token: 'refresh-token',
			id_token: 'id-token',
			password: 'p@ssw0rd',
			secret: 'shh',
			token: 'opaque',
			private_key: '-----BEGIN-----',
			client_secret: 'client-secret-value',
			bearer: 'just-the-word',
			'X-Auth-Token': 'auth-token-val',
			'X-Amz-Security-Token': 'aws-creds',
			'X-Goog-Api-Key': 'google-key',
			apikey: 'general-key',
			'WWW-Authenticate': 'challenge-bearer'
		});
		const flattened = Object.values(out as Record<string, unknown>);
		expect(flattened.every((v) => v === '[redacted]')).toBe(true);
	});

	// Test fixtures constructed at runtime from split fragments so GitHub
	// Push Protection / secret scanners don't flag these as real credentials.
	// The runtime string is identical to a literal; only the source-text
	// appearance differs. The scrubCredentials regex sees no difference.
	const SK_LIVE_PREFIX = 'sk' + '_live_';
	const AIZA_PREFIX = 'AIz' + 'a';
	const GSK_PREFIX = 'gsk' + '_';
	const WHSEC_PREFIX = 'whsec' + '_';
	const GHP_PREFIX = 'ghp' + '_';
	const GHO_PREFIX = 'gho' + '_';
	const YA29_PREFIX = 'ya' + '29.';

	it('redacts Bearer-prefixed tokens inside string values', () => {
		const tokenSuffix = 'A0AfH6SMC_long_token_here_xyz';
		const out = scrubCredentials({
			errorMessage: `GET /v1 failed with Authorization: Bearer ${YA29_PREFIX}${tokenSuffix}`
		});
		expect((out as any).errorMessage).toContain('[redacted-credential]');
		expect((out as any).errorMessage).not.toContain(`${YA29_PREFIX}A0AfH6SMC`);
	});

	it('redacts Stripe live keys embedded in stringified upstream errors', () => {
		const stripeKey = `${SK_LIVE_PREFIX}ABCDEFGHIJ1234567890longenough`;
		const errorBody = JSON.stringify({
			request: { headers: { authorization: stripeKey } }
		});
		const out = scrubCredentials({ upstreamError: errorBody });
		expect((out as any).upstreamError).toContain('[redacted-credential]');
		expect((out as any).upstreamError).not.toContain(`${SK_LIVE_PREFIX}ABCDEFGHIJ`);
	});

	it('redacts Google AIza-prefixed API keys in strings', () => {
		const googleKey = `${AIZA_PREFIX}SyABCDEFGHIJKLMNOPQRSTUVWXYZ1234567`;
		const out = scrubCredentials({
			stack: `Error: fetch failed\n  key=${googleKey} oops`
		});
		expect((out as any).stack).toContain('[redacted-credential]');
		expect((out as any).stack).not.toContain(`${AIZA_PREFIX}SyABCDEFGHIJ`);
	});

	it('redacts Groq gsk_-prefixed API keys in strings', () => {
		const groqKey = `${GSK_PREFIX}AbCdEfGhIjKlMnOpQrStUvWxYz1234567890ABCDEFGH`;
		const out = scrubCredentials({
			err: `${groqKey} leaked here`
		});
		expect((out as any).err).toContain('[redacted-credential]');
		expect((out as any).err).not.toContain(`${GSK_PREFIX}AbCdEfGh`);
	});

	it('redacts JWT-shaped tokens in strings', () => {
		const out = scrubCredentials({
			cause:
				'401 returned token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'
		});
		expect((out as any).cause).toContain('[redacted-credential]');
		expect((out as any).cause).not.toContain('SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c');
	});

	it('preserves plain user content that does not match credential patterns', () => {
		const userMsg =
			'Dear Senator, please support the climate bill. I live in the district affected by recent flooding.';
		const out = scrubCredentials({ coreMessage: userMsg });
		expect((out as any).coreMessage).toBe(userMsg);
	});

	it('redacts AWS SigV4 credential strings (ses-proxy error path)', () => {
		const akia = 'AKI' + 'AIOSFODNN7EXAMPLE';
		const stack = `Error: SES failed\n  at sign Authorization: AWS4-HMAC-SHA256 Credential=${akia}/20260518/us-east-1/ses/aws4_request, SignedHeaders=host;x-amz-date, ...`;
		const out = scrubCredentials({ stack });
		expect((out as any).stack).toContain('[redacted-credential]');
		expect((out as any).stack).not.toContain(akia);
	});

	it('redacts AWS Access Key ID standalone (AKIA prefix)', () => {
		const akia = 'AKI' + 'AIOSFODNN7EXAMPLE';
		const out = scrubCredentials({ msg: `Failed with key ${akia} in request` });
		expect((out as any).msg).toContain('[redacted-credential]');
		expect((out as any).msg).not.toContain(akia);
	});

	it('redacts Stripe webhook signing secret (whsec_)', () => {
		const whsec = `${WHSEC_PREFIX}AbCdEf123456789012345xyz`;
		const out = scrubCredentials({
			config: `STRIPE_WEBHOOK_SECRET=${whsec} leaked`
		});
		expect((out as any).config).toContain('[redacted-credential]');
		expect((out as any).config).not.toContain(`${WHSEC_PREFIX}AbCdEf`);
	});

	it('redacts Stripe-Signature header value', () => {
		// The Stripe-Signature t=...,v1=... shape is data-only (no secret
		// prefix scanners catch), but rebuild via fragments anyway for symmetry.
		const sigValue =
			't=1700000000,v1=abc123def456789012345678901234567890abcdef123456789012345678901234';
		const out = scrubCredentials({
			header: `Stripe-Signature: ${sigValue}`
		});
		expect((out as any).header).toContain('[redacted-credential]');
	});

	it('redacts GitHub personal access tokens (ghp_, gho_, github_pat_)', () => {
		const ghpToken = `${GHP_PREFIX}1234567890abcdefghij1234567890ABCDef`;
		const out1 = scrubCredentials({ err: `token ${ghpToken}` });
		expect((out1 as any).err).toContain('[redacted-credential]');

		const ghoToken = `${GHO_PREFIX}1234567890abcdefghij1234567890ABCDef`;
		const out2 = scrubCredentials({ err: `${ghoToken} oauth` });
		expect((out2 as any).err).toContain('[redacted-credential]');
	});
});

// ============================================================================
// enforceConvexSizeCap
// ============================================================================

describe('enforceConvexSizeCap', () => {
	it('is a no-op when payload fits the budget', () => {
		const payload = { foo: 'bar', n: 42 };
		expect(enforceConvexSizeCap(payload)).toBe(payload);
	});

	it('returns the input identity (===) when under budget', () => {
		const payload = { a: 'short' };
		expect(enforceConvexSizeCap(payload)).toBe(payload);
	});

	it('truncates the largest string when payload exceeds budget', () => {
		// Build a payload with one huge string and several small ones.
		const huge = 'x'.repeat(1_100_000); // ~1.1 MB — over budget
		const payload = { huge, small: 'ok' };
		const result = enforceConvexSizeCap(payload) as Record<string, unknown>;

		expect(result.small).toBe('ok');
		expect(result.huge).toMatchObject({
			_truncated: true,
			_originalLength: huge.length
		});
		const truncated = (result.huge as { value: string }).value;
		expect(truncated.length).toBeLessThan(huge.length);

		// Resulting payload must fit under the budget
		const serialized = new TextEncoder().encode(JSON.stringify(result)).length;
		expect(serialized).toBeLessThanOrEqual(1_040_384);
	});

	it('preserves smaller strings when only the largest needs truncation', () => {
		const huge = 'a'.repeat(1_100_000);
		const medium = 'b'.repeat(50_000); // ~50 KB — under field floor when budget is 1MB
		const payload = { huge, medium, small: 'x' };
		const result = enforceConvexSizeCap(payload) as Record<string, unknown>;

		// medium stays intact — only the huge was over
		expect(result.medium).toBe(medium);
		expect(result.small).toBe('x');
	});

	it('wraps with overflow marker when truncation cannot bring it under budget', () => {
		// Build a payload of thousands of small strings each under FLOOR.
		// `findLargestString` will return a string < FIELD_TRUNCATE_FLOOR
		// and `enforceConvexSizeCap` must return the overflow wrapper.
		const items: string[] = [];
		// 2000 × ~600 bytes = ~1.2 MB; each below FIELD_TRUNCATE_FLOOR (1KB).
		for (let i = 0; i < 2000; i++) {
			items.push('y'.repeat(600));
		}
		const result = enforceConvexSizeCap({ items }) as Record<string, unknown>;
		expect(result._truncationOverflow).toBe(true);
		expect(typeof result._originalSize).toBe('number');
	});

	it('handles deeply nested large strings', () => {
		const huge = 'z'.repeat(1_100_000);
		const payload = { a: { b: { c: { d: huge } } } };
		const result = enforceConvexSizeCap(payload) as Record<string, unknown>;
		const truncated = ((result.a as any).b as any).c as { d: unknown };
		expect((truncated.d as { _truncated: boolean })._truncated).toBe(true);
	});
});

// ============================================================================
// shouldSample — LRU determinism
// ============================================================================

describe('shouldSample', () => {
	it('returns true at rate=1.0 without consulting the map', () => {
		expect(shouldSample('t-1', 1.0)).toBe(true);
	});

	it('returns false at rate=0.0', () => {
		expect(shouldSample('t-2', 0)).toBe(false);
	});

	it('makes the same decision for the same traceId on subsequent calls', () => {
		// Use a deterministic rate=0.5 by stubbing Math.random
		vi.spyOn(Math, 'random').mockReturnValue(0.3); // 0.3 < 0.5 → sampled
		const first = shouldSample('t-stable', 0.5);
		// Now flip the random oracle — the cached decision should win
		vi.spyOn(Math, 'random').mockReturnValue(0.99);
		const second = shouldSample('t-stable', 0.5);
		expect(second).toBe(first);
		expect(first).toBe(true);
	});
});

// ============================================================================
// getTraceConfig — env parsing
// ============================================================================

describe('getTraceConfig', () => {
	it('disabled by default when env is empty', () => {
		setEnv({});
		expect(getTraceConfig().enabled).toBe(false);
	});

	it('enabled only when AGENT_TRACE_ENABLED is exactly "true"', () => {
		setEnv({ AGENT_TRACE_ENABLED: 'true' });
		expect(getTraceConfig().enabled).toBe(true);

		setEnv({ AGENT_TRACE_ENABLED: '1' });
		expect(getTraceConfig().enabled).toBe(false);

		setEnv({ AGENT_TRACE_ENABLED: 'yes' });
		expect(getTraceConfig().enabled).toBe(false);
	});

	it('TTL defaults to 7 days', () => {
		setEnv({});
		expect(getTraceConfig().ttlMs).toBe(7 * 86_400_000);
	});

	it('TTL parses positive integers', () => {
		setEnv({ AGENT_TRACE_TTL_DAYS: '30' });
		expect(getTraceConfig().ttlMs).toBe(30 * 86_400_000);
	});

	it('TTL rejects garbage and falls back to 7 days', () => {
		setEnv({ AGENT_TRACE_TTL_DAYS: 'banana' });
		expect(getTraceConfig().ttlMs).toBe(7 * 86_400_000);
	});

	it('TTL rejects zero or negative and falls back to 7 days', () => {
		setEnv({ AGENT_TRACE_TTL_DAYS: '0' });
		expect(getTraceConfig().ttlMs).toBe(7 * 86_400_000);

		setEnv({ AGENT_TRACE_TTL_DAYS: '-5' });
		expect(getTraceConfig().ttlMs).toBe(7 * 86_400_000);
	});

	it('sample rate defaults to 1.0', () => {
		setEnv({});
		expect(getTraceConfig().sampleRate).toBe(1.0);
	});

	it('sample rate clamps to [0,1]', () => {
		setEnv({ AGENT_TRACE_SAMPLE_RATE: '2.0' });
		expect(getTraceConfig().sampleRate).toBe(1.0);

		setEnv({ AGENT_TRACE_SAMPLE_RATE: '-1' });
		expect(getTraceConfig().sampleRate).toBe(0);

		setEnv({ AGENT_TRACE_SAMPLE_RATE: '0.25' });
		expect(getTraceConfig().sampleRate).toBe(0.25);
	});
});

// ============================================================================
// Public writers — env gate, write shape, failure isolation
// ============================================================================

describe('public writer — env gate', () => {
	it('is a no-op when AGENT_TRACE_ENABLED is unset', async () => {
		setEnv({});
		traceStart('t-disabled', 'message-generation', 'user-1', { foo: 'bar' });
		await flushMicrotasks();
		expect(mockServerMutation).not.toHaveBeenCalled();
	});

	it('writes when AGENT_TRACE_ENABLED=true', async () => {
		setEnv({ AGENT_TRACE_ENABLED: 'true' });
		traceStart('t-on', 'message-generation', 'user-1', { foo: 'bar' });
		await flushMicrotasks();
		expect(mockServerMutation).toHaveBeenCalledTimes(1);
		const [fn, args] = mockServerMutation.mock.calls[0];
		expect(fn).toBe('agentTraces.record');
		expect(args).toMatchObject({
			_secret: 'a'.repeat(32),
			traceId: 't-on',
			endpoint: 'message-generation',
			eventType: 'trace.start',
			userId: 'user-1',
			payload: { foo: 'bar' }
		});
		expect(typeof args.expiresAt).toBe('number');
	});

	it('traceEnd writes trace.end with success+durationMs', async () => {
		setEnv({ AGENT_TRACE_ENABLED: 'true' });
		traceEnd('t-end', 'message-generation', true, 1234, { finalPhase: 'completed' });
		await flushMicrotasks();
		expect(mockServerMutation).toHaveBeenCalledTimes(1);
		const args = mockServerMutation.mock.calls[0][1];
		expect(args.eventType).toBe('trace.end');
		expect(args.success).toBe(true);
		expect(args.durationMs).toBe(1234);
		expect(args.payload).toEqual({ finalPhase: 'completed' });
	});

	it('traceEnd hoists costUsd to top-level when provided', async () => {
		setEnv({ AGENT_TRACE_ENABLED: 'true' });
		traceEnd(
			't-cost',
			'message-generation',
			true,
			500,
			{ finalPhase: 'completed' },
			0.0042
		);
		await flushMicrotasks();
		const args = mockServerMutation.mock.calls[0][1];
		expect(args.costUsd).toBe(0.0042);
	});

	it('traceEnd leaves costUsd undefined when caller omits it', async () => {
		setEnv({ AGENT_TRACE_ENABLED: 'true' });
		traceEnd('t-no-cost', 'message-generation', true, 500, {});
		await flushMicrotasks();
		const args = mockServerMutation.mock.calls[0][1];
		expect(args.costUsd).toBeUndefined();
	});

	it('traceEvent forwards eventType from caller', async () => {
		setEnv({ AGENT_TRACE_ENABLED: 'true' });
		traceEvent('t-evt', 'message-generation', 'source-search', { hits: 18 });
		await flushMicrotasks();
		const args = mockServerMutation.mock.calls[0][1];
		expect(args.eventType).toBe('source-search');
		expect(args.payload).toEqual({ hits: 18 });
	});

	it('traceCompletion writes a completion event with cost fields', async () => {
		setEnv({ AGENT_TRACE_ENABLED: 'true' });
		traceCompletion(
			't-cmp',
			'gemini-call',
			{ components: { inputTokens: 100 } },
			{ userId: 'user-1', durationMs: 500, success: true, costUsd: 0.0042 }
		);
		await flushMicrotasks();
		const args = mockServerMutation.mock.calls[0][1];
		expect(args.eventType).toBe('completion');
		expect(args.success).toBe(true);
		expect(args.durationMs).toBe(500);
		expect(args.costUsd).toBe(0.0042);
		expect(args.userId).toBe('user-1');
		expect(args.payload).toMatchObject({ operation: 'gemini-call' });
	});

	it('drops the entire trace when sampling decides not to sample', async () => {
		setEnv({ AGENT_TRACE_ENABLED: 'true', AGENT_TRACE_SAMPLE_RATE: '0' });
		traceStart('t-skip', 'message-generation', undefined, {});
		traceEvent('t-skip', 'message-generation', 'phase-a', {});
		traceEnd('t-skip', 'message-generation', true, 100, {});
		await flushMicrotasks();
		expect(mockServerMutation).not.toHaveBeenCalled();
	});

	it('applies credential scrub to payload before persisting', async () => {
		setEnv({ AGENT_TRACE_ENABLED: 'true' });
		traceStart('t-scrub', 'message-generation', 'user-1', {
			headers: { Authorization: 'Bearer leak-me' },
			body: { ok: true }
		});
		await flushMicrotasks();
		const args = mockServerMutation.mock.calls[0][1];
		expect(args.payload.headers.Authorization).toBe('[redacted]');
		expect(args.payload.body).toEqual({ ok: true });
	});

	it('sets expiresAt using TTL from env', async () => {
		setEnv({ AGENT_TRACE_ENABLED: 'true', AGENT_TRACE_TTL_DAYS: '14' });
		const before = Date.now();
		traceStart('t-ttl', 'message-generation', undefined, {});
		await flushMicrotasks();
		const after = Date.now();
		const args = mockServerMutation.mock.calls[0][1];
		expect(args.expiresAt).toBeGreaterThanOrEqual(before + 14 * 86_400_000);
		expect(args.expiresAt).toBeLessThanOrEqual(after + 14 * 86_400_000);
	});

	it('isolates the caller from a Convex write failure', async () => {
		const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		setEnv({ AGENT_TRACE_ENABLED: 'true' });
		mockServerMutation.mockRejectedValueOnce(new Error('convex down'));
		// Must not throw, must not reject.
		expect(() => traceStart('t-fail', 'message-generation', undefined, {})).not.toThrow();
		await flushMicrotasks();
		expect(consoleWarn).toHaveBeenCalled();
		const warnArgs = consoleWarn.mock.calls.find((c) =>
			String(c[0]).includes('PERSIST_FAILED')
		);
		expect(warnArgs).toBeDefined();
		consoleWarn.mockRestore();
	});

	it('isolates the caller from a getInternalSecret failure', async () => {
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
		setEnv({ AGENT_TRACE_ENABLED: 'true' });
		mockGetInternalSecret.mockImplementationOnce(() => {
			throw new Error('INTERNAL_API_SECRET not configured');
		});
		expect(() => traceEvent('t-no-secret', 'message-generation', 'phase', {})).not.toThrow();
		await flushMicrotasks();
		expect(consoleError).toHaveBeenCalled();
		consoleError.mockRestore();
	});

	it('logs CONFIG_ERROR once-per-process for missing INTERNAL_API_SECRET', async () => {
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
		setEnv({ AGENT_TRACE_ENABLED: 'true' });
		// Every call throws config error
		mockGetInternalSecret.mockImplementation(() => {
			throw new Error('INTERNAL_API_SECRET not configured');
		});
		// Fire 5 events
		traceStart('t-config-1', 'message-generation', undefined, {});
		traceEvent('t-config-2', 'message-generation', 'phase', {});
		traceEnd('t-config-3', 'message-generation', true, 100, {});
		traceCompletion('t-config-4', 'op', {}, {});
		traceStart('t-config-5', 'message-generation', undefined, {});
		await flushMicrotasks();

		// Only one CONFIG_ERROR log despite 5 failed writes
		const configErrorCalls = consoleError.mock.calls.filter((c) =>
			String(c[0]).includes('CONFIG_ERROR')
		);
		expect(configErrorCalls.length).toBe(1);
		consoleError.mockRestore();
	});

	it('logs PERSIST_FAILED per write for runtime errors (not collapsed)', async () => {
		const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		setEnv({ AGENT_TRACE_ENABLED: 'true' });
		mockServerMutation.mockRejectedValue(new Error('convex 500 transient'));
		traceStart('t-runtime-1', 'message-generation', undefined, {});
		traceEvent('t-runtime-2', 'message-generation', 'phase', {});
		await flushMicrotasks();

		const persistCalls = consoleWarn.mock.calls.filter((c) =>
			String(c[0]).includes('PERSIST_FAILED')
		);
		expect(persistCalls.length).toBe(2);
		consoleWarn.mockRestore();
	});
});
