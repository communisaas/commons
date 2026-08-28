import { execFileSync } from 'node:child_process';
import {
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
	CLOUDFLARE_QUEUE_FREE_ENVELOPE_ACCOUNT_ID,
	CLOUDFLARE_QUEUE_FREE_ENVELOPE_BACKLOG_FIELDS,
	CLOUDFLARE_QUEUE_FREE_ENVELOPE_BOOTSTRAP_ATTACHED_PROOF_VALIDITY_SECONDS,
	CLOUDFLARE_QUEUE_FREE_ENVELOPE_BOOTSTRAP_DEAD_LETTER_QUEUE,
	CLOUDFLARE_QUEUE_FREE_ENVELOPE_BOOTSTRAP_QUEUE,
	CLOUDFLARE_QUEUE_FREE_ENVELOPE_BOOTSTRAP_WORKER,
	CLOUDFLARE_QUEUE_FREE_ENVELOPE_MANAGED_QUEUE_NAMES,
	CLOUDFLARE_QUEUE_FREE_ENVELOPE_MAX_BILLABLE_OPERATIONS,
	CLOUDFLARE_QUEUE_FREE_ENVELOPE_OBSERVER_TOKEN_PERMISSIONS,
	CLOUDFLARE_QUEUE_FREE_ENVELOPE_SIGNATURE_NAMESPACE,
	canonicalCloudflareQueueFreeEnvelopeBytes,
	validateCloudflareQueueFreeEnvelope
} from '../../../scripts/cloudflare-queue-free-envelope.mjs';
import {
	parseCloudflareQueueFreeEnvelopeArgs,
	verifySignedCloudflareQueueFreeEnvelope
} from '../../../scripts/verify-cloudflare-queue-free-envelope.mjs';
import {
	parseCloudflareQueueFreeEnvelopeSigningArgs,
	signCloudflareQueueFreeEnvelope
} from '../../../scripts/sign-cloudflare-queue-free-envelope.mjs';
import {
	parseCloudflareQueueReleasePhaseArgs,
	verifyCloudflareQueueReleasePhaseState
} from '../../../scripts/verify-cloudflare-queue-release-phase.mjs';
import {
	captureCloudflareQueueFreeEnvelope,
	parseCloudflareQueueFreeEnvelopeCaptureArgs,
	writeCloudflareQueueFreeEnvelope
} from '../../../scripts/capture-cloudflare-queue-free-envelope.mjs';

const NOW = Date.parse('2026-07-20T12:30:00.000Z');
const SOURCE_SHA = 'a'.repeat(40);
const PRINCIPAL = 'cloudflare-queue-release-operator';
const BOOTSTRAP_TRANSACTION_ID = '1753014600000-7';
const QUEUE_NAMES = [
	...CLOUDFLARE_QUEUE_FREE_ENVELOPE_MANAGED_QUEUE_NAMES,
	'sibling-inert-queue'
];

let temporaryDirectory: string;
let signingKeyPath: string;
let allowedSignersPath: string;

beforeAll(() => {
	temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), 'commons-queue-free-test-'));
	signingKeyPath = path.join(temporaryDirectory, 'queue_free_ed25519');
	allowedSignersPath = path.join(temporaryDirectory, 'allowed-signers');
	execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', signingKeyPath], {
		stdio: 'ignore'
	});
	const publicKey = readFileSync(`${signingKeyPath}.pub`, 'utf8').trim();
	writeFileSync(
		allowedSignersPath,
		`${PRINCIPAL} namespaces="${CLOUDFLARE_QUEUE_FREE_ENVELOPE_SIGNATURE_NAMESPACE}" ${publicKey}\n`
	);
});

afterAll(() => {
	rmSync(temporaryDirectory, { force: true, recursive: true });
});

type ReleasePhase = 'activate-preview' | 'activate-production' | 'bootstrap-production';

const ALLOWED_TRANSITIONS = [
	'create-missing-target-queues-paused',
	'deploy-exact-sha-target-gate-and-consumer',
	'bind-only-target-pages-producer',
	'unpause-target-queue-only-after-live-proof'
];
const LIVE_PROOF_REQUIREMENTS = [
	'no-unmanaged-inventory-or-authority-drift',
	'exact-target-prepared-state',
	'old-producer-contained',
	'target-queues-paused-before-activation',
	'failure-forward-containment'
];

function phaseAuthority(phase: ReleasePhase) {
	if (phase === 'bootstrap-production') {
		return {
			allowedTransitions: [
				'attach-exact-bootstrap-worker-to-existing-production-primary-producer',
				'detach-exact-bootstrap-worker-after-route-first-script-deletion'
			],
			liveProofRequirements: [
				'account-wide-queue-inventory-and-authority-unchanged',
				'existing-production-queue-and-gate-only',
				'exact-bootstrap-worker-is-the-only-transient-primary-producer-delta',
				'no-queue-create-delete-settings-consumer-or-dlq-delta',
				'route-first-script-deletion-restores-the-exact-signed-baseline'
			],
			maximumReceiptAgeSeconds: 72 * 60,
			postMutationLiveProofRequired: true,
			queueNames: [CLOUDFLARE_QUEUE_FREE_ENVELOPE_BOOTSTRAP_QUEUE],
			targetRealm: 'production'
		};
	}
	return {
		allowedTransitions: [...ALLOWED_TRANSITIONS],
		liveProofRequirements: [...LIVE_PROOF_REQUIREMENTS],
		maximumReceiptAgeSeconds: 27 * 60,
		postMutationLiveProofRequired: true,
		queueNames:
			phase === 'activate-preview'
				? ['commons-public-template-og-nonprod', 'commons-public-template-og-nonprod-dlq']
				: ['commons-public-template-og', 'commons-public-template-og-dlq'],
		targetRealm: phase === 'activate-preview' ? 'preview' : 'production'
	};
}

function pagination(itemCount: number) {
	return {
		complete: true,
		pageSize: 100,
		pages: [{ itemCount, page: 1 }],
		totalItems: itemCount,
		totalPages: 1
	};
}

function queues() {
	return QUEUE_NAMES.map((name, index) => {
		const hasAuthority = !name.endsWith('-dlq') && name !== 'sibling-inert-queue';
		return {
			advisoryBacklog: {
				backlogBytes: 0,
				backlogMessages: 0,
				oldestMessageTimestampMs: 0
			},
			consumerCount: hasAuthority ? 1 : 0,
			consumerIds: hasAuthority ? [`consumer-${name}`] : [],
			id: String(index + 1).repeat(32),
			name,
			producerCount: hasAuthority ? 1 : 0,
			producerIdentities: hasAuthority
				? [{ script: `pages-producer-${name}`, type: 'worker' }]
				: [],
			settings: {
				deliveryDelay: 0,
				deliveryPaused: true,
				messageRetentionPeriod: 86_400
			}
		};
	});
}

function queueOperations() {
	const operations = [700, 100, 600, 100, 500];
	return queues().map((queue, index) => ({
		billableOperations: operations[index],
		queueId: queue.id,
		queueName: queue.name
	}));
}

function observation(observedAt: string, dataThrough: string) {
	const inventory = queues();
	const operations = queueOperations();
	return {
		accountBillableOperations: 2_000,
		dataThrough,
		observedAt,
		pagination: {
			queueInventory: pagination(inventory.length),
			queueOperations: {
				accountAggregateQueryCount: 1,
				complete: true,
				queryCount: operations.length,
				queryLimit: 1,
				queueIds: operations.map((operation) => operation.queueId)
			}
		},
		queueOperations: operations,
		queues: inventory,
		retiredQueueBillableOperations: 0,
		utcDayStart: '2026-07-20T00:00:00.000Z'
	};
}

function envelope(releasePhase: ReleasePhase = 'activate-preview') {
	const observations = [
		observation('2026-07-20T12:05:00.000Z', '2026-07-20T11:50:00.000Z'),
		observation('2026-07-20T12:20:00.000Z', '2026-07-20T12:05:00.000Z')
	];
	if (releasePhase === 'bootstrap-production') {
		for (const candidate of observations) {
			const primary = candidate.queues.find(
				(queue) => queue.name === CLOUDFLARE_QUEUE_FREE_ENVELOPE_BOOTSTRAP_QUEUE
			)!;
			const deadLetter = candidate.queues.find(
				(queue) => queue.name === CLOUDFLARE_QUEUE_FREE_ENVELOPE_BOOTSTRAP_DEAD_LETTER_QUEUE
			)!;
			primary.producerCount = 0;
			primary.producerIdentities = [];
			primary.settings.deliveryPaused = false;
			deadLetter.settings.deliveryPaused = false;
		}
	}
	return {
		account: {
			activeWorkersPaidSubscriptions: 0,
			defaultUsageModel: 'bundled',
			id: CLOUDFLARE_QUEUE_FREE_ENVELOPE_ACCOUNT_ID,
			subscriptionEvidence: {
				derivation: 'workers-free-derived-from-complete-account-subscription-inventory',
				pagination: pagination(0),
				subscriptions: []
			},
			workersPlan: 'free'
		},
		authorizedManagedDelta: phaseAuthority(releasePhase),
		capturedAt: '2026-07-20T12:25:00.000Z',
		expiresAt: '2026-07-20T12:50:00.000Z',
		managedQueueAllowlist: [...CLOUDFLARE_QUEUE_FREE_ENVELOPE_MANAGED_QUEUE_NAMES],
		namespace: CLOUDFLARE_QUEUE_FREE_ENVELOPE_SIGNATURE_NAMESPACE,
		observations,
		observer: {
			credentialPersisted: false,
			tokenPermissions: [...CLOUDFLARE_QUEUE_FREE_ENVELOPE_OBSERVER_TOKEN_PERMISSIONS]
		},
		operatorPrincipal: PRINCIPAL,
		releasePhase,
		...(releasePhase === 'bootstrap-production'
			? { releaseTransactionId: BOOTSTRAP_TRANSACTION_ID }
			: {}),
		schemaVersion: releasePhase === 'bootstrap-production' ? 2 : 1,
		source: {
			accountApiOrigin: 'https://api.cloudflare.com/client/v4',
			accountSubscriptionsPath: `/accounts/${CLOUDFLARE_QUEUE_FREE_ENVELOPE_ACCOUNT_ID}/subscriptions`,
			dataThroughSemantics: 'graphql-query-window-end',
			graphqlApiEndpoint: 'https://api.cloudflare.com/client/v4/graphql',
			queueInventoryPath: `/accounts/${CLOUDFLARE_QUEUE_FREE_ENVELOPE_ACCOUNT_ID}/queues`,
			queueMessageOperationsDataset: 'queueMessageOperationsAdaptiveGroups',
			queueMessageOperationsMetric: 'billableOperations',
			queueMessageOperationsSemantics:
				'analytics-operational-signal-not-billing-or-invoice-truth',
			realtimeBacklogFields: [...CLOUDFLARE_QUEUE_FREE_ENVELOPE_BACKLOG_FIELDS],
			workersAccountSettingsPath: `/accounts/${CLOUDFLARE_QUEUE_FREE_ENVELOPE_ACCOUNT_ID}/workers/account-settings`
		},
		sourceSha: SOURCE_SHA,
		utcDayStart: '2026-07-20T00:00:00.000Z'
	};
}

function signedEnvelope(attestation = envelope()) {
	const attestationBytes = canonicalCloudflareQueueFreeEnvelopeBytes(attestation);
	const signatureBytes = execFileSync(
		'ssh-keygen',
		[
			'-Y',
			'sign',
			'-f',
			signingKeyPath,
			'-n',
			CLOUDFLARE_QUEUE_FREE_ENVELOPE_SIGNATURE_NAMESPACE,
			'-'
		],
		{ input: attestationBytes, stdio: ['pipe', 'pipe', 'ignore'] }
	);
	return { attestationBytes, signatureBytes };
}

function captureApi(options: { accountTotal?: number; paidWorkers?: boolean } = {}) {
	const inventory = queues().map((queue) => ({
		consumers: queue.consumerIds.map((consumerId) => ({ consumer_id: consumerId })),
		consumers_total_count: queue.consumerCount,
		producers: queue.producerIdentities.map((producer) => ({ ...producer })),
		producers_total_count: queue.producerCount,
		queue_id: queue.id,
		queue_name: queue.name,
		settings: {
			delivery_delay: queue.settings.deliveryDelay,
			delivery_paused: queue.settings.deliveryPaused,
			message_retention_period: queue.settings.messageRetentionPeriod
		}
	}));
	const operationById = new Map(queueOperations().map((operation) => [operation.queueId, operation]));
	const authorizations: string[] = [];
	const graphQlWindows: Array<{ datetimeEnd: string; queueId: string | null }> = [];
	const redirects: Array<RequestRedirect | undefined> = [];
	const fetchFn = async (input: string | URL | Request, init?: RequestInit) => {
		const url = new URL(String(input));
		authorizations.push(new Headers(init?.headers).get('Authorization') ?? '');
		redirects.push(init?.redirect);
		if (url.pathname.endsWith('/workers/account-settings')) {
			return Response.json({ success: true, result: { default_usage_model: 'bundled' } });
		}
		if (url.pathname.endsWith('/subscriptions')) {
			const result = options.paidWorkers
				? [
						{
							id: 'workers-paid-subscription',
							rate_plan: {
								externally_managed: false,
								id: 'WORKERS_PAID',
								is_contract: false,
								scope: 'workers',
								sets: ['workers']
							},
							state: 'Paid'
						}
					]
				: [];
			return Response.json({
				success: true,
				result,
				result_info: {
					count: result.length,
					page: 1,
					per_page: 100,
					total_count: result.length
				}
			});
		}
		if (url.pathname.endsWith('/queues')) {
			return Response.json({
				success: true,
				result: inventory,
				result_info: {
					count: inventory.length,
					page: 1,
					per_page: 100,
					total_count: inventory.length,
					total_pages: 1
				}
			});
		}
		if (/\/queues\/[a-f0-9]{32}\/metrics$/u.test(url.pathname)) {
			return Response.json({
				success: true,
				result: {
					backlog_bytes: 0,
					backlog_count: 0,
					oldest_message_timestamp_ms: 0
				}
			});
		}
		if (url.pathname.endsWith('/graphql')) {
			const body = JSON.parse(String(init?.body));
			const queueId =
				typeof body.variables.queueId === 'string' ? body.variables.queueId : null;
			graphQlWindows.push({ datetimeEnd: body.variables.datetimeEnd, queueId });
			return Response.json({
				data: {
					viewer: {
						accounts: [
							{
								queueMessageOperationsAdaptiveGroups: [
									{
										sum: {
											billableOperations:
												queueId === null
													? (options.accountTotal ?? 2_100)
													: (operationById.get(queueId)?.billableOperations ?? 0)
										}
									}
								]
							}
						]
					}
				},
				errors: null
			});
		}
		throw new Error(`Unexpected capture request: ${url.href}`);
	};
	return { authorizations, fetchFn: fetchFn as typeof fetch, graphQlWindows, redirects };
}

function liveQueueApi(options: {
	bootstrapProducerAttached?: boolean;
	mutateConsumers?: (primary: any[], deadLetter: any[]) => void;
	mutateInventory?: (inventory: any[]) => void;
} = {}) {
	const api = captureApi();
	const fetchFn = async (input: string | URL | Request, init?: RequestInit) => {
		const url = new URL(String(input));
		const consumerMatch = /\/queues\/([a-f0-9]{32})\/consumers$/u.exec(url.pathname);
		if (consumerMatch) {
			const primaryId = queues().find(
				(queue) => queue.name === CLOUDFLARE_QUEUE_FREE_ENVELOPE_BOOTSTRAP_QUEUE
			)!.id;
			const deadLetterId = queues().find(
				(queue) => queue.name === CLOUDFLARE_QUEUE_FREE_ENVELOPE_BOOTSTRAP_DEAD_LETTER_QUEUE
			)!.id;
			const primary = [
				{
					consumer_id: `consumer-${CLOUDFLARE_QUEUE_FREE_ENVELOPE_BOOTSTRAP_QUEUE}`,
					type: 'worker',
					script_name: 'commons-public-template-og',
					queue_name: CLOUDFLARE_QUEUE_FREE_ENVELOPE_BOOTSTRAP_QUEUE,
					dead_letter_queue: CLOUDFLARE_QUEUE_FREE_ENVELOPE_BOOTSTRAP_DEAD_LETTER_QUEUE,
					settings: {
						batch_size: 1,
						max_concurrency: 1,
						max_retries: 2,
						max_wait_time_ms: 1000,
						retry_delay: 120
					}
				}
			];
			const deadLetter: any[] = [];
			options.mutateConsumers?.(primary, deadLetter);
			if (consumerMatch[1] === primaryId) return Response.json({ success: true, result: primary });
			if (consumerMatch[1] === deadLetterId) {
				return Response.json({ success: true, result: deadLetter });
			}
			throw new Error(`Unexpected Queue consumer id: ${consumerMatch[1]}`);
		}
		const response = await api.fetchFn(input, init);
		if (!url.pathname.endsWith('/queues')) return response;
		const payload = await response.json();
		const primary = payload.result.find(
			(queue: any) => queue.queue_name === CLOUDFLARE_QUEUE_FREE_ENVELOPE_BOOTSTRAP_QUEUE
		);
		const deadLetter = payload.result.find(
			(queue: any) =>
				queue.queue_name === CLOUDFLARE_QUEUE_FREE_ENVELOPE_BOOTSTRAP_DEAD_LETTER_QUEUE
		);
		primary.producers = [];
		primary.producers_total_count = 0;
		primary.settings.delivery_paused = false;
		deadLetter.settings.delivery_paused = false;
		if (options.bootstrapProducerAttached) {
			primary.producers.push({
				script: CLOUDFLARE_QUEUE_FREE_ENVELOPE_BOOTSTRAP_WORKER,
				type: 'worker'
			});
			primary.producers.sort((left: any, right: any) =>
				JSON.stringify(left).localeCompare(JSON.stringify(right))
			);
			primary.producers_total_count += 1;
		}
		options.mutateInventory?.(payload.result);
		return Response.json(payload);
	};
	return { ...api, fetchFn: fetchFn as typeof fetch };
}

describe('signed Cloudflare Queue Free envelope', () => {
	it.each(['activate-preview', 'activate-production'] as const)(
		'accepts an exact quiet %s baseline while requiring separate live post-mutation proof',
		(releasePhase) => {
			expect(
				validateCloudflareQueueFreeEnvelope({
					attestation: envelope(releasePhase),
					expectedReleasePhase: releasePhase,
					expectedSourceSha: SOURCE_SHA,
					minimumRemainingValiditySeconds: 180,
					nowMs: NOW
				})
			).toMatchObject({
				accountBillableOperations: 2_000,
				accountId: CLOUDFLARE_QUEUE_FREE_ENVELOPE_ACCOUNT_ID,
				defaultUsageModel: 'bundled',
				managedQueueCount: 4,
				mode: 'signed-observation-baseline-not-live-post-mutation-proof',
				observationSeparationSeconds: 900,
				queueCount: 5,
				releasePhase,
				remainingValiditySeconds: 1_200,
				unmanagedQueueCount: 1,
				workersPlan: 'free'
			});
		}
	);

	it('admits schema 2 with exact bindings and only one reversible bootstrap producer delta', () => {
		const result = validateCloudflareQueueFreeEnvelope({
			attestation: envelope('bootstrap-production'),
			expectedOperatorPrincipal: PRINCIPAL,
			expectedReleasePhase: 'bootstrap-production',
			expectedReleaseTransactionId: BOOTSTRAP_TRANSACTION_ID,
			expectedSourceSha: SOURCE_SHA,
			minimumRemainingValiditySeconds: 180,
			nowMs: NOW
		});
		expect(result).toMatchObject({
			accountId: CLOUDFLARE_QUEUE_FREE_ENVELOPE_ACCOUNT_ID,
			authorizedManagedDelta: {
				allowedTransitions: [
					'attach-exact-bootstrap-worker-to-existing-production-primary-producer',
					'detach-exact-bootstrap-worker-after-route-first-script-deletion'
				],
				queueNames: [CLOUDFLARE_QUEUE_FREE_ENVELOPE_BOOTSTRAP_QUEUE],
				targetRealm: 'production'
			},
			operatorPrincipal: PRINCIPAL,
			releasePhase: 'bootstrap-production',
			releaseTransactionId: BOOTSTRAP_TRANSACTION_ID,
			workersPlan: 'free'
		});
		expect(result.authorizedManagedDelta.liveProofRequirements).toEqual([
			'account-wide-queue-inventory-and-authority-unchanged',
			'existing-production-queue-and-gate-only',
			'exact-bootstrap-worker-is-the-only-transient-primary-producer-delta',
			'no-queue-create-delete-settings-consumer-or-dlq-delta',
			'route-first-script-deletion-restores-the-exact-signed-baseline'
		]);
	});

	it('fails closed on every bootstrap schema or expected-binding substitution', () => {
		const verify = (attestation: ReturnType<typeof envelope>, overrides = {}) =>
			validateCloudflareQueueFreeEnvelope({
				attestation,
				expectedOperatorPrincipal: PRINCIPAL,
				expectedReleasePhase: 'bootstrap-production',
				expectedReleaseTransactionId: BOOTSTRAP_TRANSACTION_ID,
				expectedSourceSha: SOURCE_SHA,
				nowMs: NOW,
				...overrides
			});
		const mutations = [
			(candidate: ReturnType<typeof envelope>) => (candidate.schemaVersion = 1),
			(candidate: ReturnType<typeof envelope>) => delete candidate.releaseTransactionId,
			(candidate: ReturnType<typeof envelope>) =>
				(candidate.releaseTransactionId = '1753014600000-8'),
			(candidate: ReturnType<typeof envelope>) =>
				candidate.authorizedManagedDelta.allowedTransitions.push('bind-production-queue'),
			(candidate: ReturnType<typeof envelope>) =>
				candidate.authorizedManagedDelta.queueNames.push('commons-public-template-og'),
			(candidate: ReturnType<typeof envelope>) =>
				(candidate.authorizedManagedDelta.postMutationLiveProofRequired = false),
			(candidate: ReturnType<typeof envelope>) =>
				candidate.authorizedManagedDelta.liveProofRequirements.pop(),
			(candidate: ReturnType<typeof envelope>) =>
				(candidate.authorizedManagedDelta.targetRealm = 'preview'),
			(candidate: ReturnType<typeof envelope>) => (candidate.operatorPrincipal = 'other-operator'),
			(candidate: ReturnType<typeof envelope>) => {
				for (const observation of candidate.observations) {
					const primary = observation.queues.find(
						(queue) => queue.name === CLOUDFLARE_QUEUE_FREE_ENVELOPE_BOOTSTRAP_QUEUE
					)!;
					primary.producerIdentities.push({
						script: CLOUDFLARE_QUEUE_FREE_ENVELOPE_BOOTSTRAP_WORKER,
						type: 'worker'
					});
					primary.producerIdentities.sort((left, right) =>
						JSON.stringify(left).localeCompare(JSON.stringify(right))
					);
					primary.producerCount += 1;
				}
			},
			(candidate: ReturnType<typeof envelope>) => {
				for (const observation of candidate.observations) {
					const queueIndex = observation.queues.findIndex(
						(queue) => queue.name === 'commons-public-template-og-dlq'
					);
					const operation = observation.queueOperations[queueIndex]!;
					observation.queues.splice(queueIndex, 1);
					observation.queueOperations.splice(queueIndex, 1);
					observation.pagination.queueInventory.pages[0].itemCount -= 1;
					observation.pagination.queueInventory.totalItems -= 1;
					observation.pagination.queueOperations.queryCount -= 1;
					observation.pagination.queueOperations.queueIds.splice(queueIndex, 1);
					observation.retiredQueueBillableOperations += operation.billableOperations;
				}
			}
		];
		for (const mutate of mutations) {
			const candidate = envelope('bootstrap-production');
			mutate(candidate);
			expect(() => verify(candidate)).toThrow(/Queue Free/u);
		}
		expect(() =>
			validateCloudflareQueueFreeEnvelope({
				attestation: envelope('bootstrap-production'),
				expectedReleasePhase: 'bootstrap-production',
				expectedReleaseTransactionId: BOOTSTRAP_TRANSACTION_ID,
				expectedSourceSha: SOURCE_SHA,
				nowMs: NOW
			})
		).toThrow('expected operator principal');
		expect(() =>
			validateCloudflareQueueFreeEnvelope({
				attestation: envelope('bootstrap-production'),
				expectedOperatorPrincipal: PRINCIPAL,
				expectedReleasePhase: 'bootstrap-production',
				expectedSourceSha: SOURCE_SHA,
				nowMs: NOW
			})
		).toThrow('expected release transaction');
		expect(() => verify(envelope('bootstrap-production'), { expectedOperatorPrincipal: 'other' })).toThrow(
			'different operator principal'
		);
		expect(() =>
			verify(envelope('bootstrap-production'), { expectedReleaseTransactionId: '1753014600000-8' })
		).toThrow('different release transaction');
	});

	it('keeps one bootstrap receipt valid through a 60-minute authority with a 9–12 minute final-proof reserve', () => {
		const longReceipt = envelope('bootstrap-production');
		longReceipt.expiresAt = '2026-07-20T13:40:00.000Z';
		expect(
			validateCloudflareQueueFreeEnvelope({
				attestation: longReceipt,
				expectedOperatorPrincipal: PRINCIPAL,
				expectedReleasePhase: 'bootstrap-production',
				expectedReleaseTransactionId: BOOTSTRAP_TRANSACTION_ID,
				expectedSourceSha: SOURCE_SHA,
				minimumRemainingValiditySeconds: 180,
				nowMs: Date.parse('2026-07-20T13:37:00.000Z')
			})
		).toMatchObject({
			authorizedManagedDelta: { maximumReceiptAgeSeconds: 72 * 60 },
			receiptAgeSeconds: 72 * 60,
			remainingValiditySeconds: 180
		});

		expect(() =>
			validateCloudflareQueueFreeEnvelope({
				attestation: longReceipt,
				expectedOperatorPrincipal: PRINCIPAL,
				expectedReleasePhase: 'bootstrap-production',
				expectedReleaseTransactionId: BOOTSTRAP_TRANSACTION_ID,
				expectedSourceSha: SOURCE_SHA,
				nowMs: Date.parse('2026-07-20T13:37:00.001Z')
			})
		).toThrow('maximum verification age');

		const overlong = structuredClone(longReceipt);
		overlong.expiresAt = '2026-07-20T13:40:00.001Z';
		expect(() =>
			validateCloudflareQueueFreeEnvelope({
				attestation: overlong,
				expectedOperatorPrincipal: PRINCIPAL,
				expectedReleasePhase: 'bootstrap-production',
				expectedReleaseTransactionId: BOOTSTRAP_TRANSACTION_ID,
				expectedSourceSha: SOURCE_SHA,
				nowMs: NOW
			})
		).toThrow('expired, future-dated, or overlong');
	});

	it('pins the exact account, Free plan, bundled model, no paid subscription, and read-only observer', () => {
		const cases = [
			(candidate: ReturnType<typeof envelope>) => (candidate.account.id = 'b'.repeat(32)),
			(candidate: ReturnType<typeof envelope>) => (candidate.account.workersPlan = 'paid'),
			(candidate: ReturnType<typeof envelope>) =>
				(candidate.account.defaultUsageModel = 'unbound'),
			(candidate: ReturnType<typeof envelope>) =>
				(candidate.account.activeWorkersPaidSubscriptions = 1),
			(candidate: ReturnType<typeof envelope>) => candidate.observer.tokenPermissions.pop(),
			(candidate: ReturnType<typeof envelope>) => (candidate.observer.credentialPersisted = true)
		];
		for (const mutate of cases) {
			const candidate = envelope();
			mutate(candidate);
			expect(() =>
				validateCloudflareQueueFreeEnvelope({
					attestation: candidate,
					expectedReleasePhase: 'activate-preview',
					expectedSourceSha: SOURCE_SHA,
					nowMs: NOW
				})
			).toThrow(/Queue Free envelope/u);
		}
	});

	it('binds exact schema, source SHA, operator, phase, allowlist, and phase mutation scope', () => {
		const cases = [
			(candidate: ReturnType<typeof envelope>) =>
				Object.assign(candidate, { unexpected: true }),
			(candidate: ReturnType<typeof envelope>) => (candidate.namespace = 'other-domain'),
			(candidate: ReturnType<typeof envelope>) => (candidate.sourceSha = 'b'.repeat(40)),
			(candidate: ReturnType<typeof envelope>) => (candidate.operatorPrincipal = 'bad principal'),
			(candidate: ReturnType<typeof envelope>) => candidate.managedQueueAllowlist.reverse(),
			(candidate: ReturnType<typeof envelope>) =>
				(candidate.authorizedManagedDelta.postMutationLiveProofRequired = false),
			(candidate: ReturnType<typeof envelope>) =>
				candidate.authorizedManagedDelta.queueNames.pop(),
			(candidate: ReturnType<typeof envelope>) =>
				candidate.authorizedManagedDelta.queueNames.push('sibling-inert-queue'),
			(candidate: ReturnType<typeof envelope>) =>
				candidate.authorizedManagedDelta.allowedTransitions.push('unbounded-mutation'),
			(candidate: ReturnType<typeof envelope>) =>
				(candidate.source.queueMessageOperationsMetric = 'count')
		];
		for (const mutate of cases) {
			const candidate = envelope();
			mutate(candidate);
			expect(() =>
				validateCloudflareQueueFreeEnvelope({
					attestation: candidate,
					expectedReleasePhase: 'activate-preview',
					expectedSourceSha: SOURCE_SHA,
					nowMs: NOW
				})
			).toThrow(/Queue Free envelope/u);
		}
		expect(() =>
			validateCloudflareQueueFreeEnvelope({
				attestation: envelope('activate-preview'),
				expectedReleasePhase: 'activate-production',
				expectedSourceSha: SOURCE_SHA,
				nowMs: NOW
			})
		).toThrow('different release phase');
	});

	it('requires a fresh canonical <=30-minute lifetime with configurable remaining validity', () => {
		const overlong = envelope();
		overlong.expiresAt = '2026-07-20T12:55:00.001Z';
		expect(() =>
			validateCloudflareQueueFreeEnvelope({
				attestation: overlong,
				expectedReleasePhase: 'activate-preview',
				expectedSourceSha: SOURCE_SHA,
				nowMs: NOW
			})
		).toThrow('expired, future-dated, or overlong');

		const future = envelope();
		future.capturedAt = '2026-07-20T12:35:00.001Z';
		future.expiresAt = '2026-07-20T12:50:00.000Z';
		expect(() =>
			validateCloudflareQueueFreeEnvelope({
				attestation: future,
				expectedReleasePhase: 'activate-preview',
				expectedSourceSha: SOURCE_SHA,
				nowMs: NOW
			})
		).toThrow('expired, future-dated, or overlong');

		expect(() =>
			validateCloudflareQueueFreeEnvelope({
				attestation: envelope(),
				expectedReleasePhase: 'activate-preview',
				expectedSourceSha: SOURCE_SHA,
				minimumRemainingValiditySeconds: 1_201,
				nowMs: NOW
			})
		).toThrow('does not retain enough validity');

		const ageBoundary = envelope();
		ageBoundary.expiresAt = '2026-07-20T12:55:00.000Z';
		expect(
			validateCloudflareQueueFreeEnvelope({
				attestation: ageBoundary,
				expectedReleasePhase: 'activate-preview',
				expectedSourceSha: SOURCE_SHA,
				nowMs: Date.parse('2026-07-20T12:52:00.000Z')
			})
		).toMatchObject({ receiptAgeSeconds: 27 * 60 });
		expect(() =>
			validateCloudflareQueueFreeEnvelope({
				attestation: ageBoundary,
				expectedReleasePhase: 'activate-preview',
				expectedSourceSha: SOURCE_SHA,
				nowMs: Date.parse('2026-07-20T12:52:00.001Z')
			})
		).toThrow('maximum verification age');
	});

	it('requires two same-day lagged observations at least 15 minutes apart with an unchanged cumulative total', () => {
		const cases = [
			(candidate: ReturnType<typeof envelope>) =>
				(candidate.observations[1].observedAt = '2026-07-20T12:19:59.999Z'),
			(candidate: ReturnType<typeof envelope>) =>
				(candidate.observations[0].dataThrough = '2026-07-20T11:50:00.001Z'),
			(candidate: ReturnType<typeof envelope>) =>
				(candidate.observations[1].utcDayStart = '2026-07-19T00:00:00.000Z'),
			(candidate: ReturnType<typeof envelope>) =>
				(candidate.observations[1].accountBillableOperations = 2_001),
			(candidate: ReturnType<typeof envelope>) =>
				(candidate.observations[0].accountBillableOperations =
					CLOUDFLARE_QUEUE_FREE_ENVELOPE_MAX_BILLABLE_OPERATIONS + 1),
			(candidate: ReturnType<typeof envelope>) => candidate.observations.pop()
		];
		for (const mutate of cases) {
			const candidate = envelope();
			mutate(candidate);
			expect(() =>
				validateCloudflareQueueFreeEnvelope({
					attestation: candidate,
					expectedReleasePhase: 'activate-preview',
					expectedSourceSha: SOURCE_SHA,
					nowMs: NOW
				})
			).toThrow(/Queue Free envelope/u);
		}

		const rollover = envelope();
		rollover.observations[1].observedAt = '2026-07-21T00:00:00.000Z';
		rollover.observations[1].dataThrough = '2026-07-20T23:45:00.000Z';
		expect(() =>
			validateCloudflareQueueFreeEnvelope({
				attestation: rollover,
				expectedReleasePhase: 'activate-preview',
				expectedSourceSha: SOURCE_SHA,
				nowMs: NOW
			})
		).toThrow('required data lag in one UTC day');
	});

	it('binds a fresh capture to the latest observation and one UTC accounting day', () => {
		const staleObservation = envelope();
		staleObservation.capturedAt = '2026-07-20T12:25:00.001Z';
		expect(() =>
			validateCloudflareQueueFreeEnvelope({
				attestation: staleObservation,
				expectedReleasePhase: 'activate-preview',
				expectedSourceSha: SOURCE_SHA,
				nowMs: NOW
			})
		).toThrow('too long after its second observation');

		const crossingDayEnd = envelope();
		crossingDayEnd.capturedAt = '2026-07-20T23:55:00.000Z';
		crossingDayEnd.expiresAt = '2026-07-21T00:10:00.000Z';
		crossingDayEnd.observations = [
			observation('2026-07-20T23:35:00.000Z', '2026-07-20T23:20:00.000Z'),
			observation('2026-07-20T23:50:00.000Z', '2026-07-20T23:35:00.000Z')
		];
		expect(() =>
			validateCloudflareQueueFreeEnvelope({
				attestation: crossingDayEnd,
				expectedReleasePhase: 'activate-preview',
				expectedSourceSha: SOURCE_SHA,
				nowMs: Date.parse('2026-07-20T23:57:00.000Z')
			})
		).toThrow('one UTC accounting day');

		crossingDayEnd.expiresAt = '2026-07-21T00:00:00.000Z';
		expect(() =>
			validateCloudflareQueueFreeEnvelope({
				attestation: crossingDayEnd,
				expectedReleasePhase: 'activate-preview',
				expectedSourceSha: SOURCE_SHA,
				nowMs: Date.parse('2026-07-21T00:00:00.000Z')
			})
		).toThrow('one UTC accounting day');
	});

	it('requires complete pagination and exact per-Queue GraphQL/account reconciliation', () => {
		const cases = [
			(candidate: ReturnType<typeof envelope>) =>
				(candidate.observations[0].pagination.queueInventory.complete = false),
			(candidate: ReturnType<typeof envelope>) =>
				(candidate.observations[0].pagination.queueOperations.queryCount = 4),
			(candidate: ReturnType<typeof envelope>) =>
				(candidate.observations[0].pagination.queueOperations.accountAggregateQueryCount = 0),
			(candidate: ReturnType<typeof envelope>) =>
				(candidate.observations[0].pagination.queueInventory.totalPages = 2),
			(candidate: ReturnType<typeof envelope>) =>
				(candidate.observations[0].queueOperations[0].queueId = 'f'.repeat(32)),
			(candidate: ReturnType<typeof envelope>) =>
				(candidate.observations[0].queueOperations[0].billableOperations += 1),
			(candidate: ReturnType<typeof envelope>) =>
				(candidate.observations[0].retiredQueueBillableOperations = 1)
		];
		for (const mutate of cases) {
			const candidate = envelope();
			mutate(candidate);
			expect(() =>
				validateCloudflareQueueFreeEnvelope({
					attestation: candidate,
					expectedReleasePhase: 'activate-preview',
					expectedSourceSha: SOURCE_SHA,
					nowMs: NOW
				})
			).toThrow(/Queue Free envelope/u);
		}
	});

	it('rejects duplicate, substituted, or unsorted identities, nonallowlisted authority, settings drift, and positive backlog', () => {
		const cases = [
			(candidate: ReturnType<typeof envelope>) =>
				(candidate.observations[0].queues[1].id = candidate.observations[0].queues[0].id),
			(candidate: ReturnType<typeof envelope>) =>
				candidate.observations[0].queues.reverse(),
			(candidate: ReturnType<typeof envelope>) =>
				(candidate.observations[0].queues[4].producerCount = 1),
			(candidate: ReturnType<typeof envelope>) =>
				(candidate.observations[1].queues[2].advisoryBacklog.backlogMessages = 1),
			(candidate: ReturnType<typeof envelope>) =>
				(candidate.observations[1].queues[0].producerIdentities[0].script =
					'constant-count-substitution'),
			(candidate: ReturnType<typeof envelope>) =>
				(candidate.observations[1].queues[0].consumerIds[0] =
					'constant-count-consumer-substitution'),
			(candidate: ReturnType<typeof envelope>) =>
				(candidate.observations[1].queues[0].settings.deliveryDelay = 1),
			(candidate: ReturnType<typeof envelope>) =>
				candidate.observations[0].queues[0].consumerIds.push('unreconciled-consumer')
		];
		for (const mutate of cases) {
			const candidate = envelope();
			mutate(candidate);
			expect(() =>
				validateCloudflareQueueFreeEnvelope({
					attestation: candidate,
					expectedReleasePhase: 'activate-preview',
					expectedSourceSha: SOURCE_SHA,
					nowMs: NOW
				})
			).toThrow(/Queue Free envelope/u);
		}
	});

	it('verifies only canonical JSON with an allowed Ed25519 SSH signature and isolated namespace', () => {
		const proof = signedEnvelope();
		expect(
			verifySignedCloudflareQueueFreeEnvelope({
				allowedSignersPath,
				...proof,
				expectedReleasePhase: 'activate-preview',
				expectedSourceSha: SOURCE_SHA,
				minimumRemainingValiditySeconds: 180,
				nowMs: NOW
			})
		).toMatchObject({
			releasePhase: 'activate-preview',
			signature: {
				namespace: CLOUDFLARE_QUEUE_FREE_ENVELOPE_SIGNATURE_NAMESPACE,
				principal: PRINCIPAL
			}
		});

		const noncanonicalBytes = Buffer.from(`${JSON.stringify(envelope(), null, 2)}\n`, 'utf8');
		expect(() =>
			verifySignedCloudflareQueueFreeEnvelope({
				allowedSignersPath,
				attestationBytes: noncanonicalBytes,
				expectedReleasePhase: 'activate-preview',
				expectedSourceSha: SOURCE_SHA,
				nowMs: NOW,
				signatureBytes: proof.signatureBytes
			})
		).toThrow('not in canonical form');

		const wrongNamespaceSignature = execFileSync(
			'ssh-keygen',
			['-Y', 'sign', '-f', signingKeyPath, '-n', 'other-namespace', '-'],
			{ input: proof.attestationBytes, stdio: ['pipe', 'pipe', 'ignore'] }
		);
		expect(() =>
			verifySignedCloudflareQueueFreeEnvelope({
				allowedSignersPath,
				attestationBytes: proof.attestationBytes,
				expectedReleasePhase: 'activate-preview',
				expectedSourceSha: SOURCE_SHA,
				nowMs: NOW,
				signatureBytes: wrongNamespaceSignature
			})
		).toThrow('not valid for an allowed operator');

		const wrongPrincipal = envelope();
		wrongPrincipal.operatorPrincipal = 'other-cloudflare-operator';
		const wrongPrincipalProof = signedEnvelope(wrongPrincipal);
		expect(() =>
			verifySignedCloudflareQueueFreeEnvelope({
				allowedSignersPath,
				...wrongPrincipalProof,
				expectedReleasePhase: 'activate-preview',
				expectedSourceSha: SOURCE_SHA,
				nowMs: NOW
			})
		).toThrow('not valid for an allowed operator');

		for (const contents of ['', '# no enrolled Queue Free-envelope signer\n']) {
			const trustRoot = path.join(
				temporaryDirectory,
				`empty-trust-${Buffer.from(contents).toString('hex') || 'zero'}`
			);
			writeFileSync(trustRoot, contents);
			expect(() =>
				verifySignedCloudflareQueueFreeEnvelope({
					allowedSignersPath: trustRoot,
					...proof,
					expectedReleasePhase: 'activate-preview',
					expectedSourceSha: SOURCE_SHA,
					nowMs: NOW
				})
			).toThrow('not valid for an allowed operator');
		}
	});

	it('cryptographically binds bootstrap phase, SHA, operator, and transaction to verifier expectations', () => {
		const proof = signedEnvelope(envelope('bootstrap-production'));
		expect(
			verifySignedCloudflareQueueFreeEnvelope({
				allowedSignersPath,
				...proof,
				expectedOperatorPrincipal: PRINCIPAL,
				expectedReleasePhase: 'bootstrap-production',
				expectedReleaseTransactionId: BOOTSTRAP_TRANSACTION_ID,
				expectedSourceSha: SOURCE_SHA,
				nowMs: NOW
			})
		).toMatchObject({
			operatorPrincipal: PRINCIPAL,
			releasePhase: 'bootstrap-production',
			releaseTransactionId: BOOTSTRAP_TRANSACTION_ID,
			signature: { principal: PRINCIPAL }
		});

		for (const expected of [
			{ expectedOperatorPrincipal: 'other-operator' },
			{ expectedReleaseTransactionId: '1753014600000-8' },
			{ expectedReleasePhase: 'activate-production' as const },
			{ expectedSourceSha: 'b'.repeat(40) }
		]) {
			expect(() =>
				verifySignedCloudflareQueueFreeEnvelope({
					allowedSignersPath,
					...proof,
					expectedOperatorPrincipal: PRINCIPAL,
					expectedReleasePhase: 'bootstrap-production',
					expectedReleaseTransactionId: BOOTSTRAP_TRANSACTION_ID,
					expectedSourceSha: SOURCE_SHA,
					nowMs: NOW,
					...expected
				})
			).toThrow(/Queue Free/u);
		}

		const tampered = envelope('bootstrap-production');
		tampered.releaseTransactionId = '1753014600000-8';
		expect(() =>
			verifySignedCloudflareQueueFreeEnvelope({
				allowedSignersPath,
				attestationBytes: canonicalCloudflareQueueFreeEnvelopeBytes(tampered),
				expectedOperatorPrincipal: PRINCIPAL,
				expectedReleasePhase: 'bootstrap-production',
				expectedReleaseTransactionId: BOOTSTRAP_TRANSACTION_ID,
				expectedSourceSha: SOURCE_SHA,
				nowMs: NOW,
				signatureBytes: proof.signatureBytes
			})
		).toThrow('not valid for an allowed operator');
	});

	it('signs canonical semantic receipts with an enrolled operator-local Ed25519 key', () => {
		const attestationPath = path.join(temporaryDirectory, 'operator-envelope.json');
		const signaturePath = path.join(temporaryDirectory, 'operator-envelope.sig');
		writeFileSync(attestationPath, canonicalCloudflareQueueFreeEnvelopeBytes(envelope()));

		expect(
			signCloudflareQueueFreeEnvelope({
				allowedSignersPath,
				attestationPath,
				nowMs: NOW,
				signaturePath,
				signingKey: signingKeyPath
			})
		).toMatchObject({
			namespace: CLOUDFLARE_QUEUE_FREE_ENVELOPE_SIGNATURE_NAMESPACE,
			principal: PRINCIPAL
		});
		expect(statSync(signaturePath).mode & 0o777).toBe(0o600);
		expect(
			verifySignedCloudflareQueueFreeEnvelope({
				allowedSignersPath,
				attestationBytes: readFileSync(attestationPath),
				expectedReleasePhase: 'activate-preview',
				expectedSourceSha: SOURCE_SHA,
				nowMs: NOW,
				signatureBytes: readFileSync(signaturePath)
			})
		).toMatchObject({ releasePhase: 'activate-preview' });
	});

	it('signs a schema-2 bootstrap receipt without granting activation authority', () => {
		const attestationPath = path.join(temporaryDirectory, 'operator-bootstrap-envelope.json');
		const signaturePath = path.join(temporaryDirectory, 'operator-bootstrap-envelope.sig');
		writeFileSync(
			attestationPath,
			canonicalCloudflareQueueFreeEnvelopeBytes(envelope('bootstrap-production'))
		);
		signCloudflareQueueFreeEnvelope({
			allowedSignersPath,
			attestationPath,
			nowMs: NOW,
			signaturePath,
			signingKey: signingKeyPath
		});
		expect(
			verifySignedCloudflareQueueFreeEnvelope({
				allowedSignersPath,
				attestationBytes: readFileSync(attestationPath),
				expectedOperatorPrincipal: PRINCIPAL,
				expectedReleasePhase: 'bootstrap-production',
				expectedReleaseTransactionId: BOOTSTRAP_TRANSACTION_ID,
				expectedSourceSha: SOURCE_SHA,
				nowMs: NOW,
				signatureBytes: readFileSync(signaturePath)
			})
		).toMatchObject({
			authorizedManagedDelta: phaseAuthority('bootstrap-production')
		});
	});

	it('captures two reconciled observations with an ephemeral narrow token and canonical mode-0600 output', async () => {
		const api = captureApi({ accountTotal: 2_100 });
		const apiToken = 'observer-secret-token-never-persisted';
		let nowMs = Date.parse('2026-07-20T12:00:00.000Z');
		const progress: string[] = [];
		const receipt = await captureCloudflareQueueFreeEnvelope({
			apiToken,
			fetchFn: api.fetchFn,
			nowFn: () => nowMs,
			operatorPrincipal: PRINCIPAL,
			progressFn: (message) => progress.push(message),
			releasePhase: 'activate-preview',
			sleepFn: async (milliseconds) => {
				nowMs += milliseconds;
			},
			sourceSha: SOURCE_SHA
		});

		expect(receipt.bytes.equals(canonicalCloudflareQueueFreeEnvelopeBytes(receipt.attestation))).toBe(
			true
		);
		expect(receipt.attestation).toMatchObject({
			capturedAt: '2026-07-20T12:15:00.000Z',
			expiresAt: '2026-07-20T12:45:00.000Z',
			releasePhase: 'activate-preview',
			schemaVersion: 1
		});
		expect('releaseTransactionId' in receipt.attestation).toBe(false);
		expect(receipt.bytes.toString('utf8')).not.toContain(apiToken);
		expect(api.authorizations.every((value) => value === `Bearer ${apiToken}`)).toBe(true);
		expect(api.redirects.every((value) => value === 'error')).toBe(true);
		expect(api.graphQlWindows).toHaveLength((QUEUE_NAMES.length + 1) * 2);
		const perQueueWindows = api.graphQlWindows.filter((value) => value.queueId !== null);
		expect(new Set(perQueueWindows.slice(0, QUEUE_NAMES.length).map((value) => value.datetimeEnd))).toEqual(
			new Set(['2026-07-20T11:45:00.000Z'])
		);
		expect(new Set(perQueueWindows.slice(QUEUE_NAMES.length).map((value) => value.datetimeEnd))).toEqual(
			new Set(['2026-07-20T12:00:00.000Z'])
		);
		expect(progress).toHaveLength(3);
		expect(
			validateCloudflareQueueFreeEnvelope({
				attestation: receipt.attestation,
				expectedReleasePhase: 'activate-preview',
				expectedSourceSha: SOURCE_SHA,
				nowMs
			})
		).toMatchObject({
			accountBillableOperations: 2_100,
			receiptAgeSeconds: 0,
			retiredQueueBillableOperations: 100
		});

		const output = path.join(temporaryDirectory, 'captured-envelope.json');
		writeCloudflareQueueFreeEnvelope(output, receipt.bytes);
		expect(readFileSync(output).equals(receipt.bytes)).toBe(true);
		expect(statSync(output).mode & 0o777).toBe(0o600);
		expect(() => writeCloudflareQueueFreeEnvelope(output, receipt.bytes)).toThrow();
		const symlink = path.join(temporaryDirectory, 'captured-envelope-link.json');
		symlinkSync(path.join(temporaryDirectory, 'missing-target.json'), symlink);
		expect(() => writeCloudflareQueueFreeEnvelope(symlink, receipt.bytes)).toThrow();
	});

	it('captures bootstrap as a transaction-bound schema-2 receipt and refuses cross-phase transaction leakage', async () => {
		const api = liveQueueApi();
		let nowMs = Date.parse('2026-07-20T12:00:00.000Z');
		const receipt = await captureCloudflareQueueFreeEnvelope({
			apiToken: 'observer-secret-token-never-persisted',
			fetchFn: api.fetchFn,
			nowFn: () => nowMs,
			operatorPrincipal: PRINCIPAL,
			releasePhase: 'bootstrap-production',
			releaseTransactionId: BOOTSTRAP_TRANSACTION_ID,
			sleepFn: async (milliseconds) => {
				nowMs += milliseconds;
			},
			sourceSha: SOURCE_SHA
		});
		expect(receipt.attestation).toMatchObject({
			authorizedManagedDelta: phaseAuthority('bootstrap-production'),
			capturedAt: '2026-07-20T12:15:00.000Z',
			expiresAt: '2026-07-20T13:30:00.000Z',
			operatorPrincipal: PRINCIPAL,
			releasePhase: 'bootstrap-production',
			releaseTransactionId: BOOTSTRAP_TRANSACTION_ID,
			schemaVersion: 2,
			sourceSha: SOURCE_SHA
		});
		await expect(
			captureCloudflareQueueFreeEnvelope({
				apiToken: 'observer-secret-token-never-persisted',
				fetchFn: api.fetchFn,
				nowFn: () => nowMs,
				operatorPrincipal: PRINCIPAL,
				releasePhase: 'bootstrap-production',
				sourceSha: SOURCE_SHA
			})
		).rejects.toThrow('bootstrap release transaction');
		await expect(
			captureCloudflareQueueFreeEnvelope({
				apiToken: 'observer-secret-token-never-persisted',
				fetchFn: api.fetchFn,
				nowFn: () => nowMs,
				operatorPrincipal: PRINCIPAL,
				releasePhase: 'activate-production',
				releaseTransactionId: BOOTSTRAP_TRANSACTION_ID,
				sourceSha: SOURCE_SHA
			})
		).rejects.toThrow('cannot carry a bootstrap release transaction');

		let lateFetchCalls = 0;
		await expect(
			captureCloudflareQueueFreeEnvelope({
				apiToken: 'observer-secret-token-never-persisted',
				fetchFn: (async () => {
					lateFetchCalls += 1;
					throw new Error('must not reach Cloudflare');
				}) as typeof fetch,
				nowFn: () => Date.parse('2026-07-20T22:30:00.001Z'),
				operatorPrincipal: PRINCIPAL,
				releasePhase: 'bootstrap-production',
				releaseTransactionId: BOOTSTRAP_TRANSACTION_ID,
				sourceSha: SOURCE_SHA
			})
		).rejects.toThrow('inside one UTC accounting day');
		expect(lateFetchCalls).toBe(0);
	});

	it('refuses to infer Free plan when an active Workers-paid subscription exists', async () => {
		const api = captureApi({ paidWorkers: true });
		await expect(
			captureCloudflareQueueFreeEnvelope({
				apiToken: 'observer-secret-token-never-persisted',
				fetchFn: api.fetchFn,
				nowFn: () => Date.parse('2026-07-20T12:00:00.000Z'),
				operatorPrincipal: PRINCIPAL,
				releasePhase: 'activate-preview',
				sourceSha: SOURCE_SHA
			})
		).rejects.toThrow('active Workers-paid subscription');
	});

	it('proves the one transient bootstrap producer and then exact terminal baseline restoration', async () => {
		const proof = signedEnvelope(envelope('bootstrap-production'));
		const api = liveQueueApi();
		await expect(
			verifyCloudflareQueueReleasePhaseState({
				accountId: CLOUDFLARE_QUEUE_FREE_ENVELOPE_ACCOUNT_ID,
				apiToken: 'live-read-only-api-token',
				allowedSignersPath,
				...proof,
				operatorPrincipal: PRINCIPAL,
				releasePhase: 'bootstrap-production',
				releaseTransactionId: BOOTSTRAP_TRANSACTION_ID,
				sourceSha: SOURCE_SHA,
				state: 'bootstrap-unchanged',
				fetchFn: api.fetchFn,
				nowMs: NOW
			})
		).resolves.toMatchObject({
			authorizedTransientProducerDeltaOnly: true,
			bootstrapConsumerReady: true,
			bootstrapConsumerWorkBudgetExact: true,
			bootstrapProducerAttached: false,
			operatorPrincipal: PRINCIPAL,
			queueConfigurationUnchanged: true,
			queueConfigurationUnchangedExceptAuthorizedProducer: false,
			realm: 'production',
			releasePhase: 'bootstrap-production',
			releaseTransactionId: BOOTSTRAP_TRANSACTION_ID,
			state: 'bootstrap-unchanged',
			targetQueueIds: {
				queue: '1'.repeat(32),
				deadLetterQueue: '2'.repeat(32)
			}
		});

		const driftApi = liveQueueApi({
			mutateInventory: (inventory) => {
				inventory[0].settings.delivery_paused = true;
			}
		});
		await expect(
			verifyCloudflareQueueReleasePhaseState({
				accountId: CLOUDFLARE_QUEUE_FREE_ENVELOPE_ACCOUNT_ID,
				apiToken: 'live-read-only-api-token',
				allowedSignersPath,
				...proof,
				operatorPrincipal: PRINCIPAL,
				releasePhase: 'bootstrap-production',
				releaseTransactionId: BOOTSTRAP_TRANSACTION_ID,
				sourceSha: SOURCE_SHA,
				state: 'bootstrap-unchanged',
				fetchFn: driftApi.fetchFn,
				nowMs: NOW
			})
		).rejects.toThrow('drifted from the signed account-wide bootstrap baseline');

		const readyReceipt = envelope('bootstrap-production');
		readyReceipt.expiresAt = '2026-07-20T13:40:00.000Z';
		await expect(
			verifyCloudflareQueueReleasePhaseState({
				accountId: CLOUDFLARE_QUEUE_FREE_ENVELOPE_ACCOUNT_ID,
				apiToken: 'live-read-only-api-token',
				allowedSignersPath,
				...signedEnvelope(readyReceipt),
				operatorPrincipal: PRINCIPAL,
				releasePhase: 'bootstrap-production',
				releaseTransactionId: BOOTSTRAP_TRANSACTION_ID,
				sourceSha: SOURCE_SHA,
				state: 'bootstrap-consumer-ready',
				minimumRemainingValiditySeconds:
					CLOUDFLARE_QUEUE_FREE_ENVELOPE_BOOTSTRAP_ATTACHED_PROOF_VALIDITY_SECONDS,
				fetchFn: liveQueueApi().fetchFn,
				nowMs: NOW
			})
		).resolves.toMatchObject({
			bootstrapConsumerReady: true,
			bootstrapProducerAttached: false,
			primaryDeliveryPaused: false,
			primaryProducerCount: 0,
				queueConfigurationUnchanged: true,
				queueConfigurationUnchangedExceptAuthorizedProducer: false,
			state: 'bootstrap-consumer-ready'
		});

		await expect(
			verifyCloudflareQueueReleasePhaseState({
				accountId: CLOUDFLARE_QUEUE_FREE_ENVELOPE_ACCOUNT_ID,
				apiToken: 'live-read-only-api-token',
				allowedSignersPath,
				...signedEnvelope(readyReceipt),
				operatorPrincipal: PRINCIPAL,
				releasePhase: 'bootstrap-production',
				releaseTransactionId: BOOTSTRAP_TRANSACTION_ID,
				sourceSha: SOURCE_SHA,
				state: 'bootstrap-consumer-ready',
				minimumRemainingValiditySeconds:
					CLOUDFLARE_QUEUE_FREE_ENVELOPE_BOOTSTRAP_ATTACHED_PROOF_VALIDITY_SECONDS,
				fetchFn: liveQueueApi({
					mutateConsumers: (primary) => {
						primary[0].settings.max_retries = 3;
					}
				}).fetchFn,
				nowMs: NOW
			})
		).rejects.toThrow('work budget is not exact');

		const longReceipt = envelope('bootstrap-production');
		longReceipt.expiresAt = '2026-07-20T13:40:00.000Z';
		const attachedProof = signedEnvelope(longReceipt);
		const attachedApi = liveQueueApi({ bootstrapProducerAttached: true });
		await expect(
			verifyCloudflareQueueReleasePhaseState({
				accountId: CLOUDFLARE_QUEUE_FREE_ENVELOPE_ACCOUNT_ID,
				apiToken: 'live-read-only-api-token',
				allowedSignersPath,
				...attachedProof,
				operatorPrincipal: PRINCIPAL,
				releasePhase: 'bootstrap-production',
				releaseTransactionId: BOOTSTRAP_TRANSACTION_ID,
				sourceSha: SOURCE_SHA,
				state: 'bootstrap-producer-attached',
				minimumRemainingValiditySeconds:
					CLOUDFLARE_QUEUE_FREE_ENVELOPE_BOOTSTRAP_ATTACHED_PROOF_VALIDITY_SECONDS,
				fetchFn: attachedApi.fetchFn,
				nowMs: NOW
			})
		).resolves.toMatchObject({
			authorizedTransientProducerDeltaOnly: true,
			bootstrapProducerAttached: true,
			queueConfigurationUnchanged: false,
			queueConfigurationUnchangedExceptAuthorizedProducer: true,
			remainingValiditySeconds: 70 * 60,
			state: 'bootstrap-producer-attached',
			unmanagedAuthorityUnchanged: true
		});
		await expect(
			verifyCloudflareQueueReleasePhaseState({
				accountId: CLOUDFLARE_QUEUE_FREE_ENVELOPE_ACCOUNT_ID,
				apiToken: 'live-read-only-api-token',
				allowedSignersPath,
				...attachedProof,
				operatorPrincipal: PRINCIPAL,
				releasePhase: 'bootstrap-production',
				releaseTransactionId: BOOTSTRAP_TRANSACTION_ID,
				sourceSha: SOURCE_SHA,
				state: 'bootstrap-producer-attached',
				minimumRemainingValiditySeconds: 3_600,
				fetchFn: attachedApi.fetchFn,
				nowMs: NOW
			})
		).rejects.toThrow(
			`must require exactly ${CLOUDFLARE_QUEUE_FREE_ENVELOPE_BOOTSTRAP_ATTACHED_PROOF_VALIDITY_SECONDS} seconds`
		);
		const extraProducerApi = liveQueueApi({
			bootstrapProducerAttached: true,
			mutateInventory: (inventory) => {
				const primary = inventory.find(
					(queue) => queue.queue_name === CLOUDFLARE_QUEUE_FREE_ENVELOPE_BOOTSTRAP_QUEUE
				);
				primary.producers.push({ script: 'unauthorized-bootstrap-producer', type: 'worker' });
				primary.producers.sort((left: any, right: any) =>
					JSON.stringify(left).localeCompare(JSON.stringify(right))
				);
				primary.producers_total_count += 1;
			}
		});
		for (const candidateApi of [liveQueueApi(), extraProducerApi]) {
			await expect(
				verifyCloudflareQueueReleasePhaseState({
					accountId: CLOUDFLARE_QUEUE_FREE_ENVELOPE_ACCOUNT_ID,
					apiToken: 'live-read-only-api-token',
					allowedSignersPath,
					...attachedProof,
					operatorPrincipal: PRINCIPAL,
					releasePhase: 'bootstrap-production',
					releaseTransactionId: BOOTSTRAP_TRANSACTION_ID,
					sourceSha: SOURCE_SHA,
					state: 'bootstrap-producer-attached',
					minimumRemainingValiditySeconds:
						CLOUDFLARE_QUEUE_FREE_ENVELOPE_BOOTSTRAP_ATTACHED_PROOF_VALIDITY_SECONDS,
					fetchFn: candidateApi.fetchFn,
					nowMs: NOW
				})
			).rejects.toThrow('differs from the exact signed baseline plus its one authorized producer');
		}

		const attachedConsumerDrift = liveQueueApi({
			bootstrapProducerAttached: true,
			mutateInventory: (inventory) => {
				const primary = inventory.find(
					(queue) => queue.queue_name === CLOUDFLARE_QUEUE_FREE_ENVELOPE_BOOTSTRAP_QUEUE
				);
				primary.consumers.push({ consumer_id: 'unauthorized-bootstrap-consumer' });
				primary.consumers_total_count += 1;
			}
		});
		await expect(
			verifyCloudflareQueueReleasePhaseState({
				accountId: CLOUDFLARE_QUEUE_FREE_ENVELOPE_ACCOUNT_ID,
				apiToken: 'live-read-only-api-token',
				allowedSignersPath,
				...attachedProof,
				operatorPrincipal: PRINCIPAL,
				releasePhase: 'bootstrap-production',
				releaseTransactionId: BOOTSTRAP_TRANSACTION_ID,
				sourceSha: SOURCE_SHA,
				state: 'bootstrap-producer-attached',
				minimumRemainingValiditySeconds:
					CLOUDFLARE_QUEUE_FREE_ENVELOPE_BOOTSTRAP_ATTACHED_PROOF_VALIDITY_SECONDS,
				fetchFn: attachedConsumerDrift.fetchFn,
				nowMs: NOW
			})
		).rejects.toThrow('differs from the exact signed baseline plus its one authorized producer');

		await expect(
			verifyCloudflareQueueReleasePhaseState({
				accountId: CLOUDFLARE_QUEUE_FREE_ENVELOPE_ACCOUNT_ID,
				apiToken: 'live-read-only-api-token',
				allowedSignersPath,
				...proof,
				operatorPrincipal: PRINCIPAL,
				releasePhase: 'bootstrap-production',
				releaseTransactionId: BOOTSTRAP_TRANSACTION_ID,
				sourceSha: SOURCE_SHA,
				state: 'active',
				fetchFn: api.fetchFn,
				nowMs: NOW
			})
		).rejects.toThrow('phase and bootstrap state are incompatible');
	});

	it('preserves exact activation CLIs and requires bootstrap-only operator/transaction bindings', () => {
		expect(
			parseCloudflareQueueFreeEnvelopeArgs([
				'--attestation',
				'/secure/envelope.json',
				'--signature',
				'/secure/envelope.sig',
				'--allowed-signers',
				'.github/cloudflare-queue-allowed-signers',
				'--source-sha',
				SOURCE_SHA,
				'--release-phase',
				'activate-preview',
				'--min-validity-seconds',
				'180'
			])
		).toEqual({
			allowedSignersPath: '.github/cloudflare-queue-allowed-signers',
			attestationPath: '/secure/envelope.json',
			expectedReleasePhase: 'activate-preview',
			expectedSourceSha: SOURCE_SHA,
			minimumValiditySeconds: 180,
			signaturePath: '/secure/envelope.sig'
		});
		expect(() =>
			parseCloudflareQueueFreeEnvelopeArgs([
				'--attestation',
				'a',
				'--signature',
				'b',
				'--allowed-signers',
				'c',
				'--source-sha',
				SOURCE_SHA,
				'--release-phase',
				'preview',
				'--min-validity-seconds',
				'180'
			])
		).toThrow('release phase');
		expect(
			parseCloudflareQueueFreeEnvelopeSigningArgs([
				'--attestation',
				'/secure/envelope.json',
				'--signature',
				'/secure/envelope.sig',
				'--signing-key',
				'/secure/envelope-ed25519',
				'--allowed-signers',
				'.github/cloudflare-queue-allowed-signers'
			])
		).toEqual({
			allowedSignersPath: '.github/cloudflare-queue-allowed-signers',
			attestationPath: '/secure/envelope.json',
			signaturePath: '/secure/envelope.sig',
			signingKey: '/secure/envelope-ed25519'
		});
		expect(
			parseCloudflareQueueFreeEnvelopeCaptureArgs([
				'--operator-principal',
				PRINCIPAL,
				'--output',
				'/secure/envelope.json',
				'--release-phase',
				'activate-production',
				'--source-sha',
				SOURCE_SHA
			])
		).toEqual({
			operatorPrincipal: PRINCIPAL,
			outputPath: '/secure/envelope.json',
			releasePhase: 'activate-production',
				sourceSha: SOURCE_SHA
			});
		expect(
			parseCloudflareQueueFreeEnvelopeCaptureArgs([
				'--operator-principal',
				PRINCIPAL,
				'--output',
				'/secure/bootstrap.json',
				'--release-phase',
				'bootstrap-production',
				'--source-sha',
				SOURCE_SHA,
				'--transaction-id',
				BOOTSTRAP_TRANSACTION_ID
			])
		).toEqual({
			operatorPrincipal: PRINCIPAL,
			outputPath: '/secure/bootstrap.json',
			releasePhase: 'bootstrap-production',
			releaseTransactionId: BOOTSTRAP_TRANSACTION_ID,
			sourceSha: SOURCE_SHA
		});

		const bootstrapVerifierArgs = [
			'--attestation',
			'/secure/bootstrap.json',
			'--signature',
			'/secure/bootstrap.sig',
			'--allowed-signers',
			'.github/cloudflare-queue-allowed-signers',
			'--source-sha',
			SOURCE_SHA,
			'--release-phase',
			'bootstrap-production',
			'--min-validity-seconds',
			String(72 * 60),
			'--operator-principal',
			PRINCIPAL,
			'--transaction-id',
			BOOTSTRAP_TRANSACTION_ID
		];
		expect(parseCloudflareQueueFreeEnvelopeArgs(bootstrapVerifierArgs)).toEqual({
			allowedSignersPath: '.github/cloudflare-queue-allowed-signers',
			attestationPath: '/secure/bootstrap.json',
			expectedOperatorPrincipal: PRINCIPAL,
			expectedReleasePhase: 'bootstrap-production',
			expectedReleaseTransactionId: BOOTSTRAP_TRANSACTION_ID,
			expectedSourceSha: SOURCE_SHA,
			minimumValiditySeconds: 72 * 60,
			signaturePath: '/secure/bootstrap.sig'
		});

		const phaseProofArgs = [
			...bootstrapVerifierArgs.slice(0, 12),
			'--state',
			'bootstrap-unchanged',
			...bootstrapVerifierArgs.slice(12)
		].map((value) => (value === String(72 * 60) ? '180' : value));
			expect(parseCloudflareQueueReleasePhaseArgs(phaseProofArgs)).toMatchObject({
			operatorPrincipal: PRINCIPAL,
			releasePhase: 'bootstrap-production',
			releaseTransactionId: BOOTSTRAP_TRANSACTION_ID,
				state: 'bootstrap-unchanged'
			});
			const attachedPhaseProofArgs = phaseProofArgs.map((value) => {
				if (value === 'bootstrap-unchanged') return 'bootstrap-producer-attached';
				if (value === '180') {
					return String(
						CLOUDFLARE_QUEUE_FREE_ENVELOPE_BOOTSTRAP_ATTACHED_PROOF_VALIDITY_SECONDS
					);
				}
				return value;
			});
			expect(parseCloudflareQueueReleasePhaseArgs(attachedPhaseProofArgs)).toMatchObject({
				minimumRemainingValiditySeconds:
					CLOUDFLARE_QUEUE_FREE_ENVELOPE_BOOTSTRAP_ATTACHED_PROOF_VALIDITY_SECONDS,
				state: 'bootstrap-producer-attached'
			});
			for (const args of [
			phaseProofArgs.map((value) => (value === 'bootstrap-unchanged' ? 'active' : value)),
			phaseProofArgs.map((value) =>
				value === BOOTSTRAP_TRANSACTION_ID ? 'not-a-transaction' : value
			),
			phaseProofArgs.map((value) => (value === PRINCIPAL ? 'invalid principal!' : value)),
				phaseProofArgs.map((value) => (value === '180' ? String(72 * 60) : value)),
				attachedPhaseProofArgs.map((value) =>
					value ===
					String(CLOUDFLARE_QUEUE_FREE_ENVELOPE_BOOTSTRAP_ATTACHED_PROOF_VALIDITY_SECONDS)
						? '3600'
						: value
				)
		]) {
			expect(() => parseCloudflareQueueReleasePhaseArgs(args)).toThrow(/Queue/u);
		}

		const invalidBootstrapArguments = [
			bootstrapVerifierArgs.filter((value, index) => index < 14 || index > 15),
			bootstrapVerifierArgs.filter((value, index) => index < 12 || index > 13),
			bootstrapVerifierArgs.map((value) =>
				value === BOOTSTRAP_TRANSACTION_ID ? 'not-a-transaction' : value
			),
			bootstrapVerifierArgs.map((value) => (value === PRINCIPAL ? 'invalid principal!' : value)),
			bootstrapVerifierArgs.map((value) => (value === String(72 * 60) ? '180' : value)),
			[...bootstrapVerifierArgs, '--unknown', 'value']
		];
		for (const args of invalidBootstrapArguments) {
			expect(() => parseCloudflareQueueFreeEnvelopeArgs(args)).toThrow(/Queue Free/u);
		}
		expect(() =>
			parseCloudflareQueueFreeEnvelopeCaptureArgs([
				'--operator-principal',
				PRINCIPAL,
				'--output',
				'/secure/bootstrap.json',
				'--release-phase',
				'bootstrap-production',
				'--source-sha',
				SOURCE_SHA
			])
		).toThrow('transaction id is required');
		expect(() =>
			parseCloudflareQueueFreeEnvelopeCaptureArgs([
				'--operator-principal',
				PRINCIPAL,
				'--output',
				'/secure/activation.json',
				'--release-phase',
				'activate-production',
				'--source-sha',
				SOURCE_SHA,
				'--transaction-id',
				BOOTSTRAP_TRANSACTION_ID
			])
		).toThrow('cannot carry a bootstrap transaction id');
	});
});
