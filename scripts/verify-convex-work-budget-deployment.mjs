#!/usr/bin/env node

import { pathToFileURL } from 'node:url';
import { readBoundedResponseJson } from '../src/lib/server/bounded-response.mjs';

export const CONVEX_WORK_BUDGET_BINDING = 'CONVEX_WORK_BUDGET';
export const CONVEX_WORK_BUDGET_CLASS = 'ConvexWorkBudget';
export const CONVEX_WORK_BUDGET_WORKER = 'commons-convex-work-budget';
export const RETIRED_CONVEX_WORK_BUDGET_WORKER = 'commons-convex-work-budget-nonprod';
const REFRESH_BINDING = 'PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE';

/** @typedef {'preview'|'production'} Realm */
/** @typedef {'both'|'current'|'none'} PagesProof */

/** @param {unknown} condition @param {string} message @returns {asserts condition} */
function invariant(condition, message) {
	if (!condition) throw new Error(message);
}

/** @param {unknown} value @returns {Record<string, any> | null} */
function record(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

/**
 * Prove the private Worker owns the one team-global SQLite namespace. Candidate
 * preview Pages receives no binding to it; trusted release actors may still use
 * the coordinator through separately authenticated control-plane work.
 * @param {{workerSettings: unknown, workerSubdomain: unknown}} input
 */
export function validateConvexWorkBudgetWorker({ workerSettings, workerSubdomain }) {
	const settings = record(record(workerSettings)?.result);
	const bindings = settings?.bindings;
	invariant(Array.isArray(bindings), 'Work-budget Worker settings have no bindings.');
	invariant(bindings.length === 1, 'Work-budget Worker must have exactly one binding.');
	const binding = record(bindings[0]);
	invariant(
		binding?.name === CONVEX_WORK_BUDGET_BINDING &&
			binding.type === 'durable_object_namespace' &&
			binding.class_name === CONVEX_WORK_BUDGET_CLASS &&
			typeof binding.namespace_id === 'string' &&
			binding.namespace_id.length > 0,
		'Work-budget Worker namespace does not match the committed team-global protocol.'
	);
	const subdomain = record(record(workerSubdomain)?.result);
	invariant(
		subdomain?.enabled === false && subdomain?.previews_enabled === false,
		'Work-budget Worker must disable workers.dev and preview URLs.'
	);
	return binding.namespace_id;
}

/**
 * @param {{workerSettings: unknown, workerSubdomain: unknown, pagesProject: unknown, environment: Realm, proof?: Exclude<PagesProof, 'none'>}} input
 */
export function validatePagesConvexWorkBudgetBinding({
	workerSettings,
	workerSubdomain,
	pagesProject,
	environment,
	proof = 'both'
}) {
	invariant(
		environment === 'production' || environment === 'preview',
		'Invalid Pages environment.'
	);
	invariant(proof === 'both' || proof === 'current', 'Invalid Pages binding proof mode.');
	const namespaceId = validateConvexWorkBudgetWorker({ workerSettings, workerSubdomain });
	const configs = record(record(record(pagesProject)?.result)?.deployment_configs);
	invariant(configs, 'Pages project has no deployment configs.');
	const realms =
		proof === 'both'
			? /** @type {const} */ (['production', 'preview'])
			: /** @type {Realm[]} */ ([environment]);
	for (const realm of realms) {
		const config = record(configs[realm]);
		invariant(config, `Pages ${realm} deployment config is missing.`);
		const namespaces = record(config.durable_object_namespaces);
		if (realm === 'preview') {
			invariant(
				Object.keys(namespaces ?? {}).length === 0,
				'Pages preview must not receive the team work-budget or any Durable Object binding.'
			);
			continue;
		}
		invariant(
			JSON.stringify(Object.keys(namespaces ?? {}).sort()) ===
				JSON.stringify([CONVEX_WORK_BUDGET_BINDING, REFRESH_BINDING].sort()),
			'Pages production Durable Object binding set is not exact.'
		);
		const binding = record(namespaces?.[CONVEX_WORK_BUDGET_BINDING]);
		invariant(binding, 'Pages production work-budget binding is missing.');
		invariant(
			binding.namespace_id === namespaceId,
			'Pages production work-budget namespace does not match the central team coordinator.'
		);
	}
	return {
		binding: CONVEX_WORK_BUDGET_BINDING,
		environment,
		namespaceId,
		previewPagesBound: false,
		proof,
		worker: CONVEX_WORK_BUDGET_WORKER
	};
}

/**
 * @param {{accountId: string|undefined, apiToken: string|undefined, environment: Realm, fetchFn?: typeof fetch, pagesProject?: string, pagesProof?: PagesProof}} input
 */
export async function verifyConvexWorkBudgetDeployment({
	accountId,
	apiToken,
	environment,
	fetchFn = fetch,
	pagesProject = 'communique-site',
	pagesProof = 'both'
}) {
	invariant(typeof accountId === 'string' && accountId, 'CLOUDFLARE_ACCOUNT_ID is required.');
	invariant(typeof apiToken === 'string' && apiToken, 'CLOUDFLARE_API_TOKEN is required.');
	invariant(environment === 'production' || environment === 'preview', 'Invalid environment.');
	invariant(
		pagesProof === 'both' || pagesProof === 'current' || pagesProof === 'none',
		'Invalid Pages proof mode.'
	);
	const base = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}`;
	const headers = { Authorization: `Bearer ${apiToken}` };
	const [settingsResponse, subdomainResponse] = await Promise.all([
		fetchFn(`${base}/workers/scripts/${CONVEX_WORK_BUDGET_WORKER}/settings`, {
			headers,
			redirect: 'error',
			signal: AbortSignal.timeout(15_000)
		}),
		fetchFn(`${base}/workers/scripts/${CONVEX_WORK_BUDGET_WORKER}/subdomain`, {
			headers,
			redirect: 'error',
			signal: AbortSignal.timeout(15_000)
		})
	]);
	invariant(settingsResponse.ok, `Work-budget settings returned HTTP ${settingsResponse.status}.`);
	invariant(
		subdomainResponse.ok,
		`Work-budget subdomain returned HTTP ${subdomainResponse.status}.`
	);
	const workerSettings = await readBoundedResponseJson(
		settingsResponse,
		'Work-budget settings response'
	);
	const workerSubdomain = await readBoundedResponseJson(
		subdomainResponse,
		'Work-budget subdomain response'
	);
	if (pagesProof === 'none') {
		return {
			namespaceId: validateConvexWorkBudgetWorker({ workerSettings, workerSubdomain }),
			worker: CONVEX_WORK_BUDGET_WORKER
		};
	}
	const pagesResponse = await fetchFn(
		`${base}/pages/projects/${encodeURIComponent(pagesProject)}`,
		{
			headers,
			redirect: 'error',
			signal: AbortSignal.timeout(15_000)
		}
	);
	invariant(pagesResponse.ok, `Pages project settings returned HTTP ${pagesResponse.status}.`);
	return validatePagesConvexWorkBudgetBinding({
		workerSettings,
		workerSubdomain,
		pagesProject: await readBoundedResponseJson(pagesResponse, 'Pages project settings response'),
		environment,
		proof: pagesProof
	});
}

/** @param {string[]} argv @returns {{environment: Realm, pagesProof: PagesProof}} */
function parseArgs(argv) {
	invariant(
		(argv.length === 2 || argv.length === 3) &&
			argv[0] === '--environment' &&
			(argv[1] === 'production' || argv[1] === 'preview') &&
			(argv.length === 2 || argv[2] === '--worker-only' || argv[2] === '--canary-binding'),
		'Usage: --environment production|preview [--worker-only|--canary-binding]'
	);
	const pagesProof =
		argv[2] === '--worker-only' ? 'none' : argv[2] === '--canary-binding' ? 'current' : 'both';
	return {
		environment: /** @type {Realm} */ (argv[1]),
		pagesProof: /** @type {PagesProof} */ (pagesProof)
	};
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
	try {
		console.log(
			JSON.stringify(
				await verifyConvexWorkBudgetDeployment({
					accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
					apiToken: process.env.CLOUDFLARE_API_TOKEN,
					...parseArgs(process.argv.slice(2))
				})
			)
		);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
