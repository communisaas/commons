#!/usr/bin/env node

import { pathToFileURL } from 'node:url';
import { readBoundedResponseJson } from '../src/lib/server/bounded-response.mjs';
import {
	PAGES_FINALIZER_COMPATIBILITY_DATE,
	PAGES_FINALIZER_COMPATIBILITY_FLAGS
} from './finalize-pages-release-artifact.mjs';

export const PUBLIC_DISCOVERY_GATE_BINDING = 'PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE';
export const CONVEX_WORK_BUDGET_BINDING = 'CONVEX_WORK_BUDGET';
export const PUBLIC_DISCOVERY_GATE_CLASS = 'PublicDiscoveryManifestRefreshGate';
export const PUBLIC_DISCOVERY_GATE_WORKER = 'commons-public-discovery-manifest-gate';
/** @type {Readonly<Record<'production'|'preview', string>>} */
export const PUBLIC_DISCOVERY_GATE_WORKERS = Object.freeze({
	production: PUBLIC_DISCOVERY_GATE_WORKER,
	preview: 'commons-public-discovery-manifest-gate-nonprod'
});
/** @type {Readonly<Record<'production'|'preview', Readonly<{host:string;realm:string}>>>} */
export const PUBLIC_DISCOVERY_GATE_CONFIGURATIONS = Object.freeze({
	production: Object.freeze({
		host: 'release-control.commons.email',
		realm: 'https://quirky-chinchilla-352.convex.cloud'
	}),
	preview: Object.freeze({
		host: 'release-control-staging.commons.email',
		realm: 'https://outstanding-firefly-831.convex.cloud'
	})
});
/** @type {Readonly<Record<'production'|'preview', string>>} */
export const PUBLIC_DISCOVERY_R2_BUCKETS = Object.freeze({
	production: 'commons-public-discovery-cache',
	preview: 'commons-public-discovery-cache-nonprod'
});
export const PUBLIC_TEMPLATE_OG_QUEUE_BINDING = 'PUBLIC_TEMPLATE_OG_QUEUE';
export const RELEASE_TRANSACTION_BINDING = 'PUBLIC_RELEASE_TRANSACTION_ID';
export const RELEASE_PROBE_SECRET_BINDING = 'RELEASE_PROBE_SECRET';
export const INTERNAL_API_SECRET_BINDINGS = Object.freeze([
	'INTERNAL_API_SECRET',
	'INTERNAL_API_SECRET_PREVIOUS'
]);
export const PAID_PROVIDER_RUNTIME_SECRET_BINDINGS = Object.freeze([
	'EXA_API_KEY',
	'FIRECRAWL_API_KEY',
	'GEMINI_API_KEY',
	'GROQ_API_KEY'
]);
export const PAID_PROVIDER_OPERATOR_BINDING = 'PAID_PROVIDER_OPERATOR_USER_IDS';
export const PREVIEW_BUILD_SAFE_PLAIN_TEXT_BINDINGS = Object.freeze([
	'ATLAS_BASE_URL',
	'EXPECTED_CELL_MAP_DEPTH',
	'EXPECTED_CELL_MAP_ROOT',
	'PUBLIC_CONVEX_URL',
	'PUBLIC_SCROLL_RPC_URL',
	RELEASE_TRANSACTION_BINDING,
	'VITE_ATLAS_BASE_URL'
]);
export const PUBLIC_TEMPLATE_OG_QUEUES = Object.freeze({
	production: 'commons-public-template-og',
	preview: 'commons-public-template-og-nonprod'
});
/** @type {Readonly<Record<'production'|'preview', Readonly<Record<string, string>>>>} */
export const PAGES_KV_NAMESPACE_IDS = Object.freeze({
	production: Object.freeze({
		DC_SESSION_KV: 'a76f18d2c07042bc856a30038af05ab8',
		REJECTION_MONITOR_KV: '7e394f2a84174949b5b51c534c3a4976',
		VICAL_KV: 'c59a1c7ec019425095b848a054f0b252',
		REGISTRATION_RETRY_KV: '90772b3f79d945d5b5f0df3d6d2ca732'
	}),
	preview: Object.freeze({
		DC_SESSION_KV: '93471f3e763c4c4f85404fa288dc56e1',
		REJECTION_MONITOR_KV: '78f28254453d4ecf87a54796326bef71',
		VICAL_KV: 'cfd3e3ddc4cc405dbdbc5ecfe2721e50',
		REGISTRATION_RETRY_KV: '741d9c87ce424a33a33c29ddfcfac0ca'
	})
});

const FORBIDDEN_NORMAL_BINDING_KEYS = Object.freeze([
	'ai_bindings',
	'analytics_engine_datasets',
	'browser_bindings',
	'd1_databases',
	'hyperdrive_bindings',
	'mtls_certificates',
	'pipelines',
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
 * The trusted finalizer compiles for this exact runtime, and the Pages project
 * must execute the uploaded bytes under the same date/flag tuple. In
 * particular, global fetch must never regain same-zone service-binding
 * semantics around the Access-protected origin boundary.
 * @param {Record<string, any>} config
 * @param {'preview'|'production'} environment
 */
export function validatePagesRuntimeCompatibility(config, environment) {
	invariant(
		config.compatibility_date === PAGES_FINALIZER_COMPATIBILITY_DATE,
		`Pages ${environment} compatibility date is not the trusted finalizer date.`
	);
	const flags = config.compatibility_flags;
	invariant(
		Array.isArray(flags) &&
			flags.every((flag) => typeof flag === 'string') &&
			new Set(flags).size === flags.length &&
			JSON.stringify([...flags].sort()) ===
				JSON.stringify([...PAGES_FINALIZER_COMPATIBILITY_FLAGS].sort()),
		`Pages ${environment} compatibility flags are not exact.`
	);
	return {
		compatibilityDate: PAGES_FINALIZER_COMPATIBILITY_DATE,
		compatibilityFlags: [...PAGES_FINALIZER_COMPATIBILITY_FLAGS]
	};
}

/** @param {unknown} value @param {string} label */
function requireCredentialFreeHttpsUrl(value, label) {
	invariant(typeof value === 'string' && value.length > 0, `${label} is missing.`);
	let url;
	try {
		url = new URL(value);
	} catch {
		throw new Error(`${label} is not an absolute URL.`);
	}
	invariant(
		url.protocol === 'https:' && url.username === '' && url.password === '',
		`${label} must be credential-free HTTPS.`
	);
}

/**
 * The candidate staging Pages deployment is a byte-identity/probe target, not
 * an application realm. It receives no storage, service, queue, coordination,
 * session, provider, refresh, or internal-control capability.
 * @param {{config: Record<string, any>, expectedTransactionId: string}} input
 */
export function validateInertPagesPreview({ config, expectedTransactionId }) {
	validatePagesRuntimeCompatibility(config, 'preview');
	invariant(config.fail_open === false, 'Pages preview must fail closed on runtime errors.');
	const envVars = record(config.env_vars);
	invariant(envVars !== null, 'Pages preview env_vars are missing.');
	const expectedNames = [...PREVIEW_BUILD_SAFE_PLAIN_TEXT_BINDINGS];
	invariant(
		JSON.stringify(Object.keys(envVars).sort()) === JSON.stringify([...expectedNames].sort()),
		'Pages preview env_vars are not the exact inert probe allowlist.'
	);
	for (const name of PREVIEW_BUILD_SAFE_PLAIN_TEXT_BINDINGS) {
		const binding = record(envVars[name]);
		invariant(binding?.type === 'plain_text', `Pages preview ${name} must be plain text.`);
	}
	invariant(
		record(envVars[RELEASE_TRANSACTION_BINDING])?.value === expectedTransactionId,
		'Pages preview release transaction binding is not exact.'
	);
	invariant(
		envVars[RELEASE_PROBE_SECRET_BINDING] === undefined,
		'Pages preview must not receive the trusted-edge release-probe capability.'
	);
	requireCredentialFreeHttpsUrl(
		record(envVars.PUBLIC_CONVEX_URL)?.value,
		'Pages preview PUBLIC_CONVEX_URL'
	);
	requireCredentialFreeHttpsUrl(
		record(envVars.PUBLIC_SCROLL_RPC_URL)?.value,
		'Pages preview PUBLIC_SCROLL_RPC_URL'
	);
	requireCredentialFreeHttpsUrl(
		record(envVars.ATLAS_BASE_URL)?.value,
		'Pages preview ATLAS_BASE_URL'
	);
	requireCredentialFreeHttpsUrl(
		record(envVars.VITE_ATLAS_BASE_URL)?.value,
		'Pages preview VITE_ATLAS_BASE_URL'
	);
	invariant(
		/^0x[0-9a-f]{64}$/u.test(record(envVars.EXPECTED_CELL_MAP_ROOT)?.value),
		'Pages preview EXPECTED_CELL_MAP_ROOT is invalid.'
	);
	invariant(
		/^[1-9][0-9]{0,2}$/u.test(record(envVars.EXPECTED_CELL_MAP_DEPTH)?.value),
		'Pages preview EXPECTED_CELL_MAP_DEPTH is invalid.'
	);

	for (const key of [
		...FORBIDDEN_NORMAL_BINDING_KEYS,
		'durable_object_namespaces',
		'kv_namespaces',
		'queue_producers',
		'r2_buckets'
	]) {
		invariant(
			bindingCollectionIsEmpty(config[key]),
			`Pages preview inert probe must have no ${key} bindings.`
		);
	}
	return {
		environment: 'preview',
		failOpen: false,
		inert: true,
		releaseProbeSecretBound: false,
		releaseTransactionId: expectedTransactionId
	};
}

/**
 * Compare Worker configuration only; this never instantiates an object or
 * spends a Durable Object request.
 * @param {{workerSettingsByEnvironment: Partial<Record<'preview'|'production', unknown>>, workerSubdomainByEnvironment: Partial<Record<'preview'|'production', unknown>>, realms: readonly ('preview'|'production')[]}} input
 */
export function validatePublicDiscoveryGateWorkers({
	workerSettingsByEnvironment,
	workerSubdomainByEnvironment,
	realms
}) {
	invariant(realms.length > 0, 'At least one gate Worker realm is required.');
	invariant(
		new Set(realms).size === realms.length &&
			realms.every((realm) => realm === 'preview' || realm === 'production'),
		'Gate Worker realms must be unique production/preview values.'
	);
	/** @type {Partial<Record<'preview'|'production', string>>} */
	const namespaceIds = {};
	for (const realm of realms) {
		const expected = PUBLIC_DISCOVERY_GATE_CONFIGURATIONS[realm];
		const workerResult = record(record(workerSettingsByEnvironment[realm])?.result);
		const bindings = workerResult?.bindings;
		invariant(Array.isArray(bindings), `Gate Worker ${realm} settings have no bindings array.`);
		const workerMatches = bindings.filter(
			(binding) =>
				record(binding)?.name === PUBLIC_DISCOVERY_GATE_BINDING &&
				binding.type === 'durable_object_namespace'
		);
		invariant(
			workerMatches.length === 1,
			`Gate Worker ${realm} must expose exactly one refresh namespace.`
		);
		const bindingsByName = new Map(
			bindings.map((binding) => [record(binding)?.name, record(binding)])
		);
		invariant(
			bindingsByName.size === bindings.length,
			`Gate Worker ${realm} binding names must be unique.`
		);
		const expectedBindingNames = [
			PUBLIC_DISCOVERY_GATE_BINDING,
			'RELEASE_AUTHORITY_HOST',
			'RELEASE_AUTHORITY_REALM',
			'RELEASE_CONTROL_SECRET'
		];
		const previous = bindingsByName.get('RELEASE_CONTROL_SECRET_PREVIOUS');
		if (previous !== undefined) expectedBindingNames.push('RELEASE_CONTROL_SECRET_PREVIOUS');
		invariant(
			JSON.stringify([...bindingsByName.keys()].sort()) ===
				JSON.stringify(expectedBindingNames.sort()),
			`Gate Worker ${realm} binding set is not the exact release-authority allowlist.`
		);
		const workerBinding = workerMatches[0];
		invariant(
			workerBinding.class_name === PUBLIC_DISCOVERY_GATE_CLASS,
			`Gate Worker ${realm} namespace class does not match the committed protocol.`
		);
		invariant(
			typeof workerBinding.namespace_id === 'string' && workerBinding.namespace_id.length > 0,
			`Gate Worker ${realm} namespace id is missing.`
		);
		invariant(
			bindingsByName.get('RELEASE_AUTHORITY_HOST')?.type === 'plain_text' &&
				bindingsByName.get('RELEASE_AUTHORITY_HOST')?.text === expected.host,
			`Gate Worker ${realm} release-authority host is not exact.`
		);
		invariant(
			bindingsByName.get('RELEASE_AUTHORITY_REALM')?.type === 'plain_text' &&
				bindingsByName.get('RELEASE_AUTHORITY_REALM')?.text === expected.realm,
			`Gate Worker ${realm} release-authority realm is not exact.`
		);
		invariant(
			bindingsByName.get('RELEASE_CONTROL_SECRET')?.type === 'secret_text',
			`Gate Worker ${realm} active release-control secret is missing.`
		);
		invariant(
			previous === undefined || previous?.type === 'secret_text',
			`Gate Worker ${realm} previous release-control secret has the wrong type.`
		);
		namespaceIds[realm] = workerBinding.namespace_id;

		const subdomain = record(record(workerSubdomainByEnvironment[realm])?.result);
		invariant(
			subdomain?.enabled === false && subdomain?.previews_enabled === false,
			`Gate Worker ${realm} must disable workers.dev and version preview URLs.`
		);
	}
	if (realms.includes('production') && realms.includes('preview')) {
		invariant(
			namespaceIds.production !== namespaceIds.preview,
			'Production and preview refresh gates must use distinct Durable Object namespaces.'
		);
	}
	return namespaceIds;
}

/**
 * Prove the complete custom-domain attachment for every selected gate Worker.
 * Unrelated Workers may own other domains, but neither the selected service nor
 * its authority hostname may appear in any additional/crossed mapping.
 * @param {{customDomains:unknown;realms:readonly ('preview'|'production')[]}} input
 */
export function validatePublicDiscoveryGateCustomDomains({ customDomains, realms }) {
	const envelope = record(customDomains);
	const rows = envelope?.result;
	invariant(
		envelope?.success === true && Array.isArray(rows),
		'Worker custom domains are malformed.'
	);
	const info = record(envelope?.result_info);
	if (info !== null) {
		invariant(
			(info.total_count === undefined || info.total_count === rows.length) &&
				(info.total_pages === undefined || info.total_pages === 1),
			'Worker custom-domain inventory is incomplete.'
		);
	}
	for (const realm of realms) {
		const service = PUBLIC_DISCOVERY_GATE_WORKERS[realm];
		const host = PUBLIC_DISCOVERY_GATE_CONFIGURATIONS[realm].host;
		const relevant = rows.filter((row) => {
			const candidate = record(row);
			return candidate?.service === service || candidate?.hostname === host;
		});
		invariant(
			relevant.length === 1 &&
				record(relevant[0])?.service === service &&
				record(relevant[0])?.hostname === host &&
				record(relevant[0])?.zone_name === 'commons.email',
			`Gate Worker ${realm} custom-domain attachment is not exact.`
		);
	}
	return Object.fromEntries(
		realms.map((realm) => [realm, PUBLIC_DISCOVERY_GATE_CONFIGURATIONS[realm].host])
	);
}

/**
 * Compare configuration only; this never instantiates an object or spends a DO
 * request. Preview publication proves only the isolated preview realm. A
 * production publication also proves preview because the production cron writes
 * both realms and therefore requires preview to have been restored first.
 * @param {{workerSettingsByEnvironment: Partial<Record<'preview'|'production', unknown>>, workerSubdomainByEnvironment: Partial<Record<'preview'|'production', unknown>>, pagesProject: unknown, pagesDeployment?:unknown, deploymentId?:string, environment: 'preview'|'production',expectedTransactionId:string}} input
 */
export function validatePagesDurableObjectBinding({
	workerSettingsByEnvironment,
	workerSubdomainByEnvironment,
	pagesProject,
	pagesDeployment,
	deploymentId,
	environment,
	expectedTransactionId
}) {
	invariant(
		environment === 'preview' || environment === 'production',
		'Invalid Pages environment.'
	);
	invariant(
		/^[1-9][0-9]{0,19}-[1-9][0-9]{0,9}$/u.test(expectedTransactionId),
		'Expected Pages release transaction is invalid.'
	);
	const pagesResult = record(record(pagesProject)?.result);
	const configs = record(pagesResult?.deployment_configs);
	invariant(configs !== null, 'Pages project has no deployment configs.');
	const previewConfig = record(configs.preview);
	invariant(previewConfig !== null, 'Pages preview deployment config is missing.');
	const previewProof = validateInertPagesPreview({
		config: previewConfig,
		expectedTransactionId
	});
	if (environment === 'preview') return previewProof;

	const realms = /** @type {const} */ (['production']);
	const namespaceIds = validatePublicDiscoveryGateWorkers({
		workerSettingsByEnvironment,
		workerSubdomainByEnvironment,
		realms
	});
	for (const realm of realms) {
		const workerResult = record(record(workerSettingsByEnvironment[realm])?.result);
		const workerBinding = workerResult?.bindings?.[0];

		const config = record(configs[realm]);
		invariant(config !== null, `Pages ${realm} deployment config is missing.`);
		validatePagesRuntimeCompatibility(config, realm);
		invariant(config?.fail_open === false, `Pages ${realm} must fail closed on runtime errors.`);
		const envVars = record(config?.env_vars);
		invariant(envVars !== null, `Pages ${realm} env_vars are missing.`);
		const transactionBinding = record(envVars[RELEASE_TRANSACTION_BINDING]);
		invariant(
			transactionBinding?.type === 'plain_text' &&
				transactionBinding.value === expectedTransactionId,
			`Pages ${realm} release transaction binding is not exact.`
		);
		for (const secretName of INTERNAL_API_SECRET_BINDINGS) {
			invariant(
				record(envVars[secretName])?.type === 'secret_text',
				`Pages ${realm} ${secretName} must be an encrypted secret binding.`
			);
		}
		for (const secretName of PAID_PROVIDER_RUNTIME_SECRET_BINDINGS) {
			invariant(
				envVars[secretName] === undefined,
				`Pages ${realm} project defaults must not retain paid-provider credential ${secretName}.`
			);
		}
		invariant(
			record(envVars[PAID_PROVIDER_OPERATOR_BINDING])?.type === 'secret_text',
			`Pages ${realm} paid-provider operator allowlist must be an encrypted secret binding.`
		);
		invariant(
			typeof deploymentId === 'string' &&
				/^([a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/u.test(
					deploymentId
				),
			'Exact immutable production Pages deployment id is required.'
		);
		const immutableDeployment = record(record(pagesDeployment)?.result);
		invariant(
			immutableDeployment?.id === deploymentId && immutableDeployment.environment === 'production',
			'Paid-provider binding proof is not the exact immutable production deployment.'
		);
		const immutableEnvVars = record(immutableDeployment.env_vars);
		invariant(
			immutableEnvVars !== null,
			'Immutable production Pages deployment env_vars are missing.'
		);
		for (const secretName of PAID_PROVIDER_RUNTIME_SECRET_BINDINGS) {
			invariant(
				record(immutableEnvVars[secretName])?.type === 'secret_text',
				`Immutable production Pages paid-provider ${secretName} must be encrypted.`
			);
		}
		invariant(
			record(immutableEnvVars[PAID_PROVIDER_OPERATOR_BINDING])?.type === 'secret_text',
			'Immutable production Pages paid-provider operator allowlist must be encrypted.'
		);
		invariant(
			envVars[RELEASE_PROBE_SECRET_BINDING] === undefined,
			`Pages ${realm} must not retain the staging release-probe capability.`
		);
		for (const name of Object.keys(envVars)) {
			invariant(
				!name.startsWith('RELEASE_CONTROL'),
				`Pages ${realm} must not receive release-control capability ${name}.`
			);
			invariant(
				!name.startsWith('INTERNAL_API_SECRET') || INTERNAL_API_SECRET_BINDINGS.includes(name),
				`Pages ${realm} has an uncommitted internal API capability ${name}.`
			);
		}
		const namespaces = record(config?.durable_object_namespaces);
		const pagesBinding = record(namespaces?.[PUBLIC_DISCOVERY_GATE_BINDING]);
		invariant(pagesBinding !== null, `Pages ${realm} refresh gate binding is missing.`);
		const workBudgetBinding = record(namespaces?.[CONVEX_WORK_BUDGET_BINDING]);
		invariant(workBudgetBinding !== null, `Pages ${realm} Convex work budget binding is missing.`);
		invariant(
			typeof workBudgetBinding.namespace_id === 'string' &&
				workBudgetBinding.namespace_id.length > 0,
			`Pages ${realm} Convex work budget namespace id is missing.`
		);
		invariant(
			JSON.stringify(Object.keys(namespaces ?? {}).sort()) ===
				JSON.stringify([CONVEX_WORK_BUDGET_BINDING, PUBLIC_DISCOVERY_GATE_BINDING].sort()),
			`Pages ${realm} must expose exactly the refresh and Convex work-budget bindings.`
		);
		invariant(
			pagesBinding.namespace_id === workerBinding.namespace_id,
			`Pages ${realm} refresh gate namespace does not match its deployed gate Worker.`
		);
		invariant(
			workBudgetBinding.namespace_id !== pagesBinding.namespace_id,
			`Pages ${realm} refresh and work-budget namespaces must be distinct.`
		);

		const r2Buckets = record(config?.r2_buckets);
		const r2Binding = record(r2Buckets?.PUBLIC_DISCOVERY_R2);
		invariant(r2Binding !== null, `Pages ${realm} public-discovery R2 binding is missing.`);
		invariant(
			Object.keys(r2Buckets ?? {}).length === 1,
			`Pages ${realm} must expose only the public-discovery R2 binding.`
		);
		invariant(
			r2Binding.name === PUBLIC_DISCOVERY_R2_BUCKETS[realm],
			`Pages ${realm} public-discovery R2 bucket does not match its isolated realm.`
		);

		const kvNamespaces = record(config?.kv_namespaces);
		invariant(kvNamespaces !== null, `Pages ${realm} KV bindings are missing.`);
		const expectedKv = PAGES_KV_NAMESPACE_IDS[realm];
		invariant(
			JSON.stringify(Object.keys(kvNamespaces).sort()) ===
				JSON.stringify(Object.keys(expectedKv).sort()),
			`Pages ${realm} KV binding names are not the exact committed set.`
		);
		for (const [binding, namespaceId] of Object.entries(expectedKv)) {
			invariant(
				record(kvNamespaces[binding])?.namespace_id === namespaceId,
				`Pages ${realm} ${binding} namespace does not match its isolated realm.`
			);
		}

		const queueProducers = record(config?.queue_producers);
		const queueBinding = record(queueProducers?.[PUBLIC_TEMPLATE_OG_QUEUE_BINDING]);
		invariant(queueBinding !== null, `Pages ${realm} public-template OG Queue binding is missing.`);
		invariant(
			Object.keys(queueProducers ?? {}).length === 1,
			`Pages ${realm} must expose only the public-template OG Queue producer.`
		);
		invariant(
			queueBinding.name === PUBLIC_TEMPLATE_OG_QUEUES[realm],
			`Pages ${realm} public-template OG Queue does not match its isolated realm.`
		);

		for (const key of FORBIDDEN_NORMAL_BINDING_KEYS) {
			invariant(
				bindingCollectionIsEmpty(config?.[key]),
				`Pages ${realm} has an unexpected ${key} binding.`
			);
		}
	}
	invariant(
		PUBLIC_DISCOVERY_R2_BUCKETS.production !== PUBLIC_DISCOVERY_R2_BUCKETS.preview,
		'Production and preview R2 buckets must be distinct.'
	);
	return {
		binding: PUBLIC_DISCOVERY_GATE_BINDING,
		environment,
		namespaceId: namespaceIds[environment],
		workBudgetNamespaceId: record(record(configs[environment])?.durable_object_namespaces)?.[
			CONVEX_WORK_BUDGET_BINDING
		]?.namespace_id,
		r2Bucket: PUBLIC_DISCOVERY_R2_BUCKETS[environment],
		kvNamespaceIds: PAGES_KV_NAMESPACE_IDS[environment],
		queue: PUBLIC_TEMPLATE_OG_QUEUES[environment],
		worker: PUBLIC_DISCOVERY_GATE_WORKERS[environment],
		releaseTransactionId: expectedTransactionId,
		internalApiSecretBindings: INTERNAL_API_SECRET_BINDINGS,
		paidProviderDeploymentId: environment === 'production' ? deploymentId : undefined,
		paidProviderProjectDefaultsAbsent:
			environment === 'production' ? [...PAID_PROVIDER_RUNTIME_SECRET_BINDINGS] : [],
		previewInert: true,
		failOpen: false
	};
}

/** @param {string[]} argv @returns {{environment: 'preview'|'production',deploymentId?:string}} */
export function parsePagesBindingArgs(argv) {
	let environment;
	let deploymentId;
	for (let index = 0; index < argv.length; index += 1) {
		const flag = argv[index];
		invariant(flag === '--environment' || flag === '--deployment-id', `Unknown argument: ${flag}`);
		invariant(
			(flag === '--environment' && environment === undefined) ||
				(flag === '--deployment-id' && deploymentId === undefined),
			`${flag} may be supplied only once.`
		);
		const value = argv[index + 1];
		invariant(value !== undefined && !value.startsWith('--'), `${flag} needs a value.`);
		if (flag === '--environment') environment = value;
		else deploymentId = value;
		index += 1;
	}
	invariant(
		environment === 'preview' || environment === 'production',
		'--environment must be preview or production.'
	);
	if (environment === 'production') {
		invariant(
			typeof deploymentId === 'string' &&
				/^([a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/u.test(
					deploymentId
				),
			'Production requires one exact --deployment-id.'
		);
	} else invariant(deploymentId === undefined, 'Preview must not accept --deployment-id.');
	return {
		deploymentId,
		environment: /** @type {'preview'|'production'} */ (environment)
	};
}

/**
 * @param {{base: string, headers: Record<string, string>, realms: readonly ('preview'|'production')[], fetchFn: typeof fetch}} input
 */
async function fetchGateWorkerInputs({ base, headers, realms, fetchFn }) {
	const states = await Promise.all(
		realms.map(async (realm) => {
			const workerName = PUBLIC_DISCOVERY_GATE_WORKERS[realm];
			const [settings, subdomain] = await Promise.all([
				fetchFn(`${base}/workers/scripts/${workerName}/settings`, {
					headers,
					redirect: 'error',
					signal: AbortSignal.timeout(15_000)
				}),
				fetchFn(`${base}/workers/scripts/${workerName}/subdomain`, {
					headers,
					redirect: 'error',
					signal: AbortSignal.timeout(15_000)
				})
			]);
			invariant(settings.ok, `${realm} gate settings returned HTTP ${settings.status}.`);
			invariant(subdomain.ok, `${realm} gate subdomain returned HTTP ${subdomain.status}.`);
			return {
				realm,
				settings: await readBoundedResponseJson(settings, `${realm} gate settings response`),
				subdomain: await readBoundedResponseJson(subdomain, `${realm} gate subdomain response`)
			};
		})
	);
	/** @type {Partial<Record<'preview'|'production', unknown>>} */
	const workerSettingsByEnvironment = {};
	/** @type {Partial<Record<'preview'|'production', unknown>>} */
	const workerSubdomainByEnvironment = {};
	for (const state of states) {
		workerSettingsByEnvironment[state.realm] = state.settings;
		workerSubdomainByEnvironment[state.realm] = state.subdomain;
	}
	return { workerSettingsByEnvironment, workerSubdomainByEnvironment };
}

/**
 * @param {{accountId: string|undefined, apiToken: string|undefined, realms?: readonly ('preview'|'production')[], fetchFn?: typeof fetch}} options
 */
export async function verifyPublicDiscoveryGateWorkers({
	accountId,
	apiToken,
	realms = /** @type {const} */ (['production', 'preview']),
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
	const base = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}`;
	const headers = { Authorization: `Bearer ${apiToken}` };
	const [inputs, domainsResponse] = await Promise.all([
		fetchGateWorkerInputs({ base, headers, realms, fetchFn }),
		fetchFn(`${base}/workers/domains`, {
			headers,
			redirect: 'error',
			signal: AbortSignal.timeout(15_000)
		})
	]);
	invariant(domainsResponse.ok, `Worker custom domains returned HTTP ${domainsResponse.status}.`);
	const customDomains = await readBoundedResponseJson(
		domainsResponse,
		'Worker custom-domain response'
	);
	const namespaceIds = validatePublicDiscoveryGateWorkers({ ...inputs, realms });
	validatePublicDiscoveryGateCustomDomains({ customDomains, realms });
	return namespaceIds;
}

/** @param {{accountId: string|undefined, apiToken: string|undefined, deploymentId?:string, environment: 'preview'|'production',expectedTransactionId:string|undefined, fetchFn?: typeof fetch, pagesProject?: string}} options */
export async function verifyPagesDurableObjectBinding({
	accountId,
	apiToken,
	deploymentId,
	environment,
	expectedTransactionId,
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
	invariant(
		typeof expectedTransactionId === 'string',
		'PUBLIC_RELEASE_TRANSACTION_ID is required.'
	);
	const base = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}`;
	const headers = { Authorization: `Bearer ${apiToken}` };
	const realms =
		environment === 'production'
			? /** @type {const} */ (['production'])
			: /** @type {const} */ ([]);
	const [workerInputs, pagesResponse] = await Promise.all([
		fetchGateWorkerInputs({ base, headers, realms, fetchFn }),
		fetchFn(`${base}/pages/projects/${encodeURIComponent(pagesProject)}`, {
			headers,
			redirect: 'error',
			signal: AbortSignal.timeout(15_000)
		})
	]);
	invariant(pagesResponse.ok, `Pages project settings returned HTTP ${pagesResponse.status}.`);
	let pagesDeployment;
	if (environment === 'production') {
		invariant(
			typeof deploymentId === 'string' &&
				/^([a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/u.test(
					deploymentId
				),
			'Exact immutable production Pages deployment id is required.'
		);
		const deploymentResponse = await fetchFn(
			`${base}/pages/projects/${encodeURIComponent(pagesProject)}/deployments/${encodeURIComponent(deploymentId)}`,
			{
				headers,
				redirect: 'error',
				signal: AbortSignal.timeout(15_000)
			}
		);
		invariant(
			deploymentResponse.ok,
			`Pages immutable deployment returned HTTP ${deploymentResponse.status}.`
		);
		pagesDeployment = await readBoundedResponseJson(
			deploymentResponse,
			'Pages immutable deployment response'
		);
	}
	return validatePagesDurableObjectBinding({
		...workerInputs,
		deploymentId,
		pagesDeployment,
		pagesProject: await readBoundedResponseJson(pagesResponse, 'Pages project settings response'),
		environment,
		expectedTransactionId
	});
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
	try {
		const { deploymentId, environment } = parsePagesBindingArgs(process.argv.slice(2));
		const result = await verifyPagesDurableObjectBinding({
			accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
			apiToken: process.env.CLOUDFLARE_API_TOKEN,
			deploymentId,
			environment,
			expectedTransactionId: process.env.PUBLIC_RELEASE_TRANSACTION_ID
		});
		console.log(JSON.stringify(result));
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
