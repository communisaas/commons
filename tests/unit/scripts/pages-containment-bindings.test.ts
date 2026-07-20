import { describe, expect, it, vi } from 'vitest';

import {
	parsePagesContainmentBindingArgs,
	validatePagesContainmentBindings,
	verifyPagesContainmentBindings
} from '../../../scripts/verify-pages-containment-bindings.mjs';

function pagesProject(environment: 'preview' | 'production', overrides: Record<string, unknown> = {}) {
	return {
		result: {
			deployment_configs: {
				[environment]: {
					env_vars: {
						INTERNAL_API_SECRET: { type: 'secret_text' },
						SESSION_COOKIE_SIGNING_SECRET: { type: 'secret_text' },
						SESSION_CREATION_SECRET: { type: 'secret_text' }
					},
					...overrides
				}
			}
		}
	};
}

describe('Pages containment binding proof', () => {
	it.each(['preview', 'production'] as const)(
		'accepts a binding-free %s config with secret-only authentication material',
		(environment) => {
			expect(
				validatePagesContainmentBindings({ pagesProject: pagesProject(environment), environment })
			).toEqual({
				environment,
				bindingCount: 0,
				plainTextVariableCount: 0,
				secretCount: 3
			});
		}
	);

	it.each([
		['R2', { r2_buckets: { PUBLIC_DISCOVERY_R2: { name: 'cache' } } }],
		['Durable Object', { durable_object_namespaces: { GATE: { namespace_id: 'id' } } }],
		['KV', { kv_namespaces: { SESSION: { namespace_id: 'id' } } }],
		['D1', { d1_databases: { DB: { id: 'id' } } }],
		['service', { services: { API: { service: 'api' } } }],
		['queue', { queue_producers: { JOBS: { name: 'jobs' } } }]
	])('rejects a retained %s capability', (_label, override) => {
		expect(() =>
			validatePagesContainmentBindings({
				pagesProject: pagesProject('production', override),
				environment: 'production'
			})
		).toThrow(/must have no/i);
	});

	it('rejects retained plain-text environment variables', () => {
		expect(() =>
			validatePagesContainmentBindings({
				pagesProject: pagesProject('preview', {
					env_vars: {
						INTERNAL_API_SECRET: { type: 'secret_text' },
						PUBLIC_CONVEX_URL: { type: 'plain_text', value: 'https://example.invalid' }
					}
				}),
				environment: 'preview'
			})
		).toThrow(/must not retain plain-text variable PUBLIC_CONVEX_URL/i);
	});

	it('fetches only the Pages project control-plane endpoint', async () => {
		const fetchFn = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
			new Response(JSON.stringify(pagesProject('production')), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			})
		);
		await expect(
			verifyPagesContainmentBindings({
				accountId: 'account',
				apiToken: 'token',
				environment: 'production',
				fetchFn
			})
		).resolves.toMatchObject({ environment: 'production', bindingCount: 0 });
		expect(fetchFn).toHaveBeenCalledTimes(1);
		expect(String(fetchFn.mock.calls[0][0])).toMatch(/\/pages\/projects\/communique-site$/);
		expect(fetchFn.mock.calls[0][1]?.redirect).toBe('error');
	});

	it('parses only one exact Pages environment', () => {
		expect(parsePagesContainmentBindingArgs(['--environment', 'preview'])).toEqual({
			environment: 'preview'
		});
		expect(() => parsePagesContainmentBindingArgs([])).toThrow(/preview or production/i);
		expect(() =>
			parsePagesContainmentBindingArgs(['--environment', 'preview', '--environment', 'production'])
		).toThrow(/only once/i);
	});
});
