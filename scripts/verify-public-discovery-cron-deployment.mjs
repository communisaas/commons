#!/usr/bin/env node

import { pathToFileURL } from 'node:url';
import { readBoundedResponseJson } from '../src/lib/server/bounded-response.mjs';

export const PUBLIC_DISCOVERY_CRON_WORKER = 'commons-public-discovery-manifest-cron';
export const PUBLIC_DISCOVERY_CRON_SCHEDULE = '* * * * *';
export const PUBLIC_DISCOVERY_PRODUCTION_REFRESH_URL =
	'https://commons.email/api/internal/public-discovery-manifest-refresh';
export const PUBLIC_DISCOVERY_NONPROD_REFRESH_URL =
	'https://staging.commons.email/api/internal/public-discovery-manifest-refresh';

const REQUIRED_SECRET_NAMES = [
	'DISCOVERY_MANIFEST_REFRESH_SECRET',
	'DISCOVERY_MANIFEST_REFRESH_SECRET_NONPROD'
];
const REQUIRED_BINDING_TYPES = new Map([
	['PUBLIC_DISCOVERY_MANIFEST_REFRESH_URL', 'plain_text'],
	['PUBLIC_DISCOVERY_MANIFEST_REFRESH_URL_NONPROD', 'plain_text'],
	['DISCOVERY_MANIFEST_REFRESH_SECRET', 'secret_text'],
	['DISCOVERY_MANIFEST_REFRESH_SECRET_NONPROD', 'secret_text']
]);

/** @param {unknown} condition @param {string} message @returns {asserts condition} */
function invariant(condition, message) {
	if (!condition) throw new Error(message);
}

/** @param {unknown} value @returns {Record<string, any> | null} */
function record(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

/** @param {string} source @param {string} name */
function tomlSection(source, name) {
	const headers = [...source.matchAll(/^\[([^\]\r\n]+)\]\s*$/gm)];
	const selected = headers.filter((match) => match[1] === name);
	invariant(selected.length === 1, `Cron Worker source config must contain one [${name}] section.`);
	const start = selected[0].index + selected[0][0].length;
	const next = headers.find((match) => match.index > selected[0].index);
	return source.slice(start, next?.index ?? source.length);
}

/** @param {string} section @param {string} name */
function exactTomlString(section, name) {
	const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const matches = [
		...section.matchAll(new RegExp(`^${escaped}\\s*=\\s*"([^"\\r\\n]*)"\\s*$`, 'gm'))
	];
	invariant(matches.length === 1, `Cron Worker source config must assign ${name} exactly once.`);
	return matches[0][1];
}

/**
 * Parse the checked-in Wrangler subset and bind the deploy verifier constants to
 * the actual source artifact. This is deliberately strict: aliases, duplicate
 * assignments, pages.dev endpoints, and cadence drift fail before deployment.
 * @param {string} source
 */
export function validatePublicDiscoveryCronSourceConfig(source) {
	invariant(typeof source === 'string', 'Cron Worker source config must be text.');
	const vars = tomlSection(source, 'vars');
	const triggers = tomlSection(source, 'triggers');
	const productionUrl = exactTomlString(vars, 'PUBLIC_DISCOVERY_MANIFEST_REFRESH_URL');
	const nonprodUrl = exactTomlString(vars, 'PUBLIC_DISCOVERY_MANIFEST_REFRESH_URL_NONPROD');
	const scheduleMatches = [...triggers.matchAll(/^crons\s*=\s*\[\s*"([^"\r\n]*)"\s*\]\s*$/gm)];
	invariant(
		scheduleMatches.length === 1,
		'Cron Worker source config must contain exactly one literal cron schedule.'
	);
	invariant(
		productionUrl === PUBLIC_DISCOVERY_PRODUCTION_REFRESH_URL,
		'Cron Worker source production URL drifted from the deployment verifier.'
	);
	invariant(
		nonprodUrl === PUBLIC_DISCOVERY_NONPROD_REFRESH_URL,
		'Cron Worker source non-production URL drifted from the deployment verifier.'
	);
	invariant(
		scheduleMatches[0][1] === PUBLIC_DISCOVERY_CRON_SCHEDULE,
		'Cron Worker source schedule drifted from the deployment verifier.'
	);
	return { nonprodUrl, productionUrl, schedule: scheduleMatches[0][1] };
}

/** @param {unknown[]} bindings @param {string} name @param {string} type */
function exactBinding(bindings, name, type) {
	const matches = bindings.filter(
		(binding) => record(binding)?.name === name && record(binding)?.type === type
	);
	invariant(
		matches.length === 1,
		`Cron Worker must expose exactly one ${type} binding named ${name}.`
	);
	const binding = record(matches[0]);
	invariant(binding !== null, `Cron Worker ${name} binding is invalid.`);
	return binding;
}

/**
 * Validate configuration only. No request is sent to either manifest endpoint,
 * so this proof cannot consume a gate reservation, Convex read, or R2 write.
 * @param {{workerSettings: unknown, workerSchedules: unknown, workerSubdomain: unknown}} input
 */
export function validatePublicDiscoveryCronDeployment({
	workerSettings,
	workerSchedules,
	workerSubdomain
}) {
	const settings = record(record(workerSettings)?.result);
	const bindings = settings?.bindings;
	invariant(Array.isArray(bindings), 'Cron Worker settings have no bindings array.');

	const productionUrl = exactBinding(
		bindings,
		'PUBLIC_DISCOVERY_MANIFEST_REFRESH_URL',
		'plain_text'
	);
	const nonprodUrl = exactBinding(
		bindings,
		'PUBLIC_DISCOVERY_MANIFEST_REFRESH_URL_NONPROD',
		'plain_text'
	);
	invariant(
		productionUrl?.text === PUBLIC_DISCOVERY_PRODUCTION_REFRESH_URL,
		'Cron Worker production refresh endpoint is not the committed exact URL.'
	);
	invariant(
		nonprodUrl?.text === PUBLIC_DISCOVERY_NONPROD_REFRESH_URL,
		'Cron Worker non-production refresh endpoint is not the committed exact URL.'
	);
	for (const name of REQUIRED_SECRET_NAMES) exactBinding(bindings, name, 'secret_text');
	invariant(
		bindings.length === REQUIRED_BINDING_TYPES.size &&
			bindings.every((value) => {
				const binding = record(value);
				return binding !== null && REQUIRED_BINDING_TYPES.get(binding.name) === binding.type;
			}),
		'Cron Worker binding set must contain only the two exact endpoint vars and two refresh secrets.'
	);

	const schedules = record(workerSchedules)?.result;
	invariant(Array.isArray(schedules), 'Cron Worker schedules response has no result array.');
	const exactSchedules = schedules.filter(
		(schedule) => record(schedule)?.cron === PUBLIC_DISCOVERY_CRON_SCHEDULE
	);
	invariant(
		schedules.length === 1 && exactSchedules.length === 1,
		'Cron Worker must expose exactly the committed one-minute polling schedule.'
	);

	const subdomain = record(record(workerSubdomain)?.result);
	invariant(
		subdomain?.enabled === false && subdomain?.previews_enabled === false,
		'Cron Worker must disable workers.dev and version preview URLs.'
	);

	return {
		productionUrl: productionUrl.text,
		nonprodUrl: nonprodUrl.text,
		schedule: PUBLIC_DISCOVERY_CRON_SCHEDULE,
		secretBindings: [...REQUIRED_SECRET_NAMES],
		worker: PUBLIC_DISCOVERY_CRON_WORKER
	};
}

/** @param {{accountId: string|undefined, apiToken: string|undefined, fetchFn?: typeof fetch}} options */
export async function verifyPublicDiscoveryCronDeployment({
	accountId,
	apiToken,
	fetchFn = fetch
}) {
	invariant(
		typeof accountId === 'string' && accountId.length > 0,
		'CLOUDFLARE_ACCOUNT_ID is required.'
	);
	invariant(
		typeof apiToken === 'string' && apiToken.length > 0,
		'CLOUDFLARE_API_TOKEN is required.'
	);
	const base = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/workers/scripts/${PUBLIC_DISCOVERY_CRON_WORKER}`;
	/** @type {RequestInit} */
	const request = {
		headers: { Authorization: `Bearer ${apiToken}` },
		redirect: 'error',
		signal: AbortSignal.timeout(15_000)
	};
	const [settingsResponse, schedulesResponse, subdomainResponse] = await Promise.all([
		fetchFn(`${base}/settings`, request),
		fetchFn(`${base}/schedules`, request),
		fetchFn(`${base}/subdomain`, request)
	]);
	invariant(settingsResponse.ok, `Cron Worker settings returned HTTP ${settingsResponse.status}.`);
	invariant(
		schedulesResponse.ok,
		`Cron Worker schedules returned HTTP ${schedulesResponse.status}.`
	);
	invariant(
		subdomainResponse.ok,
		`Cron Worker subdomain returned HTTP ${subdomainResponse.status}.`
	);
	return validatePublicDiscoveryCronDeployment({
		workerSettings: await readBoundedResponseJson(
			settingsResponse,
			'Cron Worker settings response'
		),
		workerSchedules: await readBoundedResponseJson(
			schedulesResponse,
			'Cron Worker schedules response'
		),
		workerSubdomain: await readBoundedResponseJson(
			subdomainResponse,
			'Cron Worker subdomain response'
		)
	});
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
	try {
		const result = await verifyPublicDiscoveryCronDeployment({
			accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
			apiToken: process.env.CLOUDFLARE_API_TOKEN
		});
		console.log(JSON.stringify(result));
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
