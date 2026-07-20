#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
	CLOUDFLARE_QUEUE_FREE_ENVELOPE_BOOTSTRAP_ADMISSION_VALIDITY_SECONDS,
	CLOUDFLARE_QUEUE_FREE_ENVELOPE_MAX_BYTES,
	CLOUDFLARE_QUEUE_FREE_ENVELOPE_RELEASE_PHASES,
	canonicalCloudflareQueueFreeEnvelopeBytes,
	validateCloudflareQueueFreeEnvelope,
	verifyCloudflareQueueFreeEnvelopeSignature
} from './cloudflare-queue-free-envelope.mjs';

export const DEFAULT_CLOUDFLARE_QUEUE_FREE_ENVELOPE_ALLOWED_SIGNERS_PATH =
	'.github/cloudflare-queue-allowed-signers';
const PRINCIPAL_PATTERN = /^[A-Za-z0-9._@+-]{1,120}$/u;
const RELEASE_TRANSACTION_PATTERN = /^[1-9][0-9]{0,19}-[1-9][0-9]{0,9}$/u;
const SHA_PATTERN = /^[a-f0-9]{40}$/u;

/** @param {unknown} condition @param {string} message @returns {asserts condition} */
function invariant(condition, message) {
	if (!condition) throw new Error(message);
}

/**
 * @param {{allowedSignersPath?:string,attestationBytes:Buffer,expectedOperatorPrincipal?:string,expectedReleasePhase:'activate-preview'|'activate-production'|'bootstrap-production',expectedReleaseTransactionId?:string,expectedSourceSha:string,minimumRemainingValiditySeconds?:number,nowMs?:number,signatureBytes:Buffer}} input
 */
export function verifySignedCloudflareQueueFreeEnvelope({
	allowedSignersPath = DEFAULT_CLOUDFLARE_QUEUE_FREE_ENVELOPE_ALLOWED_SIGNERS_PATH,
	attestationBytes,
	expectedOperatorPrincipal,
	expectedReleasePhase,
	expectedReleaseTransactionId,
	expectedSourceSha,
	minimumRemainingValiditySeconds = 0,
	nowMs = Date.now(),
	signatureBytes
}) {
	invariant(
		Buffer.isBuffer(attestationBytes) &&
			attestationBytes.length > 0 &&
			attestationBytes.length <= CLOUDFLARE_QUEUE_FREE_ENVELOPE_MAX_BYTES,
		'Signed Queue Free envelope bytes are invalid.'
	);
	let attestation;
	try {
		attestation = JSON.parse(attestationBytes.toString('utf8'));
	} catch {
		throw new Error('Signed Queue Free envelope is not valid JSON.');
	}
	invariant(
		attestationBytes.equals(canonicalCloudflareQueueFreeEnvelopeBytes(attestation)),
		'Signed Queue Free envelope is not in canonical form.'
	);
	const signature = verifyCloudflareQueueFreeEnvelopeSignature({
		allowedSignersPath,
		attestation,
		signature: signatureBytes
	});
	const envelope = validateCloudflareQueueFreeEnvelope({
		attestation,
		expectedOperatorPrincipal,
		expectedReleasePhase,
		expectedReleaseTransactionId,
		expectedSourceSha,
		minimumRemainingValiditySeconds,
		nowMs
	});
	return { ...envelope, signature };
}

/** @param {string[]} argv */
export function parseCloudflareQueueFreeEnvelopeArgs(argv) {
	const baseRequired = [
		'--attestation',
		'--signature',
		'--allowed-signers',
		'--release-phase',
		'--source-sha',
		'--min-validity-seconds'
	];
	const allowed = new Set([...baseRequired, '--operator-principal', '--transaction-id']);
	const values = new Map();
	for (let index = 0; index < argv.length; index += 2) {
		invariant(
			allowed.has(argv[index]) && argv[index + 1] && !argv[index + 1].startsWith('--'),
			'Queue Free envelope verifier arguments must be --key value pairs.'
		);
		invariant(
			!values.has(argv[index]),
			`Duplicate Queue Free envelope verifier argument: ${argv[index]}.`
		);
		values.set(argv[index], argv[index + 1]);
	}
	for (const required of baseRequired) {
		invariant(values.has(required), `Missing Queue Free envelope argument ${required}.`);
	}
	const releasePhase = values.get('--release-phase');
	invariant(
		CLOUDFLARE_QUEUE_FREE_ENVELOPE_RELEASE_PHASES.includes(releasePhase),
		'Invalid Queue Free envelope release phase.'
	);
	if (releasePhase === 'bootstrap-production') {
		invariant(
			values.size === baseRequired.length + 2 &&
				values.has('--operator-principal') &&
				values.has('--transaction-id'),
			'Queue Free bootstrap verifier requires exact operator and transaction arguments.'
		);
		invariant(
			PRINCIPAL_PATTERN.test(values.get('--operator-principal')),
			'Queue Free bootstrap verifier operator principal is invalid.'
		);
		invariant(
			RELEASE_TRANSACTION_PATTERN.test(values.get('--transaction-id')),
			'Queue Free bootstrap verifier transaction id is invalid.'
		);
	} else {
		invariant(
			values.size === baseRequired.length &&
				!values.has('--operator-principal') &&
				!values.has('--transaction-id'),
			'Queue Free activation verifier cannot carry bootstrap binding arguments.'
		);
	}
	invariant(
		SHA_PATTERN.test(values.get('--source-sha')),
		'Queue Free verifier source SHA is invalid.'
	);
	const minimumValiditySeconds = Number(values.get('--min-validity-seconds'));
	invariant(
		Number.isSafeInteger(minimumValiditySeconds) && minimumValiditySeconds >= 0,
		'Invalid Queue Free envelope minimum validity.'
	);
	if (releasePhase === 'bootstrap-production') {
		invariant(
			minimumValiditySeconds ===
				CLOUDFLARE_QUEUE_FREE_ENVELOPE_BOOTSTRAP_ADMISSION_VALIDITY_SECONDS,
			'Queue Free bootstrap admission must retain the exact final-proof validity window.'
		);
	}
	return {
		allowedSignersPath: values.get('--allowed-signers'),
		attestationPath: values.get('--attestation'),
		...(releasePhase === 'bootstrap-production'
			? {
					expectedOperatorPrincipal: values.get('--operator-principal'),
					expectedReleaseTransactionId: values.get('--transaction-id')
				}
			: {}),
		expectedReleasePhase: releasePhase,
		expectedSourceSha: values.get('--source-sha'),
		minimumValiditySeconds,
		signaturePath: values.get('--signature')
	};
}

const isMain =
	process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
	try {
		const args = parseCloudflareQueueFreeEnvelopeArgs(process.argv.slice(2));
		console.log(
			JSON.stringify(
				verifySignedCloudflareQueueFreeEnvelope({
					allowedSignersPath: args.allowedSignersPath,
					attestationBytes: fs.readFileSync(args.attestationPath),
					expectedOperatorPrincipal: args.expectedOperatorPrincipal,
					expectedReleasePhase: args.expectedReleasePhase,
					expectedReleaseTransactionId: args.expectedReleaseTransactionId,
					expectedSourceSha: args.expectedSourceSha,
					minimumRemainingValiditySeconds: args.minimumValiditySeconds,
					signatureBytes: fs.readFileSync(args.signaturePath)
				})
			)
		);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
