#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
	CONVEX_TEAM_QUOTA_SIGNATURE_NAMESPACE,
	canonicalConvexTeamUsageAttestationBytes,
	verifyConvexTeamUsageAttestationSignature
} from './convex-team-usage-attestation.mjs';

/** @param {unknown} condition @param {string} message @returns {asserts condition} */
function invariant(condition, message) {
	if (!condition) throw new Error(message);
}

/**
 * @param {{allowedSignersPath: string, attestationPath: string, signaturePath: string, signingKey: string}} input
 */
export function signConvexTeamUsageAttestation({
	allowedSignersPath,
	attestationPath,
	signaturePath,
	signingKey
}) {
	invariant(
		typeof signingKey === 'string' && signingKey.length > 0,
		'Quota signing key path is required.'
	);
	const attestationBytes = fs.readFileSync(path.resolve(attestationPath));
	invariant(
		attestationBytes.length > 0 && attestationBytes.length <= 128 * 1024,
		'Quota attestation size is invalid.'
	);
	const attestation = JSON.parse(attestationBytes.toString('utf8'));
	invariant(
		attestationBytes.equals(canonicalConvexTeamUsageAttestationBytes(attestation)),
		'Quota attestation is not in canonical signed form.'
	);
	const publicKey = execFileSync('ssh-keygen', ['-y', '-f', signingKey], {
		encoding: 'utf8',
		maxBuffer: 1024 * 1024
	}).trim();
	invariant(
		publicKey.startsWith('ssh-ed25519 '),
		'Quota receipts require a dedicated Ed25519 key.'
	);
	const signature = execFileSync(
		'ssh-keygen',
		['-Y', 'sign', '-f', signingKey, '-n', CONVEX_TEAM_QUOTA_SIGNATURE_NAMESPACE, '-'],
		{ input: attestationBytes, maxBuffer: 1024 * 1024 }
	);
	const verified = verifyConvexTeamUsageAttestationSignature({
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

function parseArgs(argv) {
	const values = new Map();
	for (let index = 0; index < argv.length; index += 2) {
		invariant(
			argv[index]?.startsWith('--') && argv[index + 1],
			'Signing arguments must be --key value pairs.'
		);
		invariant(!values.has(argv[index]), `Duplicate signing argument: ${argv[index]}.`);
		values.set(argv[index], argv[index + 1]);
	}
	for (const required of ['--attestation', '--signature', '--signing-key', '--allowed-signers']) {
		invariant(values.has(required), `Missing signing argument ${required}.`);
	}
	invariant(values.size === 4, 'Unknown signing argument.');
	return Object.fromEntries([...values].map(([key, value]) => [key.slice(2), value]));
}

const isMain =
	process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
	try {
		const args = parseArgs(process.argv.slice(2));
		const verified = signConvexTeamUsageAttestation({
			allowedSignersPath: args['allowed-signers'],
			attestationPath: args.attestation,
			signaturePath: args.signature,
			signingKey: args['signing-key']
		});
		console.log(
			`Signed Convex team quota receipt: principal=${verified.principal}; key=${verified.keyFingerprint}`
		);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
