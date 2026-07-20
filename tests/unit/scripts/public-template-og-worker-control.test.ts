import { describe, expect, it, vi } from 'vitest';

import {
	capturePublicTemplateOgWorkers,
	restorePublicTemplateOgWorker,
	validatePublicTemplateOgWorkerCapture
} from '../../../scripts/manage-public-template-og-workers.mjs';

const priorVersion = 'a'.repeat(32);
const failedVersion = 'b'.repeat(32);
const priorSha = 'c'.repeat(40);
const failedSha = 'd'.repeat(40);
const queueId = 'e'.repeat(32);
const failedTransactionId = '123456789-2';
const priorTransactionId = '123456788-1';

function releaseMessage(transactionId: string) {
	return `commons-release-v1 transaction=${transactionId} gate=${'f'.repeat(40)} artifact=${'a'.repeat(64)} component=og-consumer realm=preview`;
}

function response(value: unknown, status = 200) {
	return new Response(JSON.stringify(value), {
		status,
		headers: { 'Content-Type': 'application/json' }
	});
}

function presentWorker() {
	return response({ success: true, result: { bindings: [] } });
}

function absentWorker() {
	return response({ success: false, errors: [{ code: 10090 }] }, 404);
}

function completeQueueInventory() {
	return response({
		success: true,
		result: [{ queue_name: 'commons-public-template-og-nonprod', queue_id: queueId }],
		result_info: { count: 1, page: 1, per_page: 100, total_count: 1, total_pages: 1 }
	});
}

describe('public-template OG Worker release control', () => {
	it('captures exact active versions and explicit absent state', async () => {
		const fetchFn = vi
			.fn()
			.mockResolvedValueOnce(presentWorker())
			.mockResolvedValueOnce(absentWorker());
		const spawnFn = vi.fn((_: string, args: string[]) => {
			if (args[0] === 'deployments') {
				return { status: 0, stdout: JSON.stringify({ versions: [{ percentage: 100, version_id: priorVersion }] }), stderr: '' };
			}
			return { status: 0, stdout: JSON.stringify({ id: priorVersion, annotations: { 'workers/tag': priorSha } }), stderr: '' };
		});

		await expect(
			capturePublicTemplateOgWorkers({
				accountId: 'account',
				apiToken: 'token',
				realms: ['preview', 'production'],
				wranglerPath: '/pinned/wrangler',
				fetchFn: fetchFn as typeof fetch,
				spawnFn: spawnFn as never
			})
		).resolves.toEqual({
			schemaVersion: 1,
			workers: [
				{
					realm: 'preview',
					name: 'commons-public-template-og-nonprod',
					existed: true,
					versionId: priorVersion,
					releaseSha: priorSha,
					releaseTransaction: null
				},
				{
					realm: 'production',
					name: 'commons-public-template-og',
					existed: false
				}
			]
		});
		expect(spawnFn).toHaveBeenCalledTimes(2);
		expect(fetchFn.mock.calls.every(([, init]) => init?.redirect === 'error')).toBe(true);
	});

	it('restores the exact captured version when a prior Worker existed', async () => {
		let currentVersion = failedVersion;
		let currentSha = failedSha;
		let currentTransaction = failedTransactionId;
		const spawnFn = vi.fn((_: string, args: string[]) => {
			if (args[0] === 'rollback') {
				currentVersion = priorVersion;
				currentSha = priorSha;
				currentTransaction = priorTransactionId;
				return { status: 0, stdout: 'ok', stderr: '' };
			}
			if (args[0] === 'deployments') {
				return { status: 0, stdout: JSON.stringify({ versions: [{ percentage: 100, version_id: currentVersion }] }), stderr: '' };
			}
			return { status: 0, stdout: JSON.stringify({ id: currentVersion, annotations: { 'workers/tag': currentSha, 'workers/message': releaseMessage(currentTransaction) } }), stderr: '' };
		});

		await expect(
			restorePublicTemplateOgWorker({
				accountId: 'account',
				apiToken: 'token',
				capture: {
					schemaVersion: 1,
					workers: [{ realm: 'preview', name: 'commons-public-template-og-nonprod', existed: true, versionId: priorVersion, releaseSha: priorSha, releaseTransaction: priorTransactionId }]
				},
				realm: 'preview',
				failedSourceSha: failedSha,
				failedTransactionId,
				wranglerPath: '/pinned/wrangler',
				fetchFn: vi.fn().mockResolvedValue(presentWorker()) as typeof fetch,
				spawnFn: spawnFn as never
			})
		).resolves.toEqual({
			realm: 'preview',
			worker: 'commons-public-template-og-nonprod',
			restoredVersionId: priorVersion,
			deleted: false
		});
		expect(spawnFn.mock.calls.some(([, args]) => args[0] === 'rollback' && args[1] === priorVersion)).toBe(true);
	});

	it('deletes a newly created Worker only after its Queue consumer is detached', async () => {
		const order: string[] = [];
		const fetchFn = vi.fn(async (url: string | URL | Request) => {
			const target = String(url);
			if (target.endsWith('/settings') && !order.includes('spawn:delete')) {
				order.push('fetch:settings-present');
				return presentWorker();
			}
			if (target.includes('/queues?')) {
				order.push('fetch:inventory');
				return completeQueueInventory();
			}
			if (target.endsWith('/consumers')) {
				order.push('fetch:consumers');
				return response({ success: true, result: [] });
			}
			order.push(`fetch:absent:${target.endsWith('/subdomain') ? 'subdomain' : 'settings'}`);
			return absentWorker();
		});
		const spawnFn = vi.fn((_: string, args: string[]) => {
			if (args[0] === 'delete') {
				order.push('spawn:delete');
				return { status: 0, stdout: 'deleted', stderr: '' };
			}
			if (args[0] === 'deployments') {
				return { status: 0, stdout: JSON.stringify({ versions: [{ percentage: 100, version_id: failedVersion }] }), stderr: '' };
			}
			return { status: 0, stdout: JSON.stringify({ id: failedVersion, annotations: { 'workers/tag': failedSha, 'workers/message': releaseMessage(failedTransactionId) } }), stderr: '' };
		});

		await expect(
			restorePublicTemplateOgWorker({
				accountId: 'account',
				apiToken: 'token',
				capture: {
					schemaVersion: 1,
					workers: [{ realm: 'preview', name: 'commons-public-template-og-nonprod', existed: false }]
				},
				realm: 'preview',
				failedSourceSha: failedSha,
				failedTransactionId,
				wranglerPath: '/pinned/wrangler',
				fetchFn: fetchFn as typeof fetch,
				spawnFn: spawnFn as never
			})
		).resolves.toMatchObject({ deleted: true });
		expect(order.indexOf('fetch:consumers')).toBeLessThan(order.indexOf('spawn:delete'));
		expect(order).toContain('fetch:absent:settings');
		expect(order).toContain('fetch:absent:subdomain');
	});

	it('refuses to delete a new Worker while a Queue consumer remains attached', async () => {
		const fetchFn = vi.fn(async (url: string | URL | Request) => {
			const target = String(url);
			if (target.endsWith('/settings')) return presentWorker();
			if (target.includes('/queues?')) return completeQueueInventory();
			return response({ success: true, result: [{ consumer_id: 'still-attached' }] });
		});
		const spawnFn = vi.fn((_: string, args: string[]) => {
			if (args[0] === 'deployments') {
				return { status: 0, stdout: JSON.stringify({ versions: [{ percentage: 100, version_id: failedVersion }] }), stderr: '' };
			}
			return { status: 0, stdout: JSON.stringify({ id: failedVersion, annotations: { 'workers/tag': failedSha, 'workers/message': releaseMessage(failedTransactionId) } }), stderr: '' };
		});

		await expect(
			restorePublicTemplateOgWorker({
				accountId: 'account',
				apiToken: 'token',
				capture: {
					schemaVersion: 1,
					workers: [{ realm: 'preview', name: 'commons-public-template-og-nonprod', existed: false }]
				},
				realm: 'preview',
				failedSourceSha: failedSha,
				failedTransactionId,
				wranglerPath: '/pinned/wrangler',
				fetchFn: fetchFn as typeof fetch,
				spawnFn: spawnFn as never
			})
		).rejects.toThrow(/cannot be deleted until its Queue consumer is detached/);
		expect(spawnFn.mock.calls.some(([, args]) => args[0] === 'delete')).toBe(false);
	});

	it('refuses same-SHA rollback when a newer transaction owns the Worker', async () => {
		const newerTransactionId = '123456790-1';
		const spawnFn = vi.fn((_: string, args: string[]) => {
			if (args[0] === 'deployments') {
				return { status: 0, stdout: JSON.stringify({ versions: [{ percentage: 100, version_id: failedVersion }] }), stderr: '' };
			}
			return {
				status: 0,
				stdout: JSON.stringify({
					id: failedVersion,
					annotations: {
						'workers/tag': failedSha,
						'workers/message': releaseMessage(newerTransactionId)
					}
				}),
				stderr: ''
			};
		});

		await expect(
			restorePublicTemplateOgWorker({
				accountId: 'account',
				apiToken: 'token',
				capture: {
					schemaVersion: 1,
					workers: [{ realm: 'preview', name: 'commons-public-template-og-nonprod', existed: false }]
				},
				realm: 'preview',
				failedSourceSha: failedSha,
				failedTransactionId,
				wranglerPath: '/pinned/wrangler',
				fetchFn: vi.fn().mockResolvedValue(presentWorker()) as typeof fetch,
				spawnFn: spawnFn as never
			})
		).rejects.toThrow(/PUBLIC_TEMPLATE_OG_RELEASE_SUPERSEDED/);
		expect(spawnFn.mock.calls.some(([, args]) => args[0] === 'delete' || args[0] === 'rollback')).toBe(false);
	});

	it('rejects crossed realm names in rollback evidence', () => {
		expect(() =>
			validatePublicTemplateOgWorkerCapture({
				schemaVersion: 1,
				workers: [{ realm: 'preview', name: 'commons-public-template-og', existed: false }]
			})
		).toThrow(/identity/);
	});
});
