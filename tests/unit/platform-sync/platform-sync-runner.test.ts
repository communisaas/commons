import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { actionNetworkAdapter, mapOsdiPerson } from '$lib/server/platform-sync/action-network';
import {
	ARMED_PLATFORM_SYNC_SOURCES,
	MAX_PAGES_PER_SLICE,
	isArmedPlatformSyncSource,
	runPlatformApiSyncSlice
} from '$lib/server/platform-sync/runner';
import { PlatformSyncError } from '$lib/server/platform-sync/types';
import { getPlatformApiSyncReadiness } from '$lib/server/platform-api-sync-readiness';

const noDelay = () => Promise.resolve();

function osdiPerson(overrides: Record<string, unknown> = {}) {
	return {
		given_name: 'Ada',
		family_name: 'Lovelace',
		email_addresses: [{ address: 'Ada@Example.org', primary: true, status: 'subscribed' }],
		phone_numbers: [{ number: '+15551230000', primary: true, status: 'subscribed' }],
		postal_addresses: [{ primary: true, postal_code: '94110', region: 'CA', country: 'US' }],
		custom_fields: { member_id: 4271, chapter: 'sf' },
		...overrides
	};
}

function osdiResponse(body: Record<string, unknown>, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' }
	});
}

describe('Action Network OSDI person mapping', () => {
	it('maps a subscribed person onto the import pipeline vocabulary', () => {
		const mapped = mapOsdiPerson(osdiPerson());
		expect(mapped).toEqual({
			email: 'ada@example.org',
			name: 'Ada Lovelace',
			phone: '+15551230000',
			postalCode: '94110',
			stateCode: 'CA',
			country: 'US',
			emailStatus: 'subscribed',
			smsStatus: 'subscribed',
			tagIds: [],
			customFields: { member_id: '4271', chapter: 'sf' },
			source: 'action_network'
		});
	});

	it('never fabricates consent provenance from subscription status', () => {
		const mapped = mapOsdiPerson(osdiPerson());
		expect(mapped).not.toHaveProperty('emailConsentSource');
		expect(mapped).not.toHaveProperty('emailConsentText');
		expect(mapped).not.toHaveProperty('emailConsentedAt');
		expect(mapped).not.toHaveProperty('smsConsentSource');
		expect(mapped).not.toHaveProperty('smsConsentText');
	});

	it('maps OSDI subscription states onto emailStatus values the recipient filter understands', () => {
		const status = (s: string) =>
			mapOsdiPerson(
				osdiPerson({ email_addresses: [{ address: 'a@b.c', primary: true, status: s }] })
			)?.emailStatus;
		expect(status('subscribed')).toBe('subscribed');
		expect(status('unsubscribed')).toBe('unsubscribed');
		expect(status('bouncing')).toBe('bounced');
		expect(status('previous bounce')).toBe('bounced');
		expect(status('spam complaint')).toBe('complained');
	});

	it('prefers the primary email and drops people without any usable address', () => {
		const mapped = mapOsdiPerson(
			osdiPerson({
				email_addresses: [
					{ address: 'secondary@example.org', primary: false, status: 'unsubscribed' },
					{ address: 'primary@example.org', primary: true, status: 'subscribed' }
				]
			})
		);
		expect(mapped?.email).toBe('primary@example.org');
		expect(mapOsdiPerson(osdiPerson({ email_addresses: [] }))).toBeNull();
		expect(mapOsdiPerson(osdiPerson({ email_addresses: [{ address: '   ' }] }))).toBeNull();
	});

	it('marks phoneless people smsStatus none and unsubscribed phones honestly', () => {
		expect(mapOsdiPerson(osdiPerson({ phone_numbers: [] }))?.smsStatus).toBe('none');
		expect(
			mapOsdiPerson(
				osdiPerson({ phone_numbers: [{ number: '+15551230000', status: 'unsubscribed' }] })
			)?.smsStatus
		).toBe('unsubscribed');
	});

	it('bounds vendor poison rows to the import pipeline caps instead of aborting the chunk', () => {
		const mapped = mapOsdiPerson(
			osdiPerson({
				given_name: 'A'.repeat(300),
				phone_numbers: [{ number: '+1' + '5'.repeat(60), primary: true, status: 'subscribed' }],
				postal_addresses: [
					{ primary: true, postal_code: '9'.repeat(40), region: 'C'.repeat(20), country: 'USAUSAUSAUSA' }
				],
				custom_fields: Object.fromEntries(
					Array.from({ length: 150 }, (_, i) => [`field_${i}`, 'v'.repeat(5000)])
				)
			})
		);
		expect(mapped?.name?.length).toBeLessThanOrEqual(200);
		expect(mapped?.phone?.length).toBeLessThanOrEqual(32);
		expect(mapped?.postalCode?.length).toBeLessThanOrEqual(16);
		expect(mapped?.stateCode?.length).toBeLessThanOrEqual(8);
		expect(mapped?.country?.length).toBeLessThanOrEqual(8);
		const custom = mapped?.customFields ?? {};
		expect(Object.keys(custom).length).toBeLessThanOrEqual(100);
		for (const value of Object.values(custom)) expect(value.length).toBeLessThanOrEqual(2000);
		expect(JSON.stringify(custom).length).toBeLessThanOrEqual(8192);
		const longKey = mapOsdiPerson(osdiPerson({ custom_fields: { ['k'.repeat(100)]: 'x' } }));
		expect(longKey?.customFields).toBeUndefined();
	});

	it('drops oversized emails instead of letting one row abort the import chunk', () => {
		const mapped = mapOsdiPerson(
			osdiPerson({
				email_addresses: [{ address: 'a'.repeat(260) + '@example.org', primary: true }]
			})
		);
		expect(mapped).toBeNull();
	});
});

describe('Action Network adapter fetch', () => {
	it('sends the OSDI token header and pages forward until total_pages', async () => {
		const fetchImpl = vi.fn(async (url: string) => {
			expect(url).toContain('https://actionnetwork.org/api/v2/people');
			return osdiResponse({
				page: 2,
				total_pages: 3,
				total_records: 70,
				_embedded: { 'osdi:people': [osdiPerson()] }
			});
		}) as unknown as typeof fetch;

		const page = await actionNetworkAdapter.fetchPage('key-123', {
			cursor: '2',
			fetchImpl
		});

		const [, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
		expect((init as RequestInit).headers).toMatchObject({ 'OSDI-API-Token': 'key-123' });
		expect(page.nextCursor).toBe('3');
		expect(page.totalRecords).toBe(70);
		expect(page.records).toHaveLength(1);
	});

	it('returns a null cursor on the final page and applies modified-since filters', async () => {
		const fetchImpl = vi.fn(async (url: string) => {
			expect(decodeURIComponent(url.replace(/\+/g, ' '))).toContain(
				"filter=modified_date gt '2026-06-01T00:00:00.000Z'"
			);
			return osdiResponse({
				page: 3,
				total_pages: 3,
				total_records: 70,
				_embedded: { 'osdi:people': [] }
			});
		}) as unknown as typeof fetch;

		const page = await actionNetworkAdapter.fetchPage('key-123', {
			cursor: '3',
			modifiedSince: '2026-06-01T00:00:00.000Z',
			fetchImpl
		});
		expect(page.nextCursor).toBeNull();
	});

	it('throws typed errors for auth, rate-limit, http, and malformed responses', async () => {
		const respond = (response: Response) =>
			actionNetworkAdapter.fetchPage('key-123', {
				cursor: null,
				fetchImpl: (async () => response) as typeof fetch
			});

		await expect(respond(new Response('', { status: 401 }))).rejects.toMatchObject({
			code: 'auth_failed'
		});
		await expect(respond(new Response('', { status: 429 }))).rejects.toMatchObject({
			code: 'rate_limited'
		});
		await expect(respond(new Response('', { status: 500 }))).rejects.toMatchObject({
			code: 'http_error'
		});
		await expect(respond(new Response('not json', { status: 200 }))).rejects.toMatchObject({
			code: 'malformed_response'
		});
		await expect(respond(osdiResponse({ page: 1 }))).rejects.toMatchObject({
			code: 'malformed_response'
		});
	});

	it('rejects malformed continuation cursors instead of refetching page one', async () => {
		await expect(
			actionNetworkAdapter.fetchPage('key-123', {
				cursor: 'not-a-page',
				fetchImpl: (async () => osdiResponse({})) as typeof fetch
			})
		).rejects.toMatchObject({ code: 'malformed_response' });
	});

	it('parks instead of completing when a populated page is missing pagination metadata', async () => {
		const fetchImpl = (async () =>
			osdiResponse({
				page: 1,
				_embedded: { 'osdi:people': [osdiPerson()] }
			})) as typeof fetch;
		await expect(
			actionNetworkAdapter.fetchPage('key-123', { cursor: null, fetchImpl })
		).rejects.toMatchObject({ code: 'malformed_response' });
	});

	it('refuses non-ISO modifiedSince values at the filter sink', async () => {
		await expect(
			actionNetworkAdapter.fetchPage('key-123', {
				cursor: null,
				modifiedSince: "x' or sneaky",
				fetchImpl: (async () => osdiResponse({})) as typeof fetch
			})
		).rejects.toMatchObject({ code: 'malformed_response' });
	});

	it('counts vendor rows without an email as dropped instead of silently shrinking the page', async () => {
		const fetchImpl = (async () =>
			osdiResponse({
				page: 1,
				total_pages: 1,
				total_records: 2,
				_embedded: { 'osdi:people': [osdiPerson(), osdiPerson({ email_addresses: [] })] }
			})) as typeof fetch;

		const page = await actionNetworkAdapter.fetchPage('key-123', { cursor: null, fetchImpl });
		expect(page.records).toHaveLength(1);
		expect(page.droppedNoEmail).toBe(1);
	});
});

describe('bounded sync slice runner', () => {
	it('fetches at most MAX_PAGES_PER_SLICE pages and persists the continuation cursor', async () => {
		let calls = 0;
		const fetchImpl = (async () => {
			calls += 1;
			return osdiResponse({
				page: calls,
				total_pages: 10,
				total_records: 250,
				_embedded: { 'osdi:people': [osdiPerson()] }
			});
		}) as typeof fetch;

		const slice = await runPlatformApiSyncSlice({
			source: 'action_network',
			apiKey: 'key-123',
			checkpoint: null,
			fetchImpl,
			delayImpl: noDelay
		});

		expect(slice.pagesFetched).toBe(MAX_PAGES_PER_SLICE);
		expect(slice.records).toHaveLength(MAX_PAGES_PER_SLICE);
		expect(slice.nextCursor).toBe(String(MAX_PAGES_PER_SLICE + 1));
		expect(slice.totalRecords).toBe(250);
	});

	it('resumes from a checkpoint and stops early when the platform runs out of pages', async () => {
		const pages: string[] = [];
		const fetchImpl = (async (url: string) => {
			const page = new URL(url).searchParams.get('page') ?? '1';
			pages.push(page);
			return osdiResponse({
				page: Number(page),
				total_pages: 9,
				total_records: 220,
				_embedded: { 'osdi:people': [osdiPerson()] }
			});
		}) as typeof fetch;

		const slice = await runPlatformApiSyncSlice({
			source: 'action_network',
			apiKey: 'key-123',
			checkpoint: '8',
			fetchImpl,
			delayImpl: noDelay
		});

		expect(pages).toEqual(['8', '9']);
		expect(slice.nextCursor).toBeNull();
		expect(slice.pagesFetched).toBe(2);
	});

	it('refuses sources without an armed adapter', async () => {
		await expect(
			runPlatformApiSyncSlice({
				source: 'everyaction',
				apiKey: 'key-123',
				checkpoint: null,
				delayImpl: noDelay
			})
		).rejects.toBeInstanceOf(PlatformSyncError);
	});

	it('spaces vendor page fetches to respect the platform rate limit', async () => {
		const delayImpl = vi.fn(noDelay);
		const fetchImpl = (async () =>
			osdiResponse({
				page: 1,
				total_pages: 3,
				total_records: 75,
				_embedded: { 'osdi:people': [osdiPerson()] }
			})) as typeof fetch;

		await runPlatformApiSyncSlice({
			source: 'action_network',
			apiKey: 'key-123',
			checkpoint: null,
			fetchImpl,
			delayImpl,
			maxPages: 2
		});
		expect(delayImpl).toHaveBeenCalledTimes(1);
	});
});

describe('platform API sync readiness contract', () => {
	it('arms the runner for registered adapters only, holding every other profile', () => {
		const readiness = getPlatformApiSyncReadiness({ credentialCustodyReady: true });
		expect(readiness.runnerImplemented).toBe(true);
		expect(readiness.armedAdapterSources).toContain('action_network');
		expect(ARMED_PLATFORM_SYNC_SOURCES).toContain('action_network');
		expect(isArmedPlatformSyncSource('action_network')).toBe(true);
		expect(isArmedPlatformSyncSource('everyaction')).toBe(false);
		expect(readiness.heldAdapterSources).toContain('everyaction');
		expect(readiness.heldAdapterSources).not.toContain('action_network');
		expect(readiness.ready).toBe(true);
		expect(readiness.message).toContain('tag/list sync stays gated');
	});

	it('stays fail-closed without credential custody', () => {
		const readiness = getPlatformApiSyncReadiness({ credentialCustodyReady: false });
		expect(readiness.ready).toBe(false);
		expect(readiness.missing).toContain('encrypted credential custody');
		expect(readiness.message).toContain('CSV export intake remains the live migration path');
	});

	it('reports the held-runner posture when the runner flag is overridden off', () => {
		const readiness = getPlatformApiSyncReadiness({
			credentialCustodyReady: true,
			runnerImplemented: false
		});
		expect(readiness.ready).toBe(false);
		expect(readiness.armedAdapterSources).toEqual([]);
		expect(readiness.missing).toEqual(
			expect.arrayContaining(['direct sync execution', 'continuation checkpointing'])
		);
	});

	it('does not claim ready when the runner exists but no adapter is armed', () => {
		const readiness = getPlatformApiSyncReadiness({
			credentialCustodyReady: true,
			armedAdapterSources: []
		});
		expect(readiness.ready).toBe(false);
		expect(readiness.missing).toContain('at least one armed platform adapter');
	});
});

describe('platform import route contract (source-text pins)', () => {
	const routeSource = readFileSync(
		join(process.cwd(), 'src/routes/org/[slug]/supporters/import/platform-api/+page.server.ts'),
		'utf-8'
	);
	const convexSource = readFileSync(join(process.cwd(), 'convex/organizations.ts'), 'utf-8');

	it('gates the import verb per adapter before opening any credential', () => {
		const importAction = routeSource.slice(routeSource.indexOf('import: async'));
		const gateIndex = importAction.indexOf('isArmedPlatformSyncSource(profile.source)');
		const openIndex = importAction.indexOf('openPlatformApiCredential');
		expect(gateIndex).toBeGreaterThan(-1);
		expect(openIndex).toBeGreaterThan(-1);
		expect(gateIndex).toBeLessThan(openIndex);
		expect(importAction).toContain('return fail(424, platformApiBoundaryPayload(readiness));');
	});

	it('hands records to the existing encrypted import pipeline in bounded chunks', () => {
		expect(routeSource).toContain('const IMPORT_CHUNK_SIZE = 100;');
		expect(routeSource).toContain('serverAction(api.supporters.importWithEncryption');
		expect(routeSource).toContain('slice.records.slice(i, i + IMPORT_CHUNK_SIZE)');
	});

	it('persists continuation state and marks failures without losing the checkpoint', () => {
		expect(routeSource).toContain('api.organizations.recordPlatformApiSyncProgress');
		expect(routeSource).toContain('api.organizations.completePlatformApiSync');
		expect(routeSource).toContain('api.organizations.failPlatformApiSync');
		expect(routeSource).toContain(
			"Boolean(sync.checkpoint) && (sync.status === 'running' || sync.status === 'failed')"
		);
	});

	it('returns 409 on claim contention instead of an unhandled 500', () => {
		const importAction = routeSource.slice(routeSource.indexOf('import: async'));
		expect(importAction).toContain("code: 'platform_api_sync_claim_failed'");
		expect(importAction).toContain('return fail(409, {');
	});

	it('persists capped row errors so the stored-errors panel has durable backing', () => {
		expect(routeSource).toContain('const persistedRowErrors = rowErrors.slice(0, 20)');
		expect(convexSource).toContain('rowErrors: v.optional(v.array(v.string()))');
	});

	it('reclaims stale running rows and protects terminal states from losing racers', () => {
		expect(convexSource).toContain('const STALE_SYNC_CLAIM_MS = 10 * 60 * 1000;');
		const failBlock = convexSource.slice(
			convexSource.indexOf('export const failPlatformApiSync = mutation')
		);
		expect(failBlock.slice(0, 1200)).toContain("if (existing.status !== 'running') {");
		expect(failBlock.slice(0, 1200)).toContain('return { failed: false, ignored: true };');
	});

	it('keeps custody probes from clobbering a parked or resumable run', () => {
		const probeBlock = convexSource.slice(
			convexSource.indexOf('export const recordPlatformApiCredentialProbe = mutation')
		);
		expect(probeBlock.slice(0, 2400)).toContain('const runParked =');
		expect(probeBlock.slice(0, 2400)).toContain(
			"existing.status === 'running' || (existing.status === 'failed' && !!existing.checkpoint)"
		);
	});

	it('keeps sync-state mutations editor-gated in Convex', () => {
		for (const fn of [
			'startPlatformApiSync',
			'recordPlatformApiSyncProgress',
			'completePlatformApiSync',
			'failPlatformApiSync'
		]) {
			const block = convexSource.slice(convexSource.indexOf(`export const ${fn} = mutation`));
			expect(block.slice(0, 1200)).toContain("requireOrgRole(ctx, ");
		}
	});

	it('sets the incremental watermark from the run start, not the completion time', () => {
		const completeBlock = convexSource.slice(
			convexSource.indexOf('export const completePlatformApiSync = mutation')
		);
		expect(completeBlock.slice(0, 1600)).toContain('lastSyncAt: existing.startedAt ?? completedAt');
	});
});
