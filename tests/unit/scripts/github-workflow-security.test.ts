import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const WORKFLOW_DIRECTORY = '.github/workflows';
const workflowPaths = readdirSync(WORKFLOW_DIRECTORY)
	.filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
	.map((name) => join(WORKFLOW_DIRECTORY, name))
	.sort();

const workflows = new Map(workflowPaths.map((path) => [basename(path), readFileSync(path, 'utf8')]));

function jobBlocks(source: string) {
	const jobsMarker = '\njobs:\n';
	const jobsIndex = source.indexOf(jobsMarker);
	expect(jobsIndex, 'workflow must contain a jobs mapping').toBeGreaterThan(-1);
	const jobsSource = source.slice(jobsIndex + jobsMarker.length);
	const headers = [...jobsSource.matchAll(/^  ([a-zA-Z0-9_-]+):\s*$/gm)];
	return new Map(
		headers.map((match, index) => {
			const start = match.index ?? 0;
			const end = headers[index + 1]?.index ?? jobsSource.length;
			return [match[1], jobsSource.slice(start, end)];
		})
	);
}

describe('GitHub workflow security contract', () => {
	it('pins every external action to an exact commit with a readable version comment', () => {
		expect(workflowPaths.length).toBeGreaterThan(0);
		for (const [name, source] of workflows) {
			for (const [index, line] of source.split('\n').entries()) {
				const match = line.match(/^\s*-?\s*uses:\s*([^\s#]+)(?:\s+#\s*(.+))?\s*$/);
				if (!match) continue;
				const target = match[1];
				if (target.startsWith('./')) continue;
				if (target.startsWith('docker://')) {
					expect(target, `${name}:${index + 1} must pin a Docker image digest`).toMatch(
						/@sha256:[a-f0-9]{64}$/
					);
					continue;
				}
				expect(target, `${name}:${index + 1} uses a mutable external action ref`).toMatch(
					/^[^@\s]+@[a-f0-9]{40}$/
				);
				expect(match[2], `${name}:${index + 1} must retain a human-readable version comment`).toMatch(
					/^v\d+(?:\.|\b)/
				);
			}
		}
	});

	it('declares least privilege and isolates the only PR-write coverage job from source execution', () => {
		const allowedWrites = new Set(['ci.yml:pull-requests']);
		const observedWrites = new Set<string>();

		for (const [name, source] of workflows) {
			const jobsIndex = source.indexOf('\njobs:\n');
			const workflowHeader = source.slice(0, jobsIndex);
			const jobs = jobBlocks(source);
			const hasWorkflowPermissions = /^permissions:\s*(?:\{\}|$)/m.test(workflowHeader);
			if (!hasWorkflowPermissions) {
				for (const [jobName, job] of jobs) {
					expect(job, `${name}:${jobName} must declare permissions explicitly`).toMatch(
						/^    permissions:\s*(?:\{\}|$)/m
					);
				}
			}

			for (const match of source.matchAll(/^\s+([a-z-]+):\s+write\s*$/gm)) {
				observedWrites.add(`${name}:${match[1]}`);
			}
			expect(source, `${name} must not use a blanket token permission`).not.toMatch(
				/^permissions:\s+(?:write-all|read-all)\s*$/m
			);
		}

		expect(observedWrites).toEqual(allowedWrites);

		const ci = workflows.get('ci.yml') ?? '';
		const ciJobs = jobBlocks(ci);
		const testJob = ciJobs.get('test') ?? '';
		const commentJob = ciJobs.get('coverage-comment') ?? '';
		expect(testJob).not.toMatch(/^\s+[a-z-]+:\s+write\s*$/m);
		expect(testJob).not.toContain('${{ secrets.');
		expect(commentJob).toContain('pull-requests: write');
		expect(commentJob).not.toMatch(/^\s+run:/m);
		expect(commentJob).not.toContain('actions/checkout@');
		expect(commentJob).not.toContain('${{ secrets.');
	});

	it('does not persist checkout credentials into jobs that receive real secrets', () => {
		for (const [name, source] of workflows) {
			for (const [jobName, job] of jobBlocks(source)) {
				if (!job.includes('${{ secrets.')) continue;
				const checkoutSteps = job
					.split(/\n(?=      - )/)
					.filter((step) => step.includes('actions/checkout@'));
				for (const step of checkoutSteps) {
					expect(
						step,
						`${name}:${jobName} must remove the checkout token before secret-bearing work`
					).toContain('persist-credentials: false');
				}
			}
		}
	});

	it('runs the exact work-budget and native-limit ratchets in CI and deploy verification', () => {
		const ci = workflows.get('ci.yml') ?? '';
		const deploy = workflows.get('deploy.yml') ?? '';
		for (const [name, source] of [
			['ci', ci],
			['deploy', deploy]
		] as const) {
			const install = source.indexOf('run: npm ci');
			const budget = source.indexOf('run: npm run check:convex-work-budget', install);
			const nativeLimit = source.indexOf(
				'run: npm run check:convex-native-usage-limit-config',
				install
			);
			expect(install, `${name} install`).toBeGreaterThan(-1);
			expect(budget, `${name} budget ratchet`).toBeGreaterThan(install);
			expect(nativeLimit, `${name} native-limit ratchet`).toBeGreaterThan(budget);
		}
	});

	it('does not execute a manually selected Pages-guard ref with the Cloudflare token', () => {
		const guard = workflows.get('pages-exposure-guard.yml') ?? '';
		const reconcile = jobBlocks(guard).get('reconcile') ?? '';
		expect(reconcile).toContain('github.ref_name == github.event.repository.default_branch');
		expect(reconcile).toContain('environment: Production');
		expect(reconcile).toContain('ref: ${{ github.workflow_sha }}');
		expect(reconcile).toContain('TRUSTED_GATE_SHA: ${{ github.workflow_sha }}');
		expect(reconcile).not.toContain('vars.RELEASE_GATE_SHA');
		expect(reconcile).toContain('path: gate');
		expect(reconcile).toContain('fetch-depth: 0');
		expect(reconcile).toContain('persist-credentials: false');
		expect(reconcile).toContain('[ "$TRUSTED_GATE_SHA" != "$trusted_default" ]');
		expect(reconcile).not.toContain('merge-base --is-ancestor');
		expect(reconcile).toContain('node gate/scripts/reconcile-cloudflare-pages-exposure.mjs');
		const ancestryProof = reconcile.indexOf(
			'Authenticate immutable exposure gate before gate-owned execution'
		);
		expect(ancestryProof).toBeLessThan(reconcile.indexOf('Setup trusted Node.js runtime'));
		expect(ancestryProof).toBeLessThan(
			reconcile.indexOf('node gate/scripts/reconcile-cloudflare-pages-exposure.mjs')
		);
	});

	it('keeps candidate lifecycle out of the credential-bearing Pages job', () => {
		const deployWorkflow = workflows.get('deploy.yml') ?? '';
		const jobs = jobBlocks(deployWorkflow);
		const sourceVerify = jobs.get('source-verify') ?? '';
		const candidateClosure = jobs.get('build-candidate-closure') ?? '';
		const buildArtifact = jobs.get('build-artifact') ?? '';
		const deploy = jobs.get('deploy') ?? '';

		expect(sourceVerify).toContain('TRUSTED_GATE_SHA: ${{ github.workflow_sha }}');
		expect(sourceVerify).toContain('ref: ${{ github.workflow_sha }}');
		expect(sourceVerify).not.toContain('vars.RELEASE_GATE_SHA');
		expect(sourceVerify).toContain('--repository-git-dir "$CANDIDATE_GIT_DIR"');
		expect(sourceVerify).toContain('--source-commit-sha "$verified_sha"');
		expect(sourceVerify).toContain('node gate/scripts/verify-release-hypergraph.mjs');
		expect(sourceVerify).toContain('BRUTALIST_EXPECTED_BASE_SHA="$TRUSTED_GATE_SHA"');
		expect(sourceVerify).not.toContain('node scripts/verify-release-hypergraph.mjs');

		expect(candidateClosure).toContain('ref: ${{ needs.source-verify.outputs.verified_sha }}');
		expect(candidateClosure).toContain('npm run build');
		expect(candidateClosure).toContain('actions/upload-artifact@');
		expect(candidateClosure).not.toContain('path: gate');
		expect(candidateClosure).not.toContain('gate/scripts/');
		expect(candidateClosure).not.toContain('${{ secrets.');
		expect(candidateClosure).not.toMatch(/^    environment:/m);

		expect(buildArtifact).toContain('needs: [source-verify, manual-verify, build-candidate-closure]');
		expect(buildArtifact).toContain('Checkout immutable finalization authority');
		expect(buildArtifact).toContain('actions/download-artifact@');
		expect(buildArtifact).toContain('npm ci --ignore-scripts --prefix source');
		expect(buildArtifact).toContain('verify-release-candidate-lockfile.mjs');
		expect(buildArtifact).toContain('node gate/scripts/finalize-pages-release-artifact.mjs');
		expect(buildArtifact).not.toContain('npm run build');
		expect(buildArtifact).not.toContain('npx wrangler');
		expect(buildArtifact).toContain('actions/upload-artifact@');
		expect(buildArtifact).not.toContain('${{ secrets.');
		expect(buildArtifact).not.toMatch(/^    environment:/m);

		expect(deploy).toContain('environment:');
		expect(deploy).toContain('ref: ${{ needs.source-verify.outputs.trusted_gate_sha }}');
		expect(deploy).toContain('path: gate');
		expect(deploy).not.toContain('actions/download-artifact@');
		expect(deploy).toContain('generate-trusted-containment-worker.mjs');
		expect(deploy).toContain('validate-pages-release-artifact.mjs');
		expect(deploy).toContain(
			'gate/.github/release-gate/node_modules/.bin/wrangler" pages deploy "$ARTIFACT_ROOT/pages"'
		);
		expect(deploy).toContain('npm ci --ignore-scripts --prefix gate/.github/release-gate');
		expect(deploy).not.toContain('ref: ${{ env.DEPLOY_REF }}');
		expect(deploy).not.toMatch(/\bnpm run\b|\bnpx wrangler\b|node scripts\//);
		expect(deploy).not.toContain('--preserve-deployment-id');
	});

	it('authenticates trusted gate ancestry before reading or executing gate-owned files', () => {
		const deployWorkflow = workflows.get('deploy.yml') ?? '';
		const sourceVerify = jobBlocks(deployWorkflow).get('source-verify') ?? '';
		const ancestryProof = sourceVerify.indexOf(
			'Authenticate immutable gate before any gate-owned execution'
		);
		const nodeSetup = sourceVerify.indexOf('Setup trusted Node.js runtime');
		const authorityVerifier = sourceVerify.indexOf('verify-github-release-authority.mjs');

		expect(sourceVerify).toContain('fetch-depth: 0');
		expect(sourceVerify).toContain('refs/remotes/origin/${DEFAULT_BRANCH}^{commit}');
		expect(sourceVerify).toContain('[ "$TRUSTED_GATE_SHA" != "$trusted_default" ]');
		expect(sourceVerify).toContain('[ "$TRUSTED_GATE_SHA" != "$trusted_default_head" ]');
		expect(sourceVerify).not.toContain(
			'git -C gate merge-base --is-ancestor "$TRUSTED_GATE_SHA" "$trusted_default"'
		);
		expect(ancestryProof).toBeGreaterThan(-1);
		expect(ancestryProof).toBeLessThan(nodeSetup);
		expect(ancestryProof).toBeLessThan(authorityVerifier);
	});

	it('uses only newly enrolled protected-environment control credentials', () => {
		const controlled = ['deploy.yml', 'pages-exposure-guard.yml', 'cloudflare-branch-alias.yml'];
		for (const name of controlled) {
			const source = workflows.get(name) ?? '';
			for (const match of source.matchAll(/\$\{\{ secrets\.([A-Z0-9_]+) \}\}/g)) {
				expect(match[1], `${name} references a legacy repository-secret name`).toMatch(
					/^PROTECTED_/
				);
			}
		}
		const alias = jobBlocks(workflows.get('cloudflare-branch-alias.yml') ?? '').get('reconcile') ?? '';
		expect(alias).toContain('github.ref_name == github.event.repository.default_branch');
		expect(alias).toContain('environment: Staging');
		expect(alias).toContain('EXPECTED_COMMIT: ${{ inputs.expected_commit }}');
	});

	it('keeps broad Convex dashboard authority operator-local and verifies detached quota evidence from the immutable gate', () => {
		const jobs = jobBlocks(workflows.get('deploy.yml') ?? '');
		const deploy = jobs.get('deploy') ?? '';
		const quotaJobs = [
			jobs.get('production-queue-preflight') ?? '',
			jobs.get('activate-production') ?? ''
		];
		expect(deploy).not.toContain('CONVEX_DASHBOARD_ACCESS_TOKEN');
		expect(deploy).not.toContain('PROTECTED_CONVEX_TEAM_QUOTA_ATTESTATION_B64');
		for (const job of quotaJobs) {
			expect(job).toContain('PROTECTED_CONVEX_TEAM_QUOTA_ATTESTATION_B64');
			expect(job).toContain('PROTECTED_CONVEX_TEAM_QUOTA_SIGNATURE_B64');
			expect(job).toContain('PROTECTED_CONVEX_USAGE_LIMITS_VIEW_TOKEN');
			expect(job).toContain('gate/.github/convex-quota-allowed-signers');
			expect(job).not.toContain('node scripts/verify-convex-native-usage-limits.mjs');
			expect(job.match(/node gate\/scripts\/verify-convex-native-usage-limits\.mjs/g)).toHaveLength(
				1
			);
			expect(job.match(/--purpose full-normal-release/g)).toHaveLength(1);
		}
	});

	it('validates active manifest-cron version ids before CLI or environment reuse', () => {
		const jobs = jobBlocks(workflows.get('deploy.yml') ?? '');
		const preflight = jobs.get('production-queue-preflight') ?? '';
		const qualification = jobs.get('qualify-production-generation') ?? '';
		const containment = jobs.get('deploy') ?? '';
		const versionPattern =
			'^([a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$';
		const captureStart = preflight.indexOf(
			'      - name: Capture exact manifest cron rollback baseline'
		);
		const captureEnd = preflight.indexOf(
			'      - name: Seal production preflight handoff before receipt capture',
			captureStart
		);
		const deployStart = qualification.indexOf(
			'      - name: Deploy public-discovery manifest cron control Worker'
		);
		const deployEnd = qualification.indexOf(
			'      - name: Prove trusted production controls and qualify authority',
			deployStart
		);
		expect(captureStart).toBeGreaterThanOrEqual(0);
		expect(captureEnd).toBeGreaterThan(captureStart);
		expect(deployStart).toBeGreaterThanOrEqual(0);
		expect(deployEnd).toBeGreaterThan(deployStart);
		for (const step of [
			preflight.slice(captureStart, captureEnd),
			qualification.slice(deployStart, deployEnd)
		]) {
			expect(step).toContain(`select(test("${versionPattern}"))`);
			expect(step.indexOf('select(test(')).toBeLessThan(step.indexOf('wrangler versions view'));
		}
		expect(containment).not.toContain('manifest cron');
	});

	it('keeps Brutalist diagnostic verification base-owned and proof-ref immutable', () => {
		for (const [name, source] of workflows) {
			if (name === 'brutalist-review.yml') continue;
			expect(source, `${name} must not silently introduce pull_request_target`).not.toMatch(
				/^\s*pull_request_target:/m
			);
		}
		const brutalist = workflows.get('brutalist-review.yml') ?? '';
		expect(brutalist).toContain('name: Brutalist Review (diagnostic)');
		expect(brutalist).toMatch(/^\s*pull_request_target:/m);
		expect(brutalist).toContain('types: [opened, synchronize, reopened, ready_for_review]');
		expect(brutalist).toContain('ref: ${{ github.event.pull_request.base.sha }}');
		expect(brutalist).toContain('path: gate');
		expect(brutalist).toContain('persist-credentials: false');
		expect(brutalist).toContain('SOURCE_SHA: ${{ github.event.pull_request.head.sha }}');
		expect(brutalist).toContain(
			'attestation_ref="refs/heads/brutalist-attestations/$SOURCE_SHA"'
		);
		expect(brutalist).toContain(
			'"+$attestation_ref:refs/brutalist/fetched-proof"'
		);
		expect(brutalist).toContain(
			"rev-parse --verify 'refs/brutalist/fetched-proof^{commit}'"
		);
		expect(brutalist).toContain('echo "proof_commit_sha=$proof_commit_sha" >> "$GITHUB_OUTPUT"');
		expect(brutalist).toContain(
			'BRUTALIST_PROOF_COMMIT_SHA: ${{ steps.fetch_inert_objects.outputs.proof_commit_sha }}'
		);
		expect(brutalist).toContain(
			'BRUTALIST_EXPECTED_BASE_SHA: ${{ github.event.pull_request.base.sha }}'
		);
		expect(brutalist).toContain(
			'BRUTALIST_EXPECTED_HEAD_SHA: ${{ github.event.pull_request.head.sha }}'
		);
		expect(brutalist).toContain(
			'BRUTALIST_EXPECTED_REPOSITORY_ID: ${{ github.repository_id }}'
		);
		expect(brutalist).toContain(
			'BRUTALIST_EXPECTED_REPOSITORY_SLUG: ${{ github.repository }}'
		);
		expect(brutalist).toContain(
			'BRUTALIST_REPOSITORY_GIT_DIR: ${{ runner.temp }}/commons-candidate.git'
		);
		expect(brutalist).toContain('run: node gate/scripts/verify-brutalist-attestation.mjs');
		expect(brutalist).toContain('ordinary Actions contexts can be spoofed');
		expect(brutalist).not.toContain('${{ secrets.');
		expect(brutalist).not.toMatch(/^\s+[a-z-]+:\s+write\s*$/m);
		expect(brutalist).not.toMatch(/npm install|curl\s/);
		expect(brutalist).not.toContain('ref: ${{ github.event.pull_request.head.sha }}');
		expect(brutalist).not.toContain('node scripts/verify-brutalist-attestation.mjs');
		expect(brutalist).not.toContain('BASE_REF:');
		expect(brutalist).not.toContain('refs/heads/$BASE_REF');
	});
});
