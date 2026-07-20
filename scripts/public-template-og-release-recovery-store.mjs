#!/usr/bin/env node

import {
	GetObjectCommand,
	HeadObjectCommand,
	PutObjectCommand,
	S3Client
} from '@aws-sdk/client-s3';
import { createHash } from 'node:crypto';
import { createReadStream, lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { readBoundedResponseJson } from '../src/lib/server/bounded-response.mjs';

export const PUBLIC_TEMPLATE_OG_RELEASE_REPOSITORY = 'communisaas/commons';
export const PUBLIC_TEMPLATE_OG_RELEASE_REPOSITORY_ID = '599295397';
export const PUBLIC_TEMPLATE_OG_RELEASE_RECOVERY_BUCKET = 'commons-release-recovery-private';
export const PUBLIC_TEMPLATE_OG_RELEASE_RECOVERY_PREFIX = 'transactions/v1';
export const PUBLIC_TEMPLATE_OG_RELEASE_RECOVERY_RETENTION_SECONDS = 7 * 24 * 60 * 60;

const ACCOUNT_ID_PATTERN = /^[a-f0-9]{32}$/u;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/u;
const POSITIVE_DECIMAL_PATTERN = /^[1-9][0-9]{0,19}$/u;
const TRANSACTION_ID_PATTERN = /^[1-9][0-9]{0,19}-[1-9][0-9]{0,9}$/u;
const MAX_STAGE_BYTES = 1024 * 1024;
const MAX_RELEASE_KIT_BYTES = 512 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;

export const PUBLIC_TEMPLATE_OG_RELEASE_STAGES = Object.freeze([
	'baseline',
	'intent-gate',
	'result-gate',
	'intent-provision-01',
	'result-provision-01',
	'intent-provision-02',
	'result-provision-02',
	'intent-consumer',
	'result-consumer',
	'intent-pages',
	'result-pages',
	'intent-authority-arm',
	'result-authority-arm',
	'intent-activate-01',
	'result-activate-01',
	'intent-activate-02',
	'result-activate-02',
	'activation-complete',
	'qualified',
	'intent-finalize',
	'finalized',
	'intent-recover-authority',
	'result-recover-authority',
	'intent-recover-pages',
	'result-recover-pages',
	'intent-recover-queues',
	'result-recover-queues',
	'intent-recover-consumer',
	'result-recover-consumer',
	'intent-recover-gate',
	'result-recover-gate',
	'superseded',
	'recovered'
]);

const STAGE_RANK = new Map(PUBLIC_TEMPLATE_OG_RELEASE_STAGES.map((stage, index) => [stage, index]));
const TERMINAL_STAGES = new Set(['finalized', 'superseded', 'recovered']);
const RESULT_STAGE_PATTERN = /^result-(.+)$/u;
const RECOVERY_STAGE_PATTERN =
	/^(?:intent|result)-recover-(authority|pages|queues|consumer|gate)$/u;

/** @param {unknown} condition @param {string} message @returns {asserts condition} */
function invariant(condition, message) {
	if (!condition) throw new Error(message);
}

/** @param {unknown} value @returns {Record<string, any> | null} */
function record(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

/** @param {unknown} value @param {string[]} keys @param {string} label */
function assertExactKeys(value, keys, label) {
	const object = record(value);
	invariant(object !== null, `${label} must be an object.`);
	invariant(
		Object.keys(object).sort().join('\0') === keys.slice().sort().join('\0'),
		`${label} keys are not exact.`
	);
}

/** @param {Buffer|Uint8Array|string} value */
export function publicTemplateOgReleaseRecoveryDigest(value) {
	return createHash('sha256').update(value).digest('hex');
}

/** @param {unknown} realm */
export function assertPublicTemplateOgReleaseRealm(realm) {
	invariant(realm === 'preview' || realm === 'production', 'Release recovery realm is invalid.');
	return realm;
}

/** @param {unknown} transactionId */
export function assertPublicTemplateOgReleaseTransactionId(transactionId) {
	invariant(
		typeof transactionId === 'string' && TRANSACTION_ID_PATTERN.test(transactionId),
		'Release transaction id must be <run-id>-<run-attempt>.'
	);
	return transactionId;
}

/** @param {unknown} runId @param {unknown} runAttempt */
export function publicTemplateOgReleaseTransactionId(runId, runAttempt) {
	invariant(
		typeof runId === 'string' && POSITIVE_DECIMAL_PATTERN.test(runId),
		'GitHub run id is invalid.'
	);
	invariant(
		typeof runAttempt === 'string' && /^[1-9][0-9]{0,9}$/u.test(runAttempt),
		'GitHub run attempt is invalid.'
	);
	return assertPublicTemplateOgReleaseTransactionId(`${runId}-${runAttempt}`);
}

/**
 * @param {{repository:unknown,repositoryId:unknown,runId:unknown,runAttempt:unknown,transactionId:unknown,realm:unknown}} value
 */
export function validatePublicTemplateOgReleaseRecoveryIdentity(value) {
	invariant(
		value.repository === PUBLIC_TEMPLATE_OG_RELEASE_REPOSITORY,
		'Release recovery repository is not the protected repository.'
	);
	invariant(
		value.repositoryId === PUBLIC_TEMPLATE_OG_RELEASE_REPOSITORY_ID,
		'Release recovery repository id is not exact.'
	);
	invariant(
		typeof value.runId === 'string' && POSITIVE_DECIMAL_PATTERN.test(value.runId),
		'Release recovery run id is invalid.'
	);
	invariant(
		typeof value.runAttempt === 'string' && /^[1-9][0-9]{0,9}$/u.test(value.runAttempt),
		'Release recovery run attempt is invalid.'
	);
	const transactionId = publicTemplateOgReleaseTransactionId(value.runId, value.runAttempt);
	invariant(
		value.transactionId === transactionId,
		'Release recovery transaction does not match its run and attempt.'
	);
	return Object.freeze({
		repository: PUBLIC_TEMPLATE_OG_RELEASE_REPOSITORY,
		repositoryId: PUBLIC_TEMPLATE_OG_RELEASE_REPOSITORY_ID,
		runId: value.runId,
		runAttempt: value.runAttempt,
		transactionId,
		realm: assertPublicTemplateOgReleaseRealm(value.realm)
	});
}

/** @param {ReturnType<typeof validatePublicTemplateOgReleaseRecoveryIdentity>} identity */
export function publicTemplateOgReleaseRecoveryRoot(identity) {
	const exact = validatePublicTemplateOgReleaseRecoveryIdentity(identity);
	return [
		PUBLIC_TEMPLATE_OG_RELEASE_RECOVERY_PREFIX,
		'repositories',
		exact.repositoryId,
		...exact.repository.split('/'),
		'runs',
		exact.runId,
		'attempts',
		exact.runAttempt,
		'realms',
		exact.realm
	].join('/');
}

/** @param {ReturnType<typeof validatePublicTemplateOgReleaseRecoveryIdentity>} identity */
export function publicTemplateOgReleaseRecoveryKitKey(identity) {
	return `${publicTemplateOgReleaseRecoveryRoot(identity)}/release-kit.tar.gz`;
}

/** @param {ReturnType<typeof validatePublicTemplateOgReleaseRecoveryIdentity>} identity @param {unknown} stage */
export function publicTemplateOgReleaseRecoveryStageKey(identity, stage) {
	assertPublicTemplateOgReleaseStage(stage);
	return `${publicTemplateOgReleaseRecoveryRoot(identity)}/stages/${stage}.json`;
}

/**
 * Every possible child of one stage contends on the same immutable claim key.
 * This prevents a normal continuation and a recovery continuation from both
 * acquiring sibling stage names and mutating before a later reader sees a fork.
 * @param {ReturnType<typeof validatePublicTemplateOgReleaseRecoveryIdentity>} identity
 * @param {string|null} previousDigest
 */
export function publicTemplateOgReleaseRecoveryClaimKey(identity, previousDigest) {
	if (previousDigest !== null) {
		invariant(DIGEST_PATTERN.test(previousDigest), 'Release stage claim digest is invalid.');
	}
	return `${publicTemplateOgReleaseRecoveryRoot(identity)}/claims/${previousDigest ?? 'root'}.json`;
}

/** @param {unknown} stage */
export function assertPublicTemplateOgReleaseStage(stage) {
	invariant(
		typeof stage === 'string' && STAGE_RANK.has(stage),
		'Release recovery stage is invalid.'
	);
	return stage;
}

/** @param {string|null} previousStage @param {string} stage */
export function validatePublicTemplateOgReleaseStageTransition(previousStage, stage) {
	const next = assertPublicTemplateOgReleaseStage(stage);
	if (next === 'baseline') {
		invariant(previousStage === null, 'Release baseline cannot have a predecessor.');
		return next;
	}
	const previous = assertPublicTemplateOgReleaseStage(previousStage);
	invariant(!TERMINAL_STAGES.has(previous), 'A terminal release stage cannot gain a child.');

	const result = RESULT_STAGE_PATTERN.exec(next);
	if (result && !next.startsWith('result-recover-')) {
		invariant(previous === `intent-${result[1]}`, `${next} must follow its exact intent.`);
		return next;
	}
	if (next.startsWith('result-recover-')) {
		invariant(
			previous === next.replace('result-', 'intent-'),
			`${next} must follow its exact intent.`
		);
		return next;
	}

	if (next === 'intent-gate')
		invariant(previous === 'baseline', 'Gate intent must follow baseline.');
	else if (next === 'intent-provision-01')
		invariant(previous === 'result-gate', 'First provision intent must follow the gate result.');
	else if (next === 'intent-provision-02')
		invariant(
			previous === 'result-provision-01',
			'Second provision intent must follow the first provision result.'
		);
	else if (next === 'intent-consumer')
		invariant(
			['result-gate', 'result-provision-01', 'result-provision-02'].includes(previous),
			'Consumer intent does not follow a completed gate/provision stage.'
		);
	else if (next === 'intent-pages')
		invariant(previous === 'result-consumer', 'Pages intent must follow the consumer result.');
	else if (next === 'intent-authority-arm')
		invariant(previous === 'result-pages', 'Authority intent must follow the Pages result.');
	else if (next === 'intent-activate-01')
		invariant(
			previous === 'result-authority-arm',
			'First Queue activation intent must follow authority arm.'
		);
	else if (next === 'intent-activate-02')
		invariant(
			previous === 'result-activate-01',
			'Second Queue activation intent must follow the first activation result.'
		);
	else if (next === 'activation-complete')
		invariant(
			['result-authority-arm', 'result-activate-01', 'result-activate-02'].includes(previous),
			'Activation completion does not follow an active authority/Queue result.'
		);
	else if (next === 'qualified')
		invariant(
			previous === 'activation-complete',
			'Qualification must follow activation completion.'
		);
	else if (next === 'intent-finalize')
		invariant(previous === 'qualified', 'Finalize intent must follow exact qualification.');
	else if (next === 'finalized')
		invariant(
			previous === 'intent-finalize',
			'Finalized evidence must follow exact finalize intent.'
		);
	else if (next === 'superseded') {
		// A live mismatching authority is a terminal no-op fence from any nonterminal stage.
	} else if (next === 'recovered') {
		// Recovery can be complete without every optional resource having required mutation.
	} else if (next.startsWith('intent-recover-')) {
		const nextRank = STAGE_RANK.get(next) ?? -1;
		const previousRank = STAGE_RANK.get(previous) ?? -1;
		invariant(nextRank > previousRank, 'Recovery intents must advance monotonically.');
	} else {
		throw new Error(`Unsupported release stage transition: ${previous} -> ${next}.`);
	}
	return next;
}

/**
 * @param {{identity:ReturnType<typeof validatePublicTemplateOgReleaseRecoveryIdentity>,stage:string,previousStage:string|null,previousDigest:string|null,releaseKitDigest:string,journal:unknown,evidence?:unknown}} input
 */
export function createPublicTemplateOgReleaseStageEnvelope({
	identity,
	stage,
	previousStage,
	previousDigest,
	releaseKitDigest,
	journal,
	evidence = null
}) {
	const exact = validatePublicTemplateOgReleaseRecoveryIdentity(identity);
	validatePublicTemplateOgReleaseStageTransition(previousStage, stage);
	invariant(DIGEST_PATTERN.test(releaseKitDigest), 'Release kit digest is invalid.');
	invariant(
		(previousStage === null && previousDigest === null) ||
			(previousStage !== null &&
				typeof previousDigest === 'string' &&
				DIGEST_PATTERN.test(previousDigest)),
		'Release stage predecessor digest is invalid.'
	);
	const journalRecord = record(journal);
	invariant(journalRecord !== null, 'Release stage journal must be an object.');
	for (const [key, expected] of Object.entries(exact)) {
		invariant(journalRecord[key] === expected, `Release journal ${key} crossed identities.`);
	}
	invariant(
		journalRecord.releaseKitDigest === releaseKitDigest &&
			journalRecord.lastStage === previousStage &&
			journalRecord.lastStageDigest === previousDigest,
		'Release journal does not identify the predecessor stage and kit.'
	);
	invariant(evidence === null || record(evidence) !== null, 'Release stage evidence is invalid.');
	return {
		schemaVersion: 1,
		repository: exact.repository,
		repositoryId: exact.repositoryId,
		runId: exact.runId,
		runAttempt: exact.runAttempt,
		transactionId: exact.transactionId,
		realm: exact.realm,
		stage,
		previousStage,
		previousDigest,
		releaseKitDigest,
		journal: journalRecord,
		evidence
	};
}

/** @param {ReturnType<typeof createPublicTemplateOgReleaseStageEnvelope>} envelope */
export function serializePublicTemplateOgReleaseStageEnvelope(envelope) {
	return Buffer.from(`${JSON.stringify(envelope)}\n`, 'utf8');
}

/**
 * @param {unknown} value
 * @param {ReturnType<typeof validatePublicTemplateOgReleaseRecoveryIdentity>} expectedIdentity
 */
export function validatePublicTemplateOgReleaseStageEnvelope(value, expectedIdentity) {
	assertExactKeys(
		value,
		[
			'schemaVersion',
			'repository',
			'repositoryId',
			'runId',
			'runAttempt',
			'transactionId',
			'realm',
			'stage',
			'previousStage',
			'previousDigest',
			'releaseKitDigest',
			'journal',
			'evidence'
		],
		'Release recovery stage envelope'
	);
	const envelope = /** @type {Record<string, any>} */ (value);
	invariant(envelope.schemaVersion === 1, 'Release recovery stage schema is invalid.');
	const identity = validatePublicTemplateOgReleaseRecoveryIdentity({
		repository: envelope.repository,
		repositoryId: envelope.repositoryId,
		runId: envelope.runId,
		runAttempt: envelope.runAttempt,
		transactionId: envelope.transactionId,
		realm: envelope.realm
	});
	const expected = validatePublicTemplateOgReleaseRecoveryIdentity(expectedIdentity);
	invariant(
		identity.repository === expected.repository &&
			identity.repositoryId === expected.repositoryId &&
			identity.runId === expected.runId &&
			identity.runAttempt === expected.runAttempt &&
			identity.transactionId === expected.transactionId &&
			identity.realm === expected.realm,
		'Release recovery stage crossed its expected identity.'
	);
	return createPublicTemplateOgReleaseStageEnvelope({
		identity,
		stage: envelope.stage,
		previousStage: envelope.previousStage,
		previousDigest: envelope.previousDigest,
		releaseKitDigest: envelope.releaseKitDigest,
		journal: envelope.journal,
		evidence: envelope.evidence
	});
}

/**
 * @param {Map<string,{bytes:Buffer,envelope:ReturnType<typeof createPublicTemplateOgReleaseStageEnvelope>,digest:string}>} stages
 */
export function validatePublicTemplateOgReleaseStageChain(stages) {
	if (stages.size === 0) return { state: 'absent', latest: null };
	invariant(stages.has('baseline'), 'Release recovery has orphan stages without baseline.');
	const children = new Map();
	for (const [stage, entry] of stages) {
		invariant(entry.envelope.stage === stage, 'Release stage object key and payload disagree.');
		invariant(
			entry.digest === publicTemplateOgReleaseRecoveryDigest(entry.bytes),
			`Release stage ${stage} digest is invalid.`
		);
		const previous = entry.envelope.previousStage;
		if (previous === null) {
			invariant(stage === 'baseline', 'Only baseline can begin the release stage chain.');
			continue;
		}
		const parent = stages.get(previous);
		invariant(parent, `Release stage ${stage} has a missing predecessor ${previous}.`);
		invariant(
			entry.envelope.previousDigest === parent.digest,
			`Release stage ${stage} predecessor digest is invalid.`
		);
		invariant(!children.has(previous), `Release stage chain forks after ${previous}.`);
		children.set(previous, stage);
	}

	let cursor = 'baseline';
	const visited = new Set();
	while (cursor) {
		invariant(!visited.has(cursor), 'Release stage chain contains a cycle.');
		visited.add(cursor);
		cursor = children.get(cursor) ?? '';
	}
	invariant(visited.size === stages.size, 'Release recovery contains a disconnected stage chain.');
	const leaves = [...stages.keys()].filter((stage) => !children.has(stage));
	invariant(leaves.length === 1, 'Release recovery stage chain has multiple leaves.');
	const latest = stages.get(leaves[0]);
	invariant(latest, 'Release recovery latest stage is unavailable.');
	return { state: 'present', latest };
}

/** @param {unknown} error */
function objectMissing(error) {
	const candidate = /** @type {any} */ (error);
	return (
		candidate?.$metadata?.httpStatusCode === 404 &&
		(candidate?.name === 'NoSuchKey' ||
			candidate?.name === 'NotFound' ||
			candidate?.Code === 'NoSuchKey')
	);
}

/** @param {unknown} error */
function preconditionFailed(error) {
	const candidate = /** @type {any} */ (error);
	return (
		candidate?.$metadata?.httpStatusCode === 412 ||
		candidate?.name === 'PreconditionFailed' ||
		candidate?.Code === 'PreconditionFailed'
	);
}

/** @param {unknown} body @param {number} maximumBytes @returns {Promise<Buffer>} */
async function readSdkBody(body, maximumBytes) {
	invariant(
		body !== null &&
			typeof body === 'object' &&
			typeof (/** @type {any} */ (body)[Symbol.asyncIterator]) === 'function',
		'R2 object body is unavailable.'
	);
	const stream = /** @type {AsyncIterable<Uint8Array>} */ (body);
	const chunks = [];
	let bytes = 0;
	for await (const chunk of stream) {
		const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		bytes += value.byteLength;
		invariant(bytes <= maximumBytes, 'R2 recovery object exceeds its byte limit.');
		chunks.push(value);
	}
	return Buffer.concat(chunks, bytes);
}

/**
 * @param {{accountId:string,accessKeyId:string,secretAccessKey:string,requestHandler?:unknown}} input
 */
export function createPublicTemplateOgReleaseRecoveryS3Client({
	accountId,
	accessKeyId,
	secretAccessKey,
	requestHandler
}) {
	invariant(ACCOUNT_ID_PATTERN.test(accountId), 'Recovery R2 account id is invalid.');
	invariant(
		typeof accessKeyId === 'string' && /^[A-Za-z0-9]{16,64}$/u.test(accessKeyId),
		'Recovery R2 access key id is invalid.'
	);
	invariant(
		typeof secretAccessKey === 'string' &&
			secretAccessKey.length >= 32 &&
			secretAccessKey.length <= 256,
		'Recovery R2 secret access key is invalid.'
	);
	return new S3Client({
		region: 'auto',
		endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
		credentials: { accessKeyId, secretAccessKey },
		forcePathStyle: true,
		maxAttempts: 3,
		...(requestHandler ? { requestHandler } : {})
	});
}

/**
 * @param {{client:S3Client,key:string,maximumBytes:number}} input
 * @returns {Promise<null|{bytes:Buffer,contentLength:number,metadata:Record<string,string>} >}
 */
export async function getPublicTemplateOgReleaseRecoveryObject({ client, key, maximumBytes }) {
	invariant(
		typeof key === 'string' && key.startsWith(`${PUBLIC_TEMPLATE_OG_RELEASE_RECOVERY_PREFIX}/`),
		'Recovery R2 key is outside the fixed prefix.'
	);
	invariant(
		Number.isSafeInteger(maximumBytes) && maximumBytes > 0 && maximumBytes <= MAX_RELEASE_KIT_BYTES,
		'Recovery R2 object limit is invalid.'
	);
	let result;
	try {
		result = await client.send(
			new GetObjectCommand({ Bucket: PUBLIC_TEMPLATE_OG_RELEASE_RECOVERY_BUCKET, Key: key }),
			{ abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }
		);
	} catch (error) {
		if (objectMissing(error)) return null;
		throw error;
	}
	const contentLength = result.ContentLength;
	invariant(
		typeof contentLength === 'number' &&
			Number.isSafeInteger(contentLength) &&
			contentLength > 0 &&
			contentLength <= maximumBytes,
		'Recovery R2 object has an invalid declared length.'
	);
	const bytes = await readSdkBody(result.Body, maximumBytes);
	invariant(bytes.byteLength === contentLength, 'Recovery R2 object length changed during GET.');
	return {
		bytes,
		contentLength,
		metadata: /** @type {Record<string,string>} */ (result.Metadata ?? {})
	};
}

/**
 * @param {{client:S3Client,key:string,bytes:Buffer,contentType:string,metadata:Record<string,string>,maximumBytes?:number}} input
 */
export async function putPublicTemplateOgReleaseRecoveryBytesIfAbsent({
	client,
	key,
	bytes,
	contentType,
	metadata,
	maximumBytes = MAX_STAGE_BYTES
}) {
	invariant(
		Buffer.isBuffer(bytes) && bytes.byteLength > 0 && bytes.byteLength <= maximumBytes,
		'Recovery object bytes are invalid.'
	);
	const digest = publicTemplateOgReleaseRecoveryDigest(bytes);
	const exactMetadata = { ...metadata, sha256: digest };
	let created = true;
	try {
		await client.send(
			new PutObjectCommand({
				Bucket: PUBLIC_TEMPLATE_OG_RELEASE_RECOVERY_BUCKET,
				Key: key,
				Body: bytes,
				ContentLength: bytes.byteLength,
				ContentType: contentType,
				IfNoneMatch: '*',
				Metadata: exactMetadata
			}),
			{ abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }
		);
	} catch (error) {
		if (!preconditionFailed(error)) throw error;
		created = false;
		const existing = await getPublicTemplateOgReleaseRecoveryObject({
			client,
			key,
			maximumBytes
		});
		invariant(
			existing && existing.bytes.equals(bytes),
			'Append-only recovery key was preoccupied.'
		);
	}
	const head = await client.send(
		new HeadObjectCommand({ Bucket: PUBLIC_TEMPLATE_OG_RELEASE_RECOVERY_BUCKET, Key: key }),
		{ abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }
	);
	invariant(
		head.ContentLength === bytes.byteLength && head.Metadata?.sha256 === digest,
		'Recovery R2 object HEAD proof does not match its bytes.'
	);
	return { created, digest, bytes: bytes.byteLength, key };
}

/**
 * Atomically claim the sole child slot for a predecessor, then persist the
 * immutable stage. A crash after the claim but before the stage is safely
 * retryable only with byte-identical claim/stage data; a competing child fails.
 * @param {{client:S3Client,identity:ReturnType<typeof validatePublicTemplateOgReleaseRecoveryIdentity>,envelope:ReturnType<typeof createPublicTemplateOgReleaseStageEnvelope>}} input
 */
export async function putPublicTemplateOgReleaseRecoveryStage({ client, identity, envelope }) {
	const exact = validatePublicTemplateOgReleaseRecoveryIdentity(identity);
	const validated = validatePublicTemplateOgReleaseStageEnvelope(envelope, exact);
	const stageBytes = serializePublicTemplateOgReleaseStageEnvelope(validated);
	const stageDigest = publicTemplateOgReleaseRecoveryDigest(stageBytes);
	const claim = {
		schemaVersion: 1,
		repository: exact.repository,
		repositoryId: exact.repositoryId,
		runId: exact.runId,
		runAttempt: exact.runAttempt,
		transactionId: exact.transactionId,
		realm: exact.realm,
		previousStage: validated.previousStage,
		previousDigest: validated.previousDigest,
		nextStage: validated.stage,
		nextDigest: stageDigest
	};
	const claimBytes = Buffer.from(`${JSON.stringify(claim)}\n`, 'utf8');
	await putPublicTemplateOgReleaseRecoveryBytesIfAbsent({
		client,
		key: publicTemplateOgReleaseRecoveryClaimKey(exact, validated.previousDigest),
		bytes: claimBytes,
		contentType: 'application/json',
		metadata: {
			schema: 'commons-release-stage-claim-v1',
			stage: validated.stage,
			realm: exact.realm,
			'transaction-id': exact.transactionId
		}
	});
	const persisted = await putPublicTemplateOgReleaseRecoveryBytesIfAbsent({
		client,
		key: publicTemplateOgReleaseRecoveryStageKey(exact, validated.stage),
		bytes: stageBytes,
		contentType: 'application/json',
		metadata: {
			schema: 'commons-release-stage-v1',
			stage: validated.stage,
			realm: exact.realm,
			'transaction-id': exact.transactionId,
			'repository-id': exact.repositoryId,
			'run-id': exact.runId,
			'run-attempt': exact.runAttempt
		}
	});
	invariant(persisted.digest === stageDigest, 'Persisted release stage digest changed.');
	return persisted;
}

/**
 * @param {{client:S3Client,key:string,filePath:string,expectedDigest:string,contentType:string,metadata:Record<string,string>}} input
 */
export async function putPublicTemplateOgReleaseRecoveryFileIfAbsent({
	client,
	key,
	filePath,
	expectedDigest,
	contentType,
	metadata
}) {
	invariant(DIGEST_PATTERN.test(expectedDigest), 'Recovery file digest is invalid.');
	const target = path.resolve(filePath);
	const stat = lstatSync(target);
	invariant(
		stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= MAX_RELEASE_KIT_BYTES,
		'Recovery release kit must be a bounded ordinary file.'
	);
	const localBytes = readFileSync(target);
	invariant(
		publicTemplateOgReleaseRecoveryDigest(localBytes) === expectedDigest,
		'Recovery release kit digest does not match the expected kit.'
	);
	let created = true;
	try {
		await client.send(
			new PutObjectCommand({
				Bucket: PUBLIC_TEMPLATE_OG_RELEASE_RECOVERY_BUCKET,
				Key: key,
				Body: createReadStream(target),
				ContentLength: stat.size,
				ContentType: contentType,
				IfNoneMatch: '*',
				Metadata: { ...metadata, sha256: expectedDigest }
			}),
			{ abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }
		);
	} catch (error) {
		if (!preconditionFailed(error)) throw error;
		created = false;
		const existing = await getPublicTemplateOgReleaseRecoveryObject({
			client,
			key,
			maximumBytes: MAX_RELEASE_KIT_BYTES
		});
		invariant(
			existing && publicTemplateOgReleaseRecoveryDigest(existing.bytes) === expectedDigest,
			'Append-only release kit key was preoccupied.'
		);
	}
	const head = await client.send(
		new HeadObjectCommand({ Bucket: PUBLIC_TEMPLATE_OG_RELEASE_RECOVERY_BUCKET, Key: key }),
		{ abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }
	);
	invariant(
		head.ContentLength === stat.size && head.Metadata?.sha256 === expectedDigest,
		'Recovery release kit HEAD proof does not match its bytes.'
	);
	return { created, digest: expectedDigest, bytes: stat.size, key };
}

/**
 * @param {{client:S3Client,identity:ReturnType<typeof validatePublicTemplateOgReleaseRecoveryIdentity>}} input
 */
export async function loadPublicTemplateOgReleaseRecoveryStageChain({ client, identity }) {
	const exact = validatePublicTemplateOgReleaseRecoveryIdentity(identity);
	const stages = new Map();
	const discovered = await Promise.all(
		PUBLIC_TEMPLATE_OG_RELEASE_STAGES.map(async (stage) => {
			const key = publicTemplateOgReleaseRecoveryStageKey(exact, stage);
			const object = await getPublicTemplateOgReleaseRecoveryObject({
				client,
				key,
				maximumBytes: MAX_STAGE_BYTES
			});
			if (!object) return null;
			invariant(
				object.metadata.sha256 === publicTemplateOgReleaseRecoveryDigest(object.bytes) &&
					object.metadata.stage === stage &&
					object.metadata['transaction-id'] === exact.transactionId &&
					object.metadata.realm === exact.realm,
				`Recovery stage ${stage} metadata is invalid.`
			);
			let parsed;
			try {
				parsed = JSON.parse(object.bytes.toString('utf8'));
			} catch {
				throw new Error(`Recovery stage ${stage} is not JSON.`);
			}
			const envelope = validatePublicTemplateOgReleaseStageEnvelope(parsed, exact);
			return [
				stage,
				{
					bytes: object.bytes,
					envelope,
					digest: publicTemplateOgReleaseRecoveryDigest(object.bytes)
				}
			];
		})
	);
	for (const discoveredStage of discovered) {
		if (discoveredStage) stages.set(discoveredStage[0], discoveredStage[1]);
	}
	const chain = validatePublicTemplateOgReleaseStageChain(stages);
	await Promise.all(
		[...stages].map(async ([stage, entry]) => {
			const claimObject = await getPublicTemplateOgReleaseRecoveryObject({
				client,
				key: publicTemplateOgReleaseRecoveryClaimKey(exact, entry.envelope.previousDigest),
				maximumBytes: MAX_STAGE_BYTES
			});
			invariant(claimObject, `Release stage ${stage} has no serialized child claim.`);
			let claim;
			try {
				claim = JSON.parse(claimObject.bytes.toString('utf8'));
			} catch {
				throw new Error(`Release stage ${stage} claim is not JSON.`);
			}
			assertExactKeys(
				claim,
				[
					'schemaVersion',
					'repository',
					'repositoryId',
					'runId',
					'runAttempt',
					'transactionId',
					'realm',
					'previousStage',
					'previousDigest',
					'nextStage',
					'nextDigest'
				],
				`Release stage ${stage} claim`
			);
			invariant(
				claim.schemaVersion === 1 &&
					claim.repository === exact.repository &&
					claim.repositoryId === exact.repositoryId &&
					claim.runId === exact.runId &&
					claim.runAttempt === exact.runAttempt &&
					claim.transactionId === exact.transactionId &&
					claim.realm === exact.realm &&
					claim.previousStage === entry.envelope.previousStage &&
					claim.previousDigest === entry.envelope.previousDigest &&
					claim.nextStage === stage &&
					claim.nextDigest === entry.digest,
				`Release stage ${stage} claim does not own its predecessor slot.`
			);
		})
	);
	return chain;
}

/** @param {Response} response @param {string} label */
async function cloudflareEnvelope(response, label) {
	invariant(response.status === 200 && response.ok, `${label} returned HTTP ${response.status}.`);
	const value = await readBoundedResponseJson(response, label, 256 * 1024);
	invariant(value?.success === true && record(value.result), `${label} response is invalid.`);
	return value.result;
}

/**
 * Verify that recovery custody is a private, append-only, seven-day bucket.
 * Provisioning is intentionally external: absence or configuration drift blocks
 * release before the first intent stage can be persisted.
 * @param {{accountId:string,apiToken:string,fetchFn?:typeof fetch}} input
 */
export async function verifyPublicTemplateOgReleaseRecoveryBucket({
	accountId,
	apiToken,
	fetchFn = fetch
}) {
	invariant(ACCOUNT_ID_PATTERN.test(accountId), 'Recovery bucket account id is invalid.');
	invariant(
		typeof apiToken === 'string' && apiToken.length > 0,
		'Cloudflare API token is required.'
	);
	const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${PUBLIC_TEMPLATE_OG_RELEASE_RECOVERY_BUCKET}`;
	/** @param {string} suffix @param {string} label */
	const request = (suffix, label) =>
		fetchFn(`${base}${suffix}`, {
			headers: { Authorization: `Bearer ${apiToken}` },
			redirect: 'error',
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
		}).then((response) => cloudflareEnvelope(response, label));
	const [bucket, lifecycle, locks, managed, custom] = await Promise.all([
		request('', 'Recovery R2 bucket'),
		request('/lifecycle', 'Recovery R2 lifecycle'),
		request('/lock', 'Recovery R2 bucket lock'),
		request('/domains/managed', 'Recovery R2 managed domain'),
		request('/domains/custom', 'Recovery R2 custom domains')
	]);
	invariant(
		bucket.name === PUBLIC_TEMPLATE_OG_RELEASE_RECOVERY_BUCKET &&
			bucket.storage_class === 'Standard' &&
			bucket.jurisdiction === 'default' &&
			typeof bucket.creation_date === 'string' &&
			Number.isSafeInteger(Date.parse(bucket.creation_date)),
		'Recovery R2 bucket identity is not exact.'
	);
	const lifecycleRules = lifecycle.rules;
	invariant(
		Array.isArray(lifecycleRules) && lifecycleRules.length === 1,
		'Recovery lifecycle rules are not exact.'
	);
	const lifecycleRule = lifecycleRules[0];
	invariant(
		lifecycleRule?.id === 'commons-release-recovery-expiry-v1' &&
			lifecycleRule.enabled === true &&
			lifecycleRule.conditions?.prefix === `${PUBLIC_TEMPLATE_OG_RELEASE_RECOVERY_PREFIX}/` &&
			lifecycleRule.deleteObjectsTransition?.condition?.type === 'Age' &&
			lifecycleRule.deleteObjectsTransition.condition.maxAge ===
				PUBLIC_TEMPLATE_OG_RELEASE_RECOVERY_RETENTION_SECONDS,
		'Recovery lifecycle must expire only the fixed transaction prefix after seven days.'
	);
	const lockRules = locks.rules;
	invariant(
		Array.isArray(lockRules) && lockRules.length === 1,
		'Recovery bucket lock rules are not exact.'
	);
	const lockRule = lockRules[0];
	invariant(
		lockRule?.id === 'commons-release-recovery-append-only-v1' &&
			lockRule.enabled === true &&
			lockRule.prefix === `${PUBLIC_TEMPLATE_OG_RELEASE_RECOVERY_PREFIX}/` &&
			lockRule.condition?.type === 'Age' &&
			lockRule.condition.maxAgeSeconds === PUBLIC_TEMPLATE_OG_RELEASE_RECOVERY_RETENTION_SECONDS,
		'Recovery bucket lock must make transaction objects append-only for seven days.'
	);
	invariant(managed.enabled === false, 'Recovery R2 r2.dev access must be disabled.');
	invariant(
		Array.isArray(custom.domains) && custom.domains.length === 0,
		'Recovery R2 cannot have custom domains.'
	);
	return {
		bucket: PUBLIC_TEMPLATE_OG_RELEASE_RECOVERY_BUCKET,
		private: true,
		appendOnly: true,
		retentionSeconds: PUBLIC_TEMPLATE_OG_RELEASE_RECOVERY_RETENTION_SECONDS
	};
}
