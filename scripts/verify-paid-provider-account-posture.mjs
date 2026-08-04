#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
	canonicalProviderAccountPostureBytes,
	validatePaidProviderAccountAuthority,
	validateProviderAccountPostureReceipt,
	verifyProviderAccountPostureSignature
} from './paid-provider-account-posture.mjs';

export const DEFAULT_PAID_PROVIDER_ACCOUNT_AUTHORITY_PATH =
	'config/paid-provider-account-authority.json';
export const DEFAULT_PAID_PROVIDER_POSTURE_ALLOWED_SIGNERS_PATH =
	'.github/paid-provider-posture-allowed-signers';

/** @param {unknown} condition @param {string} message @returns {asserts condition} */
function invariant(condition, message) {
	if (!condition) throw new Error(`PAID_PROVIDER_POSTURE_INVALID:${message}`);
}

/** @param {NodeJS.ProcessEnv|Record<string,string|undefined>} environment */
export function readProviderPostureBindingsFromEnvironment(environment) {
	/** @type {Record<string,{accountId:string,credential:string}>} */
	const bindings = {};
	for (const provider of ['exa', 'firecrawl', 'gemini', 'groq']) {
		const prefix = `PROVIDER_POSTURE_${provider.toUpperCase()}`;
		const credential = environment[`${prefix}_CREDENTIAL`];
		const accountId = environment[`${prefix}_ACCOUNT_ID`];
		invariant(
			typeof credential === 'string' && credential.length > 0,
			`${provider}_credential_environment`
		);
		invariant(
			typeof accountId === 'string' && accountId.length > 0,
			`${provider}_account_environment`
		);
		bindings[provider] = { accountId, credential };
	}
	return bindings;
}

/**
 * @param {{allowedSignersPath?:string,authority:unknown,bindings:Record<string,{accountId:string,credential:string}>,expectedOperatorGithubUserId?:number,expectedSourceAuthorGithubUserId?:number,expectedSourceSha:string,minimumRemainingValiditySeconds?:number,nowMs?:number,receiptBytes:Buffer,signatureBytes:Buffer}} input
 */
export function verifySignedProviderAccountPosture({
	allowedSignersPath = DEFAULT_PAID_PROVIDER_POSTURE_ALLOWED_SIGNERS_PATH,
	authority: rawAuthority,
	bindings,
	expectedOperatorGithubUserId,
	expectedSourceAuthorGithubUserId,
	expectedSourceSha,
	minimumRemainingValiditySeconds,
	nowMs = Date.now(),
	receiptBytes,
	signatureBytes
}) {
	const authority = validatePaidProviderAccountAuthority(rawAuthority);
	invariant(
		Buffer.isBuffer(receiptBytes) &&
			receiptBytes.length > 0 &&
			receiptBytes.length <= authority.maximumReceiptBytes,
		'receipt_size'
	);
	invariant(
		Buffer.isBuffer(signatureBytes) &&
			signatureBytes.length > 0 &&
			signatureBytes.length <= authority.maximumSignatureBytes,
		'signature_size'
	);
	let receipt;
	try {
		receipt = JSON.parse(receiptBytes.toString('utf8'));
	} catch {
		throw new Error('PAID_PROVIDER_POSTURE_INVALID:receipt_json');
	}
	invariant(
		receiptBytes.equals(canonicalProviderAccountPostureBytes(receipt)),
		'receipt_canonical_bytes'
	);
	const posture = validateProviderAccountPostureReceipt({
		authority,
		bindings,
		expectedOperatorGithubUserId,
		expectedSourceAuthorGithubUserId,
		expectedSourceSha,
		minimumRemainingValiditySeconds,
		nowMs,
		receipt
	});
	const signature = verifyProviderAccountPostureSignature({
		allowedSignersPath,
		authority,
		receipt,
		signature: signatureBytes
	});
	invariant(signature.principal === posture.witnessPrincipal, 'signature_witness_binding');
	return { ...posture, signature };
}

/** @param {string[]} argv */
export function parsePaidProviderAccountPostureArgs(argv) {
	const required = [
		'--authority',
		'--receipt',
		'--signature',
		'--allowed-signers',
		'--source-sha',
		'--min-validity-seconds'
	];
	const allowed = new Set(required);
	const values = new Map();
	for (let index = 0; index < argv.length; index += 2) {
		invariant(
			allowed.has(argv[index]) && argv[index + 1] && !argv[index + 1].startsWith('--'),
			'cli_key_value_pairs'
		);
		invariant(!values.has(argv[index]), `cli_duplicate_${argv[index]}`);
		values.set(argv[index], argv[index + 1]);
	}
	for (const argument of required) invariant(values.has(argument), `cli_missing_${argument}`);
	invariant(values.size === required.length, 'cli_unknown_argument');
	invariant(/^[a-f0-9]{40}$/.test(values.get('--source-sha')), 'cli_source_sha');
	invariant(/^(?:0|[1-9]\d*)$/.test(values.get('--min-validity-seconds')), 'cli_minimum_validity');
	return {
		allowedSignersPath: values.get('--allowed-signers'),
		authorityPath: values.get('--authority'),
		minimumRemainingValiditySeconds: Number(values.get('--min-validity-seconds')),
		receiptPath: values.get('--receipt'),
		signaturePath: values.get('--signature'),
		sourceSha: values.get('--source-sha')
	};
}

/** @param {string} filePath @param {number} maximumBytes @param {string} label */
function readBoundedFile(filePath, maximumBytes, label) {
	const absolute = path.resolve(filePath);
	const stats = fs.statSync(absolute);
	invariant(stats.isFile() && stats.size > 0 && stats.size <= maximumBytes, `${label}_file`);
	return fs.readFileSync(absolute);
}

const isMain =
	process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
	try {
		const args = parsePaidProviderAccountPostureArgs(process.argv.slice(2));
		const authorityBytes = readBoundedFile(args.authorityPath, 64 * 1024, 'authority');
		const authority = JSON.parse(authorityBytes.toString('utf8'));
		const checkedAuthority = validatePaidProviderAccountAuthority(authority);
		const operatorGithubUserId = process.env.PROVIDER_POSTURE_OPERATOR_GITHUB_USER_ID;
		const sourceAuthorGithubUserId = process.env.PROVIDER_POSTURE_SOURCE_AUTHOR_GITHUB_USER_ID;
		invariant(
			typeof operatorGithubUserId === 'string' && /^[1-9]\d{0,19}$/.test(operatorGithubUserId),
			'operator_github_user_id_environment'
		);
		invariant(
			typeof sourceAuthorGithubUserId === 'string' &&
				/^[1-9]\d{0,15}$/u.test(sourceAuthorGithubUserId) &&
				Number.isSafeInteger(Number(sourceAuthorGithubUserId)),
			'source_author_github_user_id_environment'
		);
		const result = verifySignedProviderAccountPosture({
			allowedSignersPath: args.allowedSignersPath,
			authority: checkedAuthority,
			bindings: readProviderPostureBindingsFromEnvironment(process.env),
			expectedOperatorGithubUserId: Number(operatorGithubUserId),
			expectedSourceAuthorGithubUserId: Number(sourceAuthorGithubUserId),
			expectedSourceSha: args.sourceSha,
			minimumRemainingValiditySeconds: args.minimumRemainingValiditySeconds,
			receiptBytes: readBoundedFile(
				args.receiptPath,
				checkedAuthority.maximumReceiptBytes,
				'receipt'
			),
			signatureBytes: readBoundedFile(
				args.signaturePath,
				checkedAuthority.maximumSignatureBytes,
				'signature'
			)
		});
		console.log(
			`Verified zero-cost paid-provider posture for ${result.providerCount} providers at ${result.sourceSha}; expires=${result.expiresAt}; signer=${result.signature.keyFingerprint}`
		);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
