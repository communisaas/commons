#!/usr/bin/env node

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
	CLOUDFLARE_QUEUE_FREE_ENVELOPE_ACCOUNT_ID,
	CLOUDFLARE_QUEUE_FREE_ENVELOPE_BACKLOG_FIELDS,
	CLOUDFLARE_QUEUE_FREE_ENVELOPE_DATA_LAG_SECONDS,
	CLOUDFLARE_QUEUE_FREE_ENVELOPE_MANAGED_QUEUE_NAMES,
	CLOUDFLARE_QUEUE_FREE_ENVELOPE_OBSERVATION_SEPARATION_SECONDS,
	CLOUDFLARE_QUEUE_FREE_ENVELOPE_OBSERVER_TOKEN_PERMISSIONS,
	CLOUDFLARE_QUEUE_FREE_ENVELOPE_RELEASE_PHASES,
	CLOUDFLARE_QUEUE_FREE_ENVELOPE_SIGNATURE_NAMESPACE,
	canonicalCloudflareQueueFreeEnvelopeBytes,
	cloudflareQueueFreeEnvelopeAuthorizedManagedDelta,
	cloudflareQueueFreeEnvelopeMaximumLifetimeSeconds,
	validateCloudflareQueueFreeEnvelope
} from './cloudflare-queue-free-envelope.mjs';
import { readBoundedResponseJson } from '../src/lib/server/bounded-response.mjs';

const API_ORIGIN = 'https://api.cloudflare.com/client/v4';
const GRAPHQL_ENDPOINT = `${API_ORIGIN}/graphql`;
const PAGE_SIZE = 100;
const MAX_PAGES = 100;
const GRAPHQL_QUERY_LIMIT = 1;
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
const SAFE_ID_PATTERN = /^[A-Za-z0-9._:@/+\-=]{1,512}$/u;
const SHA_PATTERN = /^[a-f0-9]{40}$/u;
const PRINCIPAL_PATTERN = /^[A-Za-z0-9._@+-]{1,120}$/u;
const RELEASE_TRANSACTION_PATTERN = /^[1-9][0-9]{0,19}-[1-9][0-9]{0,9}$/u;

const QUEUE_OPERATIONS_QUERY = `query QueueFreeEnvelopeOperations(
  $accountTag: string!
  $queueId: string!
  $datetimeStart: Time!
  $datetimeEnd: Time!
) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      queueMessageOperationsAdaptiveGroups(
        limit: 1
        filter: {
          queueId: $queueId
          datetime_geq: $datetimeStart
          datetime_leq: $datetimeEnd
        }
      ) {
        sum {
          billableOperations
        }
      }
    }
  }
}`;
const ACCOUNT_QUEUE_OPERATIONS_QUERY = `query QueueFreeEnvelopeAccountOperations(
  $accountTag: string!
  $datetimeStart: Time!
  $datetimeEnd: Time!
) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      queueMessageOperationsAdaptiveGroups(
        limit: 1
        filter: {
          datetime_geq: $datetimeStart
          datetime_leq: $datetimeEnd
        }
      ) {
        sum {
          billableOperations
        }
      }
    }
  }
}`;

/** @param {unknown} condition @param {string} message @returns {asserts condition} */
function invariant(condition, message) {
	if (!condition) throw new Error(message);
}

/** @param {unknown} value @returns {Record<string,any>|null} */
function record(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

/** @param {unknown} value @param {string} label @param {number} [maximum] */
function nonnegativeInteger(value, label, maximum = Number.MAX_SAFE_INTEGER) {
	invariant(
		typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= maximum,
		`${label} must be a nonnegative safe integer.`
	);
	return value;
}

/** @param {number} value */
function instant(value) {
	const result = new Date(value).toISOString();
	invariant(
		Date.parse(result) === value,
		'Queue Free capture clock must have millisecond precision.'
	);
	return result;
}

/** @param {unknown} value @param {string} label */
function apiResult(value, label) {
	const envelope = record(value);
	invariant(envelope?.success === true, `${label} response is not successful.`);
	return envelope.result;
}

/** @param {typeof fetch} fetchFn @param {string} url @param {string} apiToken @param {RequestInit} [init] */
async function fetchJson(fetchFn, url, apiToken, init = {}) {
	const response = await fetchFn(url, {
		...init,
		headers: {
			Authorization: `Bearer ${apiToken}`,
			...(init.body ? { 'Content-Type': 'application/json' } : {}),
			...(init.headers ?? {})
		},
		redirect: 'error',
		signal: AbortSignal.timeout(15_000)
	});
	invariant(
		response instanceof Response && response.ok,
		`Cloudflare observation request failed: ${url}`
	);
	return readBoundedResponseJson(response, 'Cloudflare observation response');
}

/**
 * Capture every page from an official page-number Cloudflare REST collection.
 * @param {{apiToken:string,fetchFn:typeof fetch,pathName:string,label:string}} input
 */
async function captureRestCollection({ apiToken, fetchFn, pathName, label }) {
	const items = [];
	const pages = [];
	let expectedTotal = null;
	let totalPages = null;
	for (let page = 1; page <= MAX_PAGES; page += 1) {
		const url = new URL(`${API_ORIGIN}${pathName}`);
		url.searchParams.set('page', String(page));
		url.searchParams.set('per_page', String(PAGE_SIZE));
		const value = await fetchJson(fetchFn, url.href, apiToken);
		const result = apiResult(value, label);
		const envelope = record(value);
		const info = record(envelope?.result_info);
		invariant(Array.isArray(result) && info !== null, `${label} pagination is invalid.`);
		const pageNumber = nonnegativeInteger(info.page, `${label} page`, MAX_PAGES);
		const perPage = nonnegativeInteger(info.per_page, `${label} per_page`, PAGE_SIZE);
		const count = nonnegativeInteger(info.count, `${label} count`, PAGE_SIZE);
		const totalCount = nonnegativeInteger(
			info.total_count,
			`${label} total_count`,
			PAGE_SIZE * MAX_PAGES
		);
		invariant(
			pageNumber === page && perPage === PAGE_SIZE && count === result.length,
			`${label} page metadata does not reconcile.`
		);
		const derivedTotalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
		if (info.total_pages !== undefined) {
			invariant(info.total_pages === derivedTotalPages, `${label} total_pages does not reconcile.`);
		}
		if (expectedTotal === null) {
			expectedTotal = totalCount;
			totalPages = derivedTotalPages;
		} else {
			invariant(
				totalCount === expectedTotal && derivedTotalPages === totalPages,
				`${label} pagination changed during capture.`
			);
		}
		items.push(...result);
		pages.push({ itemCount: result.length, page });
		if (page === totalPages) break;
	}
	invariant(
		expectedTotal !== null && totalPages !== null && pages.length === totalPages,
		`${label} pagination did not reach its terminal page.`
	);
	invariant(items.length === expectedTotal, `${label} pagination total does not reconcile.`);
	return {
		items,
		pagination: {
			complete: true,
			pageSize: PAGE_SIZE,
			pages,
			totalItems: items.length,
			totalPages
		}
	};
}

/**
 * @template T,U
 * @param {readonly T[]} values
 * @param {number} concurrency
 * @param {(value:T,index:number)=>Promise<U>} mapper
 * @returns {Promise<U[]>}
 */
async function mapLimited(values, concurrency, mapper) {
	const result = /** @type {U[]} */ (new Array(values.length));
	let next = 0;
	const workers = Array.from(
		{ length: Math.min(concurrency, Math.max(1, values.length)) },
		async () => {
			while (next < values.length) {
				const index = next;
				next += 1;
				result[index] = await mapper(values[index], index);
			}
		}
	);
	await Promise.all(workers);
	return result;
}

/** @param {unknown} value @param {string} label */
function normalizedQueueMetrics(value, label) {
	const result = record(apiResult(value, `${label} metrics`));
	invariant(result !== null, `${label} metrics result is invalid.`);
	return {
		backlogBytes: nonnegativeInteger(result.backlog_bytes, `${label} backlog_bytes`),
		backlogMessages: nonnegativeInteger(result.backlog_count, `${label} backlog_count`),
		oldestMessageTimestampMs: nonnegativeInteger(
			result.oldest_message_timestamp_ms,
			`${label} oldest_message_timestamp_ms`
		)
	};
}

/** @param {unknown} rawQueue @param {Record<string,number>} advisoryBacklog */
function normalizeQueue(rawQueue, advisoryBacklog) {
	const queue = record(rawQueue);
	invariant(queue !== null, 'Cloudflare Queue inventory item is invalid.');
	invariant(
		Array.isArray(queue.producers),
		`Queue ${String(queue.queue_name)} producers are invalid.`
	);
	invariant(
		Array.isArray(queue.consumers),
		`Queue ${String(queue.queue_name)} consumers are invalid.`
	);
	const producerCount = nonnegativeInteger(
		queue.producers_total_count,
		'Queue producer count',
		10_000
	);
	const consumerCount = nonnegativeInteger(
		queue.consumers_total_count,
		'Queue consumer count',
		10_000
	);
	invariant(
		producerCount === queue.producers.length && consumerCount === queue.consumers.length,
		`Queue ${String(queue.queue_name)} embedded authority counts do not reconcile.`
	);
	const producerIdentities = queue.producers
		.map((rawProducer) => {
			const producer = record(rawProducer);
			invariant(
				producer?.type === 'worker' &&
					typeof producer.script === 'string' &&
					SAFE_ID_PATTERN.test(producer.script),
				`Queue ${String(queue.queue_name)} has unsupported producer authority.`
			);
			return { script: producer.script, type: 'worker' };
		})
		.sort((left, right) => left.script.localeCompare(right.script));
	const consumerIds = queue.consumers
		.map((rawConsumer) => {
			const consumer = record(rawConsumer);
			invariant(
				typeof consumer?.consumer_id === 'string' && SAFE_ID_PATTERN.test(consumer.consumer_id),
				`Queue ${String(queue.queue_name)} has invalid consumer authority.`
			);
			return consumer.consumer_id;
		})
		.sort();
	const settings = record(queue.settings);
	invariant(settings !== null, `Queue ${String(queue.queue_name)} settings are invalid.`);
	return {
		advisoryBacklog,
		consumerCount,
		consumerIds,
		id: queue.queue_id,
		name: queue.queue_name,
		producerCount,
		producerIdentities,
		settings: {
			deliveryDelay: nonnegativeInteger(settings.delivery_delay, 'Queue delivery_delay'),
			deliveryPaused: settings.delivery_paused,
			messageRetentionPeriod: nonnegativeInteger(
				settings.message_retention_period,
				'Queue message_retention_period'
			)
		}
	};
}

/** @param {{apiToken:string,fetchFn:typeof fetch}} input */
async function captureQueueInventory({ apiToken, fetchFn }) {
	const pathName = `/accounts/${CLOUDFLARE_QUEUE_FREE_ENVELOPE_ACCOUNT_ID}/queues`;
	const collection = await captureRestCollection({
		apiToken,
		fetchFn,
		pathName,
		label: 'Queue inventory'
	});
	const metrics = await mapLimited(collection.items, 4, async (rawQueue) => {
		const queue = record(rawQueue);
		invariant(
			typeof queue?.queue_id === 'string' && /^[a-f0-9]{32}$/u.test(queue.queue_id),
			'Queue inventory id is invalid.'
		);
		return normalizedQueueMetrics(
			await fetchJson(
				fetchFn,
				`${API_ORIGIN}${pathName}/${encodeURIComponent(queue.queue_id)}/metrics`,
				apiToken
			),
			String(queue.queue_name)
		);
	});
	const queues = collection.items
		.map((queue, index) => normalizeQueue(queue, metrics[index]))
		.sort((left, right) => left.name.localeCompare(right.name));
	return { pagination: collection.pagination, queues };
}

/** @param {{apiToken:string,fetchFn:typeof fetch,queue:Record<string,any>,utcDayStart:string,dataThrough:string}} input */
async function captureQueueOperations({ apiToken, fetchFn, queue, utcDayStart, dataThrough }) {
	const value = await fetchJson(fetchFn, GRAPHQL_ENDPOINT, apiToken, {
		method: 'POST',
		body: JSON.stringify({
			query: QUEUE_OPERATIONS_QUERY,
			variables: {
				accountTag: CLOUDFLARE_QUEUE_FREE_ENVELOPE_ACCOUNT_ID,
				queueId: queue.id,
				datetimeStart: utcDayStart,
				datetimeEnd: dataThrough
			}
		})
	});
	const envelope = record(value);
	invariant(
		envelope !== null && envelope.errors == null,
		`Queue ${queue.name} GraphQL query failed.`
	);
	const accounts = record(record(envelope.data)?.viewer)?.accounts;
	invariant(
		Array.isArray(accounts) && accounts.length === 1,
		'GraphQL account scope is not exact.'
	);
	const groups = record(accounts[0])?.queueMessageOperationsAdaptiveGroups;
	invariant(
		Array.isArray(groups) && groups.length <= GRAPHQL_QUERY_LIMIT,
		`Queue ${queue.name} GraphQL aggregation exceeded its exact group bound.`
	);
	const billableOperations =
		groups.length === 0
			? 0
			: nonnegativeInteger(
					record(groups[0])?.sum?.billableOperations,
					`Queue ${queue.name} GraphQL billableOperations`
				);
	return { billableOperations, queueId: queue.id, queueName: queue.name };
}

/** @param {unknown[]} subscriptions */
function normalizeSubscriptionEvidence(subscriptions) {
	const normalized = subscriptions
		.map((rawSubscription) => {
			const subscription = record(rawSubscription);
			const ratePlan = record(subscription?.rate_plan);
			invariant(
				typeof subscription?.id === 'string' && SAFE_ID_PATTERN.test(subscription.id),
				'Cloudflare subscription id is invalid.'
			);
			invariant(
				typeof subscription.state === 'string' && SUBSCRIPTION_STATES.has(subscription.state),
				`Cloudflare subscription ${subscription.id} state is unrecognized.`
			);
			invariant(
				typeof ratePlan?.id === 'string' &&
					SAFE_ID_PATTERN.test(ratePlan.id) &&
					typeof ratePlan.externally_managed === 'boolean' &&
					typeof ratePlan.is_contract === 'boolean' &&
					(typeof ratePlan.scope === 'string' || ratePlan.scope === undefined) &&
					Array.isArray(ratePlan.sets),
				`Cloudflare subscription ${subscription.id} rate plan evidence is incomplete.`
			);
			const sets = ratePlan.sets.map((set) => {
				invariant(
					typeof set === 'string' && SAFE_ID_PATTERN.test(set),
					`Cloudflare subscription ${subscription.id} set is invalid.`
				);
				return set;
			});
			sets.sort();
			invariant(
				new Set(sets).size === sets.length,
				`Cloudflare subscription ${subscription.id} repeats a set.`
			);
			return {
				externallyManaged: ratePlan.externally_managed,
				isContract: ratePlan.is_contract,
				ratePlanId: ratePlan.id,
				scope: ratePlan.scope ?? '',
				sets,
				state: subscription.state,
				subscriptionId: subscription.id
			};
		})
		.sort((left, right) => left.subscriptionId.localeCompare(right.subscriptionId));
	invariant(
		new Set(normalized.map((subscription) => subscription.subscriptionId)).size ===
			normalized.length,
		'Cloudflare subscription inventory repeats an id.'
	);
	return normalized;
}

/** @param {ReturnType<typeof normalizeSubscriptionEvidence>} subscriptions */
function activeWorkersPaidSubscriptionCount(subscriptions) {
	let count = 0;
	for (const subscription of subscriptions) {
		if (!ACTIVE_SUBSCRIPTION_STATES.has(subscription.state)) continue;
		const workerSignals = [subscription.ratePlanId, subscription.scope, ...subscription.sets]
			.join(':')
			.toUpperCase();
		if (!workerSignals.includes('WORKER')) continue;
		invariant(
			!subscription.externallyManaged && !subscription.isContract,
			`Active Workers subscription ${subscription.subscriptionId} is contract or externally managed.`
		);
		const ratePlanId = subscription.ratePlanId.toUpperCase();
		if (KNOWN_WORKERS_PAID_RATE_PLANS.has(ratePlanId)) {
			count += 1;
			continue;
		}
		invariant(
			ratePlanId.includes('FREE'),
			`Active Workers subscription ${subscription.ratePlanId} is not classified fail-closed.`
		);
	}
	return count;
}

/** @param {{apiToken:string,fetchFn:typeof fetch}} input */
async function captureAccountFacts({ apiToken, fetchFn }) {
	const [settingsValue, subscriptions] = await Promise.all([
		fetchJson(
			fetchFn,
			`${API_ORIGIN}/accounts/${CLOUDFLARE_QUEUE_FREE_ENVELOPE_ACCOUNT_ID}/workers/account-settings`,
			apiToken
		),
		captureRestCollection({
			apiToken,
			fetchFn,
			pathName: `/accounts/${CLOUDFLARE_QUEUE_FREE_ENVELOPE_ACCOUNT_ID}/subscriptions`,
			label: 'Account subscriptions'
		})
	]);
	const settings = record(apiResult(settingsValue, 'Workers account settings'));
	invariant(
		settings?.default_usage_model === 'bundled',
		'Workers default usage model is not bundled.'
	);
	const normalizedSubscriptions = normalizeSubscriptionEvidence(subscriptions.items);
	const activeWorkersPaidSubscriptions =
		activeWorkersPaidSubscriptionCount(normalizedSubscriptions);
	invariant(
		activeWorkersPaidSubscriptions === 0,
		'Cloudflare account has an active Workers-paid subscription.'
	);
	return {
		activeWorkersPaidSubscriptions,
		defaultUsageModel: 'bundled',
		id: CLOUDFLARE_QUEUE_FREE_ENVELOPE_ACCOUNT_ID,
		subscriptionEvidence: {
			derivation: 'workers-free-derived-from-complete-account-subscription-inventory',
			pagination: subscriptions.pagination,
			subscriptions: normalizedSubscriptions
		},
		workersPlan: 'free'
	};
}

/** @param {{apiToken:string,fetchFn:typeof fetch,utcDayStart:string,dataThrough:string}} input */
async function captureAccountQueueOperations({ apiToken, fetchFn, utcDayStart, dataThrough }) {
	const value = await fetchJson(fetchFn, GRAPHQL_ENDPOINT, apiToken, {
		method: 'POST',
		body: JSON.stringify({
			query: ACCOUNT_QUEUE_OPERATIONS_QUERY,
			variables: {
				accountTag: CLOUDFLARE_QUEUE_FREE_ENVELOPE_ACCOUNT_ID,
				datetimeStart: utcDayStart,
				datetimeEnd: dataThrough
			}
		})
	});
	const envelope = record(value);
	invariant(envelope !== null && envelope.errors == null, 'Account Queue GraphQL query failed.');
	const accounts = record(record(envelope.data)?.viewer)?.accounts;
	invariant(
		Array.isArray(accounts) && accounts.length === 1,
		'GraphQL account scope is not exact.'
	);
	const groups = record(accounts[0])?.queueMessageOperationsAdaptiveGroups;
	invariant(
		Array.isArray(groups) && groups.length <= GRAPHQL_QUERY_LIMIT,
		'Account Queue GraphQL aggregation exceeded its exact group bound.'
	);
	return groups.length === 0
		? 0
		: nonnegativeInteger(
				record(groups[0])?.sum?.billableOperations,
				'Account Queue GraphQL billableOperations'
			);
}

/** @param {{apiToken:string,fetchFn:typeof fetch,nowFn:()=>number}} input */
async function captureObservation({ apiToken, fetchFn, nowFn }) {
	const startedAtMs = nowFn();
	const utcDayStartMs = Date.UTC(
		new Date(startedAtMs).getUTCFullYear(),
		new Date(startedAtMs).getUTCMonth(),
		new Date(startedAtMs).getUTCDate()
	);
	const dataThroughMs = startedAtMs - CLOUDFLARE_QUEUE_FREE_ENVELOPE_DATA_LAG_SECONDS * 1000;
	invariant(
		dataThroughMs >= utcDayStartMs,
		'Queue Free capture cannot begin during the first 15 minutes of a UTC day.'
	);
	const [account, inventory] = await Promise.all([
		captureAccountFacts({ apiToken, fetchFn }),
		captureQueueInventory({ apiToken, fetchFn })
	]);
	const utcDayStart = instant(utcDayStartMs);
	const dataThrough = instant(dataThroughMs);
	const [queueOperations, accountBillableOperations] = await Promise.all([
		mapLimited(inventory.queues, 4, (queue) =>
			captureQueueOperations({ apiToken, fetchFn, queue, utcDayStart, dataThrough })
		),
		captureAccountQueueOperations({ apiToken, fetchFn, utcDayStart, dataThrough })
	]);
	const observedAtMs = nowFn();
	invariant(
		observedAtMs >= startedAtMs && observedAtMs - dataThroughMs >= 15 * 60 * 1000,
		'Queue Free observation clock regressed or lost its analytics lag.'
	);
	const currentQueueBillableOperations = queueOperations.reduce(
		(total, operation) => total + operation.billableOperations,
		0
	);
	invariant(
		accountBillableOperations >= currentQueueBillableOperations,
		'Account Queue GraphQL total is below the current inventory reconciliation.'
	);
	const retiredQueueBillableOperations = accountBillableOperations - currentQueueBillableOperations;
	return {
		account,
		observation: {
			accountBillableOperations,
			dataThrough,
			observedAt: instant(observedAtMs),
			pagination: {
				queueInventory: inventory.pagination,
				queueOperations: {
					accountAggregateQueryCount: 1,
					complete: true,
					queryCount: inventory.queues.length,
					queryLimit: GRAPHQL_QUERY_LIMIT,
					queueIds: inventory.queues.map((queue) => queue.id)
				}
			},
			queueOperations,
			queues: inventory.queues,
			retiredQueueBillableOperations,
			utcDayStart
		}
	};
}

/**
 * The API token is accepted only in memory, sent only to Cloudflare, and is
 * never included in the returned canonical receipt.
 * @param {{apiToken:string,operatorPrincipal:string,releasePhase:'activate-preview'|'activate-production'|'bootstrap-production',releaseTransactionId?:string,sourceSha:string,fetchFn?:typeof fetch,nowFn?:()=>number,sleepFn?:(milliseconds:number)=>Promise<void>,progressFn?:(message:string)=>void}} input
 */
export async function captureCloudflareQueueFreeEnvelope({
	apiToken,
	operatorPrincipal,
	releasePhase,
	releaseTransactionId,
	sourceSha,
	fetchFn = fetch,
	nowFn = Date.now,
	sleepFn = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
	progressFn = () => {}
}) {
	invariant(
		typeof apiToken === 'string' &&
			apiToken.length >= 20 &&
			apiToken.length <= 512 &&
			!/\s/u.test(apiToken),
		'CLOUDFLARE_QUEUE_OBSERVER_API_TOKEN is missing or invalid.'
	);
	invariant(PRINCIPAL_PATTERN.test(operatorPrincipal), 'Queue Free operator principal is invalid.');
	invariant(
		CLOUDFLARE_QUEUE_FREE_ENVELOPE_RELEASE_PHASES.includes(releasePhase),
		'Queue Free release phase is invalid.'
	);
	invariant(SHA_PATTERN.test(sourceSha), 'Queue Free source SHA is invalid.');
	if (releasePhase === 'bootstrap-production') {
		invariant(
			typeof releaseTransactionId === 'string' &&
				RELEASE_TRANSACTION_PATTERN.test(releaseTransactionId),
			'Queue Free bootstrap release transaction is invalid.'
		);
		const captureStartMs = nowFn();
		const utcDayEndMs =
			Math.floor(captureStartMs / (24 * 60 * 60 * 1000) + 1) * 24 * 60 * 60 * 1000;
		invariant(
			captureStartMs +
				CLOUDFLARE_QUEUE_FREE_ENVELOPE_OBSERVATION_SEPARATION_SECONDS * 1000 +
				cloudflareQueueFreeEnvelopeMaximumLifetimeSeconds(releasePhase) * 1000 <=
				utcDayEndMs,
			'Queue Free bootstrap capture cannot fit its observation and proof window inside one UTC accounting day.'
		);
	} else {
		invariant(
			releaseTransactionId === undefined,
			'Queue Free activation capture cannot carry a bootstrap release transaction.'
		);
	}

	progressFn('Capturing Queue Free observation 1 of 2.');
	const first = await captureObservation({ apiToken, fetchFn, nowFn });
	const firstObservedAtMs = Date.parse(first.observation.observedAt);
	const secondNotBefore =
		firstObservedAtMs + CLOUDFLARE_QUEUE_FREE_ENVELOPE_OBSERVATION_SEPARATION_SECONDS * 1000;
	const waitMilliseconds = Math.max(0, secondNotBefore - nowFn());
	progressFn(`Waiting ${Math.ceil(waitMilliseconds / 1000)} seconds before observation 2 of 2.`);
	await sleepFn(waitMilliseconds);
	progressFn('Capturing Queue Free observation 2 of 2.');
	const second = await captureObservation({ apiToken, fetchFn, nowFn });
	invariant(
		JSON.stringify(first.account) === JSON.stringify(second.account),
		'Cloudflare account plan or subscription facts changed between observations.'
	);
	const capturedAtMs = nowFn();
	const expiresAtMs =
		capturedAtMs + cloudflareQueueFreeEnvelopeMaximumLifetimeSeconds(releasePhase) * 1000;
	const attestation = {
		account: first.account,
		authorizedManagedDelta: cloudflareQueueFreeEnvelopeAuthorizedManagedDelta(releasePhase),
		capturedAt: instant(capturedAtMs),
		expiresAt: instant(expiresAtMs),
		managedQueueAllowlist: [...CLOUDFLARE_QUEUE_FREE_ENVELOPE_MANAGED_QUEUE_NAMES],
		namespace: CLOUDFLARE_QUEUE_FREE_ENVELOPE_SIGNATURE_NAMESPACE,
		observations: [first.observation, second.observation],
		observer: {
			credentialPersisted: false,
			tokenPermissions: [...CLOUDFLARE_QUEUE_FREE_ENVELOPE_OBSERVER_TOKEN_PERMISSIONS]
		},
		operatorPrincipal,
		releasePhase,
		...(releasePhase === 'bootstrap-production' ? { releaseTransactionId } : {}),
		schemaVersion: releasePhase === 'bootstrap-production' ? 2 : 1,
		source: {
			accountApiOrigin: API_ORIGIN,
			accountSubscriptionsPath: `/accounts/${CLOUDFLARE_QUEUE_FREE_ENVELOPE_ACCOUNT_ID}/subscriptions`,
			dataThroughSemantics: 'graphql-query-window-end',
			graphqlApiEndpoint: GRAPHQL_ENDPOINT,
			queueInventoryPath: `/accounts/${CLOUDFLARE_QUEUE_FREE_ENVELOPE_ACCOUNT_ID}/queues`,
			queueMessageOperationsDataset: 'queueMessageOperationsAdaptiveGroups',
			queueMessageOperationsMetric: 'billableOperations',
			queueMessageOperationsSemantics: 'analytics-operational-signal-not-billing-or-invoice-truth',
			realtimeBacklogFields: [...CLOUDFLARE_QUEUE_FREE_ENVELOPE_BACKLOG_FIELDS],
			workersAccountSettingsPath: `/accounts/${CLOUDFLARE_QUEUE_FREE_ENVELOPE_ACCOUNT_ID}/workers/account-settings`
		},
		sourceSha,
		utcDayStart: first.observation.utcDayStart
	};
	validateCloudflareQueueFreeEnvelope({
		attestation,
		...(releasePhase === 'bootstrap-production'
			? {
					expectedOperatorPrincipal: operatorPrincipal,
					expectedReleaseTransactionId: releaseTransactionId
				}
			: {}),
		expectedReleasePhase: releasePhase,
		expectedSourceSha: sourceSha,
		nowMs: capturedAtMs
	});
	const bytes = canonicalCloudflareQueueFreeEnvelopeBytes(attestation);
	invariant(
		!bytes.includes(Buffer.from(apiToken, 'utf8')),
		'Observer credential leaked into receipt.'
	);
	return { attestation, bytes };
}

/** @param {string} outputPath @param {Buffer} bytes */
export function writeCloudflareQueueFreeEnvelope(outputPath, bytes) {
	const output = path.resolve(outputPath);
	writeFileSync(output, bytes, { flag: 'wx', mode: 0o600 });
}

/** @param {string[]} argv */
export function parseCloudflareQueueFreeEnvelopeCaptureArgs(argv) {
	const baseRequired = ['--operator-principal', '--output', '--release-phase', '--source-sha'];
	const allowed = new Set([...baseRequired, '--transaction-id']);
	const values = new Map();
	for (let index = 0; index < argv.length; index += 2) {
		const flag = argv[index];
		const value = argv[index + 1];
		invariant(
			allowed.has(flag) && value && !value.startsWith('--') && !values.has(flag),
			`Invalid Queue Free capture argument: ${flag}.`
		);
		values.set(flag, value);
	}
	invariant(
		baseRequired.every((flag) => values.has(flag)),
		'Every Queue Free capture argument is required.'
	);
	const releasePhase = values.get('--release-phase');
	invariant(
		CLOUDFLARE_QUEUE_FREE_ENVELOPE_RELEASE_PHASES.includes(releasePhase),
		'Queue Free capture release phase is invalid.'
	);
	if (releasePhase === 'bootstrap-production') {
		invariant(
			values.size === baseRequired.length + 1 && values.has('--transaction-id'),
			'Queue Free bootstrap capture transaction id is required.'
		);
		invariant(
			RELEASE_TRANSACTION_PATTERN.test(values.get('--transaction-id')),
			'Queue Free bootstrap capture transaction id is invalid.'
		);
	} else {
		invariant(
			values.size === baseRequired.length && !values.has('--transaction-id'),
			'Queue Free activation capture cannot carry a bootstrap transaction id.'
		);
	}
	return {
		operatorPrincipal: values.get('--operator-principal'),
		outputPath: values.get('--output'),
		releasePhase,
		...(releasePhase === 'bootstrap-production'
			? { releaseTransactionId: values.get('--transaction-id') }
			: {}),
		sourceSha: values.get('--source-sha')
	};
}

const isMain =
	process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
	try {
		const args = parseCloudflareQueueFreeEnvelopeCaptureArgs(process.argv.slice(2));
		const apiToken = process.env.CLOUDFLARE_QUEUE_OBSERVER_API_TOKEN;
		delete process.env.CLOUDFLARE_QUEUE_OBSERVER_API_TOKEN;
		invariant(typeof apiToken === 'string', 'CLOUDFLARE_QUEUE_OBSERVER_API_TOKEN is required.');
		const receipt = await captureCloudflareQueueFreeEnvelope({
			...args,
			apiToken,
			progressFn: (message) => console.error(message)
		});
		writeCloudflareQueueFreeEnvelope(args.outputPath, receipt.bytes);
		console.log(`Captured canonical Cloudflare Queue Free envelope: ${args.outputPath}`);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
