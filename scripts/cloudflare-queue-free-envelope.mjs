#!/usr/bin/env node

import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const CLOUDFLARE_QUEUE_FREE_ENVELOPE_SIGNATURE_NAMESPACE =
	'commons-cloudflare-queue-free-envelope-v1';
export const CLOUDFLARE_QUEUE_FREE_ENVELOPE_ACCOUNT_ID = '019d1184e655db74b7589794a2a2a533';
export const CLOUDFLARE_QUEUE_FREE_ENVELOPE_MAX_BILLABLE_OPERATIONS = 2_500;
export const CLOUDFLARE_QUEUE_FREE_ENVELOPE_MAX_LIFETIME_SECONDS = 30 * 60;
export const CLOUDFLARE_QUEUE_FREE_ENVELOPE_BOOTSTRAP_MAX_LIFETIME_SECONDS = 75 * 60;
export const CLOUDFLARE_QUEUE_FREE_ENVELOPE_MAX_FUTURE_SKEW_SECONDS = 5 * 60;
export const CLOUDFLARE_QUEUE_FREE_ENVELOPE_MAX_CAPTURE_DELAY_SECONDS = 5 * 60;
export const CLOUDFLARE_QUEUE_FREE_ENVELOPE_MAX_VERIFICATION_AGE_SECONDS = 27 * 60;
export const CLOUDFLARE_QUEUE_FREE_ENVELOPE_BOOTSTRAP_MAX_VERIFICATION_AGE_SECONDS = 72 * 60;
export const CLOUDFLARE_QUEUE_FREE_ENVELOPE_BOOTSTRAP_ADMISSION_VALIDITY_SECONDS = 72 * 60;
// An attached proof with 66 minutes left is at most nine minutes old. That
// leaves 63 minutes before the 72-minute verification deadline: one full
// 60-minute authority plus the exact three-minute terminal-proof reserve.
export const CLOUDFLARE_QUEUE_FREE_ENVELOPE_BOOTSTRAP_ATTACHED_PROOF_VALIDITY_SECONDS = 66 * 60;
export const CLOUDFLARE_QUEUE_FREE_ENVELOPE_FINAL_PROOF_VALIDITY_SECONDS = 3 * 60;
export const CLOUDFLARE_QUEUE_FREE_ENVELOPE_BOOTSTRAP_WORKER = 'commons-public-discovery-bootstrap';
export const CLOUDFLARE_QUEUE_FREE_ENVELOPE_BOOTSTRAP_QUEUE = 'commons-public-template-og';
export const CLOUDFLARE_QUEUE_FREE_ENVELOPE_BOOTSTRAP_DEAD_LETTER_QUEUE =
	'commons-public-template-og-dlq';
export const CLOUDFLARE_QUEUE_FREE_ENVELOPE_OBSERVATION_SEPARATION_SECONDS = 15 * 60;
export const CLOUDFLARE_QUEUE_FREE_ENVELOPE_DATA_LAG_SECONDS = 15 * 60;
export const CLOUDFLARE_QUEUE_FREE_ENVELOPE_RELEASE_PHASES = Object.freeze([
	'activate-preview',
	'activate-production',
	'bootstrap-production'
]);
export const CLOUDFLARE_QUEUE_FREE_ENVELOPE_OBSERVER_TOKEN_PERMISSIONS = Object.freeze([
	'Account Analytics Read',
	'Billing Read',
	'Queues Read',
	'Workers Scripts Read'
]);
export const CLOUDFLARE_QUEUE_FREE_ENVELOPE_BACKLOG_FIELDS = Object.freeze([
	'backlog_bytes',
	'backlog_count',
	'oldest_message_timestamp_ms'
]);
export const CLOUDFLARE_QUEUE_FREE_ENVELOPE_MANAGED_QUEUE_NAMES = Object.freeze([
	'commons-public-template-og',
	'commons-public-template-og-dlq',
	'commons-public-template-og-nonprod',
	'commons-public-template-og-nonprod-dlq'
]);

/** @param {'activate-preview'|'activate-production'|'bootstrap-production'} releasePhase */
export function cloudflareQueueFreeEnvelopeMaximumLifetimeSeconds(releasePhase) {
	invariant(
		CLOUDFLARE_QUEUE_FREE_ENVELOPE_RELEASE_PHASES.includes(releasePhase),
		'Queue Free envelope release phase is invalid.'
	);
	return releasePhase === 'bootstrap-production'
		? CLOUDFLARE_QUEUE_FREE_ENVELOPE_BOOTSTRAP_MAX_LIFETIME_SECONDS
		: CLOUDFLARE_QUEUE_FREE_ENVELOPE_MAX_LIFETIME_SECONDS;
}

/** @param {'activate-preview'|'activate-production'|'bootstrap-production'} releasePhase */
export function cloudflareQueueFreeEnvelopeMaximumVerificationAgeSeconds(releasePhase) {
	invariant(
		CLOUDFLARE_QUEUE_FREE_ENVELOPE_RELEASE_PHASES.includes(releasePhase),
		'Queue Free envelope release phase is invalid.'
	);
	return releasePhase === 'bootstrap-production'
		? CLOUDFLARE_QUEUE_FREE_ENVELOPE_BOOTSTRAP_MAX_VERIFICATION_AGE_SECONDS
		: CLOUDFLARE_QUEUE_FREE_ENVELOPE_MAX_VERIFICATION_AGE_SECONDS;
}

const MAX_ATTESTATION_BYTES = 128 * 1024;
const MAX_SIGNATURE_BYTES = 32 * 1024;
const MAX_ALLOWED_SIGNERS_BYTES = 32 * 1024;
const UTC_DAY_MS = 24 * 60 * 60 * 1000;
const SHA_PATTERN = /^[a-f0-9]{40}$/u;
const QUEUE_ID_PATTERN = /^[a-f0-9]{32}$/u;
const QUEUE_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const PRINCIPAL_PATTERN = /^[A-Za-z0-9._@+-]{1,120}$/u;
const RELEASE_TRANSACTION_PATTERN = /^[1-9][0-9]{0,19}-[1-9][0-9]{0,9}$/u;
const AUTHORITY_IDENTITY_PATTERN = /^[A-Za-z0-9._:@/+\-=]{1,512}$/u;
const ACTIVE_SUBSCRIPTION_STATES = new Set(['AwaitingPayment', 'Paid', 'Provisioned', 'Trial']);
const SUBSCRIPTION_STATES = new Set([
	...ACTIVE_SUBSCRIPTION_STATES,
	'Cancelled',
	'Expired',
	'Failed'
]);
const KNOWN_WORKERS_PAID_RATE_PLANS = new Set([
	'PARTNERS_WORKERS_BASIC',
	'PARTNERS_WORKERS_ENT',
	'PARTNERS_WORKERS_SS',
	'WORKERS_PAID'
]);

const ALLOWED_MANAGED_DELTA_TRANSITIONS = Object.freeze([
	'create-missing-target-queues-paused',
	'deploy-exact-sha-target-gate-and-consumer',
	'bind-only-target-pages-producer',
	'unpause-target-queue-only-after-live-proof'
]);
const REQUIRED_LIVE_PROOFS = Object.freeze([
	'no-unmanaged-inventory-or-authority-drift',
	'exact-target-prepared-state',
	'old-producer-contained',
	'target-queues-paused-before-activation',
	'failure-forward-containment'
]);
const BOOTSTRAP_REQUIRED_LIVE_PROOFS = Object.freeze([
	'account-wide-queue-inventory-and-authority-unchanged',
	'existing-production-queue-and-gate-only',
	'exact-bootstrap-worker-is-the-only-transient-primary-producer-delta',
	'no-queue-create-delete-settings-consumer-or-dlq-delta',
	'route-first-script-deletion-restores-the-exact-signed-baseline'
]);
const BOOTSTRAP_ALLOWED_TRANSITIONS = Object.freeze([
	'attach-exact-bootstrap-worker-to-existing-production-primary-producer',
	'detach-exact-bootstrap-worker-after-route-first-script-deletion'
]);
// Schema 2 does not pretend the temporary Worker is configuration-neutral: it
// owns exactly one producer attachment on an existing Queue and its removal.
// Queue creation/deletion, settings, consumers, and every DLQ mutation remain
// outside the signed authority and are rejected by both live proof states.
const PHASE_MUTATION_AUTHORITY = Object.freeze({
	'activate-preview': Object.freeze({
		allowedTransitions: ALLOWED_MANAGED_DELTA_TRANSITIONS,
		liveProofRequirements: REQUIRED_LIVE_PROOFS,
		queueNames: Object.freeze([
			'commons-public-template-og-nonprod',
			'commons-public-template-og-nonprod-dlq'
		]),
		targetRealm: 'preview'
	}),
	'activate-production': Object.freeze({
		allowedTransitions: ALLOWED_MANAGED_DELTA_TRANSITIONS,
		liveProofRequirements: REQUIRED_LIVE_PROOFS,
		queueNames: Object.freeze(['commons-public-template-og', 'commons-public-template-og-dlq']),
		targetRealm: 'production'
	}),
	'bootstrap-production': Object.freeze({
		allowedTransitions: BOOTSTRAP_ALLOWED_TRANSITIONS,
		liveProofRequirements: BOOTSTRAP_REQUIRED_LIVE_PROOFS,
		queueNames: Object.freeze([CLOUDFLARE_QUEUE_FREE_ENVELOPE_BOOTSTRAP_QUEUE]),
		targetRealm: 'production'
	})
});

/** @param {'activate-preview'|'activate-production'|'bootstrap-production'} releasePhase */
export function cloudflareQueueFreeEnvelopeAuthorizedManagedDelta(releasePhase) {
	invariant(
		CLOUDFLARE_QUEUE_FREE_ENVELOPE_RELEASE_PHASES.includes(releasePhase),
		'Queue Free envelope release phase is invalid.'
	);
	const authority = PHASE_MUTATION_AUTHORITY[releasePhase];
	return {
		allowedTransitions: [...authority.allowedTransitions],
		liveProofRequirements: [...authority.liveProofRequirements],
		maximumReceiptAgeSeconds:
			cloudflareQueueFreeEnvelopeMaximumVerificationAgeSeconds(releasePhase),
		postMutationLiveProofRequired: true,
		queueNames: [...authority.queueNames],
		targetRealm: authority.targetRealm
	};
}

/** @param {unknown} condition @param {string} message @returns {asserts condition} */
function invariant(condition, message) {
	if (!condition) throw new Error(message);
}

/** @param {unknown} value @returns {Record<string, any> | null} */
function record(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

/** @param {unknown} value @param {readonly string[]} keys @param {string} label */
function exactKeys(value, keys, label) {
	const object = record(value);
	invariant(object, `Queue Free envelope ${label} must be an object.`);
	invariant(
		JSON.stringify(Object.keys(object).sort()) === JSON.stringify([...keys].sort()),
		`Queue Free envelope ${label} shape drifted.`
	);
	return object;
}

/** @param {unknown} value @param {string} label @param {number} maximum @returns {number} */
function canonicalNonnegativeInteger(value, label, maximum = Number.MAX_SAFE_INTEGER) {
	invariant(
		typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= maximum,
		`Queue Free envelope ${label} must be a canonical nonnegative integer.`
	);
	return value;
}

/** @param {unknown} value @param {string} label */
function canonicalInstant(value, label) {
	invariant(typeof value === 'string', `Queue Free envelope ${label} is invalid.`);
	const parsed = Date.parse(value);
	invariant(
		Number.isFinite(parsed) && new Date(parsed).toISOString() === value,
		`Queue Free envelope ${label} must be a canonical UTC ISO instant.`
	);
	return parsed;
}

/** @param {unknown} value @returns {string} */
export function canonicalCloudflareQueueFreeEnvelopeJson(value) {
	if (value === null || typeof value === 'boolean' || typeof value === 'string') {
		return JSON.stringify(value);
	}
	if (typeof value === 'number') {
		invariant(
			Number.isSafeInteger(value),
			'Queue Free envelope canonical JSON numbers must be safe integers.'
		);
		return String(value);
	}
	if (Array.isArray(value)) {
		return `[${value.map((entry) => canonicalCloudflareQueueFreeEnvelopeJson(entry)).join(',')}]`;
	}
	const object = record(value);
	invariant(object, 'Queue Free envelope canonical JSON contains an unsupported value.');
	return `{${Object.keys(object)
		.sort()
		.map((key) => `${JSON.stringify(key)}:${canonicalCloudflareQueueFreeEnvelopeJson(object[key])}`)
		.join(',')}}`;
}

/** @param {Record<string, any>} attestation */
export function canonicalCloudflareQueueFreeEnvelopeBytes(attestation) {
	return Buffer.from(`${canonicalCloudflareQueueFreeEnvelopeJson(attestation)}\n`, 'utf8');
}

/** @param {unknown} value @param {string} label @param {number} expectedItems */
function validateRestPagination(value, label, expectedItems) {
	const pagination = exactKeys(
		value,
		['complete', 'pageSize', 'pages', 'totalItems', 'totalPages'],
		`${label} pagination`
	);
	invariant(pagination.complete === true, `Queue Free envelope ${label} pagination is incomplete.`);
	const pageSize = canonicalNonnegativeInteger(
		pagination.pageSize,
		`${label} pagination pageSize`,
		1_000
	);
	invariant(pageSize >= 1, `Queue Free envelope ${label} pagination pageSize is invalid.`);
	invariant(
		pagination.totalItems === expectedItems,
		`Queue Free envelope ${label} pagination total does not reconcile.`
	);
	const totalPages = canonicalNonnegativeInteger(
		pagination.totalPages,
		`${label} pagination totalPages`,
		100
	);
	invariant(
		Array.isArray(pagination.pages) && pagination.pages.length === totalPages && totalPages >= 1,
		`Queue Free envelope ${label} pagination pages are invalid.`
	);
	let itemTotal = 0;
	for (const [index, rawPage] of pagination.pages.entries()) {
		const page = exactKeys(rawPage, ['itemCount', 'page'], `${label} pagination page`);
		invariant(
			page.page === index + 1,
			`Queue Free envelope ${label} pagination page sequence is broken.`
		);
		const itemCount = canonicalNonnegativeInteger(
			page.itemCount,
			`${label} pagination itemCount`,
			pageSize
		);
		itemTotal += itemCount;
		invariant(
			Number.isSafeInteger(itemTotal),
			`Queue Free envelope ${label} pagination total overflowed.`
		);
		const finalPage = index === pagination.pages.length - 1;
		invariant(
			(finalPage && itemCount <= pageSize) || (!finalPage && itemCount === pageSize),
			`Queue Free envelope ${label} pagination page cardinality is invalid.`
		);
	}
	invariant(
		itemTotal === expectedItems,
		`Queue Free envelope ${label} pagination item count does not reconcile.`
	);
}

/** @param {unknown} value @param {Record<string,any>[]} queues @param {string} label */
function validateGraphqlQueueCoverage(value, queues, label) {
	const coverage = exactKeys(
		value,
		['accountAggregateQueryCount', 'complete', 'queryCount', 'queryLimit', 'queueIds'],
		`${label} GraphQL coverage`
	);
	invariant(coverage.complete === true, `Queue Free envelope ${label} coverage is incomplete.`);
	invariant(
		coverage.accountAggregateQueryCount === 1 &&
			coverage.queryLimit === 1 &&
			coverage.queryCount === queues.length,
		`Queue Free envelope ${label} query cardinality does not reconcile.`
	);
	invariant(
		JSON.stringify(coverage.queueIds) === JSON.stringify(queues.map((queue) => queue.id)),
		`Queue Free envelope ${label} did not query every exact Queue id.`
	);
}

/** @param {unknown} value @param {number} expectedPaidCount */
function validateSubscriptionEvidence(value, expectedPaidCount) {
	const evidence = exactKeys(
		value,
		['derivation', 'pagination', 'subscriptions'],
		'account subscription evidence'
	);
	invariant(
		evidence.derivation === 'workers-free-derived-from-complete-account-subscription-inventory',
		'Queue Free envelope Workers plan derivation is invalid.'
	);
	invariant(
		Array.isArray(evidence.subscriptions) && evidence.subscriptions.length <= 10_000,
		'Queue Free envelope subscription inventory is invalid.'
	);
	validateRestPagination(
		evidence.pagination,
		'account subscriptions',
		evidence.subscriptions.length
	);
	let previousId = '';
	let paidCount = 0;
	for (const [index, rawSubscription] of evidence.subscriptions.entries()) {
		const subscription = exactKeys(
			rawSubscription,
			['externallyManaged', 'isContract', 'ratePlanId', 'scope', 'sets', 'state', 'subscriptionId'],
			`account subscription ${index}`
		);
		invariant(
			typeof subscription.subscriptionId === 'string' &&
				AUTHORITY_IDENTITY_PATTERN.test(subscription.subscriptionId) &&
				(previousId === '' || previousId < subscription.subscriptionId),
			'Queue Free envelope subscription ids must be exact, unique, and sorted.'
		);
		previousId = subscription.subscriptionId;
		invariant(
			typeof subscription.ratePlanId === 'string' &&
				AUTHORITY_IDENTITY_PATTERN.test(subscription.ratePlanId) &&
				typeof subscription.scope === 'string' &&
				subscription.scope.length <= 256 &&
				typeof subscription.externallyManaged === 'boolean' &&
				typeof subscription.isContract === 'boolean' &&
				typeof subscription.state === 'string' &&
				SUBSCRIPTION_STATES.has(subscription.state) &&
				Array.isArray(subscription.sets),
			`Queue Free envelope subscription ${subscription.subscriptionId} is invalid.`
		);
		let previousSet = '';
		for (const set of subscription.sets) {
			invariant(
				typeof set === 'string' &&
					AUTHORITY_IDENTITY_PATTERN.test(set) &&
					(previousSet === '' || previousSet < set),
				`Queue Free envelope subscription ${subscription.subscriptionId} sets must be exact, unique, and sorted.`
			);
			previousSet = set;
		}
		if (!ACTIVE_SUBSCRIPTION_STATES.has(subscription.state)) continue;
		const workerSignals = [subscription.ratePlanId, subscription.scope, ...subscription.sets]
			.join(':')
			.toUpperCase();
		if (!workerSignals.includes('WORKER')) continue;
		invariant(
			!subscription.externallyManaged && !subscription.isContract,
			`Queue Free envelope active Workers subscription ${subscription.subscriptionId} is contract or externally managed.`
		);
		const ratePlanId = subscription.ratePlanId.toUpperCase();
		if (KNOWN_WORKERS_PAID_RATE_PLANS.has(ratePlanId)) {
			paidCount += 1;
		} else {
			invariant(
				ratePlanId.includes('FREE'),
				`Queue Free envelope active Workers rate plan ${subscription.ratePlanId} is unclassified.`
			);
		}
	}
	invariant(
		paidCount === expectedPaidCount,
		'Queue Free envelope active Workers-paid subscription count does not reconcile.'
	);
	return paidCount;
}

/** @param {unknown} value @param {number} observationIndex */
function validateQueueInventory(value, observationIndex) {
	invariant(
		Array.isArray(value) && value.length <= 10_000,
		`Queue Free envelope observation ${observationIndex} queue inventory is invalid.`
	);
	const ids = new Set();
	const names = new Set();
	let previousName = '';
	return value.map((rawQueue, queueIndex) => {
		const queue = exactKeys(
			rawQueue,
			[
				'advisoryBacklog',
				'consumerCount',
				'consumerIds',
				'id',
				'name',
				'producerCount',
				'producerIdentities',
				'settings'
			],
			`observation ${observationIndex} queue ${queueIndex}`
		);
		invariant(
			typeof queue.id === 'string' && QUEUE_ID_PATTERN.test(queue.id) && !ids.has(queue.id),
			`Queue Free envelope observation ${observationIndex} queue id is invalid or duplicated.`
		);
		ids.add(queue.id);
		invariant(
			typeof queue.name === 'string' &&
				queue.name.length <= 128 &&
				QUEUE_NAME_PATTERN.test(queue.name) &&
				!names.has(queue.name) &&
				(previousName === '' || previousName < queue.name),
			`Queue Free envelope observation ${observationIndex} queue names must be exact, unique, and sorted.`
		);
		names.add(queue.name);
		previousName = queue.name;
		const producerCount = canonicalNonnegativeInteger(
			queue.producerCount,
			`observation ${observationIndex} queue producerCount`,
			10_000
		);
		const consumerCount = canonicalNonnegativeInteger(
			queue.consumerCount,
			`observation ${observationIndex} queue consumerCount`,
			10_000
		);
		invariant(
			Array.isArray(queue.consumerIds) && queue.consumerIds.length === consumerCount,
			`Queue Free envelope observation ${observationIndex} queue ${queue.name} consumer identities do not reconcile.`
		);
		let previousConsumerId = '';
		for (const consumerId of queue.consumerIds) {
			invariant(
				typeof consumerId === 'string' &&
					AUTHORITY_IDENTITY_PATTERN.test(consumerId) &&
					(previousConsumerId === '' || previousConsumerId < consumerId),
				`Queue Free envelope observation ${observationIndex} queue ${queue.name} consumer identities must be exact, unique, and sorted.`
			);
			previousConsumerId = consumerId;
		}
		invariant(
			Array.isArray(queue.producerIdentities) && queue.producerIdentities.length === producerCount,
			`Queue Free envelope observation ${observationIndex} queue ${queue.name} producer identities do not reconcile.`
		);
		let previousProducerIdentity = '';
		for (const [producerIndex, rawProducer] of queue.producerIdentities.entries()) {
			const producer = exactKeys(
				rawProducer,
				['script', 'type'],
				`observation ${observationIndex} queue ${queue.name} producer ${producerIndex}`
			);
			invariant(
				producer.type === 'worker' &&
					typeof producer.script === 'string' &&
					AUTHORITY_IDENTITY_PATTERN.test(producer.script),
				`Queue Free envelope observation ${observationIndex} queue ${queue.name} producer identity is invalid.`
			);
			const identity = canonicalCloudflareQueueFreeEnvelopeJson(producer);
			invariant(
				previousProducerIdentity === '' || previousProducerIdentity < identity,
				`Queue Free envelope observation ${observationIndex} queue ${queue.name} producer identities must be exact, unique, and sorted.`
			);
			previousProducerIdentity = identity;
		}
		if (!CLOUDFLARE_QUEUE_FREE_ENVELOPE_MANAGED_QUEUE_NAMES.includes(queue.name)) {
			invariant(
				producerCount === 0 && consumerCount === 0,
				`Queue Free envelope nonallowlisted queue ${queue.name} has producer or consumer authority.`
			);
		}
		const settings = exactKeys(
			queue.settings,
			['deliveryDelay', 'deliveryPaused', 'messageRetentionPeriod'],
			`observation ${observationIndex} queue ${queue.name} settings`
		);
		canonicalNonnegativeInteger(
			settings.deliveryDelay,
			`observation ${observationIndex} queue ${queue.name} deliveryDelay`
		);
		invariant(
			typeof settings.deliveryPaused === 'boolean',
			`Queue Free envelope observation ${observationIndex} queue ${queue.name} deliveryPaused is invalid.`
		);
		invariant(
			canonicalNonnegativeInteger(
				settings.messageRetentionPeriod,
				`observation ${observationIndex} queue ${queue.name} messageRetentionPeriod`
			) > 0,
			`Queue Free envelope observation ${observationIndex} queue ${queue.name} messageRetentionPeriod is invalid.`
		);
		const backlog = exactKeys(
			queue.advisoryBacklog,
			['backlogBytes', 'backlogMessages', 'oldestMessageTimestampMs'],
			`observation ${observationIndex} queue ${queue.name} advisory backlog`
		);
		for (const metric of ['backlogBytes', 'backlogMessages', 'oldestMessageTimestampMs']) {
			invariant(
				canonicalNonnegativeInteger(
					backlog[metric],
					`observation ${observationIndex} queue ${queue.name} ${metric}`
				) === 0,
				`Queue Free envelope observation ${observationIndex} queue ${queue.name} has positive advisory backlog.`
			);
		}
		return queue;
	});
}

/** @param {unknown} value @param {number} observationIndex @param {Record<string, any>[]} queues */
function validateQueueOperations(value, observationIndex, queues) {
	invariant(
		Array.isArray(value) && value.length === queues.length,
		`Queue Free envelope observation ${observationIndex} GraphQL queue operations are incomplete.`
	);
	let total = 0;
	return value.map((rawOperation, queueIndex) => {
		const operation = exactKeys(
			rawOperation,
			['billableOperations', 'queueId', 'queueName'],
			`observation ${observationIndex} GraphQL queue operation ${queueIndex}`
		);
		const queue = queues[queueIndex];
		invariant(
			operation.queueId === queue.id && operation.queueName === queue.name,
			`Queue Free envelope observation ${observationIndex} GraphQL queue operations do not reconcile to inventory.`
		);
		const billableOperations = canonicalNonnegativeInteger(
			operation.billableOperations,
			`observation ${observationIndex} queue ${queue.name} billableOperations`,
			CLOUDFLARE_QUEUE_FREE_ENVELOPE_MAX_BILLABLE_OPERATIONS
		);
		total += billableOperations;
		invariant(
			Number.isSafeInteger(total),
			`Queue Free envelope observation ${observationIndex} GraphQL total overflowed.`
		);
		return operation;
	});
}

/**
 * Validate one signed, operator-captured account-wide Queue Free-plan envelope.
 * This proves a quiet observation window and bounded admission precondition. It
 * is not a hard upper bound on future or duplicate Queue delivery operations.
 * @param {{attestation:unknown, expectedOperatorPrincipal?:string, expectedReleasePhase:'activate-preview'|'activate-production'|'bootstrap-production', expectedReleaseTransactionId?:string, expectedSourceSha:string, minimumRemainingValiditySeconds?:number, nowMs?:number}} input
 */
export function validateCloudflareQueueFreeEnvelope({
	attestation: rawAttestation,
	expectedOperatorPrincipal,
	expectedReleasePhase,
	expectedReleaseTransactionId,
	expectedSourceSha,
	minimumRemainingValiditySeconds = 0,
	nowMs = Date.now()
}) {
	invariant(
		SHA_PATTERN.test(expectedSourceSha),
		'Queue Free envelope expected source SHA is invalid.'
	);
	invariant(
		CLOUDFLARE_QUEUE_FREE_ENVELOPE_RELEASE_PHASES.includes(expectedReleasePhase),
		'Queue Free envelope expected release phase is invalid.'
	);
	const bootstrapPhase = expectedReleasePhase === 'bootstrap-production';
	const maximumLifetimeSeconds =
		cloudflareQueueFreeEnvelopeMaximumLifetimeSeconds(expectedReleasePhase);
	const maximumVerificationAgeSeconds =
		cloudflareQueueFreeEnvelopeMaximumVerificationAgeSeconds(expectedReleasePhase);
	invariant(
		Number.isSafeInteger(nowMs) && nowMs >= 0,
		'Queue Free envelope verification clock is invalid.'
	);
	invariant(
		Number.isSafeInteger(minimumRemainingValiditySeconds) &&
			minimumRemainingValiditySeconds >= 0 &&
			minimumRemainingValiditySeconds <= maximumLifetimeSeconds,
		'Queue Free envelope minimum remaining validity is invalid.'
	);
	const attestation = exactKeys(
		rawAttestation,
		[
			'account',
			'authorizedManagedDelta',
			'capturedAt',
			'expiresAt',
			'managedQueueAllowlist',
			'namespace',
			'observations',
			'observer',
			'operatorPrincipal',
			'releasePhase',
			...(bootstrapPhase ? ['releaseTransactionId'] : []),
			'schemaVersion',
			'source',
			'sourceSha',
			'utcDayStart'
		],
		'attestation'
	);
	invariant(
		attestation.schemaVersion === (bootstrapPhase ? 2 : 1),
		`Queue Free envelope schema must be ${bootstrapPhase ? 2 : 1} for ${expectedReleasePhase}.`
	);
	invariant(
		attestation.namespace === CLOUDFLARE_QUEUE_FREE_ENVELOPE_SIGNATURE_NAMESPACE,
		'Queue Free envelope namespace is invalid.'
	);
	invariant(
		attestation.sourceSha === expectedSourceSha,
		'Queue Free envelope is for a different source SHA.'
	);
	invariant(
		attestation.releasePhase === expectedReleasePhase,
		'Queue Free envelope is for a different release phase.'
	);
	const source = exactKeys(
		attestation.source,
		[
			'accountApiOrigin',
			'accountSubscriptionsPath',
			'dataThroughSemantics',
			'graphqlApiEndpoint',
			'queueInventoryPath',
			'queueMessageOperationsDataset',
			'queueMessageOperationsMetric',
			'queueMessageOperationsSemantics',
			'realtimeBacklogFields',
			'workersAccountSettingsPath'
		],
		'evidence source'
	);
	invariant(
		source.accountApiOrigin === 'https://api.cloudflare.com/client/v4' &&
			source.accountSubscriptionsPath ===
				`/accounts/${CLOUDFLARE_QUEUE_FREE_ENVELOPE_ACCOUNT_ID}/subscriptions` &&
			source.dataThroughSemantics === 'graphql-query-window-end' &&
			source.graphqlApiEndpoint === 'https://api.cloudflare.com/client/v4/graphql' &&
			source.queueInventoryPath ===
				`/accounts/${CLOUDFLARE_QUEUE_FREE_ENVELOPE_ACCOUNT_ID}/queues` &&
			source.queueMessageOperationsDataset === 'queueMessageOperationsAdaptiveGroups' &&
			source.queueMessageOperationsMetric === 'billableOperations' &&
			source.queueMessageOperationsSemantics ===
				'analytics-operational-signal-not-billing-or-invoice-truth' &&
			JSON.stringify(source.realtimeBacklogFields) ===
				JSON.stringify(CLOUDFLARE_QUEUE_FREE_ENVELOPE_BACKLOG_FIELDS) &&
			source.workersAccountSettingsPath ===
				`/accounts/${CLOUDFLARE_QUEUE_FREE_ENVELOPE_ACCOUNT_ID}/workers/account-settings`,
		'Queue Free envelope evidence source drifted.'
	);
	invariant(
		typeof attestation.operatorPrincipal === 'string' &&
			PRINCIPAL_PATTERN.test(attestation.operatorPrincipal),
		'Queue Free envelope operator principal is invalid.'
	);
	if (bootstrapPhase) {
		invariant(
			typeof expectedOperatorPrincipal === 'string' &&
				PRINCIPAL_PATTERN.test(expectedOperatorPrincipal),
			'Queue Free bootstrap expected operator principal is invalid.'
		);
		invariant(
			attestation.operatorPrincipal === expectedOperatorPrincipal,
			'Queue Free bootstrap envelope is for a different operator principal.'
		);
		invariant(
			typeof expectedReleaseTransactionId === 'string' &&
				RELEASE_TRANSACTION_PATTERN.test(expectedReleaseTransactionId),
			'Queue Free bootstrap expected release transaction is invalid.'
		);
		invariant(
			attestation.releaseTransactionId === expectedReleaseTransactionId,
			'Queue Free bootstrap envelope is for a different release transaction.'
		);
	}
	invariant(
		JSON.stringify(attestation.managedQueueAllowlist) ===
			JSON.stringify(CLOUDFLARE_QUEUE_FREE_ENVELOPE_MANAGED_QUEUE_NAMES),
		'Queue Free envelope managed Queue allowlist drifted.'
	);
	const expectedMutationAuthority = PHASE_MUTATION_AUTHORITY[expectedReleasePhase];
	const authorizedManagedDelta = exactKeys(
		attestation.authorizedManagedDelta,
		[
			'allowedTransitions',
			'liveProofRequirements',
			'maximumReceiptAgeSeconds',
			'postMutationLiveProofRequired',
			'queueNames',
			'targetRealm'
		],
		'authorized managed delta'
	);
	invariant(
		authorizedManagedDelta.targetRealm === expectedMutationAuthority.targetRealm &&
			authorizedManagedDelta.maximumReceiptAgeSeconds === maximumVerificationAgeSeconds &&
			authorizedManagedDelta.postMutationLiveProofRequired === true &&
			JSON.stringify(authorizedManagedDelta.queueNames) ===
				JSON.stringify(expectedMutationAuthority.queueNames) &&
			JSON.stringify(authorizedManagedDelta.allowedTransitions) ===
				JSON.stringify(expectedMutationAuthority.allowedTransitions) &&
			JSON.stringify(authorizedManagedDelta.liveProofRequirements) ===
				JSON.stringify(expectedMutationAuthority.liveProofRequirements),
		'Queue Free envelope managed delta authority does not match its release phase.'
	);
	const observer = exactKeys(
		attestation.observer,
		['credentialPersisted', 'tokenPermissions'],
		'observer authority'
	);
	invariant(
		observer.credentialPersisted === false &&
			JSON.stringify(observer.tokenPermissions) ===
				JSON.stringify(CLOUDFLARE_QUEUE_FREE_ENVELOPE_OBSERVER_TOKEN_PERMISSIONS),
		'Queue Free envelope observer must use only the pinned read-only permissions without persisting its credential.'
	);

	const account = exactKeys(
		attestation.account,
		[
			'activeWorkersPaidSubscriptions',
			'defaultUsageModel',
			'id',
			'subscriptionEvidence',
			'workersPlan'
		],
		'account'
	);
	invariant(
		account.id === CLOUDFLARE_QUEUE_FREE_ENVELOPE_ACCOUNT_ID &&
			account.workersPlan === 'free' &&
			account.defaultUsageModel === 'bundled',
		'Queue Free envelope account is not the exact Free bundled authority.'
	);
	const paidSubscriptionCount = canonicalNonnegativeInteger(
		account.activeWorkersPaidSubscriptions,
		'activeWorkersPaidSubscriptions'
	);
	validateSubscriptionEvidence(account.subscriptionEvidence, paidSubscriptionCount);
	invariant(
		paidSubscriptionCount === 0,
		'Queue Free envelope account has an active Workers-paid subscription.'
	);

	const capturedAtMs = canonicalInstant(attestation.capturedAt, 'capturedAt');
	const expiresAtMs = canonicalInstant(attestation.expiresAt, 'expiresAt');
	invariant(
		capturedAtMs <= nowMs + CLOUDFLARE_QUEUE_FREE_ENVELOPE_MAX_FUTURE_SKEW_SECONDS * 1000 &&
			expiresAtMs > capturedAtMs &&
			expiresAtMs - capturedAtMs <= maximumLifetimeSeconds * 1000 &&
			nowMs <= expiresAtMs,
		'Queue Free envelope is expired, future-dated, or overlong.'
	);
	invariant(
		expiresAtMs - nowMs >= minimumRemainingValiditySeconds * 1000,
		'Queue Free envelope does not retain enough validity.'
	);
	const receiptAgeMs = nowMs - capturedAtMs;
	const receiptAgeSeconds = Math.floor(receiptAgeMs / 1000);
	invariant(
		receiptAgeMs <= maximumVerificationAgeSeconds * 1000,
		'Queue Free envelope exceeds the maximum verification age.'
	);

	const utcDayStartMs = canonicalInstant(attestation.utcDayStart, 'utcDayStart');
	invariant(
		new Date(utcDayStartMs).getUTCHours() === 0 &&
			new Date(utcDayStartMs).getUTCMinutes() === 0 &&
			new Date(utcDayStartMs).getUTCSeconds() === 0 &&
			new Date(utcDayStartMs).getUTCMilliseconds() === 0,
		'Queue Free envelope utcDayStart must be UTC midnight.'
	);
	const utcDayEndMs = utcDayStartMs + UTC_DAY_MS;
	invariant(
		capturedAtMs >= utcDayStartMs &&
			capturedAtMs < utcDayEndMs &&
			expiresAtMs <= utcDayEndMs &&
			nowMs >= utcDayStartMs &&
			nowMs < utcDayEndMs,
		'Queue Free envelope capture, expiry, and verification must remain inside one UTC accounting day.'
	);
	invariant(
		Array.isArray(attestation.observations) && attestation.observations.length === 2,
		'Queue Free envelope requires exactly two observations.'
	);

	const observations = attestation.observations.map((rawObservation, observationIndex) => {
		const observation = exactKeys(
			rawObservation,
			[
				'accountBillableOperations',
				'dataThrough',
				'observedAt',
				'pagination',
				'queueOperations',
				'queues',
				'retiredQueueBillableOperations',
				'utcDayStart'
			],
			`observation ${observationIndex + 1}`
		);
		invariant(
			observation.utcDayStart === attestation.utcDayStart,
			`Queue Free envelope observation ${observationIndex + 1} UTC day drifted.`
		);
		const observedAtMs = canonicalInstant(
			observation.observedAt,
			`observation ${observationIndex + 1} observedAt`
		);
		const dataThroughMs = canonicalInstant(
			observation.dataThrough,
			`observation ${observationIndex + 1} dataThrough`
		);
		invariant(
			observedAtMs >= utcDayStartMs &&
				observedAtMs < utcDayEndMs &&
				dataThroughMs >= utcDayStartMs &&
				dataThroughMs < utcDayEndMs &&
				observedAtMs - dataThroughMs >= CLOUDFLARE_QUEUE_FREE_ENVELOPE_DATA_LAG_SECONDS * 1000,
			`Queue Free envelope observation ${observationIndex + 1} does not prove the required data lag in one UTC day.`
		);
		const accountBillableOperations = canonicalNonnegativeInteger(
			observation.accountBillableOperations,
			`observation ${observationIndex + 1} accountBillableOperations`,
			CLOUDFLARE_QUEUE_FREE_ENVELOPE_MAX_BILLABLE_OPERATIONS
		);
		const retiredQueueBillableOperations = canonicalNonnegativeInteger(
			observation.retiredQueueBillableOperations,
			`observation ${observationIndex + 1} retiredQueueBillableOperations`,
			CLOUDFLARE_QUEUE_FREE_ENVELOPE_MAX_BILLABLE_OPERATIONS
		);
		const queues = validateQueueInventory(observation.queues, observationIndex + 1);
		const queueOperations = validateQueueOperations(
			observation.queueOperations,
			observationIndex + 1,
			queues
		);
		const pagination = exactKeys(
			observation.pagination,
			['queueInventory', 'queueOperations'],
			`observation ${observationIndex + 1} pagination evidence`
		);
		validateRestPagination(
			pagination.queueInventory,
			`observation ${observationIndex + 1} queue inventory`,
			queues.length
		);
		validateGraphqlQueueCoverage(
			pagination.queueOperations,
			queues,
			`observation ${observationIndex + 1} GraphQL queue operations`
		);
		const reconciledBillableOperations = queueOperations.reduce(
			(total, operation) => total + operation.billableOperations,
			0
		);
		invariant(
			reconciledBillableOperations + retiredQueueBillableOperations === accountBillableOperations,
			`Queue Free envelope observation ${observationIndex + 1} current and retired Queue GraphQL operations do not reconcile to the account total.`
		);
		return {
			accountBillableOperations,
			dataThroughMs,
			observedAtMs,
			queueOperations,
			queues,
			retiredQueueBillableOperations
		};
	});

	const [first, second] = observations;
	invariant(
		second.observedAtMs - first.observedAtMs >=
			CLOUDFLARE_QUEUE_FREE_ENVELOPE_OBSERVATION_SEPARATION_SECONDS * 1000,
		'Queue Free envelope observations are less than 15 minutes apart.'
	);
	invariant(
		second.dataThroughMs >= first.dataThroughMs,
		'Queue Free envelope GraphQL dataThrough regressed.'
	);
	invariant(
		capturedAtMs >= second.observedAtMs &&
			capturedAtMs - second.observedAtMs <=
				CLOUDFLARE_QUEUE_FREE_ENVELOPE_MAX_CAPTURE_DELAY_SECONDS * 1000,
		'Queue Free envelope capture is before or too long after its second observation.'
	);
	invariant(
		second.accountBillableOperations === first.accountBillableOperations,
		'Queue Free envelope cumulative account operations changed between observations.'
	);
	invariant(
		second.retiredQueueBillableOperations === first.retiredQueueBillableOperations,
		'Queue Free envelope retired-Queue operation delta changed between observations.'
	);
	invariant(
		canonicalCloudflareQueueFreeEnvelopeJson(second.queues) ===
			canonicalCloudflareQueueFreeEnvelopeJson(first.queues),
		'Queue Free envelope Queue inventory or authority changed between observations.'
	);
	invariant(
		canonicalCloudflareQueueFreeEnvelopeJson(second.queueOperations) ===
			canonicalCloudflareQueueFreeEnvelopeJson(first.queueOperations),
		'Queue Free envelope per-Queue cumulative operations changed between observations.'
	);
	if (bootstrapPhase) {
		for (const queueName of [
			CLOUDFLARE_QUEUE_FREE_ENVELOPE_BOOTSTRAP_QUEUE,
			CLOUDFLARE_QUEUE_FREE_ENVELOPE_BOOTSTRAP_DEAD_LETTER_QUEUE
		]) {
			invariant(
				first.queues.filter((queue) => queue.name === queueName).length === 1,
				`Queue Free bootstrap must reuse the existing ${queueName} Queue.`
			);
		}
		const primary = first.queues.find(
			(queue) => queue.name === CLOUDFLARE_QUEUE_FREE_ENVELOPE_BOOTSTRAP_QUEUE
		);
		const deadLetter = first.queues.find(
			(queue) => queue.name === CLOUDFLARE_QUEUE_FREE_ENVELOPE_BOOTSTRAP_DEAD_LETTER_QUEUE
		);
		invariant(primary !== undefined, 'Queue Free bootstrap primary Queue is missing.');
		invariant(
			deadLetter !== undefined &&
				primary.producerCount === 0 &&
				primary.producerIdentities.length === 0 &&
				primary.consumerCount === 1 &&
				primary.consumerIds.length === 1 &&
				primary.settings.deliveryDelay === 0 &&
				primary.settings.deliveryPaused === false &&
				primary.settings.messageRetentionPeriod === 86_400 &&
				deadLetter.producerCount === 0 &&
				deadLetter.producerIdentities.length === 0 &&
				deadLetter.consumerCount === 0 &&
				deadLetter.consumerIds.length === 0 &&
				deadLetter.settings.deliveryDelay === 0 &&
				deadLetter.settings.deliveryPaused === false &&
				deadLetter.settings.messageRetentionPeriod === 86_400,
			'Queue Free bootstrap needs an active producerless Queue, one existing consumer, and an authority-free DLQ.'
		);
	}

	const managedQueueCount = first.queues.filter((queue) =>
		CLOUDFLARE_QUEUE_FREE_ENVELOPE_MANAGED_QUEUE_NAMES.includes(queue.name)
	).length;
	return {
		accountBillableOperations: first.accountBillableOperations,
		accountId: account.id,
		capturedAt: attestation.capturedAt,
		defaultUsageModel: account.defaultUsageModel,
		expiresAt: attestation.expiresAt,
		managedQueueCount,
		mode: 'signed-observation-baseline-not-live-post-mutation-proof',
		observationSeparationSeconds: Math.floor((second.observedAtMs - first.observedAtMs) / 1000),
		queueCount: first.queues.length,
		retiredQueueBillableOperations: first.retiredQueueBillableOperations,
		releasePhase: attestation.releasePhase,
		...(bootstrapPhase
			? {
					operatorPrincipal: attestation.operatorPrincipal,
					releaseTransactionId: attestation.releaseTransactionId
				}
			: {}),
		authorizedManagedDelta: {
			allowedTransitions: [...authorizedManagedDelta.allowedTransitions],
			liveProofRequirements: [...authorizedManagedDelta.liveProofRequirements],
			maximumReceiptAgeSeconds: maximumVerificationAgeSeconds,
			postMutationLiveProofRequired: true,
			queueNames: [...authorizedManagedDelta.queueNames],
			targetRealm: authorizedManagedDelta.targetRealm
		},
		baselineQueueInventory: first.queues.map((queue) => ({
			advisoryBacklog: { ...queue.advisoryBacklog },
			consumerCount: queue.consumerCount,
			consumerIds: [...queue.consumerIds],
			id: queue.id,
			name: queue.name,
			producerCount: queue.producerCount,
			producerIdentities: /** @type {Record<string,any>[]} */ (queue.producerIdentities).map(
				(producer) => ({ ...producer })
			),
			settings: { ...queue.settings }
		})),
		receiptAgeSeconds,
		remainingValiditySeconds: Math.floor((expiresAtMs - nowMs) / 1000),
		unmanagedQueueCount: first.queues.length - managedQueueCount,
		utcDayStart: attestation.utcDayStart,
		verificationTimestamp: new Date(nowMs).toISOString(),
		workersPlan: account.workersPlan
	};
}

/**
 * @param {{allowedSignersPath:string, attestation:Record<string,any>, signature:Buffer|string}} input
 */
export function verifyCloudflareQueueFreeEnvelopeSignature({
	allowedSignersPath,
	attestation,
	signature
}) {
	const principal = attestation.operatorPrincipal;
	invariant(
		typeof principal === 'string' && PRINCIPAL_PATTERN.test(principal),
		'Queue Free envelope signer principal is invalid.'
	);
	const signatureBytes = Buffer.isBuffer(signature) ? signature : Buffer.from(signature, 'utf8');
	invariant(
		signatureBytes.length > 0 && signatureBytes.length <= MAX_SIGNATURE_BYTES,
		'Queue Free envelope signature size is invalid.'
	);
	const absoluteAllowedSigners = path.resolve(allowedSignersPath);
	const allowedStats = statSync(absoluteAllowedSigners);
	invariant(
		allowedStats.isFile() && allowedStats.size <= MAX_ALLOWED_SIGNERS_BYTES,
		'Queue Free envelope allowed-signers trust root is invalid.'
	);
	const temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), 'commons-cloudflare-queue-free-'));
	const signaturePath = path.join(temporaryDirectory, 'envelope.sig');
	try {
		writeFileSync(signaturePath, signatureBytes, { mode: 0o600 });
		const result = spawnSync(
			'ssh-keygen',
			[
				'-Y',
				'verify',
				'-f',
				absoluteAllowedSigners,
				'-I',
				principal,
				'-n',
				CLOUDFLARE_QUEUE_FREE_ENVELOPE_SIGNATURE_NAMESPACE,
				'-s',
				signaturePath
			],
			{
				input: canonicalCloudflareQueueFreeEnvelopeBytes(attestation),
				encoding: 'buffer',
				maxBuffer: 1024 * 1024
			}
		);
		invariant(
			result.status === 0,
			`Queue Free envelope signature is not valid for an allowed operator: ${Buffer.from(
				result.stderr ?? ''
			)
				.toString('utf8')
				.trim()}`
		);
		const output = Buffer.from(result.stdout ?? '')
			.toString('utf8')
			.trim();
		const fingerprint = /\bkey (SHA256:[A-Za-z0-9+/=]+)$/u.exec(output)?.[1];
		invariant(
			fingerprint,
			'OpenSSH Queue Free envelope verification did not report a key fingerprint.'
		);
		return {
			keyFingerprint: fingerprint,
			namespace: CLOUDFLARE_QUEUE_FREE_ENVELOPE_SIGNATURE_NAMESPACE,
			principal
		};
	} finally {
		rmSync(temporaryDirectory, { force: true, recursive: true });
	}
}

export { MAX_ATTESTATION_BYTES as CLOUDFLARE_QUEUE_FREE_ENVELOPE_MAX_BYTES };
