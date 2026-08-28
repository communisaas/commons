import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/deploy.yml', 'utf8');

function jobBlock(name: string): string {
	const headers = [...workflow.matchAll(/^  ([a-zA-Z0-9_-]+):\s*$/gmu)];
	const index = headers.findIndex((match) => match[1] === name);
	expect(index, `missing workflow job ${name}`).toBeGreaterThan(-1);
	const start = headers[index].index ?? 0;
	const end = headers[index + 1]?.index ?? workflow.length;
	return workflow.slice(start, end);
}

function stepBlock(job: string, name: string): string {
	const marker = `      - name: ${name}\n`;
	const start = job.indexOf(marker);
	expect(start, `missing workflow step ${name}`).toBeGreaterThan(-1);
	const next = job.indexOf('\n      - name:', start + marker.length);
	return job.slice(start, next < 0 ? job.length : next);
}

describe('trusted Pages edge release workflow', () => {
	const preview = jobBlock('qualify-preview-generation');
	const activation = jobBlock('activate-production');
	const production = jobBlock('qualify-production-generation');

	it('deploys the immutable staging edge before the sole candidate probe', () => {
		const kit = preview.indexOf('Verify and extract staging edge qualification kit');
		const edge = preview.indexOf('Deploy and prove the exact trusted staging edge');
		const probe = preview.indexOf('Probe the inert candidate with its sole purpose capability');
		const qualify = preview.indexOf(
			'Qualify and finalize preview through trusted authority controls'
		);
		expect(kit).toBeGreaterThan(-1);
		expect(edge).toBeGreaterThan(kit);
		expect(probe).toBeGreaterThan(edge);
		expect(qualify).toBeGreaterThan(probe);

		const edgeStep = stepBlock(preview, 'Deploy and prove the exact trusted staging edge');
		expect(edgeStep).toContain('--profile trusted-pages-edge-staging');
		expect(edgeStep).toContain(
			'"$EDGE_ARTIFACT_ROOT/trusted-pages-edge-staging/index.js"'
		);
		expect(edgeStep).toContain(
			'--config gate/wrangler.trusted-pages-release-edge-staging.toml'
		);
		expect(edgeStep).toContain('--no-bundle');
		expect(edgeStep).toContain('--secrets-file "$secrets_file"');
		expect(edgeStep).toContain('PROTECTED_PAGES_ORIGIN_ACCESS_TOKEN_PREVIEW');
		expect(edgeStep).toContain('PROTECTED_RELEASE_PROBE_SECRET_PREVIEW');
		expect(edgeStep).toContain(
			'verify-trusted-pages-release-edge.mjs --environment preview'
		);
		expect(edgeStep).toContain(
			'verify-trusted-pages-release-edge.mjs verify-route-inventory'
		);
		expect(edgeStep).toContain('--expected present');
		expect(edgeStep).toContain('--expected absent');

		const probeStep = stepBlock(
			preview,
			'Probe the inert candidate with its sole purpose capability'
		);
		expect(probeStep).toContain('PROTECTED_RELEASE_PROBE_SECRET_PREVIEW');
		expect(probeStep).not.toContain('PAGES_ORIGIN_ACCESS_TOKEN');
		expect(probeStep).not.toContain('RELEASE_CONTROL_SECRET');
		expect(probeStep).not.toContain('CLOUDFLARE_API_TOKEN');
		expect(preview).not.toContain('RELEASE_ORIGIN_PROOF_SECRET');
		expect(preview).not.toContain('PROTECTED_RELEASE_ORIGIN_PROOF_SECRET_PRODUCTION');
	});

	it('proves the retained production pair before Pages activation mutates the canonical deployment', () => {
		const captureName = 'Capture production coordination rollback custody before receipt';
		const captureStep = stepBlock(activation, captureName);
		const capture = activation.indexOf(captureName);
		const mutation = activation.indexOf(
			'Execute fresh-receipt production activation transaction'
		);
		expect(capture).toBeGreaterThan(-1);
		expect(mutation).toBeGreaterThan(capture);
		expect(captureStep).toContain('baseline_missing_status');
		expect(captureStep).toContain('baseline_wrong_status');
		expect(captureStep.match(/= "421"/g)).toHaveLength(2);
		expect(captureStep).toContain(
			'verify-trusted-pages-release-origin-response.mjs'
		);
		expect(captureStep).toContain('--component "$baseline_pages_component"');
		expect(captureStep).toContain(
			'PROTECTED_RELEASE_ORIGIN_PROOF_SECRET_PRODUCTION'
		);
		expect(captureStep).not.toContain('RELEASE_CONTROL_SECRET');
		expect(captureStep).not.toContain('PAGES_ORIGIN_ACCESS_TOKEN');
		expect(captureStep).not.toContain('INTERNAL_API_SECRET');
	});

	it('orders production Q then edge proof, terminal C, and exact origin proof with disjoint capabilities', () => {
		const retained = production.indexOf(
			'Prove retained production edge rollback capability before Q'
		);
		const qualify = production.indexOf('Prove trusted production controls and qualify authority');
		const edge = production.indexOf('Deploy and prove the exact trusted production edge');
		const commit = production.indexOf(
			'Commit production authority as the terminal authority mutation'
		);
		const originProof = production.indexOf('Prove the exact committed production origin chain');
		const readiness = production.indexOf(
			'Prove committed production liveness and authenticated readiness'
		);
		const cacheProof = production.indexOf(
			'Prove committed anonymous landing cache reaches a trusted hit'
		);
		const recover = production.indexOf('Recover an interrupted authority handoff');
		expect(retained).toBeGreaterThan(-1);
		expect(qualify).toBeGreaterThan(retained);
		expect(edge).toBeGreaterThan(qualify);
		expect(commit).toBeGreaterThan(edge);
		expect(originProof).toBeGreaterThan(commit);
		expect(readiness).toBeGreaterThan(originProof);
		expect(cacheProof).toBeGreaterThan(readiness);
		expect(recover).toBeGreaterThan(cacheProof);

		const retainedStep = stepBlock(
			production,
			'Prove retained production edge rollback capability before Q'
		);
		expect(retainedStep).toContain(
			'.coordinationCapture.trustedEdge.versionId'
		);
		expect(retainedStep).toContain(
			'.coordinationCapture.trustedEdge.releaseTransaction'
		);
		expect(retainedStep).toContain(
			'verify-trusted-pages-release-edge.mjs verify-route-inventory'
		);
		expect(retainedStep).not.toContain('baseline_missing_status');
		expect(retainedStep).not.toContain(
			'verify-trusted-pages-release-origin-response.mjs'
		);
		expect(retainedStep).not.toContain(
			'PROTECTED_RELEASE_ORIGIN_PROOF_SECRET_PRODUCTION'
		);
		expect(retainedStep).not.toContain('RELEASE_CONTROL_SECRET');
		expect(retainedStep).not.toContain('PAGES_ORIGIN_ACCESS_TOKEN');
		expect(retainedStep).not.toContain('INTERNAL_API_SECRET');

		const qualifyStep = stepBlock(
			production,
			'Prove trusted production controls and qualify authority'
		);
		expect(qualifyStep).toContain('qualify-production-authority');
		expect(qualifyStep).not.toContain('PAGES_ORIGIN_ACCESS_TOKEN');
		expect(qualifyStep).not.toContain('trusted-pages-release-edge');
		expect(qualifyStep).not.toContain('qualify-public-discovery-generation.mjs finalize');

		const edgeStep = stepBlock(production, 'Deploy and prove the exact trusted production edge');
		expect(edgeStep).toContain('--profile trusted-pages-edge');
		expect(edgeStep).toContain('"$EDGE_ARTIFACT_ROOT/trusted-pages-edge/index.js"');
		expect(edgeStep).toContain('--config gate/wrangler.trusted-pages-release-edge.toml');
		expect(edgeStep).toContain('PROTECTED_PAGES_ORIGIN_ACCESS_TOKEN_PRODUCTION');
		expect(edgeStep).toContain('PROTECTED_RELEASE_ORIGIN_PROOF_SECRET_PRODUCTION');
		expect(edgeStep).toContain('RELEASE_ORIGIN_PROOF_SECRET:$proof');
		expect(edgeStep).toContain("Buffer.byteLength(proof, 'utf8')");
		expect(edgeStep).toContain('!/^[\\u0021-\\u007e]+$/u.test(proof)');
		expect(edgeStep).toContain("access['cf-access-client-secret']");
		expect(edgeStep).toContain(
			'verify-trusted-pages-release-edge.mjs --environment production'
		);
		expect(edgeStep).toContain(
			'verify-trusted-pages-release-edge.mjs verify-route-inventory'
		);
		expect(edgeStep).toContain('--expected "$prior_state"');
		expect(edgeStep).toContain('.coordinationCapture.trustedEdge == $live[0]');
		expect(edgeStep).not.toContain('baseline_missing_status');
		expect(edgeStep).not.toContain(
			'verify-trusted-pages-release-origin-response.mjs'
		);
		const edgeMutation = edgeStep.search(/\.bin\/wrangler deploy \\\s*\n/u);
		expect(edgeMutation).toBeGreaterThan(-1);
		expect(
			edgeStep.indexOf('.coordinationCapture.trustedEdge == $live[0]')
		).toBeLessThan(edgeMutation);
		expect(edgeStep.indexOf('verify-route-inventory')).toBeLessThan(
			edgeMutation
		);
		expect(edgeStep).not.toContain('RELEASE_CONTROL_SECRET');
		expect(edgeStep).not.toContain('QUEUE_FREE_ATTESTATION');
		expect(edgeStep).not.toContain('RELEASE_PROBE_SECRET');

		const commitStep = stepBlock(
			production,
			'Commit production authority as the terminal authority mutation'
		);
		expect(commitStep).toContain('PROTECTED_RELEASE_CONTROL_SECRET_PRODUCTION');
		expect(commitStep).toContain('qualify-public-discovery-generation.mjs finalize');
		expect(commitStep).not.toContain('PAGES_ORIGIN_ACCESS_TOKEN');
		expect(commitStep).not.toContain('CLOUDFLARE_API_TOKEN');
		expect(commitStep).not.toContain('RELEASE_PROBE_SECRET');
		expect(commitStep).not.toContain('RELEASE_ORIGIN_PROOF_SECRET');
		expect(commitStep).toMatch(
			/--allowed-signers gate\/\.github\/cloudflare-queue-allowed-signers >\/dev\/null(?:\n|$)/u
		);

		const originProofStep = stepBlock(
			production,
			'Prove the exact committed production origin chain'
		);
		expect(originProofStep).toContain("'https://commons.email/api/release-origin'");
		expect(originProofStep).toContain("--header 'Accept: application/json'");
		expect(originProofStep).toContain(
			"--header 'x-commons-release-origin-purpose: post-commit-v1'"
		);
		expect(originProofStep).toContain(
			'PROTECTED_RELEASE_ORIGIN_PROOF_SECRET_PRODUCTION'
		);
		expect(originProofStep).toContain(
			'--header "x-commons-release-origin-proof-secret: ${RELEASE_ORIGIN_PROOF_SECRET}"'
		);
		expect(originProofStep).toContain("Buffer.byteLength(secret, 'utf8')");
		expect(originProofStep).toContain('!/^[\\u0021-\\u007e]+$/u.test(secret)');
		expect(originProofStep).toContain(
			'verify-trusted-pages-release-origin-response.mjs'
		);
		expect(originProofStep).toContain('--component pages');
		expect(originProofStep).not.toContain('prove-public-discovery-edge-cache.mjs');
		expect(originProofStep).not.toContain('CLOUDFLARE_API_TOKEN');
		expect(originProofStep).not.toContain('RELEASE_CONTROL_SECRET');
		expect(originProofStep).not.toContain('PAGES_ORIGIN_ACCESS_TOKEN');
		expect(originProofStep).not.toContain('INTERNAL_API_SECRET');

		const readinessStep = stepBlock(
			production,
			'Prove committed production liveness and authenticated readiness'
		);
		expect(readinessStep).toContain('PROTECTED_INTERNAL_API_SECRET_PRODUCTION');
		expect(readinessStep).toContain("'https://commons.email/api/live'");
		expect(readinessStep).toContain("'https://commons.email/api/health'");
		expect(readinessStep.indexOf('/api/live')).toBeLessThan(
			readinessStep.indexOf('/api/health')
		);
		expect(readinessStep.match(/\/api\/health/g)).toHaveLength(1);
		expect(readinessStep).toContain('.release.transactionId == $transaction');
		expect(readinessStep).not.toContain('CLOUDFLARE_API_TOKEN');
		expect(readinessStep).not.toContain('RELEASE_CONTROL_SECRET');

		const cacheProofStep = stepBlock(
			production,
			'Prove committed anonymous landing cache reaches a trusted hit'
		);
		expect(cacheProofStep).toContain(
			'node gate/scripts/prove-public-discovery-edge-cache.mjs'
		);
		expect(cacheProofStep).toContain('"https://commons.email/"');
		expect(cacheProofStep).toContain('"trusted-public-discovery-cache-hit"');
		expect(cacheProofStep).not.toContain('secrets.');
		expect(cacheProofStep).not.toContain('INTERNAL_API_SECRET');
		expect(cacheProofStep).not.toContain('CLOUDFLARE_API_TOKEN');
		expect(cacheProofStep).not.toContain('RELEASE_ORIGIN_PROOF_SECRET');

		expect(
			production.match(/PROTECTED_RELEASE_ORIGIN_PROOF_SECRET_PRODUCTION/g)
		).toHaveLength(3);
	});

	it('restores an edge only after durable non-commit recovery and preserves terminal C', () => {
		for (const [job, environment] of [
			[preview, 'staging'],
			[production, 'production']
		] as const) {
			const deployStep = stepBlock(
				job,
				`Deploy and prove the exact trusted ${environment} edge`
			);
			const deployMutation = deployStep.search(/\.bin\/wrangler deploy \\\s*\n/u);
			expect(deployStep.indexOf('deployments status')).toBeLessThan(
				deployStep.indexOf('deploy-attempted')
			);
			expect(deployMutation).toBeGreaterThan(-1);
			expect(deployStep.indexOf('deploy-attempted')).toBeLessThan(deployMutation);

			const restoreName =
				environment === 'staging'
					? 'Restore the prior trusted staging edge after qualification failure'
					: 'Restore the prior trusted production edge after recovered handoff failure';
			const restore = stepBlock(job, restoreName);
			expect(restore).toContain('.recovered == true and .reason == "recovered"');
			expect(restore).toContain('preserving the current edge');
			expect(restore).toContain('wrangler rollback "$previous_version_id"');
			expect(restore).toContain('wrangler delete "$worker" --force');
			expect(restore).toContain('.versions | length == 1 and .[0].percentage == 100');
			expect(restore).toContain('/workers/routes');
			expect(restore).toContain(
				'verify-trusted-pages-release-edge.mjs verify-route-inventory'
			);
			expect(restore).toContain('--expected "$state"');
		}

		const recovery = stepBlock(production, 'Recover an interrupted authority handoff');
		expect(recovery).toContain('.reason == "committed-terminal"');
		expect(recovery).toContain('.reason == "superseded"');
		expect(production.indexOf('Recover an interrupted authority handoff')).toBeLessThan(
			production.indexOf(
				'Restore the prior trusted production edge after recovered handoff failure'
			)
		);

		const pairRestore = stepBlock(
			production,
			'Restore retained production Pages and edge as one pair after unproved C'
		);
		expect(pairRestore).toContain('.recovered == false and .reason == "committed-terminal"');
		expect(pairRestore).toContain('READINESS_PROOF_OUTCOME');
		expect(pairRestore).toContain('CACHE_PROOF_OUTCOME');
		expect(pairRestore).toContain('no retained Pages/T pair exists');
		expect(pairRestore).toContain('cloudflare-pages-production-control.mjs rollback');
		expect(pairRestore).toContain('--failed-transaction-id "$RELEASE_TRANSACTION_ID"');
		expect(pairRestore).toContain('wrangler rollback "$previous_version_id"');
		expect(pairRestore.indexOf('cloudflare-pages-production-control.mjs rollback')).toBeLessThan(
			pairRestore.indexOf('wrangler rollback "$previous_version_id"')
		);
		expect(pairRestore).toContain("'https://commons.email/api/release-origin'");
		expect(pairRestore).toContain('PROTECTED_RELEASE_ORIGIN_PROOF_SECRET_PRODUCTION');
		expect(pairRestore).toContain(
			'--header "x-commons-release-origin-proof-secret: ${RELEASE_ORIGIN_PROOF_SECRET}"'
		);
		expect(pairRestore).toContain("Buffer.byteLength(proof, 'utf8')");
		expect(pairRestore).toContain('!/^[\\u0021-\\u007e]+$/u.test(proof)');
		expect(pairRestore).toContain(
			'verify-trusted-pages-release-origin-response.mjs'
		);
		expect(pairRestore).toContain('--component "$baseline_component"');
		expect(pairRestore).not.toContain('release-rollback-proof=');
		expect(pairRestore).toContain('--data \'{"tags":["public-discovery"]}\'');
		expect(pairRestore).toContain('Optional restored-pair cache-tag purge was unavailable');
		expect(pairRestore).toContain('continuing with release-qualified cache proof');
		expect(pairRestore).not.toContain('purge_response=$(curl -fsS');
		expect(pairRestore).toContain("'https://commons.email/api/live'");
		expect(pairRestore).toContain("'https://commons.email/api/health'");
		expect(pairRestore.match(/\/api\/health/g)).toHaveLength(1);
		expect(pairRestore).toContain('node gate/scripts/prove-public-discovery-edge-cache.mjs');
		expect(
			pairRestore.match(/verify-trusted-pages-release-edge\.mjs verify-route-inventory/g)
		).toHaveLength(2);
		expect(pairRestore.match(/--expected present/g)).toHaveLength(2);
		expect(pairRestore).toContain('-u INTERNAL_API_SECRET');
		expect(pairRestore.indexOf('/purge_cache')).toBeLessThan(
			pairRestore.indexOf('node gate/scripts/prove-public-discovery-edge-cache.mjs')
		);
		expect(pairRestore).not.toContain('wrangler delete "$worker" --force');
		expect(workflow).not.toContain(
			'select(.script == $worker or .pattern == $route)'
		);
	});
});
