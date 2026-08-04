#!/usr/bin/env node

import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { canonicalProviderPostureJson } from './paid-provider-account-posture.mjs';
import { readProviderPostureBindingsFromEnvironment } from './verify-paid-provider-account-posture.mjs';
import { readBoundedResponseJson } from '../src/lib/server/bounded-response.mjs';

export const PAID_PROVIDER_PAGES_PROJECT = 'communique-site';
export const PAID_PROVIDER_PAGES_SECRET_NAMES = Object.freeze([
	'EXA_API_KEY',
	'FIRECRAWL_API_KEY',
	'GEMINI_API_KEY',
	'GROQ_API_KEY'
]);

const CLOUDFLARE_API_ORIGIN = 'https://api.cloudflare.com';
const RESPONSE_MAX_BYTES = 1024 * 1024;
const DEPLOYMENT_ID_PATTERN =
	/^([a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/u;

/** @param {unknown} condition @param {string} message @returns {asserts condition} */
function invariant(condition, message) {
	if (!condition) throw new Error(`PAID_PROVIDER_PAGES_SECRETS_INVALID:${message}`);
}

/** @param {unknown} value @returns {Record<string, any> | null} */
function record(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

/** @param {Record<string,any>} config */
function withoutProviderSecrets(config) {
	const copy = structuredClone(config);
	const envVars = record(copy.env_vars);
	if (envVars) {
		for (const name of PAID_PROVIDER_PAGES_SECRET_NAMES) delete envVars[name];
	}
	return copy;
}

/** @param {unknown} rawProject @param {string} phase */
function validateProject(rawProject, phase) {
	const envelope = record(rawProject);
	const project = record(envelope?.result);
	invariant(envelope?.success === true && project, `${phase}_project_envelope`);
	invariant(project.name === PAID_PROVIDER_PAGES_PROJECT, `${phase}_project_identity`);
	const deploymentConfigs = record(project.deployment_configs);
	const canonicalDeployment = record(project.canonical_deployment);
	const canonicalDeploymentId = canonicalDeployment?.id;
	invariant(
		typeof canonicalDeploymentId === 'string' && DEPLOYMENT_ID_PATTERN.test(canonicalDeploymentId),
		`${phase}_canonical_deployment`
	);
	const production = record(deploymentConfigs?.production);
	const preview = record(deploymentConfigs?.preview);
	invariant(production && preview, `${phase}_deployment_configs`);
	const productionEnv = record(production.env_vars);
	const previewEnv = record(preview.env_vars);
	invariant(productionEnv && previewEnv, `${phase}_environment_bindings`);
	const productionWranglerConfigHash = production.wrangler_config_hash;
	invariant(
		typeof productionWranglerConfigHash === 'string' &&
			/^[A-Za-z0-9._:-]{8,256}$/u.test(productionWranglerConfigHash),
		`${phase}_production_wrangler_config_hash`
	);
	const previewWranglerConfigHash = preview.wrangler_config_hash;
	invariant(
		typeof previewWranglerConfigHash === 'string' &&
			/^[A-Za-z0-9._:-]{8,256}$/u.test(previewWranglerConfigHash),
		`${phase}_preview_wrangler_config_hash`
	);
	return {
		canonicalDeploymentId,
		preview,
		previewEnv,
		previewWranglerConfigHash,
		production,
		productionEnv,
		productionWranglerConfigHash
	};
}

/** @param {ReturnType<typeof validateProject>} project @param {string} phase */
function assertProjectProviderSecretsAbsent(project, phase) {
	for (const name of PAID_PROVIDER_PAGES_SECRET_NAMES) {
		invariant(
			project.productionEnv[name] === undefined,
			`${phase}_production_provider_capability_${name}`
		);
		invariant(
			project.previewEnv[name] === undefined,
			`${phase}_preview_provider_capability_${name}`
		);
	}
}

/** @param {ReturnType<typeof validateProject>} project @param {string} phase */
function assertProductionProviderSecretsPresent(project, phase) {
	for (const name of PAID_PROVIDER_PAGES_SECRET_NAMES) {
		invariant(
			record(project.productionEnv[name])?.type === 'secret_text',
			`${phase}_production_secret_binding_${name}`
		);
		invariant(
			project.previewEnv[name] === undefined,
			`${phase}_preview_provider_capability_${name}`
		);
	}
}

/** @param {unknown} rawDeployment @param {string} expectedId @param {string} phase */
function validateCanonicalDeployment(rawDeployment, expectedId, phase) {
	const envelope = record(rawDeployment);
	const deployment = record(envelope?.result);
	invariant(envelope?.success === true && deployment, `${phase}_deployment_envelope`);
	invariant(
		deployment.id === expectedId && deployment.environment === 'production',
		`${phase}_deployment_identity`
	);
	const envVars = record(deployment.env_vars);
	invariant(envVars, `${phase}_deployment_env_vars`);
	return envVars;
}

/**
 * @param {{accountId:string|undefined,apiToken:string|undefined,fetchFn?:typeof fetch}} input
 */
function createPagesApi({ accountId, apiToken, fetchFn = fetch }) {
	invariant(
		typeof accountId === 'string' && /^[a-f0-9]{32}$/u.test(accountId),
		'cloudflare_account_id'
	);
	invariant(typeof apiToken === 'string' && apiToken.length >= 20, 'cloudflare_api_token');
	const projectEndpoint = `${CLOUDFLARE_API_ORIGIN}/client/v4/accounts/${accountId}/pages/projects/${PAID_PROVIDER_PAGES_PROJECT}`;
	const headers = {
		Accept: 'application/json',
		Authorization: `Bearer ${apiToken}`
	};
	/** @param {string} endpoint @param {'GET'|'PATCH'} method @param {unknown} [body] */
	const request = async (endpoint, method, body) => {
		invariant(
			endpoint === projectEndpoint || endpoint.startsWith(`${projectEndpoint}/deployments/`),
			'cloudflare_endpoint'
		);
		const response = await fetchFn(endpoint, {
			body: body === undefined ? undefined : JSON.stringify(body),
			headers: body === undefined ? headers : { ...headers, 'Content-Type': 'application/json' },
			method,
			redirect: 'error',
			signal: AbortSignal.timeout(30_000)
		});
		invariant(response.ok, `cloudflare_${method.toLowerCase()}_http_${response.status}`);
		return readBoundedResponseJson(
			response,
			`Cloudflare Pages provider-secret ${method}`,
			RESPONSE_MAX_BYTES
		);
	};
	return { projectEndpoint, request };
}

/** @param {Record<string,{accountId:string,credential:string}>} bindings */
function credentialsFromBindings(bindings) {
	const credentials = {
		EXA_API_KEY: bindings?.exa?.credential,
		FIRECRAWL_API_KEY: bindings?.firecrawl?.credential,
		GEMINI_API_KEY: bindings?.gemini?.credential,
		GROQ_API_KEY: bindings?.groq?.credential
	};
	for (const [name, credential] of Object.entries(credentials)) {
		invariant(
			typeof credential === 'string' && credential.length >= 16 && credential.length <= 4096,
			`credential_${name}`
		);
	}
	return /** @type {Record<string,string>} */ (credentials);
}

/**
 * Prove both Pages project environments have no inheritable provider secret.
 * This gate is required before every containment deployment and before staging.
 * @param {{accountId:string|undefined,apiToken:string|undefined,fetchFn?:typeof fetch}} input
 */
export async function assertPaidProviderPagesSecretsAbsent(input) {
	const { projectEndpoint, request } = createPagesApi(input);
	const project = validateProject(await request(projectEndpoint, 'GET'), 'absence');
	assertProjectProviderSecretsAbsent(project, 'absence');
	return {
		environment: 'production-and-preview',
		project: PAID_PROVIDER_PAGES_PROJECT,
		secretBindingsAbsent: [...PAID_PROVIDER_PAGES_SECRET_NAMES]
	};
}

/**
 * Delete all four project defaults from production and preview using pinned
 * Wrangler's exact environment-specific null-delete PATCH shape. A
 * transport/HTTP ambiguity is reconciled by a bounded GET and at most one
 * retry of each idempotent null-delete. The active immutable deployment and
 * every non-provider project setting must remain byte-for-byte equivalent.
 *
 * @param {{accountId:string|undefined,apiToken:string|undefined,expectedDeploymentId?:string,fetchFn?:typeof fetch}} input
 */
export async function clearPaidProviderPagesSecrets({
	accountId,
	apiToken,
	expectedDeploymentId,
	fetchFn = fetch
}) {
	if (expectedDeploymentId !== undefined) {
		invariant(DEPLOYMENT_ID_PATTERN.test(expectedDeploymentId), 'expected_deployment_id');
	}
	const { projectEndpoint, request } = createPagesApi({ accountId, apiToken, fetchFn });
	const before = validateProject(await request(projectEndpoint, 'GET'), 'clear_before');
	if (expectedDeploymentId !== undefined) {
		invariant(
			before.canonicalDeploymentId === expectedDeploymentId,
			'expected_deployment_not_canonical_before_clear'
		);
	}
	const canonicalDeploymentEndpoint = `${projectEndpoint}/deployments/${before.canonicalDeploymentId}`;
	const liveBefore = validateCanonicalDeployment(
		await request(canonicalDeploymentEndpoint, 'GET'),
		before.canonicalDeploymentId,
		'clear_before'
	);
	let current = before;
	let deleteAttempts = 0;
	/** @type {unknown[]} */
	const patchErrors = [];
	const allEnvironmentsAreAbsent = () =>
		PAID_PROVIDER_PAGES_SECRET_NAMES.every(
			(name) => current.productionEnv[name] === undefined && current.previewEnv[name] === undefined
		);

	while (!allEnvironmentsAreAbsent() && deleteAttempts < 2) {
		deleteAttempts += 1;
		for (const environment of /** @type {const} */ (['production', 'preview'])) {
			const envVars = environment === 'production' ? current.productionEnv : current.previewEnv;
			if (PAID_PROVIDER_PAGES_SECRET_NAMES.every((name) => envVars[name] === undefined)) continue;
			const patch = {
				deployment_configs: {
					[environment]: {
						env_vars: Object.fromEntries(
							PAID_PROVIDER_PAGES_SECRET_NAMES.map((name) => [name, null])
						),
						wrangler_config_hash:
							environment === 'production'
								? current.productionWranglerConfigHash
								: current.previewWranglerConfigHash
					}
				}
			};
			try {
				const envelope = await request(projectEndpoint, 'PATCH', patch);
				invariant(
					record(envelope)?.success === true,
					`clear_patch_${deleteAttempts}_${environment}_envelope`
				);
			} catch (error) {
				patchErrors.push(error);
			}
		}

		let reconcileError;
		for (let getAttempt = 0; getAttempt < 2; getAttempt += 1) {
			try {
				current = validateProject(
					await request(projectEndpoint, 'GET'),
					`clear_reconcile_${deleteAttempts}_${getAttempt + 1}`
				);
				reconcileError = undefined;
				break;
			} catch (error) {
				reconcileError = error;
			}
		}
		if (reconcileError) {
			throw new AggregateError(
				[...patchErrors, reconcileError],
				'PAID_PROVIDER_PAGES_SECRETS_INVALID:clear_reconciliation_unavailable'
			);
		}
	}

	if (!allEnvironmentsAreAbsent()) {
		throw new AggregateError(
			patchErrors,
			'PAID_PROVIDER_PAGES_SECRETS_INVALID:clear_reconciliation_exhausted'
		);
	}
	assertProjectProviderSecretsAbsent(current, 'clear_after');
	invariant(
		current.canonicalDeploymentId === before.canonicalDeploymentId,
		'canonical_deployment_changed_during_clear'
	);
	invariant(
		canonicalProviderPostureJson(withoutProviderSecrets(current.preview)) ===
			canonicalProviderPostureJson(withoutProviderSecrets(before.preview)),
		'non_provider_preview_config_changed_during_clear'
	);
	invariant(
		canonicalProviderPostureJson(withoutProviderSecrets(current.production)) ===
			canonicalProviderPostureJson(withoutProviderSecrets(before.production)),
		'non_provider_production_config_changed_during_clear'
	);
	const liveAfter = validateCanonicalDeployment(
		await request(canonicalDeploymentEndpoint, 'GET'),
		before.canonicalDeploymentId,
		'clear_after'
	);
	invariant(
		canonicalProviderPostureJson(liveAfter) === canonicalProviderPostureJson(liveBefore),
		'active_deployment_bindings_changed_during_clear'
	);
	if (expectedDeploymentId !== undefined) {
		for (const name of PAID_PROVIDER_PAGES_SECRET_NAMES) {
			invariant(
				record(liveAfter[name])?.type === 'secret_text',
				`cleared_project_created_deployment_secret_binding_${name}`
			);
		}
	}
	return {
		deleteAttempts,
		environment: 'production-and-preview',
		project: PAID_PROVIDER_PAGES_PROJECT,
		secretBindingsAbsent: [...PAID_PROVIDER_PAGES_SECRET_NAMES],
		verifiedDeploymentId: expectedDeploymentId ?? null
	};
}

/**
 * Ephemerally update only the production deployment-config secret bindings.
 * The project must begin clean in both environments. Any failure after the
 * PATCH is attempted invokes the idempotent cleanup/reconciliation path before
 * the staging error is returned.
 *
 * @param {{accountId:string|undefined,apiToken:string|undefined,bindings:Record<string,{accountId:string,credential:string}>,fetchFn?:typeof fetch}} input
 */
export async function materializePaidProviderPagesSecrets({
	accountId,
	apiToken,
	bindings,
	fetchFn = fetch
}) {
	const credentials = credentialsFromBindings(bindings);
	const { projectEndpoint, request } = createPagesApi({ accountId, apiToken, fetchFn });
	const before = validateProject(await request(projectEndpoint, 'GET'), 'stage_before');
	assertProjectProviderSecretsAbsent(before, 'stage_before');
	const canonicalDeploymentEndpoint = `${projectEndpoint}/deployments/${before.canonicalDeploymentId}`;
	const liveBefore = validateCanonicalDeployment(
		await request(canonicalDeploymentEndpoint, 'GET'),
		before.canonicalDeploymentId,
		'stage_before'
	);
	const patch = {
		deployment_configs: {
			production: {
				env_vars: Object.fromEntries(
					Object.entries(credentials).map(([name, value]) => [name, { type: 'secret_text', value }])
				),
				wrangler_config_hash: before.productionWranglerConfigHash
			}
		}
	};
	let patchAttempted = false;
	try {
		patchAttempted = true;
		const patchEnvelope = await request(projectEndpoint, 'PATCH', patch);
		invariant(record(patchEnvelope)?.success === true, 'stage_patch_envelope');
		const after = validateProject(await request(projectEndpoint, 'GET'), 'stage_after');
		assertProductionProviderSecretsPresent(after, 'stage_after');
		invariant(
			after.canonicalDeploymentId === before.canonicalDeploymentId,
			'canonical_deployment_changed_during_stage'
		);
		const liveAfter = validateCanonicalDeployment(
			await request(canonicalDeploymentEndpoint, 'GET'),
			before.canonicalDeploymentId,
			'stage_after'
		);
		invariant(
			canonicalProviderPostureJson(liveAfter) === canonicalProviderPostureJson(liveBefore),
			'active_deployment_bindings_changed_during_stage'
		);
		invariant(
			canonicalProviderPostureJson(after.preview) === canonicalProviderPostureJson(before.preview),
			'preview_config_changed_during_stage'
		);
		invariant(
			canonicalProviderPostureJson(withoutProviderSecrets(after.production)) ===
				canonicalProviderPostureJson(withoutProviderSecrets(before.production)),
			'non_provider_production_config_changed_during_stage'
		);
		return {
			baselineDeploymentId: before.canonicalDeploymentId,
			environment: 'production',
			project: PAID_PROVIDER_PAGES_PROJECT,
			secretBindings: [...PAID_PROVIDER_PAGES_SECRET_NAMES]
		};
	} catch (stageError) {
		if (!patchAttempted) throw stageError;
		try {
			await clearPaidProviderPagesSecrets({ accountId, apiToken, fetchFn });
		} catch (cleanupError) {
			throw new AggregateError(
				[stageError, cleanupError],
				'PAID_PROVIDER_PAGES_SECRETS_INVALID:stage_failed_and_cleanup_incomplete'
			);
		}
		throw stageError;
	}
}

/**
 * Prove the newly created immutable production deployment captured all four
 * secret bindings. Values remain intentionally unreadable; exact-value
 * authority comes from the immediately preceding verified PATCH inputs.
 * @param {{accountId:string|undefined,apiToken:string|undefined,deploymentId:string,fetchFn?:typeof fetch}} input
 */
export async function verifyPaidProviderPagesDeploymentBindings({
	accountId,
	apiToken,
	deploymentId,
	fetchFn = fetch
}) {
	invariant(
		typeof deploymentId === 'string' && DEPLOYMENT_ID_PATTERN.test(deploymentId),
		'deployment_id'
	);
	const { projectEndpoint, request } = createPagesApi({ accountId, apiToken, fetchFn });
	const endpoint = `${projectEndpoint}/deployments/${deploymentId}`;
	const envVars = validateCanonicalDeployment(
		await request(endpoint, 'GET'),
		deploymentId,
		'created'
	);
	for (const name of PAID_PROVIDER_PAGES_SECRET_NAMES) {
		invariant(
			record(envVars[name])?.type === 'secret_text',
			`created_deployment_secret_binding_${name}`
		);
	}
	return {
		deploymentId,
		environment: 'production',
		project: PAID_PROVIDER_PAGES_PROJECT,
		secretBindings: [...PAID_PROVIDER_PAGES_SECRET_NAMES]
	};
}

const isMain =
	process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
	try {
		if (process.argv.length === 2 || (process.argv.length === 3 && process.argv[2] === 'stage')) {
			const result = await materializePaidProviderPagesSecrets({
				accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
				apiToken: process.env.CLOUDFLARE_API_TOKEN,
				bindings: readProviderPostureBindingsFromEnvironment(process.env)
			});
			console.log(
				`Ephemerally staged ${result.secretBindings.length} exact production provider secret bindings for ${result.project}; baseline deployment=${result.baselineDeploymentId}.`
			);
		} else if (process.argv.length === 3 && process.argv[2] === 'assert-absent') {
			const result = await assertPaidProviderPagesSecretsAbsent({
				accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
				apiToken: process.env.CLOUDFLARE_API_TOKEN
			});
			console.log(
				`Verified ${result.secretBindingsAbsent.length} provider project defaults are absent from production and preview.`
			);
		} else if (
			(process.argv.length === 3 || process.argv.length === 4) &&
			process.argv[2] === 'clear-staged'
		) {
			const result = await clearPaidProviderPagesSecrets({
				accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
				apiToken: process.env.CLOUDFLARE_API_TOKEN,
				expectedDeploymentId: process.argv[3]
			});
			console.log(
				`Cleared and reconciled ${result.secretBindingsAbsent.length} provider project defaults from production and preview; delete attempts=${result.deleteAttempts}.`
			);
		} else if (
			process.argv.length === 4 &&
			process.argv[2] === 'verify-deployment' &&
			process.argv[3]
		) {
			const result = await verifyPaidProviderPagesDeploymentBindings({
				accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
				apiToken: process.env.CLOUDFLARE_API_TOKEN,
				deploymentId: process.argv[3]
			});
			console.log(
				`Verified ${result.secretBindings.length} production provider secret bindings on immutable Pages deployment ${result.deploymentId}.`
			);
		} else {
			throw new Error('PAID_PROVIDER_PAGES_SECRETS_INVALID:cli_arguments');
		}
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
