#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { readBoundedResponseJson } from '../src/lib/server/bounded-response.mjs';

export const TRUSTED_PAGES_EDGE_ACCESS_HEADER = 'x-commons-pages-origin-access';
export const TRUSTED_PAGES_EDGE_LATE_TRANSFORM_EXPRESSION =
	'(http.host in {"pages-origin.commons.email" "pages-origin-staging.commons.email"})';
const ACCESS_APPLICATION_PAGE_SIZE = 100;
const MAX_ACCESS_APPLICATION_PAGES = 10;
export const TRUSTED_PAGES_EDGE_REALMS = Object.freeze({
	production: Object.freeze({
		worker: 'commons-trusted-pages-edge',
		route: 'commons.email/*',
		originHost: 'pages-origin.commons.email',
		publicConvexUrl: 'https://quirky-chinchilla-352.convex.cloud'
	}),
	preview: Object.freeze({
		worker: 'commons-trusted-pages-edge-staging',
		route: 'staging.commons.email/*',
		originHost: 'pages-origin-staging.commons.email'
	})
});

/** @param {unknown} condition @param {string} message @returns {asserts condition} */
function invariant(condition, message) {
	if (!condition) throw new Error(message);
}

/** @param {unknown} value @returns {Record<string, any> | null} */
function record(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? /** @type {Record<string, any>} */ (value)
		: null;
}

/** @param {unknown} envelope @param {string} label */
function completeRows(envelope, label) {
	const source = record(envelope);
	const rows = source?.result;
	invariant(source?.success === true && Array.isArray(rows), `${label} is malformed.`);
	const info = record(source?.result_info);
	if (info) {
		invariant(
			(info.total_pages === undefined || info.total_pages === 1) &&
				(info.total_count === undefined || info.total_count === rows.length),
			`${label} is incomplete.`
		);
	}
	return rows;
}

/** @param {unknown} envelope @param {string} label @param {number} expectedPage */
function completeAccessApplicationPage(envelope, label, expectedPage) {
	const source = record(envelope);
	const rows = source?.result;
	const info = record(source?.result_info);
	invariant(
		source?.success === true && Array.isArray(rows) && info !== null,
		`${label} is malformed.`
	);
	const { count, page, per_page: perPage, total_count: totalCount, total_pages: totalPages } = info;
	invariant(
		Number.isSafeInteger(count) &&
			count === rows.length &&
			Number.isSafeInteger(page) &&
			page === expectedPage &&
			perPage === ACCESS_APPLICATION_PAGE_SIZE &&
			Number.isSafeInteger(totalCount) &&
			totalCount >= 0 &&
			totalCount <= ACCESS_APPLICATION_PAGE_SIZE * MAX_ACCESS_APPLICATION_PAGES &&
			Number.isSafeInteger(totalPages) &&
			totalPages >= 1 &&
			totalPages <= MAX_ACCESS_APPLICATION_PAGES &&
			totalPages === Math.max(1, Math.ceil(totalCount / ACCESS_APPLICATION_PAGE_SIZE)) &&
			rows.length <= ACCESS_APPLICATION_PAGE_SIZE,
		`${label} pagination metadata is invalid.`
	);
	return {
		rows,
		totalCount: /** @type {number} */ (totalCount),
		totalPages: /** @type {number} */ (totalPages)
	};
}

/**
 * Read a complete, bounded Access application inventory. Missing pagination
 * metadata is a release failure because a one-page response cannot otherwise
 * prove that a later path- or wildcard-scoped application was inspected.
 * @param {{endpoint:string;headers:Record<string,string>;scope:'account'|'zone';fetchFn?:typeof fetch}} options
 */
export async function readTrustedPagesAccessApplicationInventory({
	endpoint,
	headers,
	scope,
	fetchFn = fetch
}) {
	invariant(scope === 'account' || scope === 'zone', 'Access application scope is invalid.');
	let endpointUrl;
	try {
		endpointUrl = new URL(endpoint);
	} catch {
		throw new Error(`Access ${scope} application endpoint is invalid.`);
	}
	invariant(
		endpointUrl.protocol === 'https:' && endpointUrl.username === '' && endpointUrl.password === '',
		`Access ${scope} application endpoint is invalid.`
	);
	/** @type {unknown[]} */
	const applications = [];
	const applicationIds = new Set();
	let expectedTotalCount;
	let expectedTotalPages;

	for (let page = 1; page <= MAX_ACCESS_APPLICATION_PAGES; page += 1) {
		const pageUrl = new URL(endpointUrl);
		pageUrl.search = '';
		pageUrl.hash = '';
		pageUrl.searchParams.set('page', String(page));
		pageUrl.searchParams.set('per_page', String(ACCESS_APPLICATION_PAGE_SIZE));
		const response = await fetchFn(pageUrl, {
			headers,
			redirect: 'error',
			signal: AbortSignal.timeout(15_000)
		});
		invariant(
			response instanceof Response && response.ok,
			`Access ${scope} application inventory page ${page} returned HTTP ${response?.status}.`
		);
		const envelope = await readBoundedResponseJson(
			response,
			`Access ${scope} application inventory page ${page}`
		);
		const parsed = completeAccessApplicationPage(
			envelope,
			`Access ${scope} application inventory page ${page}`,
			page
		);
		if (page === 1) {
			expectedTotalCount = parsed.totalCount;
			expectedTotalPages = parsed.totalPages;
		} else {
			invariant(
				parsed.totalCount === expectedTotalCount && parsed.totalPages === expectedTotalPages,
				`Access ${scope} application inventory changed during pagination.`
			);
		}
		for (const row of parsed.rows) {
			const app = record(row);
			invariant(
				typeof app?.id === 'string' && app.id.length > 0 && app.id.length <= 128,
				`Access ${scope} application inventory contains an invalid application.`
			);
			invariant(
				!applicationIds.has(app.id),
				`Access ${scope} application inventory contains duplicate applications.`
			);
			applicationIds.add(app.id);
			applications.push(row);
		}
		if (page === expectedTotalPages) {
			invariant(
				applications.length === expectedTotalCount,
				`Access ${scope} application inventory is incomplete.`
			);
			return applications;
		}
	}
	throw new Error(`Access ${scope} application inventory exceeds the bounded page limit.`);
}

/** @param {unknown} value @param {string} label */
function exactTransaction(value, label) {
	invariant(
		typeof value === 'string' && /^[1-9][0-9]{0,19}-[1-9][0-9]{0,9}$/u.test(value),
		`${label} is invalid.`
	);
	return value;
}

/** @param {unknown} value */
function exactOriginAccessToken(value) {
	invariant(
		typeof value === 'string' && value.length >= 64 && value.length <= 1_024,
		'PAGES_ORIGIN_ACCESS_TOKEN is invalid.'
	);
	let parsed;
	try {
		parsed = JSON.parse(value);
	} catch {
		throw new Error('PAGES_ORIGIN_ACCESS_TOKEN is invalid JSON.');
	}
	const token = record(parsed);
	invariant(
		token !== null &&
			JSON.stringify(Object.keys(token).sort()) ===
				JSON.stringify(['cf-access-client-id', 'cf-access-client-secret'].sort()) &&
			typeof token['cf-access-client-id'] === 'string' &&
			/^[A-Za-z0-9._-]{16,256}$/u.test(token['cf-access-client-id']) &&
			typeof token['cf-access-client-secret'] === 'string' &&
			/^[A-Za-z0-9._-]{32,512}$/u.test(token['cf-access-client-secret']),
		'PAGES_ORIGIN_ACCESS_TOKEN has an invalid capability shape.'
	);
	return JSON.stringify(token);
}

/**
 * @param {{settings:unknown;subdomain:unknown;environment:'preview'|'production';expectedTransactionId:string}} input
 */
export function validateTrustedPagesEdgeWorker({
	settings,
	subdomain,
	environment,
	expectedTransactionId
}) {
	const expected = TRUSTED_PAGES_EDGE_REALMS[environment];
	const result = record(record(settings)?.result);
	const bindings = result?.bindings;
	invariant(Array.isArray(bindings), `Trusted Pages ${environment} edge bindings are missing.`);
	const byName = new Map(bindings.map((binding) => [record(binding)?.name, record(binding)]));
	invariant(byName.size === bindings.length, `Trusted Pages ${environment} edge bindings collide.`);
	const expectedNames =
		environment === 'production'
			? [
					'PAGES_ORIGIN_ACCESS_TOKEN',
					'PUBLIC_CONVEX_URL',
					'PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE',
					'PUBLIC_RELEASE_TRANSACTION_ID',
					'RELEASE_ORIGIN_PROOF_SECRET'
				]
			: ['PAGES_ORIGIN_ACCESS_TOKEN', 'PUBLIC_RELEASE_TRANSACTION_ID', 'RELEASE_PROBE_SECRET'];
	invariant(
		JSON.stringify([...byName.keys()].sort()) === JSON.stringify(expectedNames.sort()),
		`Trusted Pages ${environment} edge binding set is not exact.`
	);
	invariant(
		byName.get('PAGES_ORIGIN_ACCESS_TOKEN')?.type === 'secret_text',
		`Trusted Pages ${environment} edge Access token is missing.`
	);
	invariant(
		byName.get('PUBLIC_RELEASE_TRANSACTION_ID')?.type === 'plain_text' &&
			byName.get('PUBLIC_RELEASE_TRANSACTION_ID')?.text === expectedTransactionId,
		`Trusted Pages ${environment} edge release transaction is not exact.`
	);
	if (environment === 'production') {
		invariant(
			byName.get('RELEASE_ORIGIN_PROOF_SECRET')?.type === 'secret_text',
			'Trusted Pages production edge release-origin proof capability is missing.'
		);
		invariant(
			byName.get('PUBLIC_CONVEX_URL')?.type === 'plain_text' &&
				byName.get('PUBLIC_CONVEX_URL')?.text ===
					TRUSTED_PAGES_EDGE_REALMS.production.publicConvexUrl,
			'Trusted Pages production edge backend realm is not exact.'
		);
		const gate = byName.get('PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE');
		invariant(
			gate?.type === 'durable_object_namespace' &&
				gate.class_name === 'PublicDiscoveryManifestRefreshGate' &&
				gate.script_name === 'commons-public-discovery-manifest-gate' &&
				typeof gate.namespace_id === 'string' &&
				gate.namespace_id.length > 0,
			'Trusted Pages production edge release-authority namespace is not exact.'
		);
	} else {
		invariant(
			byName.get('RELEASE_PROBE_SECRET')?.type === 'secret_text',
			'Trusted Pages staging edge release-probe capability is missing.'
		);
	}
	invariant(
		Array.isArray(result?.compatibility_flags) &&
			result.compatibility_flags.length === 1 &&
			result.compatibility_flags[0] === 'global_fetch_strictly_public',
		`Trusted Pages ${environment} edge must use only global_fetch_strictly_public.`
	);
	const exposure = record(record(subdomain)?.result);
	invariant(
		exposure?.enabled === false && exposure?.previews_enabled === false,
		`Trusted Pages ${environment} edge must disable workers.dev and preview URLs.`
	);
	return { environment, worker: expected.worker, releaseTransactionId: expectedTransactionId };
}

/**
 * @param {{routes:unknown;environment:'preview'|'production';expectedPresent?:boolean}} input
 */
export function validateTrustedPagesEdgeRoute({ routes, environment, expectedPresent = true }) {
	invariant(typeof expectedPresent === 'boolean', 'Worker route expectation is malformed.');
	const source = record(routes);
	if (source?.result_info !== undefined) {
		const info = record(source.result_info);
		invariant(
			info !== null && info.total_pages === 1 && info.total_count === source.result?.length,
			'Worker route inventory pagination metadata is incomplete.'
		);
	}
	const expected = TRUSTED_PAGES_EDGE_REALMS[environment];
	const rows = completeRows(routes, 'Worker route inventory');
	const canonicalHost = expected.route.slice(0, expected.route.indexOf('/'));
	const allowed = new Map();
	if (expectedPresent) allowed.set(expected.route, expected.worker);
	if (environment === 'production') {
		// This more-specific route is an intentional, independently rate-limited
		// public edge. No other route may intersect the canonical production host.
		allowed.set('commons.email/api/v1/*', 'commons-api-v1-edge');
	}
	const seen = new Set();
	let trustedRouteCount = 0;
	for (let index = 0; index < rows.length; index += 1) {
		const candidate = record(rows[index]);
		invariant(
			candidate !== null &&
				typeof candidate.pattern === 'string' &&
				candidate.pattern.length > 0 &&
				candidate.pattern.length <= 2_048 &&
				(candidate.script === undefined ||
					candidate.script === null ||
					(typeof candidate.script === 'string' && candidate.script.length > 0)),
			`Worker route inventory row ${index + 1} is malformed.`
		);
		const pattern = /** @type {string} */ (candidate.pattern);
		let authority = pattern;
		const schemeSeparator = authority.indexOf('://');
		if (schemeSeparator !== -1) {
			const scheme = authority.slice(0, schemeSeparator).toLowerCase();
			invariant(
				scheme === 'http' || scheme === 'https' || scheme === '*',
				`Worker route inventory row ${index + 1} is malformed.`
			);
			authority = authority.slice(schemeSeparator + 3);
		}
		const slash = authority.indexOf('/');
		let hostPattern = (slash === -1 ? authority : authority.slice(0, slash)).toLowerCase();
		invariant(
			hostPattern.length > 0 && !hostPattern.includes('://') && !/[^a-z0-9.*:-]/u.test(hostPattern),
			`Worker route inventory row ${index + 1} is malformed.`
		);
		// Ports are not part of the zone hostname, but treating an explicitly
		// port-scoped route as intersecting is the safe failure mode.
		hostPattern = hostPattern.replace(/:\*$/u, '').replace(/:[0-9]+$/u, '');
		const hostExpression = new RegExp(
			`^${hostPattern.replace(/[.+?^${}()|[\]\\]/gu, '\\$&').replace(/\*/gu, '.*')}$`,
			'u'
		);
		const conservativeApexOverlap =
			hostPattern.startsWith('*.') && hostPattern.slice(2) === canonicalHost;
		if (!hostExpression.test(canonicalHost) && !conservativeApexOverlap) continue;

		const requiredScript = allowed.get(pattern);
		invariant(
			requiredScript !== undefined && candidate.script === requiredScript,
			`Trusted Pages ${environment} edge has an overlapping Worker route: ${pattern}.`
		);
		invariant(
			!seen.has(pattern),
			`Trusted Pages ${environment} edge has a duplicate Worker route: ${pattern}.`
		);
		seen.add(pattern);
		if (pattern === expected.route) trustedRouteCount += 1;
	}
	invariant(
		trustedRouteCount === (expectedPresent ? 1 : 0),
		`Trusted Pages ${environment} edge route is not exact.`
	);
	return expectedPresent ? expected.route : null;
}

/** @param {{pagesDomains:unknown}} input */
export function validateTrustedPagesOriginDomains({ pagesDomains }) {
	const rows = completeRows(pagesDomains, 'Pages custom-domain inventory');
	const names = rows.map((row) => record(row)?.name).sort();
	const expected = ['pages-origin-staging.commons.email', 'pages-origin.commons.email'].sort();
	invariant(
		JSON.stringify(names) === JSON.stringify(expected),
		'Pages must expose exactly the two Access-protected hidden origin domains.'
	);
	for (const row of rows) {
		const domain = record(row);
		invariant(
			domain?.status === 'active',
			`Pages hidden origin ${String(domain?.name)} is not active.`
		);
	}
	return names;
}

/** @param {unknown} value @param {string} label */
function accessInventoryRows(value, label) {
	return Array.isArray(value) ? value : completeRows(value, label);
}

/**
 * @param {{accessApps?:unknown;accountAccessApps?:unknown;zoneAccessApps?:unknown}} input
 */
function scopedAccessApplications({ accessApps, accountAccessApps, zoneAccessApps }) {
	if (accessApps !== undefined) {
		invariant(
			accountAccessApps === undefined && zoneAccessApps === undefined,
			'Access application inventory inputs are ambiguous.'
		);
		accountAccessApps = accessApps;
		zoneAccessApps = [];
	}
	invariant(
		accountAccessApps !== undefined && zoneAccessApps !== undefined,
		'Both account and zone Access application inventories are required.'
	);
	/** @type {Array<{app:Record<string, any>;scope:'account'|'zone'}>} */
	const scoped = [];
	for (const [scope, inventory] of /** @type {const} */ ([
		['account', accountAccessApps],
		['zone', zoneAccessApps]
	])) {
		const ids = new Set();
		const rows = accessInventoryRows(inventory, `Access ${scope} application inventory`);
		for (const row of rows) {
			const app = record(row);
			invariant(
				typeof app?.id === 'string' && app.id.length > 0 && app.id.length <= 128,
				`Access ${scope} application inventory contains an invalid application.`
			);
			invariant(
				!ids.has(app.id),
				`Access ${scope} application inventory contains duplicate applications.`
			);
			ids.add(app.id);
			scoped.push({ app, scope });
		}
	}
	return scoped;
}

/** @param {unknown} value @param {string} label */
function normalizeAccessDomainPattern(value, label) {
	invariant(
		typeof value === 'string' &&
			value.length > 0 &&
			value.length <= 2_048 &&
			![...value].some((character) => {
				const codePoint = character.codePointAt(0) ?? 0;
				return codePoint <= 0x20 || codePoint === 0x7f;
			}) &&
			!value.includes('://') &&
			!/[\\?#@:]/u.test(value),
		`${label} is invalid.`
	);
	const slash = value.indexOf('/');
	const hostnamePattern = (slash === -1 ? value : value.slice(0, slash)).toLowerCase();
	const rawPath = slash === -1 ? '' : value.slice(slash);
	const labels = hostnamePattern.split('.');
	invariant(
		hostnamePattern.length <= 253 &&
			labels.length >= 2 &&
			labels.every(
				(part) =>
					part.length > 0 &&
					part.length <= 63 &&
					/^[a-z0-9*-]+$/u.test(part) &&
					(part.match(/\*/gu)?.length ?? 0) <= 1
			),
		`${label} hostname is invalid.`
	);
	return {
		hostnamePattern,
		pathPattern: rawPath === '' || rawPath === '/' ? '/' : rawPath,
		wildcard: hostnamePattern.includes('*')
	};
}

/** @param {string} pattern @param {string} hostname */
function accessHostnamePatternMatches(pattern, hostname) {
	const patternLabels = pattern.split('.');
	const hostnameLabels = hostname.toLowerCase().split('.');
	if (patternLabels.length !== hostnameLabels.length) return false;
	return patternLabels.every((patternLabel, index) => {
		const hostnameLabel = hostnameLabels[index];
		const wildcardIndex = patternLabel.indexOf('*');
		if (wildcardIndex === -1) return patternLabel === hostnameLabel;
		const prefix = patternLabel.slice(0, wildcardIndex);
		const suffix = patternLabel.slice(wildcardIndex + 1);
		return (
			hostnameLabel.startsWith(prefix) &&
			hostnameLabel.endsWith(suffix) &&
			hostnameLabel.length >= prefix.length + suffix.length
		);
	});
}

/** @param {Record<string, any>} app @param {string} label */
function accessApplicationDomainPatterns(app, label) {
	/** @type {unknown[]} */
	const values = [];
	if (app.domain !== undefined) values.push(app.domain);
	if (app.destinations !== undefined) {
		invariant(Array.isArray(app.destinations), `${label} destinations are malformed.`);
		for (const destination of app.destinations) {
			const candidate = record(destination);
			invariant(candidate !== null, `${label} destination is malformed.`);
			if (candidate.type === 'public' || candidate.uri !== undefined) {
				invariant(candidate.type === 'public', `${label} public destination is malformed.`);
				values.push(candidate.uri);
			}
		}
	} else if (app.self_hosted_domains !== undefined) {
		invariant(Array.isArray(app.self_hosted_domains), `${label} domains are malformed.`);
		values.push(...app.self_hosted_domains);
	}
	invariant(
		app.type !== 'self_hosted' || values.length > 0,
		`${label} has no public hostname destination.`
	);
	const deduplicated = new Map();
	for (let index = 0; index < values.length; index += 1) {
		const pattern = normalizeAccessDomainPattern(values[index], `${label} domain ${index + 1}`);
		const key = `${pattern.hostnamePattern}\n${pattern.pathPattern}`;
		if (!deduplicated.has(key)) deduplicated.set(key, pattern);
	}
	return [...deduplicated.values()];
}

/**
 * @param {{accessApps?:unknown;accountAccessApps?:unknown;zoneAccessApps?:unknown;environment:'preview'|'production'}} input
 */
function exactTrustedPagesAccessApplication({
	accessApps,
	accountAccessApps,
	zoneAccessApps,
	environment
}) {
	const expectedHost = TRUSTED_PAGES_EDGE_REALMS[environment].originHost;
	const scoped = scopedAccessApplications({ accessApps, accountAccessApps, zoneAccessApps }).map(
		(entry) => ({
			...entry,
			patterns: accessApplicationDomainPatterns(
				entry.app,
				`Access ${entry.scope} application ${entry.app.id}`
			)
		})
	);
	const relevant = scoped.filter((entry) =>
		entry.patterns.some((pattern) =>
			accessHostnamePatternMatches(pattern.hostnamePattern, expectedHost)
		)
	);
	invariant(
		relevant.length === 1,
		`Trusted Pages ${environment} origin has overlapping Access applications; expected one exact root app.`
	);
	const candidate = relevant[0];
	const matchingPatterns = candidate.patterns.filter((pattern) =>
		accessHostnamePatternMatches(pattern.hostnamePattern, expectedHost)
	);
	invariant(
		matchingPatterns.length > 0 &&
			matchingPatterns.every(
				(pattern) =>
					!pattern.wildcard &&
					pattern.hostnamePattern === expectedHost &&
					pattern.pathPattern === '/'
			),
		`Trusted Pages ${environment} Access app must be scoped to the exact origin root.`
	);
	return candidate;
}

/** @param {Record<string, any>} app @param {'preview'|'production'} environment */
function exactAccessServiceTokenId(app, environment) {
	invariant(
		app.type === 'self_hosted' &&
			app.read_service_tokens_from_header === TRUSTED_PAGES_EDGE_ACCESS_HEADER,
		`Trusted Pages ${environment} Access app does not require the custom service-token header.`
	);
	const policies = app.policies;
	invariant(
		Array.isArray(policies) && policies.length === 1,
		`Trusted Pages ${environment} Access app must have one policy.`
	);
	const policy = record(policies[0]);
	const include = Array.isArray(policy?.include) ? policy.include : [];
	const includeRule = record(include[0]);
	const serviceToken = record(includeRule?.service_token);
	const tokenId = serviceToken?.token_id;
	invariant(
		policy?.decision === 'non_identity' &&
			include.length === 1 &&
			includeRule !== null &&
			Object.keys(includeRule).length === 1 &&
			serviceToken !== null &&
			Object.keys(serviceToken).length === 1 &&
			typeof tokenId === 'string' &&
			/^[a-f0-9]{32}$/u.test(tokenId) &&
			Array.isArray(policy.exclude) &&
			policy.exclude.length === 0 &&
			Array.isArray(policy.require) &&
			policy.require.length === 0,
		`Trusted Pages ${environment} Access policy is not exact Service Auth.`
	);
	return tokenId;
}

/**
 * @param {{accessApps?:unknown;accountAccessApps?:unknown;zoneAccessApps?:unknown;environment:'preview'|'production';expectedServiceTokenId:string}} input
 */
export function validateTrustedPagesOriginAccess({
	accessApps,
	accountAccessApps,
	zoneAccessApps,
	environment,
	expectedServiceTokenId
}) {
	invariant(
		typeof expectedServiceTokenId === 'string' && /^[a-f0-9]{32}$/u.test(expectedServiceTokenId),
		`Trusted Pages ${environment} Access service-token id is invalid.`
	);
	const candidate = exactTrustedPagesAccessApplication({
		accessApps,
		accountAccessApps,
		zoneAccessApps,
		environment
	});
	const tokenId = exactAccessServiceTokenId(candidate.app, environment);
	invariant(
		tokenId === expectedServiceTokenId,
		`Trusted Pages ${environment} Access policy is not exact Service Auth.`
	);
	return { appId: candidate.app.id, serviceTokenId: expectedServiceTokenId };
}

/**
 * The two origin applications must not accept the same service token. This
 * proves a leaked staging credential cannot authorize production (or vice
 * versa), while each app remains Service-Auth-only.
 * @param {{accessApps?:unknown;accountAccessApps?:unknown;zoneAccessApps?:unknown}} input
 */
export function validateTrustedPagesOriginAccessSeparation({
	accessApps,
	accountAccessApps,
	zoneAccessApps
}) {
	/** @type {Partial<Record<'preview'|'production', string>>} */
	const tokenIds = {};
	for (const environment of /** @type {const} */ (['preview', 'production'])) {
		const candidate = exactTrustedPagesAccessApplication({
			accessApps,
			accountAccessApps,
			zoneAccessApps,
			environment
		});
		tokenIds[environment] = exactAccessServiceTokenId(candidate.app, environment);
	}
	invariant(
		tokenIds.preview !== tokenIds.production,
		'Production and staging Pages origins must use distinct Access service tokens.'
	);
	return tokenIds;
}

/** @param {{lateTransformRuleset:unknown}} input */
export function validateTrustedPagesOriginLateTransform({ lateTransformRuleset }) {
	const result = record(record(lateTransformRuleset)?.result);
	invariant(
		record(lateTransformRuleset)?.success === true &&
			result?.kind === 'zone' &&
			result?.phase === 'http_request_late_transform' &&
			Array.isArray(result.rules),
		'Late-transform ruleset is malformed.'
	);
	const relevant = result.rules.filter((rule) => {
		const headers = record(record(record(rule)?.action_parameters)?.headers);
		return headers !== null && Object.hasOwn(headers, TRUSTED_PAGES_EDGE_ACCESS_HEADER);
	});
	invariant(
		relevant.length === 1 &&
			record(relevant[0])?.enabled !== false &&
			record(relevant[0])?.action === 'rewrite' &&
			record(relevant[0])?.expression === TRUSTED_PAGES_EDGE_LATE_TRANSFORM_EXPRESSION &&
			record(
				record(record(relevant[0])?.action_parameters)?.headers?.[TRUSTED_PAGES_EDGE_ACCESS_HEADER]
			)?.operation === 'remove' &&
			Object.keys(record(record(record(relevant[0])?.action_parameters)?.headers) ?? {}).length ===
				1,
		'Trusted Pages origin token-removal late transform is not exact.'
	);
	return { header: TRUSTED_PAGES_EDGE_ACCESS_HEADER, removed: true };
}

/**
 * Exercise only denied requests. The selected realm's token is intentionally
 * never sent to its own origin here: preview's first successful candidate
 * execution remains the purpose-bound probe, and production remains untouched
 * until terminal C. Each release realm proves its token is denied by the other
 * app, while JWT-only/no-token requests are denied by both.
 * @param {{environment:'preview'|'production';originAccessToken:string|undefined;fetchFn?:typeof fetch}} options
 */
export async function verifyTrustedPagesAccessDenialMatrix({
	environment,
	originAccessToken,
	fetchFn = fetch
}) {
	invariant(
		environment === 'preview' || environment === 'production',
		'Edge environment is invalid.'
	);
	const token = exactOriginAccessToken(originAccessToken);
	const selectedHost = TRUSTED_PAGES_EDGE_REALMS[environment].originHost;
	const oppositeEnvironment = environment === 'production' ? 'preview' : 'production';
	const oppositeHost = TRUSTED_PAGES_EDGE_REALMS[oppositeEnvironment].originHost;
	const parsedToken = JSON.parse(token);
	const wrongId = JSON.stringify({
		'cf-access-client-id': 'wrong-client-id.access',
		'cf-access-client-secret': parsedToken['cf-access-client-secret']
	});
	const wrongSecret = JSON.stringify({
		'cf-access-client-id': parsedToken['cf-access-client-id'],
		'cf-access-client-secret': 'x'.repeat(64)
	});
	/** @type {Array<{host:string;headers:Record<string,string>}>} */
	const attempts = [
		{ host: selectedHost, headers: {} },
		{ host: selectedHost, headers: { [TRUSTED_PAGES_EDGE_ACCESS_HEADER]: '{' } },
		{ host: selectedHost, headers: { [TRUSTED_PAGES_EDGE_ACCESS_HEADER]: wrongId } },
		{ host: selectedHost, headers: { [TRUSTED_PAGES_EDGE_ACCESS_HEADER]: wrongSecret } },
		{ host: selectedHost, headers: { 'cf-access-token': 'header.payload.signature' } },
		{ host: selectedHost, headers: { 'cf-access-jwt-assertion': 'header.payload.signature' } },
		{ host: selectedHost, headers: { cookie: 'CF_Authorization=header.payload.signature' } },
		{
			host: selectedHost,
			headers: {
				'cf-access-client-id': 'wrong-client-id.access',
				'cf-access-client-secret': 'x'.repeat(64)
			}
		},
		{ host: oppositeHost, headers: {} },
		{ host: oppositeHost, headers: { 'cf-access-token': 'header.payload.signature' } },
		{ host: oppositeHost, headers: { 'cf-access-jwt-assertion': 'header.payload.signature' } },
		{ host: oppositeHost, headers: { cookie: 'CF_Authorization=header.payload.signature' } },
		{ host: oppositeHost, headers: { [TRUSTED_PAGES_EDGE_ACCESS_HEADER]: token } }
	];
	const responses = await Promise.all(
		attempts.map(({ host, headers }) =>
			fetchFn(`https://${host}/api/live`, {
				headers,
				method: 'GET',
				redirect: 'error',
				signal: AbortSignal.timeout(15_000)
			})
		)
	);
	for (const response of responses) {
		invariant(
			response.status === 401 || response.status === 403,
			'Access denial matrix admitted an unauthorized origin request.'
		);
		invariant(
			response.headers.get('x-commons-origin-access-token') === null &&
				response.headers.get('x-commons-preview-cache-api') === null,
			'Access denial matrix reached candidate execution.'
		);
		await response.body?.cancel().catch(() => undefined);
	}
	return {
		environment,
		jwtOnlyDeniedByBothOrigins: true,
		malformedAndWrongServiceTokensDenied: true,
		noTokenDeniedByBothOrigins: true,
		selectedTokenDeniedByOppositeOrigin: true
	};
}

/**
 * @param {{accountId:string|undefined;zoneId:string|undefined;apiToken:string|undefined;environment:'preview'|'production';expectedTransactionId:string|undefined;expectedServiceTokenId:string|undefined;fetchFn?:typeof fetch;pagesProject?:string}} options
 */
export async function verifyTrustedPagesReleaseEdge({
	accountId,
	zoneId,
	apiToken,
	environment,
	expectedTransactionId,
	expectedServiceTokenId,
	fetchFn = fetch,
	pagesProject = 'communique-site'
}) {
	invariant(
		typeof accountId === 'string' && accountId.length > 0,
		'CLOUDFLARE_ACCOUNT_ID is required.'
	);
	invariant(typeof zoneId === 'string' && zoneId.length > 0, 'CLOUDFLARE_ZONE_ID is required.');
	invariant(
		typeof apiToken === 'string' && apiToken.length > 0,
		'CLOUDFLARE_API_TOKEN is required.'
	);
	invariant(
		environment === 'preview' || environment === 'production',
		'Edge environment is invalid.'
	);
	const transactionId = exactTransaction(expectedTransactionId, 'PUBLIC_RELEASE_TRANSACTION_ID');
	const expected = TRUSTED_PAGES_EDGE_REALMS[environment];
	const accountBase = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}`;
	const zoneBase = `https://api.cloudflare.com/client/v4/zones/${encodeURIComponent(zoneId)}`;
	const headers = { Authorization: `Bearer ${apiToken}` };
	const requests = [
		`${accountBase}/workers/scripts/${expected.worker}/settings`,
		`${accountBase}/workers/scripts/${expected.worker}/subdomain`,
		`${zoneBase}/workers/routes`,
		`${accountBase}/pages/projects/${encodeURIComponent(pagesProject)}/domains`,
		`${zoneBase}/rulesets/phases/http_request_late_transform/entrypoint`
	];
	const [responses, accountAccessApps, zoneAccessApps] = await Promise.all([
		Promise.all(
			requests.map((url) =>
				fetchFn(url, { headers, redirect: 'error', signal: AbortSignal.timeout(15_000) })
			)
		),
		readTrustedPagesAccessApplicationInventory({
			endpoint: `${accountBase}/access/apps`,
			headers,
			scope: 'account',
			fetchFn
		}),
		readTrustedPagesAccessApplicationInventory({
			endpoint: `${zoneBase}/access/apps`,
			headers,
			scope: 'zone',
			fetchFn
		})
	]);
	for (let index = 0; index < responses.length; index += 1) {
		invariant(
			responses[index]?.ok,
			`Cloudflare topology request ${index + 1} returned HTTP ${responses[index]?.status}.`
		);
	}
	const [settings, subdomain, routes, pagesDomains, lateTransformRuleset] = await Promise.all(
		responses.map((response, index) =>
			readBoundedResponseJson(response, `Cloudflare topology response ${index + 1}`)
		)
	);
	return {
		...validateTrustedPagesEdgeWorker({
			settings,
			subdomain,
			environment,
			expectedTransactionId: transactionId
		}),
		route: validateTrustedPagesEdgeRoute({ routes, environment }),
		originDomains: validateTrustedPagesOriginDomains({ pagesDomains }),
		access: validateTrustedPagesOriginAccess({
			accountAccessApps,
			zoneAccessApps,
			environment,
			expectedServiceTokenId: /** @type {string} */ (expectedServiceTokenId)
		}),
		accessTokenSeparation: validateTrustedPagesOriginAccessSeparation({
			accountAccessApps,
			zoneAccessApps
		}),
		lateTransform: validateTrustedPagesOriginLateTransform({ lateTransformRuleset })
	};
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
	try {
		if (process.argv[2] === 'verify-route-inventory') {
			invariant(
				process.argv.length === 7 &&
					process.argv[3] === '--environment' &&
					(process.argv[4] === 'preview' || process.argv[4] === 'production') &&
					process.argv[5] === '--expected' &&
					(process.argv[6] === 'present' || process.argv[6] === 'absent'),
				'Usage: verify-trusted-pages-release-edge verify-route-inventory --environment preview|production --expected present|absent'
			);
			const input = readFileSync(0);
			invariant(
				input.byteLength > 0 && input.byteLength <= 1_048_576,
				'Worker route inventory input is empty or exceeds 1 MiB.'
			);
			const environment = /** @type {'preview'|'production'} */ (process.argv[4]);
			const expected = /** @type {'present'|'absent'} */ (process.argv[6]);
			const route = validateTrustedPagesEdgeRoute({
				routes: JSON.parse(input.toString('utf8')),
				environment,
				expectedPresent: expected === 'present'
			});
			console.log(JSON.stringify({ environment, expected, route }));
			process.exit(0);
		}
		invariant(
			process.argv.length === 4 &&
				process.argv[2] === '--environment' &&
				(process.argv[3] === 'preview' || process.argv[3] === 'production'),
			'Usage: verify-trusted-pages-release-edge --environment preview|production'
		);
		const environment = /** @type {'preview'|'production'} */ (process.argv[3]);
		const result = await verifyTrustedPagesReleaseEdge({
			accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
			zoneId: process.env.CLOUDFLARE_ZONE_ID,
			apiToken: process.env.CLOUDFLARE_API_TOKEN,
			environment,
			expectedTransactionId: process.env.PUBLIC_RELEASE_TRANSACTION_ID,
			expectedServiceTokenId:
				environment === 'production'
					? process.env.PAGES_ORIGIN_ACCESS_SERVICE_TOKEN_ID_PRODUCTION
					: process.env.PAGES_ORIGIN_ACCESS_SERVICE_TOKEN_ID_PREVIEW
		});
		const denialMatrix = await verifyTrustedPagesAccessDenialMatrix({
			environment,
			originAccessToken: process.env.PAGES_ORIGIN_ACCESS_TOKEN
		});
		console.log(JSON.stringify({ ...result, denialMatrix }));
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
