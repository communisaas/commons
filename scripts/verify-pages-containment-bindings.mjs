#!/usr/bin/env node

import { pathToFileURL } from 'node:url';
import { readBoundedResponseJson } from '../src/lib/server/bounded-response.mjs';

const FORBIDDEN_BINDING_KEYS = Object.freeze([
	'ai_bindings',
	'analytics_engine_datasets',
	'browser_bindings',
	'd1_databases',
	'durable_object_namespaces',
	'hyperdrive_bindings',
	'kv_namespaces',
	'mtls_certificates',
	'pipelines',
	'queue_producers',
	'r2_buckets',
	'services',
	'vectorize_bindings',
	'workflows'
]);

/** @param {unknown} condition @param {string} message @returns {asserts condition} */
function invariant(condition, message) {
	if (!condition) throw new Error(message);
}

/** @param {unknown} value @returns {Record<string, any> | null} */
function record(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

/** @param {unknown} value */
function bindingCollectionIsEmpty(value) {
	if (value === undefined || value === null) return true;
	if (Array.isArray(value)) return value.length === 0;
	const object = record(value);
	return object !== null && Object.keys(object).length === 0;
}

/**
 * This is a configuration-only proof. It calls the Pages control plane but no
 * application binding, storage service, Convex deployment, or Atlas endpoint.
 * @param {{pagesProject: unknown, environment: 'preview'|'production'}} input
 */
export function validatePagesContainmentBindings({ pagesProject, environment }) {
	invariant(
		environment === 'preview' || environment === 'production',
		'Invalid Pages environment.'
	);
	const pagesResult = record(record(pagesProject)?.result);
	const configs = record(pagesResult?.deployment_configs);
	invariant(configs !== null, 'Pages project has no deployment configs.');
	const config = record(configs[environment]);
	invariant(config !== null, `Pages ${environment} deployment config is missing.`);

	for (const key of FORBIDDEN_BINDING_KEYS) {
		invariant(
			bindingCollectionIsEmpty(config[key]),
			`Pages ${environment} containment must have no ${key} bindings.`
		);
	}

	const envVars = config.env_vars;
	invariant(
		envVars === undefined || envVars === null || record(envVars) !== null,
		`Pages ${environment} env_vars must be an object when present.`
	);
	for (const [name, binding] of Object.entries(record(envVars) ?? {})) {
		invariant(
			record(binding)?.type === 'secret_text',
			`Pages ${environment} containment must not retain plain-text variable ${name}.`
		);
	}

	return {
		environment,
		bindingCount: 0,
		plainTextVariableCount: 0,
		secretCount: Object.keys(record(envVars) ?? {}).length
	};
}

/** @param {string[]} argv @returns {{environment: 'preview'|'production'}} */
export function parsePagesContainmentBindingArgs(argv) {
	let environment;
	for (let index = 0; index < argv.length; index += 1) {
		const flag = argv[index];
		invariant(flag === '--environment', `Unknown argument: ${flag}`);
		invariant(environment === undefined, '--environment may be supplied only once.');
		environment = argv[index + 1];
		invariant(
			environment !== undefined && !environment.startsWith('--'),
			'--environment needs a value.'
		);
		index += 1;
	}
	invariant(
		environment === 'preview' || environment === 'production',
		'--environment must be preview or production.'
	);
	return { environment: /** @type {'preview'|'production'} */ (environment) };
}

/**
 * @param {{accountId: string|undefined, apiToken: string|undefined, environment: 'preview'|'production', fetchFn?: typeof fetch, pagesProject?: string}} options
 */
export async function verifyPagesContainmentBindings({
	accountId,
	apiToken,
	environment,
	fetchFn = fetch,
	pagesProject = 'communique-site'
}) {
	invariant(
		typeof accountId === 'string' && accountId.length > 0,
		'CLOUDFLARE_ACCOUNT_ID is required.'
	);
	invariant(
		typeof apiToken === 'string' && apiToken.length > 0,
		'CLOUDFLARE_API_TOKEN is required.'
	);
	const response = await fetchFn(
		`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/pages/projects/${encodeURIComponent(pagesProject)}`,
		{
			headers: { Authorization: `Bearer ${apiToken}` },
			redirect: 'error',
			signal: AbortSignal.timeout(15_000)
		}
	);
	invariant(response.ok, `Pages project settings returned HTTP ${response.status}.`);
	return validatePagesContainmentBindings({
		pagesProject: await readBoundedResponseJson(response, 'Pages project settings response'),
		environment
	});
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
	try {
		const { environment } = parsePagesContainmentBindingArgs(process.argv.slice(2));
		const result = await verifyPagesContainmentBindings({
			accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
			apiToken: process.env.CLOUDFLARE_API_TOKEN,
			environment
		});
		console.log(JSON.stringify(result));
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
