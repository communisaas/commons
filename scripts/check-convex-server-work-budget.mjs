#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import ts from 'typescript';

const ROOT = process.cwd();
const SOURCE_ROOT = path.join(ROOT, 'src');
const POLICY_PATH = path.join(ROOT, 'config/convex-work-budget-policy.json');
const MANIFEST_CRON_CONFIG_PATH = path.join(ROOT, 'wrangler.public-discovery-manifest.toml');
const MANIFEST_GATE_SOURCE_PATH = path.join(
	ROOT,
	'workers/public-discovery-manifest-refresh-gate.ts'
);
const DEPLOY_WORKFLOW_PATH = path.join(ROOT, '.github/workflows/deploy.yml');
const WRAPPER_MODULE = '$lib/server/convex-work-budget';
const RAW_MODULE = 'convex-sveltekit';
const RAW_ADAPTER_FILE = 'src/lib/server/convex-work-budget.ts';
/** @type {Readonly<Record<string, 'action'|'mutation'|'query'>>} */
const HELPER_KINDS = Object.freeze({
	budgetedServerQuery: 'query',
	serverAction: 'action',
	serverMutation: 'mutation',
	serverQuery: 'query'
});
const DIRECT_CLIENT_ALLOWLIST = new Set(['src/routes/api/health/+server.ts']);
/** @type {Readonly<Record<string, readonly string[]>>} */
const RAW_MODULE_IMPORTS = Object.freeze({
	'src/hooks.client.ts': ['initConvex'],
	'src/hooks.ts': ['decodeConvexLoad', 'encodeConvexLoad'],
	[RAW_ADAPTER_FILE]: ['initConvex', 'serverAction', 'serverMutation', 'serverQuery']
});

/** @param {unknown} condition @param {string} message @returns {asserts condition} */
function invariant(condition, message) {
	if (!condition) throw new Error(message);
}

/** @param {string} directory @returns {string[]} */
function walk(directory) {
	/** @type {string[]} */
	const files = [];
	for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
		const absolute = path.join(directory, entry.name);
		if (entry.isDirectory()) files.push(...walk(absolute));
		else if (/\.(?:js|svelte|ts)$/.test(entry.name)) files.push(absolute);
	}
	return files.sort();
}

/** @param {ts.Expression | undefined} expression */
function staticApiName(expression) {
	if (!expression) return null;
	const parts = [];
	let current = expression;
	while (ts.isPropertyAccessExpression(current)) {
		parts.unshift(current.name.text);
		current = current.expression;
	}
	if (!ts.isIdentifier(current) || current.text !== 'api' || parts.length < 2) return null;
	return `${parts.slice(0, -1).join('/')}:${parts.at(-1)}`;
}

/** @param {ts.SourceFile} sourceFile @param {ts.Node} node */
function lineOf(sourceFile, node) {
	return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

/** @param {string} workflow @param {string} name @param {string} nextName */
function workflowStep(workflow, name, nextName) {
	const start = workflow.indexOf(`      - name: ${name}`);
	const end = workflow.indexOf(`      - name: ${nextName}`, start + 1);
	return start >= 0 && end > start ? workflow.slice(start, end) : null;
}

/** @param {{files?: string[]}} [options] */
export function scanConvexServerWorkBudget({ files = walk(SOURCE_ROOT) } = {}) {
	/** @type {Map<string, 'action'|'mutation'|'query'>} */
	const operations = new Map();
	/** @type {string[]} */
	const errors = [];
	for (const absolute of files) {
		const relative = path.relative(ROOT, absolute).split(path.sep).join('/');
		const source = fs.readFileSync(absolute, 'utf8');
		if (absolute.endsWith('.svelte')) {
			if (
				/from\s*['"]convex-sveltekit['"]/.test(source) &&
				/\bserver(?:Action|Mutation|Query)\b/.test(source)
			) {
				errors.push(`${relative}: Svelte code imports a raw server helper.`);
			}
			continue;
		}
		const sourceFile = ts.createSourceFile(
			absolute,
			source,
			ts.ScriptTarget.Latest,
			true,
			absolute.endsWith('.js') ? ts.ScriptKind.JS : ts.ScriptKind.TS
		);
		/** @type {Map<string, 'action'|'mutation'|'query'>} */
		const budgetedHelpers = new Map();
		let importsDirectClient = false;
		for (const statement of sourceFile.statements) {
			if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
				continue;
			}
			const moduleName = statement.moduleSpecifier.text;
			const named = statement.importClause?.namedBindings;
			if (moduleName === RAW_MODULE) {
				const expected = RAW_MODULE_IMPORTS[relative];
				const actual =
					named && ts.isNamedImports(named)
						? named.elements
								.map((element) => element.propertyName?.text ?? element.name.text)
								.sort()
						: [];
				if (
					!expected ||
					statement.importClause?.name ||
					!named ||
					!ts.isNamedImports(named) ||
					JSON.stringify(actual) !== JSON.stringify([...expected].sort())
				) {
					errors.push(
						`${relative}:${lineOf(sourceFile, statement)} has an unapproved ${RAW_MODULE} import.`
					);
				}
			}
			if (moduleName === 'convex/browser') {
				const exactHealthClient =
					relative === 'src/routes/api/health/+server.ts' &&
					!statement.importClause?.name &&
					named &&
					ts.isNamedImports(named) &&
					named.elements.length === 1 &&
					(named.elements[0].propertyName?.text ?? named.elements[0].name.text) ===
						'ConvexHttpClient';
				if (!exactHealthClient) {
					errors.push(
						`${relative}:${lineOf(sourceFile, statement)} has an unapproved convex/browser import.`
					);
				}
			}
			if (!named || !ts.isNamedImports(named)) continue;
			for (const element of named.elements) {
				const imported = element.propertyName?.text ?? element.name.text;
				if (moduleName === WRAPPER_MODULE && imported in HELPER_KINDS) {
					budgetedHelpers.set(element.name.text, HELPER_KINDS[imported]);
				}
				if (moduleName === 'convex/browser' && imported === 'ConvexHttpClient') {
					importsDirectClient = true;
				}
			}
		}
		if (importsDirectClient && !DIRECT_CLIENT_ALLOWLIST.has(relative)) {
			errors.push(
				`${relative}: direct ConvexHttpClient is outside the reviewed timed health probe.`
			);
		}
		if (
			DIRECT_CLIENT_ALLOWLIST.has(relative) &&
			importsDirectClient &&
			!source.includes('budgetedServerQuery')
		) {
			errors.push(`${relative}: timed health ConvexHttpClient is missing budgetedServerQuery.`);
		}

		/** @param {ts.Node} node */
		function visit(node) {
			if (
				ts.isCallExpression(node) &&
				node.expression.kind === ts.SyntaxKind.ImportKeyword &&
				ts.isStringLiteral(node.arguments[0]) &&
				(node.arguments[0].text === RAW_MODULE || node.arguments[0].text === 'convex/browser')
			) {
				errors.push(
					`${relative}:${lineOf(sourceFile, node)} dynamically imports an unbudgeted Convex module.`
				);
			}
			if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
				const kind = budgetedHelpers.get(node.expression.text);
				if (kind) {
					const operation = staticApiName(node.arguments[0]);
					if (!operation) {
						errors.push(
							`${relative}:${lineOf(sourceFile, node)} uses a non-static budgeted Convex reference.`
						);
					} else {
						const previous = operations.get(operation);
						if (previous && previous !== kind) {
							errors.push(`${relative}:${lineOf(sourceFile, node)} changes kind for ${operation}.`);
						}
						operations.set(operation, kind);
					}
				}
			}
			ts.forEachChild(node, visit);
		}
		visit(sourceFile);
	}
	return { errors, operations };
}

/**
 * @param {any} policy
 * @param {{errors: string[], operations: Map<string, 'action'|'mutation'|'query'>}} scan
 */
export function validateConvexWorkBudgetPolicy(policy, scan) {
	const errors = [...scan.errors];
	if (policy.protocol !== '4') errors.push('Policy protocol must be 4.');
	if (policy.coordinatorGeneration !== 'v4') {
		errors.push('Policy coordinator generation must be v4.');
	}
	if (policy.teamAuthorityId !== 'shared-convex-quota-01') {
		errors.push('Policy immutable team authority id is not exact.');
	}
	if (
		JSON.stringify(policy.realms) !==
		JSON.stringify({
			production: 'quirky-chinchilla-352.convex.cloud',
			preview: 'outstanding-firefly-831.convex.cloud'
		})
	) {
		errors.push('Policy must pin the exact two Convex realms sharing the team quota.');
	}
	if (policy.unitBytes !== 1024) errors.push('Policy unit must be one binary KiB.');
	if (policy.caps?.dailyUnits !== 327_680) {
		errors.push('Daily cap must be the reviewed 320 MiB release-day envelope.');
	}
	if (policy.caps?.monthlyUnits !== 524_288) {
		errors.push('Monthly cap must be the reviewed 512 MiB.');
	}
	if (policy.caps?.monthlyUnits * policy.unitBytes > 512 * 1024 * 1024) {
		errors.push('Pages monthly cap no longer leaves at least 512 MiB of the team 1 GiB quota.');
	}
	if (
		policy.cloudflareEnvelope?.workerDailyRequestFreeLimit !== 100_000 ||
		policy.cloudflareEnvelope?.durableObjectDailyRequestFreeLimit !== 100_000 ||
		policy.cloudflareEnvelope?.sqliteDailyRowsReadFreeLimit !== 5_000_000 ||
		policy.cloudflareEnvelope?.sqliteRowsWrittenPerAdmission !== 2 ||
		policy.cloudflareEnvelope?.sqliteDailyRowsWrittenFreeLimit !== 100_000
	) {
		errors.push(
			'Cloudflare Free envelope must pin 100k Worker/DO requests, 5m SQLite reads, and 100k SQLite writes per day.'
		);
	}
	const launchEnvelope = policy.launchEnvelope;
	if (
		JSON.stringify(launchEnvelope) !==
		JSON.stringify({
			ordinaryManifestRefreshGateWindowMinutes: 5,
			continuationGateWindowMinutes: 2,
			manifestCronPollSeconds: 60,
			manifestCronHttpTimeoutSeconds: 10,
			manifestSchedulerJitterBudgetSeconds: 30,
			manifestAuthoritySurvivalReserveSeconds: 20,
			manifestAuthorityFreshnessSeconds: 540,
			maximumCalendarMonthDays: 31,
			maximumCleanBackfillAttemptsPerRelease: 16,
			maximumMaterializationReplayAttemptsPerRelease: 3,
			maximumOrdinaryManifestRefreshCallsPerDayPerRealm: 288,
			maximumDeploymentHealthChecksPerRelease: 2,
			maximumReleaseEnvelopesPerTeamMonth: 1,
			recurringHealthChecksPerDayPerRealm: 0,
			softLaunchDailyUnitsPerRealm: 512
		})
	) {
		errors.push(
			'Launch envelope must pin the reviewed 5m gate/1m poll/9m authority/31-day posture.'
		);
	}
	if (policy.classes?.control !== 8) {
		errors.push('Control class must remain the reviewed 8 KiB compact-singleton envelope.');
	}
	const policyOperations = policy.operations ?? {};
	for (const [operation, kind] of scan.operations) {
		const entry = policyOperations[operation];
		if (!entry) errors.push(`Missing reviewed work-budget policy: ${kind} ${operation}.`);
		else if (entry.kind !== kind) errors.push(`Policy kind drift for ${operation}.`);
		else if (
			!Number.isSafeInteger(policy.classes?.[entry.class]) ||
			policy.classes[entry.class] <= 0
		) {
			errors.push(`Invalid policy class for ${operation}.`);
		}
	}
	for (const operation of Object.keys(policyOperations)) {
		if (!scan.operations.has(operation))
			errors.push(`Stale work-budget policy operation: ${operation}.`);
	}
	if (scan.operations.has('templates:publicDiscoveryManifest')) {
		if (policyOperations['templates:publicDiscoveryManifest']?.class !== 'control') {
			errors.push('Public discovery manifest must use the compact control class.');
		}
		try {
			const envelope = calculateConvexWorkBudgetLaunchEnvelope(policy);
			if (envelope.dailyWorstCaseUnits > policy.caps.dailyUnits) {
				errors.push('Release-day heartbeat and soft-launch work exceed the daily cap.');
			}
			if (envelope.monthlyWorstCaseUnits > policy.caps.monthlyUnits) {
				errors.push('31-day heartbeat, release, and soft-launch work exceed the monthly cap.');
			}
			if (
				envelope.maximumDailySqliteRowsWritten >
				policy.cloudflareEnvelope.sqliteDailyRowsWrittenFreeLimit
			) {
				errors.push('Daily team fuse can exceed the Cloudflare SQLite Free write limit.');
			}
			if (
				envelope.scheduledManifestWorkerRequestsPerDay >
					policy.cloudflareEnvelope.workerDailyRequestFreeLimit ||
				envelope.scheduledManifestDurableObjectRequestsPerDay >
					policy.cloudflareEnvelope.durableObjectDailyRequestFreeLimit ||
				envelope.scheduledManifestSqliteRowsReadPerDay >
					policy.cloudflareEnvelope.sqliteDailyRowsReadFreeLimit ||
				envelope.scheduledManifestSqliteRowsWrittenPerDay >
					policy.cloudflareEnvelope.sqliteDailyRowsWrittenFreeLimit
			) {
				errors.push(
					'One-minute manifest polling exceeds a Cloudflare Free daily control-plane limit.'
				);
			}
		} catch (error) {
			errors.push(error instanceof Error ? error.message : String(error));
		}
		const cronConfig = fs.readFileSync(MANIFEST_CRON_CONFIG_PATH, 'utf8');
		if (!/^crons = \["\* \* \* \* \*"\]$/m.test(cronConfig)) {
			errors.push('Manifest recovery cron must poll the five-minute gate exactly once per minute.');
		}
		const gateSource = fs.readFileSync(MANIFEST_GATE_SOURCE_PATH, 'utf8');
		if (
			!gateSource.includes('CONVEX_WORK_BUDGET_ORDINARY_MANIFEST_GATE_WINDOW_MINUTES') ||
			!gateSource.includes('CONVEX_WORK_BUDGET_MAXIMUM_CONTINUATION_ADMISSIONS_PER_REALM_DAY') ||
			!gateSource.includes("PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE_PROTOCOL = '3'")
		) {
			errors.push(
				'Manifest gate must consume the reviewed five-minute/18-continuation team policy.'
			);
		}
		const deployWorkflow = fs.readFileSync(DEPLOY_WORKFLOW_PATH, 'utf8');
		const postCommitReadiness = workflowStep(
			deployWorkflow,
			'Prove committed production liveness and authenticated readiness',
			'Recover an interrupted authority handoff'
		);
		const retainedPairStart = deployWorkflow.indexOf(
			'      - name: Restore retained production Pages and edge as one pair after unproved C'
		);
		const retainedPairEnd = deployWorkflow.indexOf('\n  deploy:', retainedPairStart + 1);
		const retainedPair =
			retainedPairStart >= 0 && retainedPairEnd > retainedPairStart
				? deployWorkflow.slice(retainedPairStart, retainedPairEnd)
				: null;
		const liveness = workflowStep(
			deployWorkflow,
			'Wait for exact deployment liveness',
			'Seed global public-discovery manifest control state'
		);
		const seed = workflowStep(
			deployWorkflow,
			'Seed global public-discovery manifest control state',
			'Prove exact immutable bundled graph surface'
		);
		const bootstrapSeed = workflowStep(
			deployWorkflow,
			'Seed the complete production corpus inside the absolute authority deadline',
			'Certify the seeded R2 corpus and exact completed authority'
		);
		if ((deployWorkflow.match(/\/api\/health/g) ?? []).length !== 2) {
			errors.push('Deploy workflow must contain exactly two authenticated health call sites.');
		}
		if (
			!postCommitReadiness ||
			(postCommitReadiness.match(/\/api\/live/g) ?? []).length !== 1 ||
			(postCommitReadiness.match(/\/api\/health/g) ?? []).length !== 1 ||
			!postCommitReadiness.includes('for attempt in {1..12}; do') ||
			!postCommitReadiness.includes('X-Internal-Secret: ${INTERNAL_API_SECRET}') ||
			!postCommitReadiness.includes('.convexRealm == "production"') ||
			!postCommitReadiness.includes('.release.transactionId == $transaction') ||
			postCommitReadiness.indexOf('https://commons.email/api/health') <
				postCommitReadiness.indexOf('\n          done')
		) {
			errors.push(
				'Terminal production C must poll exact-tuple liveness before one authenticated readiness probe.'
			);
		}
		if (
			!retainedPair ||
			(retainedPair.match(/\/api\/live/g) ?? []).length !== 1 ||
			(retainedPair.match(/\/api\/health/g) ?? []).length !== 1 ||
			!retainedPair.includes('if [ "$baseline_component" = "pages" ]; then') ||
			!retainedPair.includes('X-Internal-Secret: ${INTERNAL_API_SECRET}') ||
			!retainedPair.includes('.release.transactionId == $transaction') ||
			retainedPair.indexOf('https://commons.email/api/live') >
				retainedPair.indexOf('https://commons.email/api/health')
		) {
			errors.push(
				'Retained normal-pair recovery must spend only the second budgeted health probe after exact liveness.'
			);
		}
		if (
			!liveness ||
			(liveness.match(/\/api\/live/g) ?? []).length !== 1 ||
			!liveness.includes('https://pages-origin.commons.email/api/live') ||
			!liveness.includes('for attempt in {1..12}; do') ||
			!liveness.includes('x-commons-pages-origin-access: ${PAGES_ORIGIN_ACCESS_TOKEN}') ||
			!liveness.includes('x-commons-edge-release-sha: ${DEPLOY_SHA}') ||
			!liveness.includes('x-commons-edge-release-transaction: ${RELEASE_TRANSACTION_ID}') ||
			!liveness.includes('.release.sha == $sha') ||
			!liveness.includes('.release.transactionId == $transaction') ||
			liveness.includes('/api/health') ||
			deployWorkflow.indexOf('Wait for exact deployment liveness') >=
				deployWorkflow.indexOf('Seed global public-discovery manifest control state')
		) {
			errors.push('Exact-tuple I/O-free hidden-origin liveness must converge before deploy seed.');
		}
		if (
			!seed ||
			!seed.includes('timeout-minutes: 2') ||
			!seed.includes('--expected-release-sha "$DEPLOY_SHA"') ||
			!seed.includes('--expected-release-transaction "$RELEASE_TRANSACTION_ID"') ||
			!seed.includes('--qualification-reserve-milliseconds 900000') ||
			!seed.includes('--maximum-attempts 1') ||
			!seed.includes('.gateProtocol == "3"') ||
			!seed.includes('.qualificationReserveMilliseconds == 900000') ||
			!seed.includes('.attempts == 1 and .continuationUsed == false') ||
			seed.includes('for attempt in {1..19}; do') ||
			seed.includes('X-Public-Discovery-Page-Backfill-Continuation: 1')
		) {
			errors.push(
				'Normal deploy seed must be one protocol-3 request with no continuation and a fifteen-minute qualification reserve.'
			);
		}
		if (
			!bootstrapSeed ||
			!bootstrapSeed.includes('timeout-minutes: 55') ||
			!bootstrapSeed.includes('--bootstrap-authority-lease "$BOOTSTRAP_AUTHORITY_LEASE_ID"') ||
			!bootstrapSeed.includes('--bootstrap-authority-not-after "$BOOTSTRAP_AUTHORITY_NOT_AFTER"') ||
			!bootstrapSeed.includes('--bootstrap-cleanup-reserve-milliseconds 600000') ||
			!bootstrapSeed.includes('--maximum-attempts 25') ||
			!bootstrapSeed.includes('.proof == "public-discovery-manifest-bootstrap-seed"') ||
			!bootstrapSeed.includes('(.attempts >= 1 and .attempts <= 25)')
		) {
			errors.push(
				'Resumable manifest continuation must remain isolated inside the deadline-bound bootstrap authority.'
			);
		}
	}
	return errors;
}

/** @param {any} policy @param {string} operation */
function reviewedUnits(policy, operation) {
	const entry = policy.operations?.[operation];
	const units = entry ? policy.classes?.[entry.class] : undefined;
	invariant(
		Number.isSafeInteger(units) && units > 0,
		`Missing launch-envelope operation ${operation}.`
	);
	return units;
}

/**
 * Exact team-global launch envelope. Ordinary manifest cron and producer
 * pushes share one five-minute gate per backend, while every Convex call from
 * both backends spends the same atomic 512 MiB monthly coordinator.
 * @param {any} policy
 */
export function calculateConvexWorkBudgetLaunchEnvelope(policy) {
	const envelope = policy.launchEnvelope;
	invariant(envelope, 'Missing launch envelope.');
	const manifestUnits = reviewedUnits(policy, 'templates:publicDiscoveryManifest');
	const realmCount = Object.keys(policy.realms ?? {}).length;
	invariant(realmCount === 2, 'Launch envelope requires exactly two shared-team realms.');
	const cleanBackfillUnits =
		63 * reviewedUnits(policy, 'templates:publicTemplatePageArtifactsByCoordinates') +
		8 * reviewedUnits(policy, 'templates:publicTemplatePageArtifactInventoryPage') +
		envelope.maximumCleanBackfillAttemptsPerRelease * manifestUnits +
		2 * reviewedUnits(policy, 'templates:publicDiscoveryList') +
		2 * reviewedUnits(policy, 'templates:publicDiscoveryRelations');
	const replayUnits =
		envelope.maximumMaterializationReplayAttemptsPerRelease *
		(4 * reviewedUnits(policy, 'templates:publicTemplatePageArtifactsByCoordinates') +
			manifestUnits);
	const releaseEnvelopeUnits =
		(cleanBackfillUnits + replayUnits) * envelope.maximumReleaseEnvelopesPerTeamMonth;
	const deploymentHealthUnits =
		envelope.maximumDeploymentHealthChecksPerRelease *
		reviewedUnits(policy, 'observability:discoveryProducerStatus');
	const dailyManifestUnitsPerRealm =
		envelope.maximumOrdinaryManifestRefreshCallsPerDayPerRealm * manifestUnits;
	const dailyManifestUnits = dailyManifestUnitsPerRealm * realmCount;
	const monthlyManifestUnits = dailyManifestUnits * envelope.maximumCalendarMonthDays;
	const monthlySoftLaunchUnits =
		envelope.softLaunchDailyUnitsPerRealm * realmCount * envelope.maximumCalendarMonthDays;
	const dailySoftLaunchUnits = envelope.softLaunchDailyUnitsPerRealm * realmCount;
	const dailyWorstCaseUnits =
		releaseEnvelopeUnits + deploymentHealthUnits + dailyManifestUnits + dailySoftLaunchUnits;
	const monthlyWorstCaseUnits =
		releaseEnvelopeUnits + deploymentHealthUnits + monthlyManifestUnits + monthlySoftLaunchUnits;
	const minimumAdmissionUnits = Math.min(...Object.values(policy.classes));
	const maximumDailyAdmissions = Math.floor(policy.caps.dailyUnits / minimumAdmissionUnits);
	const maximumDailySqliteRowsWritten =
		maximumDailyAdmissions * policy.cloudflareEnvelope.sqliteRowsWrittenPerAdmission;
	const secondsPerDay = 24 * 60 * 60;
	invariant(
		secondsPerDay % envelope.manifestCronPollSeconds === 0,
		'Manifest cron poll cadence must divide one UTC day exactly.'
	);
	const scheduledManifestCronInvocationsPerDay = secondsPerDay / envelope.manifestCronPollSeconds;
	const scheduledManifestEndpointPollsPerDay = scheduledManifestCronInvocationsPerDay * realmCount;
	const scheduledManifestAcceptedRefreshesPerDay =
		envelope.maximumOrdinaryManifestRefreshCallsPerDayPerRealm * realmCount;
	invariant(
		scheduledManifestEndpointPollsPerDay >= scheduledManifestAcceptedRefreshesPerDay,
		'Manifest poll cadence cannot be slower than the admitted refresh cadence.'
	);
	const scheduledManifestCoalescedPollsPerDay =
		scheduledManifestEndpointPollsPerDay - scheduledManifestAcceptedRefreshesPerDay;
	// One scheduled invocation plus one Pages Function request per realm. Outbound
	// fetch is not separately billed, but its receiving Pages Function is.
	const scheduledManifestWorkerRequestsPerDay =
		scheduledManifestCronInvocationsPerDay + scheduledManifestEndpointPollsPerDay;
	// Every endpoint poll reserves once; every accepted lease settles once.
	const scheduledManifestDurableObjectRequestsPerDay =
		scheduledManifestEndpointPollsPerDay + scheduledManifestAcceptedRefreshesPerDay;
	// Every reserve reads ordinary, continuation, and seed-priority singletons.
	// An incomplete completion is the conservative branch at 2 reads + 2 writes;
	// admitted reserve itself writes reservation, continuation, and lease rows.
	const scheduledManifestSqliteRowsReadPerDay =
		scheduledManifestCoalescedPollsPerDay * 3 +
		scheduledManifestAcceptedRefreshesPerDay * 3 +
		scheduledManifestAcceptedRefreshesPerDay * 2;
	const scheduledManifestSqliteRowsWrittenPerDay =
		scheduledManifestAcceptedRefreshesPerDay * 3 + scheduledManifestAcceptedRefreshesPerDay * 2;
	return {
		cleanBackfillUnits,
		deploymentHealthUnits,
		dailyManifestUnits,
		dailyManifestUnitsPerRealm,
		dailyRemainingUnits: policy.caps.dailyUnits - dailyWorstCaseUnits,
		dailySoftLaunchUnits,
		dailyWorstCaseUnits,
		manifestUnits,
		maximumContinuationAdmissionsPerRealmDay:
			envelope.maximumCleanBackfillAttemptsPerRelease +
			envelope.maximumMaterializationReplayAttemptsPerRelease -
			1,
		maximumDailyAdmissions,
		maximumDailySqliteRowsWritten,
		maximumEndpointAttemptsPerRelease:
			envelope.maximumCleanBackfillAttemptsPerRelease +
			envelope.maximumMaterializationReplayAttemptsPerRelease,
		monthlyManifestUnits,
		monthlyRemainingUnits: policy.caps.monthlyUnits - monthlyWorstCaseUnits,
		monthlySoftLaunchUnits,
		monthlyWorstCaseUnits,
		releaseEnvelopeUnits,
		replayUnits,
		scheduledManifestAcceptedRefreshesPerDay,
		scheduledManifestCoalescedPollsPerDay,
		scheduledManifestCronInvocationsPerDay,
		scheduledManifestDurableObjectRequestsPerDay,
		scheduledManifestEndpointPollsPerDay,
		scheduledManifestSqliteRowsReadPerDay,
		scheduledManifestSqliteRowsWrittenPerDay,
		scheduledManifestWorkerRequestsPerDay
	};
}

export function main() {
	const policy = JSON.parse(fs.readFileSync(POLICY_PATH, 'utf8'));
	const scan = scanConvexServerWorkBudget();
	const errors = validateConvexWorkBudgetPolicy(policy, scan);
	if (errors.length)
		throw new Error(`Convex server work-budget ratchet failed:\n- ${errors.join('\n- ')}`);
	/** @type {Record<string, number>} */
	const counts = {};
	for (const { class: className } of Object.values(policy.operations)) {
		counts[className] = (counts[className] ?? 0) + 1;
	}
	console.log(
		`Convex server work-budget ratchet passed: ${scan.operations.size} exact operations; ` +
			Object.entries(counts)
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([name, count]) => `${name}=${count}`)
				.join(', ')
	);
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) main();
