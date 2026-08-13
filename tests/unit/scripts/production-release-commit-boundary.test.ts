import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/deploy.yml', 'utf8');
const qualifier = readFileSync('scripts/qualify-public-discovery-generation.mjs', 'utf8');
const productionJob = workflow.slice(
	workflow.indexOf('  qualify-production-generation:'),
	workflow.indexOf('\n  deploy:', workflow.indexOf('  qualify-production-generation:'))
);

describe('production release commit boundary', () => {
	it('derives production eligibility from staging plus trusted infrastructure before C', () => {
		expect(productionJob).toContain('- qualify-preview-generation');
		expect(productionJob).toContain(
			"needs.qualify-preview-generation.outputs.runtime_proved == 'true'"
		);
		expect(productionJob).toContain('verify-pages-durable-object-binding.mjs');
		expect(productionJob).toContain('--environment production');
		expect(productionJob).toContain('--deployment-id "$PRODUCTION_PAGES_DEPLOYMENT_ID"');
		expect(productionJob).toContain('--producer-posture bound');
		expect(productionJob).toContain('--delivery-posture active');
	});

	it('proves the hidden candidate before Q, then performs trusted Q→T→C before public proofs', () => {
		const retained = productionJob.indexOf(
			'Prove retained production edge rollback capability before Q'
		);
		const hiddenLiveness = productionJob.indexOf("'https://pages-origin.commons.email/api/live'");
		const seed = productionJob.indexOf('Seed global public-discovery manifest control state');
		const graph = productionJob.indexOf('Prove exact immutable bundled graph surface');
		const cron = productionJob.indexOf('Deploy public-discovery manifest cron control Worker');
		const qualify = productionJob.indexOf('qualify-production-authority');
		const edge = productionJob.indexOf('Deploy and prove the exact trusted production edge');
		const commit = productionJob.indexOf(
			'Commit production authority as the terminal authority mutation'
		);
		const finalize = productionJob.indexOf('qualify-public-discovery-generation.mjs finalize');
		const originProof = productionJob.indexOf('Prove the exact committed production origin chain');
		const livenessProof = productionJob.indexOf("'https://commons.email/api/live'");
		const readinessProof = productionJob.indexOf('/api/health');
		const cacheProof = productionJob.indexOf('prove-public-discovery-edge-cache.mjs');
		expect(retained).toBeGreaterThan(-1);
		expect(hiddenLiveness).toBeGreaterThan(retained);
		expect(seed).toBeGreaterThan(hiddenLiveness);
		expect(seed).toBeGreaterThan(retained);
		expect(graph).toBeGreaterThan(seed);
		expect(cron).toBeGreaterThan(graph);
		expect(qualify).toBeGreaterThan(cron);
		expect(edge).toBeGreaterThan(qualify);
		expect(commit).toBeGreaterThan(edge);
		expect(finalize).toBeGreaterThan(qualify);
		expect(originProof).toBeGreaterThan(finalize);
		expect(livenessProof).toBeGreaterThan(originProof);
		expect(readinessProof).toBeGreaterThan(livenessProof);
		expect(cacheProof).toBeGreaterThan(readinessProof);
		expect(productionJob).not.toContain('observe-production');
		expect(productionJob.slice(retained, qualify)).toContain(
			'.coordinationCapture.trustedEdge.versionId'
		);
		expect(productionJob.slice(retained, qualify)).not.toContain(
			'verify-trusted-pages-release-origin-response.mjs'
		);
		expect(productionJob.slice(edge, commit)).toContain(
			'.coordinationCapture.trustedEdge == $live[0]'
		);
		expect(productionJob.slice(edge, commit)).not.toContain(
			'verify-trusted-pages-release-origin-response.mjs'
		);
		expect(productionJob.slice(0, finalize)).not.toContain('https://commons.email/api/live');
		expect(productionJob.slice(0, finalize)).not.toContain('https://commons.email/api/health');
		expect(productionJob.slice(0, finalize)).not.toContain('prove-public-discovery-edge-cache.mjs');
		expect(productionJob.slice(seed, graph)).toContain('--maximum-attempts 1');
		expect(productionJob.slice(hiddenLiveness, seed)).toContain('.release.sha == $sha');
		expect(productionJob.slice(hiddenLiveness, seed)).toContain(
			'.release.transactionId == $transaction'
		);
		expect(productionJob.slice(graph, cron)).toContain(
			"'https://pages-origin.commons.email/?view=graph'"
		);
		expect(productionJob).not.toContain("'https://commons.email/?view=graph'");
		expect(qualifier).not.toContain('observeCommittedProductionRelease');
	});

	it('keeps production qualification control-only and never seeds through candidate S', () => {
		expect(qualifier).toContain("environment === 'preview'");
		expect(qualifier).toContain(
			'Candidate runtime qualification is permitted only on the staging authority.'
		);
		expect(productionJob).toContain('.candidateRuntimeInitialized == false');
		expect(productionJob).not.toContain(
			'result=$(node gate/scripts/qualify-public-discovery-generation.mjs'
		);
	});
});
