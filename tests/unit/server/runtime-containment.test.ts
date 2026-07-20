import { describe, expect, it, vi } from 'vitest';
import {
	decideRuntimeContainmentRequest,
	dispatchRuntimeRequest,
	runtimeContainmentResponse
} from '$lib/server/runtime-containment';
import hooksSource from '../../../src/hooks.server.ts?raw';
import {
	PUBLIC_DISCOVERY_BOOTSTRAP_BOUNDARY_HEADER,
	PUBLIC_DISCOVERY_BOOTSTRAP_BOUNDARY_PROTOCOL,
	PUBLIC_DISCOVERY_BOOTSTRAP_LEASE_HEADER,
	PUBLIC_DISCOVERY_BOOTSTRAP_PATH,
	PUBLIC_DISCOVERY_BOOTSTRAP_PROVENANCE_HEADER,
	PUBLIC_DISCOVERY_BOOTSTRAP_PURPOSE
} from '$lib/server/public-discovery-bootstrap-runtime';

function input(pathname: string, method = 'GET', resolve = vi.fn()) {
	const request = new Request(`https://commons.email${pathname}`, { method });
	const event = { request, url: new URL(request.url) };
	return {
		input: { event, resolve },
		resolve
	};
}

function bootstrapInput(extraHeaders: HeadersInit = {}) {
	const sourceSha = 'a'.repeat(40);
	const transactionId = '123456789-1';
	const request = new Request(`https://commons.email${PUBLIC_DISCOVERY_BOOTSTRAP_PATH}`, {
		body: '{}',
		headers: {
			'content-type': 'application/json',
			'x-commons-candidate-origin-host': 'pages-origin.commons.email',
			'x-commons-edge-public-host': 'commons.email',
			'x-commons-edge-release-sha': sourceSha,
			'x-commons-edge-release-transaction': transactionId,
			'x-expected-release-sha': sourceSha,
			'x-expected-release-transaction': transactionId,
			'x-forwarded-host': 'commons.email',
			'x-forwarded-proto': 'https',
			'x-public-discovery-refresh-purpose': 'deploy-seed',
			[PUBLIC_DISCOVERY_BOOTSTRAP_BOUNDARY_HEADER]:
				PUBLIC_DISCOVERY_BOOTSTRAP_BOUNDARY_PROTOCOL,
			[PUBLIC_DISCOVERY_BOOTSTRAP_LEASE_HEADER]:
				'00000000-0000-4000-8000-000000000077',
			[PUBLIC_DISCOVERY_BOOTSTRAP_PROVENANCE_HEADER]: PUBLIC_DISCOVERY_BOOTSTRAP_PURPOSE,
			...extraHeaders
		},
		method: 'POST'
	});
	const resolve = vi.fn();
	return { input: { event: { request, url: new URL(request.url) }, resolve }, resolve };
}

describe('runtime containment boundary', () => {
	it.each([
		['GET', '/'],
		['GET', '/api/templates'],
		['GET', '/api/health'],
		['POST', '/api/live'],
		['POST', '/api/containment-readiness'],
		['GET', '/api/live/'],
		['GET', '/api/containment-readiness/']
	])('intercepts %s %s before routing or application hooks', async (method, pathname) => {
		const route = input(pathname, method);
		const application = vi.fn();

		const response = await dispatchRuntimeRequest(route.input as never, application, 'maintenance');

		expect(response.status).toBe(503);
		expect(route.resolve).not.toHaveBeenCalled();
		expect(application).not.toHaveBeenCalled();
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(response.headers.get('cdn-cache-control')).toBe('no-store');
		expect(response.headers.get('cloudflare-cdn-cache-control')).toBe('no-store');
		await expect(response.json()).resolves.toEqual({
			status: 'maintenance',
			mode: 'containment',
			code: 'SERVICE_CONTAINMENT'
		});
	});

	it.each(['/api/live', '/api/containment-readiness'])(
		'allows only the I/O-free GET/HEAD route %s directly to SvelteKit routing',
		async (pathname) => {
			for (const method of ['GET', 'HEAD']) {
				const expected = new Response(null, { status: 204 });
				const resolve = vi.fn().mockResolvedValue(expected);
				const route = input(pathname, method, resolve);
				const application = vi.fn();

				const response = await dispatchRuntimeRequest(route.input as never, application, 'maintenance');

				expect(response).toBe(expected);
				expect(resolve).toHaveBeenCalledOnce();
				expect(application).not.toHaveBeenCalled();
			}
		}
	);

	it('uses the normal application chain when containment is disabled', async () => {
		const route = input('/api/templates');
		const expected = new Response(null, { status: 202 });
		const application = vi.fn().mockResolvedValue(expected);

		const response = await dispatchRuntimeRequest(route.input as never, application, 'disabled');

		expect(response).toBe(expected);
		expect(application).toHaveBeenCalledOnce();
		expect(route.resolve).not.toHaveBeenCalled();
		expect(decideRuntimeContainmentRequest(route.input.event.request, 'disabled')).toBe(
			'application'
		);
	});

	it('admits only an adapter-attested production bootstrap tuple through maintenance', async () => {
		const route = bootstrapInput();
		const expected = new Response(null, { status: 202 });
		const application = vi.fn().mockResolvedValue(expected);

		const response = await dispatchRuntimeRequest(route.input as never, application, 'maintenance');

		expect(response).toBe(expected);
		expect(application).toHaveBeenCalledOnce();
		expect(decideRuntimeContainmentRequest(route.input.event.request, 'maintenance')).toBe(
			'bootstrap-route'
		);

		const forged = bootstrapInput({ [PUBLIC_DISCOVERY_BOOTSTRAP_BOUNDARY_HEADER]: 'forged' });
		const denied = await dispatchRuntimeRequest(
			forged.input as never,
			vi.fn(),
			'maintenance'
		);
		expect(denied.status).toBe(503);
	});

	it('returns one deterministic maintenance representation', async () => {
		const first = runtimeContainmentResponse();
		const second = runtimeContainmentResponse();
		expect(await first.text()).toBe(await second.text());
		expect(first.headers.get('retry-after')).toBe('60');
		expect(first.headers.get('x-commons-runtime-mode')).toBe('containment');
	});

	it('keeps containment outside Convex initialization and the application sequence', () => {
		expect(hooksSource).toContain('const applicationHandle = sequence(');
		expect(hooksSource).not.toContain('export const handle = sequence(');
		expect(hooksSource).toContain('export const handle: Handle = (input) =>');
		expect(hooksSource).toContain('dispatchRuntimeRequest(input, applicationHandle)');
		const sequence = hooksSource.slice(hooksSource.indexOf('const applicationHandle = sequence('));
		expect(sequence.indexOf('handlePublicDiscoveryManifestRefreshCapability,')).toBeLessThan(
			sequence.indexOf('handleConvexInitialization,')
		);
	});
});
