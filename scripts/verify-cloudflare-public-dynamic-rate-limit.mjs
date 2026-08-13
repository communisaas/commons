#!/usr/bin/env node

import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
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
	'/api/agents/',
	'/api/auth/passkey/',
	'/api/c/',
	'/api/campaigns/',
	'/api/d/',
	'/api/debates/',
	'/api/deliveries/',
	'/api/dm/',
	'/api/e/',
	'/api/email/confirm/',
	'/api/embed/',
	'/api/ground/',
	'/api/location/',
	'/api/moderation/',
	'/api/positions/',
	'/api/proofs/',
	'/api/shadow-atlas/',
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
	const routeFamilies = inventory?.requiredExecutableRouteFamilies;
	invariant(
		Array.isArray(routeFamilies) && routeFamilies.length > 0,
		'requiredExecutableRouteFamilies must be a non-empty array.'
	);
	const familyKeys = new Set();
	for (const familyValue of routeFamilies) {
		const family = record(familyValue);
		invariant(
			family !== null &&
				Object.keys(family).sort().join('\0') ===
					['authorityCall', 'boundaryCall', 'pathPrefix', 'sourceRoot'].sort().join('\0'),
			'Every executable route family must contain only sourceRoot, pathPrefix, authorityCall, and boundaryCall.'
		);
		invariant(
			typeof family.sourceRoot === 'string' &&
				family.sourceRoot.startsWith('src/routes/') &&
				!path.isAbsolute(family.sourceRoot) &&
				!family.sourceRoot.split('/').includes('..'),
			'Executable route family sourceRoot must stay under src/routes.'
		);
		invariant(
			typeof family.pathPrefix === 'string' &&
				family.pathPrefix.startsWith('/') &&
				family.pathPrefix.endsWith('/'),
			'Executable route family pathPrefix must be an absolute trailing-slash prefix.'
		);
		invariant(
			family.authorityCall === 'requireAuthenticatedAgentRequest',
			'Executable agent routes must use the trusted first-statement authentication authority.'
		);
		invariant(
			family.boundaryCall === 'readBoundedAgentRequest',
			'Executable agent routes must use the reviewed bounded request-envelope authority.'
		);
		const key = `${family.sourceRoot}\0${family.pathPrefix}`;
		invariant(!familyKeys.has(key), `Duplicate executable route family: ${family.sourceRoot}.`);
		familyKeys.add(key);
	}
	return /** @type {any} */ (inventory);
}

const EXPORTED_ROUTE_HANDLER_PATTERN =
	/export const ([A-Z]+): RequestHandler = async \(event\) => \{/gu;
const HTTP_METHOD_NAMES = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);

/** @param {import('typescript').Node} node @param {import('typescript').SyntaxKind} kind */
function hasModifier(node, kind) {
	return (
		ts.canHaveModifiers(node) &&
		(ts.getModifiers(node)?.some((modifier) => modifier.kind === kind) ?? false)
	);
}

/**
 * Parse exports instead of pattern-matching them so alternate declarations,
 * comments, line breaks, escaped identifiers, and named re-exports cannot hide
 * an unauthenticated paid handler beside one compliant route method.
 *
 * @param {string} source
 */
function exportedHttpMethods(source) {
	const sourceFile = ts.createSourceFile(
		'+server.ts',
		source,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS
	);
	const parseDiagnostics =
		/** @type {import('typescript').SourceFile & { parseDiagnostics: readonly import('typescript').Diagnostic[] }} */ (
			sourceFile
		).parseDiagnostics;
	invariant(
		parseDiagnostics.length === 0,
		'Executable route source must be syntactically valid TypeScript.'
	);
	/** @type {string[]} */
	const methods = [];
	for (const statement of sourceFile.statements) {
		if (ts.isExportDeclaration(statement)) {
			invariant(
				statement.exportClause && ts.isNamedExports(statement.exportClause),
				'Executable route source cannot use a wildcard export.'
			);
			for (const element of statement.exportClause.elements) {
				if (HTTP_METHOD_NAMES.has(element.name.text)) methods.push(element.name.text);
			}
			continue;
		}
		if (
			!hasModifier(statement, ts.SyntaxKind.ExportKeyword) ||
			hasModifier(statement, ts.SyntaxKind.DefaultKeyword)
		) {
			continue;
		}
		if (ts.isVariableStatement(statement)) {
			for (const declaration of statement.declarationList.declarations) {
				if (ts.isIdentifier(declaration.name) && HTTP_METHOD_NAMES.has(declaration.name.text)) {
					methods.push(declaration.name.text);
				}
			}
			continue;
		}
		const name = /** @type {import('typescript').NamedDeclaration} */ (
			/** @type {unknown} */ (statement)
		).name;
		if (
			name &&
			(ts.isIdentifier(name) || ts.isStringLiteral(name)) &&
			HTTP_METHOD_NAMES.has(name.text)
		) {
			methods.push(name.text);
		}
	}
	return methods;
}

/** @param {string} source @param {string} authorityCall @param {string} [boundaryCall] */
export function validateFirstStatementAuthority(source, authorityCall, boundaryCall = undefined) {
	const handlers = [...source.matchAll(EXPORTED_ROUTE_HANDLER_PATTERN)];
	const exportedMethods = exportedHttpMethods(source);
	invariant(handlers.length > 0, 'Executable route source has no standard RequestHandler export.');
	invariant(
		exportedMethods.length === handlers.length &&
			exportedMethods.every((method, index) => method === handlers[index][1]),
		'Every exported HTTP handler must use the reviewed async (event) RequestHandler form.'
	);
	for (let index = 0; index < handlers.length; index += 1) {
		const handler = handlers[index];
		const bodyStart = /** @type {number} */ (handler.index) + handler[0].length;
		const bodyEnd = handlers[index + 1]?.index ?? source.length;
		const body = source.slice(bodyStart, bodyEnd);
		const preamble = new RegExp(
			`^\\s*const authenticatedUserId = ${authorityCall}\\(event\\);\\s*` +
				'if \\(authenticatedUserId instanceof Response\\) return authenticatedUserId;' +
				(boundaryCall
					? `\\s*const requestEnvelope = await ${boundaryCall}\\(event, ['\"][a-z-]+['\"]\\);\\s*` +
						'if \\(requestEnvelope instanceof Response\\) return requestEnvelope;'
					: ''),
			'u'
		);
		invariant(
			preamble.test(body),
			`${handler[1]} handler must authenticate as its first executable statements.`
		);
	}
	return handlers.length;
}

/**
 * Walk each declared executable route family. A broad WAF prefix protects every
 * current and future handler in the family, while an exact first-statement
 * application authority prevents anonymous paid work even when isolate-local
 * counters reset.
 *
 * @param {unknown} inventoryValue
 * @param {unknown} policyValue
 * @param {{ repoRoot?: string }} [options]
 */
export function validateExecutableDynamicRouteFamilyCoverage(
	inventoryValue,
	policyValue,
	{ repoRoot = process.cwd() } = {}
) {
	const inventory = validateAnonymousDynamicRouteCostInventory(inventoryValue);
	const policy = validatePublicDynamicRateLimitPolicy(policyValue);
	const absoluteRepoRoot = realpathSync(repoRoot);
	const repoPrefix = `${absoluteRepoRoot}${path.sep}`;
	let executableRoutes = 0;
	let handlers = 0;

	for (const family of inventory.requiredExecutableRouteFamilies) {
		const requestedRoot = path.resolve(absoluteRepoRoot, family.sourceRoot);
		const rootStat = lstatSync(requestedRoot);
		invariant(
			rootStat.isDirectory() && !rootStat.isSymbolicLink(),
			`${family.sourceRoot} must be a real directory.`
		);
		const sourceRoot = realpathSync(requestedRoot);
		invariant(
			sourceRoot === absoluteRepoRoot || sourceRoot.startsWith(repoPrefix),
			`${family.sourceRoot} escapes the repository root.`
		);

		/** @type {string[]} */
		const routeSources = [];
		/** @param {string} directory */
		function visit(directory) {
			for (const name of readdirSync(directory).sort()) {
				const entry = path.join(directory, name);
				const stat = lstatSync(entry);
				invariant(!stat.isSymbolicLink(), `Executable route inventory forbids symlink: ${entry}.`);
				if (stat.isDirectory()) visit(entry);
				else if (stat.isFile() && name === '+server.ts') routeSources.push(entry);
			}
		}
		visit(sourceRoot);
		invariant(routeSources.length > 0, `${family.sourceRoot} contains no executable routes.`);

		for (const routeSource of routeSources) {
			const relative = path.relative(sourceRoot, routeSource).split(path.sep).join('/');
			const suffix = relative === '+server.ts' ? '' : relative.slice(0, -'/+server.ts'.length);
			const pathname = `${family.pathPrefix}${suffix}`;
			invariant(
				publicDynamicPathMatchesPolicy(pathname, policy),
				`Executable dynamic route is missing from the Cloudflare shield: ${pathname}.`
			);
			const bytes = readFileSync(routeSource);
			invariant(
				bytes.length <= 512 * 1024,
				`Executable route source exceeds 512 KiB: ${relative}.`
			);
			const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
			try {
				handlers += validateFirstStatementAuthority(
					source,
					family.authorityCall,
					family.boundaryCall
				);
			} catch (error) {
				throw new Error(
					`${path.relative(absoluteRepoRoot, routeSource)}: ${error instanceof Error ? error.message : String(error)}`,
					{ cause: error }
				);
			}
			executableRoutes += 1;
		}
	}

	return {
		executableRoutes,
		families: inventory.requiredExecutableRouteFamilies.length,
		handlers
	};
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
 * @param {{policy: unknown, inventory: unknown, apiToken: string | undefined, fetchFn?: typeof fetch, repoRoot?: string}} options
 */
export async function verifyCloudflarePublicDynamicRateLimit({
	policy,
	inventory,
	apiToken,
	fetchFn = fetch,
	repoRoot = process.cwd()
}) {
	const exactPolicy = validatePublicDynamicRateLimitPolicy(policy);
	validateAnonymousDynamicRouteInventoryCoverage(inventory, exactPolicy);
	validateExecutableDynamicRouteFamilyCoverage(inventory, exactPolicy, { repoRoot });
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
		const repoRoot = path.dirname(path.dirname(path.resolve(policyPath)));
		console.log(
			JSON.stringify(
				await verifyCloudflarePublicDynamicRateLimit({
					policy,
					inventory,
					apiToken: process.env.CLOUDFLARE_API_TOKEN,
					repoRoot
				})
			)
		);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
