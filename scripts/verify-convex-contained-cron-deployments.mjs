#!/usr/bin/env node

import { pathToFileURL } from 'node:url';
import { ConvexHttpClient } from 'convex/browser';
import { makeFunctionReference } from 'convex/server';

/**
 * Convex intentionally omits the internal `setAdminAuth` method from its
 * published declaration file even though the runtime client exposes it.
 * Keep the narrow surface needed by this read-only proof explicit here.
 * @typedef {{setAdminAuth: (key: string) => void, query: (reference: unknown, args: Record<string, unknown>) => Promise<unknown>}} CronInventoryClient
 */

export const CONVEX_CONTAINED_DEPLOYMENTS = Object.freeze({
	production: Object.freeze({
		name: 'quirky-chinchilla-352',
		type: 'prod',
		url: 'https://quirky-chinchilla-352.convex.cloud',
		keyEnv: 'PROTECTED_CONVEX_PRODUCTION_CRON_DATA_VIEW_DEPLOY_KEY',
		auditKeyEnv: 'PROTECTED_CONVEX_PRODUCTION_CRON_AUDIT_LOG_VIEW_DEPLOY_KEY'
	}),
	preview: Object.freeze({
		name: 'outstanding-firefly-831',
		type: 'dev',
		url: 'https://outstanding-firefly-831.convex.cloud',
		keyEnv: 'PROTECTED_CONVEX_PREVIEW_CRON_DATA_VIEW_DEPLOY_KEY',
		auditKeyEnv: 'PROTECTED_CONVEX_PREVIEW_CRON_AUDIT_LOG_VIEW_DEPLOY_KEY'
	})
});

export const CONVEX_EXPECTED_BACKEND_STATES = Object.freeze({
	// A disabled/suspended/quota-disabled deployment can and must retain the
	// independent user pause. Record provider disablement exactly, but make the
	// user fence the paused recovery authority.
	paused: Object.freeze({ user: 'paused' }),
	running: Object.freeze({ system: 'none', usageLimit: 'none', user: 'none' })
});

const READ_BACKEND_STATE = makeFunctionReference('_system/frontend/backendState:backendState');
const LIST_CRON_JOBS = makeFunctionReference('_system/frontend/listCronJobs:default');
const LIST_RUNNABLE_SCHEDULED_FUNCTIONS = makeFunctionReference(
	'_system/frontend/paginatedScheduledJobs:default'
);
const LIST_DEPLOYMENT_AUDIT_EVENTS = makeFunctionReference(
	'_system/frontend/paginatedDeploymentEvents:default'
);
export const CONVEX_RUNNABLE_SCHEDULED_FUNCTION_PAGE_SIZE = 1;
export const CONVEX_DEPLOYMENT_AUDIT_EVENT_PAGE_SIZE = 25;
export const CONVEX_DEPLOYMENT_AUDIT_EVENT_PAGE_CAP = 4;
export const CONVEX_DEPLOYMENT_AUDIT_TAIL_OVERLAP_MS = 60_000;
export const CONVEX_CONTAINMENT_PROOF_SCOPES = Object.freeze(['state', 'containment']);
const PAUSE_AUDIT_ACTIONS = Object.freeze([
	'pause_deployment',
	'unpause_deployment',
	'change_deployment_state'
]);

/** @param {unknown} condition @param {string} message @returns {asserts condition} */
function invariant(condition, message) {
	if (!condition) throw new Error(message);
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function record(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** @param {unknown} raw @returns {'paused'|'running'} */
export function validateConvexExpectedBackendState(raw) {
	invariant(
		typeof raw === 'string' && Object.hasOwn(CONVEX_EXPECTED_BACKEND_STATES, raw),
		'Expected Convex backend state must be explicitly set to paused or running.'
	);
	return /** @type {'paused'|'running'} */ (raw);
}

/** @param {unknown} raw @returns {'state'|'containment'} */
export function validateConvexContainmentProofScope(raw) {
	invariant(
		typeof raw === 'string' && CONVEX_CONTAINMENT_PROOF_SCOPES.includes(raw),
		'Convex proof scope must be state or containment.'
	);
	return /** @type {'state'|'containment'} */ (raw);
}

/** @param {unknown} raw @param {'paused'|'running'} expectedState */
export function validateConvexOperatorRecoveryEpoch(raw, expectedState) {
	if (raw === undefined && expectedState === 'running') return undefined;
	invariant(
		typeof raw === 'string' &&
			raw.length >= 8 &&
			raw.length <= 128 &&
			/^[A-Za-z0-9][A-Za-z0-9._:-]+$/.test(raw),
		'Paused Convex proof requires an 8-128 character operator recovery epoch.'
	);
	// This is an operator correlation identifier. It binds separately captured
	// evidence into one recovery bundle; it is not provider pause-history proof.
	return raw;
}

/** @param {unknown} raw @param {'paused'|'running'} expectedState */
export function validateConvexRecoveryEpochMinMs(raw, expectedState) {
	if (raw === undefined && expectedState === 'running') return undefined;
	const value = typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : raw;
	invariant(
		typeof value === 'number' && Number.isSafeInteger(value) && value > 0,
		'Paused Convex proof requires an operator-recorded recovery epoch start in milliseconds.'
	);
	return value;
}

/** @param {unknown} raw @param {'preview'|'production'} environment */
export function validateConvexCronDataViewDeployKey(raw, environment) {
	invariant(
		Object.hasOwn(CONVEX_CONTAINED_DEPLOYMENTS, environment),
		'Invalid Convex cron environment.'
	);
	const deployment = CONVEX_CONTAINED_DEPLOYMENTS[environment];
	const prefix = `${deployment.type}:${deployment.name}|`;
	invariant(
		typeof raw === 'string' &&
			raw.startsWith(prefix) &&
			raw.length >= prefix.length + 16 &&
			!/[\s|]/.test(raw.slice(prefix.length)),
		`${deployment.keyEnv} is missing or is not bound to the exact ${environment} deployment.`
	);
	return raw;
}

/** @param {unknown} raw @param {'preview'|'production'} environment */
export function validateConvexCronAuditLogViewDeployKey(raw, environment) {
	invariant(
		Object.hasOwn(CONVEX_CONTAINED_DEPLOYMENTS, environment),
		'Invalid Convex cron environment.'
	);
	const deployment = CONVEX_CONTAINED_DEPLOYMENTS[environment];
	const prefix = `${deployment.type}:${deployment.name}|`;
	invariant(
		typeof raw === 'string' &&
			raw.startsWith(prefix) &&
			raw.length >= prefix.length + 16 &&
			!/[\s|]/.test(raw.slice(prefix.length)),
		`${deployment.auditKeyEnv} is missing or is not bound to the exact ${environment} deployment.`
	);
	return raw;
}

/** @param {unknown} raw @param {string} deploymentName */
export function validateEmptyConvexCronInventory(raw, deploymentName) {
	invariant(Array.isArray(raw), `Convex ${deploymentName} cron inventory must be an array.`);
	invariant(
		raw.length === 0,
		`Convex ${deploymentName} is not contained: ${raw.length} cron job(s) remain registered.`
	);
	return { registeredCronJobs: 0 };
}

/**
 * @param {unknown} raw
 * @param {string} deploymentName
 * @param {'paused'|'running'} expectedState
 */
export function validateConvexBackendState(raw, deploymentName, expectedState) {
	validateConvexExpectedBackendState(expectedState);
	invariant(record(raw), `Convex ${deploymentName} backend state response is invalid.`);
	invariant(
		['none', 'disabled', 'suspended'].includes(/** @type {string} */ (raw.system)) &&
			['none', 'disabled'].includes(/** @type {string} */ (raw.usage_limit)) &&
			['none', 'paused'].includes(/** @type {string} */ (raw.user)),
		`Convex ${deploymentName} backend state response is invalid.`
	);
	const observed = {
		system: /** @type {string} */ (raw.system),
		usageLimit: /** @type {string} */ (raw.usage_limit),
		user: /** @type {string} */ (raw.user)
	};
	const matchesRequiredState =
		expectedState === 'paused'
			? observed.user === 'paused'
			: observed.system === 'none' && observed.usageLimit === 'none' && observed.user === 'none';
	invariant(
		matchesRequiredState,
		`Convex ${deploymentName} backend is not in the required ${expectedState} state.`
	);
	return observed;
}

/**
 * Validate the provider's indexed active-work page without inspecting or
 * logging its row. `_scheduled_jobs.by_next_ts` contains only pending/in-progress
 * rows; one returned row is enough to fail. The provider may return inline
 * legacy args or an argsId in that one row, but this query never scans retained
 * history and never dereferences argsId.
 * @param {unknown} raw
 * @param {string} deploymentName
 */
export function validateConvexRunnableScheduledFunctionPage(raw, deploymentName) {
	invariant(record(raw), `Convex ${deploymentName} runnable scheduled-function page is invalid.`);
	invariant(
		Array.isArray(raw.page) &&
			typeof raw.isDone === 'boolean' &&
			typeof raw.continueCursor === 'string',
		`Convex ${deploymentName} runnable scheduled-function page is invalid.`
	);
	invariant(
		raw.page.length === 0,
		`Convex ${deploymentName} is not contained: at least 1 pending or in-progress scheduled function remains.`
	);
	invariant(
		raw.isDone,
		`Convex ${deploymentName} runnable scheduled-function proof did not terminate on its empty indexed page.`
	);
	return { runnableScheduledFunctions: 0, scheduledFunctionActiveRowsRead: 0 };
}

/** @param {CronInventoryClient} client @param {string} deploymentName */
async function verifyNoRunnableScheduledFunctions(client, deploymentName) {
	const raw = await client.query(LIST_RUNNABLE_SCHEDULED_FUNCTIONS, {
		componentId: null,
		paginationOpts: { cursor: null, numItems: CONVEX_RUNNABLE_SCHEDULED_FUNCTION_PAGE_SIZE }
	});
	return validateConvexRunnableScheduledFunctionPage(raw, deploymentName);
}

/** @param {unknown} raw @param {string} deploymentName @param {number} epochMinMs */
export function validateConvexDeploymentAuditEventPage(raw, deploymentName, epochMinMs) {
	invariant(record(raw), `Convex ${deploymentName} deployment-audit page is invalid.`);
	invariant(
		Array.isArray(raw.page) &&
			typeof raw.isDone === 'boolean' &&
			typeof raw.continueCursor === 'string',
		`Convex ${deploymentName} deployment-audit page is invalid.`
	);
	const transitions = raw.page.map((event) => {
		invariant(
			record(event) &&
				typeof event.action === 'string' &&
				PAUSE_AUDIT_ACTIONS.includes(event.action) &&
				typeof event._creationTime === 'number' &&
				Number.isFinite(event._creationTime) &&
				event._creationTime >= epochMinMs &&
				record(event.metadata),
			`Convex ${deploymentName} deployment-audit event is invalid.`
		);
		let transition = 'other';
		if (event.action === 'pause_deployment') transition = 'pause';
		if (event.action === 'unpause_deployment') transition = 'resume';
		if (event.action === 'change_deployment_state') {
			invariant(
				typeof event.metadata.new_state === 'string',
				`Convex ${deploymentName} deployment-audit event is invalid.`
			);
			if (event.metadata.new_state === 'paused') transition = 'pause';
			if (event.metadata.new_state === 'running') transition = 'resume';
		}
		return { at: event._creationTime, transition };
	});
	return {
		continueCursor: raw.continueCursor,
		isDone: raw.isDone,
		transitions
	};
}

/** @param {CronInventoryClient} auditClient @param {string} deploymentName @param {number} epochMinMs @param {number} fenceStartMs */
async function verifyPausedRecoveryAuditHistory(
	auditClient,
	deploymentName,
	epochMinMs,
	fenceStartMs
) {
	let cursor = null;
	let pagesRead = 0;
	/** @type {{at: number, transition: string}[]} */
	const transitions = [];
	while (true) {
		const raw = await auditClient.query(LIST_DEPLOYMENT_AUDIT_EVENTS, {
			filters: {
				actions: [...PAUSE_AUDIT_ACTIONS],
				maxDate: fenceStartMs,
				minDate: epochMinMs
			},
			paginationOpts: { cursor, numItems: CONVEX_DEPLOYMENT_AUDIT_EVENT_PAGE_SIZE }
		});
		const page = validateConvexDeploymentAuditEventPage(raw, deploymentName, epochMinMs);
		pagesRead += 1;
		transitions.push(...page.transitions);
		invariant(
			pagesRead <= CONVEX_DEPLOYMENT_AUDIT_EVENT_PAGE_CAP,
			`Convex ${deploymentName} deployment-audit proof exceeds the ${CONVEX_DEPLOYMENT_AUDIT_EVENT_PAGE_CAP}-page cap.`
		);
		if (page.isDone) break;
		invariant(
			page.continueCursor.length > 0 && page.continueCursor !== cursor,
			`Convex ${deploymentName} deployment-audit pagination stalled.`
		);
		invariant(
			pagesRead < CONVEX_DEPLOYMENT_AUDIT_EVENT_PAGE_CAP,
			`Convex ${deploymentName} deployment-audit proof exceeds the ${CONVEX_DEPLOYMENT_AUDIT_EVENT_PAGE_CAP}-page cap.`
		);
		cursor = page.continueCursor;
	}
	const pauseEvents = transitions.filter((event) => event.transition === 'pause');
	const resumeEvents = transitions.filter((event) => event.transition === 'resume');
	invariant(
		resumeEvents.length === 0,
		`Convex ${deploymentName} recovery epoch contains ${resumeEvents.length} unpause or running transition(s).`
	);
	return {
		epochMinMs,
		fenceStartMs,
		historyPauseEventAt:
			pauseEvents.length === 0 ? null : Math.min(...pauseEvents.map((event) => event.at)),
		historyPauseEvents: pauseEvents.length,
		resumeEvents: 0,
		auditEventsMatched: transitions.length,
		historyAuditPagesRead: pagesRead
	};
}

/** @param {CronInventoryClient} auditClient @param {string} deploymentName @param {number} fenceStartMs */
async function verifyPausedRecoveryAuditTail(auditClient, deploymentName, fenceStartMs) {
	const raw = await auditClient.query(LIST_DEPLOYMENT_AUDIT_EVENTS, {
		filters: { actions: [...PAUSE_AUDIT_ACTIONS], minDate: fenceStartMs },
		paginationOpts: {
			cursor: null,
			numItems: CONVEX_DEPLOYMENT_AUDIT_EVENT_PAGE_SIZE
		}
	});
	const page = validateConvexDeploymentAuditEventPage(raw, deploymentName, fenceStartMs);
	invariant(
		page.isDone,
		`Convex ${deploymentName} deployment-audit tail exceeds its one-page proof budget.`
	);
	const resumeEvents = page.transitions.filter((event) => event.transition === 'resume');
	const pauseEvents = page.transitions.filter((event) => event.transition === 'pause');
	invariant(
		resumeEvents.length === 0,
		`Convex ${deploymentName} recovery audit tail contains ${resumeEvents.length} unpause or running transition(s).`
	);
	return {
		tailPauseEventAt:
			pauseEvents.length === 0 ? null : Math.min(...pauseEvents.map((event) => event.at)),
		tailPauseEvents: pauseEvents.length,
		tailAuditEventsMatched: page.transitions.length,
		tailAuditPagesRead: 1,
		tailResumeEvents: 0
	};
}

/**
 * This brackets the inventory reads with exact provider backend-state reads.
 * It proves the endpoints were in the required state at both observations; it
 * intentionally does not claim that a read-only API reconstructs historical
 * pause/resume events between or before those observations.
 * @param {{environment: 'preview'|'production', deploymentKey: string|undefined, auditLogKey?: string|undefined, expectedState: 'paused'|'running', recoveryEpoch?: string, recoveryEpochMinMs?: number|string, scope?: 'state'|'containment', clientFactory?: (url: string) => CronInventoryClient, auditClientFactory?: (url: string) => CronInventoryClient, now?: () => number}} input
 */
export async function verifyConvexContainedCronDeployment({
	environment,
	deploymentKey,
	auditLogKey,
	expectedState,
	recoveryEpoch,
	recoveryEpochMinMs,
	scope = 'containment',
	now = Date.now,
	clientFactory = (url) =>
		/** @type {CronInventoryClient} */ (
			/** @type {unknown} */ (new ConvexHttpClient(url, { logger: false }))
		),
	auditClientFactory = clientFactory
}) {
	invariant(
		Object.hasOwn(CONVEX_CONTAINED_DEPLOYMENTS, environment),
		'Invalid Convex cron environment.'
	);
	const requiredState = validateConvexExpectedBackendState(expectedState);
	const proofScope = validateConvexContainmentProofScope(scope);
	const operatorRecoveryEpoch = validateConvexOperatorRecoveryEpoch(recoveryEpoch, requiredState);
	const epochMinMs = validateConvexRecoveryEpochMinMs(recoveryEpochMinMs, requiredState);
	const deployment = CONVEX_CONTAINED_DEPLOYMENTS[environment];
	const key = validateConvexCronDataViewDeployKey(deploymentKey, environment);
	const auditKey =
		requiredState === 'paused'
			? validateConvexCronAuditLogViewDeployKey(auditLogKey, environment)
			: undefined;
	invariant(
		requiredState !== 'paused' || auditKey !== key,
		`Convex ${deployment.name} paused proof requires separate data-view and audit-log-view keys.`
	);
	const client = clientFactory(deployment.url);
	// The key prefix proves deployment type/name binding. The provider does not
	// expose allowedActions to a key authenticating itself, so the operator's
	// dashboard enrollment record is the authority that this key was minted with
	// deployment:data:view and no other action.
	client.setAdminAuth(key);
	const stateBefore = validateConvexBackendState(
		await client.query(READ_BACKEND_STATE, {}),
		deployment.name,
		requiredState
	);
	let containmentInventory = {};
	if (proofScope === 'containment') {
		const jobs = await client.query(LIST_CRON_JOBS, { componentId: null });
		const cronInventory = validateEmptyConvexCronInventory(jobs, deployment.name);
		const scheduledInventory = await verifyNoRunnableScheduledFunctions(client, deployment.name);
		containmentInventory = { ...cronInventory, ...scheduledInventory };
	}
	/** @type {Awaited<ReturnType<typeof verifyPausedRecoveryAuditHistory>> | null} */
	let pauseEpochAuditHistory = null;
	let auditClient;
	let auditFenceStartMs;
	if (requiredState === 'paused') {
		auditFenceStartMs = Math.max(
			/** @type {number} */ (epochMinMs),
			now() - CONVEX_DEPLOYMENT_AUDIT_TAIL_OVERLAP_MS
		);
		invariant(
			Number.isSafeInteger(auditFenceStartMs) &&
				auditFenceStartMs >= /** @type {number} */ (epochMinMs),
			`Convex ${deployment.name} recovery audit fence time is invalid.`
		);
		auditClient = auditClientFactory(deployment.url);
		auditClient.setAdminAuth(/** @type {string} */ (auditKey));
		pauseEpochAuditHistory = await verifyPausedRecoveryAuditHistory(
			auditClient,
			deployment.name,
			/** @type {number} */ (epochMinMs),
			auditFenceStartMs
		);
	}
	const stateAfter = validateConvexBackendState(
		await client.query(READ_BACKEND_STATE, {}),
		deployment.name,
		requiredState
	);
	let pauseEpochAudit = {};
	if (requiredState === 'paused') {
		invariant(
			pauseEpochAuditHistory !== null,
			`Convex ${deployment.name} recovery audit history is missing.`
		);
		const auditTail = await verifyPausedRecoveryAuditTail(
			/** @type {CronInventoryClient} */ (auditClient),
			deployment.name,
			/** @type {number} */ (auditFenceStartMs)
		);
		const pauseEventCandidates = [
			pauseEpochAuditHistory.historyPauseEventAt,
			auditTail.tailPauseEventAt
		].filter((value) => typeof value === 'number');
		invariant(
			pauseEventCandidates.length > 0,
			`Convex ${deployment.name} recovery epoch has no provider pause event at or after its recorded start.`
		);
		pauseEpochAudit = {
			pauseEpochAudit: {
				...pauseEpochAuditHistory,
				...auditTail,
				pauseEventAt: Math.min(...pauseEventCandidates),
				pauseEvents: pauseEpochAuditHistory.historyPauseEvents + auditTail.tailPauseEvents
			}
		};
	}
	return {
		deploymentName: deployment.name,
		environment,
		instanceUrl: deployment.url,
		proofScope,
		expectedBackendState: requiredState,
		...(operatorRecoveryEpoch === undefined ? {} : { operatorRecoveryEpoch }),
		...pauseEpochAudit,
		backendStateFence: { before: stateBefore, after: stateAfter },
		backendStateFenceReads: 2,
		...containmentInventory
	};
}

/**
 * @param {{deploymentKeys: {preview: string|undefined, production: string|undefined}, auditLogKeys?: {preview: string|undefined, production: string|undefined}, expectedState: 'paused'|'running', recoveryEpoch?: string, recoveryEpochMinMs?: number|string, scope?: 'state'|'containment', clientFactory?: (url: string) => CronInventoryClient, auditClientFactory?: (url: string) => CronInventoryClient, now?: () => number}} input
 */
export async function verifyAllConvexContainedCronDeployments(input) {
	const expectedState = validateConvexExpectedBackendState(input.expectedState);
	const scope = validateConvexContainmentProofScope(input.scope ?? 'containment');
	const recoveryEpoch = validateConvexOperatorRecoveryEpoch(input.recoveryEpoch, expectedState);
	const recoveryEpochMinMs = validateConvexRecoveryEpochMinMs(
		input.recoveryEpochMinMs,
		expectedState
	);
	// Validate both deployment bindings before either client performs I/O. A
	// missing/cross-realm secret therefore cannot cause a partial live proof.
	const deploymentKeys = {
		preview: validateConvexCronDataViewDeployKey(input.deploymentKeys?.preview, 'preview'),
		production: validateConvexCronDataViewDeployKey(input.deploymentKeys?.production, 'production')
	};
	const auditLogKeys =
		expectedState === 'paused'
			? {
					preview: validateConvexCronAuditLogViewDeployKey(input.auditLogKeys?.preview, 'preview'),
					production: validateConvexCronAuditLogViewDeployKey(
						input.auditLogKeys?.production,
						'production'
					)
				}
			: undefined;
	const [preview, production] = await Promise.all([
		verifyConvexContainedCronDeployment({
			environment: 'preview',
			deploymentKey: deploymentKeys.preview,
			auditLogKey: auditLogKeys?.preview,
			expectedState,
			recoveryEpoch,
			recoveryEpochMinMs,
			scope,
			now: input.now,
			clientFactory: input.clientFactory,
			auditClientFactory: input.auditClientFactory
		}),
		verifyConvexContainedCronDeployment({
			environment: 'production',
			deploymentKey: deploymentKeys.production,
			auditLogKey: auditLogKeys?.production,
			expectedState,
			recoveryEpoch,
			recoveryEpochMinMs,
			scope,
			now: input.now,
			clientFactory: input.clientFactory,
			auditClientFactory: input.auditClientFactory
		})
	]);
	return { preview, production };
}

/** @param {string[]} argv */
function parseOptions(argv) {
	invariant(
		argv.length > 0 && argv.length % 2 === 0,
		'Usage: verify-convex-contained-cron-deployments [--environment all|preview|production] [--scope state|containment] --expected-state paused|running [--recovery-epoch operator-id --recovery-epoch-min-ms timestamp]'
	);
	/** @type {'all'|'preview'|'production'} */
	let environment = 'all';
	/** @type {'paused'|'running'|undefined} */
	let expectedState;
	/** @type {'state'|'containment'} */
	let scope = 'containment';
	/** @type {string|undefined} */
	let recoveryEpoch;
	/** @type {string|undefined} */
	let recoveryEpochMinMs;
	const seen = new Set();
	for (let index = 0; index < argv.length; index += 2) {
		const flag = argv[index];
		const value = argv[index + 1];
		invariant(
			!seen.has(flag),
			'Usage: verify-convex-contained-cron-deployments [--environment all|preview|production] [--scope state|containment] --expected-state paused|running [--recovery-epoch operator-id --recovery-epoch-min-ms timestamp]'
		);
		seen.add(flag);
		if (flag === '--environment') {
			invariant(
				['all', 'preview', 'production'].includes(value),
				'Usage: verify-convex-contained-cron-deployments [--environment all|preview|production] [--scope state|containment] --expected-state paused|running [--recovery-epoch operator-id --recovery-epoch-min-ms timestamp]'
			);
			environment = /** @type {'all'|'preview'|'production'} */ (value);
		} else if (flag === '--expected-state') {
			expectedState = validateConvexExpectedBackendState(value);
		} else if (flag === '--scope') {
			scope = validateConvexContainmentProofScope(value);
		} else if (flag === '--recovery-epoch') {
			recoveryEpoch = value;
		} else if (flag === '--recovery-epoch-min-ms') {
			recoveryEpochMinMs = value;
		} else {
			invariant(
				false,
				'Usage: verify-convex-contained-cron-deployments [--environment all|preview|production] [--scope state|containment] --expected-state paused|running [--recovery-epoch operator-id --recovery-epoch-min-ms timestamp]'
			);
		}
	}
	invariant(
		expectedState !== undefined,
		'Usage: verify-convex-contained-cron-deployments [--environment all|preview|production] [--scope state|containment] --expected-state paused|running [--recovery-epoch operator-id --recovery-epoch-min-ms timestamp]'
	);
	return {
		environment,
		expectedState,
		scope,
		recoveryEpoch: validateConvexOperatorRecoveryEpoch(recoveryEpoch, expectedState),
		recoveryEpochMinMs: validateConvexRecoveryEpochMinMs(recoveryEpochMinMs, expectedState)
	};
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
	try {
		const { environment, expectedState, recoveryEpoch, recoveryEpochMinMs, scope } = parseOptions(
			process.argv.slice(2)
		);
		const deploymentKeys = {
			preview: process.env.PROTECTED_CONVEX_PREVIEW_CRON_DATA_VIEW_DEPLOY_KEY,
			production: process.env.PROTECTED_CONVEX_PRODUCTION_CRON_DATA_VIEW_DEPLOY_KEY
		};
		const auditLogKeys = {
			preview: process.env.PROTECTED_CONVEX_PREVIEW_CRON_AUDIT_LOG_VIEW_DEPLOY_KEY,
			production: process.env.PROTECTED_CONVEX_PRODUCTION_CRON_AUDIT_LOG_VIEW_DEPLOY_KEY
		};
		const result =
			environment === 'all'
				? await verifyAllConvexContainedCronDeployments({
						deploymentKeys,
						auditLogKeys,
						expectedState,
						recoveryEpoch,
						recoveryEpochMinMs,
						scope
					})
				: await verifyConvexContainedCronDeployment({
						environment,
						deploymentKey: deploymentKeys[environment],
						auditLogKey: auditLogKeys[environment],
						expectedState,
						recoveryEpoch,
						recoveryEpochMinMs,
						scope
					});
		console.log(JSON.stringify(result));
	} catch (error) {
		let message = error instanceof Error ? error.message : String(error);
		for (const secret of [
			process.env.PROTECTED_CONVEX_PREVIEW_CRON_DATA_VIEW_DEPLOY_KEY,
			process.env.PROTECTED_CONVEX_PRODUCTION_CRON_DATA_VIEW_DEPLOY_KEY,
			process.env.PROTECTED_CONVEX_PREVIEW_CRON_AUDIT_LOG_VIEW_DEPLOY_KEY,
			process.env.PROTECTED_CONVEX_PRODUCTION_CRON_AUDIT_LOG_VIEW_DEPLOY_KEY
		]) {
			if (secret) message = message.replaceAll(secret, '[REDACTED]');
		}
		console.error(message);
		process.exitCode = 1;
	}
}
