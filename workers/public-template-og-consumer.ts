import {
	PUBLIC_TEMPLATE_OG_IMAGE_MAX_BYTES,
	readPublicTemplateOgImage,
	renderPublicTemplateOgImage
} from '../src/lib/server/public-template-og-image';
import { readPublicTemplatePageArtifact } from '../src/lib/server/public-template-page-artifact';
import {
	publicTemplatePageArtifactObjectKeys,
	readPublicTemplateOgQueueJob,
	type PublicTemplateOgQueueJob
} from '../src/lib/server/public-template-og-queue';

const JSON_MAX_BYTES = 2 * 1024 * 1024;
export const PUBLIC_TEMPLATE_OG_QUEUE_RETRY_DELAY_SECONDS = 120;

export interface PublicTemplateOgConsumerEnv {
	PUBLIC_CONVEX_URL: string;
	PUBLIC_DISCOVERY_R2: R2Bucket;
	PUBLIC_RELEASE_SHA: string;
	PUBLIC_RELEASE_TRANSACTION_ID: string;
}

export interface PublicTemplateOgConsumerMessage {
	readonly body: unknown;
	ack(): void;
	retry(options?: { delaySeconds?: number }): void;
}

export interface PublicTemplateOgConsumerBatch {
	readonly messages: readonly PublicTemplateOgConsumerMessage[];
}

type R2BodyWithBinary = R2ObjectBody & { arrayBuffer(): Promise<ArrayBuffer> };
type R2WithHttpMetadata = R2Object & { httpMetadata?: R2HTTPMetadata };

export class PermanentPublicTemplateOgJobError extends Error {
	readonly code: string;

	constructor(code: string) {
		super(`PUBLIC_TEMPLATE_OG_JOB_PERMANENT:${code}`);
		this.name = 'PermanentPublicTemplateOgJobError';
		this.code = code;
	}
}

function permanent(code: string): never {
	throw new PermanentPublicTemplateOgJobError(code);
}

async function readPageArtifact(bucket: R2Bucket, key: string, job: PublicTemplateOgQueueJob) {
	const object = await bucket.get(key);
	if (!object) permanent('JSON_MISSING');
	if (
		object.key !== key ||
		(object as R2WithHttpMetadata).httpMetadata?.contentType !== 'application/json' ||
		object.customMetadata?.kind !== 'payload' ||
		object.customMetadata?.revision !== job.revision ||
		!Number.isSafeInteger(object.size) ||
		object.size < 1 ||
		object.size > JSON_MAX_BYTES
	) {
		permanent('JSON_METADATA_CORRUPT');
	}
	const text = await object.text();
	if (new TextEncoder().encode(text).byteLength !== object.size) {
		permanent('JSON_LENGTH_CORRUPT');
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		permanent('JSON_BODY_CORRUPT');
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		permanent('JSON_ENVELOPE_CORRUPT');
	}
	const envelope = parsed as Record<string, unknown>;
	if (
		Object.keys(envelope).length !== 3 ||
		Object.keys(envelope).some((key) => !['cachedAt', 'revision', 'value'].includes(key)) ||
		!Number.isSafeInteger(envelope.cachedAt) ||
		(envelope.cachedAt as number) < 0 ||
		envelope.revision !== job.revision
	) {
		permanent('JSON_ENVELOPE_CORRUPT');
	}
	let artifact;
	try {
		artifact = readPublicTemplatePageArtifact(envelope.value);
	} catch {
		permanent('JSON_ARTIFACT_CORRUPT');
	}
	if (artifact.slug !== job.slug) permanent('JSON_SLUG_MISMATCH');
	return { artifact, etag: object.etag };
}

async function readOgImage(
	bucket: R2Bucket,
	key: string,
	job: PublicTemplateOgQueueJob
): Promise<{ bytes: Uint8Array; etag: string } | null> {
	const object = await bucket.get(key);
	if (!object) return null;
	if (
		object.key !== key ||
		(object as R2WithHttpMetadata).httpMetadata?.contentType !== 'image/png' ||
		object.customMetadata?.kind !== 'template-og-image' ||
		object.customMetadata?.schema !== '1' ||
		object.customMetadata?.revision !== job.revision ||
		object.customMetadata?.slug !== job.slug ||
		!Number.isSafeInteger(object.size) ||
		object.size < 1 ||
		object.size > PUBLIC_TEMPLATE_OG_IMAGE_MAX_BYTES ||
		typeof (object as Partial<R2BodyWithBinary>).arrayBuffer !== 'function'
	) {
		permanent('PNG_METADATA_CORRUPT');
	}
	const body = await (object as R2BodyWithBinary).arrayBuffer();
	if (body.byteLength !== object.size) permanent('PNG_LENGTH_CORRUPT');
	try {
		return { bytes: readPublicTemplateOgImage(body), etag: object.etag };
	} catch {
		permanent('PNG_BODY_CORRUPT');
	}
}

async function putIfAbsent(
	bucket: R2Bucket,
	key: string,
	body: ArrayBuffer,
	job: PublicTemplateOgQueueJob
): Promise<R2Object | null> {
	const metadata = {
		customMetadata: {
			kind: 'template-og-image',
			revision: job.revision,
			schema: '1',
			slug: job.slug
		},
		httpMetadata: { contentType: 'image/png' }
	};
	const headers = new Headers({ 'If-None-Match': '*' });
	return bucket.put(key, body, { ...metadata, onlyIf: headers });
}

/** One at-least-once delivery. Every shared-store operation is an exact key. */
export async function processPublicTemplateOgJob(
	value: unknown,
	env: PublicTemplateOgConsumerEnv
): Promise<void> {
	if (
		typeof env.PUBLIC_RELEASE_SHA !== 'string' ||
		!/^[a-f0-9]{40}$/.test(env.PUBLIC_RELEASE_SHA) ||
		typeof env.PUBLIC_RELEASE_TRANSACTION_ID !== 'string' ||
		!/^[1-9][0-9]{0,19}-[1-9][0-9]{0,9}$/.test(env.PUBLIC_RELEASE_TRANSACTION_ID)
	) {
		permanent('CONFIG');
	}
	if (
		value !== null &&
		typeof value === 'object' &&
		!Array.isArray(value) &&
		(value as Record<string, unknown>).version === 1
	) {
		// Pre-transaction messages can never be attributed to the active
		// publication. Drop them before the first R2 read or render.
		permanent('SUPERSEDED');
	}
	let job: PublicTemplateOgQueueJob;
	try {
		job = readPublicTemplateOgQueueJob(value, env.PUBLIC_CONVEX_URL);
	} catch (error) {
		permanent(error instanceof Error && error.message.includes('REALM') ? 'REALM' : 'PROTOCOL');
	}
	if (
		job.sourceSha !== env.PUBLIC_RELEASE_SHA ||
		job.transactionId !== env.PUBLIC_RELEASE_TRANSACTION_ID
	) {
		permanent('SUPERSEDED');
	}
	const keys = publicTemplatePageArtifactObjectKeys(job);
	let page;
	try {
		page = await readPageArtifact(env.PUBLIC_DISCOVERY_R2, keys.payload, job);
	} catch (error) {
		if (error instanceof PermanentPublicTemplateOgJobError && error.code === 'JSON_MISSING') {
			// A delayed delivery must not leave or recreate a PNG after pair-aware GC.
			await env.PUBLIC_DISCOVERY_R2.delete(keys.ogImage);
		}
		throw error;
	}
	let png = await readOgImage(env.PUBLIC_DISCOVERY_R2, keys.ogImage, job);
	if (!png) {
		const rendered = readPublicTemplateOgImage(
			await renderPublicTemplateOgImage(page.artifact.detail)
		);
		const body = new ArrayBuffer(rendered.byteLength);
		new Uint8Array(body).set(rendered);
		const written = await putIfAbsent(env.PUBLIC_DISCOVERY_R2, keys.ogImage, body, job);
		if (!written) {
			const winner = await readOgImage(env.PUBLIC_DISCOVERY_R2, keys.ogImage, job);
			if (!winner) permanent('PNG_RACE_WINNER_MISSING');
			png = winner;
		} else {
			png = { bytes: rendered, etag: written.etag };
		}
	}
	if (!png) permanent('PNG_MISSING_AFTER_PUBLICATION');
	// Pair-aware GC can retire JSON between the first GET and immutable create.
	// Re-certify exact authority so a GC race can only leak data—not resurrect
	// a request-visible PNG after its JSON coordinate has been retired.
	try {
		await readPageArtifact(env.PUBLIC_DISCOVERY_R2, keys.payload, job);
	} catch (error) {
		await env.PUBLIC_DISCOVERY_R2.delete(keys.ogImage);
		throw error;
	}
}

export async function consumePublicTemplateOgBatch(
	batch: PublicTemplateOgConsumerBatch,
	env: PublicTemplateOgConsumerEnv
): Promise<void> {
	await Promise.all(
		batch.messages.map(async (message) => {
			try {
				await processPublicTemplateOgJob(message.body, env);
				message.ack();
			} catch (error) {
				if (error instanceof PermanentPublicTemplateOgJobError) {
					console.error('[public-template-og-consumer] poison job:', error.code);
					if (error.code === 'JSON_MISSING' || error.code === 'SUPERSEDED') {
						// Expected delayed delivery after exact pair retirement: cleanup was
						// already performed and there is nothing actionable for the DLQ.
						message.ack();
					} else {
						message.retry({ delaySeconds: PUBLIC_TEMPLATE_OG_QUEUE_RETRY_DELAY_SECONDS });
					}
					return;
				}
				console.warn(
					'[public-template-og-consumer] transient failure:',
					error instanceof Error ? error.name : 'unknown'
				);
				message.retry({ delaySeconds: PUBLIC_TEMPLATE_OG_QUEUE_RETRY_DELAY_SECONDS });
			}
		})
	);
}

export default {
	queue: consumePublicTemplateOgBatch
};
