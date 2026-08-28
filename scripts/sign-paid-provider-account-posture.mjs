#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
	PAID_PROVIDER_POSTURE_SIGNATURE_NAMESPACE,
	canonicalProviderAccountPostureBytes,
	validatePaidProviderAccountAuthority,
	validateProviderAccountPostureReceipt,
	verifyProviderAccountPostureSignature
} from './paid-provider-account-posture.mjs';
import { readProviderPostureBindingsFromEnvironment } from './verify-paid-provider-account-posture.mjs';

/** @param {unknown} condition @param {string} message @returns {asserts condition} */
function invariant(condition, message) {
	if (!condition) throw new Error(`PAID_PROVIDER_POSTURE_SIGN_INVALID:${message}`);
}

/**
 * @param {{allowedSignersPath:string,authorityPath:string,expectedSourceSha:string,receiptPath:string,signaturePath:string,signingKey:string,bindings?:Record<string,{accountId:string,credential:string}>,nowMs?:number}} input
 */
export function signProviderAccountPosture({
	allowedSignersPath,
	authorityPath,
	bindings = readProviderPostureBindingsFromEnvironment(process.env),
	expectedSourceSha,
	nowMs = Date.now(),
	receiptPath,
	signaturePath,
	signingKey
}) {
	invariant(typeof signingKey === 'string' && signingKey.length > 0, 'signing_key');
	const authority = validatePaidProviderAccountAuthority(
		JSON.parse(fs.readFileSync(path.resolve(authorityPath), 'utf8'))
	);
	const receiptBytes = fs.readFileSync(path.resolve(receiptPath));
	invariant(
		receiptBytes.length > 0 && receiptBytes.length <= authority.maximumReceiptBytes,
		'receipt_size'
	);
	const receipt = JSON.parse(receiptBytes.toString('utf8'));
	invariant(
		receiptBytes.equals(canonicalProviderAccountPostureBytes(receipt)),
		'receipt_canonical_bytes'
	);
	validateProviderAccountPostureReceipt({
		authority,
		bindings,
		expectedSourceSha,
		nowMs,
		receipt
	});
	const publicKey = execFileSync('ssh-keygen', ['-y', '-f', signingKey], {
		encoding: 'utf8',
		maxBuffer: 1024 * 1024
	}).trim();
	invariant(publicKey.startsWith('ssh-ed25519 '), 'ed25519_key_required');
	const signature = execFileSync(
		'ssh-keygen',
		['-Y', 'sign', '-f', signingKey, '-n', PAID_PROVIDER_POSTURE_SIGNATURE_NAMESPACE, '-'],
		{ input: receiptBytes, maxBuffer: 1024 * 1024 }
	);
	const verified = verifyProviderAccountPostureSignature({
		allowedSignersPath,
		authority,
		receipt,
		signature
	});
	const output = path.resolve(signaturePath);
	const temporary = `${output}.tmp`;
	fs.writeFileSync(temporary, signature, { mode: 0o600 });
	fs.renameSync(temporary, output);
	return verified;
}

/** @param {string[]} argv */
function parseArgs(argv) {
	const required = [
		'--authority',
		'--receipt',
		'--signature',
		'--signing-key',
		'--allowed-signers',
		'--source-sha'
	];
	const values = new Map();
	for (let index = 0; index < argv.length; index += 2) {
		invariant(
			required.includes(argv[index]) && argv[index + 1] && !argv[index + 1].startsWith('--'),
			'cli_key_value_pairs'
		);
		invariant(!values.has(argv[index]), `cli_duplicate_${argv[index]}`);
		values.set(argv[index], argv[index + 1]);
	}
	for (const argument of required) invariant(values.has(argument), `cli_missing_${argument}`);
	invariant(values.size === required.length, 'cli_unknown_argument');
	return Object.fromEntries([...values].map(([key, value]) => [key.slice(2), value]));
}

const isMain =
	process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
	try {
		const args = parseArgs(process.argv.slice(2));
		const result = signProviderAccountPosture({
			allowedSignersPath: args['allowed-signers'],
			authorityPath: args.authority,
			expectedSourceSha: args['source-sha'],
			receiptPath: args.receipt,
			signaturePath: args.signature,
			signingKey: args['signing-key']
		});
		console.log(
			`Signed paid-provider posture receipt: principal=${result.principal}; key=${result.keyFingerprint}`
		);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
