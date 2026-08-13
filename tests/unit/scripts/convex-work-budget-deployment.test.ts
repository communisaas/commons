import { describe, expect, it } from 'vitest';

import {
	CONVEX_WORK_BUDGET_BINDING,
	CONVEX_WORK_BUDGET_CLASS,
	CONVEX_WORK_BUDGET_WORKER,
	PAID_PROVIDER_OPERATOR_BINDING,
	PAID_PROVIDER_PAGES_SECRET_BINDINGS,
	validateConvexWorkBudgetActiveVersion,
	validateConvexWorkBudgetWorker,
	validatePagesConvexWorkBudgetBinding
} from '../../../scripts/verify-convex-work-budget-deployment.mjs';

const centralNamespaceId = 'budget-team-global';
const privateWorker = { result: { enabled: false, previews_enabled: false } };
const sourceSha = 'a'.repeat(40);
const versionId = 'b'.repeat(32);

function settings(namespaceId = centralNamespaceId) {
	return {
		result: {
			bindings: [
				{
					class_name: CONVEX_WORK_BUDGET_CLASS,
					name: CONVEX_WORK_BUDGET_BINDING,
					namespace_id: namespaceId,
					type: 'durable_object_namespace'
				}
			]
		}
	};
}

function pages({ production = centralNamespaceId, previewBound = false } = {}) {
	return {
		result: {
			deployment_configs: {
				production: {
					env_vars: {
						[PAID_PROVIDER_OPERATOR_BINDING]: { type: 'secret_text' }
					},
					durable_object_namespaces: {
						CONVEX_WORK_BUDGET: { namespace_id: production },
						PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE: { namespace_id: 'refresh-prod' }
					}
				},
				preview: {
					env_vars: {
						PUBLIC_CONVEX_URL: { type: 'plain_text', value: 'https://preview.convex.cloud' }
					},
					durable_object_namespaces: previewBound
						? { CONVEX_WORK_BUDGET: { namespace_id: centralNamespaceId } }
						: {}
				}
			}
		}
	};
}

describe('Convex work-budget deployment proof', () => {
	it('proves the exact source-tagged version is the sole active Worker version', () => {
		expect(
			validateConvexWorkBudgetActiveVersion({
				activeDeployment: { versions: [{ percentage: 100, version_id: versionId }] },
				activeVersion: {
					id: versionId,
					annotations: { 'workers/tag': sourceSha }
				},
				expectedSourceSha: sourceSha
			})
		).toEqual({ releaseSha: sourceSha, versionId });
	});

	it('rejects split traffic, an untagged version, and a non-SHA expectation', () => {
		expect(() =>
			validateConvexWorkBudgetActiveVersion({
				activeDeployment: {
					versions: [
						{ percentage: 90, version_id: versionId },
						{ percentage: 10, version_id: 'c'.repeat(32) }
					]
				},
				activeVersion: { id: versionId, annotations: { 'workers/tag': sourceSha } },
				expectedSourceSha: sourceSha
			})
		).toThrow(/exactly one fully active/i);

		expect(() =>
			validateConvexWorkBudgetActiveVersion({
				activeDeployment: { versions: [{ percentage: 100, version_id: versionId }] },
				activeVersion: { id: versionId, annotations: { 'workers/tag': 'c'.repeat(40) } },
				expectedSourceSha: sourceSha
			})
		).toThrow(/exact source SHA/i);

		expect(() =>
			validateConvexWorkBudgetActiveVersion({
				activeDeployment: { versions: [{ percentage: 100, version_id: versionId }] },
				activeVersion: { id: versionId, annotations: { 'workers/tag': sourceSha } },
				expectedSourceSha: 'main'
			})
		).toThrow(/lowercase Git SHA/i);
	});

	it('proves one private team coordinator bound only to production Pages', () => {
		expect(
			validatePagesConvexWorkBudgetBinding({
				environment: 'production',
				pagesProject: pages(),
				workerSettings: settings(),
				workerSubdomain: privateWorker
			})
		).toEqual({
			binding: CONVEX_WORK_BUDGET_BINDING,
			environment: 'production',
			namespaceId: centralNamespaceId,
			paidProviderOperatorBinding: PAID_PROVIDER_OPERATOR_BINDING,
			paidProviderProjectDefaultBindingsAbsent: [...PAID_PROVIDER_PAGES_SECRET_BINDINGS],
			previewPagesBound: false,
			previewPaidProviderBound: false,
			proof: 'both',
			worker: CONVEX_WORK_BUDGET_WORKER
		});
	});

	it('rejects preview inheritance before candidate code can reserve team budget', () => {
		expect(() =>
			validatePagesConvexWorkBudgetBinding({
				environment: 'preview',
				pagesProject: pages({ previewBound: true }),
				workerSettings: settings(),
				workerSubdomain: privateWorker
			})
		).toThrow(/preview must not receive/i);
	});

	it('rejects persistent provider credentials and requires the production operator allowlist', () => {
		for (const secretName of PAID_PROVIDER_PAGES_SECRET_BINDINGS) {
			const productionLeak = pages();
			Object.assign(productionLeak.result.deployment_configs.production.env_vars, {
				[secretName]: { type: 'secret_text' }
			});
			expect(() =>
				validatePagesConvexWorkBudgetBinding({
					environment: 'production',
					pagesProject: productionLeak,
					workerSettings: settings(),
					workerSubdomain: privateWorker
				})
			).toThrow(new RegExp(`production.*${secretName}`, 'i'));

			const previewLeak = pages();
			Object.assign(previewLeak.result.deployment_configs.preview.env_vars, {
				[secretName]: { type: 'secret_text' }
			});
			expect(() =>
				validatePagesConvexWorkBudgetBinding({
					environment: 'production',
					pagesProject: previewLeak,
					workerSettings: settings(),
					workerSubdomain: privateWorker
				})
			).toThrow(new RegExp(`preview.*${secretName}`, 'i'));
		}

		const missingOperator = pages();
		Reflect.deleteProperty(
			missingOperator.result.deployment_configs.production.env_vars,
			PAID_PROVIDER_OPERATOR_BINDING
		);
		expect(() =>
			validatePagesConvexWorkBudgetBinding({
				environment: 'production',
				pagesProject: missingOperator,
				workerSettings: settings(),
				workerSubdomain: privateWorker
			})
		).toThrow(/operator allowlist.*encrypted/u);

		const previewOperator = pages();
		Object.assign(previewOperator.result.deployment_configs.preview.env_vars, {
			[PAID_PROVIDER_OPERATOR_BINDING]: { type: 'secret_text' }
		});
		expect(() =>
			validatePagesConvexWorkBudgetBinding({
				environment: 'production',
				pagesProject: previewOperator,
				workerSettings: settings(),
				workerSubdomain: privateWorker
			})
		).toThrow(/preview.*operator capability/u);
	});

	it('rejects a crossed production namespace, public route, and extra Worker binding', () => {
		expect(() =>
			validatePagesConvexWorkBudgetBinding({
				environment: 'production',
				pagesProject: pages({ production: 'wrong-production-namespace' }),
				workerSettings: settings(),
				workerSubdomain: privateWorker
			})
		).toThrow(/central team coordinator/i);

		expect(() =>
			validateConvexWorkBudgetWorker({
				workerSettings: settings(),
				workerSubdomain: { result: { enabled: true, previews_enabled: false } }
			})
		).toThrow(/disable workers\.dev/i);

		const extra = settings();
		extra.result.bindings.push({ name: 'EXTRA', type: 'plain_text' } as never);
		expect(() =>
			validateConvexWorkBudgetWorker({
				workerSettings: extra,
				workerSubdomain: privateWorker
			})
		).toThrow(/exactly one binding/i);
	});

	it('supports explicit current-realm proof without weakening preview isolation', () => {
		expect(
			validatePagesConvexWorkBudgetBinding({
				environment: 'preview',
				pagesProject: pages({ production: 'old-production-namespace' }),
				proof: 'current',
				workerSettings: settings(),
				workerSubdomain: privateWorker
			}).proof
		).toBe('current');
		expect(() =>
			validatePagesConvexWorkBudgetBinding({
				environment: 'preview',
				pagesProject: pages({ production: 'old-production-namespace' }),
				workerSettings: settings(),
				workerSubdomain: privateWorker
			})
		).toThrow(/production/i);
	});
});
