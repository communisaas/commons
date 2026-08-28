#!/usr/bin/env -S npx tsx

import {
	GetObjectCommand,
	HeadObjectCommand,
	S3Client,
	type GetObjectCommandOutput,
	type HeadObjectCommandOutput
} from '@aws-sdk/client-s3';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
	PUBLIC_DISCOVERY_CACHE_PAYLOAD_MAX_BYTES,
	publicDiscoveryPayloadObjectKeyForBackend
} from '../src/lib/server/public-discovery-cache';
import {
	PUBLIC_DISCOVERY_MANIFEST_OBJECT_MAX_BYTES,
	publicDiscoveryGraphGeneration,
	publicDiscoveryManifestStateKeyForBackend,
	publicDiscoverySnapshotGeneration,
	readStrictReadyPublicDiscoveryManifestState
} from '../src/lib/server/public-discovery-manifest-shield';
import {
	PUBLIC_TEMPLATE_PAGE_INVENTORY_LOGICAL_KEY,
	readPublicTemplatePageInventory
} from '../src/lib/server/public-template-page-artifact';
import { publicTemplatePageCoordinateDigest } from '../src/lib/server/public-template-page-coordinate';
import { PUBLIC_TEMPLATE_OG_IMAGE_MAX_BYTES } from '../src/lib/server/public-template-og-image';
import { publicTemplatePageArtifactObjectKeys } from '../src/lib/server/public-template-og-queue';
import {
	PUBLIC_TEMPLATE_OG_REALMS,
	PUBLIC_TEMPLATE_PAGE_BACKFILL_PROGRESS_MAX_BYTES,
	canonicalJson,
	publicTemplatePageBackfillProgressKey,
	readPublicTemplatePageBackfillProgress
} from './rearm-public-template-og-backfill.mjs';

export const PUBLIC_DISCOVERY_BOOTSTRAP_PROOF_VERSION = 1;
export const PUBLIC_DISCOVERY_BOOTSTRAP_HEAD_CONCURRENCY = 8;
export const PUBLIC_DISCOVERY_PRODUCTION_ACCOUNT_ID = '019d1184e655db74b7589794a2a2a533';
export const PUBLIC_DISCOVERY_PRODUCTION = Object.freeze({
	...PUBLIC_TEMPLATE_OG_REALMS.production,
	accountId: PUBLIC_DISCOVERY_PRODUCTION_ACCOUNT_ID
});

const CLOCK_SKEW_MS = 60_000;
const S3_LAST_MODIFIED_RESOLUTION_MS = 1_000;
const CHECKPOINT_METADATA = Object.freeze({
	kind: 'template-page-backfill-progress',
	schema: '1'
});
const MANIFEST_METADATA = Object.freeze({ kind: 'manifest-ready', schema: '2' });

type S3Sender = { send(command: unknown): Promise<unknown> };

type ExactJsonObject = Readonly<{
	bodySha256: string;
	decoded: unknown;
	etag: string;
	lastModifiedAt: number;
	lastModifiedUpperBoundAt: number;
	size: number;
}>;

function exactMissingObjectError(error: unknown): boolean {
	if (error === null || typeof error !== 'object' || Array.isArray(error)) return false;
	const candidate = error as {
		name?: unknown;
		Code?: unknown;
		code?: unknown;
		$metadata?: { httpStatusCode?: unknown };
	};
	const code = candidate.name ?? candidate.Code ?? candidate.code;
	return (
		candidate.$metadata?.httpStatusCode === 404 &&
		(code === 'NoSuchKey' || code === 'NotFound' || code === 'NoSuchObject')
	);
}

async function requiredObject<T>(operation: Promise<T>, label: string): Promise<T> {
	try {
		return await operation;
	} catch (error) {
		if (exactMissingObjectError(error)) {
			throw new Error(`PUBLIC_DISCOVERY_BOOTSTRAP_INCOMPLETE:${label} is absent.`, {
				cause: error
			});
		}
		throw error;
	}
}

/** @throws when a release proof assumption is false */
function invariant(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(`PUBLIC_DISCOVERY_BOOTSTRAP_INCOMPLETE:${message}`);
}

function configurationInvariant(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(`PUBLIC_DISCOVERY_BOOTSTRAP_CONFIGURATION_ERROR:${message}`);
}

function exactMetadata(
	value: GetObjectCommandOutput['Metadata'] | HeadObjectCommandOutput['Metadata'],
	expected: Readonly<Record<string, string>>,
	label: string
): void {
	invariant(value !== undefined, `${label} metadata is absent.`);
	const observed = value as Record<string, string | undefined>;
	invariant(
		Object.keys(observed).sort().join('\0') === Object.keys(expected).sort().join('\0') &&
			Object.entries(expected).every(([key, expectedValue]) => observed[key] === expectedValue),
		`${label} metadata is invalid.`
	);
}

function canonicalEtag(value: unknown, label: string): string {
	invariant(typeof value === 'string', `${label} ETag is absent.`);
	const normalized = value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
	invariant(/^[a-f0-9]{32}$/.test(normalized), `${label} ETag is not canonical.`);
	return normalized;
}

function lastModifiedBounds(value: unknown, now: number, label: string) {
	invariant(
		value instanceof Date && Number.isSafeInteger(value.getTime()),
		`${label} date is invalid.`
	);
	const lastModifiedAt = value.getTime();
	invariant(
		lastModifiedAt >= 0 && lastModifiedAt <= now + CLOCK_SKEW_MS,
		`${label} date is invalid.`
	);
	return {
		lastModifiedAt,
		// S3 serializes Last-Modified at whole-second precision. The upper bound
		// preserves the runtime parser's persisted-at invariant without pretending
		// that the discarded millisecond component is observable through S3.
		lastModifiedUpperBoundAt: lastModifiedAt + S3_LAST_MODIFIED_RESOLUTION_MS - 1
	};
}

async function exactBodyBytes(body: GetObjectCommandOutput['Body'], label: string) {
	invariant(body !== undefined, `${label} body is absent.`);
	const transform = (body as { transformToByteArray?: () => Promise<Uint8Array> })
		.transformToByteArray;
	invariant(typeof transform === 'function', `${label} body is unreadable.`);
	return transform.call(body);
}

async function readExactJsonObject(input: {
	s3: S3Sender;
	bucket: string;
	key: string;
	label: string;
	maximumBytes: number;
	metadata: Readonly<Record<string, string>>;
	now: number;
}): Promise<ExactJsonObject> {
	const output = (await requiredObject(
		input.s3.send(new GetObjectCommand({ Bucket: input.bucket, Key: input.key })),
		input.label
	)) as GetObjectCommandOutput;
	invariant(output.ContentType === 'application/json', `${input.label} content type is invalid.`);
	invariant(
		Number.isSafeInteger(output.ContentLength) &&
			(output.ContentLength ?? 0) >= 1 &&
			(output.ContentLength ?? 0) <= input.maximumBytes,
		`${input.label} size is invalid.`
	);
	exactMetadata(output.Metadata, input.metadata, input.label);
	const etag = canonicalEtag(output.ETag, input.label);
	const timestamps = lastModifiedBounds(output.LastModified, input.now, input.label);
	const bytes = await exactBodyBytes(output.Body, input.label);
	invariant(bytes.byteLength === output.ContentLength, `${input.label} body length is invalid.`);
	let source: string;
	try {
		source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	} catch {
		throw new Error(`PUBLIC_DISCOVERY_BOOTSTRAP_INCOMPLETE:${input.label} is not UTF-8.`);
	}
	let decoded: unknown;
	try {
		decoded = JSON.parse(source);
	} catch {
		throw new Error(`PUBLIC_DISCOVERY_BOOTSTRAP_INCOMPLETE:${input.label} is not JSON.`);
	}
	return {
		...timestamps,
		bodySha256: createHash('sha256').update(bytes).digest('hex'),
		decoded,
		etag,
		size: bytes.byteLength
	};
}

function sameObservation(left: ExactJsonObject, right: ExactJsonObject, label: string): void {
	invariant(
		left.etag === right.etag && left.bodySha256 === right.bodySha256 && left.size === right.size,
		`${label} changed during verification.`
	);
}

async function mapLimited<T>(
	values: readonly T[],
	limit: number,
	worker: (value: T, index: number) => Promise<void>
): Promise<void> {
	invariant(
		Number.isSafeInteger(limit) && limit >= 1 && limit <= 16,
		'HEAD concurrency is invalid.'
	);
	let nextIndex = 0;
	await Promise.all(
		Array.from({ length: Math.min(limit, values.length) }, async () => {
			while (true) {
				const index = nextIndex;
				nextIndex += 1;
				if (index >= values.length) return;
				await worker(values[index]!, index);
			}
		})
	);
}

async function verifyExactPair(input: {
	s3: S3Sender;
	coordinate: { artifactRevision: number; slug: string };
	now: number;
}): Promise<{ jsonBytes: number; pngBytes: number }> {
	const revision = String(input.coordinate.artifactRevision);
	const keys = publicTemplatePageArtifactObjectKeys({
		version: 2,
		backend: PUBLIC_DISCOVERY_PRODUCTION.backend,
		revision,
		// These fields do not participate in key derivation. Supplying canonical
		// inert values still exercises the production queue contract's validator.
		sourceSha: '0'.repeat(40),
		slug: input.coordinate.slug,
		transactionId: '1-1'
	});
	const [payload, png] = (await Promise.all([
		requiredObject(
			input.s3.send(
				new HeadObjectCommand({
					Bucket: PUBLIC_DISCOVERY_PRODUCTION.bucket,
					Key: keys.payload
				})
			),
			`JSON ${input.coordinate.slug}`
		),
		requiredObject(
			input.s3.send(
				new HeadObjectCommand({
					Bucket: PUBLIC_DISCOVERY_PRODUCTION.bucket,
					Key: keys.ogImage
				})
			),
			`PNG ${input.coordinate.slug}`
		)
	])) as [HeadObjectCommandOutput, HeadObjectCommandOutput];

	invariant(
		payload.ContentType === 'application/json',
		`JSON ${input.coordinate.slug} type is invalid.`
	);
	invariant(
		Number.isSafeInteger(payload.ContentLength) &&
			(payload.ContentLength ?? 0) >= 1 &&
			(payload.ContentLength ?? 0) <= PUBLIC_DISCOVERY_CACHE_PAYLOAD_MAX_BYTES,
		`JSON ${input.coordinate.slug} size is invalid.`
	);
	exactMetadata(payload.Metadata, { kind: 'payload', revision }, `JSON ${input.coordinate.slug}`);
	canonicalEtag(payload.ETag, `JSON ${input.coordinate.slug}`);
	lastModifiedBounds(payload.LastModified, input.now, `JSON ${input.coordinate.slug}`);

	invariant(png.ContentType === 'image/png', `PNG ${input.coordinate.slug} type is invalid.`);
	invariant(
		Number.isSafeInteger(png.ContentLength) &&
			(png.ContentLength ?? 0) >= 1 &&
			(png.ContentLength ?? 0) <= PUBLIC_TEMPLATE_OG_IMAGE_MAX_BYTES,
		`PNG ${input.coordinate.slug} size is invalid.`
	);
	exactMetadata(
		png.Metadata,
		{
			kind: 'template-og-image',
			revision,
			schema: '1',
			slug: input.coordinate.slug
		},
		`PNG ${input.coordinate.slug}`
	);
	canonicalEtag(png.ETag, `PNG ${input.coordinate.slug}`);
	lastModifiedBounds(png.LastModified, input.now, `PNG ${input.coordinate.slug}`);
	return { jsonBytes: payload.ContentLength!, pngBytes: png.ContentLength! };
}

function readInventoryEnvelope(value: unknown, revision: string, persistedAtUpperBound: number) {
	invariant(
		value !== null && typeof value === 'object' && !Array.isArray(value),
		'Inventory envelope is invalid.'
	);
	const envelope = value as Record<string, unknown>;
	invariant(
		Object.keys(envelope).sort().join('\0') === ['cachedAt', 'revision', 'value'].join('\0') &&
			envelope.revision === revision &&
			Number.isSafeInteger(envelope.cachedAt) &&
			(envelope.cachedAt as number) >= 0 &&
			(envelope.cachedAt as number) <= persistedAtUpperBound,
		'Inventory envelope is invalid.'
	);
	try {
		return readPublicTemplatePageInventory(envelope.value);
	} catch {
		throw new Error('PUBLIC_DISCOVERY_BOOTSTRAP_INCOMPLETE:Inventory payload is invalid.');
	}
}

/**
 * Verify a stable, production-only R2 snapshot. The sender receives only exact
 * GetObject/HeadObject commands; no LIST, write, Cloudflare API, or Convex
 * authority is accepted by this function.
 */
export async function verifyPublicDiscoveryBootstrapCompletion(input: {
	s3: S3Sender;
	now?: number;
	headConcurrency?: number;
}) {
	const now = input.now ?? Date.now();
	invariant(Number.isSafeInteger(now) && now >= 0, 'Verifier clock is invalid.');
	const headConcurrency = input.headConcurrency ?? PUBLIC_DISCOVERY_BOOTSTRAP_HEAD_CONCURRENCY;
	const { backend, bucket } = PUBLIC_DISCOVERY_PRODUCTION;
	const checkpointKey = publicTemplatePageBackfillProgressKey(backend);
	const manifestKey = publicDiscoveryManifestStateKeyForBackend(backend);

	const [checkpointObject, manifestObject] = await Promise.all([
		readExactJsonObject({
			s3: input.s3,
			bucket,
			key: checkpointKey,
			label: 'Checkpoint',
			maximumBytes: PUBLIC_TEMPLATE_PAGE_BACKFILL_PROGRESS_MAX_BYTES,
			metadata: CHECKPOINT_METADATA,
			now
		}),
		readExactJsonObject({
			s3: input.s3,
			bucket,
			key: manifestKey,
			label: 'Manifest',
			maximumBytes: PUBLIC_DISCOVERY_MANIFEST_OBJECT_MAX_BYTES,
			metadata: MANIFEST_METADATA,
			now
		})
	]);

	let checkpoint;
	try {
		checkpoint = readPublicTemplatePageBackfillProgress(checkpointObject.decoded, now);
	} catch {
		throw new Error('PUBLIC_DISCOVERY_BOOTSTRAP_INCOMPLETE:Checkpoint schema is invalid.');
	}
	invariant(
		checkpoint.nextOffset === checkpoint.total &&
			checkpoint.enqueuedOffset === checkpoint.total &&
			checkpoint.enqueuedAt === null &&
			checkpoint.enqueueAttempts === 0,
		'Checkpoint still has unfinished or pending Queue handoff work.'
	);
	const recomputedCoordinateDigest = await publicTemplatePageCoordinateDigest(
		checkpoint.coordinates
	);
	invariant(
		recomputedCoordinateDigest === checkpoint.coordinateDigest,
		'Checkpoint coordinate digest does not match its coordinates.'
	);

	let ready;
	try {
		ready = readStrictReadyPublicDiscoveryManifestState(
			manifestObject.decoded,
			backend,
			manifestObject.lastModifiedUpperBoundAt
		);
	} catch {
		throw new Error('PUBLIC_DISCOVERY_BOOTSTRAP_INCOMPLETE:Manifest ready state is invalid.');
	}
	invariant(
		ready.manifest.list.ready && ready.manifest.relations.ready,
		'Manifest families are not both ready.'
	);
	invariant(ready.publicationLag === null, 'Manifest has unresolved publication lag.');
	invariant(
		ready.pendingRetireGenerations.list.length === 0 &&
			ready.pendingRetireGenerations.graph.length === 0,
		'Manifest has pending immutable retirement work.'
	);
	const listGeneration = publicDiscoverySnapshotGeneration(ready.manifest.list);
	const graphGeneration = publicDiscoveryGraphGeneration(ready.manifest);
	invariant(
		ready.payloadGenerations.list.at(-1) === listGeneration &&
			ready.payloadGenerations.graph.at(-1) === graphGeneration,
		'Manifest payload generation ring does not name its current authority.'
	);
	const expectedCheckpointGeneration = `ready:${ready.manifest.list.revision}:${ready.manifest.list.updatedAt}:epoch=${ready.manifest.list.withdrawalEpoch}:artifact-set=3`;
	invariant(
		checkpoint.generation === expectedCheckpointGeneration,
		'Checkpoint generation does not match the ready list authority.'
	);

	const inventoryKey = publicDiscoveryPayloadObjectKeyForBackend(
		PUBLIC_TEMPLATE_PAGE_INVENTORY_LOGICAL_KEY,
		backend,
		listGeneration
	);
	const inventoryObject = await readExactJsonObject({
		s3: input.s3,
		bucket,
		key: inventoryKey,
		label: 'Inventory',
		maximumBytes: PUBLIC_DISCOVERY_CACHE_PAYLOAD_MAX_BYTES,
		metadata: { kind: 'payload', revision: listGeneration },
		now
	});
	const inventory = readInventoryEnvelope(
		inventoryObject.decoded,
		listGeneration,
		inventoryObject.lastModifiedUpperBoundAt
	);
	invariant(
		inventory.revision === ready.manifest.list.revision &&
			inventory.updatedAt === ready.manifest.list.updatedAt,
		'Inventory generation does not match the ready list authority.'
	);
	invariant(
		inventory.entries.length === checkpoint.coordinates.length &&
			inventory.entries.every((entry, index) => {
				const coordinate = checkpoint.coordinates[index];
				return (
					coordinate !== undefined &&
					entry.slug === coordinate.slug &&
					entry.artifactRevision === String(coordinate.artifactRevision)
				);
			}),
		'Inventory coordinates do not match the checkpoint.'
	);

	let jsonBytes = 0;
	let pngBytes = 0;
	await mapLimited(checkpoint.coordinates, headConcurrency, async (coordinate) => {
		const pair = await verifyExactPair({ s3: input.s3, coordinate, now });
		jsonBytes += pair.jsonBytes;
		pngBytes += pair.pngBytes;
	});

	// Fence mutable control state and the immutable inventory against a mixed
	// observation assembled while a producer was advancing authority.
	const [checkpointAfter, manifestAfter, inventoryAfter] = await Promise.all([
		readExactJsonObject({
			s3: input.s3,
			bucket,
			key: checkpointKey,
			label: 'Checkpoint',
			maximumBytes: PUBLIC_TEMPLATE_PAGE_BACKFILL_PROGRESS_MAX_BYTES,
			metadata: CHECKPOINT_METADATA,
			now
		}),
		readExactJsonObject({
			s3: input.s3,
			bucket,
			key: manifestKey,
			label: 'Manifest',
			maximumBytes: PUBLIC_DISCOVERY_MANIFEST_OBJECT_MAX_BYTES,
			metadata: MANIFEST_METADATA,
			now
		}),
		readExactJsonObject({
			s3: input.s3,
			bucket,
			key: inventoryKey,
			label: 'Inventory',
			maximumBytes: PUBLIC_DISCOVERY_CACHE_PAYLOAD_MAX_BYTES,
			metadata: { kind: 'payload', revision: listGeneration },
			now
		})
	]);
	sameObservation(checkpointObject, checkpointAfter, 'Checkpoint');
	sameObservation(manifestObject, manifestAfter, 'Manifest');
	sameObservation(inventoryObject, inventoryAfter, 'Inventory');

	return {
		action: 'verify-public-discovery-bootstrap-completion',
		auditVersion: PUBLIC_DISCOVERY_BOOTSTRAP_PROOF_VERSION,
		artifacts: {
			coordinates: checkpoint.coordinates.length,
			exactHeadReads: checkpoint.coordinates.length * 2,
			jsonBytes,
			pngBytes
		},
		backend,
		bucket,
		checkpoint: {
			coordinateDigest: checkpoint.coordinateDigest,
			etag: checkpointObject.etag,
			generation: checkpoint.generation,
			key: checkpointKey,
			total: checkpoint.total
		},
		environment: 'production',
		inventory: {
			entries: inventory.entries.length,
			etag: inventoryObject.etag,
			key: inventoryKey,
			revision: inventory.revision,
			updatedAt: inventory.updatedAt
		},
		manifest: {
			certifiedAt: ready.certifiedAt,
			etag: manifestObject.etag,
			graphGeneration,
			key: manifestKey,
			listGeneration,
			writtenAt: ready.writtenAt
		},
		proof: 'production-bootstrap-complete',
		readModel: 'six-exact-get-plus-two-exact-heads-per-coordinate;no-list;no-write',
		verifiedAt: now
	};
}

function usage() {
	return [
		'Usage:',
		'  npx tsx scripts/verify-public-discovery-bootstrap-completion.ts',
		'',
		'Required protected environment: CLOUDFLARE_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY.',
		'Production account, backend, bucket, and every R2 key are fixed in source.'
	].join('\n');
}

export function validatePublicDiscoveryBootstrapCompletionEnvironment(input: {
	argumentCount: number;
	accountId: unknown;
	accessKeyId: unknown;
	secretAccessKey: unknown;
}) {
	configurationInvariant(
		input.argumentCount === 0,
		'This production-only verifier accepts no arguments.'
	);
	configurationInvariant(
		input.accountId === PUBLIC_DISCOVERY_PRODUCTION.accountId,
		'CLOUDFLARE_ACCOUNT_ID is not the pinned production account.'
	);
	configurationInvariant(
		typeof input.accessKeyId === 'string' &&
			input.accessKeyId.length >= 1 &&
			input.accessKeyId.length <= 256,
		'R2_ACCESS_KEY_ID is required.'
	);
	configurationInvariant(
		typeof input.secretAccessKey === 'string' &&
			input.secretAccessKey.length >= 1 &&
			input.secretAccessKey.length <= 512,
		'R2_SECRET_ACCESS_KEY is required.'
	);
	return {
		accessKeyId: input.accessKeyId,
		accountId: input.accountId,
		secretAccessKey: input.secretAccessKey
	};
}

const isMain =
	process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
	try {
		const { accountId, accessKeyId, secretAccessKey } =
			validatePublicDiscoveryBootstrapCompletionEnvironment({
				argumentCount: process.argv.length - 2,
				accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
				accessKeyId: process.env.R2_ACCESS_KEY_ID,
				secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
			});
		const s3 = new S3Client({
			credentials: { accessKeyId, secretAccessKey },
			endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
			forcePathStyle: true,
			region: 'auto'
		});
		console.log(canonicalJson(await verifyPublicDiscoveryBootstrapCompletion({ s3 })));
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		console.error(usage());
		process.exitCode = 1;
	}
}
