import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import {
	CONVEX_CONTAINED_DEPLOYMENTS,
	CONVEX_DEPLOYMENT_AUDIT_EVENT_PAGE_SIZE,
	CONVEX_RUNNABLE_SCHEDULED_FUNCTION_PAGE_SIZE,
	validateConvexBackendState,
	validateConvexContainmentProofScope,
	validateConvexCronAuditLogViewDeployKey,
	validateConvexCronDataViewDeployKey,
	validateConvexDeploymentAuditEventPage,
	validateConvexExpectedBackendState,
	validateConvexOperatorRecoveryEpoch,
	validateConvexRecoveryEpochMinMs,
	validateConvexRunnableScheduledFunctionPage,
	validateEmptyConvexCronInventory,
	verifyAllConvexContainedCronDeployments,
	verifyConvexContainedCronDeployment
} from '../../../scripts/verify-convex-contained-cron-deployments.mjs';

function workflowJobBlocks(source: string) {
	const marker = '\njobs:\n';
	const jobsIndex = source.indexOf(marker);
	expect(jobsIndex, 'deploy workflow must contain jobs').toBeGreaterThan(-1);
	const jobsSource = source.slice(jobsIndex + marker.length);
	const headers = [...jobsSource.matchAll(/^  ([a-zA-Z0-9_-]+):\s*$/gm)];
	return new Map(
		headers.map((match, index) => {
			const start = match.index ?? 0;
			const end = headers[index + 1]?.index ?? jobsSource.length;
			return [match[1], jobsSource.slice(start, end)];
		})
	);
}

function keyFor(environment: 'preview' | 'production') {
	const deployment = CONVEX_CONTAINED_DEPLOYMENTS[environment];
	return `${deployment.type}:${deployment.name}|cron-data-view-secret-for-${environment}`;
}

function auditKeyFor(environment: 'preview' | 'production') {
	const deployment = CONVEX_CONTAINED_DEPLOYMENTS[environment];
	return `${deployment.type}:${deployment.name}|cron-audit-log-secret-for-${environment}`;
}

const pausedState = { system: 'none', usage_limit: 'none', user: 'paused' };
const runningState = { system: 'none', usage_limit: 'none', user: 'none' };
const emptyRunnablePage = { continueCursor: 'end', isDone: true, page: [] };
const recoveryEpoch = 'convex-recovery-2026-07-20-a';
const recoveryEpochMinMs = 1_784_517_400_000;
const pauseEventAt = recoveryEpochMinMs + 1_000;
const auditFenceStartMs = recoveryEpochMinMs + 60_000;
const auditNowMs = auditFenceStartMs + 60_000;
const pauseAuditPage = {
	continueCursor: 'audit-end',
	isDone: true,
	page: [
		{
			_creationTime: pauseEventAt,
			action: 'pause_deployment',
			metadata: {}
		}
	]
};
const emptyAuditTailPage = { continueCursor: 'audit-tail-end', isDone: true, page: [] };

function successfulAuditQuery() {
	return vi.fn(async (_reference: unknown, args: Record<string, unknown>) => {
		const filters = args.filters;
		if (!filters || typeof filters !== 'object' || Array.isArray(filters)) {
			throw new Error('Expected audit filters');
		}
		return Object.hasOwn(filters, 'maxDate') ? pauseAuditPage : emptyAuditTailPage;
	});
}

describe('live Convex contained-cron proof', () => {
	it('binds each deployment key to its exact type and deployment-name prefix', () => {
		expect(validateConvexCronDataViewDeployKey(keyFor('production'), 'production')).toBe(
			keyFor('production')
		);
		expect(validateConvexCronDataViewDeployKey(keyFor('preview'), 'preview')).toBe(
			keyFor('preview')
		);
		expect(validateConvexCronAuditLogViewDeployKey(auditKeyFor('production'), 'production')).toBe(
			auditKeyFor('production')
		);
		for (const invalid of [
			keyFor('preview'),
			'prod:other-production|cron-data-view-secret-for-production',
			'preview:team:project|project-wide-preview-secret',
			'prod:quirky-chinchilla-352|short',
			'prod:quirky-chinchilla-352|secret with whitespace'
		]) {
			expect(() => validateConvexCronDataViewDeployKey(invalid, 'production')).toThrow(
				/not bound to the exact production deployment/i
			);
		}
		expect(() =>
			validateConvexCronDataViewDeployKey(keyFor('production'), 'toString' as 'production')
		).toThrow(/invalid convex cron environment/i);
		expect(() =>
			validateConvexCronDataViewDeployKey(
				'preview:outstanding-firefly-831|cron-data-view-secret-for-preview',
				'preview'
			)
		).toThrow(/not bound to the exact preview deployment/i);
	});

	it('requires an explicit exact paused or running backend-state contract', () => {
		expect(validateConvexExpectedBackendState('paused')).toBe('paused');
		expect(validateConvexExpectedBackendState('running')).toBe('running');
		for (const invalid of [undefined, '', 'disabled', 'toString']) {
			expect(() => validateConvexExpectedBackendState(invalid)).toThrow(/explicitly set/i);
		}

		expect(validateConvexBackendState(pausedState, 'deployment', 'paused')).toEqual({
			system: 'none',
			usageLimit: 'none',
			user: 'paused'
		});
		expect(validateConvexBackendState(runningState, 'deployment', 'running')).toEqual({
			system: 'none',
			usageLimit: 'none',
			user: 'none'
		});
		for (const disabledPaused of [
			{ system: 'disabled', usage_limit: 'none', user: 'paused' },
			{ system: 'suspended', usage_limit: 'disabled', user: 'paused' }
		]) {
			expect(validateConvexBackendState(disabledPaused, 'deployment', 'paused')).toEqual({
				system: disabledPaused.system,
				usageLimit: disabledPaused.usage_limit,
				user: 'paused'
			});
		}
		for (const invalid of [runningState, { system: 'disabled', usage_limit: 'none', user: 'none' }]) {
			expect(() => validateConvexBackendState(invalid, 'deployment', 'paused')).toThrow(
				/required paused state/i
			);
		}
		expect(() =>
			validateConvexBackendState(
				{ system: 'disabled', usage_limit: 'none', user: 'none' },
				'deployment',
				'running'
			)
		).toThrow(/required running state/i);
		expect(() =>
			validateConvexBackendState(
				{ system: 'unknown', usage_limit: 'none', user: 'paused' },
				'deployment',
				'paused'
			)
		).toThrow(/response is invalid/i);
		expect(validateConvexContainmentProofScope('state')).toBe('state');
		expect(validateConvexContainmentProofScope('containment')).toBe('containment');
		expect(() => validateConvexContainmentProofScope('history')).toThrow(/scope/i);
		expect(validateConvexOperatorRecoveryEpoch(recoveryEpoch, 'paused')).toBe(recoveryEpoch);
		expect(validateConvexOperatorRecoveryEpoch(undefined, 'running')).toBeUndefined();
		expect(() => validateConvexOperatorRecoveryEpoch(undefined, 'paused')).toThrow(
			/operator recovery epoch/i
		);
		expect(validateConvexRecoveryEpochMinMs(String(recoveryEpochMinMs), 'paused')).toBe(
			recoveryEpochMinMs
		);
		expect(validateConvexRecoveryEpochMinMs(undefined, 'running')).toBeUndefined();
		expect(() => validateConvexRecoveryEpochMinMs(undefined, 'paused')).toThrow(/epoch start/i);
	});

	it('sanitizes only pause-state transitions from the bounded deployment audit page', () => {
		expect(
			validateConvexDeploymentAuditEventPage(pauseAuditPage, 'deployment', recoveryEpochMinMs)
		).toEqual({
			continueCursor: 'audit-end',
			isDone: true,
			transitions: [{ at: pauseEventAt, transition: 'pause' }]
		});
		expect(() =>
			validateConvexDeploymentAuditEventPage(
				{
					continueCursor: 'end',
					isDone: true,
					page: [{ _creationTime: recoveryEpochMinMs - 1, action: 'pause_deployment', metadata: {} }]
				},
				'deployment',
				recoveryEpochMinMs
			)
		).toThrow(/audit event is invalid/i);
	});

	it('requires an exact empty actual _cron_jobs inventory', () => {
		expect(validateEmptyConvexCronInventory([], 'deployment')).toEqual({
			registeredCronJobs: 0
		});
		expect(() => validateEmptyConvexCronInventory({}, 'deployment')).toThrow(/must be an array/i);
		expect(() =>
			validateEmptyConvexCronInventory([{ name: 'legacy-cron' }], 'deployment')
		).toThrow(/1 cron job\(s\) remain/i);
	});

	it('accepts only a final empty indexed active-work page and never scans retained history', () => {
		expect(validateConvexRunnableScheduledFunctionPage(emptyRunnablePage, 'deployment')).toEqual({
			runnableScheduledFunctions: 0,
			scheduledFunctionActiveRowsRead: 0
		});
		expect(() =>
			validateConvexRunnableScheduledFunctionPage(
				{
					continueCursor: 'next',
					isDone: false,
					page: [{ opaqueReturnedActiveRow: true }]
				},
				'deployment'
			)
		).toThrow(/at least 1 pending or in-progress/i);
		expect(() =>
			validateConvexRunnableScheduledFunctionPage(
				{ continueCursor: 'next', isDone: false, page: [] },
				'deployment'
			)
		).toThrow(/did not terminate/i);
		for (const invalid of [
			{},
			{ continueCursor: null, isDone: true, page: [] },
			{ continueCursor: 'end', isDone: true, page: {} }
		]) {
			expect(() =>
				validateConvexRunnableScheduledFunctionPage(invalid, 'deployment')
			).toThrow(/runnable scheduled-function page/i);
		}
	});

	it('captures a disabled-but-user-paused pre-reactivation state fence without inventory reads', async () => {
		const disabledPausedState = {
			system: 'disabled',
			usage_limit: 'disabled',
			user: 'paused'
		};
		const query = vi.fn().mockResolvedValue(disabledPausedState);
		const auditQuery = successfulAuditQuery();
		await expect(
			verifyConvexContainedCronDeployment({
				clientFactory: () => ({ query, setAdminAuth: vi.fn() }),
				deploymentKey: keyFor('production'),
				environment: 'production',
				expectedState: 'paused',
				recoveryEpoch,
				recoveryEpochMinMs,
				auditLogKey: auditKeyFor('production'),
				scope: 'state',
				now: () => auditNowMs,
				auditClientFactory: () => ({ query: auditQuery, setAdminAuth: vi.fn() })
			})
		).resolves.toMatchObject({
			proofScope: 'state',
			operatorRecoveryEpoch: recoveryEpoch,
			pauseEpochAudit: {
				epochMinMs: recoveryEpochMinMs,
				fenceStartMs: auditFenceStartMs,
				historyPauseEventAt: pauseEventAt,
				historyPauseEvents: 1,
				pauseEventAt,
				pauseEvents: 1,
				resumeEvents: 0,
				auditEventsMatched: 1,
				historyAuditPagesRead: 1,
				tailPauseEventAt: null,
				tailPauseEvents: 0,
				tailAuditEventsMatched: 0,
				tailAuditPagesRead: 1,
				tailResumeEvents: 0
			},
			backendStateFence: {
				before: { system: 'disabled', usageLimit: 'disabled', user: 'paused' },
				after: { system: 'disabled', usageLimit: 'disabled', user: 'paused' }
			}
		});
		expect(query).toHaveBeenCalledTimes(2);
		expect(auditQuery).toHaveBeenNthCalledWith(1, expect.anything(), {
			filters: {
				actions: ['pause_deployment', 'unpause_deployment', 'change_deployment_state'],
				maxDate: auditFenceStartMs,
				minDate: recoveryEpochMinMs
			},
			paginationOpts: { cursor: null, numItems: CONVEX_DEPLOYMENT_AUDIT_EVENT_PAGE_SIZE }
		});
		expect(auditQuery).toHaveBeenNthCalledWith(2, expect.anything(), {
			filters: {
				actions: ['pause_deployment', 'unpause_deployment', 'change_deployment_state'],
				minDate: auditFenceStartMs
			},
			paginationOpts: { cursor: null, numItems: CONVEX_DEPLOYMENT_AUDIT_EVENT_PAGE_SIZE }
		});
	});

	it('brackets bounded indexed inventories with exact paused-state reads', async () => {
		const setAdminAuth = vi.fn();
		const query = vi
			.fn()
			.mockResolvedValueOnce(pausedState)
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce(emptyRunnablePage)
			.mockResolvedValueOnce(pausedState);
		const clientFactory = vi.fn(() => ({ setAdminAuth, query }));
		const auditSetAdminAuth = vi.fn();
		const auditClientFactory = vi.fn(() => ({
			setAdminAuth: auditSetAdminAuth,
			query: successfulAuditQuery()
		}));

		await expect(
			verifyConvexContainedCronDeployment({
				environment: 'production',
				deploymentKey: keyFor('production'),
				expectedState: 'paused',
				recoveryEpoch,
				recoveryEpochMinMs,
				auditLogKey: auditKeyFor('production'),
				now: () => auditNowMs,
				clientFactory,
				auditClientFactory
			})
		).resolves.toEqual({
			deploymentName: 'quirky-chinchilla-352',
			environment: 'production',
			instanceUrl: CONVEX_CONTAINED_DEPLOYMENTS.production.url,
			proofScope: 'containment',
			expectedBackendState: 'paused',
			operatorRecoveryEpoch: recoveryEpoch,
			pauseEpochAudit: {
				epochMinMs: recoveryEpochMinMs,
				fenceStartMs: auditFenceStartMs,
				historyPauseEventAt: pauseEventAt,
				historyPauseEvents: 1,
				pauseEventAt,
				pauseEvents: 1,
				resumeEvents: 0,
				auditEventsMatched: 1,
				historyAuditPagesRead: 1,
				tailPauseEventAt: null,
				tailPauseEvents: 0,
				tailAuditEventsMatched: 0,
				tailAuditPagesRead: 1,
				tailResumeEvents: 0
			},
			backendStateFence: {
				before: { system: 'none', usageLimit: 'none', user: 'paused' },
				after: { system: 'none', usageLimit: 'none', user: 'paused' }
			},
			backendStateFenceReads: 2,
			registeredCronJobs: 0,
			runnableScheduledFunctions: 0,
			scheduledFunctionActiveRowsRead: 0
		});
		expect(clientFactory).toHaveBeenCalledWith(CONVEX_CONTAINED_DEPLOYMENTS.production.url);
		expect(setAdminAuth).toHaveBeenCalledWith(keyFor('production'));
		expect(auditSetAdminAuth).toHaveBeenCalledWith(auditKeyFor('production'));
		expect(query).toHaveBeenNthCalledWith(1, expect.anything(), {});
		expect(query).toHaveBeenNthCalledWith(2, expect.anything(), { componentId: null });
		expect(query).toHaveBeenNthCalledWith(3, expect.anything(), {
			componentId: null,
			paginationOpts: {
				cursor: null,
				numItems: CONVEX_RUNNABLE_SCHEDULED_FUNCTION_PAGE_SIZE
			}
		});
		expect(query).toHaveBeenNthCalledWith(4, expect.anything(), {});
	});

	it('fails if the deployment is resumed during the state-fenced proof', async () => {
		const query = vi
			.fn()
			.mockResolvedValueOnce(pausedState)
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce(emptyRunnablePage)
			.mockResolvedValueOnce(runningState);
		await expect(
			verifyConvexContainedCronDeployment({
				clientFactory: () => ({ query, setAdminAuth: vi.fn() }),
				deploymentKey: keyFor('production'),
				environment: 'production',
				expectedState: 'paused',
				recoveryEpoch,
				recoveryEpochMinMs,
				auditLogKey: auditKeyFor('production'),
				now: () => auditNowMs,
				auditClientFactory: () => ({
					query: successfulAuditQuery(),
					setAdminAuth: vi.fn()
				})
			})
		).rejects.toThrow(/required paused state/i);
	});

	it('fails a paused epoch when the provider audit log contains any resume transition', async () => {
		const query = vi.fn().mockResolvedValue(pausedState);
		const auditPageWithResume = {
			continueCursor: 'audit-end',
			isDone: true,
			page: [
				pauseAuditPage.page[0],
				{
					_creationTime: pauseEventAt + 1,
					action: 'unpause_deployment',
					metadata: {}
				}
			]
		};
		await expect(
			verifyConvexContainedCronDeployment({
				clientFactory: () => ({ query, setAdminAuth: vi.fn() }),
				deploymentKey: keyFor('production'),
				auditLogKey: auditKeyFor('production'),
				environment: 'production',
				expectedState: 'paused',
				recoveryEpoch,
				recoveryEpochMinMs,
				now: () => auditNowMs,
				scope: 'state',
				auditClientFactory: () => ({
					query: vi.fn().mockResolvedValue(auditPageWithResume),
					setAdminAuth: vi.fn()
				})
			})
		).rejects.toThrow(/contains 1 unpause or running transition/i);
	});

	it('closes the multi-page race with a final complete overlapping audit tail', async () => {
		const query = vi.fn().mockResolvedValue(pausedState);
		const tailResumePage = {
			continueCursor: 'audit-tail-end',
			isDone: true,
			page: [
				{
					_creationTime: auditFenceStartMs + 1,
					action: 'unpause_deployment',
					metadata: {}
				}
			]
		};
		const auditQuery = vi
			.fn()
			.mockResolvedValueOnce(pauseAuditPage)
			.mockResolvedValueOnce(tailResumePage);
		await expect(
			verifyConvexContainedCronDeployment({
				clientFactory: () => ({ query, setAdminAuth: vi.fn() }),
				deploymentKey: keyFor('production'),
				auditLogKey: auditKeyFor('production'),
				environment: 'production',
				expectedState: 'paused',
				recoveryEpoch,
				recoveryEpochMinMs,
				scope: 'state',
				now: () => auditNowMs,
				auditClientFactory: () => ({ query: auditQuery, setAdminAuth: vi.fn() })
			})
		).rejects.toThrow(/audit tail contains 1 unpause or running transition/i);
		expect(auditQuery).toHaveBeenCalledTimes(2);
	});

	it('rejects any indexed runnable row without scanning completed rows or arguments', async () => {
		const query = vi
			.fn()
			.mockResolvedValueOnce(pausedState)
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce({
				continueCursor: 'next',
				isDone: false,
				page: [{ state: { kind: 'pending' }, args: 'must-not-be-read-or-logged' }]
			});
		await expect(
			verifyConvexContainedCronDeployment({
				clientFactory: () => ({ query, setAdminAuth: vi.fn() }),
				deploymentKey: keyFor('production'),
				environment: 'production',
				expectedState: 'paused',
				recoveryEpoch,
				recoveryEpochMinMs,
				auditLogKey: auditKeyFor('production')
			})
		).rejects.toThrow(/at least 1 pending or in-progress scheduled function/i);
		expect(query).toHaveBeenCalledTimes(3);
	});

	it('rejects a cross-environment key before creating a client and never echoes the secret', async () => {
		const clientFactory = vi.fn();
		const crossEnvironmentKey = keyFor('preview');
		let message = '';
		try {
			await verifyConvexContainedCronDeployment({
				environment: 'production',
				deploymentKey: crossEnvironmentKey,
				expectedState: 'paused',
				recoveryEpoch,
				recoveryEpochMinMs,
				clientFactory
			});
		} catch (error) {
			message = error instanceof Error ? error.message : String(error);
		}
		expect(clientFactory).not.toHaveBeenCalled();
		expect(message).toMatch(/not bound to the exact production deployment/i);
		expect(message).not.toContain(crossEnvironmentKey);
	});

	it('checks both exact Commons deployments and fails closed on either non-empty realm', async () => {
		const clientFactory = vi.fn((url: string) => {
			let call = 0;
			return {
				setAdminAuth: vi.fn(),
				query: vi.fn(async () => {
					call += 1;
					if (call === 1 || call === 4) return pausedState;
					if (call === 2) return url.includes('outstanding-firefly-831') ? [] : [{ name: 'old' }];
					return emptyRunnablePage;
				})
			};
		});
		await expect(
			verifyAllConvexContainedCronDeployments({
				deploymentKeys: {
					preview: keyFor('preview'),
					production: keyFor('production')
				},
				expectedState: 'paused',
				recoveryEpoch,
				recoveryEpochMinMs,
				auditLogKeys: {
					preview: auditKeyFor('preview'),
					production: auditKeyFor('production')
				},
				now: () => auditNowMs,
				clientFactory,
				auditClientFactory: () => ({
					query: successfulAuditQuery(),
					setAdminAuth: vi.fn()
				})
			})
		).rejects.toThrow(/quirky-chinchilla-352.*1 cron job/i);
	});

	it('preflights expected state and both exact key bindings before any live query', async () => {
		const clientFactory = vi.fn();
		await expect(
			verifyAllConvexContainedCronDeployments({
				deploymentKeys: {
					preview: keyFor('preview'),
					production: keyFor('preview')
				},
				expectedState: 'paused',
				recoveryEpoch,
				recoveryEpochMinMs,
				clientFactory
			})
		).rejects.toThrow(/not bound to the exact production deployment/i);
		await expect(
			verifyAllConvexContainedCronDeployments({
				deploymentKeys: {
					preview: keyFor('preview'),
					production: keyFor('production')
				},
				expectedState: 'disabled' as 'paused',
				clientFactory
			})
		).rejects.toThrow(/explicitly set/i);
		expect(clientFactory).not.toHaveBeenCalled();
	});

	it('installs the verifier runtime and gates each release with realm-scoped credentials', () => {
		const workflow = readFileSync('.github/workflows/deploy.yml', 'utf8');
		const jobs = workflowJobBlocks(workflow);
		const releasePackage = JSON.parse(readFileSync('.github/release-gate/package.json', 'utf8'));
		const rootPackage = JSON.parse(readFileSync('package.json', 'utf8'));
		const verifier = readFileSync('scripts/verify-convex-contained-cron-deployments.mjs', 'utf8');
		const calls = [
			...workflow.matchAll(
				/node gate\/scripts\/verify-convex-contained-cron-deployments\.mjs/g
			)
		].map((match) => match.index ?? -1);
		expect(calls).toHaveLength(5);
		expect(workflow.match(/--expected-state running/g)).toHaveLength(5);
		expect(
			workflow.match(
				/verify-convex-contained-cron-deployments\.mjs\n\s+--environment preview\n\s+--expected-state running/g
			)
		).toHaveLength(2);
		expect(
			workflow.match(
				/verify-convex-contained-cron-deployments\.mjs\n\s+--environment all\n\s+--expected-state running/g
			)
		).toHaveLength(3);

		const previewActivation = jobs.get('activate-preview') ?? '';
		const previewQualification = jobs.get('qualify-preview-generation') ?? '';
		const productionPreflight = jobs.get('production-queue-preflight') ?? '';
		const productionActivation = jobs.get('activate-production') ?? '';
		const productionQualification = jobs.get('qualify-production-generation') ?? '';
		const containmentJob = jobs.get('deploy') ?? '';

		for (const job of [previewActivation, previewQualification]) {
			expect(job.match(/verify-convex-contained-cron-deployments\.mjs/g)).toHaveLength(1);
			expect(job).toContain('PROTECTED_CONVEX_PREVIEW_CRON_DATA_VIEW_DEPLOY_KEY');
			expect(job).not.toContain('PROTECTED_CONVEX_PRODUCTION_CRON_DATA_VIEW_DEPLOY_KEY');
			expect(job).toContain('--environment preview');
			expect(job).toContain('--expected-state running');
		}
		for (const job of [productionPreflight, productionActivation, productionQualification]) {
			expect(job.match(/verify-convex-contained-cron-deployments\.mjs/g)).toHaveLength(1);
			expect(job).toContain('PROTECTED_CONVEX_PREVIEW_CRON_DATA_VIEW_DEPLOY_KEY');
			expect(job).toContain('PROTECTED_CONVEX_PRODUCTION_CRON_DATA_VIEW_DEPLOY_KEY');
			expect(job).toContain('--environment all');
			expect(job).toContain('--expected-state running');
		}

		expect(containmentJob).toContain("needs.source-verify.outputs.deploy_mode == 'containment'");
		expect(containmentJob).not.toContain('verify-convex-contained-cron-deployments.mjs');
		expect(containmentJob).not.toContain('PROTECTED_CONVEX_PREVIEW_CRON_DATA_VIEW_DEPLOY_KEY');
		expect(containmentJob).not.toContain('PROTECTED_CONVEX_PRODUCTION_CRON_DATA_VIEW_DEPLOY_KEY');

		expect(releasePackage.dependencies.convex).toBe('1.42.3');
		expect(rootPackage.scripts['verify:convex-contained-crons']).toContain(
			'--recovery-epoch-min-ms'
		);
		expect(workflow).toContain('ln -s .github/release-gate/node_modules gate/node_modules');
		expect(workflow).not.toContain(
			"await import('./gate/scripts/verify-convex-contained-cron-deployments.mjs')"
		);
		expect(verifier).toContain('deployment:data:view and no other action');
		expect(verifier).toContain('a key authenticating itself');
		expect(workflow).not.toContain('CRON_AUDIT_LOG_VIEW_DEPLOY_KEY');
		expect(verifier).toContain('Object.hasOwn(CONVEX_CONTAINED_DEPLOYMENTS, environment)');
		expect(verifier).toContain('new ConvexHttpClient(url, { logger: false })');
		expect(verifier).toContain('_system/frontend/paginatedScheduledJobs:default');
		expect(verifier).not.toContain("table: '_scheduled_functions'");
	});
});
