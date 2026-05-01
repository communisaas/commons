import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
	mockModeratePromptOnly,
	mockEnforceLLMRateLimit,
	mockGenerateMessage,
	mockServerMutation,
	mockServerQuery,
	mockEncryptMessageJobResult,
	mockCreateSSEStream,
	mockEmitter,
	api
} = vi.hoisted(() => {
	const mockEmitter = {
		send: vi.fn(),
		complete: vi.fn(),
		error: vi.fn(),
		close: vi.fn()
	};

	return {
		mockModeratePromptOnly: vi.fn(),
		mockEnforceLLMRateLimit: vi.fn(),
		mockGenerateMessage: vi.fn(),
		mockServerMutation: vi.fn(),
		mockServerQuery: vi.fn(),
		mockEncryptMessageJobResult: vi.fn(),
		mockCreateSSEStream: vi.fn(() => ({
			stream: new ReadableStream({
				start(controller) {
					controller.close();
				}
			}),
			emitter: mockEmitter
		})),
		mockEmitter,
		api: {
			messageJobs: {
				startOrGet: 'messageJobs.startOrGet',
				markRunning: 'messageJobs.markRunning',
				checkpointPhase: 'messageJobs.checkpointPhase',
				completeEncrypted: 'messageJobs.completeEncrypted',
				fail: 'messageJobs.fail'
			},
			templates: {
				getSourceCache: 'templates.getSourceCache',
				updateSourceCache: 'templates.updateSourceCache'
			}
		}
	};
});

vi.mock('$lib/core/server/moderation', () => ({
	moderatePromptOnly: mockModeratePromptOnly
}));

vi.mock('$lib/server/llm-cost-protection', () => ({
	enforceLLMRateLimit: mockEnforceLLMRateLimit,
	rateLimitResponse: vi.fn(() => new Response(JSON.stringify({ error: 'Rate limited' }), { status: 429 })),
	addRateLimitHeaders: vi.fn(),
	getUserContext: vi.fn(() => ({ userId: 'test-user', tier: 'authenticated' })),
	logLLMOperation: vi.fn()
}));

vi.mock('$lib/core/agents/agents/message-writer', () => ({
	generateMessage: mockGenerateMessage
}));

vi.mock('$lib/core/agents/utils/thought-filter', () => ({
	cleanThoughtForDisplay: vi.fn((thought: string) => thought)
}));

vi.mock('$lib/server/sse-stream', () => ({
	createSSEStream: mockCreateSSEStream,
	SSE_HEADERS: { 'Content-Type': 'text/event-stream' }
}));

vi.mock('convex-sveltekit', () => ({
	serverMutation: mockServerMutation,
	serverQuery: mockServerQuery
}));

vi.mock('$lib/convex', () => ({ api }));

vi.mock('$lib/server/message-job-encryption', () => ({
	encryptMessageJobResult: mockEncryptMessageJobResult
}));

vi.mock('../../../src/routes/api/agents/stream-message/$types', () => ({}));

const { POST } = await import('../../../src/routes/api/agents/stream-message/+server');

function baseBody(overrides: Record<string, unknown> = {}) {
	return {
		subject_line: 'Clean water',
		core_message: 'Protect the watershed',
		topics: ['water'],
		decision_makers: [{ name: 'A. Mayor', title: 'Mayor', organization: 'City' }],
		...overrides
	};
}

function createEvent(body: unknown): any {
	const event: any = {
		request: {
			json: () => Promise.resolve(body)
		},
		locals: {
			session: { userId: 'test-user' }
		},
		platform: {
			context: {
				waitUntil: vi.fn((promise: Promise<unknown>) => {
					event.waitUntilPromise = promise;
				})
			}
		},
		waitUntilPromise: Promise.resolve()
	};
	return event;
}

const HASH_1 = 'a'.repeat(64);
const HASH_2 = 'b'.repeat(64);
const PUBLIC_JWK = { kty: 'RSA', n: 'modulus', e: 'AQAB' };

describe('POST /api/agents/stream-message recoverable jobs', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockEnforceLLMRateLimit.mockResolvedValue({ allowed: true, remaining: 10 });
		mockModeratePromptOnly.mockResolvedValue({
			safe: true,
			score: 0.05,
			threshold: 0.8,
			timestamp: new Date().toISOString(),
			model: 'test'
		});
		mockGenerateMessage.mockResolvedValue({
			message: 'Generated message',
			sources: [],
			evaluatedSources: [],
			research_log: [],
			tokenUsage: { input: 1, output: 1, total: 2 },
			externalCounts: {}
		});
		mockEncryptMessageJobResult.mockResolvedValue({
			encryptedResult: { version: 1, ciphertext: 'sealed' },
			encryptionMeta: { version: 1 }
		});
	});

	it('requires the full recovery tuple when any job field is provided', async () => {
		const response = await POST(createEvent(baseBody({ job_id: 'job-1' })));

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toMatchObject({
			error: 'job_id, input_hash, and recovery_public_key_jwk are required together'
		});
		expect(mockCreateSSEStream).not.toHaveBeenCalled();
		expect(mockGenerateMessage).not.toHaveBeenCalled();
	});

	it('rejects malformed recovery metadata before creating a stream', async () => {
		const response = await POST(
			createEvent(
				baseBody({
					job_id: 'job-1',
					input_hash: HASH_1,
					recovery_public_key_jwk: { kty: 'RSA' }
				})
			)
		);

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toMatchObject({
			error: 'Invalid recovery public key'
		});
		expect(mockCreateSSEStream).not.toHaveBeenCalled();
		expect(mockServerMutation).not.toHaveBeenCalled();
	});

	it('does not start a duplicate LLM run for an existing active job', async () => {
		const activeJob = { jobId: 'job-1', inputHash: HASH_1, status: 'running' };
		mockServerMutation.mockImplementation(async (fn: string) => {
			if (fn === api.messageJobs.startOrGet) return { created: false, job: activeJob };
			throw new Error(`unexpected mutation: ${fn}`);
		});

		const event = createEvent(
			baseBody({
				job_id: 'job-1',
				input_hash: HASH_1,
				recovery_public_key_jwk: PUBLIC_JWK
			})
		);
		const response = await POST(event);
		await event.waitUntilPromise;

		expect(response.status).toBe(200);
		expect(mockGenerateMessage).not.toHaveBeenCalled();
		expect(mockEmitter.send).toHaveBeenCalledWith('job-running', { job: activeJob });
	});

	it('persists encrypted completion for a newly created recoverable job', async () => {
		const job = { jobId: 'job-2', inputHash: HASH_2, status: 'pending' };
		mockServerMutation.mockImplementation(async (fn: string) => {
			if (fn === api.messageJobs.startOrGet) return { created: true, job };
			return null;
		});

		const event = createEvent(
			baseBody({
				job_id: 'job-2',
				input_hash: HASH_2,
				recovery_public_key_jwk: PUBLIC_JWK
			})
		);
		const response = await POST(event);
		await event.waitUntilPromise;

		expect(response.status).toBe(200);
		expect(mockServerMutation).toHaveBeenCalledWith(api.messageJobs.markRunning, {
			jobId: 'job-2',
			phase: 'sources'
		});
		expect(mockEncryptMessageJobResult).toHaveBeenCalledWith(
			{
				message: 'Generated message',
				sources: [],
				evaluatedSources: [],
				research_log: []
			},
			PUBLIC_JWK,
			'job-2',
			HASH_2
		);
		expect(mockServerMutation).toHaveBeenCalledWith(api.messageJobs.completeEncrypted, {
			jobId: 'job-2',
			encryptedResult: { version: 1, ciphertext: 'sealed' },
			encryptionMeta: { version: 1 }
		});
		expect(mockEmitter.complete).toHaveBeenCalledWith({
			message: 'Generated message',
			sources: [],
			evaluatedSources: [],
			research_log: []
		});
	});
});
