import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/deploy.yml', 'utf8');
const artifactValidator = readFileSync('scripts/validate-pages-release-artifact.mjs', 'utf8');
const releasePhaseRunner = readFileSync(
	'scripts/run-public-template-og-release-phase.mjs',
	'utf8'
);
const trustedReleasePackage = JSON.parse(
	readFileSync('.github/release-gate/package.json', 'utf8')
);
const trustedReleaseLock = JSON.parse(
	readFileSync('.github/release-gate/package-lock.json', 'utf8')
);

function jobBlocks(source: string) {
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

function expectCandidateClosureBuilder(job: string, cacheName: string, artifactName: string) {
	expect(job).toContain('needs: [source-verify, manual-verify]');
	expect(job).toContain('runs-on: ubuntu-latest');
	expect(job).toContain('permissions:\n      contents: read');
	expect(job).not.toMatch(/^    environment:/m);
	expect(job).not.toContain('${{ secrets.');
	expect(job).not.toMatch(/^\s+[a-z-]+:\s+write\s*$/m);
	expect(job).not.toContain('actions/download-artifact@');
	expect(job).not.toContain('actions/cache@');
	expect(job).not.toContain('cache: npm');
	expect(job).toContain(`NPM_CONFIG_CACHE=$RUNNER_TEMP/${cacheName}`);
	expect(job).toContain('ref: ${{ needs.source-verify.outputs.verified_sha }}');
	expect(job).toContain('path: candidate');
	expect(job).not.toContain('needs.source-verify.outputs.trusted_gate_sha');
	expect(job).not.toContain('path: gate');
	expect(job.match(/persist-credentials: false/g)).toHaveLength(1);
	expect(job).toContain('working-directory: candidate');
	expect(job).toContain('run: npm ci');
	expect(job).toContain('run: npm run build');
	expect(job).toContain("needs.source-verify.outputs.deploy_mode == 'normal'");
	expect(job).toContain("if: env.DEPLOY_MODE == 'normal'");
	expect(job).toContain('VITE_RUNTIME_CONTAINMENT_MODE: disabled');
	expect(job).not.toContain('generate-trusted-containment-worker.mjs');
	expect(job).toContain('cp -R candidate/.svelte-kit/cloudflare candidate-closure/.svelte-kit/cloudflare');
	expect(job).toContain('cp -R candidate/.svelte-kit/output/server candidate-closure/.svelte-kit/output/server');
	expect(job).toContain('cp -R candidate/.svelte-kit/cloudflare-tmp candidate-closure/.svelte-kit/cloudflare-tmp');
	expect(job).not.toContain('finalize-pages-release-artifact.mjs');
	expect(job).not.toContain('finalize-public-template-og-release-artifact.mjs');
	expect(job).not.toContain('canonical-artifact-tree-digest.mjs');
	expect(job).not.toContain('release-metadata.json');
	expect(job).not.toContain('npx wrangler');
	expect(job).toContain(`name: ${artifactName}`);
	expect(job).toContain('artifact_id: ${{ steps.upload_candidate_closure.outputs.artifact-id }}');
	expect(job).not.toContain('artifact_digest:');
	expect(job).toContain('path: candidate-closure/');
}

function expectTrustedFinalizer(
	job: string,
	candidateJob: string,
	cacheName: string,
	artifactName: string
) {
	expect(job).toContain(`needs: [source-verify, manual-verify, ${candidateJob}]`);
	expect(job).toContain(`needs.${candidateJob}.result == 'success'`);
	expect(job).toContain('runs-on: ubuntu-latest');
	expect(job).toContain('permissions:\n      actions: read\n      contents: read');
	expect(job).not.toMatch(/^    environment:/m);
	expect(job).not.toContain('${{ secrets.');
	expect(job).not.toContain('actions/cache@');
	expect(job).not.toContain('cache: npm');
	expect(job).toContain(`NPM_CONFIG_CACHE=$RUNNER_TEMP/${cacheName}`);
	expect(job).toContain('ref: ${{ needs.source-verify.outputs.verified_sha }}');
	expect(job).toContain('path: source');
	expect(job).toContain('ref: ${{ needs.source-verify.outputs.trusted_gate_sha }}');
	expect(job).toContain('path: gate');
	expect(job.match(/persist-credentials: false/g)).toHaveLength(2);
	expect(job).toContain('actions/download-artifact@');
	expect(job).toContain(`artifact-ids: \${{ needs.${candidateJob}.outputs.artifact_id }}`);
	expect(job).toContain('path: ${{ runner.temp }}/candidate-closure');
	expect(job).toContain('npm ci --ignore-scripts --prefix gate/.github/release-gate');
	expect(job).toContain('verify-release-candidate-lockfile.mjs');
	expect(job).toContain('npm ci --ignore-scripts --prefix source');
	expect(job).toContain('--registry=https://registry.npmjs.org/');
	expect(job).not.toContain('npm run build');
	expect(job).not.toContain('working-directory: candidate');
	expect(job).not.toContain('npx wrangler');
	expect(job).not.toContain('--outfile');
	expect(job).toContain('node gate/scripts/finalize-trusted-release-worker.mjs');
	expect(job).toContain('--profile manifest-gate');
	expect(job).toContain('--profile manifest-gate-nonprod');
	expect(job).toContain('--profile convex-work-budget');
	expect(job).toContain('--profile manifest-cron');
	expect(job).toContain("finalizationBoundary: 'fresh-runner-trusted-finalization-v1'");
	expect(job).toContain('trustedGateSha: process.env.TRUSTED_GATE_SHA');
	expect(job).toContain('node gate/scripts/finalize-pages-release-artifact.mjs');
	expect(job).toContain('--svelte-build-root "$RUNNER_TEMP/candidate-closure/.svelte-kit"');
	expect(job).toContain('--candidate-node-modules source/node_modules');
	expect(job).toContain('--candidate-lockfile source/package-lock.json');
	expect(job).toContain('node gate/scripts/finalize-public-template-og-release-artifact.mjs');
	expect(job).toContain('--candidate-root source');
	expect(job).toContain('--trusted-config gate/wrangler.public-template-og.toml');
	expect(job).toContain('node gate/scripts/canonical-artifact-tree-digest.mjs');
	expect(job).toContain('--normalize-modes');
	expect(job).toContain(`name: ${artifactName}`);
	expect(job).toContain('artifact_id: ${{ steps.upload_release_artifact.outputs.artifact-id }}');
	expect(job).toContain('artifact_digest: ${{ steps.digest_release_artifact.outputs.digest }}');
	expect(job.indexOf('--normalize-modes')).toBeLessThan(job.indexOf('actions/upload-artifact@'));
	const finalizer = job.indexOf('node gate/scripts/finalize-pages-release-artifact.mjs');
	const digest = job.indexOf('- name: Normalize and digest canonical release artifact');
	const upload = job.indexOf('- name: Upload trusted-finalized output as inert data');
	expect(finalizer).toBeGreaterThan(
		job.indexOf('- name: Assemble executable workers only with immutable T tooling')
	);
	expect(finalizer).toBeLessThan(digest);
	expect(digest).toBeLessThan(upload);
	expect(job.slice(digest, upload).match(/\n      - name:/g) ?? []).toHaveLength(0);
}

function stepBlock(job: string, name: string) {
	const marker = `\n      - name: ${name}\n`;
	const markerStart = job.indexOf(marker);
	const start = markerStart < 0 ? -1 : markerStart + 1;
	expect(start, `missing workflow step ${name}`).toBeGreaterThan(-1);
	const end = job.indexOf('\n      - name:', start + 1);
	return job.slice(start, end < 0 ? job.length : end);
}

describe('reproducible release artifact workflow', () => {
	const jobs = jobBlocks(workflow);
	const candidatePrimary = jobs.get('build-candidate-closure') ?? '';
	const candidateReplica = jobs.get('build-candidate-closure-replica') ?? '';
	const primary = jobs.get('build-artifact') ?? '';
	const replica = jobs.get('build-artifact-replica') ?? '';
	const consensus = jobs.get('artifact-consensus') ?? '';
	const releaseKit = jobs.get('prepare-queue-release-kit') ?? '';
	const activatePreview = jobs.get('activate-preview') ?? '';
	const qualifyPreview = jobs.get('qualify-preview-generation') ?? '';
	const productionPreflight = jobs.get('production-queue-preflight') ?? '';
	const bootstrapProduction = jobs.get('bootstrap-production-discovery') ?? '';
	const activateProduction = jobs.get('activate-production') ?? '';
	const qualifyProduction = jobs.get('qualify-production-generation') ?? '';
	const manualVerify = jobs.get('manual-verify') ?? '';
	const deploy = jobs.get('deploy') ?? '';

	it('never checks out, installs, or executes candidate source for containment', () => {
		expect(manualVerify).toContain("needs.source-verify.outputs.deploy_mode == 'normal'");
		expect(manualVerify).toContain('Checkout source-verified SHA');
		expect(manualVerify).toContain('npm ci');
		expect(deploy).not.toContain('- manual-verify');
		expect(deploy).not.toContain('needs.manual-verify');
	});

	it('builds exact S twice on independent untrusted runners and finalizes twice under fresh T', () => {
		expectCandidateClosureBuilder(
			candidatePrimary,
			'npm-cache-primary',
			'pages-candidate-closure-primary-${{ needs.source-verify.outputs.verified_sha }}'
		);
		expectCandidateClosureBuilder(
			candidateReplica,
			'npm-cache-replica',
			'pages-candidate-closure-replica-${{ needs.source-verify.outputs.verified_sha }}'
		);
		expectTrustedFinalizer(
			primary,
			'build-candidate-closure',
			'npm-cache-finalizer-primary',
			'pages-release-primary-${{ needs.source-verify.outputs.verified_sha }}-${{ needs.source-verify.outputs.deploy_mode }}'
		);
		expectTrustedFinalizer(
			replica,
			'build-candidate-closure-replica',
			'npm-cache-finalizer-replica',
			'pages-release-replica-${{ needs.source-verify.outputs.verified_sha }}-${{ needs.source-verify.outputs.deploy_mode }}'
		);
		expect(candidatePrimary).not.toContain('build-candidate-closure-replica');
		expect(candidateReplica).not.toContain('needs.build-candidate-closure');
		expect(primary).not.toContain('build-candidate-closure-replica');
		expect(replica).not.toMatch(/needs\.build-candidate-closure\.(?:result|outputs)/);
		expect(trustedReleasePackage.dependencies.wrangler).toBe('4.112.0');
		expect(trustedReleaseLock.packages[''].dependencies.wrangler).toBe('4.112.0');
		expect(trustedReleaseLock.packages['node_modules/wrangler']).toMatchObject({
			version: '4.112.0',
			resolved: 'https://registry.npmjs.org/wrangler/-/wrangler-4.112.0.tgz',
			integrity:
				'sha512-5H+XUD0TySCv1LuktFHDIEOkboH2nTfQs+35L+USt3MtntjDTMVIJprLgQcL2WBjulOyjxpd1vyTiSTJVW5MjQ=='
		});
	});

	it('keeps containment entirely out of both candidate builders and consensus', () => {
		for (const builder of [candidatePrimary, candidateReplica, primary, replica]) {
			expect(builder).toContain("needs.source-verify.outputs.deploy_mode == 'normal'");
			expect(builder).not.toContain('generate-trusted-containment-worker.mjs');
			expect(builder).not.toContain('containment');
		}
		expect(consensus).toContain("needs.source-verify.outputs.deploy_mode == 'normal'");
		expect(consensus).not.toContain('containment');
		expect(consensus).not.toContain('finalize-pages-release-artifact.mjs');
	});

	it('makes a forged same-runner Worker or finalization record unable to cross the authority boundary', () => {
		for (const candidate of [candidatePrimary, candidateReplica]) {
			expect(candidate).not.toContain('release-artifact/pages');
			expect(candidate).not.toContain('pages-finalization.json');
			expect(candidate).not.toContain('release-metadata.json');
			expect(candidate).not.toContain('gate/scripts/');
		}
		for (const finalizer of [primary, replica]) {
			expect(finalizer).toContain('Checkout immutable finalization authority');
			expect(finalizer).toContain('Download candidate closure by immutable artifact id');
			expect(finalizer).toContain('rm -rf release-artifact');
			expect(finalizer).toContain('mkdir -p release-artifact/pages');
			expect(finalizer).not.toContain('candidate/.svelte-kit');
			expect(finalizer).not.toContain('source/node_modules/.bin');
		}
		expect(releaseKit).toContain(
			'artifact-ids: ${{ needs.build-artifact.outputs.artifact_id }}'
		);
		expect(deploy).not.toContain('artifact-ids: ${{ needs.build-artifact.outputs.artifact_id }}');
		expect(deploy).not.toContain('needs.build-candidate-closure.outputs.artifact_id');
		expect(deploy).not.toContain('needs.build-candidate-closure-replica.outputs.artifact_id');
	});

	it('generates, digests, and validates containment only inside the trusted secret job', () => {
		expect(deploy).toContain("needs.source-verify.outputs.deploy_mode == 'containment'");
		expect(deploy).toContain("needs.build-artifact.result == 'skipped'");
		expect(deploy).toContain("needs.build-artifact-replica.result == 'skipped'");
		expect(deploy).toContain("needs.artifact-consensus.result == 'skipped'");
		expect(deploy).toContain('Generate and prove trusted containment artifact locally');
		expect(deploy).toContain('node gate/scripts/generate-trusted-containment-worker.mjs');
		expect(deploy).toContain('--output-directory "$ARTIFACT_ROOT/pages"');
		expect(deploy).toContain('--normalize-modes');
		expect(deploy).toContain('Validate locally generated containment artifact');
		expect(deploy).toContain('TRUSTED_PUBLIC_CONVEX_URL="$PUBLIC_CONVEX_URL"');
		expect(deploy).not.toContain("env.DEPLOY_MODE == 'normal'");
		expect(deploy).not.toContain('Download candidate artifact as inert data');
		expect(deploy).not.toContain('Verify consensus-approved canonical artifact');
		expect(deploy).not.toContain('verify-public-discovery-readiness.mjs');
		expect(deploy).not.toContain('verify-convex-contained-cron-deployments.mjs');
		expect(deploy).not.toContain('Deploy public-discovery manifest cron control Worker');
		expect(deploy.indexOf('Generate and prove trusted containment artifact locally')).toBeLessThan(
			deploy.indexOf('Upload containment artifact to staging preflight authority')
		);
		expect(deploy.indexOf('Validate locally generated containment artifact')).toBeLessThan(
			deploy.indexOf('Upload containment artifact to staging preflight authority')
		);
	});

	it('encodes reachable staging, production, and containment DAGs without an advertised main no-op', () => {
		for (const previewJob of [releaseKit, activatePreview]) {
			expect(previewJob).toContain("needs.source-verify.outputs.deploy_mode == 'normal'");
			expect(previewJob).toContain("inputs.branch == 'production'");
			expect(previewJob).toContain("inputs.branch == 'staging'");
			expect(previewJob).toContain("github.event.workflow_run.head_branch == 'staging'");
			expect(previewJob).not.toContain("inputs.branch == 'main'");
			expect(previewJob).not.toContain("github.event.workflow_run.head_branch == 'main'");
		}
		expect(qualifyPreview).toContain('- activate-preview');
		expect(qualifyPreview).toContain("needs.activate-preview.result == 'success'");

		for (const productionJob of [
			productionPreflight,
			bootstrapProduction,
			activateProduction,
			qualifyProduction
		]) {
			expect(productionJob).toContain("needs.source-verify.outputs.deploy_mode == 'normal'");
			expect(productionJob).toContain("inputs.branch == 'production'");
			expect(productionJob).not.toContain("inputs.branch == 'staging'");
			expect(productionJob).not.toContain(
				"github.event.workflow_run.head_branch == 'production'"
			);
			expect(productionJob).not.toContain("github.event.workflow_run.head_branch == 'staging'");
		}
		expect(productionPreflight).toContain('- qualify-preview-generation');
		expect(bootstrapProduction).toContain('- production-queue-preflight');
		expect(activateProduction).toContain('- bootstrap-production-discovery');
		expect(activateProduction).toContain('- production-queue-preflight');
		expect(qualifyProduction).toContain('- activate-production');

		expect(workflow).not.toContain('          - main\n');
		expect(workflow).not.toContain('branches: [main, staging]');
		expect(deploy).toContain("needs.source-verify.outputs.deploy_mode == 'containment'");
		expect(deploy).toContain("github.event_name == 'workflow_dispatch'");
		expect(deploy).toContain("needs.activate-preview.result == 'skipped'");
	});

	it('recomputes both canonical trees under trusted T and exports one consensus digest', () => {
		expect(consensus).toContain(
			'needs: [source-verify, manual-verify, build-artifact, build-artifact-replica]'
		);
		expect(consensus).toContain("needs.source-verify.outputs.deploy_mode == 'normal'");
		expect(consensus).toContain('needs.build-artifact.result == \'success\'');
		expect(consensus).toContain('needs.build-artifact-replica.result == \'success\'');
		expect(consensus).toContain('actions: read');
		expect(consensus).toContain('contents: read');
		expect(consensus).not.toContain('${{ secrets.');
		expect(consensus).not.toMatch(/^    environment:/m);
		expect(consensus).toContain(
			'artifact-ids: ${{ needs.build-artifact.outputs.artifact_id }}'
		);
		expect(consensus).toContain(
			'artifact-ids: ${{ needs.build-artifact-replica.outputs.artifact_id }}'
		);
		expect(consensus).toContain('--expected-digest "$PRIMARY_DECLARED_DIGEST"');
		expect(consensus).toContain('--expected-digest "$REPLICA_DECLARED_DIGEST"');
		expect(consensus).toContain('if [ "$primary_digest" != "$replica_digest" ]; then');
		expect(consensus).toContain(
			'artifact_digest: ${{ steps.verify_artifact_consensus.outputs.digest }}'
		);
		expect(consensus).not.toContain('--normalize-modes');
		expect(consensus).not.toContain('npm ci');
		expect(consensus).not.toContain('npm run build');
	});

	it('allows the immutable release kit to consume only the primary artifact proven by consensus', () => {
		expect(releaseKit).toContain('- build-artifact-replica');
		expect(releaseKit).toContain('- artifact-consensus');
		expect(releaseKit).toContain("needs.artifact-consensus.result == 'success'");
		expect(releaseKit).toContain(
			'ARTIFACT_DIGEST: ${{ needs.artifact-consensus.outputs.artifact_digest }}'
		);
		expect(releaseKit).toContain(
			'artifact-ids: ${{ needs.build-artifact.outputs.artifact_id }}'
		);
		expect(releaseKit).not.toContain(
			'artifact-ids: ${{ needs.build-artifact-replica.outputs.artifact_id }}'
		);
		const consensusVerify = releaseKit.indexOf('- name: Build canonical immutable Queue release kit');
		const expectedDigest = releaseKit.indexOf('--expected-digest "$ARTIFACT_DIGEST"', consensusVerify);
		const kitArchive = releaseKit.indexOf('queue-release-kit.tar', expectedDigest);
		const kitUpload = releaseKit.indexOf('- name: Upload immutable Queue release kit');
		expect(expectedDigest).toBeGreaterThan(consensusVerify);
		expect(kitArchive).toBeGreaterThan(expectedDigest);
		expect(kitUpload).toBeGreaterThan(kitArchive);
		expect(releaseKit).not.toContain('finalize-pages-release-artifact.mjs');
		for (const activation of [activatePreview, activateProduction]) {
			expect(activation).toContain(
				'artifact-ids: ${{ needs.prepare-queue-release-kit.outputs.artifact_id }}'
			);
			expect(activation).not.toContain('needs.build-artifact.outputs.artifact_id');
			expect(activation).toContain('--expected-digest "$ARTIFACT_DIGEST"');
			expect(activation).toContain('run-public-template-og-release-phase.mjs');
		}
		expect(releasePhaseRunner).not.toContain('finalize-pages-release-artifact.mjs');
		expect(releasePhaseRunner).toContain('validateFinalizedPublicTemplateOgArtifact(root, ogConfig)');
		expect(artifactValidator).toContain('validateTrustedReleaseWorkerArtifact(');
		expect(artifactValidator).toContain("'manifest-gate-nonprod'");
		expect(artifactValidator).toContain("'manifest-gate'");
		expect(artifactValidator).toContain(
			"validateTrustedReleaseWorkerArtifact(tree.root, trustedSourceRoot, 'convex-work-budget')"
		);
		expect(artifactValidator).toContain(
			"validateTrustedReleaseWorkerArtifact(tree.root, trustedSourceRoot, 'manifest-cron')"
		);
	});

	it('uploads only the already-canonical Pages tree with bundling disabled', () => {
		const pageDeploys = deploy.match(/pages deploy "\$ARTIFACT_ROOT\/pages"/g) ?? [];
		expect(pageDeploys).toHaveLength(3);
		for (const name of [
			'Upload containment artifact to staging preflight authority',
			'Deploy containment artifact',
			'Forward-redeploy proven containment after publication failure'
		]) {
			const step = stepBlock(deploy, name);
			const digest = step.indexOf('canonical-artifact-tree-digest.mjs');
			const upload = step.indexOf('pages deploy "$ARTIFACT_ROOT/pages"');
			expect(digest, `${name} must re-prove the canonical tree`).toBeGreaterThan(-1);
			expect(upload, `${name} must upload the canonical Pages directory`).toBeGreaterThan(digest);
			expect(step.slice(upload)).toContain('--no-bundle');
			expect(step).not.toContain('npm run build');
			expect(step).not.toContain('finalize-pages-release-artifact.mjs');
		}

		const runPhase = releasePhaseRunner.slice(
			releasePhaseRunner.indexOf('export async function runPublicTemplateOgReleasePhase')
		);
		const digest = runPhase.indexOf('canonical-artifact-tree-digest.mjs');
		const artifactValidation = runPhase.indexOf(
			'validateFinalizedPublicTemplateOgArtifact(root, ogConfig)'
		);
		const pagesUpload = runPhase.indexOf("'pages',\n\t\t\t\t'deploy'");
		expect(digest).toBeGreaterThan(-1);
		expect(artifactValidation).toBeGreaterThan(digest);
		expect(pagesUpload).toBeGreaterThan(artifactValidation);
		expect(runPhase.slice(pagesUpload, pagesUpload + 500)).toContain("'--no-bundle'");
		expect(runPhase.slice(0, pagesUpload)).not.toContain('npm run build');
	});

	it('deploys OG consumers from the finalized artifact before exposing Queue producers', () => {
		const runPhase = releasePhaseRunner.slice(
			releasePhaseRunner.indexOf('export async function runPublicTemplateOgReleasePhase')
		);
		const queueCapture = runPhase.indexOf('capturePublicTemplateOgQueues({');
		const workerCapture = runPhase.indexOf('capturePublicTemplateOgWorkers({', queueCapture);
		const provision = runPhase.indexOf('provisionPublicTemplateOgQueues({', workerCapture);
		const consumerDeploy = runPhase.indexOf('const consumerArgs = [', provision);
		const pagesDeploy = runPhase.indexOf("'pages',\n\t\t\t\t'deploy'", consumerDeploy);
		const boundProof = runPhase.indexOf("deploymentProof('bound', 'paused')", pagesDeploy);
		const activateQueues = runPhase.indexOf('activatePublicTemplateOgQueues({', boundProof);

		expect(queueCapture).toBeGreaterThan(-1);
		expect(workerCapture).toBeGreaterThan(queueCapture);
		expect(provision).toBeGreaterThan(workerCapture);
		expect(consumerDeploy).toBeGreaterThan(provision);
		expect(pagesDeploy).toBeGreaterThan(consumerDeploy);
		expect(boundProof).toBeGreaterThan(pagesDeploy);
		expect(activateQueues).toBeGreaterThan(boundProof);
		expect(runPhase.slice(consumerDeploy, pagesDeploy)).toContain(
			"path.join(root, 'public-template-og-consumer/index.js')"
		);
		expect(runPhase.slice(consumerDeploy, pagesDeploy)).toContain("'--no-bundle'");
		expect(runPhase.slice(consumerDeploy, pagesDeploy)).toContain(
			"deploymentProof('compatible', 'paused')"
		);
		expect(runPhase.slice(pagesDeploy, activateQueues)).toContain(
			"deploymentProof('bound', 'paused')"
		);
		expect(activatePreview).toContain('--realm preview');
		expect(activateProduction).toContain('--realm production');
	});

	it('restores Queue state before rolling back or deleting an attempted OG Worker', () => {
		const recovery = releasePhaseRunner.slice(
			releasePhaseRunner.indexOf('export async function recoverPublicTemplateOgReleasePhase'),
			releasePhaseRunner.indexOf('export async function runPublicTemplateOgReleasePhase')
		);
		const pagesContainment = recovery.indexOf("runRecoveryStep('pages'");
		const queueRestore = recovery.indexOf("runRecoveryStep('queues'");
		const workerRestore = recovery.indexOf("runRecoveryStep('consumer'");
		expect(pagesContainment).toBeGreaterThan(-1);
		expect(queueRestore).toBeGreaterThan(pagesContainment);
		expect(workerRestore).toBeGreaterThan(queueRestore);
		const queueStep = recovery.slice(queueRestore, workerRestore);
		const workerStep = recovery.slice(workerRestore);
		expect(queueStep.indexOf('pausePublicTemplateOgQueues({')).toBeLessThan(
			queueStep.indexOf('restorePublicTemplateOgQueues({')
		);
		expect(workerStep).toContain('restorePublicTemplateOgWorker({');
		expect(workerStep).toContain('failedSourceSha: journal.sourceSha');
		expect(workerStep).toContain('failedTransactionId: journal.transactionId');
	});
});
