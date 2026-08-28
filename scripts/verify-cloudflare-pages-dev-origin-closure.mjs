#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { readBoundedResponseJson } from '../src/lib/server/bounded-response.mjs';

const MAX_POLICY_BYTES = 16 * 1024;
const EXPECTED_ACCOUNT_ID = '019d1184e655db74b7589794a2a2a533';
const EXPECTED_LIST_NAME = 'commons_pages_dev_origin_closure_v1';
/** @type {readonly string[]} */
const EXPECTED_BYPASS_PATHS = Object.freeze([]);

/** @param {unknown} condition @param {string} message @returns {asserts condition} */
function invariant(condition, message) {
	if (!condition) throw new Error(message);
}

/** @param {unknown} value @returns {Record<string, any> | null} */
function record(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

/** @param {unknown} value @returns {unknown} */
function canonicalJsonValue(value) {
	if (Array.isArray(value)) return value.map(canonicalJsonValue);
	const object = record(value);
	if (!object) return value;
	return Object.fromEntries(
		Object.keys(object)
			.sort()
			.map((key) => [key, canonicalJsonValue(object[key])])
	);
}

/** @param {unknown} actual @param {unknown} expected */
function exactJsonEqual(actual, expected) {
	return (
		JSON.stringify(canonicalJsonValue(actual)) === JSON.stringify(canonicalJsonValue(expected))
	);
}

/** @param {unknown} info @param {string} label @param {number} actualCount */
function requireExhaustive(info, label, actualCount) {
	const pageInfo = record(info);
	invariant(pageInfo !== null, `${label} pagination metadata is missing or malformed.`);
	const cursors = record(pageInfo.cursors);
	invariant(cursors !== null, `${label} cursor metadata is missing or malformed.`);
	invariant(
		cursors.after === undefined || cursors.after === null || cursors.after === '',
		`${label} proof is paginated and therefore not exhaustive.`
	);
	if (cursors.before !== undefined) {
		invariant(
			cursors.before === null || typeof cursors.before === 'string',
			`${label} before cursor is malformed.`
		);
	}
	for (const field of ['count', 'total_count']) {
		if (pageInfo[field] === undefined) continue;
		invariant(
			Number.isSafeInteger(pageInfo[field]) && pageInfo[field] === actualCount,
			`${label} ${field} does not match the returned exhaustive result.`
		);
	}
}

/** @param {unknown} value */
export function validateCloudflarePagesDevOriginClosurePolicy(value) {
	const policy = record(value);
	invariant(policy?.version === 1, 'Pages.dev origin-closure policy must be version 1.');
	invariant(policy?.accountId === EXPECTED_ACCOUNT_ID, 'Pages.dev origin closure account drifted.');
	invariant(
		policy?.pagesProject === 'communique-site' &&
			policy?.pagesDevHost === 'communique-site.pages.dev' &&
			policy?.canonicalHost === 'commons.email',
		'Pages.dev origin closure must bind the exact Pages project and canonical host.'
	);
	const list = record(policy.redirectList);
	invariant(
		list?.name === EXPECTED_LIST_NAME && list?.kind === 'redirect',
		'Pages.dev origin closure must use the dedicated redirect list.'
	);
	const items = list.items;
	invariant(Array.isArray(items) && items.length === 1, 'Origin-closure list needs one item.');
	invariant(
		exactJsonEqual(items[0], {
			source_url: 'communique-site.pages.dev',
			target_url: 'https://commons.email',
			status_code: 301,
			include_subdomains: true,
			subpath_matching: true,
			preserve_query_string: true,
			preserve_path_suffix: true
		}),
		'Pages.dev redirect item must cover the root, every deployment/branch subdomain, path, and query.'
	);
	const entrypoint = record(policy.entrypoint);
	const rule = record(entrypoint?.requiredFirstRule);
	invariant(
		entrypoint?.kind === 'root' && entrypoint?.phase === 'http_request_redirect',
		'Pages.dev closure must use the account http_request_redirect entry point.'
	);
	invariant(
		rule?.ref === EXPECTED_LIST_NAME &&
			rule?.description === 'Close direct communique-site.pages.dev cost-bearing origins' &&
			rule?.enabled === true &&
			rule?.action === 'redirect',
		'Pages.dev closure first rule identity drifted.'
	);
	const expectedExpression = '(http.request.full_uri in $commons_pages_dev_origin_closure_v1)';
	invariant(rule?.expression === expectedExpression, 'Pages.dev closure expression drifted.');
	invariant(
		exactJsonEqual(rule?.action_parameters, {
			from_list: { name: EXPECTED_LIST_NAME, key: 'http.request.full_uri' }
		}),
		'Pages.dev closure must evaluate the exact dedicated redirect list.'
	);
	invariant(
		JSON.stringify(policy.releaseProbeBypassPaths) === JSON.stringify(EXPECTED_BYPASS_PATHS),
		'Pages.dev origin closure must not retain any release-probe bypass.'
	);
	return /** @type {any} */ (policy);
}

/** @param {unknown} envelope @param {any} policy */
export function validateCloudflarePagesDevRedirectList(envelope, policy) {
	const response = record(envelope);
	invariant(response?.success === true, 'Cloudflare redirect-list inventory did not succeed.');
	invariant(Array.isArray(response.result), 'Cloudflare redirect-list result is not an array.');
	requireExhaustive(
		response.result_info,
		'Cloudflare redirect-list inventory',
		response.result.length
	);
	const matches = response.result.filter(
		(candidate) => record(candidate)?.name === policy.redirectList.name
	);
	invariant(
		matches.length === 1,
		'Cloudflare needs exactly one dedicated pages.dev redirect list.'
	);
	const list = record(matches[0]);
	invariant(list !== null, 'Cloudflare pages.dev redirect list is malformed.');
	invariant(list?.kind === 'redirect', 'Cloudflare pages.dev list is not a redirect list.');
	invariant(
		typeof list.id === 'string' && /^[a-f0-9]{32}$/u.test(list.id),
		'Cloudflare pages.dev redirect list ID is malformed.'
	);
	return list.id;
}

/** @param {unknown} envelope @param {any} policy */
export function validateCloudflarePagesDevRedirectItems(envelope, policy) {
	const response = record(envelope);
	invariant(response?.success === true, 'Cloudflare redirect-list item read did not succeed.');
	invariant(Array.isArray(response.result), 'Cloudflare redirect-list items are not an array.');
	requireExhaustive(response.result_info, 'Cloudflare redirect-list items', response.result.length);
	invariant(
		response.result.length === 1,
		'Dedicated pages.dev redirect list must contain one item.'
	);
	const item = record(response.result[0]);
	invariant(item !== null, 'Cloudflare pages.dev redirect item is malformed.');
	invariant(
		exactJsonEqual(record(item.redirect), policy.redirectList.items[0]),
		'Cloudflare pages.dev redirect item drifted.'
	);
	return { itemId: item.id };
}

/** @param {unknown} envelope @param {any} policy */
export function validateCloudflarePagesDevRedirectEntrypoint(envelope, policy) {
	const response = record(envelope);
	invariant(response?.success === true, 'Cloudflare redirect entry-point read did not succeed.');
	const ruleset = record(response.result);
	invariant(ruleset !== null, 'Cloudflare redirect entry point is malformed.');
	invariant(
		ruleset.kind === policy.entrypoint.kind && ruleset.phase === policy.entrypoint.phase,
		'Cloudflare redirect entry point has the wrong kind or phase.'
	);
	invariant(
		Array.isArray(ruleset.rules) && ruleset.rules.length > 0,
		'Cloudflare redirect entry point has no rules.'
	);
	const actual = record(ruleset.rules[0]);
	const expected = policy.entrypoint.requiredFirstRule;
	invariant(actual !== null, 'Cloudflare first redirect rule is malformed.');
	for (const key of ['ref', 'description', 'enabled', 'action', 'expression']) {
		invariant(actual[key] === expected[key], `Cloudflare first redirect rule ${key} drifted.`);
	}
	invariant(
		exactJsonEqual(actual.action_parameters, expected.action_parameters),
		'Cloudflare first redirect rule parameters drifted.'
	);
	return { rulesetId: ruleset.id, ruleId: actual.id, ref: actual.ref };
}

/**
 * @param {{policy: unknown, apiToken: string | undefined, fetchFn?: typeof fetch}} options
 */
export async function verifyCloudflarePagesDevOriginClosure({ policy, apiToken, fetchFn = fetch }) {
	const exact = validateCloudflarePagesDevOriginClosurePolicy(policy);
	invariant(
		typeof apiToken === 'string' && apiToken.length > 0,
		'CLOUDFLARE_API_TOKEN is required.'
	);
	const headers = { Authorization: `Bearer ${apiToken}` };
	const base = `https://api.cloudflare.com/client/v4/accounts/${exact.accountId}`;
	/** @param {string} url @param {string} label */
	const readJson = async (url, label) => {
		const response = await fetchFn(url, {
			headers,
			redirect: 'error',
			signal: AbortSignal.timeout(15_000)
		});
		if (response.status === 403) {
			throw new Error(
				'Cloudflare token cannot prove pages.dev origin closure; grant Account Filter Lists Read and Bulk URL Redirects Read.'
			);
		}
		invariant(response.ok, `${label} returned HTTP ${response.status}.`);
		return readBoundedResponseJson(response, `${label} response`);
	};
	const lists = await readJson(`${base}/rules/lists?per_page=100`, 'Cloudflare redirect lists');
	const listId = validateCloudflarePagesDevRedirectList(lists, exact);
	const items = await readJson(
		`${base}/rules/lists/${encodeURIComponent(listId)}/items?per_page=100`,
		'Cloudflare redirect-list items'
	);
	validateCloudflarePagesDevRedirectItems(items, exact);
	const entrypoint = await readJson(
		`${base}/rulesets/phases/http_request_redirect/entrypoint`,
		'Cloudflare redirect entry point'
	);
	return validateCloudflarePagesDevRedirectEntrypoint(entrypoint, exact);
}

/** @param {string[]} argv */
export function parseCloudflarePagesDevOriginClosureArgs(argv) {
	invariant(argv.length === 2 && argv[0] === '--policy', 'Usage: --policy <trusted-policy.json>.');
	invariant(Boolean(argv[1]) && !argv[1].startsWith('--'), '--policy requires a value.');
	return { policyPath: argv[1] };
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
	try {
		const { policyPath } = parseCloudflarePagesDevOriginClosureArgs(process.argv.slice(2));
		const bytes = readFileSync(policyPath);
		invariant(bytes.length <= MAX_POLICY_BYTES, 'Pages.dev origin-closure policy exceeds 16 KiB.');
		const policy = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
		console.log(
			JSON.stringify(
				await verifyCloudflarePagesDevOriginClosure({
					policy,
					apiToken: process.env.CLOUDFLARE_API_TOKEN
				})
			)
		);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
