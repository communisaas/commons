#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { readBoundedResponseJson } from '../src/lib/server/bounded-response.mjs';

const MAX_POLICY_BYTES = 16 * 1024;
const MAX_INVENTORY_BYTES = 16 * 1024;

export const ANONYMOUS_DYNAMIC_ROUTE_INVENTORY_PATH =
	'config/anonymous-dynamic-route-cost-inventory.json';
export const ANONYMOUS_DYNAMIC_ROUTE_INVENTORY_SOURCE =
	'docs/ops/ANONYMOUS-DYNAMIC-ROUTE-INVENTORY.md';

export const PUBLIC_DYNAMIC_EXACT_PATHS = Object.freeze([
	'/',
	'/api/release-origin',
	'/api/waitlist',
	'/api/templates',
	'/browse',
	'/deliberation',
	'/directory',
	'/governance',
	'/org',
	'/unsubscribe'
]);
export const PUBLIC_DYNAMIC_PATH_PREFIXES = Object.freeze([
	'/accountability/',
	'/api/auth/passkey/',
	'/api/c/',
	'/api/campaigns/',
	'/api/d/',
	'/api/debates/',
	'/api/dm/',
	'/api/e/',
	'/api/email/confirm/',
	'/api/embed/',
	'/api/ground/',
	'/api/location/',
	'/api/positions/count/',
	'/api/positions/engagement-by-district/',
	'/api/proofs/',
	'/api/submissions/',
	'/api/templates/',
	'/c/',
	'/d/',
	'/dm/',
	'/e/',
	'/embed/',
	'/n/',
	'/og/',
	'/org/invite/',
	'/s/',
	'/template-modal/',
	'/unsubscribe/',
	'/v/',
	'/verify/'
]);

function expectedPublicDynamicExpression() {
	const clauses = [
		...PUBLIC_DYNAMIC_EXACT_PATHS.map((path) => `http.request.uri.path eq ${JSON.stringify(path)}`),
		...PUBLIC_DYNAMIC_PATH_PREFIXES.map(
			(prefix) => `starts_with(http.request.uri.path, ${JSON.stringify(prefix)})`
		)
	];
	return `(${clauses.join(' or ')})`;
}

/** @param {string} pathname @param {any} policy */
export function publicDynamicPathMatchesPolicy(pathname, policy) {
	const scope = record(record(policy)?.ruleset)?.scope;
	return (
		typeof pathname === 'string' &&
		((Array.isArray(scope?.exactPaths) && scope.exactPaths.includes(pathname)) ||
			(Array.isArray(scope?.prefixes) &&
				scope.prefixes.some((/** @type {unknown} */ prefix) =>
					typeof prefix === 'string' ? pathname.startsWith(prefix) : false
				)))
	);
}

/** @param {unknown} condition @param {string} message @returns {asserts condition} */
function invariant(condition, message) {
	if (!condition) throw new Error(message);
}

/** @param {unknown} value @returns {Record<string, any> | null} */
function record(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

/** @param {unknown} value */
export function validatePublicDynamicRateLimitPolicy(value) {
	const policy = record(value);
	invariant(policy?.version === 1, 'Public dynamic rate-limit policy must be version 1.');
	const zone = record(policy.zone);
	invariant(
		/^[a-f0-9]{32}$/.test(zone?.accountId),
		'Public dynamic rate-limit policy needs an exact Cloudflare account id.'
	);
	invariant(
		zone?.name === 'commons.email',
		'Public dynamic rate-limit policy must target commons.email.'
	);
	invariant(
		zone?.plan === 'Free Website',
		'Public dynamic rate-limit policy must pin the verified zero-cost Free Website plan.'
	);
	const ruleset = record(policy.ruleset);
	invariant(
		ruleset?.kind === 'zone' && ruleset?.phase === 'http_ratelimit',
		'Public dynamic cost shield must be a zone http_ratelimit entry-point ruleset.'
	);
	const scope = record(ruleset.scope);
	invariant(
		scope?.inventoryPath === ANONYMOUS_DYNAMIC_ROUTE_INVENTORY_PATH,
		'Public dynamic cost shield must bind the canonical anonymous route inventory.'
	);
	invariant(
		scope?.methodScope === 'all',
		'Cloudflare Free cannot match HTTP method; every method on a reviewed path must share the shield.'
	);
	invariant(
		JSON.stringify(scope?.exactPaths) === JSON.stringify(PUBLIC_DYNAMIC_EXACT_PATHS) &&
			JSON.stringify(scope?.prefixes) === JSON.stringify(PUBLIC_DYNAMIC_PATH_PREFIXES),
		'Public dynamic cost shield route inventory drifted.'
	);
	invariant(
		Array.isArray(ruleset.rules) && ruleset.rules.length === 1,
		'The Free plan must contain exactly one reviewed rate-limit rule.'
	);
	const rule = record(ruleset.rules[0]);
	invariant(
		rule?.ref === 'commons_public_dynamic_cost_shield_v1',
		'Public dynamic cost shield ref is not the committed v1 rule.'
	);
	invariant(
		rule.description === 'Commons public dynamic route cost shield v1',
		'Public dynamic cost shield description changed.'
	);
	invariant(rule.enabled === true, 'Public dynamic cost shield must be enabled.');
	invariant(
		rule.action === 'block',
		'Public dynamic cost shield must block over-budget requests for the Free-plan mitigation period.'
	);
	invariant(
		rule.expression === expectedPublicDynamicExpression(),
		'Public dynamic cost shield must cover the exact reviewed anonymous cost-route inventory without an unbounded actor bypass.'
	);
	const rate = record(rule.ratelimit);
	const capacity = record(ruleset.capacityModel);
	invariant(
		capacity?.workersFreeAccountRequestsPerDay === 100_000 &&
			capacity?.nominalSingleIpColoAdmissionsPerDay === 51_840 &&
			capacity?.admissionsPerPeriod === 6 &&
			capacity?.periodsPerDay === 8_640 &&
			typeof capacity?.warning === 'string' &&
			capacity.warning.includes('never a global quota guarantee'),
		'Public dynamic cost shield must retain the reviewed Free-account capacity model.'
	);
	invariant(
		JSON.stringify(rate?.characteristics) === JSON.stringify(['cf.colo.id', 'ip.src']),
		'Public dynamic cost shield must count independently by Cloudflare location and client IP.'
	);
	invariant(
		rate?.period === 10 &&
			rate?.requests_per_period === 6 &&
			rate?.mitigation_timeout === 10 &&
			rate?.requests_to_origin === false,
		'Public dynamic cost shield must enforce the reviewed Free-plan 6-request/10-second limit and 10-second block.'
	);
	return /** @type {any} */ (policy);
}

/** @param {unknown} value */
export function validateAnonymousDynamicRouteCostInventory(value) {
	const inventory = record(value);
	invariant(inventory?.version === 1, 'Anonymous dynamic-route inventory must be version 1.');
	invariant(
		inventory?.sourceDocument === ANONYMOUS_DYNAMIC_ROUTE_INVENTORY_SOURCE,
		'Anonymous dynamic-route inventory source document drifted.'
	);
	invariant(
		inventory?.methodScope === 'all' &&
			typeof inventory?.methodRationale === 'string' &&
			inventory.methodRationale.includes('cannot match HTTP method'),
		'Anonymous dynamic-route inventory must document the intentional all-method Free-plan bucket.'
	);
	for (const key of ['requiredWafPathExamples', 'requiredBypassPathExamples']) {
		const paths = inventory?.[key];
		invariant(Array.isArray(paths) && paths.length > 0, `${key} must be a non-empty array.`);
		invariant(
			new Set(paths).size === paths.length &&
				paths.every(
					(pathname) =>
						typeof pathname === 'string' && pathname.startsWith('/') && !pathname.includes('?')
				),
			`${key} must contain unique path-only examples.`
		);
	}
	return /** @type {any} */ (inventory);
}

/** @param {unknown} inventoryValue @param {unknown} policyValue */
export function validateAnonymousDynamicRouteInventoryCoverage(inventoryValue, policyValue) {
	const inventory = validateAnonymousDynamicRouteCostInventory(inventoryValue);
	const policy = record(policyValue);
	invariant(policy !== null, 'Public dynamic rate-limit policy must be an object.');
	for (const pathname of inventory.requiredWafPathExamples) {
		invariant(
			publicDynamicPathMatchesPolicy(pathname, policy),
			`Anonymous dynamic cost route is missing from the Cloudflare shield: ${pathname}.`
		);
	}
	for (const pathname of inventory.requiredBypassPathExamples) {
		invariant(
			!publicDynamicPathMatchesPolicy(pathname, policy),
			`Approved dependency probe must bypass the public dynamic cost shield: ${pathname}.`
		);
	}
	validatePublicDynamicRateLimitPolicy(policy);
	return {
		methodScope: inventory.methodScope,
		protectedExamples: inventory.requiredWafPathExamples.length,
		bypassExamples: inventory.requiredBypassPathExamples.length
	};
}

/** @param {unknown} envelope @param {any} policy */
export function validatePublicDynamicRateLimitZone(envelope, policy) {
	const response = record(envelope);
	invariant(response?.success === true, 'Cloudflare zone inventory did not succeed.');
	invariant(Array.isArray(response.result), 'Cloudflare zone inventory result is not an array.');
	invariant(
		response.result_info?.total_pages === 1,
		'Cloudflare zone inventory proof must be exhaustive in one page.'
	);
	const matches = response.result.filter((candidate) => {
		const zone = record(candidate);
		return zone?.name === policy.zone.name && zone?.account?.id === policy.zone.accountId;
	});
	invariant(
		matches.length === 1,
		'Cloudflare zone inventory does not contain exactly one target zone.'
	);
	const zone = record(matches[0]);
	invariant(zone?.status === 'active', 'Cloudflare target zone is not active.');
	invariant(
		zone?.plan?.name === policy.zone.plan,
		'Cloudflare target zone is not on the reviewed Free plan.'
	);
	return zone.id;
}

/** @param {unknown} envelope @param {any} policy */
export function validatePublicDynamicRateLimitRuleset(envelope, policy) {
	const response = record(envelope);
	invariant(response?.success === true, 'Cloudflare rate-limit ruleset read did not succeed.');
	const actual = record(response.result);
	invariant(actual !== null, 'Cloudflare rate-limit entry-point result must be an object.');
	invariant(
		actual.kind === policy.ruleset.kind && actual.phase === policy.ruleset.phase,
		'Cloudflare rate-limit entry-point ruleset has the wrong kind or phase.'
	);
	invariant(
		Array.isArray(actual.rules) && actual.rules.length === 1,
		'Cloudflare Free-plan rate-limit slot must contain exactly the reviewed cost shield.'
	);
	const expectedRule = policy.ruleset.rules[0];
	const actualRule = record(actual.rules[0]);
	invariant(actualRule !== null, 'Cloudflare public dynamic cost-shield rule is malformed.');
	for (const key of ['ref', 'description', 'enabled', 'expression', 'action']) {
		invariant(
			actualRule?.[key] === expectedRule[key],
			`Cloudflare public dynamic cost shield ${key} drifted.`
		);
	}
	invariant(
		actualRule?.action_parameters === undefined ||
			Object.keys(record(actualRule.action_parameters) ?? {}).length === 0,
		'Cloudflare public dynamic cost shield has unexpected action parameters.'
	);
	const expectedRate = expectedRule.ratelimit;
	const actualRate = record(actualRule?.ratelimit);
	invariant(
		JSON.stringify(actualRate?.characteristics) === JSON.stringify(expectedRate.characteristics),
		'Cloudflare public dynamic cost shield counting characteristics drifted.'
	);
	for (const key of ['period', 'requests_per_period', 'mitigation_timeout', 'requests_to_origin']) {
		invariant(
			actualRate?.[key] === expectedRate[key],
			`Cloudflare public dynamic cost shield ratelimit.${key} drifted.`
		);
	}
	return {
		zone: policy.zone.name,
		plan: policy.zone.plan,
		ruleId: actualRule.id,
		ref: actualRule.ref
	};
}

/**
 * @param {{policy: unknown, inventory: unknown, apiToken: string | undefined, fetchFn?: typeof fetch}} options
 */
export async function verifyCloudflarePublicDynamicRateLimit({
	policy,
	inventory,
	apiToken,
	fetchFn = fetch
}) {
	const exactPolicy = validatePublicDynamicRateLimitPolicy(policy);
	validateAnonymousDynamicRouteInventoryCoverage(inventory, exactPolicy);
	invariant(
		typeof apiToken === 'string' && apiToken.length > 0,
		'CLOUDFLARE_API_TOKEN is required.'
	);
	const headers = { Authorization: `Bearer ${apiToken}` };
	const zoneUrl = new URL('https://api.cloudflare.com/client/v4/zones');
	zoneUrl.searchParams.set('account.id', exactPolicy.zone.accountId);
	zoneUrl.searchParams.set('name', exactPolicy.zone.name);
	zoneUrl.searchParams.set('status', 'active');
	zoneUrl.searchParams.set('page', '1');
	zoneUrl.searchParams.set('per_page', '50');
	const zones = await fetchFn(zoneUrl, {
		headers,
		redirect: 'error',
		signal: AbortSignal.timeout(15_000)
	});
	invariant(zones.ok, `Cloudflare zone inventory returned HTTP ${zones.status}.`);
	const zoneId = validatePublicDynamicRateLimitZone(
		await readBoundedResponseJson(zones, 'Cloudflare zone inventory response'),
		exactPolicy
	);

	const ruleset = await fetchFn(
		`https://api.cloudflare.com/client/v4/zones/${encodeURIComponent(zoneId)}/rulesets/phases/http_ratelimit/entrypoint`,
		{ headers, redirect: 'error', signal: AbortSignal.timeout(15_000) }
	);
	if (ruleset.status === 403) {
		throw new Error(
			'Cloudflare token cannot read the public dynamic rate-limit ruleset; grant Zone WAF Read for commons.email.'
		);
	}
	invariant(
		ruleset.ok,
		`Cloudflare public dynamic rate-limit ruleset returned HTTP ${ruleset.status}; the external launch gate is not proven.`
	);
	return validatePublicDynamicRateLimitRuleset(
		await readBoundedResponseJson(ruleset, 'Cloudflare public dynamic rate-limit ruleset response'),
		exactPolicy
	);
}

/** @param {string[]} argv */
export function parsePublicDynamicRateLimitArgs(argv) {
	const values = new Map();
	for (let index = 0; index < argv.length; index += 2) {
		const flag = argv[index];
		const value = argv[index + 1];
		invariant(
			['--policy', '--inventory'].includes(flag) &&
				typeof value === 'string' &&
				!value.startsWith('--') &&
				!values.has(flag),
			'Usage: --policy <trusted-policy.json> --inventory <trusted-inventory.json>.'
		);
		values.set(flag, value);
	}
	invariant(
		values.size === 2,
		'Usage: --policy <trusted-policy.json> --inventory <trusted-inventory.json>.'
	);
	return { policyPath: values.get('--policy'), inventoryPath: values.get('--inventory') };
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
	try {
		const { policyPath, inventoryPath } = parsePublicDynamicRateLimitArgs(process.argv.slice(2));
		const bytes = readFileSync(policyPath);
		invariant(bytes.length <= MAX_POLICY_BYTES, 'Public dynamic rate-limit policy exceeds 16 KiB.');
		const policy = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
		const inventoryBytes = readFileSync(inventoryPath);
		invariant(
			inventoryBytes.length <= MAX_INVENTORY_BYTES,
			'Anonymous dynamic-route inventory exceeds 16 KiB.'
		);
		const inventory = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(inventoryBytes));
		console.log(
			JSON.stringify(
				await verifyCloudflarePublicDynamicRateLimit({
					policy,
					inventory,
					apiToken: process.env.CLOUDFLARE_API_TOKEN
				})
			)
		);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
