import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
	refreshAllPublicDiscoveryManifests,
	refreshPublicDiscoveryManifest,
	type PublicDiscoveryManifestCronEnv
} from '../../../workers/public-discovery-manifest-cron';
import cronWorkerSource from '../../../workers/public-discovery-manifest-cron.ts?raw';

const ENDPOINT = 'https://commons.email/api/internal/public-discovery-manifest-refresh';
const NONPROD_ENDPOINT =
	'https://staging.commons.email/api/internal/public-discovery-manifest-refresh';
const GATE_PROTOCOL_HEADER = 'x-public-discovery-refresh-gate-protocol';

function successfulRefreshResponse(): Response {
	return Response.json(
		{
			list: { ready: true, retiredRevision: 4, revision: 5, withdrawalEpoch: 2 },
			ok: true,
			relations: { ready: true, retiredRevision: 7, revision: 8, withdrawalEpoch: 3 }
		},
		{ headers: { [GATE_PROTOCOL_HEADER]: '3' }, status: 200 }
	);
}

function env(secret: string): PublicDiscoveryManifestCronEnv {
	return {
		DISCOVERY_MANIFEST_REFRESH_SECRET: secret,
		PUBLIC_DISCOVERY_MANIFEST_REFRESH_URL: ENDPOINT
	};
}

describe('public-discovery manifest cron Worker', () => {
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		fetchMock = vi.fn().mockImplementation(async () => successfulRefreshResponse());
		vi.stubGlobal('fetch', fetchMock);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('sends only the active outbound generation during a non-atomic rotation', async () => {
		const active = 'active-'.padEnd(64, 'a');
		const previous = 'previous-'.padEnd(64, 'p');
		const rotatingEnv = {
			...env(active),
			// A mistakenly supplied receiver-only binding must never be selected.
			DISCOVERY_MANIFEST_REFRESH_SECRET_PREVIOUS: previous
		};

		await refreshPublicDiscoveryManifest(rotatingEnv);

		expect(fetchMock).toHaveBeenCalledOnce();
		const [input, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
		expect(String(input)).toBe(ENDPOINT);
		const headers = new Headers(init.headers);
		expect(headers.get('x-public-discovery-manifest-refresh-secret')).toBe(active);
		expect(init.redirect).toBe('error');
		expect(JSON.stringify(init)).not.toContain(previous);
	});

	it('enforces a 32-byte UTF-8 floor before making a request', async () => {
		await expect(refreshPublicDiscoveryManifest(env('x'.repeat(31)))).rejects.toThrow(
			'DISCOVERY_MANIFEST_REFRESH_SECRET_NOT_CONFIGURED'
		);
		expect(fetchMock).not.toHaveBeenCalled();

		await expect(refreshPublicDiscoveryManifest(env('é'.repeat(16)))).resolves.toBeUndefined();
		expect(fetchMock).toHaveBeenCalledOnce();
	});

	it('does not read or reflect a secret-bearing failure body', async () => {
		const active = 'active-'.padEnd(64, 'a');
		const previous = 'previous-'.padEnd(64, 'p');
		const response = new Response(`${active}:${previous}`, { status: 503 });
		const text = vi.spyOn(response, 'text');
		fetchMock.mockResolvedValueOnce(response);

		let failure: unknown;
		try {
			await refreshPublicDiscoveryManifest(env(active));
		} catch (error) {
			failure = error;
		}

		expect(failure).toBeInstanceOf(Error);
		const message = failure instanceof Error ? failure.message : String(failure);
		expect(message).toBe('PUBLIC_DISCOVERY_MANIFEST_CRON_FAILED:503');
		expect(message).not.toContain(active);
		expect(message).not.toContain(previous);
		expect(text).not.toHaveBeenCalled();
	});

	it('treats the endpoint gate\'s 202 coalescing response as a failed scheduled attempt', async () => {
		fetchMock.mockResolvedValueOnce(
			new Response(null, { headers: { 'retry-after': '60' }, status: 202 })
		);

		await expect(
			refreshPublicDiscoveryManifest(env('active-'.padEnd(64, 'a')))
		).rejects.toThrow('PUBLIC_DISCOVERY_MANIFEST_CRON_FAILED:202');
		expect(fetchMock).toHaveBeenCalledOnce();
	});

	it('fails closed when a 200 omits the gate protocol or a valid refresh result', async () => {
		fetchMock
			.mockResolvedValueOnce(Response.json({ ok: true }, { status: 200 }))
			.mockResolvedValueOnce(
				Response.json(
					{ list: {}, ok: true, relations: {} },
					{ headers: { [GATE_PROTOCOL_HEADER]: '3' }, status: 200 }
				)
			);

		await expect(
			refreshPublicDiscoveryManifest(env('active-'.padEnd(64, 'a')))
		).rejects.toThrow('PUBLIC_DISCOVERY_MANIFEST_CRON_GATE_PROTOCOL_INVALID');
		await expect(
			refreshPublicDiscoveryManifest(env('active-'.padEnd(64, 'a')))
		).rejects.toThrow('PUBLIC_DISCOVERY_MANIFEST_CRON_RESULT_INVALID');
	});

	it('rejects legacy, malformed, or incoherent family authority as writer success proof', async () => {
		const result = {
			list: { ready: true, retiredRevision: 4, revision: 5, withdrawalEpoch: 2 },
			ok: true,
			relations: { ready: true, retiredRevision: 7, revision: 8, withdrawalEpoch: 3 }
		};
		const response = (body: unknown) =>
			Response.json(body, {
				headers: { [GATE_PROTOCOL_HEADER]: '3' },
				status: 200
			});
		fetchMock
			.mockResolvedValueOnce(
				response({ ...result, list: { ready: true, retiredRevision: 4, revision: 5 } })
			)
			.mockResolvedValueOnce(
				response({ ...result, relations: { ...result.relations, withdrawalEpoch: 1.5 } })
			)
			.mockResolvedValueOnce(
				response({ ...result, list: { ...result.list, withdrawalEpoch: -1 } })
			)
			.mockResolvedValueOnce(
				response({ ...result, list: { ...result.list, retiredRevision: 5 } })
			)
			.mockResolvedValueOnce(
				response({
					...result,
					relations: { ...result.relations, ready: false, retiredRevision: 7 }
				})
			);

		for (let attempt = 0; attempt < 5; attempt += 1) {
			await expect(
				refreshPublicDiscoveryManifest(env('active-'.padEnd(64, 'a')))
			).rejects.toThrow('PUBLIC_DISCOVERY_MANIFEST_CRON_RESULT_INVALID');
		}
	});

	it('refreshes production and the shared non-production backend in one scheduled cycle', async () => {
		const prodSecret = 'prod-active-'.padEnd(64, 'a');
		const nonprodSecret = 'nonprod-active-'.padEnd(64, 'n');
		await refreshAllPublicDiscoveryManifests({
			...env(prodSecret),
			DISCOVERY_MANIFEST_REFRESH_SECRET_NONPROD: nonprodSecret,
			PUBLIC_DISCOVERY_MANIFEST_REFRESH_URL_NONPROD: NONPROD_ENDPOINT
		});

		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(new Set(fetchMock.mock.calls.map(([input]) => String(input)))).toEqual(
			new Set([ENDPOINT, NONPROD_ENDPOINT])
		);
		const secretsByEndpoint = new Map(
			fetchMock.mock.calls.map(([input, init]) => [
				String(input),
				new Headers(init.headers).get('x-public-discovery-manifest-refresh-secret')
			])
		);
		expect(secretsByEndpoint.get(ENDPOINT)).toBe(prodSecret);
		expect(secretsByEndpoint.get(NONPROD_ENDPOINT)).toBe(nonprodSecret);
	});

	it('reports one realm failure only after attempting both isolated realms', async () => {
		fetchMock
			.mockResolvedValueOnce(new Response(null, { status: 503 }))
			.mockImplementationOnce(async () => successfulRefreshResponse());
		await expect(
			refreshAllPublicDiscoveryManifests({
				...env('prod-active-'.padEnd(64, 'a')),
				DISCOVERY_MANIFEST_REFRESH_SECRET_NONPROD: 'nonprod-active-'.padEnd(64, 'n'),
				PUBLIC_DISCOVERY_MANIFEST_REFRESH_URL_NONPROD: NONPROD_ENDPOINT
			})
		).rejects.toThrow('PUBLIC_DISCOVERY_MANIFEST_CRON_REALM_FAILURE:0');
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('relies on the endpoint gate instead of creating a second cadence authority', () => {
		expect(cronWorkerSource).not.toContain('DurableObject');
		expect(cronWorkerSource).not.toContain('idFromName');
	});
});
