#!/usr/bin/env node

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readBoundedResponseJson } from '../src/lib/server/bounded-response.mjs';
import {
	PUBLIC_DISCOVERY_BOOTSTRAP_CONTROL_PATH,
	PUBLIC_DISCOVERY_BOOTSTRAP_MAXIMUM_AUTHORITY_MS,
	PUBLIC_DISCOVERY_BOOTSTRAP_PURPOSE
} from '../src/lib/server/public-discovery-bootstrap-protocol.mjs';

export const PUBLIC_DISCOVERY_BOOTSTRAP_CONTROL_ENDPOINT = `https://release-control.commons.email${PUBLIC_DISCOVERY_BOOTSTRAP_CONTROL_PATH}`;

const PROTOCOL = '3';
const RELEASE_SHA_PATTERN = /^[a-f0-9]{40}$/u;
const RELEASE_TRANSACTION_PATTERN = /^[1-9][0-9]{0,19}-[1-9][0-9]{0,9}$/u;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const GENERATION_PATTERN =
	/^list=[1-9][0-9]{0,19}:(?:0|[1-9][0-9]{0,15});relations=[1-9][0-9]{0,19}:(?:0|[1-9][0-9]{0,15})$/u;
const RESULT_KEYS = [
	'completedAt',
	'expiresAt',
	'generation',
	'leaseId',
	'notAfter',
	'purpose',
	'refreshLeaseId',
	'sourceSha',
	'status',
	'transactionId'
];

/** @param {unknown} condition @param {string} message @returns {asserts condition} */
function invariant(condition, message) {
	if (!condition) throw new Error(message);
}

/** @param {unknown} value @returns {Record<string, any> | null} */
function record(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

/** @param {unknown} value @param {string} label */
function canonicalTimestamp(value, label) {
	invariant(typeof value === 'string', `${label} is absent.`);
	const milliseconds = Date.parse(value);
	invariant(
		Number.isSafeInteger(milliseconds) && new Date(milliseconds).toISOString() === value,
		`${label} is not canonical UTC.`
	);
	return milliseconds;
}

/**
 * @param {unknown} value
 * @param {{action:'arm'|'contain'|'inspect',sourceSha:string,transactionId:string,leaseId:string,notAfter:string,now:number}} expected
 */
export function validatePublicDiscoveryBootstrapAuthorityResult(value, expected) {
	const result = record(value);
	invariant(
		result !== null && Object.keys(result).sort().join('\0') === [...RESULT_KEYS].sort().join('\0'),
		'Bootstrap authority response shape is invalid.'
	);
	invariant(
		result.sourceSha === expected.sourceSha &&
			result.transactionId === expected.transactionId &&
			result.leaseId === expected.leaseId &&
			result.notAfter === expected.notAfter &&
			result.purpose === PUBLIC_DISCOVERY_BOOTSTRAP_PURPOSE,
		'Bootstrap authority response crossed its exact tuple.'
	);
	const allowedStatus =
		expected.action === 'arm'
			? ['armed']
			: expected.action === 'contain'
				? ['contained']
				: ['absent', 'armed', 'completed', 'contained'];
	invariant(
		allowedStatus.includes(result.status),
		`Bootstrap authority ${expected.action} returned an invalid status.`
	);
	const notAfterMilliseconds = canonicalTimestamp(result.notAfter, 'Bootstrap authority notAfter');
	invariant(
		notAfterMilliseconds === Date.parse(expected.notAfter),
		'Bootstrap authority notAfter drifted.'
	);
	if (result.status === 'armed') {
		const expiresAt = canonicalTimestamp(result.expiresAt, 'Bootstrap authority expiry');
		invariant(
			expiresAt > expected.now &&
				expiresAt <= notAfterMilliseconds &&
				expiresAt <= expected.now + PUBLIC_DISCOVERY_BOOTSTRAP_MAXIMUM_AUTHORITY_MS &&
				result.completedAt === null &&
				result.generation === null &&
				result.refreshLeaseId === null,
			'Bootstrap armed authority timing or terminal fields are invalid.'
		);
	} else if (result.status === 'completed') {
		const completedAt = canonicalTimestamp(
			result.completedAt,
			'Bootstrap authority completion time'
		);
		invariant(
			completedAt >= 0 &&
				completedAt <= expected.now + 60_000 &&
				result.expiresAt === null &&
				typeof result.generation === 'string' &&
				GENERATION_PATTERN.test(result.generation) &&
				typeof result.refreshLeaseId === 'string' &&
				UUID_V4_PATTERN.test(result.refreshLeaseId),
			'Bootstrap completed authority proof is invalid.'
		);
	} else {
		invariant(
			result.completedAt === null &&
				result.expiresAt === null &&
				result.generation === null &&
				result.refreshLeaseId === null,
			'Bootstrap absent/contained authority retained active fields.'
		);
	}
	return {
		completedAt: result.completedAt,
		expiresAt: result.expiresAt,
		generation: result.generation,
		leaseId: result.leaseId,
		notAfter: result.notAfter,
		purpose: result.purpose,
		refreshLeaseId: result.refreshLeaseId,
		sourceSha: result.sourceSha,
		status: result.status,
		transactionId: result.transactionId
	};
}

/**
 * @param {{action:'arm'|'contain'|'inspect',sourceSha:string,transactionId:string,leaseId:string,notAfter:string,releaseControlSecret:string|undefined,fetchFn?:typeof fetch,nowFn?:()=>number}} input
 */
export async function controlPublicDiscoveryBootstrapAuthority({
	action,
	sourceSha,
	transactionId,
	leaseId,
	notAfter,
	releaseControlSecret,
	fetchFn = fetch,
	nowFn = Date.now
}) {
	invariant(
		action === 'arm' || action === 'contain' || action === 'inspect',
		'Bootstrap authority action is invalid.'
	);
	invariant(RELEASE_SHA_PATTERN.test(sourceSha), 'Bootstrap authority source SHA is invalid.');
	invariant(
		RELEASE_TRANSACTION_PATTERN.test(transactionId),
		'Bootstrap authority transaction is invalid.'
	);
	invariant(UUID_V4_PATTERN.test(leaseId), 'Bootstrap authority lease is invalid.');
	const now = nowFn();
	invariant(Number.isSafeInteger(now) && now >= 0, 'Bootstrap authority clock is invalid.');
	const notAfterMilliseconds = canonicalTimestamp(notAfter, 'Bootstrap authority notAfter');
	if (action === 'arm') {
		invariant(
			notAfterMilliseconds > now &&
				notAfterMilliseconds <= now + PUBLIC_DISCOVERY_BOOTSTRAP_MAXIMUM_AUTHORITY_MS,
			'Bootstrap authority arm deadline is outside the sixty-minute window.'
		);
	}
	invariant(
		typeof releaseControlSecret === 'string' &&
			Buffer.byteLength(releaseControlSecret, 'utf8') >= 32 &&
			Buffer.byteLength(releaseControlSecret, 'utf8') <= 512 &&
			/^[\u0021-\u007e]+$/u.test(releaseControlSecret),
		'Bootstrap release-control capability is invalid.'
	);
	const response = await fetchFn(PUBLIC_DISCOVERY_BOOTSTRAP_CONTROL_ENDPOINT, {
		body: JSON.stringify({
			action,
			leaseId,
			notAfter,
			purpose: PUBLIC_DISCOVERY_BOOTSTRAP_PURPOSE,
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
	invariant(
		response.status === 200 &&
			response.ok &&
			response.headers.get('cache-control') === 'no-store' &&
			response.headers.get('x-public-discovery-refresh-gate-protocol') === PROTOCOL,
		`Bootstrap authority ${action} request failed.`
	);
	return validatePublicDiscoveryBootstrapAuthorityResult(
		await readBoundedResponseJson(response, `Bootstrap authority ${action}`, 4 * 1024),
		{ action, sourceSha, transactionId, leaseId, notAfter, now }
	);
}

/** @param {string[]} argv */
export function parsePublicDiscoveryBootstrapAuthorityArgs(argv) {
	const action = argv[0];
	invariant(
		action === 'arm' || action === 'contain' || action === 'inspect',
		'Bootstrap authority command is invalid.'
	);
	const exactAction = /** @type {'arm'|'contain'|'inspect'} */ (action);
	const required = new Set(['--lease-id', '--not-after', '--source-sha', '--transaction-id']);
	const values = new Map();
	for (let index = 1; index < argv.length; index += 2) {
		const flag = argv[index];
		const value = argv[index + 1];
		invariant(
			required.has(flag) && value !== undefined && !value.startsWith('--') && !values.has(flag),
			'Bootstrap authority arguments are invalid.'
		);
		values.set(flag, value);
	}
	invariant(
		values.size === required.size && [...required].every((flag) => values.has(flag)),
		'Every bootstrap authority argument is required exactly once.'
	);
	return {
		action: exactAction,
		leaseId: values.get('--lease-id'),
		notAfter: values.get('--not-after'),
		sourceSha: values.get('--source-sha'),
		transactionId: values.get('--transaction-id')
	};
}

const isMain =
	process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
	try {
		console.log(
			JSON.stringify(
				await controlPublicDiscoveryBootstrapAuthority({
					...parsePublicDiscoveryBootstrapAuthorityArgs(process.argv.slice(2)),
					releaseControlSecret: process.env.RELEASE_CONTROL_SECRET
				})
			)
		);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
