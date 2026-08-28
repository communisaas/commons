import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	assertPagesProjectPublicationGate,
	parseCliArgs,
	partitionPagesDeployments,
	reconcilePagesExposure
} from '../../../scripts/reconcile-cloudflare-pages-exposure.mjs';

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

function deployment(
	id: string,
	branch: string,
	aliases: string[] = [],
	commitHash = 'a'.repeat(40)
) {
	return {
		id,
		aliases,
		deployment_trigger: { metadata: { branch, commit_hash: commitHash } }
	};
}

function project(canonical: ReturnType<typeof deployment>) {
	return {
		canonical_deployment: canonical,
		source: {
			config: { production_deployments_enabled: false, preview_deployment_setting: 'none' }
		}
	};
}

function cloudflareJson(result: unknown, resultInfo?: Record<string, number>) {
	return new Response(
		JSON.stringify({ success: true, result, ...(resultInfo ? { result_info: resultInfo } : {}) }),
		{ status: 200, headers: { 'content-type': 'application/json' } }
	);
}

describe('Cloudflare Pages exposure reconciliation', () => {
	it('keeps only canonical production and the explicitly supported production alias', () => {
		const result = partitionPagesDeployments(
			[
				deployment('canonical', 'production', ['https://commons.email']),
				deployment('production-alias', 'production', [
					'https://production.communique-site.pages.dev'
				]),
				deployment('main', 'main', ['https://main.communique-site.pages.dev']),
				deployment('staging', 'staging', ['https://staging.communique-site.pages.dev']),
				deployment('old-production', 'production'),
				deployment('old-main', 'main'),
				deployment('custom-main-alias', 'main', ['https://preview.commons.email']),
				deployment('lookalike-main-alias', 'main', [
					'https://main.communique-site.pages.dev.attacker.example'
				]),
				deployment('rogue-alias', 'feature', [
					'https://feature.communique-site.pages.dev'
				])
			],
			{ canonicalDeploymentId: 'canonical' }
		);

		expect(result.keep.map((row) => row.id)).toEqual(['canonical', 'production-alias']);
		expect(result.prune.map((row) => row.id)).toEqual([
			'main',
			'staging',
			'old-production',
			'old-main',
			'custom-main-alias',
			'lookalike-main-alias',
			'rogue-alias'
		]);
	});

	it('rejects missing CLI values instead of bypassing SHA proof or an intended delete cap', () => {
		expect(() => parseCliArgs(['--expected-production-sha'])).toThrow(/requires a value/i);
		expect(() => parseCliArgs(['--prune', '--max-delete'])).toThrow(/requires a value/i);
		expect(() => parseCliArgs(['--max-delete', '10'])).toThrow(/requires --prune/i);
		expect(() => parseCliArgs(['--unknown'])).toThrow(/unknown argument/i);
		expect(
			parseCliArgs(['--prune', '--max-delete', '10', '--expected-production-sha', 'a'.repeat(40)])
		).toEqual({
			prune: true,
			maxDelete: '10',
			expectedProductionSha: 'a'.repeat(40),
			preserveDeploymentIds: []
		});
	});

	it('accepts only exact rollback-safe deployment IDs for transactional preservation', () => {
		const deploymentId = '12345678-1234-1234-1234-123456789abc';
		expect(parseCliArgs(['--prune', '--preserve-deployment-id', deploymentId])).toEqual({
			prune: true,
			maxDelete: undefined,
			expectedProductionSha: undefined,
			preserveDeploymentIds: [deploymentId]
		});
		expect(() =>
			parseCliArgs(['--prune', '--preserve-deployment-id', `${deploymentId}/rollback`])
		).toThrow(/exact lowercase/i);
		expect(() =>
			parseCliArgs([
				'--prune',
				'--preserve-deployment-id',
				deploymentId,
				'--preserve-deployment-id',
				deploymentId
			])
		).toThrow(/unique/i);
	});

	it('fails closed if two deployments claim the same exact allowed branch alias', () => {
		expect(() =>
			partitionPagesDeployments(
				[
					deployment('canonical', 'production'),
					deployment('production-a', 'production', [
						'https://production.communique-site.pages.dev'
					]),
					deployment('production-b', 'production', [
						'https://production.communique-site.pages.dev'
					])
				],
				{ canonicalDeploymentId: 'canonical' }
			)
		).toThrow(/multiple deployments holding the exact production\.communique-site\.pages\.dev/i);

		expect(() =>
			partitionPagesDeployments(
				[
					deployment('canonical', 'main', ['https://main.communique-site.pages.dev']),
					deployment('stale', 'feature')
				],
				{ canonicalDeploymentId: 'canonical' }
			)
		).not.toThrow();
	});

	it('fails closed when native Git deployments can mint unreviewed public URLs', () => {
		expect(() =>
			assertPagesProjectPublicationGate({
				source: {
					config: { production_deployments_enabled: false, preview_deployment_setting: 'all' }
				}
			})
		).toThrow(/preview deployments must be disabled/i);

		expect(() =>
			assertPagesProjectPublicationGate({
				source: {
					config: { production_deployments_enabled: true, preview_deployment_setting: 'none' }
				}
			})
		).toThrow(/production deployments must be disabled/i);
	});

	it('accepts the gated Wrangler-only publication posture', () => {
		expect(() =>
			assertPagesProjectPublicationGate({
				source: {
					config: { production_deployments_enabled: false, preview_deployment_setting: 'none' }
				}
			})
		).not.toThrow();
	});

	it('rechecks the exact canonical SHA after deletion', async () => {
		const expectedSha = 'a'.repeat(40);
		const replacementSha = 'b'.repeat(40);
		const canonicalBefore = deployment('canonical-a', 'production', [], expectedSha);
		const canonicalAfter = deployment('canonical-b', 'production', [], replacementSha);
		const stale = deployment('stale', 'feature');
		let deletionObserved = false;

		const fetchFn: typeof fetch = async (input, init) => {
			expect(init?.redirect).toBe('error');
			const url = new URL(String(input));
			if (init?.method === 'DELETE') {
				expect(url.pathname).toMatch(/\/deployments\/stale$/);
				deletionObserved = true;
				return cloudflareJson(null);
			}

			if (url.pathname.endsWith('/communique-site')) {
				return cloudflareJson(project(deletionObserved ? canonicalAfter : canonicalBefore));
			}

			const rows = deletionObserved ? [canonicalAfter] : [canonicalBefore, stale];
			return cloudflareJson(rows, {
				page: 1,
				per_page: 25,
				total_count: rows.length,
				total_pages: 1
			});
		};

		await expect(
			reconcilePagesExposure({
				token: 'test-token',
				accountId: '0'.repeat(32),
				prune: true,
				expectedProductionSha: expectedSha,
				fetchFn
			})
		).rejects.toThrow(/does not match/i);
		expect(deletionObserved).toBe(true);
	});

	it('serializes split publication, proves containment first, and prunes only after every probe', () => {
		const deployWorkflow = readFileSync('.github/workflows/deploy.yml', 'utf8');
		const guardWorkflow = readFileSync('.github/workflows/pages-exposure-guard.yml', 'utf8');
		const jobs = workflowJobBlocks(deployWorkflow);
		const releaseKit = jobs.get('prepare-queue-release-kit') ?? '';
		const activatePreviewJob = jobs.get('activate-preview') ?? '';
		const qualifyPreviewJob = jobs.get('qualify-preview-generation') ?? '';
		const productionPreflightJob = jobs.get('production-queue-preflight') ?? '';
		const bootstrapProductionJob = jobs.get('bootstrap-production-discovery') ?? '';
		const activateProductionJob = jobs.get('activate-production') ?? '';
		const productionQualificationJob = jobs.get('qualify-production-generation') ?? '';
		const containmentJob = jobs.get('deploy') ?? '';
		const phaseRunner = readFileSync(
			'scripts/run-public-template-og-release-phase.mjs',
			'utf8'
		);
		const captureStep = containmentJob.indexOf(
			'- name: Capture previous production canonical deployment'
		);
		const deployStep = containmentJob.indexOf('id: containment_pages_deploy');
		const containmentPreflight = containmentJob.indexOf(
			'- name: Prove isolated containment preflight on staging custom authority'
		);
		const firstPostUploadProbe = containmentJob.indexOf('- name: Purge CDN cache');
		const forwardContainment = containmentJob.indexOf(
			'- name: Forward-redeploy proven containment after publication failure'
		);
		const reconcileStep = containmentJob.indexOf(
			'- name: Reconcile successful Pages publication'
		);
		const retiredProof = containmentJob.indexOf(
			'- name: Prove previous production URL is retired'
		);

		expect(deployWorkflow).toContain('group: cloudflare-pages-publication');
		expect(guardWorkflow).toContain('group: cloudflare-pages-publication');
		expect(captureStep).toBeGreaterThan(-1);
		expect(deployStep).toBeGreaterThan(-1);
		expect(containmentPreflight).toBeGreaterThan(-1);
		expect(containmentPreflight).toBeLessThan(captureStep);
		expect(captureStep).toBeLessThan(deployStep);
		expect(firstPostUploadProbe).toBeGreaterThan(deployStep);
		expect(forwardContainment).toBeGreaterThan(firstPostUploadProbe);
		expect(reconcileStep).toBeGreaterThan(forwardContainment);
		expect(retiredProof).toBeGreaterThan(reconcileStep);

		for (const previewJob of [releaseKit, activatePreviewJob]) {
			expect(previewJob).toContain("needs.source-verify.outputs.deploy_mode == 'normal'");
			expect(previewJob).toContain("inputs.branch == 'staging'");
			expect(previewJob).toContain("inputs.branch == 'production'");
			expect(previewJob).not.toContain("inputs.branch == 'main'");
		}
		expect(activatePreviewJob).toContain('- prepare-queue-release-kit');
		expect(activatePreviewJob).toContain("needs.prepare-queue-release-kit.result == 'success'");
		expect(qualifyPreviewJob).toContain('- activate-preview');
		expect(qualifyPreviewJob).toContain("needs.activate-preview.result == 'success'");
		for (const productionJob of [
			productionPreflightJob,
			bootstrapProductionJob,
			activateProductionJob,
			productionQualificationJob
		]) {
			expect(productionJob).toContain("needs.source-verify.outputs.deploy_mode == 'normal'");
			expect(productionJob).toContain("inputs.branch == 'production'");
			expect(productionJob).not.toContain("inputs.branch == 'staging'");
			expect(productionJob).not.toContain(
				"github.event.workflow_run.head_branch == 'production'"
			);
		}
		expect(productionPreflightJob).toContain('- qualify-preview-generation');
		expect(bootstrapProductionJob).toContain('- production-queue-preflight');
		expect(activateProductionJob).toContain('- bootstrap-production-discovery');
		expect(activateProductionJob).toContain('- production-queue-preflight');
		expect(productionQualificationJob).toContain('- activate-production');
		expect(containmentJob).toContain("needs.source-verify.outputs.deploy_mode == 'containment'");
		expect(containmentJob).not.toContain("env.DEPLOY_MODE == 'normal'");

		const committedCacheProof = productionQualificationJob.indexOf(
			'- name: Prove committed anonymous landing cache reaches a trusted hit'
		);
		const normalExposureReconciliation = productionQualificationJob.indexOf(
			'- name: Reconcile successful normal Pages exposure'
		);
		const interruptedHandoffRecovery = productionQualificationJob.indexOf(
			'- name: Recover an interrupted authority handoff'
		);
		const failedExposureReconciliation = productionQualificationJob.indexOf(
			'- name: Reconcile failed normal production exposure after recovery'
		);
		expect(productionQualificationJob).toContain(
			"needs.activate-production.result == 'success'"
		);
		expect(committedCacheProof).toBeGreaterThan(-1);
		expect(normalExposureReconciliation).toBeGreaterThan(committedCacheProof);
		expect(interruptedHandoffRecovery).toBeGreaterThan(normalExposureReconciliation);
		expect(failedExposureReconciliation).toBeGreaterThan(interruptedHandoffRecovery);
		expect(productionQualificationJob).toContain('id: reconcile_production_exposure');
		const rollbackReserveReconciliation = productionQualificationJob.slice(
			normalExposureReconciliation,
			interruptedHandoffRecovery
		);
		expect(rollbackReserveReconciliation).toContain('--prune');
		expect(rollbackReserveReconciliation).toContain(
			'--expected-production-sha "$DEPLOY_SHA"'
		);
		expect(rollbackReserveReconciliation).toContain('--preserve-deployment-id');
		expect(rollbackReserveReconciliation).toContain('pagesCapture.deploymentId');
		expect(productionQualificationJob).toContain('CF_PAGES_ALLOWED_ALIAS_BRANCHES: production');
		expect(productionQualificationJob).not.toContain(
			'CF_PAGES_ALLOWED_ALIAS_BRANCHES: production,main,staging'
		);
		expect(rollbackReserveReconciliation).toContain("grep -q 'stale=0;'");
		expect(rollbackReserveReconciliation).toContain("grep -q 'preserved=1;'");
		expect(rollbackReserveReconciliation).not.toContain(
			'verify-pages-deployment-retired.mjs'
		);
		const retirementProof = productionQualificationJob.indexOf(
			'verify-pages-deployment-retired.mjs',
			failedExposureReconciliation
		);
		expect(retirementProof).toBeGreaterThan(failedExposureReconciliation);
		const terminalReconcileCall = productionQualificationJob.lastIndexOf(
			'reconcile-cloudflare-pages-exposure.mjs',
			retirementProof
		);
		expect(terminalReconcileCall).toBeGreaterThan(failedExposureReconciliation);
		const terminalCleanupStart = productionQualificationJob.lastIndexOf(
			'\n      - name:',
			terminalReconcileCall
		);
		const terminalCleanup = productionQualificationJob.slice(terminalCleanupStart);
		expect(terminalCleanup).toContain("steps.reconcile_production_exposure.outcome == 'success'");
		expect(terminalCleanup).toContain('reconcile-cloudflare-pages-exposure.mjs');
		expect(terminalCleanup).toContain('--expected-production-sha "$DEPLOY_SHA"');
		expect(terminalCleanup).not.toContain('--preserve-deployment-id');
		expect(terminalCleanup).toContain("grep -q 'stale=0;'");
		expect(terminalCleanup).toContain("grep -q 'preserved=0;'");

		const runPhase = phaseRunner.slice(
			phaseRunner.indexOf('export async function runPublicTemplateOgReleasePhase')
		);
		const canonicalProof = runPhase.indexOf('canonical-artifact-tree-digest.mjs');
		const containedBaseline = runPhase.indexOf('verify-pages-containment-bindings.mjs');
		const captureQueues = runPhase.indexOf('capturePublicTemplateOgQueues({');
		const publishPages = runPhase.indexOf("'pages',\n\t\t\t\t'deploy'");
		expect(canonicalProof).toBeGreaterThan(-1);
		expect(containedBaseline).toBeGreaterThan(canonicalProof);
		expect(captureQueues).toBeGreaterThan(containedBaseline);
		expect(publishPages).toBeGreaterThan(captureQueues);
		expect(containmentJob).toContain('containment_preflight_verify');
		expect(containmentJob).toContain('preserved=0;');
		expect(deployWorkflow).toContain('timeout-minutes: 90');
		expect(deployWorkflow).not.toMatch(/actions\/(?:checkout|setup-node)@v\d/);
		const checkoutRefs = [...deployWorkflow.matchAll(/actions\/checkout@([^\s]+)/g)].map(
			(match) => match[1]
		);
		const setupNodeRefs = [...deployWorkflow.matchAll(/actions\/setup-node@([^\s]+)/g)].map(
			(match) => match[1]
		);
		expect(checkoutRefs.length).toBeGreaterThan(0);
		expect(setupNodeRefs.length).toBeGreaterThan(0);
		expect(new Set(checkoutRefs)).toEqual(
			new Set(['34e114876b0b11c390a56381ad16ebd13914f8d5'])
		);
		expect(new Set(setupNodeRefs)).toEqual(
			new Set(['49933ea5288caeca8642d1e84afbd3f7d6820020'])
		);
	});
});
