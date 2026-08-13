import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
	PAGES_KV_NAMESPACE_IDS,
	PAID_PROVIDER_OPERATOR_BINDING,
	PAID_PROVIDER_RUNTIME_SECRET_BINDINGS,
	PUBLIC_DISCOVERY_GATE_BINDING,
	PUBLIC_DISCOVERY_GATE_CLASS,
	PUBLIC_DISCOVERY_GATE_CONFIGURATIONS,
	PUBLIC_DISCOVERY_GATE_WORKERS,
	PUBLIC_DISCOVERY_R2_BUCKETS,
	PUBLIC_TEMPLATE_OG_QUEUES,
	validatePublicDiscoveryGateCustomDomains,
	validatePagesDurableObjectBinding as validatePagesDurableObjectBindingRaw,
	validatePagesRuntimeCompatibility
} from '../../../scripts/verify-pages-durable-object-binding.mjs';
import {
	PAGES_FINALIZER_COMPATIBILITY_DATE,
	PAGES_FINALIZER_COMPATIBILITY_FLAGS
} from '../../../scripts/finalize-pages-release-artifact.mjs';

const TRANSACTION_ID = '123456789-2';
const PAGES_DEPLOYMENT_ID = '11111111-1111-4111-8111-111111111111';

function validatePagesDurableObjectBinding(
	input: Omit<Parameters<typeof validatePagesDurableObjectBindingRaw>[0], 'expectedTransactionId'>
) {
	return validatePagesDurableObjectBindingRaw({ ...input, expectedTransactionId: TRANSACTION_ID });
}

const namespaceId = 'refresh-production';
const workBudgetNamespaceId = 'work-budget-production';
const runtimeCompatibility = {
	compatibility_date: PAGES_FINALIZER_COMPATIBILITY_DATE,
	compatibility_flags: [...PAGES_FINALIZER_COMPATIBILITY_FLAGS]
};

function workerSettings(id = namespaceId, environment: 'preview' | 'production' = 'production') {
	const authority = PUBLIC_DISCOVERY_GATE_CONFIGURATIONS[environment];
	return {
		result: {
			bindings: [
				{
					name: PUBLIC_DISCOVERY_GATE_BINDING,
					type: 'durable_object_namespace',
					class_name: PUBLIC_DISCOVERY_GATE_CLASS,
					namespace_id: id
				},
				{ name: 'RELEASE_AUTHORITY_HOST', type: 'plain_text', text: authority.host },
				{ name: 'RELEASE_AUTHORITY_REALM', type: 'plain_text', text: authority.realm },
				{ name: 'RELEASE_CONTROL_SECRET', type: 'secret_text' }
			]
		}
	};
}

const privateSubdomain = {
	result: { enabled: false, previews_enabled: false }
};

function inertPreviewEnv() {
	return {
		ATLAS_BASE_URL: { type: 'plain_text', value: 'https://atlas.commons.email/v1' },
		EXPECTED_CELL_MAP_DEPTH: { type: 'plain_text', value: '22' },
		EXPECTED_CELL_MAP_ROOT: { type: 'plain_text', value: `0x${'a'.repeat(64)}` },
		PUBLIC_CONVEX_URL: {
			type: 'plain_text',
			value: 'https://outstanding-firefly-831.convex.cloud'
		},
		PUBLIC_RELEASE_TRANSACTION_ID: { type: 'plain_text', value: TRANSACTION_ID },
		PUBLIC_SCROLL_RPC_URL: { type: 'plain_text', value: 'https://rpc.scroll.io' },
		VITE_ATLAS_BASE_URL: { type: 'plain_text', value: 'https://atlas.commons.email/v1' }
	};
}

function pagesProject({
	productionNamespace = namespaceId,
	productionWorkBudgetNamespace = workBudgetNamespaceId,
	productionBucket = PUBLIC_DISCOVERY_R2_BUCKETS.production,
	productionKv = PAGES_KV_NAMESPACE_IDS.production
} = {}) {
	const kvBindings = (ids: Record<string, string>) =>
		Object.fromEntries(
			Object.entries(ids).map(([binding, namespace_id]) => [binding, { namespace_id }])
		);
	return {
		result: {
			deployment_configs: {
				production: {
					...runtimeCompatibility,
					fail_open: false,
					env_vars: {
						INTERNAL_API_SECRET: { type: 'secret_text' },
						INTERNAL_API_SECRET_PREVIOUS: { type: 'secret_text' },
						[PAID_PROVIDER_OPERATOR_BINDING]: { type: 'secret_text' },
						PUBLIC_RELEASE_TRANSACTION_ID: {
							type: 'plain_text',
							value: TRANSACTION_ID
						}
					},
					durable_object_namespaces: {
						[PUBLIC_DISCOVERY_GATE_BINDING]: { namespace_id: productionNamespace },
						CONVEX_WORK_BUDGET: { namespace_id: productionWorkBudgetNamespace }
					},
					r2_buckets: {
						PUBLIC_DISCOVERY_R2: { name: productionBucket }
					},
					kv_namespaces: kvBindings(productionKv),
					queue_producers: {
						PUBLIC_TEMPLATE_OG_QUEUE: { name: PUBLIC_TEMPLATE_OG_QUEUES.production }
					}
				},
				preview: {
					...runtimeCompatibility,
					fail_open: false,
					env_vars: inertPreviewEnv(),
					durable_object_namespaces: {},
					r2_buckets: {},
					kv_namespaces: {},
					queue_producers: {}
				}
			}
		}
	};
}

function pagesDeployment() {
	return {
		result: {
			environment: 'production',
			env_vars: {
				...Object.fromEntries(
					PAID_PROVIDER_RUNTIME_SECRET_BINDINGS.map((name) => [name, { type: 'secret_text' }])
				),
				[PAID_PROVIDER_OPERATOR_BINDING]: { type: 'secret_text' }
			},
			id: PAGES_DEPLOYMENT_ID
		}
	};
}

function proofInput(project = pagesProject()) {
	return {
		deploymentId: PAGES_DEPLOYMENT_ID,
		pagesDeployment: pagesDeployment(),
		workerSettingsByEnvironment: { production: workerSettings() },
		workerSubdomainByEnvironment: { production: privateSubdomain },
		pagesProject: project
	};
}

describe('Pages external Durable Object binding proof', () => {
	it('pins source and live Pages runtime compatibility to the trusted finalizer tuple', () => {
		const source = readFileSync('wrangler.toml', 'utf8');
		expect(source.match(/^compatibility_date\s*=/gmu)).toHaveLength(1);
		expect(source).toContain(`compatibility_date = "${PAGES_FINALIZER_COMPATIBILITY_DATE}"`);
		expect(source.match(/^compatibility_flags\s*=/gmu)).toHaveLength(1);
		expect(source).toContain(
			`compatibility_flags = [${PAGES_FINALIZER_COMPATIBILITY_FLAGS.map((flag) => `"${flag}"`).join(', ')}]`
		);
		expect(
			validatePagesRuntimeCompatibility(
				pagesProject().result.deployment_configs.production,
				'production'
			)
		).toEqual({
			compatibilityDate: PAGES_FINALIZER_COMPATIBILITY_DATE,
			compatibilityFlags: PAGES_FINALIZER_COMPATIBILITY_FLAGS
		});

		const wrongDate = pagesProject();
		wrongDate.result.deployment_configs.production.compatibility_date = '2025-03-31';
		expect(() =>
			validatePagesDurableObjectBinding({
				...proofInput(wrongDate),
				environment: 'production'
			})
		).toThrow(/compatibility date/i);

		for (const flags of [
			['nodejs_compat', 'nodejs_als'],
			[...PAGES_FINALIZER_COMPATIBILITY_FLAGS, 'unsafe_extra_flag'],
			['nodejs_compat', 'nodejs_als', 'nodejs_als', 'global_fetch_strictly_public']
		]) {
			const drifted = pagesProject();
			drifted.result.deployment_configs.preview.compatibility_flags = flags;
			expect(() =>
				validatePagesDurableObjectBinding({
					...proofInput(drifted),
					environment: 'preview'
				})
			).toThrow(/compatibility flags/i);
		}
	});

	it('accepts only the inert preview and exact production capability sets', () => {
		expect(validatePagesDurableObjectBinding({ ...proofInput(), environment: 'preview' })).toEqual({
			environment: 'preview',
			failOpen: false,
			inert: true,
			releaseProbeSecretBound: false,
			releaseTransactionId: TRANSACTION_ID
		});
		expect(
			validatePagesDurableObjectBinding({ ...proofInput(), environment: 'production' })
		).toMatchObject({
			environment: 'production',
			namespaceId,
			previewInert: true,
			r2Bucket: PUBLIC_DISCOVERY_R2_BUCKETS.production,
			worker: PUBLIC_DISCOVERY_GATE_WORKERS.production
		});
	});

	it('rejects a missing production config, wrong gate namespace, or public Worker route', () => {
		const missing = pagesProject();
		Reflect.deleteProperty(missing.result.deployment_configs, 'production');
		expect(() =>
			validatePagesDurableObjectBinding({ ...proofInput(missing), environment: 'production' })
		).toThrow(/production deployment config is missing/i);

		expect(() =>
			validatePagesDurableObjectBinding({
				...proofInput(pagesProject({ productionNamespace: 'wrong-namespace' })),
				environment: 'production'
			})
		).toThrow(/does not match/i);

		expect(() =>
			validatePagesDurableObjectBinding({
				...proofInput(),
				workerSubdomainByEnvironment: {
					production: { result: { enabled: true, previews_enabled: false } }
				},
				environment: 'production'
			})
		).toThrow(/disable workers\.dev/i);
	});

	it('rejects every non-probe preview capability, including inherited state', () => {
		for (const mutate of [
			(project: ReturnType<typeof pagesProject>) => {
				Object.assign(project.result.deployment_configs.preview.durable_object_namespaces, {
					CONVEX_WORK_BUDGET: { namespace_id: workBudgetNamespaceId }
				});
			},
			(project: ReturnType<typeof pagesProject>) => {
				Object.assign(project.result.deployment_configs.preview.queue_producers, {
					PUBLIC_TEMPLATE_OG_QUEUE: { name: PUBLIC_TEMPLATE_OG_QUEUES.preview }
				});
			},
			(project: ReturnType<typeof pagesProject>) => {
				Object.assign(project.result.deployment_configs.preview.r2_buckets, {
					PUBLIC_DISCOVERY_R2: { name: PUBLIC_DISCOVERY_R2_BUCKETS.preview }
				});
			},
			(project: ReturnType<typeof pagesProject>) => {
				Object.assign(project.result.deployment_configs.preview.kv_namespaces, {
					DC_SESSION_KV: { namespace_id: PAGES_KV_NAMESPACE_IDS.preview.DC_SESSION_KV }
				});
			},
			(project: ReturnType<typeof pagesProject>) => {
				Object.assign(project.result.deployment_configs.preview, {
					services: { LEGACY_PROVIDER: { service: 'legacy' } }
				});
			}
		]) {
			const project = pagesProject();
			mutate(project);
			expect(() =>
				validatePagesDurableObjectBinding({ ...proofInput(project), environment: 'preview' })
			).toThrow(/inert probe must have no/i);
		}
	});

	it('rejects inherited secrets, an edge-only probe authority, and credential-bearing URLs', () => {
		const inherited = pagesProject();
		Object.assign(inherited.result.deployment_configs.preview.env_vars, {
			INTERNAL_API_SECRET: { type: 'secret_text' }
		});
		expect(() =>
			validatePagesDurableObjectBinding({ ...proofInput(inherited), environment: 'preview' })
		).toThrow(/exact inert probe allowlist/i);

		const probeAuthority = pagesProject();
		Object.assign(probeAuthority.result.deployment_configs.preview.env_vars, {
			RELEASE_PROBE_SECRET: { type: 'secret_text' }
		});
		expect(() =>
			validatePagesDurableObjectBinding({ ...proofInput(probeAuthority), environment: 'preview' })
		).toThrow(/exact inert probe allowlist/i);

		const credentials = pagesProject();
		credentials.result.deployment_configs.preview.env_vars.PUBLIC_CONVEX_URL.value =
			'https://operator:token@example.com';
		expect(() =>
			validatePagesDurableObjectBinding({ ...proofInput(credentials), environment: 'preview' })
		).toThrow(/credential-free HTTPS/i);
	});

	it('requires production internal rotation secrets but rejects release-control capability', () => {
		const missing = pagesProject();
		Reflect.deleteProperty(
			missing.result.deployment_configs.production.env_vars,
			'INTERNAL_API_SECRET_PREVIOUS'
		);
		expect(() =>
			validatePagesDurableObjectBinding({ ...proofInput(missing), environment: 'production' })
		).toThrow(/must be an encrypted secret binding/i);

		const control = pagesProject();
		Object.assign(control.result.deployment_configs.production.env_vars, {
			RELEASE_CONTROL_SECRET: { type: 'secret_text' }
		});
		expect(() =>
			validatePagesDurableObjectBinding({ ...proofInput(control), environment: 'production' })
		).toThrow(/must not receive release-control capability/i);
	});

	it('keeps provider keys out of project defaults and requires them on the exact immutable deployment', () => {
		for (const binding of PAID_PROVIDER_RUNTIME_SECRET_BINDINGS) {
			const projectLeak = pagesProject();
			Object.assign(projectLeak.result.deployment_configs.production.env_vars, {
				[binding]: { type: 'secret_text' }
			});
			expect(() =>
				validatePagesDurableObjectBinding({
					...proofInput(projectLeak),
					environment: 'production'
				})
			).toThrow(new RegExp(`project defaults.*${binding}`, 'i'));

			const missingDeploymentBinding = pagesDeployment();
			Reflect.deleteProperty(missingDeploymentBinding.result.env_vars, binding);
			expect(() =>
				validatePagesDurableObjectBinding({
					...proofInput(),
					pagesDeployment: missingDeploymentBinding,
					environment: 'production'
				})
			).toThrow(new RegExp(`paid-provider ${binding}.*encrypted(?: secret)?`, 'i'));

			const plaintextDeploymentBinding = pagesDeployment();
			Object.assign(plaintextDeploymentBinding.result.env_vars, {
				[binding]: { type: 'plain_text', value: 'must-not-be-public' }
			});
			expect(() =>
				validatePagesDurableObjectBinding({
					...proofInput(),
					pagesDeployment: plaintextDeploymentBinding,
					environment: 'production'
				})
			).toThrow(new RegExp(`paid-provider ${binding}.*encrypted`, 'i'));
		}

		const missingProjectOperator = pagesProject();
		Reflect.deleteProperty(
			missingProjectOperator.result.deployment_configs.production.env_vars,
			PAID_PROVIDER_OPERATOR_BINDING
		);
		expect(() =>
			validatePagesDurableObjectBinding({
				...proofInput(missingProjectOperator),
				environment: 'production'
			})
		).toThrow(/operator allowlist.*encrypted/u);
	});

	it('rejects crossed production resources and role-shared namespaces', () => {
		expect(() =>
			validatePagesDurableObjectBinding({
				...proofInput(pagesProject({ productionBucket: PUBLIC_DISCOVERY_R2_BUCKETS.preview })),
				environment: 'production'
			})
		).toThrow(/R2 bucket does not match/i);

		expect(() =>
			validatePagesDurableObjectBinding({
				...proofInput(pagesProject({ productionWorkBudgetNamespace: namespaceId })),
				environment: 'production'
			})
		).toThrow(/must be distinct/i);
	});

	it('requires one exact custom domain per gate service and rejects crossed authority', () => {
		const domains = {
			success: true,
			result: [
				{
					hostname: 'release-control.commons.email',
					service: PUBLIC_DISCOVERY_GATE_WORKERS.production,
					zone_name: 'commons.email'
				},
				{
					hostname: 'release-control-staging.commons.email',
					service: PUBLIC_DISCOVERY_GATE_WORKERS.preview,
					zone_name: 'commons.email'
				}
			],
			result_info: { total_count: 2, total_pages: 1 }
		};
		expect(
			validatePublicDiscoveryGateCustomDomains({
				customDomains: domains,
				realms: ['preview', 'production']
			})
		).toEqual({
			preview: 'release-control-staging.commons.email',
			production: 'release-control.commons.email'
		});

		const crossed = structuredClone(domains);
		crossed.result[0].service = PUBLIC_DISCOVERY_GATE_WORKERS.preview;
		expect(() =>
			validatePublicDiscoveryGateCustomDomains({
				customDomains: crossed,
				realms: ['preview', 'production']
			})
		).toThrow(/not exact/i);
	});
});
