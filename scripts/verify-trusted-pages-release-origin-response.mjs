#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const RELEASE_SHA_PATTERN = /^[a-f0-9]{40}$/u;
const RELEASE_TRANSACTION_PATTERN = /^[1-9][0-9]{0,19}-[1-9][0-9]{0,9}$/u;
const MAX_HEADER_BYTES = 65_536;
const MAX_BODY_BYTES = 1_024;

/** @param {unknown} condition @param {string} message @returns {asserts condition} */
function invariant(condition, message) {
	if (!condition) throw new Error(`Trusted Pages release-origin proof failed: ${message}`);
}

/**
 * @param {{rawHeaders:string;body:Buffer|string;status:string;releaseSha:string;transactionId:string;component?:'pages'|'pages-containment'}} input
 */
export function validateTrustedPagesReleaseOriginResponse({
	rawHeaders,
	body,
	status,
	releaseSha,
	transactionId,
	component = 'pages'
}) {
	invariant(
		component === 'pages' || component === 'pages-containment',
		'expected component is malformed'
	);
	const expectedStatus = component === 'pages' ? '200' : '503';
	invariant(status === expectedStatus, `HTTP status was ${status}, expected ${expectedStatus}`);
	invariant(RELEASE_SHA_PATTERN.test(releaseSha), 'expected release SHA is malformed');
	invariant(
		RELEASE_TRANSACTION_PATTERN.test(transactionId),
		'expected release transaction is malformed'
	);
	invariant(
		Buffer.byteLength(rawHeaders, 'utf8') > 0 &&
			Buffer.byteLength(rawHeaders, 'utf8') <= MAX_HEADER_BYTES,
		'header block size is invalid'
	);
	const lines = rawHeaders.split(/\r?\n/u);
	const statusLines = lines.filter((line) => /^HTTP\/\S+\s+\d{3}(?:\s|$)/iu.test(line));
	invariant(
		statusLines.length === 1 &&
			new RegExp(`^HTTP\\/\\S+\\s+${expectedStatus}(?:\\s|$)`, 'iu').test(statusLines[0]),
		`response did not contain one exact HTTP ${expectedStatus} header block`
	);
	const headers = new Map();
	for (const line of lines) {
		if (line === '' || /^HTTP\/\S+\s+\d{3}(?:\s|$)/iu.test(line)) continue;
		const separator = line.indexOf(':');
		invariant(separator > 0, 'response contained a malformed header line');
		const name = line.slice(0, separator).trim().toLowerCase();
		invariant(/^[!#$%&'*+.^_`|~0-9a-z-]+$/u.test(name), 'response header name is malformed');
		const value = line.slice(separator + 1).trim();
		const values = headers.get(name) ?? [];
		values.push(value);
		headers.set(name, values);
	}
	/** @param {string} name @param {string} expected */
	const exactHeader = (name, expected) => {
		const values = headers.get(name) ?? [];
		invariant(
			values.length === 1 && values[0] === expected,
			`${name} was not exactly ${JSON.stringify(expected)}`
		);
	};
	exactHeader('content-type', 'application/json; charset=utf-8');
	exactHeader('cache-control', component === 'pages' ? 'private, no-store, max-age=0' : 'no-store');
	exactHeader('cdn-cache-control', 'no-store');
	exactHeader('cloudflare-cdn-cache-control', 'no-store');
	if (component === 'pages') {
		exactHeader('x-commons-origin-release-sha', releaseSha);
		exactHeader('x-commons-origin-release-transaction', transactionId);
		exactHeader('x-commons-origin-access-token', 'absent');
		exactHeader('x-commons-origin-proof-secret', 'absent');
		exactHeader('x-commons-origin-cache-api', 'unavailable');
		exactHeader('x-commons-origin-external-io', '0');
	}
	for (const forbidden of [
		'location',
		'set-cookie',
		'cf-access-client-id',
		'cf-access-client-secret',
		'cf-access-jwt-assertion',
		'cf-access-token',
		'x-commons-release-origin-proof-secret',
		'x-commons-pages-origin-access'
	]) {
		invariant((headers.get(forbidden) ?? []).length === 0, `forbidden header ${forbidden} escaped`);
	}
	const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
	invariant(bytes.byteLength > 0 && bytes.byteLength <= MAX_BODY_BYTES, 'body size is invalid');
	let proof;
	try {
		proof = JSON.parse(bytes.toString('utf8'));
	} catch {
		invariant(false, 'body is not JSON');
	}
	const exactNormalProof =
		proof !== null &&
		!Array.isArray(proof) &&
		typeof proof === 'object' &&
		Object.keys(proof).sort().join('\0') ===
			[
				'cacheApi',
				'externalIo',
				'originAccessToken',
				'originProofSecret',
				'releaseSha',
				'transactionId'
			]
				.sort()
				.join('\0') &&
		proof.releaseSha === releaseSha &&
		proof.transactionId === transactionId &&
		proof.originAccessToken === 'absent' &&
		proof.originProofSecret === 'absent' &&
		proof.cacheApi === 'unavailable' &&
		proof.externalIo === 0;
	const exactContainmentProof =
		proof !== null &&
		!Array.isArray(proof) &&
		typeof proof === 'object' &&
		Object.keys(proof).sort().join('\0') === ['code', 'mode', 'status'].sort().join('\0') &&
		proof.status === 'maintenance' &&
		proof.mode === 'containment' &&
		proof.code === 'SERVICE_CONTAINMENT';
	invariant(
		component === 'pages' ? exactNormalProof : exactContainmentProof,
		'body contract is not exact'
	);
	return proof;
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
	try {
		invariant(
			process.argv.length === 14 &&
				process.argv[2] === '--component' &&
				(process.argv[3] === 'pages' || process.argv[3] === 'pages-containment') &&
				process.argv[4] === '--headers' &&
				process.argv[6] === '--body' &&
				process.argv[8] === '--status' &&
				process.argv[10] === '--release-sha' &&
				process.argv[12] === '--transaction-id',
			'usage is invalid'
		);
		const headerBytes = readFileSync(process.argv[5]);
		const body = readFileSync(process.argv[7]);
		invariant(headerBytes.byteLength <= MAX_HEADER_BYTES, 'header block exceeds 64 KiB');
		const result = validateTrustedPagesReleaseOriginResponse({
			rawHeaders: headerBytes.toString('utf8'),
			body,
			component: /** @type {'pages'|'pages-containment'} */ (process.argv[3]),
			status: process.argv[9],
			releaseSha: process.argv[11],
			transactionId: process.argv[13]
		});
		console.log(JSON.stringify(result));
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
