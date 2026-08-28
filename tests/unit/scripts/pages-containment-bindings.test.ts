import { describe, expect, it, vi } from 'vitest';

import {
	parsePagesContainmentBindingArgs,
	validatePagesContainmentBindings,
	verifyPagesContainmentBindings
} from '../../../scripts/verify-pages-containment-bindings.mjs';

function pagesProject(
	environment: 'preview' | 'production',
	overrides: Record<string, unknown> = {}
) {
	return {
		result: {
			canonical_deployment: { id: '11111111-1111-4111-8111-111111111111' },
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

function activeDeployment(providerCapability = false) {
	return {
		result: {
			id: '11111111-1111-4111-8111-111111111111',
			environment: 'production',
			env_vars: {
				INTERNAL_API_SECRET: { type: 'secret_text' },
				...(providerCapability ? { GEMINI_API_KEY: { type: 'secret_text' } } : {})
			}
		}
	};
}

describe('Pages containment binding proof', () => {
	it.each(['preview', 'production'] as const)(
		'accepts a binding-free %s config with secret-only authentication material',
		(environment) => {
			expect(
				validatePagesContainmentBindings({
					activeDeployment: environment === 'production' ? activeDeployment() : undefined,
					pagesProject: pagesProject(environment),
					environment
				})
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
				activeDeployment: activeDeployment(),
				pagesProject: pagesProject('production', override),
				environment: 'production'
			})
		).toThrow(/must have no/i);
	});

	it('rejects provider capability in either project defaults or the immutable canonical', () => {
		const projectCapability = pagesProject('production', {
			env_vars: { GEMINI_API_KEY: { type: 'secret_text' } }
		});
		expect(() =>
			validatePagesContainmentBindings({
				activeDeployment: activeDeployment(),
				environment: 'production',
				pagesProject: projectCapability
			})
		).toThrow(/provider capability GEMINI_API_KEY/i);
		expect(() =>
			validatePagesContainmentBindings({
				activeDeployment: activeDeployment(true),
				environment: 'production',
				pagesProject: pagesProject('production')
			})
		).toThrow(/immutable containment.*GEMINI_API_KEY/i);
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

	it('fetches the project and exact immutable production deployment', async () => {
		const fetchFn = vi.fn(
			async (input: RequestInfo | URL, _init?: RequestInit) =>
				new Response(
					JSON.stringify(
						String(input).includes('/deployments/')
							? activeDeployment()
							: pagesProject('production')
					),
					{
						status: 200,
						headers: { 'content-type': 'application/json' }
					}
				)
		);
		await expect(
			verifyPagesContainmentBindings({
				accountId: 'account',
				apiToken: 'token',
				environment: 'production',
				fetchFn
			})
		).resolves.toMatchObject({ environment: 'production', bindingCount: 0 });
		expect(fetchFn).toHaveBeenCalledTimes(2);
		expect(String(fetchFn.mock.calls[0][0])).toMatch(/\/pages\/projects\/communique-site$/);
		expect(String(fetchFn.mock.calls[1][0])).toContain(
			'/deployments/11111111-1111-4111-8111-111111111111'
		);
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
