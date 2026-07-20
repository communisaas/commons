#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
	CLOUDFLARE_QUEUE_FREE_ENVELOPE_MAX_BYTES,
	CLOUDFLARE_QUEUE_FREE_ENVELOPE_SIGNATURE_NAMESPACE,
	canonicalCloudflareQueueFreeEnvelopeBytes,
	validateCloudflareQueueFreeEnvelope,
	verifyCloudflareQueueFreeEnvelopeSignature
} from './cloudflare-queue-free-envelope.mjs';

/** @param {unknown} condition @param {string} message @returns {asserts condition} */
function invariant(condition, message) {
	if (!condition) throw new Error(message);
}

/**
 * The private key remains operator-local. This helper writes only a detached
 * signature after the canonical receipt and enrolled Ed25519 identity validate.
 * @param {{allowedSignersPath:string,attestationPath:string,nowMs?:number,signaturePath:string,signingKey:string}} input
 */
export function signCloudflareQueueFreeEnvelope({
	allowedSignersPath,
	attestationPath,
	nowMs = Date.now(),
	signaturePath,
	signingKey
}) {
	invariant(
		typeof signingKey === 'string' && signingKey.length > 0,
		'Queue Free envelope signing key path is required.'
	);
	const attestationBytes = fs.readFileSync(path.resolve(attestationPath));
	invariant(
		attestationBytes.length > 0 &&
			attestationBytes.length <= CLOUDFLARE_QUEUE_FREE_ENVELOPE_MAX_BYTES,
		'Queue Free envelope attestation size is invalid.'
	);
	let attestation;
	try {
		attestation = JSON.parse(attestationBytes.toString('utf8'));
	} catch {
		throw new Error('Queue Free envelope attestation is not valid JSON.');
	}
	invariant(
		attestationBytes.equals(canonicalCloudflareQueueFreeEnvelopeBytes(attestation)),
		'Queue Free envelope attestation is not in canonical signed form.'
	);
	validateCloudflareQueueFreeEnvelope({
		attestation,
		...(attestation.releasePhase === 'bootstrap-production'
			? {
					expectedOperatorPrincipal: attestation.operatorPrincipal,
					expectedReleaseTransactionId: attestation.releaseTransactionId
				}
			: {}),
		expectedReleasePhase: attestation.releasePhase,
		expectedSourceSha: attestation.sourceSha,
		nowMs
	});
	const publicKey = execFileSync('ssh-keygen', ['-y', '-f', signingKey], {
		encoding: 'utf8',
		maxBuffer: 1024 * 1024
	}).trim();
	invariant(
		publicKey.startsWith('ssh-ed25519 '),
		'Queue Free envelopes require a dedicated Ed25519 key.'
	);
	const signature = execFileSync(
		'ssh-keygen',
		['-Y', 'sign', '-f', signingKey, '-n', CLOUDFLARE_QUEUE_FREE_ENVELOPE_SIGNATURE_NAMESPACE, '-'],
		{ input: attestationBytes, maxBuffer: 1024 * 1024 }
	);
	const verified = verifyCloudflareQueueFreeEnvelopeSignature({
		allowedSignersPath,
		attestation,
		signature
	});
	const output = path.resolve(signaturePath);
	const temporary = `${output}.tmp`;
	fs.writeFileSync(temporary, signature, { mode: 0o600 });
	fs.renameSync(temporary, output);
	return verified;
}

/** @param {string[]} argv */
export function parseCloudflareQueueFreeEnvelopeSigningArgs(argv) {
	const values = new Map();
	for (let index = 0; index < argv.length; index += 2) {
		invariant(
			argv[index]?.startsWith('--') && argv[index + 1],
			'Queue Free envelope signing arguments must be --key value pairs.'
		);
		invariant(
			!values.has(argv[index]),
			`Duplicate Queue Free envelope signing argument: ${argv[index]}.`
		);
		values.set(argv[index], argv[index + 1]);
	}
	for (const required of ['--attestation', '--signature', '--signing-key', '--allowed-signers']) {
		invariant(values.has(required), `Missing Queue Free envelope signing argument ${required}.`);
	}
	invariant(values.size === 4, 'Unknown Queue Free envelope signing argument.');
	return {
		allowedSignersPath: values.get('--allowed-signers'),
		attestationPath: values.get('--attestation'),
		signaturePath: values.get('--signature'),
		signingKey: values.get('--signing-key')
	};
}

const isMain =
	process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
	try {
		const args = parseCloudflareQueueFreeEnvelopeSigningArgs(process.argv.slice(2));
		const verified = signCloudflareQueueFreeEnvelope(args);
		console.log(
			`Signed Cloudflare Queue Free envelope: principal=${verified.principal}; key=${verified.keyFingerprint}`
		);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
