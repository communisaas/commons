#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readBoundedResponseJson } from '../src/lib/server/bounded-response.mjs';

export const CONVEX_WORK_BUDGET_BINDING = 'CONVEX_WORK_BUDGET';
export const CONVEX_WORK_BUDGET_CLASS = 'ConvexWorkBudget';
export const CONVEX_WORK_BUDGET_WORKER = 'commons-convex-work-budget';
export const RETIRED_CONVEX_WORK_BUDGET_WORKER = 'commons-convex-work-budget-nonprod';
export const PAID_PROVIDER_PAGES_SECRET_BINDINGS = Object.freeze([
	'EXA_API_KEY',
	'FIRECRAWL_API_KEY',
	'GEMINI_API_KEY',
	'GROQ_API_KEY'
]);
export const PAID_PROVIDER_OPERATOR_BINDING = 'PAID_PROVIDER_OPERATOR_USER_IDS';
const REFRESH_BINDING = 'PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE';
const VERSION_ID_PATTERN =
	/^([a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/u;
const SOURCE_SHA_PATTERN = /^[a-f0-9]{40}$/u;

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
 * Prove that traffic is not split across an old version and that the one live
 * version carries Wrangler's immutable source tag for the exact reviewed SHA.
 * Settings alone cannot distinguish a newly uploaded Worker from an older
 * active version with the same binding shape.
 * @param {{activeDeployment: unknown, activeVersion: unknown, expectedSourceSha: string}} input
 */
export function validateConvexWorkBudgetActiveVersion({
	activeDeployment,
	activeVersion,
	expectedSourceSha
}) {
	invariant(
		typeof expectedSourceSha === 'string' && SOURCE_SHA_PATTERN.test(expectedSourceSha),
		'Expected work-budget source must be an exact lowercase Git SHA.'
	);
	const deployment = record(activeDeployment);
	invariant(
		Array.isArray(deployment?.versions),
		'Work-budget Worker deployment status is invalid.'
	);
	invariant(
		deployment.versions.length === 1 && deployment.versions[0]?.percentage === 100,
		'Work-budget Worker must have exactly one fully active version.'
	);
	const versionId = deployment.versions[0]?.version_id;
	invariant(
		typeof versionId === 'string' && VERSION_ID_PATTERN.test(versionId),
		'Work-budget Worker active version id is invalid.'
	);
	const version = record(activeVersion);
	invariant(
		version?.id === versionId && record(version.annotations)?.['workers/tag'] === expectedSourceSha,
		'Work-budget Worker active version is not tagged with the exact source SHA.'
	);
	return { releaseSha: expectedSourceSha, versionId };
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
	invariant(
		bindings.length === 1,
		'Work-budget Worker must have exactly one binding: its Durable Object namespace.'
	);
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
		const envVars = record(config.env_vars);
		invariant(envVars, `Pages ${realm} env_vars are missing.`);
		for (const secretName of PAID_PROVIDER_PAGES_SECRET_BINDINGS) {
			invariant(
				envVars[secretName] === undefined,
				`Pages ${realm} project defaults must not retain paid-provider credential ${secretName}.`
			);
		}
		if (realm === 'preview') {
			invariant(
				Object.keys(namespaces ?? {}).length === 0,
				'Pages preview must not receive the team work-budget or any Durable Object binding.'
			);
			invariant(
				envVars[PAID_PROVIDER_OPERATOR_BINDING] === undefined,
				'Pages preview must not receive the paid-provider operator capability.'
			);
			continue;
		}
		invariant(
			record(envVars[PAID_PROVIDER_OPERATOR_BINDING])?.type === 'secret_text',
			'Pages production paid-provider operator allowlist must be an encrypted secret binding.'
		);
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
		paidProviderProjectDefaultBindingsAbsent: [...PAID_PROVIDER_PAGES_SECRET_BINDINGS],
		paidProviderOperatorBinding: PAID_PROVIDER_OPERATOR_BINDING,
		previewPagesBound: false,
		previewPaidProviderBound: false,
		proof,
		worker: CONVEX_WORK_BUDGET_WORKER
	};
}

/**
 * @param {{accountId: string|undefined, apiToken: string|undefined, environment: Realm, activeDeployment: unknown, activeVersion: unknown, expectedSourceSha: string, fetchFn?: typeof fetch, pagesProject?: string, pagesProof?: PagesProof}} input
 */
export async function verifyConvexWorkBudgetDeployment({
	accountId,
	apiToken,
	environment,
	activeDeployment,
	activeVersion,
	expectedSourceSha,
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
	const active = validateConvexWorkBudgetActiveVersion({
		activeDeployment,
		activeVersion,
		expectedSourceSha
	});
	if (pagesProof === 'none') {
		return {
			namespaceId: validateConvexWorkBudgetWorker({ workerSettings, workerSubdomain }),
			...active,
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
	return {
		...validatePagesConvexWorkBudgetBinding({
			workerSettings,
			workerSubdomain,
			pagesProject: await readBoundedResponseJson(pagesResponse, 'Pages project settings response'),
			environment,
			proof: pagesProof
		}),
		...active
	};
}

/** @param {string[]} argv */
function parseArgs(argv) {
	const valueFlags = new Set([
		'--environment',
		'--deployment-status',
		'--active-version',
		'--expected-source-sha'
	]);
	const postureFlags = new Set(['--worker-only', '--canary-binding']);
	const values = new Map();
	let posture;
	for (let index = 0; index < argv.length; index += 1) {
		const flag = argv[index];
		if (postureFlags.has(flag)) {
			invariant(posture === undefined, 'Pages proof posture may be supplied only once.');
			posture = flag;
			continue;
		}
		invariant(
			valueFlags.has(flag) && !values.has(flag),
			`Invalid work-budget verifier argument: ${flag}.`
		);
		const value = argv[index + 1];
		invariant(value && !value.startsWith('--'), `${flag} needs a value.`);
		values.set(flag, value);
		index += 1;
	}
	invariant(
		values.size === valueFlags.size,
		'Every work-budget deployment identity argument is required.'
	);
	const environment = values.get('--environment');
	invariant(environment === 'production' || environment === 'preview', 'Invalid environment.');
	const pagesProof =
		posture === '--worker-only' ? 'none' : posture === '--canary-binding' ? 'current' : 'both';
	return {
		environment: /** @type {Realm} */ (environment),
		pagesProof: /** @type {PagesProof} */ (pagesProof),
		deploymentStatus: values.get('--deployment-status'),
		activeVersion: values.get('--active-version'),
		expectedSourceSha: values.get('--expected-source-sha')
	};
}

/** @param {string} filePath @param {string} label */
function readBoundedJson(filePath, label) {
	const bytes = readFileSync(filePath);
	invariant(bytes.byteLength > 0 && bytes.byteLength <= 1024 * 1024, `${label} is not bounded.`);
	return JSON.parse(bytes.toString('utf8'));
}

const isMain =
	process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
	try {
		const args = parseArgs(process.argv.slice(2));
		console.log(
			JSON.stringify(
				await verifyConvexWorkBudgetDeployment({
					accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
					apiToken: process.env.CLOUDFLARE_API_TOKEN,
					environment: args.environment,
					pagesProof: args.pagesProof,
					expectedSourceSha: args.expectedSourceSha,
					activeDeployment: readBoundedJson(args.deploymentStatus, 'Work-budget deployment status'),
					activeVersion: readBoundedJson(args.activeVersion, 'Work-budget active version')
				})
			)
		);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
