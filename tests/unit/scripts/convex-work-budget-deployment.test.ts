import { describe, expect, it } from 'vitest';

import {
	CONVEX_WORK_BUDGET_BINDING,
	CONVEX_WORK_BUDGET_CLASS,
	CONVEX_WORK_BUDGET_WORKER,
	validateConvexWorkBudgetWorker,
	validatePagesConvexWorkBudgetBinding
} from '../../../scripts/verify-convex-work-budget-deployment.mjs';

const centralNamespaceId = 'budget-team-global';
const privateWorker = { result: { enabled: false, previews_enabled: false } };

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
					durable_object_namespaces: {
						CONVEX_WORK_BUDGET: { namespace_id: production },
						PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE: { namespace_id: 'refresh-prod' }
					}
				},
				preview: {
					durable_object_namespaces: previewBound
						? { CONVEX_WORK_BUDGET: { namespace_id: centralNamespaceId } }
						: {}
				}
			}
		}
	};
}

describe('Convex work-budget deployment proof', () => {
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
			previewPagesBound: false,
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
