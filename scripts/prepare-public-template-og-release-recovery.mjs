#!/usr/bin/env node

import { closeSync, fsyncSync, lstatSync, openSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
	createPublicTemplateOgReleaseRecoveryS3Client,
	getPublicTemplateOgReleaseRecoveryObject,
	loadPublicTemplateOgReleaseRecoveryStageChain,
	publicTemplateOgReleaseRecoveryDigest,
	publicTemplateOgReleaseRecoveryKitKey,
	validatePublicTemplateOgReleaseRecoveryIdentity,
	verifyPublicTemplateOgReleaseRecoveryBucket
} from './public-template-og-release-recovery-store.mjs';

const ACCOUNT_ID = '019d1184e655db74b7589794a2a2a533';
const MAX_RELEASE_KIT_BYTES = 512 * 1024 * 1024;

/** @param {unknown} condition @param {string} message @returns {asserts condition} */
function invariant(condition, message) {
	if (!condition) throw new Error(message);
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
	invariant(stat.isFile() && !stat.isSymbolicLink(), 'Recovery output is not an ordinary file.');
}

/**
 * @param {{repository:string,repositoryId:string,runId:string,runAttempt:string,transactionId:string,realm:'preview'|'production',trustedGateSha:string,journalPath:string,releaseKitPath:string,accountId?:string,apiToken?:string,accessKeyId?:string,secretAccessKey?:string,s3Client?:import('@aws-sdk/client-s3').S3Client,fetchFn?:typeof fetch}} input
 */
export async function preparePublicTemplateOgReleaseRecovery({
	repository,
	repositoryId,
	runId,
	runAttempt,
	transactionId,
	realm,
	trustedGateSha,
	journalPath,
	releaseKitPath,
	accountId = process.env.CLOUDFLARE_ACCOUNT_ID,
	apiToken = process.env.CLOUDFLARE_API_TOKEN,
	accessKeyId = process.env.RELEASE_RECOVERY_R2_ACCESS_KEY_ID,
	secretAccessKey = process.env.RELEASE_RECOVERY_R2_SECRET_ACCESS_KEY,
	s3Client,
	fetchFn = fetch
}) {
	invariant(accountId === ACCOUNT_ID, 'Recovery account id is not exact.');
	invariant(/^[a-f0-9]{40}$/u.test(trustedGateSha), 'Recovery trusted gate SHA is invalid.');
	const identity = validatePublicTemplateOgReleaseRecoveryIdentity({
		repository,
		repositoryId,
		runId,
		runAttempt,
		transactionId,
		realm
	});
	const client =
		s3Client ??
		createPublicTemplateOgReleaseRecoveryS3Client({
			accountId,
			accessKeyId,
			secretAccessKey
		});
	await verifyPublicTemplateOgReleaseRecoveryBucket({ accountId, apiToken, fetchFn });
	const [chain, kit] = await Promise.all([
		loadPublicTemplateOgReleaseRecoveryStageChain({ client, identity }),
		getPublicTemplateOgReleaseRecoveryObject({
			client,
			key: publicTemplateOgReleaseRecoveryKitKey(identity),
			maximumBytes: MAX_RELEASE_KIT_BYTES
		})
	]);
	if (chain.state === 'absent') {
		if (kit) {
			invariant(
				kit.metadata.schema === 'commons-release-kit-v1' &&
					kit.metadata['transaction-id'] === transactionId &&
					kit.metadata['trusted-gate-sha'] === trustedGateSha &&
					kit.metadata.sha256 === publicTemplateOgReleaseRecoveryDigest(kit.bytes),
				'Recovery kit without baseline has invalid custody metadata.'
			);
		}
		return {
			state: 'absent',
			realm,
			transactionId,
			reason: kit ? 'kit-before-baseline' : 'no-custody-record'
		};
	}
	invariant(chain.latest && kit, 'Recovery stage exists without its immutable release kit.');
	const envelope = chain.latest.envelope;
	const releaseKitDigest = publicTemplateOgReleaseRecoveryDigest(kit.bytes);
	invariant(
		kit.metadata.schema === 'commons-release-kit-v1' &&
			kit.metadata.sha256 === releaseKitDigest &&
			kit.metadata.realm === realm &&
			kit.metadata['transaction-id'] === transactionId &&
			kit.metadata['repository-id'] === repositoryId &&
			kit.metadata['run-id'] === runId &&
			kit.metadata['run-attempt'] === runAttempt &&
			kit.metadata['trusted-gate-sha'] === trustedGateSha &&
			kit.metadata['source-sha'] === envelope.journal.sourceSha &&
			kit.metadata['artifact-digest'] === envelope.journal.artifactDigest &&
			releaseKitDigest === envelope.releaseKitDigest &&
			envelope.journal.trustedGateSha === trustedGateSha,
		'Recovery release kit crossed its immutable stage identity.'
	);
	const journal = {
		...envelope.journal,
		lastStage: envelope.stage,
		lastStageDigest: chain.latest.digest
	};
	writeExclusive(journalPath, `${JSON.stringify(journal)}\n`);
	writeExclusive(releaseKitPath, kit.bytes);
	return {
		state: 'present',
		realm,
		repository,
		repositoryId,
		runId,
		runAttempt,
		transactionId,
		sourceSha: journal.sourceSha,
		trustedGateSha,
		artifactDigest: journal.artifactDigest,
		releaseKitDigest,
		lastStage: journal.lastStage,
		lastStageDigest: journal.lastStageDigest,
		journalPath: path.resolve(journalPath),
		releaseKitPath: path.resolve(releaseKitPath)
	};
}

/** @param {string[]} argv */
function parseArgs(argv) {
	const flags = [
		'--repository',
		'--repository-id',
		'--run-id',
		'--run-attempt',
		'--transaction-id',
		'--realm',
		'--trusted-gate-sha',
		'--journal',
		'--release-kit'
	];
	const allowed = new Set(flags);
	const values = new Map();
	for (let index = 0; index < argv.length; index += 2) {
		const flag = argv[index];
		const value = argv[index + 1];
		invariant(
			allowed.has(flag) && value && !value.startsWith('--') && !values.has(flag),
			`Invalid recovery preparation argument: ${flag}.`
		);
		values.set(flag, value);
	}
	invariant(values.size === flags.length, 'Every recovery preparation argument is required.');
	invariant(
		values.get('--realm') === 'preview' || values.get('--realm') === 'production',
		'Recovery preparation realm is invalid.'
	);
	return Object.fromEntries(flags.map((flag) => [flag.slice(2), values.get(flag)]));
}

const isMain =
	process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
	try {
		const args = parseArgs(process.argv.slice(2));
		console.log(
			JSON.stringify(
				await preparePublicTemplateOgReleaseRecovery({
					repository: args.repository,
					repositoryId: args['repository-id'],
					runId: args['run-id'],
					runAttempt: args['run-attempt'],
					transactionId: args['transaction-id'],
					realm: args.realm,
					trustedGateSha: args['trusted-gate-sha'],
					journalPath: args.journal,
					releaseKitPath: args['release-kit']
				})
			)
		);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
