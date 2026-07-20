import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
	consumePublicTemplateOgBatch,
	processPublicTemplateOgJob
} from '../../../workers/public-template-og-consumer';
import {
	buildPublicTemplateOgQueueJob,
	publicTemplatePageArtifactObjectKeys
} from '$lib/server/public-template-og-queue';
import { readPublicTemplateOgImage } from '$lib/server/public-template-og-image';
import consumerSource from '../../../workers/public-template-og-consumer.ts?raw';
import workerConfig from '../../../wrangler.public-template-og.toml?raw';

const BACKEND = 'https://production.example.convex.cloud';
const SOURCE_SHA = 'a'.repeat(40);
const TRANSACTION_ID = '123456789-2';

type Stored = {
	body: Uint8Array;
	customMetadata?: Record<string, string>;
	httpMetadata?: R2HTTPMetadata;
	etag: string;
};

async function bodyBytes(value: Parameters<R2Bucket['put']>[1]): Promise<Uint8Array> {
	if (typeof value === 'string') return new TextEncoder().encode(value);
	if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
	if (ArrayBuffer.isView(value)) {
		return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
	}
	if (value instanceof Blob) return new Uint8Array(await value.arrayBuffer());
	throw new Error('unsupported test body');
}

function detailFixture() {
	return {
		id: 'template-clean-water',
		slug: 'clean-water',
		title: 'Protect clean water',
		description: 'Ask the agency to protect clean water.',
		domain: 'environment',
		type: 'email',
		deliveryMethod: 'email',
		subject: 'Protect clean water',
		message_body: 'Please protect clean water.',
		sources: [],
		research_log: [],
		preview: 'Please protect clean water.',
		is_public: true,
		verified_sends: 42,
		unique_districts: 3,
		send_count: 42,
		delivery_config: {},
		cwc_config: null,
		recipient_config: { emails: [] },
		recipient_count: 0,
		recipientEmails: [],
		topics: ['water'],
		createdAt: '2026-07-18T00:00:00.000Z',
		author: { name: 'Commons', avatar: null }
	};
}

function artifactFixture() {
	return {
		version: 1,
		slug: 'clean-water',
		detail: detailFixture(),
		aggregate: {
			templateId: 'template-clean-water',
			messageMetrics: { districtCounts: {}, totalDistricts: 0 },
			debate: null,
			positionMetrics: {
				counts: { support: null, oppose: null, districts: null },
				engagement: null
			}
		}
	};
}

function fixture() {
	const entries = new Map<string, Stored>();
	let nextEtag = 1;
	let deleteJsonAfterFirstRead = false;
	const object = (key: string, stored: Stored) => ({
		arrayBuffer: async () => stored.body.slice().buffer,
		customMetadata: stored.customMetadata,
		etag: stored.etag,
		httpEtag: `"${stored.etag}"`,
		httpMetadata: stored.httpMetadata,
		json: async <T>() => JSON.parse(new TextDecoder().decode(stored.body)) as T,
		key,
		size: stored.body.byteLength,
		text: async () => new TextDecoder().decode(stored.body),
		uploaded: new Date(1_900_000_000_000)
	});
	const get = vi.fn(async (key: string) => {
		const stored = entries.get(key);
		if (!stored) return null;
		const result = object(key, stored);
		if (deleteJsonAfterFirstRead && key.endsWith('/payload.json')) {
			deleteJsonAfterFirstRead = false;
			entries.delete(key);
		}
		return result;
	});
	const head = vi.fn(async (key: string) => {
		const stored = entries.get(key);
		return stored ? object(key, stored) : null;
	});
	const put = vi.fn(
		async (
			key: string,
			value: Parameters<R2Bucket['put']>[1],
			options?: Parameters<R2Bucket['put']>[2]
		) => {
			const existing = entries.get(key);
			const ifNoneMatch =
				options?.onlyIf instanceof Headers ? options.onlyIf.get('If-None-Match') : null;
			const etagDoesNotMatch =
				options?.onlyIf && !(options.onlyIf instanceof Headers)
					? options.onlyIf.etagDoesNotMatch
					: undefined;
			if ((ifNoneMatch === '*' || etagDoesNotMatch === '*') && existing) return null;
			const stored: Stored = {
				body: await bodyBytes(value),
				customMetadata: options?.customMetadata,
				httpMetadata:
					options?.httpMetadata instanceof Headers
						? { contentType: options.httpMetadata.get('content-type') ?? undefined }
						: options?.httpMetadata,
				etag: `etag-${nextEtag++}`
			};
			entries.set(key, stored);
			return object(key, stored);
		}
	);
	const remove = vi.fn(async (keys: string | string[]) => {
		for (const key of Array.isArray(keys) ? keys : [keys]) entries.delete(key);
	});
	const bucket = { delete: remove, get, head, put } as unknown as R2Bucket;
	const env = {
		PUBLIC_CONVEX_URL: BACKEND,
		PUBLIC_DISCOVERY_R2: bucket,
		PUBLIC_RELEASE_SHA: SOURCE_SHA,
		PUBLIC_RELEASE_TRANSACTION_ID: TRANSACTION_ID
	};
	const job = buildPublicTemplateOgQueueJob({
		backend: BACKEND,
		revision: 7,
		sourceSha: SOURCE_SHA,
		slug: 'clean-water',
		transactionId: TRANSACTION_ID
	});
	const keys = publicTemplatePageArtifactObjectKeys(job);
	const seedJson = (body: unknown = { cachedAt: 1_900_000_000_000, revision: '7', value: artifactFixture() }) => {
		entries.set(keys.payload, {
			body: new TextEncoder().encode(JSON.stringify(body)),
			customMetadata: { kind: 'payload', revision: '7' },
			httpMetadata: { contentType: 'application/json' },
			etag: `seed-${nextEtag++}`
		});
	};
	const message = () => ({ ack: vi.fn(), body: job, retry: vi.fn() });
	return {
		bucket,
		entries,
		env,
		get,
		job,
		keys,
		message,
		put,
		remove,
		seedJson,
		setDeleteJsonAfterFirstRead: () => {
			deleteJsonAfterFirstRead = true;
		}
	};
}

describe('public template OG Queue consumer', () => {
	beforeEach(() => {
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		vi.spyOn(console, 'warn').mockImplementation(() => undefined);
	});

	afterEach(() => vi.restoreAllMocks());

	it('immutably publishes an exact PNG and makes at-least-once delivery idempotent', async () => {
		const f = fixture();
		f.seedJson();
		await processPublicTemplateOgJob(f.job, f.env);
		const png = f.entries.get(f.keys.ogImage)!;
		expect(png.customMetadata).toEqual({
			kind: 'template-og-image',
			revision: '7',
			schema: '1',
			slug: 'clean-water'
		});
		expect(png.httpMetadata).toEqual({ contentType: 'image/png' });
		expect(() => readPublicTemplateOgImage(png.body)).not.toThrow();
		expect(f.put).toHaveBeenCalledTimes(1);

		await processPublicTemplateOgJob(f.job, f.env);
		expect(f.put).toHaveBeenCalledTimes(1);
		expect(f.get.mock.calls.every(([key]) => [f.keys.payload, f.keys.ogImage].includes(key))).toBe(
			true
		);
	});

	it('cleans and acknowledges a delayed job after JSON retirement', async () => {
		const f = fixture();
		f.entries.set(f.keys.ogImage, {
			body: new Uint8Array([1]),
			etag: 'orphan'
		});
		const message = f.message();
		await consumePublicTemplateOgBatch({ messages: [message] }, f.env);
		expect(message.ack).toHaveBeenCalledOnce();
		expect(message.retry).not.toHaveBeenCalled();
		expect(f.entries.has(f.keys.ogImage)).toBe(false);
	});

	it('acknowledges superseded and legacy jobs before the first R2 operation', async () => {
		for (const body of [
			{ ...fixture().job, transactionId: '123456789-1' },
			{
				version: 1,
				backend: BACKEND,
				revision: '7',
				slug: 'clean-water'
			}
		]) {
			const f = fixture();
			const message = { ack: vi.fn(), body, retry: vi.fn() };
			await consumePublicTemplateOgBatch({ messages: [message] }, f.env);
			expect(message.ack).toHaveBeenCalledOnce();
			expect(message.retry).not.toHaveBeenCalled();
			expect(f.get).not.toHaveBeenCalled();
			expect(f.put).not.toHaveBeenCalled();
			expect(f.remove).not.toHaveBeenCalled();
		}
	});

	it('deletes a PNG created across a pair-GC race before acknowledging the stale job', async () => {
		const f = fixture();
		f.seedJson();
		f.setDeleteJsonAfterFirstRead();
		const message = f.message();
		await consumePublicTemplateOgBatch({ messages: [message] }, f.env);
		expect(message.ack).toHaveBeenCalledOnce();
		expect(f.entries.has(f.keys.ogImage)).toBe(false);
		expect(f.remove).toHaveBeenCalledWith(f.keys.ogImage);
	});

	it.each([
		['protocol poison', { version: 2, backend: BACKEND, revision: '7', slug: 'clean-water' }],
		[
			'realm poison',
			buildPublicTemplateOgQueueJob({
				backend: 'https://other.example.convex.cloud',
				revision: 7,
				sourceSha: SOURCE_SHA,
				slug: 'clean-water',
				transactionId: TRANSACTION_ID
			})
		]
	])('retries %s so configured max_retries moves it to the DLQ', async (_label, body) => {
		const f = fixture();
		const message = { ack: vi.fn(), body, retry: vi.fn() };
		await consumePublicTemplateOgBatch({ messages: [message] }, f.env);
		expect(message.ack).not.toHaveBeenCalled();
		expect(message.retry).toHaveBeenCalledWith({ delaySeconds: 120 });
	});

	it('retries corrupt immutable JSON/PNG and transient R2 faults instead of acknowledging', async () => {
		const corruptJson = fixture();
		corruptJson.seedJson({ revision: '7', value: artifactFixture() });
		const jsonMessage = corruptJson.message();
		await consumePublicTemplateOgBatch({ messages: [jsonMessage] }, corruptJson.env);
		expect(jsonMessage.retry).toHaveBeenCalledOnce();
		expect(jsonMessage.ack).not.toHaveBeenCalled();

		const corruptPng = fixture();
		corruptPng.seedJson();
		corruptPng.entries.set(corruptPng.keys.ogImage, {
			body: new Uint8Array([1, 2, 3]),
			customMetadata: {
				kind: 'template-og-image',
				revision: '7',
				schema: '1',
				slug: 'clean-water'
			},
			httpMetadata: { contentType: 'image/png' },
			etag: 'corrupt'
		});
		const pngMessage = corruptPng.message();
		await consumePublicTemplateOgBatch({ messages: [pngMessage] }, corruptPng.env);
		expect(pngMessage.retry).toHaveBeenCalledOnce();
		expect(pngMessage.ack).not.toHaveBeenCalled();

		const transient = fixture();
		vi.mocked(transient.bucket.get).mockRejectedValueOnce(new Error('R2 unavailable'));
		const transientMessage = transient.message();
		await consumePublicTemplateOgBatch({ messages: [transientMessage] }, transient.env);
		expect(transientMessage.retry).toHaveBeenCalledOnce();
		expect(transientMessage.ack).not.toHaveBeenCalled();
	});

	it('never falls back to a second or unconditional PUT when conditional create errors', async () => {
		const f = fixture();
		f.seedJson();
		f.put.mockRejectedValueOnce(new Error('conditional R2 API unavailable'));
		const message = f.message();
		await consumePublicTemplateOgBatch({ messages: [message] }, f.env);
		expect(message.retry).toHaveBeenCalledOnce();
		expect(message.ack).not.toHaveBeenCalled();
		expect(f.put).toHaveBeenCalledTimes(1);
		expect(f.put.mock.calls[0]?.[2]?.onlyIf).toBeInstanceOf(Headers);
		expect(f.entries.has(f.keys.ogImage)).toBe(false);
	});

	it('is R2-only and pins one-message consumers with realm-separated DLQs', () => {
		expect(consumerSource).not.toMatch(/\bfetch\s*\(/);
		expect(consumerSource).not.toContain('.list(');
		expect(consumerSource).not.toContain('serverQuery');
		expect(workerConfig).toContain('max_batch_size = 1');
		expect(workerConfig.match(/max_retries = 2/g)).toHaveLength(2);
		expect(workerConfig).not.toContain('max_retries = 5');
		expect(workerConfig).toContain('commons-public-template-og-dlq');
		expect(workerConfig).toContain('commons-public-template-og-nonprod-dlq');
		expect(workerConfig).toContain('commons-public-discovery-cache-nonprod');
	});
});
