#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { verifyCloudflareQueueReleasePhaseState } from './verify-cloudflare-queue-release-phase.mjs';

const ENVIRONMENTS = Object.freeze({
	preview: Object.freeze({
		baseUrl: 'https://staging.commons.email',
		controlBaseUrl: 'https://release-control-staging.commons.email',
		phase: 'activate-preview'
	}),
	production: Object.freeze({
		baseUrl: 'https://commons.email',
		controlBaseUrl: 'https://release-control.commons.email',
		phase: 'activate-production'
	})
});
const MAX_RESPONSE_BYTES = 64 * 1024;

/** @param {unknown} condition @param {string} message @returns {asserts condition} */
function invariant(condition, message) {
	if (!condition) throw new Error(message);
}

/** @param {unknown} value @returns {Record<string, any> | null} */
function record(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

/** @param {Response} response @param {string} label */
async function boundedJson(response, label) {
	const declared = response.headers.get('content-length');
	if (declared !== null) {
		invariant(
			/^\d{1,10}$/u.test(declared) && Number(declared) <= MAX_RESPONSE_BYTES,
			`${label} response is oversized.`
		);
	}
	invariant(response.body, `${label} response body is absent.`);
	const reader = response.body.getReader();
	const chunks = [];
	let total = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > MAX_RESPONSE_BYTES) {
				await reader.cancel();
				throw new Error(`${label} response is oversized.`);
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	const text = new TextDecoder().decode(bytes);
	try {
		return JSON.parse(text);
	} catch {
		throw new Error(`${label} response was not JSON.`);
	}
}

/**
 * Records preview Q only after a separate trusted step verifies the receipt and
 * consumes the exact candidate-fetch proof. This process never receives the
 * candidate probe bearer.
 * @param {{sourceSha:string,transactionId:string,releaseControlSecret:string,releaseLeaseId:string,receiptVerificationDeadlineAt:string,authorizeQualifyFn:()=>Promise<unknown>,fetchFn?:typeof fetch,nowFn?:()=>number}} input
 */
export async function qualifyPreviewReleaseAuthority({
	sourceSha,
	transactionId,
	releaseControlSecret,
	releaseLeaseId,
	receiptVerificationDeadlineAt,
	authorizeQualifyFn,
	fetchFn = fetch,
	nowFn = Date.now
}) {
	invariant(/^[a-f0-9]{40}$/u.test(sourceSha), 'Preview qualification source is invalid.');
	invariant(
		/^[1-9][0-9]{0,19}-[1-9][0-9]{0,9}$/u.test(transactionId),
		'Preview qualification transaction is invalid.'
	);
	invariant(
		/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(releaseLeaseId),
		'Preview qualification lease is invalid.'
	);
	invariant(
		typeof releaseControlSecret === 'string' && releaseControlSecret.length >= 32,
		'Preview qualification control secret is required.'
	);
	const deadlineMs = Date.parse(receiptVerificationDeadlineAt);
	invariant(
		Number.isSafeInteger(deadlineMs) && deadlineMs - nowFn() >= 90_000,
		'Receipt verification window is insufficient for preview qualification.'
	);
	invariant(typeof authorizeQualifyFn === 'function', 'Trusted preview receipt proof is required.');
	await authorizeQualifyFn();
	invariant(
		deadlineMs - nowFn() >= 30_000,
		'Receipt verification window expired before preview qualification.'
	);
	const result = await mutateReleaseAuthority({
		action: 'qualify',
		target: ENVIRONMENTS.preview,
		sourceSha,
		transactionId,
		releaseLeaseId,
		receiptVerificationDeadlineAt,
		releaseControlSecret,
		fetchFn
	});
	return {
		environment: 'preview',
		releaseSha: sourceSha,
		transactionId,
		releaseAuthorityQualified: result.status === 'qualified',
		receiptVerificationDeadlineAt
	};
}

/**
 * @param {{action:'finalize'|'qualify',target:{controlBaseUrl:string,phase:string},sourceSha:string,transactionId:string,releaseLeaseId:string,receiptVerificationDeadlineAt:string,releaseControlSecret:string,fetchFn:typeof fetch}} input
 */
async function mutateReleaseAuthority({
	action,
	target,
	sourceSha,
	transactionId,
	releaseLeaseId,
	receiptVerificationDeadlineAt,
	releaseControlSecret,
	fetchFn
}) {
	const response = await fetchFn(`${target.controlBaseUrl}/control-og-release-authority`, {
		body: JSON.stringify({
			action,
			leaseId: releaseLeaseId,
			notAfter: receiptVerificationDeadlineAt,
			phase: target.phase,
			sourceSha,
			transactionId
		}),
		headers: {
			'content-type': 'application/json',
			'x-public-release-control-secret': releaseControlSecret
		},
		method: 'POST',
		redirect: 'error',
		signal: AbortSignal.timeout(20_000)
	});
	invariant(response.ok && response.status === 200, `Release authority ${action} failed.`);
	const result = await boundedJson(response, `Release authority ${action}`);
	invariant(
		result?.sourceSha === sourceSha &&
			result?.transactionId === transactionId &&
			result?.leaseId === releaseLeaseId &&
			result?.notAfter === receiptVerificationDeadlineAt &&
			result?.status === (action === 'qualify' ? 'qualified' : 'committed'),
		`Release authority ${action} response is invalid.`
	);
	return result;
}

/** @param {number} delayMs */
function defaultSleep(delayMs) {
	return new Promise((resolve) => setTimeout(resolve, delayMs));
}

/**
 * Exercises only the inert staging candidate boundary. Candidate S receives a
 * purpose-only probe capability and no Convex, cache, Queue, Durable Object, or
 * provider authority. Trusted producer/content readiness is proved separately.
 * @param {{environment:'preview',sourceSha:string,transactionId:string,releaseProbeSecret:string,fetchFn?:typeof fetch,sleepFn?:(delayMs:number)=>Promise<unknown>,probeAttempts?:number}} input
 */
export async function qualifyPublicDiscoveryGeneration({
	environment,
	sourceSha,
	transactionId,
	releaseProbeSecret,
	fetchFn = fetch,
	sleepFn = defaultSleep,
	probeAttempts = 12
}) {
	const target = ENVIRONMENTS[environment];
	invariant(target, 'Public-discovery qualification environment is invalid.');
	invariant(
		environment === 'preview',
		'Candidate runtime qualification is permitted only on the staging authority.'
	);
	invariant(/^[a-f0-9]{40}$/u.test(sourceSha), 'Qualification source must be one exact SHA.');
	invariant(
		/^[1-9][0-9]{0,19}-[1-9][0-9]{0,9}$/u.test(transactionId),
		'Qualification transaction is invalid.'
	);
	invariant(
		typeof releaseProbeSecret === 'string' && releaseProbeSecret.length >= 32,
		'Release candidate probe secret is required.'
	);
	invariant(
		Number.isSafeInteger(probeAttempts) && probeAttempts >= 1 && probeAttempts <= 12,
		'Release candidate probe attempt bound is invalid.'
	);

	let candidateFetchProved = false;
	for (let attempt = 1; attempt <= probeAttempts; attempt += 1) {
		try {
			const response = await fetchFn(`${target.baseUrl}/api/release-candidate`, {
				headers: {
					'x-expected-release-sha': sourceSha,
					'x-expected-release-transaction': transactionId,
					'x-release-probe-secret': releaseProbeSecret
				},
				redirect: 'error',
				signal: AbortSignal.timeout(20_000)
			});
			const body = await boundedJson(response, 'Release candidate probe');
			if (
				response.status === 200 &&
				response.ok &&
				response.headers.get('cache-control')?.toLowerCase().includes('no-store') &&
				Object.keys(record(body) ?? {})
					.sort()
					.join('\0') === 'proof\0release\0status' &&
				Object.keys(record(body?.release) ?? {})
					.sort()
					.join('\0') === 'sha\0transactionId' &&
				body?.status === 'ok' &&
				body?.proof === 'candidate-fetch-completed' &&
				body?.release?.sha === sourceSha &&
				body?.release?.transactionId === transactionId
			) {
				candidateFetchProved = true;
				break;
			}
		} catch {
			// A failed read is retryable only within this fixed propagation bound.
		}
		if (attempt < probeAttempts) await sleepFn(10_000);
	}
	invariant(candidateFetchProved, 'Staging never completed the exact inert candidate fetch.');

	return {
		environment,
		baseUrl: target.baseUrl,
		releaseSha: sourceSha,
		transactionId,
		proof: 'candidate-fetch-completed',
		candidateFetchProved: true,
		completedAt: new Date().toISOString()
	};
}

/**
 * Production qualification is intentionally control-plane-only. The byte-identical
 * candidate has already been exercised on staging; before C, production may prove
 * only trusted Cloudflare configuration, bindings, Queue posture, and receipt state.
 * @param {{sourceSha:string,transactionId:string,releaseControlSecret:string,releaseLeaseId:string,receiptVerificationDeadlineAt:string,authorizeQualifyFn:()=>Promise<unknown>,fetchFn?:typeof fetch,nowFn?:()=>number}} input
 */
export async function qualifyProductionReleaseAuthority({
	sourceSha,
	transactionId,
	releaseControlSecret,
	releaseLeaseId,
	receiptVerificationDeadlineAt,
	authorizeQualifyFn,
	fetchFn = fetch,
	nowFn = Date.now
}) {
	invariant(/^[a-f0-9]{40}$/u.test(sourceSha), 'Production qualification source is invalid.');
	invariant(
		/^[1-9][0-9]{0,19}-[1-9][0-9]{0,9}$/u.test(transactionId),
		'Production qualification transaction is invalid.'
	);
	invariant(
		/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(releaseLeaseId),
		'Production qualification lease is invalid.'
	);
	invariant(
		typeof releaseControlSecret === 'string' && releaseControlSecret.length >= 32,
		'Production qualification control secret is required.'
	);
	const deadlineMs = Date.parse(receiptVerificationDeadlineAt);
	invariant(
		Number.isSafeInteger(deadlineMs) && deadlineMs - nowFn() >= 90_000,
		'Receipt verification window is insufficient for production qualification.'
	);
	invariant(
		typeof authorizeQualifyFn === 'function',
		'Trusted production configuration proof is required.'
	);
	await authorizeQualifyFn();
	invariant(
		deadlineMs - nowFn() >= 30_000,
		'Receipt verification window expired before production qualification.'
	);
	const result = await mutateReleaseAuthority({
		action: 'qualify',
		target: ENVIRONMENTS.production,
		sourceSha,
		transactionId,
		releaseLeaseId,
		receiptVerificationDeadlineAt,
		releaseControlSecret,
		fetchFn
	});
	return {
		environment: 'production',
		releaseSha: sourceSha,
		transactionId,
		releaseAuthorityQualified: result.status === 'qualified',
		candidateRuntimeInitialized: false,
		trustedProductionProofs: true,
		receiptVerificationDeadlineAt
	};
}

/**
 * Finalize only after every launch-critical proof has completed. If the caller
 * disappears before this mutation, the qualified row still expires. If the
 * response is lost after the mutation, no unproved downstream work remains.
 * @param {{environment:'preview'|'production',sourceSha:string,transactionId:string,releaseControlSecret:string,releaseLeaseId:string,receiptVerificationDeadlineAt:string,authorizeFinalizeFn:()=>Promise<unknown>,fetchFn?:typeof fetch,nowFn?:()=>number}} input
 */
export async function finalizePublicDiscoveryReleaseAuthority({
	environment,
	sourceSha,
	transactionId,
	releaseControlSecret,
	releaseLeaseId,
	receiptVerificationDeadlineAt,
	authorizeFinalizeFn,
	fetchFn = fetch,
	nowFn = Date.now
}) {
	const target = ENVIRONMENTS[environment];
	invariant(target, 'Release finalization environment is invalid.');
	invariant(/^[a-f0-9]{40}$/u.test(sourceSha), 'Release finalization source is invalid.');
	invariant(
		/^[1-9][0-9]{0,19}-[1-9][0-9]{0,9}$/u.test(transactionId),
		'Release finalization transaction is invalid.'
	);
	invariant(/^[0-9a-f-]{36}$/u.test(releaseLeaseId), 'Release finalization lease is invalid.');
	invariant(
		typeof releaseControlSecret === 'string' && releaseControlSecret.length >= 32,
		'Release finalization control secret is required.'
	);
	const deadlineMs = Date.parse(receiptVerificationDeadlineAt);
	invariant(
		Number.isSafeInteger(deadlineMs) && deadlineMs - nowFn() >= 90_000,
		'Receipt verification window is insufficient for finalization.'
	);
	invariant(typeof authorizeFinalizeFn === 'function', 'Final receipt proof is required.');
	await authorizeFinalizeFn();
	invariant(
		deadlineMs - nowFn() >= 30_000,
		'Receipt verification window expired before finalization.'
	);
	const result = await mutateReleaseAuthority({
		action: 'finalize',
		target,
		sourceSha,
		transactionId,
		releaseLeaseId,
		receiptVerificationDeadlineAt,
		releaseControlSecret,
		fetchFn
	});
	return {
		environment,
		releaseSha: sourceSha,
		transactionId,
		releaseAuthorityFinalized: result.status === 'committed',
		receiptVerificationDeadlineAt
	};
}

/** @param {string[]} argv */
function parseAuthorityArgs(argv) {
	const flags = [
		'--environment',
		'--source-sha',
		'--transaction-id',
		'--release-lease-id',
		'--receipt-verification-deadline',
		'--attestation',
		'--signature',
		'--allowed-signers'
	];
	invariant(
		argv.length === flags.length * 2,
		'Every exact-generation qualification argument is required.'
	);
	const values = new Map();
	for (let index = 0; index < argv.length; index += 2) {
		invariant(
			flags.includes(argv[index]) && argv[index + 1] && !values.has(argv[index]),
			'Qualification arguments are invalid.'
		);
		values.set(argv[index], argv[index + 1]);
	}
	const environment = values.get('--environment');
	invariant(
		environment === 'preview' || environment === 'production',
		'Qualification environment is invalid.'
	);
	return Object.fromEntries(flags.map((flag) => [flag.slice(2), values.get(flag)]));
}

/** @param {string[]} argv */
function parseProbeArgs(argv) {
	const flags = ['--environment', '--source-sha', '--transaction-id'];
	invariant(
		argv.length === flags.length * 2,
		'Every release-candidate probe argument is required.'
	);
	const values = new Map();
	for (let index = 0; index < argv.length; index += 2) {
		invariant(
			flags.includes(argv[index]) && argv[index + 1] && !values.has(argv[index]),
			'Release-candidate probe arguments are invalid.'
		);
		values.set(argv[index], argv[index + 1]);
	}
	invariant(values.get('--environment') === 'preview', 'Candidate probe must target preview.');
	return Object.fromEntries(flags.map((flag) => [flag.slice(2), values.get(flag)]));
}

const isMain =
	process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
	try {
		const argv = process.argv.slice(2);
		const commands = new Set([
			'finalize',
			'qualify-preview-authority',
			'qualify-production-authority'
		]);
		const command = commands.has(argv[0]) ? argv[0] : 'probe-preview';
		if (command === 'probe-preview') {
			const args = parseProbeArgs(argv);
			const result = await qualifyPublicDiscoveryGeneration({
				environment: 'preview',
				sourceSha: args['source-sha'],
				transactionId: args['transaction-id'],
				releaseProbeSecret: process.env.RELEASE_PROBE_SECRET ?? ''
			});
			console.log(JSON.stringify(result));
			process.exit(0);
		}
		const args = parseAuthorityArgs(argv.slice(1));
		invariant(
			(command === 'qualify-preview-authority' && args.environment === 'preview') ||
				(command === 'finalize' &&
					(args.environment === 'preview' || args.environment === 'production')) ||
				(command === 'qualify-production-authority' && args.environment === 'production'),
			'Qualification command crossed its environment authority.'
		);
		const attestationBytes = readFileSync(args.attestation);
		const signatureBytes = readFileSync(args.signature);
		const authorizeReceiptFn = async () => {
			const proof = await verifyCloudflareQueueReleasePhaseState({
				accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
				apiToken: process.env.CLOUDFLARE_API_TOKEN,
				allowedSignersPath: args['allowed-signers'],
				attestationBytes,
				signatureBytes,
				releasePhase: args.environment === 'preview' ? 'activate-preview' : 'activate-production',
				sourceSha: args['source-sha'],
				state: 'active',
				minimumRemainingValiditySeconds: 90
			});
			invariant(
				proof.realm === args.environment &&
					proof.receiptVerificationDeadlineAt === args['receipt-verification-deadline'],
				'Receipt proof crossed the release handoff.'
			);
		};
		const common = {
			sourceSha: args['source-sha'],
			transactionId: args['transaction-id'],
			releaseControlSecret: process.env.RELEASE_CONTROL_SECRET ?? '',
			releaseLeaseId: args['release-lease-id'],
			receiptVerificationDeadlineAt: args['receipt-verification-deadline']
		};
		let result;
		if (command === 'finalize') {
			result = await finalizePublicDiscoveryReleaseAuthority({
				...common,
				environment: args.environment,
				authorizeFinalizeFn: authorizeReceiptFn
			});
		} else if (command === 'qualify-production-authority') {
			result = await qualifyProductionReleaseAuthority({
				...common,
				authorizeQualifyFn: authorizeReceiptFn
			});
		} else {
			result = await qualifyPreviewReleaseAuthority({
				...common,
				authorizeQualifyFn: authorizeReceiptFn
			});
		}
		console.log(JSON.stringify(result));
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
