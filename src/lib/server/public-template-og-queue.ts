export {
	PUBLIC_TEMPLATE_OG_QUEUE_CURRENT_DAY_PROJECTED_OPERATIONS,
	PUBLIC_TEMPLATE_OG_QUEUE_DAILY_MESSAGE_ATTEMPTS_PER_REALM_MAX,
	PUBLIC_TEMPLATE_OG_QUEUE_NEXT_DAY_PROJECTED_OPERATIONS,
	PUBLIC_TEMPLATE_OG_QUEUE_PROJECTED_OPERATIONS_PER_REALM_DAY_MAX,
	PUBLIC_TEMPLATE_OG_QUEUE_SECOND_DAY_PROJECTED_OPERATIONS
} from './public-template-og-operation-budget.mjs';

export const PUBLIC_TEMPLATE_OG_QUEUE_PROTOCOL_VERSION = 2;
export const PUBLIC_TEMPLATE_OG_QUEUE_BATCH_MAX = 16;
export const PUBLIC_TEMPLATE_OG_QUEUE_JOB_MAX_BYTES = 384;
/** Initial send intent plus one delayed repair intent. */
export const PUBLIC_TEMPLATE_OG_QUEUE_SEND_ATTEMPTS_MAX = 2;

export type PublicTemplateOgQueueJob = {
	version: 2;
	backend: string;
	revision: string;
	sourceSha: string;
	slug: string;
	transactionId: string;
};

export interface PublicTemplateOgQueueBinding {
	sendBatch(
		messages: Iterable<{
			body: PublicTemplateOgQueueJob;
			contentType: 'json';
		}>
	): Promise<unknown>;
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const REVISION = /^\d{1,20}$/;
const SOURCE_SHA = /^[a-f0-9]{40}$/;
const TRANSACTION_ID = /^[1-9][0-9]{0,19}-[1-9][0-9]{0,9}$/;

export function normalizePublicTemplateOgBackend(value: unknown): string {
	if (typeof value !== 'string' || value.length < 1 || value.length > 256) {
		throw new Error('PUBLIC_TEMPLATE_OG_QUEUE_BACKEND_INVALID');
	}
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error('PUBLIC_TEMPLATE_OG_QUEUE_BACKEND_INVALID');
	}
	if (
		url.protocol !== 'https:' ||
		url.username ||
		url.password ||
		url.pathname !== '/' ||
		url.search ||
		url.hash
	) {
		throw new Error('PUBLIC_TEMPLATE_OG_QUEUE_BACKEND_INVALID');
	}
	return url.origin.toLowerCase();
}

export function readPublicTemplateOgQueueJob(
	value: unknown,
	expectedBackend?: string
): PublicTemplateOgQueueJob {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error('PUBLIC_TEMPLATE_OG_QUEUE_JOB_INVALID');
	}
	const record = value as Record<string, unknown>;
	if (
		Object.keys(record).length !== 6 ||
		Object.keys(record).some(
			(key) =>
				!['version', 'backend', 'revision', 'sourceSha', 'slug', 'transactionId'].includes(key)
		) ||
		record.version !== PUBLIC_TEMPLATE_OG_QUEUE_PROTOCOL_VERSION ||
		typeof record.slug !== 'string' ||
		record.slug.length < 1 ||
		record.slug.length > 100 ||
		!SLUG.test(record.slug) ||
		typeof record.revision !== 'string' ||
		!REVISION.test(record.revision) ||
		typeof record.sourceSha !== 'string' ||
		!SOURCE_SHA.test(record.sourceSha) ||
		typeof record.transactionId !== 'string' ||
		!TRANSACTION_ID.test(record.transactionId)
	) {
		throw new Error('PUBLIC_TEMPLATE_OG_QUEUE_JOB_INVALID');
	}
	const revision = record.revision;
	if (
		!Number.isSafeInteger(Number(revision)) ||
		Number(revision) < 1 ||
		String(Number(revision)) !== revision
	) {
		throw new Error('PUBLIC_TEMPLATE_OG_QUEUE_JOB_INVALID');
	}
	const backend = normalizePublicTemplateOgBackend(record.backend);
	if (
		expectedBackend !== undefined &&
		backend !== normalizePublicTemplateOgBackend(expectedBackend)
	) {
		throw new Error('PUBLIC_TEMPLATE_OG_QUEUE_REALM_MISMATCH');
	}
	const job: PublicTemplateOgQueueJob = {
		version: PUBLIC_TEMPLATE_OG_QUEUE_PROTOCOL_VERSION,
		backend,
		revision,
		sourceSha: record.sourceSha,
		slug: record.slug,
		transactionId: record.transactionId
	};
	if (
		new TextEncoder().encode(JSON.stringify(job)).byteLength >
		PUBLIC_TEMPLATE_OG_QUEUE_JOB_MAX_BYTES
	) {
		throw new Error('PUBLIC_TEMPLATE_OG_QUEUE_JOB_INVALID');
	}
	return job;
}

export function publicTemplatePageArtifactObjectKeys(jobValue: PublicTemplateOgQueueJob): {
	ogImage: string;
	payload: string;
} {
	const job = readPublicTemplateOgQueueJob(jobValue);
	const realm = encodeURIComponent(`backend=${job.backend}`);
	const logicalKey = encodeURIComponent(`template-page:slug=${job.slug}`);
	const prefix = `public-template-pages/v1/${realm}/${logicalKey}/revision=${encodeURIComponent(job.revision)}/`;
	return { ogImage: `${prefix}og-image.png`, payload: `${prefix}payload.json` };
}

export function buildPublicTemplateOgQueueJob(input: {
	backend: string;
	revision: number | string;
	sourceSha: string;
	slug: string;
	transactionId: string;
}): PublicTemplateOgQueueJob {
	return readPublicTemplateOgQueueJob({
		version: PUBLIC_TEMPLATE_OG_QUEUE_PROTOCOL_VERSION,
		backend: input.backend,
		revision: String(input.revision),
		sourceSha: input.sourceSha,
		slug: input.slug,
		transactionId: input.transactionId
	});
}

export async function enqueuePublicTemplateOgQueueJobs(
	queue: PublicTemplateOgQueueBinding,
	jobs: readonly PublicTemplateOgQueueJob[]
): Promise<void> {
	if (jobs.length < 1 || jobs.length > PUBLIC_TEMPLATE_OG_QUEUE_BATCH_MAX) {
		throw new Error('PUBLIC_TEMPLATE_OG_QUEUE_BATCH_INVALID');
	}
	const validated = jobs.map((job) => readPublicTemplateOgQueueJob(job));
	const identities = validated.map(
		({ backend, revision, sourceSha, slug, transactionId }) =>
			`${backend}|${slug}|${revision}|${sourceSha}|${transactionId}`
	);
	if (new Set(identities).size !== identities.length) {
		throw new Error('PUBLIC_TEMPLATE_OG_QUEUE_BATCH_DUPLICATE');
	}
	await queue.sendBatch(validated.map((body) => ({ body, contentType: 'json' as const })));
}
