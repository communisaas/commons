import { describe, expect, it } from 'vitest';
import {
	PUBLIC_TEMPLATE_OG_PAGES_PROJECT,
	PUBLIC_TEMPLATE_OG_QUEUE_BINDING,
	PUBLIC_TEMPLATE_OG_REALMS,
	validatePublicTemplateOgDeployment,
	validatePublicTemplateOgOperationBudget
} from '../../../scripts/verify-public-template-og-deployment.mjs';

const sourceSha = 'a'.repeat(40);
const versionId = 'b'.repeat(32);
const transactionId = '1753014600000-8';

function inputs(realm: 'preview' | 'production' = 'preview'): any {
	const expected = PUBLIC_TEMPLATE_OG_REALMS[realm];
	const consumer = {
		consumer_id: 'consumer-1',
		type: 'worker',
		script_name: expected.worker,
		queue_name: expected.queue,
		dead_letter_queue: expected.deadLetterQueue,
		settings: {
			batch_size: 1,
			max_concurrency: 1,
			max_retries: 2,
			max_wait_time_ms: 1000,
			retry_delay: 120
		}
	};
	return {
		realm,
		expectedSourceSha: sourceSha,
		expectedTransactionId: transactionId,
		producerPosture: 'bound' as const,
		queueInventory: {
			success: true,
			result_info: { count: 2, page: 1, per_page: 100, total_count: 2, total_pages: 1 },
			result: [
				{
					queue_id: 'c'.repeat(32),
					queue_name: expected.queue,
					settings: {
						delivery_delay: 0,
						delivery_paused: false,
						message_retention_period: 86_400
					},
					producers: [{ type: 'worker', script: 'opaque-pages-worker-id' }],
					producers_total_count: 1,
					consumers: [{ consumer_id: consumer.consumer_id }],
					consumers_total_count: 1
				},
				{
					queue_id: 'd'.repeat(32),
					queue_name: expected.deadLetterQueue,
					settings: {
						delivery_delay: 0,
						delivery_paused: false,
						message_retention_period: 86_400
					},
					producers: [],
					producers_total_count: 0,
					consumers: [],
					consumers_total_count: 0
				}
			]
		},
		queueConsumers: { success: true, result: [consumer] },
		queueMetrics: {
			success: true,
			result: { backlog_bytes: 0, backlog_count: 0, oldest_message_timestamp_ms: 0 }
		},
		deadLetterQueueConsumers: { success: true, result: [] },
		deadLetterQueueMetrics: {
			success: true,
			result: { backlog_bytes: 0, backlog_count: 0, oldest_message_timestamp_ms: 0 }
		},
		pagesProject: {
			success: true,
			result: {
				name: PUBLIC_TEMPLATE_OG_PAGES_PROJECT,
				deployment_configs: {
					[realm]: {
						queue_producers: {
							[PUBLIC_TEMPLATE_OG_QUEUE_BINDING]: { name: expected.queue }
						}
					}
				}
			}
		},
		workerSettings: {
			result: {
				limits: { cpu_ms: 100 },
				bindings: [
					{
						name: 'PUBLIC_CONVEX_URL',
						type: 'plain_text',
						text: expected.publicConvexUrl
					},
					{
						name: 'PUBLIC_DISCOVERY_R2',
						type: 'r2_bucket',
						bucket_name: expected.bucket
					},
					{
						name: 'PUBLIC_RELEASE_SHA',
						type: 'plain_text',
						text: sourceSha
					},
					{
						name: 'PUBLIC_RELEASE_TRANSACTION_ID',
						type: 'plain_text',
						text: transactionId
					}
				]
			}
		},
		workerSubdomain: { result: { enabled: false, previews_enabled: false } },
		activeDeployment: {
			versions: [{ percentage: 100, version_id: versionId }]
		},
		activeVersion: {
			id: versionId,
			annotations: { 'workers/tag': sourceSha }
		}
	};
}

describe('public-template OG Queue deployment proof', () => {
	it('consumes the shared projected D/D+1/D+2 operation ledger', () => {
		expect(validatePublicTemplateOgOperationBudget()).toEqual({
			model: 'deterministic-admission-projection-v1',
			currentDayOperationsPerMessage: 9,
			nextDayOperationsPerMessage: 8,
			secondDayOperationsPerMessage: 2,
			projectedOperationsPerRealmDayMax: 2_500,
			emptyLedgerDailyMessageAttemptsPerRealmMax: 277,
			twoRealmAdmissionProjectionOperationsPerDay: 5_000,
			actualQueueOperationsGuaranteed: false
		});
	});

	it.each(['preview', 'production'] as const)(
		'accepts the exact private %s consumer, queue/DLQ, bindings, and SHA version',
		(realm) => {
			expect(validatePublicTemplateOgDeployment(inputs(realm))).toMatchObject({
				realm,
				releaseSha: sourceSha,
				releaseTransactionId: transactionId,
				versionId,
				producerBound: true
			});
		}
	);

	it('allows no producer only before first Pages binding and requires Pages afterward', () => {
		const compatible = inputs();
		compatible.producerPosture = 'compatible';
		compatible.queueInventory.result[0].producers = [];
		compatible.queueInventory.result[0].producers_total_count = 0;
		compatible.pagesProject.result.deployment_configs.preview.queue_producers = {};
		expect(validatePublicTemplateOgDeployment(compatible).producerBound).toBe(false);
		compatible.producerPosture = 'bound';
		expect(() => validatePublicTemplateOgDeployment(compatible)).toThrow(/must have its exact Pages producer/i);
	});

	it('rejects crossed/extra bindings, direct DLQ authority, and public Worker routes', () => {
		const crossed = inputs();
		crossed.workerSettings.result.bindings[1].bucket_name =
			PUBLIC_TEMPLATE_OG_REALMS.production.bucket;
		expect(() => validatePublicTemplateOgDeployment(crossed)).toThrow(/R2 bucket binding is crossed/i);

		const directDlq = inputs();
		directDlq.queueInventory.result[1].producers.push({
			type: 'r2_bucket',
			bucket_name: 'rogue'
		} as never);
		directDlq.queueInventory.result[1].producers_total_count = 1;
		expect(() => validatePublicTemplateOgDeployment(directDlq)).toThrow(/unexpected direct producer/i);

		const delayed = inputs();
		delayed.queueInventory.result[0].settings.delivery_delay = 1;
		expect(() => validatePublicTemplateOgDeployment(delayed)).toThrow(/zero delay/i);

		const dlqBacklog = inputs();
		dlqBacklog.deadLetterQueueMetrics.result.backlog_count = 1;
		expect(() => validatePublicTemplateOgDeployment(dlqBacklog)).toThrow(/holds activation/i);

		const sourceBacklog = inputs();
		sourceBacklog.queueMetrics.result.backlog_bytes = 1;
		expect(() => validatePublicTemplateOgDeployment(sourceBacklog)).toThrow(/holds activation/i);

		const publicWorker = inputs();
		publicWorker.workerSubdomain.result.enabled = true;
		expect(() => validatePublicTemplateOgDeployment(publicWorker)).toThrow(/disable workers\.dev/i);

		const expensiveWorker = inputs();
		expensiveWorker.workerSettings.result.limits.cpu_ms = 101;
		expect(() => validatePublicTemplateOgDeployment(expensiveWorker)).toThrow(
			/CPU limit must be exactly 100 ms/i
		);
	});

	it('accepts staged paused delivery only when explicitly requested', () => {
		const staged = inputs();
		staged.deliveryPosture = 'paused';
		staged.queueInventory.result[0].settings.delivery_paused = true;
		staged.queueInventory.result[1].settings.delivery_paused = true;
		expect(validatePublicTemplateOgDeployment(staged)).toMatchObject({
			deliveryPosture: 'paused',
			cpuMillisecondsMax: 100
		});
	});

	it('rejects budget drift, inconsistent authority counts, and a non-exact active version', () => {
		const retries = inputs();
		retries.queueConsumers.result[0].settings.max_retries = 5;
		expect(() => validatePublicTemplateOgDeployment(retries)).toThrow(/work budget is not exact/i);

		const counts = inputs();
		counts.queueInventory.result[0].consumers_total_count = 2;
		expect(() => validatePublicTemplateOgDeployment(counts)).toThrow(/counts are inconsistent/i);

		const pagesDisagreement = inputs();
		pagesDisagreement.pagesProject.result.deployment_configs.preview.queue_producers = {};
		expect(() => validatePublicTemplateOgDeployment(pagesDisagreement)).toThrow(
			/disagrees with the exact Pages binding/i
		);

		const version = inputs();
		version.activeVersion.annotations['workers/tag'] = 'e'.repeat(40);
		expect(() => validatePublicTemplateOgDeployment(version)).toThrow(/exact source SHA/i);

		const transaction = inputs();
		transaction.workerSettings.result.bindings.find(
			(binding: { name: string }) => binding.name === 'PUBLIC_RELEASE_TRANSACTION_ID'
		).text = '1753014600000-9';
		expect(() => validatePublicTemplateOgDeployment(transaction)).toThrow(
			/release transaction binding is not exact/i
		);
	});
});
