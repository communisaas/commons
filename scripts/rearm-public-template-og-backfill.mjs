#!/usr/bin/env node

import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const PUBLIC_TEMPLATE_OG_REARM_REASON = 'queue-dlq-budget-inspected';
export const PUBLIC_TEMPLATE_OG_QUEUE_REPAIR_ATTEMPTS_MAX = 2;
export const PUBLIC_TEMPLATE_OG_QUEUE_REPAIR_DELAY_MS = 120_000;
export const PUBLIC_TEMPLATE_PAGE_BACKFILL_PROGRESS_MAX_BYTES = 128 * 1024;

export const PUBLIC_TEMPLATE_OG_REALMS = Object.freeze({
	nonproduction: Object.freeze({
		backend: 'https://outstanding-firefly-831.convex.cloud',
		bucket: 'commons-public-discovery-cache-nonprod'
	}),
	production: Object.freeze({
		backend: 'https://quirky-chinchilla-352.convex.cloud',
		bucket: 'commons-public-discovery-cache'
	})
});

/** @param {unknown} condition @param {string} message @returns {asserts condition} */
function invariant(condition, message) {
	if (!condition) throw new Error(message);
}

/** @param {unknown} value @returns {Record<string, any> | null} */
function record(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

/** @param {unknown} value @returns {any} */
function canonical(value) {
	if (Array.isArray(value)) return value.map(canonical);
	const object = record(value);
	if (!object) return value;
	return Object.fromEntries(
		Object.keys(object)
			.sort()
			.map((key) => [key, canonical(object[key])])
	);
}

/** @param {unknown} value @returns {string} */
export function canonicalJson(value) {
	return JSON.stringify(canonical(value));
}

/** @param {string} backend */
export function publicTemplatePageBackfillProgressKey(backend) {
	const parsed = new URL(backend);
	invariant(
		parsed.protocol === 'https:' &&
			!parsed.username &&
			!parsed.password &&
			parsed.pathname === '/' &&
			!parsed.search &&
			!parsed.hash,
		'Backend must be an exact HTTPS origin.'
	);
	const realm = `backend=${parsed.origin.toLowerCase()}`;
	return `public-template-pages/v1/${encodeURIComponent(realm)}/control/backfill-progress.json`;
}

/** @param {unknown} value @param {number} now */
export function readPublicTemplatePageBackfillProgress(value, now = Date.now()) {
	const progress = record(value);
	invariant(progress !== null, 'Backfill checkpoint must be an object.');
	const expectedKeys = [
		'coordinateDigest',
		'coordinates',
		'enqueueAttempts',
		'enqueuedAt',
		'enqueuedOffset',
		'generation',
		'nextOffset',
		'total',
		'version'
	];
	invariant(
		Object.keys(progress).sort().join('\0') === expectedKeys.join('\0'),
		'Backfill checkpoint has an unexpected schema.'
	);
	invariant(progress.version === 1, 'Backfill checkpoint version must be 1.');
	invariant(
		typeof progress.generation === 'string' &&
			progress.generation.length >= 1 &&
			progress.generation.length <= 128,
		'Backfill checkpoint generation is invalid.'
	);
	invariant(
		typeof progress.coordinateDigest === 'string' &&
			/^[a-f0-9]{64}$/.test(progress.coordinateDigest),
		'Backfill checkpoint coordinate digest is invalid.'
	);
	invariant(
		Array.isArray(progress.coordinates) && progress.coordinates.length <= 250,
		'Backfill checkpoint coordinates are invalid.'
	);
	const rawCoordinates = /** @type {unknown[]} */ (progress.coordinates);
	const coordinates = rawCoordinates.map((value, index) => {
		const coordinate = record(value);
		invariant(coordinate !== null, `Backfill coordinate ${index} must be an object.`);
		invariant(
			Object.keys(coordinate).sort().join('\0') === 'artifactRevision\0slug\0templateId',
			`Backfill coordinate ${index} has an unexpected schema.`
		);
		invariant(
			typeof coordinate.templateId === 'string' &&
				coordinate.templateId.length >= 1 &&
				coordinate.templateId.length <= 128,
			`Backfill coordinate ${index} template id is invalid.`
		);
		invariant(
			typeof coordinate.slug === 'string' &&
				coordinate.slug.length <= 100 &&
				/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(coordinate.slug),
			`Backfill coordinate ${index} slug is invalid.`
		);
		invariant(
			Number.isSafeInteger(coordinate.artifactRevision) && coordinate.artifactRevision >= 1,
			`Backfill coordinate ${index} artifact revision is invalid.`
		);
		return {
			artifactRevision: coordinate.artifactRevision,
			slug: coordinate.slug,
			templateId: coordinate.templateId
		};
	});
	invariant(
		new Set(coordinates.map(({ templateId }) => templateId)).size === coordinates.length &&
			new Set(coordinates.map(({ slug }) => slug)).size === coordinates.length &&
			coordinates.every(
				(coordinate, index) =>
					index === 0 || coordinates[index - 1].slug.localeCompare(coordinate.slug) < 0
			),
		'Backfill checkpoint coordinates must be unique and slug-sorted.'
	);
	invariant(
		Number.isSafeInteger(progress.total) &&
			progress.total >= 0 &&
			progress.total <= coordinates.length,
		'Backfill checkpoint total is invalid.'
	);
	invariant(
		Number.isSafeInteger(progress.nextOffset) &&
			progress.nextOffset >= 0 &&
			progress.nextOffset <= progress.total,
		'Backfill checkpoint next offset is invalid.'
	);
	invariant(
		Number.isSafeInteger(progress.enqueuedOffset) &&
			progress.enqueuedOffset >= progress.nextOffset &&
			progress.enqueuedOffset <= progress.total,
		'Backfill checkpoint enqueued offset is invalid.'
	);
	invariant(
		progress.enqueuedAt === null ||
			(Number.isSafeInteger(progress.enqueuedAt) &&
				progress.enqueuedAt >= 0 &&
				progress.enqueuedAt <= now),
		'Backfill checkpoint enqueue timestamp is invalid.'
	);
	invariant(
		Number.isSafeInteger(progress.enqueueAttempts) &&
			progress.enqueueAttempts >= 0 &&
			progress.enqueueAttempts <= PUBLIC_TEMPLATE_OG_QUEUE_REPAIR_ATTEMPTS_MAX,
		'Backfill checkpoint attempt count is invalid.'
	);
	const activeHandoff = progress.enqueuedOffset > progress.nextOffset;
	invariant(
		activeHandoff
			? progress.enqueuedAt !== null && progress.enqueueAttempts >= 1
			: progress.enqueuedAt === null && progress.enqueueAttempts === 0,
		'Backfill checkpoint handoff state is inconsistent.'
	);
	return {
		version: 1,
		generation: progress.generation,
		coordinateDigest: progress.coordinateDigest,
		coordinates,
		total: progress.total,
		nextOffset: progress.nextOffset,
		enqueuedOffset: progress.enqueuedOffset,
		enqueuedAt: progress.enqueuedAt,
		enqueueAttempts: progress.enqueueAttempts
	};
}

/**
 * The operator may reopen only the exact exhausted handoff they inspected.
 * The next producer still reserves the shared daily ledger before Queue send.
 * @param {{checkpoint: unknown, expectedCoordinateDigest: string, now?: number}} input
 */
export function planPublicTemplateOgBackfillRearm({
	checkpoint,
	expectedCoordinateDigest,
	now = Date.now()
}) {
	invariant(
		typeof expectedCoordinateDigest === 'string' && /^[a-f0-9]{64}$/.test(expectedCoordinateDigest),
		'--coordinate-digest must be an exact lowercase SHA-256 digest.'
	);
	const prior = readPublicTemplatePageBackfillProgress(checkpoint, now);
	invariant(
		prior.coordinateDigest === expectedCoordinateDigest,
		'Observed coordinate digest does not match --coordinate-digest.'
	);
	invariant(
		prior.enqueuedOffset > prior.nextOffset,
		'Backfill checkpoint has no active Queue handoff to rearm.'
	);
	invariant(
		prior.enqueueAttempts === PUBLIC_TEMPLATE_OG_QUEUE_REPAIR_ATTEMPTS_MAX,
		'Backfill checkpoint has not exhausted its bounded Queue repairs.'
	);
	invariant(
		prior.enqueuedAt !== null && now - prior.enqueuedAt >= PUBLIC_TEMPLATE_OG_QUEUE_REPAIR_DELAY_MS,
		'Backfill checkpoint has not reached the terminal repair delay.'
	);
	return {
		prior,
		next: {
			...prior,
			enqueuedOffset: prior.nextOffset,
			enqueuedAt: null,
			enqueueAttempts: 0
		}
	};
}

/** @param {unknown} value */
function unquotedEtag(value) {
	invariant(typeof value === 'string', 'R2 did not return an ETag.');
	const normalized = value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
	invariant(/^[a-f0-9]{32}$/.test(normalized), 'R2 returned a non-canonical checkpoint ETag.');
	return normalized;
}

/** @param {unknown} value */
function exactMetadata(value) {
	const metadata = record(value);
	invariant(
		metadata !== null &&
			Object.keys(metadata).sort().join('\0') === 'kind\0schema' &&
			metadata.kind === 'template-page-backfill-progress' &&
			metadata.schema === '1',
		'Backfill checkpoint metadata is invalid.'
	);
	return { kind: metadata.kind, schema: metadata.schema };
}

/**
 * @param {{
 *   s3: {send(command: unknown): Promise<any>}, environment: keyof typeof PUBLIC_TEMPLATE_OG_REALMS,
 *   expectedEtag: string, expectedCoordinateDigest: string, evidenceSha256: string,
 *   apply: boolean, now?: number, rearmId?: string
 * }} input
 */
export async function rearmPublicTemplateOgBackfill({
	s3,
	environment,
	expectedEtag,
	expectedCoordinateDigest,
	evidenceSha256,
	apply,
	now = Date.now(),
	rearmId = randomUUID()
}) {
	const realm = PUBLIC_TEMPLATE_OG_REALMS[environment];
	invariant(realm !== undefined, '--environment must be production or nonproduction.');
	invariant(/^[a-f0-9]{32}$/.test(expectedEtag), '--expected-etag must be 32 lowercase hex bytes.');
	invariant(
		/^[a-f0-9]{64}$/.test(evidenceSha256),
		'--evidence-sha256 must be an exact lowercase SHA-256 digest.'
	);
	invariant(
		/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(rearmId),
		'Rearm receipt id must be a canonical UUIDv4.'
	);
	invariant(Number.isSafeInteger(now) && now >= 0, 'Operator clock is invalid.');
	const key = publicTemplatePageBackfillProgressKey(realm.backend);
	const observed = await s3.send(new GetObjectCommand({ Bucket: realm.bucket, Key: key }));
	invariant(observed.ContentLength >= 1, 'Backfill checkpoint is empty.');
	invariant(
		observed.ContentLength <= PUBLIC_TEMPLATE_PAGE_BACKFILL_PROGRESS_MAX_BYTES,
		'Backfill checkpoint exceeds its byte ceiling.'
	);
	invariant(
		observed.ContentType === 'application/json',
		'Backfill checkpoint content type is invalid.'
	);
	const metadata = exactMetadata(observed.Metadata);
	const observedEtag = unquotedEtag(observed.ETag);
	invariant(observedEtag === expectedEtag, 'Observed ETag does not match --expected-etag.');
	invariant(observed.Body, 'Backfill checkpoint body is unavailable.');
	const source = await observed.Body.transformToString('utf-8');
	invariant(
		Buffer.byteLength(source, 'utf8') <= PUBLIC_TEMPLATE_PAGE_BACKFILL_PROGRESS_MAX_BYTES,
		'Backfill checkpoint exceeds its byte ceiling.'
	);
	let decoded;
	try {
		decoded = JSON.parse(source);
	} catch {
		throw new Error('Backfill checkpoint is not valid JSON.');
	}
	const plan = planPublicTemplateOgBackfillRearm({
		checkpoint: decoded,
		expectedCoordinateDigest,
		now
	});
	const receipt = {
		action: 'public-template-og-backfill-rearm',
		auditVersion: 1,
		backend: realm.backend,
		bucket: realm.bucket,
		checkpointKey: key,
		coordinateDigest: plan.prior.coordinateDigest,
		evidenceSha256,
		environment,
		expectedEtag,
		generation: plan.prior.generation,
		observedAt: now,
		prior: {
			enqueueAttempts: plan.prior.enqueueAttempts,
			enqueuedAt: plan.prior.enqueuedAt,
			enqueuedOffset: plan.prior.enqueuedOffset,
			nextOffset: plan.prior.nextOffset
		},
		rearmId,
		reason: PUBLIC_TEMPLATE_OG_REARM_REASON
	};
	if (!apply) return { ...receipt, applied: false, resultEtag: null };

	const body = canonicalJson(plan.next);
	invariant(
		Buffer.byteLength(body, 'utf8') <= PUBLIC_TEMPLATE_PAGE_BACKFILL_PROGRESS_MAX_BYTES,
		'Rearmed checkpoint exceeds its byte ceiling.'
	);
	const written = await s3.send(
		new PutObjectCommand({
			Body: body,
			Bucket: realm.bucket,
			ContentType: 'application/json',
			IfMatch: `"${expectedEtag}"`,
			Key: key,
			Metadata: metadata
		})
	);
	const resultEtag = unquotedEtag(written.ETag);
	const verified = await s3.send(new GetObjectCommand({ Bucket: realm.bucket, Key: key }));
	invariant(
		unquotedEtag(verified.ETag) === resultEtag,
		'Rearmed checkpoint read-back ETag mismatch.'
	);
	invariant(
		verified.ContentType === 'application/json',
		'Rearmed checkpoint read-back content type mismatch.'
	);
	exactMetadata(verified.Metadata);
	invariant(verified.Body, 'Rearmed checkpoint read-back body is unavailable.');
	const verifiedBody = await verified.Body.transformToString('utf-8');
	invariant(verifiedBody === body, 'Rearmed checkpoint read-back body mismatch.');
	readPublicTemplatePageBackfillProgress(JSON.parse(verifiedBody), now);
	return { ...receipt, applied: true, resultEtag };
}

function usage() {
	return [
		'Usage:',
		'  node scripts/rearm-public-template-og-backfill.mjs --environment <production|nonproduction> \\',
		'    --expected-etag <32-lowercase-hex> --coordinate-digest <sha256> \\',
		'    --evidence-sha256 <sha256> [--apply]',
		'',
		'Without --apply, the command performs an exact read and emits a dry-run audit receipt.'
	].join('\n');
}

/** @param {string[]} argv */
function parseArguments(argv) {
	const values = new Map();
	let apply = false;
	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index];
		if (argument === '--apply') {
			invariant(!apply, '--apply may be supplied only once.');
			apply = true;
			continue;
		}
		invariant(
			['--environment', '--expected-etag', '--coordinate-digest', '--evidence-sha256'].includes(
				argument
			),
			`Unknown argument: ${argument}`
		);
		invariant(!values.has(argument), `${argument} may be supplied only once.`);
		const value = argv[index + 1];
		invariant(value !== undefined && !value.startsWith('--'), `${argument} requires a value.`);
		values.set(argument, value);
		index += 1;
	}
	for (const required of [
		'--environment',
		'--expected-etag',
		'--coordinate-digest',
		'--evidence-sha256'
	]) {
		invariant(values.has(required), `${required} is required.`);
	}
	return {
		apply,
		environment: values.get('--environment'),
		expectedEtag: values.get('--expected-etag'),
		expectedCoordinateDigest: values.get('--coordinate-digest'),
		evidenceSha256: values.get('--evidence-sha256')
	};
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
	try {
		const options = parseArguments(process.argv.slice(2));
		const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
		const accessKeyId = process.env.R2_ACCESS_KEY_ID;
		const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
		invariant(
			typeof accountId === 'string' && /^[a-f0-9]{32}$/.test(accountId),
			'CLOUDFLARE_ACCOUNT_ID must be an exact lowercase account id.'
		);
		invariant(
			typeof accessKeyId === 'string' && accessKeyId.length > 0,
			'R2_ACCESS_KEY_ID is required.'
		);
		invariant(
			typeof secretAccessKey === 'string' && secretAccessKey.length > 0,
			'R2_SECRET_ACCESS_KEY is required.'
		);
		const s3 = new S3Client({
			credentials: { accessKeyId, secretAccessKey },
			endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
			forcePathStyle: true,
			region: 'auto'
		});
		const result = await rearmPublicTemplateOgBackfill({ s3, ...options });
		console.log(canonicalJson(result));
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		console.error(usage());
		process.exitCode = 1;
	}
}
