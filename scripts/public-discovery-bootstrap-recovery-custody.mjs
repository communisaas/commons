#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { closeSync, fsyncSync, lstatSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readBoundedResponseJson } from '../src/lib/server/bounded-response.mjs';
import {
	PUBLIC_TEMPLATE_OG_RELEASE_RECOVERY_PREFIX,
	createPublicTemplateOgReleaseRecoveryS3Client,
	getPublicTemplateOgReleaseRecoveryObject,
	publicTemplateOgReleaseRecoveryDigest,
	putPublicTemplateOgReleaseRecoveryBytesIfAbsent,
	verifyPublicTemplateOgReleaseRecoveryBucket
} from './public-template-og-release-recovery-store.mjs';
import {
	PUBLIC_DISCOVERY_BOOTSTRAP_ROUTE,
	PUBLIC_DISCOVERY_BOOTSTRAP_WORKER,
	validatePublicDiscoveryBootstrapSourceConfig,
	verifyPublicDiscoveryBootstrapDeployment,
	verifyPublicDiscoveryBootstrapRouteLive
} from './verify-public-discovery-bootstrap-deployment.mjs';

export const PUBLIC_DISCOVERY_BOOTSTRAP_CUSTODY_STAGES = Object.freeze([
	'intent',
	'deployed',
	'cleaned'
]);

const ACCOUNT_ID = '019d1184e655db74b7589794a2a2a533';
const REPOSITORY = 'communisaas/commons';
const REPOSITORY_ID = '599295397';
const SHA_PATTERN = /^[a-f0-9]{40}$/u;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/u;
const POSITIVE_DECIMAL_PATTERN = /^[1-9][0-9]{0,19}$/u;
const TRANSACTION_PATTERN = /^[1-9][0-9]{0,19}-[1-9][0-9]{0,9}$/u;
const VERSION_PATTERN =
	/^(?:[a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/u;
const MAX_JOURNAL_BYTES = 1024 * 1024;

/** @param {unknown} condition @param {string} message @returns {asserts condition} */
function invariant(condition, message) {
	if (!condition) throw new Error(message);
}

/** @param {unknown} value @returns {Record<string,any>|null} */
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

/** @param {{repository:unknown,repositoryId:unknown,runId:unknown,runAttempt:unknown,transactionId:unknown}} value */
export function validatePublicDiscoveryBootstrapCustodyIdentity(value) {
	invariant(value.repository === REPOSITORY, 'Bootstrap custody repository is not protected.');
	invariant(value.repositoryId === REPOSITORY_ID, 'Bootstrap custody repository id is not exact.');
	invariant(
		typeof value.runId === 'string' && POSITIVE_DECIMAL_PATTERN.test(value.runId),
		'Bootstrap custody run id is invalid.'
	);
	invariant(
		typeof value.runAttempt === 'string' && /^[1-9][0-9]{0,9}$/u.test(value.runAttempt),
		'Bootstrap custody run attempt is invalid.'
	);
	const transactionId = `${value.runId}-${value.runAttempt}`;
	invariant(
		TRANSACTION_PATTERN.test(transactionId) && value.transactionId === transactionId,
		'Bootstrap custody transaction does not match its run and attempt.'
	);
	return Object.freeze({
		repository: REPOSITORY,
		repositoryId: REPOSITORY_ID,
		runId: value.runId,
		runAttempt: value.runAttempt,
		transactionId
	});
}

/** @param {ReturnType<typeof validatePublicDiscoveryBootstrapCustodyIdentity>} identity */
export function publicDiscoveryBootstrapCustodyRoot(identity) {
	const exact = validatePublicDiscoveryBootstrapCustodyIdentity(identity);
	return `${PUBLIC_TEMPLATE_OG_RELEASE_RECOVERY_PREFIX}/repositories/${exact.repositoryId}/runs/${exact.runId}/attempts/${exact.runAttempt}/bootstrap-production`;
}

/** @param {ReturnType<typeof validatePublicDiscoveryBootstrapCustodyIdentity>} identity @param {string} stage */
export function publicDiscoveryBootstrapCustodyStageKey(identity, stage) {
	invariant(
		PUBLIC_DISCOVERY_BOOTSTRAP_CUSTODY_STAGES.includes(stage),
		'Bootstrap custody stage is invalid.'
	);
	return `${publicDiscoveryBootstrapCustodyRoot(identity)}/stages/${stage}.json`;
}

/**
 * @param {{identity:ReturnType<typeof validatePublicDiscoveryBootstrapCustodyIdentity>,sourceSha:string,trustedGateSha:string,stage:'intent'|'deployed'|'cleaned',previousStage:null|'intent'|'deployed',previousDigest:string|null,versionId:string|null}} input
 */
export function createPublicDiscoveryBootstrapCustodyStage({
	identity,
	sourceSha,
	trustedGateSha,
	stage,
	previousStage,
	previousDigest,
	versionId
}) {
	const exact = validatePublicDiscoveryBootstrapCustodyIdentity(identity);
	invariant(SHA_PATTERN.test(sourceSha), 'Bootstrap custody source SHA is invalid.');
	invariant(SHA_PATTERN.test(trustedGateSha), 'Bootstrap custody trusted gate SHA is invalid.');
	invariant(
		PUBLIC_DISCOVERY_BOOTSTRAP_CUSTODY_STAGES.includes(stage),
		'Bootstrap custody stage is invalid.'
	);
	if (stage === 'intent') {
		invariant(
			previousStage === null && previousDigest === null && versionId === null,
			'Bootstrap intent must be the versionless custody root.'
		);
	} else if (stage === 'deployed') {
		invariant(
			previousStage === 'intent' &&
				DIGEST_PATTERN.test(previousDigest ?? '') &&
				VERSION_PATTERN.test(versionId ?? ''),
			'Bootstrap deployed custody must follow intent with one exact version.'
		);
	} else {
		invariant(
			(previousStage === 'intent' || previousStage === 'deployed') &&
				DIGEST_PATTERN.test(previousDigest ?? '') &&
				((previousStage === 'intent' && versionId === null) ||
					(previousStage === 'deployed' && VERSION_PATTERN.test(versionId ?? ''))),
			'Bootstrap cleaned custody has an invalid predecessor.'
		);
	}
	return {
		schemaVersion: 1,
		...exact,
		sourceSha,
		trustedGateSha,
		worker: PUBLIC_DISCOVERY_BOOTSTRAP_WORKER,
		route: PUBLIC_DISCOVERY_BOOTSTRAP_ROUTE,
		stage,
		previousStage,
		previousDigest,
		versionId
	};
}

/** @param {unknown} value @param {ReturnType<typeof validatePublicDiscoveryBootstrapCustodyIdentity>} expectedIdentity @param {string} expectedTrustedGateSha */
export function validatePublicDiscoveryBootstrapCustodyStage(
	value,
	expectedIdentity,
	expectedTrustedGateSha
) {
	assertExactKeys(
		value,
		[
			'schemaVersion',
			'repository',
			'repositoryId',
			'runId',
			'runAttempt',
			'transactionId',
			'sourceSha',
			'trustedGateSha',
			'worker',
			'route',
			'stage',
			'previousStage',
			'previousDigest',
			'versionId'
		],
		'Bootstrap custody stage'
	);
	const stage = /** @type {Record<string,any>} */ (value);
	invariant(stage.schemaVersion === 1, 'Bootstrap custody schema is invalid.');
	const identity = validatePublicDiscoveryBootstrapCustodyIdentity(
		/** @type {{repository:unknown,repositoryId:unknown,runId:unknown,runAttempt:unknown,transactionId:unknown}} */ (
			stage
		)
	);
	const expected = validatePublicDiscoveryBootstrapCustodyIdentity(expectedIdentity);
	invariant(
		identity.repository === expected.repository &&
			identity.repositoryId === expected.repositoryId &&
			identity.runId === expected.runId &&
			identity.runAttempt === expected.runAttempt &&
			identity.transactionId === expected.transactionId,
		'Bootstrap custody crossed its fixed transaction path.'
	);
	invariant(
		stage.trustedGateSha === expectedTrustedGateSha,
		'Bootstrap custody crossed its trusted gate.'
	);
	invariant(
		stage.worker === PUBLIC_DISCOVERY_BOOTSTRAP_WORKER &&
			stage.route === PUBLIC_DISCOVERY_BOOTSTRAP_ROUTE,
		'Bootstrap custody crossed its fixed Worker or route.'
	);
	return createPublicDiscoveryBootstrapCustodyStage({
		identity,
		sourceSha: stage.sourceSha,
		trustedGateSha: stage.trustedGateSha,
		stage: stage.stage,
		previousStage: stage.previousStage,
		previousDigest: stage.previousDigest,
		versionId: stage.versionId
	});
}

/** @param {ReturnType<typeof createPublicDiscoveryBootstrapCustodyStage>} stage */
function serializeStage(stage) {
	return Buffer.from(`${JSON.stringify(stage)}\n`, 'utf8');
}

/** @param {{client:import('@aws-sdk/client-s3').S3Client,identity:ReturnType<typeof validatePublicDiscoveryBootstrapCustodyIdentity>,stage:ReturnType<typeof createPublicDiscoveryBootstrapCustodyStage>}} input */
export async function putPublicDiscoveryBootstrapCustodyStage({ client, identity, stage }) {
	const validated = validatePublicDiscoveryBootstrapCustodyStage(
		stage,
		identity,
		stage.trustedGateSha
	);
	const bytes = serializeStage(validated);
	return putPublicTemplateOgReleaseRecoveryBytesIfAbsent({
		client,
		key: publicDiscoveryBootstrapCustodyStageKey(identity, validated.stage),
		bytes,
		contentType: 'application/json',
		metadata: {
			schema: 'commons-public-discovery-bootstrap-custody-v1',
			stage: validated.stage,
			'transaction-id': identity.transactionId,
			'source-sha': validated.sourceSha,
			'trusted-gate-sha': validated.trustedGateSha
		},
		maximumBytes: MAX_JOURNAL_BYTES
	});
}

/** @param {{client:import('@aws-sdk/client-s3').S3Client,identity:ReturnType<typeof validatePublicDiscoveryBootstrapCustodyIdentity>,expectedTrustedGateSha:string}} input */
export async function loadPublicDiscoveryBootstrapCustody({
	client,
	identity,
	expectedTrustedGateSha
}) {
	const exact = validatePublicDiscoveryBootstrapCustodyIdentity(identity);
	invariant(
		SHA_PATTERN.test(expectedTrustedGateSha),
		'Bootstrap custody expected trusted gate SHA is invalid.'
	);
	const found = await Promise.all(
		PUBLIC_DISCOVERY_BOOTSTRAP_CUSTODY_STAGES.map(async (stage) => {
			const object = await getPublicTemplateOgReleaseRecoveryObject({
				client,
				key: publicDiscoveryBootstrapCustodyStageKey(exact, stage),
				maximumBytes: MAX_JOURNAL_BYTES
			});
			if (!object) return null;
			let decoded;
			try {
				decoded = JSON.parse(object.bytes.toString('utf8'));
			} catch {
				throw new Error(`Bootstrap custody ${stage} stage is not JSON.`);
			}
			const envelope = validatePublicDiscoveryBootstrapCustodyStage(
				decoded,
				exact,
				expectedTrustedGateSha
			);
			const digest = publicTemplateOgReleaseRecoveryDigest(object.bytes);
			invariant(
				object.metadata.schema === 'commons-public-discovery-bootstrap-custody-v1' &&
					object.metadata.stage === stage &&
					object.metadata['transaction-id'] === exact.transactionId &&
					object.metadata['source-sha'] === envelope.sourceSha &&
					object.metadata['trusted-gate-sha'] === expectedTrustedGateSha &&
					object.metadata.sha256 === digest,
				`Bootstrap custody ${stage} metadata is invalid.`
			);
			return { stage, envelope, digest };
		})
	);
	const stages = new Map(
		found.filter((entry) => entry !== null).map((entry) => [entry.stage, entry])
	);
	if (stages.size === 0) return { state: 'absent', latest: null };
	const intent = stages.get('intent');
	invariant(intent, 'Bootstrap custody has an orphan stage without intent.');
	invariant(
		intent.envelope.previousStage === null && intent.envelope.previousDigest === null,
		'Bootstrap custody intent is not the root.'
	);
	const deployed = stages.get('deployed');
	if (deployed) {
		invariant(
			deployed.envelope.previousStage === 'intent' &&
				deployed.envelope.previousDigest === intent.digest &&
				deployed.envelope.sourceSha === intent.envelope.sourceSha &&
				deployed.envelope.trustedGateSha === intent.envelope.trustedGateSha,
			'Bootstrap deployed custody is not hash-linked to intent.'
		);
	}
	const cleaned = stages.get('cleaned');
	if (cleaned) {
		const previous = cleaned.envelope.previousStage === 'deployed' ? deployed : intent;
		invariant(previous, 'Bootstrap cleaned custody has a missing predecessor.');
		invariant(
			cleaned.envelope.previousDigest === previous.digest &&
				cleaned.envelope.sourceSha === intent.envelope.sourceSha &&
				cleaned.envelope.trustedGateSha === intent.envelope.trustedGateSha &&
				cleaned.envelope.versionId === previous.envelope.versionId &&
				!(deployed && cleaned.envelope.previousStage === 'intent'),
			'Bootstrap cleaned custody is forked or not hash-linked.'
		);
	}
	return { state: 'present', latest: cleaned ?? deployed ?? intent };
}

/** @param {string} filePath @param {Buffer|string} value */
function writeExclusive(filePath, value) {
	const target = path.resolve(filePath);
	const descriptor = openSync(target, 'wx', 0o600);
	try {
		writeFileSync(descriptor, value);
		fsyncSync(descriptor);
	} finally {
		closeSync(descriptor);
	}
	const stat = lstatSync(target);
	invariant(stat.isFile() && !stat.isSymbolicLink(), 'Bootstrap custody output is not ordinary.');
}

/** @param {string} filePath */
export function readPublicDiscoveryBootstrapCustodyJournal(filePath) {
	const target = path.resolve(filePath);
	const stat = lstatSync(target);
	invariant(
		stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= MAX_JOURNAL_BYTES,
		'Bootstrap custody journal must be one bounded ordinary file.'
	);
	let value;
	try {
		value = JSON.parse(readFileSync(target, 'utf8'));
	} catch {
		throw new Error('Bootstrap custody journal is not JSON.');
	}
	const candidate = record(value);
	invariant(candidate !== null, 'Bootstrap custody journal must be an object.');
	const identity = validatePublicDiscoveryBootstrapCustodyIdentity(
		/** @type {{repository:unknown,repositoryId:unknown,runId:unknown,runAttempt:unknown,transactionId:unknown}} */ (
			candidate
		)
	);
	return validatePublicDiscoveryBootstrapCustodyStage(
		candidate,
		identity,
		candidate.trustedGateSha
	);
}

/** @param {string} pathname @param {string} apiToken @param {typeof fetch} fetchFn */
async function cloudflareApi(pathname, apiToken, fetchFn) {
	const response = await fetchFn(`https://api.cloudflare.com/client/v4${pathname}`, {
		headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' },
		redirect: 'error',
		signal: AbortSignal.timeout(30_000)
	});
	const body = await readBoundedResponseJson(response, `Cloudflare API ${pathname}`, 1024 * 1024);
	return { body, status: response.status };
}

/** @param {{accountId:string,apiToken:string,fetchFn:typeof fetch}} input */
export async function provePublicDiscoveryBootstrapWorkerAbsent({
	accountId,
	apiToken,
	fetchFn = fetch
}) {
	invariant(accountId === ACCOUNT_ID, 'Bootstrap custody account id is not exact.');
	const response = await cloudflareApi(
		`/accounts/${accountId}/workers/scripts/${PUBLIC_DISCOVERY_BOOTSTRAP_WORKER}/settings`,
		apiToken,
		fetchFn
	);
	invariant(
		response.status === 404 && response.body?.success === false,
		'Bootstrap Worker is not absent.'
	);
	return { state: 'absent', worker: PUBLIC_DISCOVERY_BOOTSTRAP_WORKER };
}

/** @param {string} command @param {string[]} args @param {{apiToken:string,accountId:string,spawnFn?:typeof spawnSync}} options */
function run(command, args, { apiToken, accountId, spawnFn = spawnSync }) {
	const environment = {
		...process.env,
		CLOUDFLARE_API_TOKEN: apiToken,
		CLOUDFLARE_ACCOUNT_ID: accountId,
		WRANGLER_SEND_METRICS: 'false'
	};
	for (const capability of [
		'INTERNAL_API_SECRET',
		'RELEASE_ORIGIN_PROOF_SECRET',
		'RELEASE_CONTROL_SECRET',
		'RELEASE_RECOVERY_R2_ACCESS_KEY_ID',
		'RELEASE_RECOVERY_R2_SECRET_ACCESS_KEY'
	]) {
		Reflect.deleteProperty(environment, capability);
	}
	const result = spawnFn(command, args, {
		encoding: 'utf8',
		env: environment,
		maxBuffer: 4 * 1024 * 1024,
		shell: false,
		timeout: 180_000,
		killSignal: 'SIGKILL'
	});
	invariant(
		result.status === 0,
		`${command} failed: ${String(result.stderr || result.stdout || result.error?.message || '').slice(0, 4000)}`
	);
	return String(result.stdout ?? '');
}

/** @param {string} value @param {string} label */
function parseJson(value, label) {
	try {
		return JSON.parse(value);
	} catch {
		throw new Error(`${label} was not JSON.`);
	}
}

/** @param {{wranglerPath:string,configPath:string,sourceSha:string,transactionId:string,accountId:string,zoneId:string,apiToken:string,fetchFn?:typeof fetch,spawnFn?:typeof spawnSync}} input */
export async function provePublicDiscoveryBootstrapWorkerDeployed({
	wranglerPath,
	configPath,
	sourceSha,
	transactionId,
	accountId,
	zoneId,
	apiToken,
	fetchFn = fetch,
	spawnFn = spawnSync
}) {
	validatePublicDiscoveryBootstrapSourceConfig(readFileSync(path.resolve(configPath), 'utf8'));
	const wrangler = path.resolve(wranglerPath);
	const deployment = parseJson(
		run(
			wrangler,
			['deployments', 'status', '--name', PUBLIC_DISCOVERY_BOOTSTRAP_WORKER, '--json'],
			{
				apiToken,
				accountId,
				spawnFn
			}
		),
		'Bootstrap deployment status'
	);
	const versionId = deployment?.versions?.[0]?.version_id;
	invariant(VERSION_PATTERN.test(versionId), 'Bootstrap active version id is invalid.');
	const version = parseJson(
		run(
			wrangler,
			['versions', 'view', versionId, '--name', PUBLIC_DISCOVERY_BOOTSTRAP_WORKER, '--json'],
			{ apiToken, accountId, spawnFn }
		),
		'Bootstrap active version'
	);
	return verifyPublicDiscoveryBootstrapDeployment({
		accountId,
		apiToken,
		zoneId,
		activeDeployment: deployment,
		activeVersion: version,
		expectedSourceSha: sourceSha,
		expectedTransactionId: transactionId,
		fetchFn
	});
}

/** @param {{accountId?:string,apiToken?:string,accessKeyId?:string,secretAccessKey?:string,s3Client?:import('@aws-sdk/client-s3').S3Client,fetchFn?:typeof fetch}} input */
async function custodyRuntime({
	accountId = process.env.CLOUDFLARE_ACCOUNT_ID,
	apiToken = process.env.CLOUDFLARE_API_TOKEN,
	accessKeyId = process.env.RELEASE_RECOVERY_R2_ACCESS_KEY_ID,
	secretAccessKey = process.env.RELEASE_RECOVERY_R2_SECRET_ACCESS_KEY,
	s3Client,
	fetchFn = fetch
}) {
	invariant(accountId === ACCOUNT_ID, 'Bootstrap custody account id is not exact.');
	invariant(typeof apiToken === 'string' && apiToken.length > 0, 'Cloudflare API token is absent.');
	const client =
		s3Client ??
		createPublicTemplateOgReleaseRecoveryS3Client({
			accountId,
			accessKeyId: /** @type {string} */ (accessKeyId),
			secretAccessKey: /** @type {string} */ (secretAccessKey)
		});
	await verifyPublicTemplateOgReleaseRecoveryBucket({ accountId, apiToken, fetchFn });
	return { accountId, apiToken, client, fetchFn };
}

/** @param {{repository:string,repositoryId:string,runId:string,runAttempt:string,transactionId:string,sourceSha:string,trustedGateSha:string,configPath:string,zoneId?:string,accountId?:string,apiToken?:string,accessKeyId?:string,secretAccessKey?:string,s3Client?:import('@aws-sdk/client-s3').S3Client,fetchFn?:typeof fetch}} input */
export async function sealPublicDiscoveryBootstrapCustody(input) {
	const identity = validatePublicDiscoveryBootstrapCustodyIdentity(input);
	invariant(SHA_PATTERN.test(input.sourceSha), 'Bootstrap custody source SHA is invalid.');
	invariant(
		SHA_PATTERN.test(input.trustedGateSha),
		'Bootstrap custody trusted gate SHA is invalid.'
	);
	invariant(/^[a-f0-9]{32}$/u.test(input.zoneId ?? ''), 'Bootstrap custody zone id is invalid.');
	validatePublicDiscoveryBootstrapSourceConfig(
		readFileSync(path.resolve(input.configPath), 'utf8')
	);
	const runtime = await custodyRuntime(input);
	const existing = await loadPublicDiscoveryBootstrapCustody({
		client: runtime.client,
		identity,
		expectedTrustedGateSha: input.trustedGateSha
	});
	if (existing.state === 'present') {
		const latest = existing.latest;
		invariant(latest !== null, 'Bootstrap custody present state has no latest stage.');
		invariant(
			latest.envelope.sourceSha === input.sourceSha && latest.envelope.stage === 'intent',
			'Bootstrap custody path is occupied by another source or a post-intent stage.'
		);
		return {
			state: 'custody-sealed',
			created: false,
			stage: latest.envelope.stage,
			digest: latest.digest,
			sourceSha: input.sourceSha,
			transactionId: identity.transactionId
		};
	}
	await provePublicDiscoveryBootstrapWorkerAbsent(runtime);
	await verifyPublicDiscoveryBootstrapRouteLive({
		apiToken: runtime.apiToken,
		zoneId: input.zoneId,
		expectedPresent: false,
		fetchFn: runtime.fetchFn
	});
	const stage = createPublicDiscoveryBootstrapCustodyStage({
		identity,
		sourceSha: input.sourceSha,
		trustedGateSha: input.trustedGateSha,
		stage: 'intent',
		previousStage: null,
		previousDigest: null,
		versionId: null
	});
	const persisted = await putPublicDiscoveryBootstrapCustodyStage({
		client: runtime.client,
		identity,
		stage
	});
	return {
		state: 'custody-sealed',
		created: persisted.created,
		stage: 'intent',
		digest: persisted.digest,
		sourceSha: input.sourceSha,
		transactionId: identity.transactionId
	};
}

/** @param {{repository:string,repositoryId:string,runId:string,runAttempt:string,transactionId:string,sourceSha:string,trustedGateSha:string,configPath:string,wranglerPath:string,zoneId?:string,accountId?:string,apiToken?:string,accessKeyId?:string,secretAccessKey?:string,s3Client?:import('@aws-sdk/client-s3').S3Client,fetchFn?:typeof fetch,spawnFn?:typeof spawnSync}} input */
export async function recordPublicDiscoveryBootstrapDeployed(input) {
	const identity = validatePublicDiscoveryBootstrapCustodyIdentity(input);
	invariant(/^[a-f0-9]{32}$/u.test(input.zoneId ?? ''), 'Bootstrap custody zone id is invalid.');
	const runtime = await custodyRuntime(input);
	const chain = await loadPublicDiscoveryBootstrapCustody({
		client: runtime.client,
		identity,
		expectedTrustedGateSha: input.trustedGateSha
	});
	invariant(chain.state === 'present', 'Bootstrap deployment has no pre-mutation custody.');
	const latest = chain.latest;
	invariant(latest !== null, 'Bootstrap deployment custody has no latest stage.');
	invariant(
		latest.envelope.sourceSha === input.sourceSha && latest.envelope.stage !== 'cleaned',
		'Bootstrap deployment crossed or followed terminal custody.'
	);
	const proof = await provePublicDiscoveryBootstrapWorkerDeployed({
		wranglerPath: input.wranglerPath,
		configPath: input.configPath,
		sourceSha: input.sourceSha,
		transactionId: identity.transactionId,
		accountId: runtime.accountId,
		zoneId: /** @type {string} */ (input.zoneId),
		apiToken: runtime.apiToken,
		fetchFn: runtime.fetchFn,
		spawnFn: input.spawnFn
	});
	if (latest.envelope.stage === 'deployed') {
		invariant(
			latest.envelope.versionId === proof.versionId,
			'Bootstrap deployed version changed after custody.'
		);
		return {
			state: 'deployment-recorded',
			created: false,
			stage: 'deployed',
			digest: latest.digest,
			versionId: proof.versionId,
			sourceSha: input.sourceSha,
			transactionId: identity.transactionId
		};
	}
	const stage = createPublicDiscoveryBootstrapCustodyStage({
		identity,
		sourceSha: input.sourceSha,
		trustedGateSha: input.trustedGateSha,
		stage: 'deployed',
		previousStage: 'intent',
		previousDigest: latest.digest,
		versionId: proof.versionId
	});
	const persisted = await putPublicDiscoveryBootstrapCustodyStage({
		client: runtime.client,
		identity,
		stage
	});
	return {
		state: 'deployment-recorded',
		created: persisted.created,
		stage: 'deployed',
		digest: persisted.digest,
		versionId: proof.versionId,
		sourceSha: input.sourceSha,
		transactionId: identity.transactionId
	};
}

/** @param {{repository:string,repositoryId:string,runId:string,runAttempt:string,transactionId:string,sourceSha:string,trustedGateSha:string,zoneId?:string,accountId?:string,apiToken?:string,accessKeyId?:string,secretAccessKey?:string,s3Client?:import('@aws-sdk/client-s3').S3Client,fetchFn?:typeof fetch}} input */
export async function recordPublicDiscoveryBootstrapCleaned(input) {
	const identity = validatePublicDiscoveryBootstrapCustodyIdentity(input);
	invariant(/^[a-f0-9]{32}$/u.test(input.zoneId ?? ''), 'Bootstrap custody zone id is invalid.');
	const runtime = await custodyRuntime(input);
	const chain = await loadPublicDiscoveryBootstrapCustody({
		client: runtime.client,
		identity,
		expectedTrustedGateSha: input.trustedGateSha
	});
	invariant(chain.state === 'present', 'Bootstrap cleanup has no immutable custody.');
	const latest = chain.latest;
	invariant(latest !== null, 'Bootstrap cleanup custody has no latest stage.');
	invariant(
		latest.envelope.sourceSha === input.sourceSha,
		'Bootstrap cleanup crossed source custody.'
	);
	await verifyPublicDiscoveryBootstrapRouteLive({
		apiToken: runtime.apiToken,
		zoneId: input.zoneId,
		expectedPresent: false,
		fetchFn: runtime.fetchFn
	});
	await provePublicDiscoveryBootstrapWorkerAbsent(runtime);
	if (latest.envelope.stage === 'cleaned') {
		return {
			state: 'cleanup-recorded',
			created: false,
			stage: 'cleaned',
			digest: latest.digest,
			sourceSha: input.sourceSha,
			transactionId: identity.transactionId
		};
	}
	const stage = createPublicDiscoveryBootstrapCustodyStage({
		identity,
		sourceSha: input.sourceSha,
		trustedGateSha: input.trustedGateSha,
		stage: 'cleaned',
		previousStage: latest.envelope.stage,
		previousDigest: latest.digest,
		versionId: latest.envelope.versionId
	});
	const persisted = await putPublicDiscoveryBootstrapCustodyStage({
		client: runtime.client,
		identity,
		stage
	});
	return {
		state: 'cleanup-recorded',
		created: persisted.created,
		stage: 'cleaned',
		digest: persisted.digest,
		sourceSha: input.sourceSha,
		transactionId: identity.transactionId
	};
}

/** @param {{repository:string,repositoryId:string,runId:string,runAttempt:string,transactionId:string,trustedGateSha:string,journalPath:string,accountId?:string,apiToken?:string,accessKeyId?:string,secretAccessKey?:string,s3Client?:import('@aws-sdk/client-s3').S3Client,fetchFn?:typeof fetch}} input */
export async function hydratePublicDiscoveryBootstrapCustody(input) {
	const identity = validatePublicDiscoveryBootstrapCustodyIdentity(input);
	const runtime = await custodyRuntime(input);
	const chain = await loadPublicDiscoveryBootstrapCustody({
		client: runtime.client,
		identity,
		expectedTrustedGateSha: input.trustedGateSha
	});
	if (chain.state === 'absent') {
		return { state: 'absent', transactionId: identity.transactionId };
	}
	const latest = chain.latest;
	invariant(latest !== null, 'Bootstrap hydration custody has no latest stage.');
	writeExclusive(input.journalPath, serializeStage(latest.envelope));
	return {
		state: 'present',
		stage: latest.envelope.stage,
		digest: latest.digest,
		sourceSha: latest.envelope.sourceSha,
		trustedGateSha: latest.envelope.trustedGateSha,
		transactionId: identity.transactionId,
		versionId: latest.envelope.versionId,
		journalPath: path.resolve(input.journalPath)
	};
}

/** @param {string[]} argv */
export function parsePublicDiscoveryBootstrapCustodyArgs(argv) {
	const command = argv[0];
	const common = [
		'--repository',
		'--repository-id',
		'--run-id',
		'--run-attempt',
		'--transaction-id',
		'--trusted-gate-sha'
	];
	const commandFlags = /** @type {Record<string, string[]>} */ ({
		seal: [...common, '--source-sha', '--config'],
		'record-deployed': [...common, '--source-sha', '--config', '--wrangler'],
		'record-cleaned': [...common, '--source-sha'],
		hydrate: [...common, '--journal']
	});
	const flags = commandFlags[command];
	invariant(Array.isArray(flags), 'Bootstrap custody command is invalid.');
	const allowed = new Set(flags);
	const values = new Map();
	for (let index = 1; index < argv.length; index += 2) {
		const flag = argv[index];
		const value = argv[index + 1];
		invariant(
			allowed.has(flag) && value && !value.startsWith('--') && !values.has(flag),
			`Invalid bootstrap custody argument: ${flag}.`
		);
		values.set(flag, value);
	}
	invariant(
		values.size === flags.length && flags.every((flag) => values.has(flag)),
		'Every bootstrap custody command argument is required exactly once.'
	);
	return {
		command,
		repository: values.get('--repository'),
		repositoryId: values.get('--repository-id'),
		runId: values.get('--run-id'),
		runAttempt: values.get('--run-attempt'),
		transactionId: values.get('--transaction-id'),
		trustedGateSha: values.get('--trusted-gate-sha'),
		sourceSha: values.get('--source-sha'),
		configPath: values.get('--config'),
		wranglerPath: values.get('--wrangler'),
		journalPath: values.get('--journal')
	};
}

const isMain =
	process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
	try {
		const args = parsePublicDiscoveryBootstrapCustodyArgs(process.argv.slice(2));
		const shared = {
			repository: args.repository,
			repositoryId: args.repositoryId,
			runId: args.runId,
			runAttempt: args.runAttempt,
			transactionId: args.transactionId,
			trustedGateSha: args.trustedGateSha
		};
		const result =
			args.command === 'seal'
				? await sealPublicDiscoveryBootstrapCustody({
						...shared,
						sourceSha: args.sourceSha,
						configPath: args.configPath,
						zoneId: process.env.CLOUDFLARE_ZONE_ID
					})
				: args.command === 'record-deployed'
					? await recordPublicDiscoveryBootstrapDeployed({
							...shared,
							sourceSha: args.sourceSha,
							configPath: args.configPath,
							wranglerPath: args.wranglerPath,
							zoneId: process.env.CLOUDFLARE_ZONE_ID
						})
					: args.command === 'record-cleaned'
						? await recordPublicDiscoveryBootstrapCleaned({
								...shared,
								sourceSha: args.sourceSha,
								zoneId: process.env.CLOUDFLARE_ZONE_ID
							})
						: await hydratePublicDiscoveryBootstrapCustody({
								...shared,
								journalPath: args.journalPath
							});
		console.log(JSON.stringify(result));
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
