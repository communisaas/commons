import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	activatePublicTemplateOgQueues,
	capturePublicTemplateOgQueues,
	provisionPublicTemplateOgQueues,
	restorePublicTemplateOgQueues,
	validatePublicTemplateOgQueueCapture
} from '../../../scripts/manage-public-template-og-queues.mjs';
import { PUBLIC_TEMPLATE_OG_REALMS } from '../../../scripts/verify-public-template-og-deployment.mjs';

const accountId = 'account';
const apiToken = 'token';

function json(value: unknown, status = 200) {
	return new Response(JSON.stringify(value), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

describe('public-template OG Queue control', () => {
	it('captures absence, provisions both resources, then detaches only the new consumer on rollback', async () => {
		const expected = PUBLIC_TEMPLATE_OG_REALMS.preview;
		const queues = new Map<
			string,
			{
				queue_id: string;
				settings: {
					delivery_delay: number;
					delivery_paused: boolean;
					message_retention_period: number;
				};
			}
		>();
		const deleteUrls: string[] = [];
		let consumerAttached = true;
		const fetchFn = async (input: string | URL | Request, init?: RequestInit) => {
			expect(init?.redirect).toBe('error');
			const url = String(input);
			const method = init?.method ?? 'GET';
			if (url.endsWith('/queues?per_page=100&page=1')) {
				return json({
					success: true,
					result_info: {
						count: queues.size,
						page: 1,
						per_page: 100,
						total_count: queues.size,
						total_pages: 1
					},
					result: [...queues].map(([queue_name, value]) => ({ queue_name, ...value }))
				});
			}
			if (url.endsWith('/queues') && method === 'POST') {
				const body = JSON.parse(String(init?.body));
				queues.set(body.queue_name, {
					queue_id: body.queue_name === expected.queue ? 'a'.repeat(32) : 'b'.repeat(32),
					settings: {
						delivery_delay: 0,
						delivery_paused: false,
						message_retention_period: 86_400
					}
				});
				return json({ success: true, result: { queue_name: body.queue_name } });
			}
			if (method === 'PUT' && /\/queues\/[a-f0-9]{32}$/u.test(url)) {
				const body = JSON.parse(String(init?.body));
				queues.get(body.queue_name)!.settings = body.settings;
				return json({ success: true, result: { queue_name: body.queue_name } });
			}
			if (url.endsWith(`/queues/${'a'.repeat(32)}/consumers`) && method === 'GET') {
				return json({
					success: true,
					result: consumerAttached
						? [
						{
							consumer_id: 'consumer-new',
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
						}
						]
						: []
				});
			}
			if (url.endsWith(`/queues/${'b'.repeat(32)}/consumers`) && method === 'GET') {
				return json({ success: true, result: [] });
			}
			if (url.endsWith(`/queues/${'a'.repeat(32)}/metrics`)) {
				return json({
					success: true,
					result: {
						backlog_bytes: 64,
						backlog_count: 1,
						oldest_message_timestamp_ms: 123
					}
				});
			}
			if (url.endsWith(`/queues/${'b'.repeat(32)}/metrics`)) {
				return json({
					success: true,
					result: {
						backlog_bytes: 0,
						backlog_count: 0,
						oldest_message_timestamp_ms: 0
					}
				});
			}
			if (method === 'DELETE') {
				deleteUrls.push(url);
				consumerAttached = false;
				return json({ success: true, result: null });
			}
			throw new Error(`Unexpected mock request: ${method} ${url}`);
		};

		const capture = await capturePublicTemplateOgQueues({
			accountId,
			apiToken,
			realms: ['preview'],
			fetchFn: fetchFn as typeof fetch
		});
		expect(capture.realms[0]).toMatchObject({
			queue: { name: expected.queue, existed: false },
			deadLetterQueue: { name: expected.deadLetterQueue, existed: false }
		});
		await provisionPublicTemplateOgQueues({
			accountId,
			apiToken,
			capture,
			fetchFn: fetchFn as typeof fetch
		});
		expect([...queues.keys()].sort()).toEqual(
			[expected.queue, expected.deadLetterQueue].sort()
		);
		expect([...queues.values()].every((queue) => queue.settings.delivery_paused)).toBe(true);
		const restored = await restorePublicTemplateOgQueues({
			accountId,
			apiToken,
			capture,
			fetchFn: fetchFn as typeof fetch
		});
		expect(restored).toMatchObject({
			queuesDeleted: 0,
			restored: [
				{
					backlogAfterRollback: { backlogCount: 1 },
					consumerRestored: false,
					consumerStateVerified: true,
					queueIdPreserved: true,
					settingsRestored: true
				}
			]
		});
		expect(deleteUrls).toHaveLength(1);
		expect(deleteUrls[0]).toContain('/consumers/consumer-new');
	});

	it('restores pre-existing queue/DLQ settings and proves their identities and backlog survive', async () => {
		const expected = PUBLIC_TEMPLATE_OG_REALMS.preview;
		const queueId = 'c'.repeat(32);
		const dlqId = 'd'.repeat(32);
		const resources = new Map([
			[
				expected.queue,
				{
					queue_id: queueId,
					settings: {
						delivery_delay: 5,
						delivery_paused: true,
						message_retention_period: 86_400
					}
				}
			],
			[
				expected.deadLetterQueue,
				{
					queue_id: dlqId,
					settings: {
						delivery_delay: 7,
						delivery_paused: true,
						message_retention_period: 86_400
					}
				}
			]
		]);
		const putSettings: Array<{ queueId: string; settings: Record<string, unknown> }> = [];
		let consumerAttached = true;
		let currentConsumerId = 'release-consumer';
		const consumerMutations: string[] = [];
		const consumer = {
			consumer_id: currentConsumerId,
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
		const fetchFn = async (input: string | URL | Request, init?: RequestInit) => {
			const url = String(input);
			const method = init?.method ?? 'GET';
			if (url.endsWith('/queues?per_page=100&page=1')) {
				return json({
					success: true,
					result_info: {
						count: 2,
						page: 1,
						per_page: 100,
						total_count: 2,
						total_pages: 1
					},
					result: [...resources].map(([queue_name, value]) => ({ queue_name, ...value }))
				});
			}
			if (method === 'PUT' && /\/queues\/[a-f0-9]{32}$/u.test(url)) {
				const queueResourceId = url.split('/').at(-1)!;
				const body = JSON.parse(String(init?.body));
				const entry = resources.get(body.queue_name)!;
				entry.settings = body.settings;
				putSettings.push({ queueId: queueResourceId, settings: body.settings });
				return json({ success: true, result: { queue_id: queueResourceId } });
			}
			if (url.endsWith(`/queues/${queueId}/consumers`) && method === 'GET') {
				return json({
					success: true,
					result: consumerAttached ? [{ ...consumer, consumer_id: currentConsumerId }] : []
				});
			}
			if (url.endsWith(`/queues/${dlqId}/consumers`) && method === 'GET') {
				return json({ success: true, result: [] });
			}
			if (url.endsWith(`/queues/${queueId}/metrics`)) {
				return json({
					success: true,
					result: {
						backlog_bytes: 192,
						backlog_count: 3,
						oldest_message_timestamp_ms: 123
					}
				});
			}
			if (url.endsWith(`/queues/${dlqId}/metrics`)) {
				return json({
					success: true,
					result: {
						backlog_bytes: 128,
						backlog_count: 2,
						oldest_message_timestamp_ms: 456
					}
				});
			}
			if (method === 'DELETE' && url.includes('/consumers/')) {
				consumerMutations.push(`DELETE ${url.split('/').at(-1)}`);
				consumerAttached = false;
				return json({ success: true, result: null });
			}
			if (method === 'PUT' && url.includes('/consumers/')) {
				currentConsumerId = decodeURIComponent(url.split('/').at(-1)!);
				consumerAttached = true;
				consumerMutations.push(`PUT ${currentConsumerId}`);
				return json({ success: true, result: { consumer_id: currentConsumerId } });
			}
			throw new Error(`Unexpected mock request: ${method} ${url}`);
		};

		const capture = await capturePublicTemplateOgQueues({
			accountId,
			apiToken,
			realms: ['preview'],
			fetchFn: fetchFn as typeof fetch
		});
		expect(capture.realms[0]).toMatchObject({
			queue: { settings: { deliveryDelay: 5, deliveryPaused: true } },
			deadLetterQueue: { settings: { deliveryDelay: 7, deliveryPaused: true } }
		});
		await provisionPublicTemplateOgQueues({
			accountId,
			apiToken,
			capture,
			fetchFn: fetchFn as typeof fetch
		});
		expect(resources.get(expected.queue)?.settings).toMatchObject({
			delivery_delay: 0,
			delivery_paused: true
		});
		await activatePublicTemplateOgQueues({
			accountId,
			apiToken,
			capture,
			realm: 'preview',
			fetchFn: fetchFn as typeof fetch
		});
		expect(resources.get(expected.queue)?.settings.delivery_paused).toBe(false);
		expect(resources.get(expected.deadLetterQueue)?.settings.delivery_paused).toBe(false);
		consumerAttached = true;
		currentConsumerId = 'replacement-consumer';
		const restored = await restorePublicTemplateOgQueues({
			accountId,
			apiToken,
			capture,
			fetchFn: fetchFn as typeof fetch
		});

		expect(resources.get(expected.queue)?.settings).toMatchObject({
			delivery_delay: 5,
			delivery_paused: true
		});
		expect(resources.get(expected.deadLetterQueue)?.settings).toMatchObject({
			delivery_delay: 7,
			delivery_paused: true
		});
		expect(putSettings).toHaveLength(6);
		expect(consumerMutations).toEqual([
			'DELETE replacement-consumer',
			'PUT release-consumer'
		]);
		expect(currentConsumerId).toBe('release-consumer');
		expect(restored).toMatchObject({
			queuesDeleted: 0,
			restored: [
				{
					deadLetterBacklogAfterRollback: { backlogCount: 2 },
					deadLetterQueueIdPreserved: true,
					consumerIdRestored: true,
					queueIdPreserved: true,
					settingsRestored: true
				}
			]
		});
	});

	it.each(['queue', 'deadLetterQueue'] as const)(
		'preserves and safely restores a partially provisioned %s without requiring its companion',
		async (presentResource) => {
			const expected = PUBLIC_TEMPLATE_OG_REALMS.preview;
			const name =
				presentResource === 'queue' ? expected.queue : expected.deadLetterQueue;
			const id = presentResource === 'queue' ? 'e'.repeat(32) : 'f'.repeat(32);
			let consumerAttached = presentResource === 'queue';
			const resource = {
				queue_id: id,
				settings: {
					delivery_delay: 0,
					delivery_paused: false,
					message_retention_period: 86_400
				}
			};
			const fetchFn = async (input: string | URL | Request, init?: RequestInit) => {
				const url = String(input);
				const method = init?.method ?? 'GET';
				if (url.endsWith('/queues?per_page=100&page=1')) {
					return json({
						success: true,
						result: [{ queue_name: name, ...resource }],
						result_info: { count: 1, page: 1, per_page: 100, total_count: 1, total_pages: 1 }
					});
				}
				if (method === 'PUT' && url.endsWith(`/queues/${id}`)) {
					resource.settings = JSON.parse(String(init?.body)).settings;
					return json({ success: true, result: { queue_id: id } });
				}
				if (url.endsWith(`/queues/${id}/consumers`) && method === 'GET') {
					return json({
						success: true,
						result: consumerAttached
							? [{
									consumer_id: 'partial-consumer',
									type: 'worker',
									script_name: expected.worker,
									queue_name: expected.queue,
									dead_letter_queue: expected.deadLetterQueue,
									settings: { batch_size: 1, max_concurrency: 1, max_retries: 2, max_wait_time_ms: 1000, retry_delay: 120 }
								}]
							: []
					});
				}
				if (url.endsWith(`/queues/${id}/metrics`)) {
					return json({ success: true, result: { backlog_bytes: 32, backlog_count: 1, oldest_message_timestamp_ms: 123 } });
				}
				if (method === 'DELETE' && url.endsWith('/consumers/partial-consumer')) {
					consumerAttached = false;
					return json({ success: true, result: null });
				}
				throw new Error(`Unexpected mock request: ${method} ${url}`);
			};
			const capture = {
				schemaVersion: 2 as const,
				realms: [{
					realm: 'preview' as const,
					queue: { name: expected.queue, existed: false as const },
					deadLetterQueue: { name: expected.deadLetterQueue, existed: false as const }
				}]
			};

			const result = await restorePublicTemplateOgQueues({
				accountId,
				apiToken,
				capture,
				fetchFn: fetchFn as typeof fetch
			});
			expect(resource.settings.delivery_paused).toBe(true);
			expect(result.queuesDeleted).toBe(0);
			expect(result.restored[0]).toMatchObject({
				queuePresent: presentResource === 'queue',
				deadLetterQueuePresent: presentResource === 'deadLetterQueue',
				consumerStateVerified: true
			});
		}
	);

	it('rejects a malformed capture and contains no Queue resource deletion path', () => {
		expect(() =>
			validatePublicTemplateOgQueueCapture({ schemaVersion: 2, realms: [] })
		).toThrow(/realms are invalid/i);
		const source = readFileSync('scripts/manage-public-template-og-queues.mjs', 'utf8');
		expect(source).not.toMatch(/method:\s*'DELETE'[\s\S]{0,300}?\/queues[`'"]?\s*[,}]/u);
		expect(source).toContain('queuesDeleted: 0');
	});
});
