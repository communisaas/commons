#!/usr/bin/env node

import path from 'node:path';
import { pathToFileURL } from 'node:url';

const RETIRED_STATUSES = new Set([403, 404, 410]);

/**
 * @param {unknown} condition
 * @param {string} message
 * @returns {asserts condition}
 */
function invariant(condition, message) {
	if (!condition) throw new Error(message);
}

/** @param {string} raw */
export function normalizePagesDeploymentUrl(raw) {
	const url = new URL(raw);
	invariant(url.protocol === 'https:', 'Retired Pages URL must use HTTPS.');
	invariant(!url.username && !url.password, 'Retired Pages URL cannot contain credentials.');
	invariant(
		/^[a-z0-9-]+\.communique-site\.pages\.dev$/u.test(url.hostname),
		'Retired URL must be an immutable communique-site Pages deployment.'
	);
	invariant(
		url.pathname === '/' && !url.search && !url.hash,
		'Retired Pages URL must be an origin.'
	);
	return url.origin;
}

/**
 * @param {{ url: string; fetchImpl?: typeof fetch }} options
 */
export async function verifyPagesDeploymentRetired({ url, fetchImpl = fetch }) {
	const origin = normalizePagesDeploymentUrl(url);
	const response = await fetchImpl(`${origin}/api/live`, {
		headers: { accept: 'application/json' },
		method: 'GET',
		redirect: 'manual',
		signal: AbortSignal.timeout(20_000)
	});
	const location = response.headers.get('location');
	const exactOriginClosureRedirect =
		response.status === 301 && location === 'https://commons.email/api/live';
	invariant(
		RETIRED_STATUSES.has(response.status) || exactOriginClosureRedirect,
		`Retired Pages deployment remains publicly executable (HTTP ${response.status}).`
	);
	invariant(
		location === null || exactOriginClosureRedirect,
		'Retired Pages deployment has an unapproved redirect target.'
	);
	return { origin, status: response.status, executable: false };
}

/** @param {string[]} args */
function parseArgs(args) {
	invariant(args.length === 2 && args[0] === '--url', 'Usage: --url <immutable-pages-origin>.');
	invariant(Boolean(args[1]), '--url requires a value.');
	return args[1];
}

const isMain =
	process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
	try {
		const result = await verifyPagesDeploymentRetired({ url: parseArgs(process.argv.slice(2)) });
		console.log(JSON.stringify(result));
	} catch (error) {
		console.error(
			`Pages retirement verification failed: ${error instanceof Error ? error.message : String(error)}`
		);
		process.exit(1);
	}
}
