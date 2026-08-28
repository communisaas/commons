#!/usr/bin/env node

import { pathToFileURL } from 'node:url';
import { readBoundedResponseJson } from '../src/lib/server/bounded-response.mjs';
import {
	PAGES_KV_NAMESPACE_IDS,
	PUBLIC_DISCOVERY_R2_BUCKETS
} from './verify-pages-durable-object-binding.mjs';

export const PUBLIC_DISCOVERY_BUCKET = PUBLIC_DISCOVERY_R2_BUCKETS.production;
export const PUBLIC_DISCOVERY_NONPROD_BUCKET = PUBLIC_DISCOVERY_R2_BUCKETS.preview;
export const PUBLIC_DISCOVERY_PREFIX = 'public-discovery/';
export const OBSOLETE_LIFECYCLE_RULE_ID = 'public-discovery-eight-day-retention';
export const PUBLIC_DISCOVERY_KV_BINDINGS = Object.freeze(
	/** @type {const} */ ([
		'DC_SESSION_KV',
		'REGISTRATION_RETRY_KV',
		'REJECTION_MONITOR_KV',
		'VICAL_KV'
	])
);
export const PUBLIC_DISCOVERY_KV_NAMESPACE_TITLES = Object.freeze({
	production: Object.freeze({
		DC_SESSION_KV: 'DC_SESSION_KV',
		REJECTION_MONITOR_KV: 'REJECTION_MONITOR_KV',
		VICAL_KV: 'VICAL_KV',
		REGISTRATION_RETRY_KV: 'REGISTRATION_RETRY_KV'
	}),
	preview: Object.freeze({
		DC_SESSION_KV: 'commons-preview-dc-session',
		REJECTION_MONITOR_KV: 'commons-preview-rejection-monitor',
		VICAL_KV: 'commons-preview-vical',
		REGISTRATION_RETRY_KV: 'commons-preview-registration-retry'
	})
});

const ACCOUNT_ID_PATTERN = /^[a-f0-9]{32}$/u;
const KV_NAMESPACE_ID_PATTERN = /^[a-f0-9]{32}$/u;
const KV_PAGE_SIZE = 1_000;
const MAXIMUM_KV_NAMESPACES = 100_000;
const MAXIMUM_KV_PAGES = 100;
const MAXIMUM_CLOUDFLARE_RESPONSE_BYTES = 1024 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;
const REALMS = /** @type {const} */ (['preview', 'production']);

/** @param {unknown} condition @param {string} message @returns {asserts condition} */
function invariant(condition, message) {
	if (!condition) throw new Error(message);
}

/** @param {unknown} value @returns {Record<string, any> | null} */
function record(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

/** @param {unknown} value */
function safeNonnegativeInteger(value) {
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/**
 * @param {'preview'|'production'|'all'} environment
 * @returns {readonly ('preview'|'production')[]}
 */
function selectedRealms(environment) {
	invariant(
		environment === 'preview' || environment === 'production' || environment === 'all',
		'environment must be preview, production, or all.'
	);
	return environment === 'all' ? REALMS : [environment];
}

function assertCommittedStorageAuthorityIsIsolated() {
	const expectedBindings = PUBLIC_DISCOVERY_KV_BINDINGS;
	const ids = [];
	const titles = [];
	for (const realm of REALMS) {
		const realmIds = PAGES_KV_NAMESPACE_IDS[realm];
		const realmTitles = PUBLIC_DISCOVERY_KV_NAMESPACE_TITLES[realm];
		invariant(
			JSON.stringify(Object.keys(realmIds).sort()) === JSON.stringify(expectedBindings),
			`Committed ${realm} KV namespace ids are not the exact binding set.`
		);
		invariant(
			JSON.stringify(Object.keys(realmTitles).sort()) === JSON.stringify(expectedBindings),
			`Committed ${realm} KV namespace titles are not the exact binding set.`
		);
		for (const binding of expectedBindings) {
			const id = realmIds[binding];
			const title = realmTitles[binding];
			invariant(
				KV_NAMESPACE_ID_PATTERN.test(id),
				`Committed ${realm} ${binding} namespace id is invalid.`
			);
			invariant(
				typeof title === 'string' && title.length > 0 && title.length <= 512,
				`Committed ${realm} ${binding} namespace title is invalid.`
			);
			ids.push(id);
			titles.push(title);
		}
	}
	invariant(
		ids.length === 8 && new Set(ids).size === ids.length,
		'The eight committed Pages KV namespace ids must be globally distinct.'
	);
	invariant(
		titles.length === 8 && new Set(titles).size === titles.length,
		'The eight committed Pages KV namespace titles must be globally distinct.'
	);
	invariant(
		PUBLIC_DISCOVERY_R2_BUCKETS.production !== PUBLIC_DISCOVERY_R2_BUCKETS.preview,
		'Production and preview public-discovery R2 buckets must be distinct.'
	);
}

/**
 * @param {typeof fetch} fetchFn
 * @param {string} url
 * @param {Record<string,string>} headers
 * @param {string} label
 */
async function getCloudflareEnvelope(fetchFn, url, headers, label) {
	const response = await fetchFn(url, {
		headers,
		redirect: 'error',
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
	});
	invariant(response instanceof Response, `${label} did not return an HTTP response.`);
	invariant(response.status === 200 && response.ok, `${label} returned HTTP ${response.status}.`);
	const envelope = record(
		await readBoundedResponseJson(response, `${label} response`, MAXIMUM_CLOUDFLARE_RESPONSE_BYTES)
	);
	invariant(envelope?.success === true, `${label} did not report success.`);
	return envelope;
}

/**
 * @param {{base:string,headers:Record<string,string>,fetchFn:typeof fetch}} input
 */
async function fetchCompleteKvNamespaceInventory({ base, headers, fetchFn }) {
	const namespaces = new Map();
	let expectedTotal = 0;
	let expectedPerPage = 0;
	let expectedPages = 0;
	for (let page = 1; ; page += 1) {
		const url = new URL(`${base}/storage/kv/namespaces`);
		url.searchParams.set('page', String(page));
		url.searchParams.set('per_page', String(KV_PAGE_SIZE));
		const envelope = await getCloudflareEnvelope(
			fetchFn,
			url.href,
			headers,
			`KV namespace inventory page ${page}`
		);
		const rows = envelope.result;
		const info = record(envelope.result_info);
		invariant(Array.isArray(rows), `KV namespace inventory page ${page} result is not an array.`);
		invariant(info !== null, `KV namespace inventory page ${page} has no result_info.`);
		invariant(
			safeNonnegativeInteger(info.count) && info.count === rows.length,
			`KV namespace inventory page ${page} count is not exact.`
		);
		invariant(info.page === page, `KV namespace inventory page ${page} index is not exact.`);
		invariant(
			Number.isSafeInteger(info.per_page) && info.per_page > 0 && info.per_page <= KV_PAGE_SIZE,
			`KV namespace inventory page ${page} per_page is invalid.`
		);
		invariant(
			safeNonnegativeInteger(info.total_count) && info.total_count <= MAXIMUM_KV_NAMESPACES,
			`KV namespace inventory page ${page} total_count is invalid.`
		);

		if (page === 1) {
			expectedTotal = info.total_count;
			expectedPerPage = info.per_page;
			expectedPages = Math.max(1, Math.ceil(expectedTotal / expectedPerPage));
			invariant(
				expectedPages <= MAXIMUM_KV_PAGES,
				'KV namespace inventory exceeds the bounded pagination budget.'
			);
		} else {
			invariant(
				info.total_count === expectedTotal && info.per_page === expectedPerPage,
				'KV namespace inventory pagination changed while it was being proven.'
			);
		}
		invariant(page <= expectedPages, 'KV namespace inventory returned an unexpected extra page.');
		if (info.total_pages !== undefined) {
			invariant(
				info.total_pages === expectedPages,
				`KV namespace inventory page ${page} total_pages is not exact.`
			);
		}

		for (const [index, value] of rows.entries()) {
			const namespace = record(value);
			invariant(namespace !== null, `KV namespace page ${page} row ${index} is not an object.`);
			invariant(
				KV_NAMESPACE_ID_PATTERN.test(namespace.id),
				`KV namespace page ${page} row ${index} id is invalid.`
			);
			invariant(
				typeof namespace.title === 'string' &&
					namespace.title.length > 0 &&
					namespace.title.length <= 512,
				`KV namespace ${namespace.id} title is invalid.`
			);
			invariant(
				!namespaces.has(namespace.id),
				`KV namespace id ${namespace.id} is duplicated in the complete inventory.`
			);
			namespaces.set(namespace.id, namespace.title);
		}

		const expectedRows =
			page < expectedPages ? expectedPerPage : expectedTotal - expectedPerPage * (page - 1);
		invariant(
			rows.length === expectedRows,
			`KV namespace inventory page ${page} is truncated or overfull.`
		);
		if (page === expectedPages) break;
	}
	invariant(
		namespaces.size === expectedTotal,
		'KV namespace inventory did not yield its declared total_count.'
	);
	return namespaces;
}

/**
 * @param {Map<string,string>} inventory
 * @param {readonly ('preview'|'production')[]} realms
 */
function proveSelectedKvNamespaces(inventory, realms) {
	const selectedTitles = new Map();
	/** @type {Partial<Record<'preview'|'production', Record<string,{id:string,title:string}>>>} */
	const proof = {};
	for (const realm of realms) {
		proof[realm] = {};
		for (const binding of PUBLIC_DISCOVERY_KV_BINDINGS) {
			const id = PAGES_KV_NAMESPACE_IDS[realm][binding];
			const title = PUBLIC_DISCOVERY_KV_NAMESPACE_TITLES[realm][binding];
			invariant(inventory.has(id), `Required ${realm} ${binding} KV namespace is missing.`);
			invariant(
				inventory.get(id) === title,
				`Required ${realm} ${binding} KV namespace title is not exact.`
			);
			invariant(
				!selectedTitles.has(title),
				`Required KV namespace title ${title} is duplicated across selected realms.`
			);
			selectedTitles.set(title, id);
			proof[realm][binding] = { id, title };
		}
	}
	for (const [id, title] of inventory) {
		const expectedId = selectedTitles.get(title);
		invariant(
			expectedId === undefined || expectedId === id,
			`Required KV namespace title ${title} is assigned to more than one id.`
		);
	}
	return proof;
}

/**
 * @param {{base:string,headers:Record<string,string>,realm:'preview'|'production',fetchFn:typeof fetch}} input
 */
async function verifyPublicDiscoveryR2Realm({ base, headers, realm, fetchFn }) {
	const bucketName = PUBLIC_DISCOVERY_R2_BUCKETS[realm];
	const bucketBase = `${base}/r2/buckets/${encodeURIComponent(bucketName)}`;
	const [bucketEnvelope, managedEnvelope, customEnvelope] = await Promise.all([
		getCloudflareEnvelope(fetchFn, bucketBase, headers, `${realm} public-discovery R2 bucket`),
		getCloudflareEnvelope(
			fetchFn,
			`${bucketBase}/domains/managed`,
			headers,
			`${realm} public-discovery R2 managed domain`
		),
		getCloudflareEnvelope(
			fetchFn,
			`${bucketBase}/domains/custom`,
			headers,
			`${realm} public-discovery R2 custom domains`
		)
	]);
	const bucket = record(bucketEnvelope.result);
	invariant(
		bucket?.name === bucketName && bucket.storage_class === 'Standard',
		`${realm} public-discovery R2 bucket is not the exact live Standard bucket.`
	);
	const managed = record(managedEnvelope.result);
	invariant(
		managed !== null &&
			KV_NAMESPACE_ID_PATTERN.test(managed.bucketId) &&
			typeof managed.domain === 'string' &&
			managed.domain.length > 0 &&
			managed.enabled === false,
		`${realm} public-discovery R2 r2.dev managed domain must be disabled.`
	);
	const customResult = record(customEnvelope.result);
	const domains = customResult?.domains;
	invariant(
		Array.isArray(domains),
		`${realm} public-discovery R2 custom-domain inventory is malformed.`
	);
	const names = new Set();
	for (const [index, value] of domains.entries()) {
		const domain = record(value);
		invariant(
			domain !== null &&
				typeof domain.domain === 'string' &&
				domain.domain.length > 0 &&
				typeof domain.enabled === 'boolean',
			`${realm} public-discovery R2 custom domain ${index} is malformed.`
		);
		invariant(
			!names.has(domain.domain),
			`${realm} public-discovery R2 custom domain ${domain.domain} is duplicated.`
		);
		names.add(domain.domain);
		invariant(
			domain.enabled === false,
			`${realm} public-discovery R2 custom domain ${domain.domain} must be disabled.`
		);
	}
	return { bucket: bucketName, customDomainCount: domains.length, storageClass: 'Standard' };
}

/** @param {unknown} value @returns {unknown} */
function canonical(value) {
	if (Array.isArray(value)) return value.map(canonical);
	const object = record(value);
	if (!object) return value;
	return Object.fromEntries(
		Object.keys(object)
			.sort()
			.map((key) => [key, canonical(object[key])])
	);
}

/** @param {unknown} envelope */
function lifecycleRules(envelope) {
	const response = record(envelope);
	const result = record(response?.result);
	invariant(response?.success === true, 'R2 lifecycle API did not report success.');
	invariant(result !== null, 'R2 lifecycle API result must be an object.');
	const rawRules = result.rules;
	invariant(
		rawRules === undefined || Array.isArray(rawRules),
		'R2 lifecycle API result.rules must be absent or an array.'
	);
	const rules = rawRules ?? [];
	const ids = new Set();
	for (const [index, value] of rules.entries()) {
		const rule = record(value);
		const conditions = record(rule?.conditions);
		invariant(rule !== null, `R2 lifecycle rule ${index} is not an object.`);
		invariant(
			typeof rule.id === 'string' && rule.id.length > 0,
			`R2 lifecycle rule ${index} has no id.`
		);
		invariant(!ids.has(rule.id), `R2 lifecycle rule id ${rule.id} is duplicated.`);
		ids.add(rule.id);
		invariant(
			typeof rule.enabled === 'boolean',
			`R2 lifecycle rule ${rule.id} has no boolean enabled.`
		);
		invariant(conditions !== null, `R2 lifecycle rule ${rule.id} has no conditions object.`);
		invariant(
			conditions.prefix === undefined || typeof conditions.prefix === 'string',
			`R2 lifecycle rule ${rule.id} has a malformed prefix.`
		);
	}
	return /** @type {Array<Record<string, any>>} */ (rules);
}

/** @param {string} prefix */
export function prefixOverlapsPublicDiscovery(prefix) {
	return PUBLIC_DISCOVERY_PREFIX.startsWith(prefix) || prefix.startsWith(PUBLIC_DISCOVERY_PREFIX);
}

/** @param {Record<string, any>} rule */
function enabledDestructiveOverlap(rule) {
	if (rule.enabled !== true) return false;
	const prefix = record(rule.conditions)?.prefix;
	const destructive =
		record(rule.deleteObjectsTransition) !== null ||
		(Array.isArray(rule.storageClassTransitions) && rule.storageClassTransitions.length > 0);
	if (!destructive) return false;
	// Cloudflare's account-created multipart-abort rule legitimately has no
	// prefix. A prefixless object-deletion or storage transition, however,
	// applies to the whole bucket and therefore overlaps public discovery.
	return (
		prefix === undefined || (typeof prefix === 'string' && prefixOverlapsPublicDiscovery(prefix))
	);
}

/** @param {Array<Record<string, any>>} rules */
function assertSafeRules(rules) {
	const unsafe = rules.filter(enabledDestructiveOverlap).map((rule) => rule.id);
	invariant(
		unsafe.length === 0,
		`Enabled R2 lifecycle rules overlap ${PUBLIC_DISCOVERY_PREFIX}: ${unsafe.join(',')}`
	);
}

/** @param {unknown} envelope */
export function planPublicDiscoveryLifecycleReconciliation(envelope) {
	const before = lifecycleRules(envelope);
	const preserved = before.filter((rule) => rule.id !== OBSOLETE_LIFECYCLE_RULE_ID);
	assertSafeRules(preserved);
	return {
		changed: preserved.length !== before.length,
		preserved,
		removed: before.filter((rule) => rule.id === OBSOLETE_LIFECYCLE_RULE_ID).map((rule) => rule.id)
	};
}

/**
 * @param {{accountId: string|undefined, apiToken: string|undefined, bucketName?: string, fetchFn?: typeof fetch}} options
 */
export async function reconcilePublicDiscoveryR2Lifecycle({
	accountId,
	apiToken,
	bucketName = PUBLIC_DISCOVERY_BUCKET,
	fetchFn = fetch
}) {
	invariant(
		typeof accountId === 'string' && ACCOUNT_ID_PATTERN.test(accountId),
		'CLOUDFLARE_ACCOUNT_ID must be an exact lowercase account id.'
	);
	invariant(
		typeof apiToken === 'string' && apiToken.length > 0,
		'CLOUDFLARE_API_TOKEN is required.'
	);
	invariant(
		bucketName === PUBLIC_DISCOVERY_BUCKET || bucketName === PUBLIC_DISCOVERY_NONPROD_BUCKET,
		'Refusing to reconcile an unexpected R2 bucket.'
	);
	const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucketName}/lifecycle`;
	const headers = { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' };
	const read = async () => {
		const response = await fetchFn(url, {
			headers,
			redirect: 'error',
			signal: AbortSignal.timeout(15_000)
		});
		invariant(response.ok, `R2 lifecycle GET returned HTTP ${response.status}.`);
		return readBoundedResponseJson(response, 'R2 lifecycle GET response');
	};

	const plan = planPublicDiscoveryLifecycleReconciliation(await read());
	if (!plan.changed) {
		return { changed: false, preservedRuleIds: plan.preserved.map((rule) => rule.id) };
	}

	const update = await fetchFn(url, {
		body: JSON.stringify({ rules: plan.preserved }),
		headers: { ...headers, 'Content-Type': 'application/json' },
		method: 'PUT',
		redirect: 'error',
		signal: AbortSignal.timeout(15_000)
	});
	invariant(update.ok, `R2 lifecycle PUT returned HTTP ${update.status}.`);
	const updateEnvelope = record(await readBoundedResponseJson(update, 'R2 lifecycle PUT response'));
	invariant(updateEnvelope?.success === true, 'R2 lifecycle PUT did not report success.');

	const after = lifecycleRules(await read());
	assertSafeRules(after);
	invariant(
		after.every((rule) => rule.id !== OBSOLETE_LIFECYCLE_RULE_ID),
		'Obsolete public-discovery lifecycle rule remains after reconciliation.'
	);
	const expected = new Map(
		plan.preserved.map((rule) => [rule.id, JSON.stringify(canonical(rule))])
	);
	const actual = new Map(after.map((rule) => [rule.id, JSON.stringify(canonical(rule))]));
	invariant(
		actual.size === expected.size,
		'R2 lifecycle reconciliation changed unrelated rule count.'
	);
	for (const [id, rule] of expected) {
		invariant(actual.get(id) === rule, `R2 lifecycle reconciliation changed unrelated rule ${id}.`);
	}
	return { changed: true, preservedRuleIds: [...expected.keys()], removed: plan.removed };
}

/**
 * Prove that the selected Pages storage realms are isolated, private, and
 * Standard-class before reconciling the one obsolete discovery lifecycle
 * rule. Provisioning remains external: missing or drifted authority blocks the
 * release rather than creating a replacement resource under an ambient token.
 *
 * @param {{accountId:string|undefined,apiToken:string|undefined,environment:'preview'|'production'|'all',fetchFn?:typeof fetch}} options
 */
export async function verifyAndReconcilePublicDiscoveryStorage({
	accountId,
	apiToken,
	environment,
	fetchFn = fetch
}) {
	invariant(
		typeof accountId === 'string' && ACCOUNT_ID_PATTERN.test(accountId),
		'CLOUDFLARE_ACCOUNT_ID must be an exact lowercase account id.'
	);
	invariant(
		typeof apiToken === 'string' &&
			apiToken.length > 0 &&
			apiToken.length <= 4_096 &&
			apiToken.trim() === apiToken,
		'CLOUDFLARE_API_TOKEN must be an exact non-empty token.'
	);
	invariant(typeof fetchFn === 'function', 'fetchFn must be a function.');
	const realms = selectedRealms(environment);
	assertCommittedStorageAuthorityIsIsolated();
	const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}`;
	const headers = { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' };
	const inventory = await fetchCompleteKvNamespaceInventory({ base, headers, fetchFn });
	const kvProof = proveSelectedKvNamespaces(inventory, realms);

	const verifiedRealms = await Promise.all(
		realms.map(async (realm) => ({
			realm,
			...(await verifyPublicDiscoveryR2Realm({ base, headers, realm, fetchFn }))
		}))
	);
	const reconciledRealms = await Promise.all(
		verifiedRealms.map(async (verified) => ({
			...verified,
			kvNamespaces: kvProof[verified.realm],
			lifecycle: await reconcilePublicDiscoveryR2Lifecycle({
				accountId,
				apiToken,
				bucketName: verified.bucket,
				fetchFn
			})
		}))
	);

	return {
		environment,
		kvInventoryCount: inventory.size,
		realms: Object.fromEntries(reconciledRealms.map(({ realm, ...proof }) => [realm, proof]))
	};
}

/** @param {string[]} argv @returns {{environment:'preview'|'production'|'all'}} */
export function parsePublicDiscoveryStorageArgs(argv) {
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
		environment === 'preview' || environment === 'production' || environment === 'all',
		'--environment must be preview, production, or all.'
	);
	return { environment };
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
	try {
		const { environment } = parsePublicDiscoveryStorageArgs(process.argv.slice(2));
		const result = await verifyAndReconcilePublicDiscoveryStorage({
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
