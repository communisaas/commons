import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/deploy.yml', 'utf8');
const branchAliasWorkflow = readFileSync('.github/workflows/cloudflare-branch-alias.yml', 'utf8');
const hooksSource = readFileSync('src/hooks.server.ts', 'utf8');
const clientHooksSource = readFileSync('src/hooks.client.ts', 'utf8');
const rootLayoutSource = readFileSync('src/routes/+layout.svelte', 'utf8');
const convexModuleSource = readFileSync('src/lib/convex.ts', 'utf8');
const viteConfig = readFileSync('vite.config.ts', 'utf8');
const healthEndpoint = readFileSync('src/routes/api/health/+server.ts', 'utf8');
const liveEndpoint = readFileSync('src/routes/api/live/+server.ts', 'utf8');
const releasePhaseSource = readFileSync('scripts/run-public-template-og-release-phase.mjs', 'utf8');
const gateConfig = readFileSync('wrangler.public-discovery-manifest-gate.toml', 'utf8');
const nonprodGateConfig = readFileSync(
	'wrangler.public-discovery-manifest-gate-nonprod.toml',
	'utf8'
);
const cronConfig = readFileSync('wrangler.public-discovery-manifest.toml', 'utf8');
const pagesConfig = readFileSync('wrangler.toml', 'utf8');
const containmentConfig = readFileSync('wrangler.containment.toml', 'utf8');
const publicDynamicRateLimitPolicy = readFileSync(
	'config/cloudflare-public-dynamic-rate-limit.json',
	'utf8'
);
const r2LifecycleSource = readFileSync(
	'scripts/reconcile-public-discovery-r2-lifecycle.mjs',
	'utf8'
);

function workflowStep(name: string, nextName: string): string {
	const start = workflow.indexOf(`      - name: ${name}`);
	const end = workflow.indexOf(`      - name: ${nextName}`, start + 1);
	if (start < 0 || end < 0) throw new Error(`Missing deploy workflow step: ${name}`);
	return workflow.slice(start, end);
}

function workflowStepToJobEnd(name: string, nextJob: string): string {
	const start = workflow.indexOf(`      - name: ${name}`);
	const end = workflow.indexOf(`\n  ${nextJob}:`, start + 1);
	if (start < 0 || end < 0) throw new Error(`Missing terminal deploy workflow step: ${name}`);
	return workflow.slice(start, end);
}

function workflowJob(name: string, nextName: string): string {
	const start = workflow.indexOf(`\n  ${name}:`);
	const end = workflow.indexOf(`\n  ${nextName}:`, start + 1);
	if (start < 0 || end < 0) throw new Error(`Missing deploy workflow job: ${name}`);
	return workflow.slice(start, end);
}

function workflowLastJob(name: string): string {
	const start = workflow.indexOf(`\n  ${name}:`);
	if (start < 0) throw new Error(`Missing terminal deploy workflow job: ${name}`);
	return workflow.slice(start);
}

function namedStepInJob(job: string, jobName: string, stepName: string): string {
	const marker = `\n      - name: ${stepName}\n`;
	const markerStart = job.indexOf(marker);
	const start = markerStart < 0 ? -1 : markerStart + 1;
	if (start < 0) throw new Error(`Missing ${jobName} workflow step: ${stepName}`);
	const end = job.indexOf('\n      - name:', start + 1);
	return job.slice(start, end < 0 ? job.length : end);
}

function workflowNamedStepInJob(jobName: string, nextJob: string, stepName: string): string {
	return namedStepInJob(workflowJob(jobName, nextJob), jobName, stepName);
}

describe('deployment health contract', () => {
	it('inlines the exact source-verified SHA into the uploaded Worker artifact', () => {
		const step = workflowStep(
			'Build candidate artifact without deployment credentials',
			'Stage only bounded ordinary Svelte output as inert data'
		);

		expect(step).toContain('VITE_RELEASE_SHA: ${{ needs.source-verify.outputs.verified_sha }}');
		expect(viteConfig).toContain("'import.meta.env.VITE_RELEASE_SHA': JSON.stringify(RELEASE_SHA)");
		expect(healthEndpoint).toContain(
			'const BUILD_RELEASE_SHA = import.meta.env.VITE_RELEASE_SHA as string | undefined;'
		);
		expect(liveEndpoint).toContain(
			'const BUILD_RELEASE_SHA = import.meta.env.VITE_RELEASE_SHA as string | undefined;'
		);
		expect(liveEndpoint).toContain('sha: exactReleaseSha(BUILD_RELEASE_SHA),');
		expect(liveEndpoint).toContain(
			'transactionId: exactReleaseTransaction(platform?.env?.PUBLIC_RELEASE_TRANSACTION_ID)'
		);
		expect(healthEndpoint).not.toContain('env?.RELEASE_SHA');
		expect(workflow).toContain(
			'.release.sha == $sha and .release.transactionId == $transaction'
		);
	});

	it('pins each reachable normal realm to its private Standard R2 bucket', () => {
		const previewActivation = workflowJob('activate-preview', 'qualify-preview-generation');
		const productionPreflight = workflowJob(
			'production-queue-preflight',
			'bootstrap-production-discovery'
		);

		for (const job of [previewActivation, productionPreflight]) {
			expect(job).toContain("needs.source-verify.outputs.deploy_mode == 'normal'");
			expect(job).toContain('reconcile-public-discovery-r2-lifecycle.mjs');
		}

		expect(previewActivation).toContain('--environment preview');
		expect(previewActivation).not.toContain('--environment all');
		expect(productionPreflight).toContain('--environment all');
		expect(r2LifecycleSource).toContain(
			'PUBLIC_DISCOVERY_R2_BUCKETS.production !== PUBLIC_DISCOVERY_R2_BUCKETS.preview'
		);
		expect(r2LifecycleSource).toContain("return environment === 'all' ? REALMS : [environment]");
		expect(r2LifecycleSource).toContain("bucket.storage_class === 'Standard'");
		expect(r2LifecycleSource).toContain('`${bucketBase}/domains/managed`');
		expect(r2LifecycleSource).toContain('managed.enabled === false');
		expect(r2LifecycleSource).toContain('`${bucketBase}/domains/custom`');
		expect(r2LifecycleSource).toContain('Array.isArray(domains)');
		expect(r2LifecycleSource).toContain('domain.enabled === false');
	});

	it('fails every normal custom-authority release closed on the Free-plan dynamic shield', () => {
		const step = workflowStep(
			'Prove Cloudflare public dynamic route cost shield',
			'Prove Cloudflare pages.dev origin closure'
		);
		expect(step).toContain("if: env.DEPLOY_MODE == 'normal'");
		expect(step).not.toContain("DEPLOY_BRANCH != 'main'");
		expect(step).toContain('verify-cloudflare-public-dynamic-rate-limit.mjs');
		expect(step).toContain('--policy gate/config/cloudflare-public-dynamic-rate-limit.json');
		expect(step).toContain(
			'--inventory gate/config/anonymous-dynamic-route-cost-inventory.json'
		);
		expect(step).toContain('secrets.PROTECTED_CLOUDFLARE_WAF_READ_TOKEN');
		expect(workflow.match(/verify-cloudflare-public-dynamic-rate-limit\.mjs/g)).toHaveLength(1);
		expect(workflow.indexOf('Prove Cloudflare public dynamic route cost shield')).toBeLessThan(
			workflow.indexOf('\n  manual-verify:')
		);
		const policy = JSON.parse(publicDynamicRateLimitPolicy);
		expect(policy.zone).toEqual({
			accountId: '019d1184e655db74b7589794a2a2a533',
			name: 'commons.email',
			plan: 'Free Website'
		});
		expect(policy.ruleset.rules).toHaveLength(1);
		expect(policy.ruleset.rules[0].expression).toContain('/s/');
		expect(policy.ruleset.rules[0].expression).toContain('/template-modal/');
		expect(policy.ruleset.scope.exactPaths).toEqual(
			expect.arrayContaining(['/', '/api/templates', '/browse', '/directory', '/governance', '/org'])
		);
		expect(policy.ruleset.scope.prefixes).toEqual(
			expect.arrayContaining([
				'/c/',
				'/d/',
				'/dm/',
				'/e/',
				'/embed/',
				'/n/',
				'/og/',
				'/api/templates/',
				'/api/debates/',
				'/api/positions/count/'
			])
		);
		expect(policy.ruleset.rules[0].ratelimit.requests_to_origin).toBe(false);
	});

	it('fails every branch and mode closed on direct pages.dev exposure', () => {
		const step = workflowStep(
			'Prove Cloudflare pages.dev origin closure',
			'Resolve source SHA and verify detached attestation'
		);
		expect(step).not.toMatch(/^\s*if:/m);
		expect(step).not.toContain('env.DEPLOY_MODE');
		expect(step).not.toContain('env.DEPLOY_BRANCH');
		expect(step).toContain('verify-cloudflare-pages-dev-origin-closure.mjs');
		expect(step).toContain('--policy gate/config/cloudflare-pages-dev-origin-closure.json');
		expect(step).toContain(
			'secrets.PROTECTED_CLOUDFLARE_ORIGIN_CLOSURE_READ_TOKEN'
		);
		expect(workflow.match(/verify-cloudflare-pages-dev-origin-closure\.mjs/g)).toHaveLength(1);
		expect(workflow.indexOf('Prove Cloudflare pages.dev origin closure')).toBeLessThan(
			workflow.indexOf('\n  manual-verify:')
		);
	});

	it('proves live GitHub release authority before any Environment job is eligible', () => {
		const step = workflowStep(
			'Verify live GitHub release authority before environment eligibility',
			'Prove Cloudflare public dynamic route cost shield'
		);
		expect(workflow.slice(workflow.indexOf('  source-verify:'), workflow.indexOf('\n  manual-verify:'))).toContain(
			'actions: read'
		);
		expect(step).toContain('/environments/$release_environment');
		expect(step).toContain('/deployment-branch-policies?per_page=100&page=1');
		expect(step).toContain('/branches/main/protection');
		expect(step).toContain(
			'RELEASE_AUTHORITY_TOKEN: ${{ secrets.PROTECTED_GITHUB_RELEASE_AUTHORITY_READ_TOKEN }}'
		);
		expect(step).toContain('Authorization: Bearer ${RELEASE_AUTHORITY_TOKEN}');
		expect(step).not.toContain('Authorization: Bearer ${GITHUB_TOKEN}');
		expect(step).toContain('PROTECTED_GITHUB_RELEASE_AUTHORITY_READ_TOKEN is required');
		expect(step).toContain('curl -fsS');
		expect(step).toContain('verify-github-release-authority.mjs');
		expect(step).toContain('--environment "$release_environment"');
		expect(workflow.indexOf('Verify live GitHub release authority')).toBeLessThan(
			workflow.indexOf('\n  manual-verify:')
		);
	});

	it('rejects missing or enabled custom-domain API fixtures', () => {
		const expression =
			'.success == true and (.result.domains | type == "array") and all(.result.domains[]; .enabled == false)';
		const accepts = (value: unknown) =>
			spawnSync('jq', ['-e', expression], {
				encoding: 'utf8',
				input: JSON.stringify(value)
			}).status === 0;
		expect(accepts({ success: true, result: { domains: [] } })).toBe(true);
		expect(accepts({ success: true, result: { domains: [{ enabled: false }] } })).toBe(true);
		expect(accepts({ success: true, result: {} })).toBe(false);
		expect(accepts({ success: true, result: { domains: [{ enabled: true }] } })).toBe(false);
		expect(accepts({ success: true, result: { domains: [{}] } })).toBe(false);
	});

	it('validates Atlas pins from immutable T in both independent finalizers', () => {
		const primary = workflowNamedStepInJob(
			'build-artifact',
			'build-candidate-closure-replica',
			'Resolve trusted public finalization inputs'
		);
		const replica = workflowNamedStepInJob(
			'build-artifact-replica',
			'artifact-consensus',
			'Resolve trusted public finalization inputs'
		);

		for (const step of [primary, replica]) {
			const envWrite = step.indexOf("with open(os.environ['GITHUB_ENV']");
			expect(envWrite).toBeGreaterThan(0);
			expect(step).toContain('production) public_convex_url=');
			expect(step).toContain('staging) public_convex_url=');
			expect(step).toContain('*) echo "::error::Unsupported build branch."; exit 1 ;;');
			expect(step).toContain("with open('gate/wrangler.toml', 'rb') as source:");
			expect(step).toContain('tomllib.load(source)');
			expect(step).not.toContain('.deployment_configs.production.env_vars');
			for (const proof of [
				"re.fullmatch(r'https://atlas\\.commons\\.email/v[0-9]{8}'",
				"expected['VITE_ATLAS_BASE_URL'] != expected['ATLAS_BASE_URL']",
				"re.fullmatch(r'0x[0-9a-fA-F]{64}'",
				"str(expected['EXPECTED_CELL_MAP_DEPTH']) not in {'18', '20', '22', '24'}"
			]) {
				expect(step.indexOf(proof), `${proof} must precede GITHUB_ENV`).toBeGreaterThan(0);
				expect(step.indexOf(proof), `${proof} must precede GITHUB_ENV`).toBeLessThan(envWrite);
			}
		}
	});

	it('polls committed production propagation through I/O-free exact-tuple liveness', () => {
		const step = workflowNamedStepInJob(
			'qualify-production-generation',
			'deploy',
			'Prove committed production liveness and authenticated readiness'
		);
		const readinessStart = step.indexOf('if ! response=$(curl');
		const liveness = step.slice(0, readinessStart);
		const finalAttempt = step.indexOf('if [ "$attempt" = "12" ]; then');
		const failure = step.indexOf('The terminal production edge did not converge on exact-tuple liveness.');
		const exit = step.indexOf('exit 1', failure);
		const retrySleep = step.indexOf('sleep 5', exit);

		expect(readinessStart).toBeGreaterThan(0);
		expect(liveness).toContain('for attempt in {1..12}; do');
		expect(liveness).toContain('https://commons.email/api/live');
		expect(liveness).toContain('--arg sha "$DEPLOY_SHA"');
		expect(liveness).toContain('--arg transaction "$RELEASE_TRANSACTION_ID"');
		expect(liveness).toContain('.release.sha == $sha');
		expect(liveness).toContain('.release.transactionId == $transaction');
		expect(liveness).not.toContain('/api/health');
		expect(liveness).not.toContain('X-Internal-Secret');
		expect(finalAttempt).toBeGreaterThan(0);
		expect(failure).toBeGreaterThan(finalAttempt);
		expect(exit).toBeGreaterThan(failure);
		expect(retrySleep).toBeGreaterThan(exit);
	});

	it('requires the production custom domain to expose R2 and isolated-cookie readiness', () => {
		const step = workflowStep(
			'Prove committed production liveness and authenticated readiness',
			'Prove committed anonymous landing cache reaches a trusted hit'
		);
		const readinessStart = step.indexOf('if ! response=$(curl');
		const readiness = step.slice(readinessStart);

		expect(step).toContain(
			'INTERNAL_API_SECRET: ${{ secrets.PROTECTED_INTERNAL_API_SECRET_PRODUCTION }}'
		);
		expect(readinessStart).toBeGreaterThan(0);
		expect(readiness).toContain('-H "X-Internal-Secret: ${INTERNAL_API_SECRET}"');
		expect(readiness.match(/\/api\/health/g)).toHaveLength(1);
		expect(readiness).not.toContain('for attempt in');
		expect(readiness).toContain('.status == "ok"');
		expect(readiness).toContain('.release.sha == $sha');
		expect(readiness).toContain('.release.transactionId == $transaction');
		expect(readiness).toContain('.publicDiscoveryCache.r2Bound == true');
		expect(readiness).toContain('.publicDiscoveryCache.refreshGateBound == true');
		expect(readiness).toContain('.publicDiscoveryCache.workBudgetBound == true');
		expect(readiness).toContain('.publicDiscoveryCache.publication.healthy == true');
		expect(readiness).toContain('.sessionCookieAuthority.keysIsolated == true');
		expect(readiness).toContain('.convexRealm == "production"');
		expect(readiness).not.toContain('challenge');
		expect(readiness).not.toContain('|| true');
	});

	it('spends one authenticated production readiness probe after a purpose-only preview probe', () => {
		const previewProbe = workflowStep(
			'Probe the inert candidate with its sole purpose capability',
			'Qualify and finalize preview through trusted authority controls'
		);
		const productionReadiness = workflowStep(
			'Prove committed production liveness and authenticated readiness',
			'Prove committed anonymous landing cache reaches a trusted hit'
		);

		expect(previewProbe).toContain(
			'RELEASE_PROBE_SECRET: ${{ secrets.PROTECTED_RELEASE_PROBE_SECRET_PREVIEW }}'
		);
		expect(previewProbe).toContain('--environment preview');
		expect(previewProbe).toContain('--source-sha "$DEPLOY_SHA"');
		expect(previewProbe).toContain('--transaction-id "$RELEASE_TRANSACTION_ID"');
		expect(previewProbe).not.toContain('/api/health');
		expect(productionReadiness.match(/\/api\/health/g)).toHaveLength(1);
		expect(productionReadiness).toContain('https://commons.email/api/live');
		expect(productionReadiness).toContain('.release.transactionId == $transaction');
		expect(productionReadiness).not.toContain('complete external release smoke');
	});

	it('fails closed unless the active production landing proof reaches a trusted cache hit', () => {
		const step = workflowNamedStepInJob(
			'qualify-production-generation',
			'deploy',
			'Prove committed anonymous landing cache reaches a trusted hit'
		);

		expect(step).toContain('prove-public-discovery-edge-cache.mjs');
		expect(step).toContain('.proof == "trusted-public-discovery-cache-hit"');
		expect(step).toContain('.cacheStatus == "hit"');
		expect(step).toContain('(.attempts | type == "number" and . >= 1 and . <= 12)');
		expect(step).toContain('(.age | type == "number" and . >= 0 and . <= 59)');
		expect(step).not.toContain('INTERNAL_API_SECRET');
		expect(step).not.toContain('CLOUDFLARE_API_TOKEN');
		expect(step).not.toContain('complete it externally');
	});

	it('retires the direct staging Pages alias and proves exclusive trusted-edge ownership', () => {
		expect(branchAliasWorkflow).toContain('group: cloudflare-pages-publication');
		expect(branchAliasWorkflow).toContain("public_host='staging.commons.email'");
		expect(branchAliasWorkflow).toContain("worker='commons-trusted-pages-edge-staging'");
		expect(branchAliasWorkflow).toContain(
			'verify-trusted-pages-release-edge.mjs verify-route-inventory'
		);
		expect(branchAliasWorkflow).toContain('--environment preview');
		expect(branchAliasWorkflow).toContain('--expected present');
		expect(branchAliasWorkflow).not.toContain(
			'select(.script == $worker or .pattern == $route)'
		);
		expect(branchAliasWorkflow).toContain(
			'/pages/projects/${project}/domains/${public_host}'
		);
		expect(branchAliasWorkflow).toContain('cf_mutate DELETE');
		expect(branchAliasWorkflow).toContain("--arg content '100::'");
		expect(branchAliasWorkflow).toContain("'{type:$type,name:$name,content:$content,proxied:true,ttl:1}'");
		expect(branchAliasWorkflow).toContain(
			'["pages-origin-staging.commons.email","pages-origin.commons.email"]'
		);
		expect(branchAliasWorkflow).toContain(
			'verify-trusted-pages-release-edge.mjs --environment preview'
		);
		expect(branchAliasWorkflow).toContain('.annotations["workers/tag"] == $sha');
		expect(branchAliasWorkflow).not.toContain('staging.communique-site.pages.dev');
		expect(branchAliasWorkflow).not.toContain('branch_alias_target');
		expect(branchAliasWorkflow).not.toContain('RELEASE_PROBE_SECRET');
		expect(branchAliasWorkflow).not.toContain('/api/release-candidate');
		expect(branchAliasWorkflow).not.toContain('INTERNAL_API_SECRET');
	});

	it('versions the preview gate transactionally and proves the preflight-owned production gate', () => {
		const activation = workflowStep(
			'Execute fresh-receipt production activation transaction',
			'Recover an interrupted production activation from its durable journal'
		);
		const recovery = workflowStep(
			'Recover an interrupted production activation from its durable journal',
			'Persist production recovery journal for generation qualification'
		);
		const captureIndex = releasePhaseSource.indexOf(
			'gateCapture = await captureGateWorker({'
		);
		const previewBranchIndex = releasePhaseSource.indexOf(
			"if (realm === 'preview') {",
			captureIndex
		);
		const intentIndex = releasePhaseSource.indexOf(
			"await markAttempted('gate', 'intent-gate')",
			previewBranchIndex
		);
		const authorityIndex = releasePhaseSource.indexOf(
			"await authorizeMutation('baseline-contained')",
			intentIndex
		);
		const deployIndex = releasePhaseSource.indexOf('gateArtifact,', authorityIndex);
		const productionProofIntentIndex = releasePhaseSource.indexOf(
			"await appendRecoveryStage('intent-gate')",
			deployIndex
		);

		expect(activation).toContain('run-public-template-og-release-phase.mjs');
		expect(activation).toContain('--realm production');
		expect(activation).toContain('--transaction-id "$RELEASE_TRANSACTION_ID"');
		expect(activation).toContain(
			'--journal "$RUNNER_TEMP/public-template-og-production-release-journal.json"'
		);
		expect(recovery).toContain('run-public-template-og-release-phase.mjs recover');
		expect(recovery).toContain('--transaction-id "$RELEASE_TRANSACTION_ID"');
		expect(captureIndex).toBeGreaterThan(0);
		expect(previewBranchIndex).toBeGreaterThan(captureIndex);
		expect(intentIndex).toBeGreaterThan(captureIndex);
		expect(authorityIndex).toBeGreaterThan(intentIndex);
		expect(deployIndex).toBeGreaterThan(authorityIndex);
		expect(productionProofIntentIndex).toBeGreaterThan(deployIndex);
		expect(releasePhaseSource).toMatch(/'--tag',\s+sourceSha/u);
		expect(releasePhaseSource).toContain(
			'activeGate.releaseSha === sourceSha && activeGate.releaseTransaction === transactionId'
		);
		expect(releasePhaseSource).toContain(
			"await runRecoveryStep('gate', async () => ({ status: gateState }))"
		);
		expect(releasePhaseSource).toContain(
			'Gate schema is forward-only. Retaining the exact transaction gate preserves'
		);
		expect(gateConfig).toContain('workers_dev = false');
		expect(gateConfig).toContain('preview_urls = false');
		expect(cronConfig).toContain('workers_dev = false');
		expect(cronConfig).toContain('preview_urls = false');
	});

	it('keeps emergency containment pages-only and strips every application binding', () => {
		const artifact = workflowStep(
			'Assemble executable workers only with immutable T tooling',
			'Finalize self-contained Pages Worker and enforce compressed limit'
		);
		expect(artifact).not.toContain('containment');
		expect(artifact).not.toContain('generate-trusted-containment-worker.mjs');
		expect(artifact).not.toContain('npx wrangler');
		expect(artifact).not.toContain('--outfile');
		const standalone = workflowStep(
			'Finalize fixed-profile standalone Workers under immutable T',
			'Finalize self-contained Pages Worker and enforce compressed limit'
		);
		expect(standalone).toContain('node gate/scripts/finalize-trusted-release-worker.mjs');
		expect(standalone).toContain('--profile manifest-gate');
		expect(standalone).toContain('--profile manifest-gate-nonprod');
		expect(standalone).toContain('--profile convex-work-budget');
		expect(standalone).toContain('--profile manifest-cron');
		const containmentArtifact = workflowStep(
			'Generate and prove trusted containment artifact locally',
			'Validate locally generated containment artifact'
		);
		expect(containmentArtifact).toContain("if: env.DEPLOY_MODE == 'containment'");
		expect(containmentArtifact).toContain(
			'node gate/scripts/generate-trusted-containment-worker.mjs'
		);
		expect(containmentArtifact).toContain('--output-directory "$ARTIFACT_ROOT/pages"');
		expect(containmentArtifact).toContain('canonical-artifact-tree-digest.mjs');
		expect(containmentArtifact).toContain('--normalize-modes');
		const preflightBinding = workflowStep(
			'Verify containment preflight has no application bindings',
			'Capture previous production canonical deployment'
		);
		expect(preflightBinding).toContain('verify-pages-containment-bindings.mjs');
		expect(preflightBinding).toContain('--environment preview');
		const preflightUpload = workflowStep(
			'Upload containment artifact to staging preflight authority',
			'Prove isolated containment preflight on staging custom authority'
		);
		const preflightRuntime = workflowStep(
			'Prove isolated containment preflight on staging custom authority',
			'Verify containment preflight has no application bindings'
		);
		expect(preflightUpload).toContain('--branch staging');
		expect(preflightRuntime).toContain('DEPLOY_BRANCH=staging');
		expect(preflightRuntime).toContain('verify-pages-preview-release.mjs');
		expect(preflightRuntime).toContain(
			'verify-containment-deployment.mjs \\\n            --url "https://staging.commons.email"'
		);
		expect(containmentConfig).not.toMatch(/^\s*\[\[/m);
		expect(containmentConfig).not.toMatch(/^\s*\[(?:vars|env\.)/m);
		for (const capability of [
			'kv_namespaces',
			'r2_buckets',
			'durable_objects',
			'd1_databases',
			'services'
		]) {
			expect(containmentConfig).not.toMatch(new RegExp(`^\\s*${capability}\\s*=`, 'm'));
		}
	});

	it('runtime-proves the exact artifact on isolated preview before production activation', () => {
		const previewActivation = workflowStep(
			'Execute receipt-scoped preview activation transaction',
			'Recover an interrupted preview activation from its durable journal'
		);
		const previewPublication = workflowStep(
			'Prove exact inert Pages publication before candidate dispatch',
			'Deploy and prove the exact trusted staging edge'
		);
		const candidateProof = workflowStep(
			'Probe the inert candidate with its sole purpose capability',
			'Qualify and finalize preview through trusted authority controls'
		);
		const productionActivation = workflowStep(
			'Execute fresh-receipt production activation transaction',
			'Recover an interrupted production activation from its durable journal'
		);

		expect(previewActivation).toContain('--realm preview');
		expect(previewActivation).toContain('--branch staging');
		expect(previewActivation).toContain('--transaction-id "$RELEASE_TRANSACTION_ID"');
		expect(previewActivation).toContain('.stagingRuntimeProved == false');
		expect(previewActivation).toContain('.candidateFetchProved == false');
		expect(previewPublication).toContain('DEPLOY_BRANCH=staging DEPLOY_SHA="$DEPLOY_SHA"');
		expect(previewPublication).toContain('verify-pages-preview-release.mjs');
		expect(previewPublication).toContain(
			'verify-pages-durable-object-binding.mjs --environment preview'
		);
		expect(candidateProof).toContain('--environment preview');
		expect(candidateProof).toContain('--source-sha "$DEPLOY_SHA"');
		expect(candidateProof).toContain('--transaction-id "$RELEASE_TRANSACTION_ID"');
		expect(candidateProof).toContain('.proof == "candidate-fetch-completed"');
		expect(productionActivation).toContain('--realm production');
		expect(productionActivation).toContain('--branch production');
		expect(productionActivation).toContain(
			'--preview-pages-deployment-id "${{ needs.qualify-preview-generation.outputs.pages_deployment_id }}"'
		);
		expect(productionActivation).toContain(
			'--preview-proof "${{ needs.qualify-preview-generation.outputs.proof }}"'
		);
		expect(productionActivation).toContain('.candidateFetchProved == true');
		for (const [jobName, nextJob] of [
			['build-artifact', 'build-candidate-closure-replica'],
			['build-artifact-replica', 'artifact-consensus']
		] as const) {
			const job = workflowJob(jobName, nextJob);
			const proofCall = job.indexOf(
				'node gate/scripts/verify-runtime-neutral-client-realm.mjs'
			);
			const proofStart = job.lastIndexOf('\n      - name:', proofCall);
			const proofEnd = job.indexOf('\n      - name:', proofCall);
			const clientRealmProof = job.slice(proofStart, proofEnd);
			expect(proofStart, `${jobName} must prove its finalized client realm`).toBeGreaterThan(0);
			expect(proofEnd).toBeGreaterThan(proofCall);
			expect(clientRealmProof).toContain('verify-runtime-neutral-client-realm.mjs');
			expect(clientRealmProof).toContain('--pages-directory release-artifact/pages');
			expect(clientRealmProof).toContain('--forbidden-origin');
			expect(proofCall).toBeLessThan(
				job.indexOf('Normalize and digest canonical release artifact')
			);
		}
		expect(workflow).not.toContain('Require exact-SHA staging preview deployment metadata');
		expect(workflow).not.toContain('Prove exact-SHA staging custom runtime prerequisite');
		expect(hooksSource).toContain(
			'ensureConvexInitialized(event.platform?.env?.PUBLIC_CONVEX_URL ?? PUBLIC_CONVEX_URL)'
		);
		expect(healthEndpoint).toContain("'https://outstanding-firefly-831.convex.cloud'");
		for (const source of [clientHooksSource, rootLayoutSource, convexModuleSource]) {
			expect(source).toContain("from '$env/dynamic/public'");
			expect(source).not.toContain("from '$env/static/public'");
			expect(source).not.toContain('https://quirky-chinchilla-352.convex.cloud');
		}
	});

	it('fail-closes the production, staging, and containment authority matrix without main as a target', () => {
		const sourceAuthority = workflowStep(
			'Resolve source SHA and verify detached attestation',
			'Checkout source-verified SHA'
		);
		const releaseKit = workflowJob('prepare-queue-release-kit', 'activate-preview');
		const previewQualification = workflowJob(
			'qualify-preview-generation',
			'production-queue-preflight'
		);
		const productionPreflight = workflowJob(
			'production-queue-preflight',
			'bootstrap-production-discovery'
		);
		const previewActivation = workflowStep(
			'Execute receipt-scoped preview activation transaction',
			'Recover an interrupted preview activation from its durable journal'
		);
		const productionActivation = workflowStep(
			'Execute fresh-receipt production activation transaction',
			'Recover an interrupted production activation from its durable journal'
		);
		const health = workflowStep(
			'Prove committed production liveness and authenticated readiness',
			'Prove committed anonymous landing cache reaches a trusted hit'
		);
		const containment = workflowLastJob('deploy');
		const containmentRuntime = namedStepInJob(
			containment,
			'deploy',
			'Verify immutable containment artifact'
		);

		expect(sourceAuthority).toContain('production|staging) ;;');
		expect(sourceAuthority).not.toContain('production|main|staging');
		expect(sourceAuthority).toContain(
			'[ "$DEPLOY_EVENT" != "workflow_dispatch" ] || [ "$DEPLOY_BRANCH" != "production" ]'
		);
		for (const previewJob of [releaseKit, workflowJob('activate-preview', 'qualify-preview-generation')]) {
			expect(previewJob).toContain("inputs.branch == 'production'");
			expect(previewJob).toContain("inputs.branch == 'staging'");
			expect(previewJob).toContain("github.event.workflow_run.head_branch == 'staging'");
			expect(previewJob).not.toContain("inputs.branch == 'main'");
		}
		expect(previewQualification).toContain('- activate-preview');
		expect(previewQualification).toContain("needs.activate-preview.result == 'success'");
		expect(productionPreflight).toContain("inputs.branch == 'production'");
		expect(productionPreflight).not.toContain("inputs.branch == 'staging'");
		expect(productionPreflight).not.toContain(
			"github.event.workflow_run.head_branch == 'production'"
		);
		expect(previewActivation).toContain('--realm preview');
		expect(previewActivation).toContain('--branch staging');
		expect(productionActivation).toContain('--realm production');
		expect(productionActivation).toContain('--branch production');
		expect(productionActivation).toContain('--transaction-id "$RELEASE_TRANSACTION_ID"');
		expect(health).toContain('https://commons.email/api/live');
		expect(health).toContain('.release.transactionId == $transaction');
		expect(containment).toContain("needs.source-verify.outputs.deploy_mode == 'containment'");
		expect(containment).toContain("github.event_name == 'workflow_dispatch'");
		expect(containment).not.toContain("env.DEPLOY_MODE == 'normal'");
		expect(containmentRuntime).toContain("if: env.DEPLOY_MODE == 'containment'");
		expect(workflow).not.toContain('          - main\n');
	});

	it('encodes production and preview discovery realms statically in Pages config', () => {
		expect(pagesConfig).toContain('bucket_name = "commons-public-discovery-cache"');
		expect(pagesConfig).toContain(
			'script_name = "commons-public-discovery-manifest-gate"'
		);
		expect(pagesConfig).toContain('[env.preview.vars]');
		expect(pagesConfig).toContain('[[env.preview.r2_buckets]]');
		expect(pagesConfig).toContain(
			'bucket_name = "commons-public-discovery-cache-nonprod"'
		);
		expect(pagesConfig).toContain('[[env.preview.durable_objects.bindings]]');
		expect(pagesConfig).toContain(
			'script_name = "commons-public-discovery-manifest-gate-nonprod"'
		);
		expect(nonprodGateConfig).toContain(
			'name = "commons-public-discovery-manifest-gate-nonprod"'
		);
		expect(nonprodGateConfig).toContain('workers_dev = false');
		expect(nonprodGateConfig).toContain('preview_urls = false');
	});

	it('derives only the containment config inside the containment-only job', () => {
		const containment = workflowLastJob('deploy');
		const derive = namedStepInJob(
			containment,
			'deploy',
			'Derive trusted Wrangler deployment config'
		);
		expect(derive).toContain('trusted_config=gate/wrangler.containment.toml');
		expect(derive).toContain('deploy_wrangler_cwd="$RUNNER_TEMP/pages-deploy-config"');
		expect(derive).toContain('echo "DEPLOY_WRANGLER_CWD=$deploy_wrangler_cwd"');
		expect(derive).toContain('cp "$trusted_config" "$deploy_wrangler_cwd/wrangler.toml"');
		expect(derive).not.toContain('trusted_config=gate/wrangler.toml');
		expect(derive).not.toContain("if [ \"$DEPLOY_MODE\" = \"normal\" ]");
		expect(derive).not.toContain('productionUpdates');
		expect(derive).not.toContain('previewUpdates');
		expect(derive).not.toContain('setDiscoveryBindings');
	});

	it('deploys the manifest cron atomically and restores every attempted mutation', () => {
		const capture = workflowNamedStepInJob(
			'production-queue-preflight',
			'activate-production',
			'Capture exact manifest cron rollback baseline'
		);
		const deploy = workflowNamedStepInJob(
			'qualify-production-generation',
			'deploy',
			'Deploy public-discovery manifest cron control Worker'
		);
		const rollback = workflowNamedStepInJob(
			'qualify-production-generation',
			'deploy',
			'Roll back manifest cron after downstream release failure'
		);
		expect(capture).toContain('select(.percentage == 100)');
		expect(capture).toContain('id: capture_manifest_cron');
		expect(capture).toContain("echo 'state=absent'");
		expect(capture).toContain("echo 'state=present'");
		expect(capture).toContain('echo "version_id=$version_id"');
		expect(capture).toContain('echo "release_sha=$release_sha"');
		expect(capture).toContain('verify-public-discovery-cron-deployment.mjs');
		expect(deploy).toContain('--secrets-file "$secrets_file"');
		expect(deploy).toContain('--tag "$DEPLOY_SHA"');
		expect(deploy).toContain('finalize-trusted-release-worker.mjs validate');
		expect(deploy).toContain('--profile manifest-cron');
		expect(deploy.indexOf('finalize-trusted-release-worker.mjs validate')).toBeLessThan(
			deploy.indexOf('--no-bundle')
		);
		expect(deploy).not.toContain('wrangler secret put');
		expect(deploy).toContain('.annotations["workers/tag"] == $sha');
		expect(deploy).toContain('verify-public-discovery-cron-deployment.mjs');
		expect(rollback).toContain("steps.manifest_cron_deploy.outcome != 'skipped'");
		expect(rollback).toContain('MANIFEST_CRON_BASELINE_STATE');
		expect(rollback).toContain('MANIFEST_CRON_BASELINE_VERSION_ID');
		expect(rollback).toContain('wrangler rollback "$MANIFEST_CRON_BASELINE_VERSION_ID"');
		expect(rollback).toContain('verify-public-discovery-cron-deployment.mjs');
	});

	it('recovers every attempted canonical mutation, including partial CLI failures', () => {
		const journalRecovery = workflowStep(
			'Recover an interrupted authority handoff',
			'Restore the prior trusted production edge after recovered handoff failure'
		);
		const edgeRecovery = workflowStep(
			'Restore the prior trusted production edge after recovered handoff failure',
			'Restore retained production Pages and edge as one pair after unproved C'
		);
		const pairRecovery = workflowStepToJobEnd(
			'Restore retained production Pages and edge as one pair after unproved C',
			'deploy'
		);
		const pagesRestoreIndex = pairRecovery.indexOf(
			'cloudflare-pages-production-control.mjs rollback'
		);
		const edgeRestoreIndex = pairRecovery.indexOf(
			'wrangler rollback "$previous_version_id"'
		);
		const purgeStart = pairRecovery.indexOf('purge_response=');
		const originProofStart = pairRecovery.indexOf('pair_headers=', purgeStart);
		const optionalPurge = pairRecovery.slice(purgeStart, originProofStart);

		expect(journalRecovery).toContain('run-public-template-og-release-phase.mjs recover');
		expect(journalRecovery).toContain('--transaction-id "$RELEASE_TRANSACTION_ID"');
		expect(journalRecovery).toContain('.sourceSha == $sha and .transactionId == $transaction');
		expect(journalRecovery).toContain('.reason == "committed-terminal"');
		expect(journalRecovery).toContain('.reason == "superseded"');
		expect(edgeRecovery).toContain('.recovered == true and .reason == "recovered"');
		expect(edgeRecovery).toContain(
			'verify-trusted-pages-release-edge.mjs verify-route-inventory'
		);
		expect(pairRecovery).toContain(
			'RELEASE_ORIGIN_PROOF_SECRET: ${{ secrets.PROTECTED_RELEASE_ORIGIN_PROOF_SECRET_PRODUCTION }}'
		);
		expect(pairRecovery).toContain(
			'.recovered == false and .reason == "committed-terminal"'
		);
		expect(pairRecovery).toContain(
			'.pagesCapture.releaseComponent | select(. == "pages" or . == "pages-containment")'
		);
		expect(pairRecovery).toContain('test "$baseline_transaction" != "$RELEASE_TRANSACTION_ID"');
		expect(pagesRestoreIndex).toBeGreaterThan(0);
		expect(edgeRestoreIndex).toBeGreaterThan(pagesRestoreIndex);
		expect(
			pairRecovery.match(/verify-trusted-pages-release-edge\.mjs verify-route-inventory/g)
		).toHaveLength(2);
		expect(purgeStart).toBeGreaterThan(edgeRestoreIndex);
		expect(originProofStart).toBeGreaterThan(purgeStart);
		expect(optionalPurge).toContain('::warning::Optional restored-pair cache-tag purge');
		expect(optionalPurge).not.toContain('exit 1');
		expect(pairRecovery).toContain('verify-trusted-pages-release-origin-response.mjs');
		expect(pairRecovery).toContain('--component "$baseline_component"');
		expect(pairRecovery).toContain('--transaction-id "$baseline_transaction"');
		expect(pairRecovery).toContain(
			'.release.sha == $sha and .release.transactionId == $transaction'
		);
		expect(pairRecovery).toContain('if [ "$baseline_component" = "pages" ]; then');
	});

	it('prunes a containment preflight on every exit without touching the old canonical', () => {
		const containment = workflowLastJob('deploy');
		const marker = '- name: Fail-safe prune every containment preflight exposure';
		const cleanupStart = containment.indexOf(marker);
		const cleanup = containment.slice(cleanupStart);
		expect(cleanupStart).toBeGreaterThan(0);
		expect(cleanup).toContain('id: cleanup_containment_preflight');
		expect(cleanup).toContain('always()');
		expect(cleanup).toContain("env.DEPLOY_MODE == 'containment'");
		expect(cleanup).toContain("steps.containment_preflight_upload.outcome != 'skipped'");
		expect(cleanup).not.toContain('steps.containment_preflight_verify.outcome');
		expect(cleanup).not.toContain('steps.containment_preflight_binding.outcome');
		expect(cleanup).not.toContain('steps.pages_deploy.outcome');
		expect(cleanup).toContain('reconcile-cloudflare-pages-exposure.mjs --prune');
		expect(cleanup).not.toContain('--expected-production-sha');
		expect(cleanup).toContain("grep -q 'stale=0;'");
		expect(cleanup).toContain("grep -q 'preserved=0;'");
		expect(cleanupStart).toBeGreaterThan(
			containment.indexOf('Reconcile successful Pages publication')
		);
	});

	it('requires an actual exact-release seed and immutable bundled graph proof', () => {
		const production = workflowJob('qualify-production-generation', 'deploy');
		const liveness = namedStepInJob(
			production,
			'qualify-production-generation',
			'Wait for exact deployment liveness'
		);
		const seed = namedStepInJob(
			production,
			'qualify-production-generation',
			'Seed global public-discovery manifest control state'
		);
		const graph = namedStepInJob(
			production,
			'qualify-production-generation',
			'Prove exact immutable bundled graph surface'
		);
		const postActivationCron = production.indexOf(
			'node gate/scripts/verify-convex-contained-cron-deployments.mjs'
		);
		const livenessIndex = production.indexOf('- name: Wait for exact deployment liveness');
		const seedIndex = production.indexOf('- name: Seed global public-discovery manifest control state');
		const graphIndex = production.indexOf('- name: Prove exact immutable bundled graph surface');
		const cronDeployIndex = production.indexOf(
			'- name: Deploy public-discovery manifest cron control Worker'
		);
		const qualificationIndex = production.indexOf(
			'- name: Prove trusted production controls and qualify authority'
		);
		const edgeIndex = production.indexOf(
			'- name: Deploy and prove the exact trusted production edge'
		);
		const commitIndex = production.indexOf(
			'- name: Commit production authority as the terminal authority mutation'
		);
		expect(liveness).toContain("'https://pages-origin.commons.email/api/live'");
		expect(liveness).toContain('for attempt in {1..12}; do');
		expect(liveness).toContain(
			'--header "x-commons-pages-origin-access: ${PAGES_ORIGIN_ACCESS_TOKEN}"'
		);
		expect(liveness).toContain('--header "x-commons-edge-release-sha: ${DEPLOY_SHA}"');
		expect(liveness).toContain(
			'--header "x-commons-edge-release-transaction: ${RELEASE_TRANSACTION_ID}"'
		);
		expect(liveness).toContain('.release.sha == $sha');
		expect(liveness).toContain('.release.transactionId == $transaction');
		expect(liveness).not.toContain('/api/health');
		expect(seed).toContain('node gate/scripts/seed-public-discovery-manifest.mjs');
		expect(seed).toContain(
			'--endpoint https://pages-origin.commons.email/api/internal/public-discovery-manifest-refresh'
		);
		expect(seed).toContain('--expected-release-sha "$DEPLOY_SHA"');
		expect(seed).toContain('--expected-release-transaction "$RELEASE_TRANSACTION_ID"');
		expect(seed).toContain('--receipt-verification-deadline "$receipt_deadline"');
		expect(seed).toContain('--qualification-reserve-milliseconds 900000');
		expect(seed).toContain('--maximum-attempts 1');
		expect(seed).toContain('.proof == "public-discovery-manifest-deploy-seed"');
		expect(seed).toContain('.gateProtocol == "3"');
		expect(seed).toContain('.attempts == 1 and .continuationUsed == false');
		expect(seed).not.toContain('curl ');
		expect(seed).not.toContain('--refresh-secret');
		expect(graph).toContain("'https://pages-origin.commons.email/?view=graph'");
		expect(graph).not.toContain("'https://commons.email/?view=graph'");
		expect(graph).toContain(
			'INTERNAL_API_SECRET: ${{ secrets.PROTECTED_INTERNAL_API_SECRET_PRODUCTION }}'
		);
		expect(graph).toContain('--header "x-internal-secret: ${INTERNAL_API_SECRET}"');
		expect(graph).toContain('--header "x-expected-release-sha: ${DEPLOY_SHA}"');
		expect(graph).toContain('x-public-discovery-graph');
		expect(graph).toContain('graph_status" != "ready');
		expect(postActivationCron).toBeGreaterThan(0);
		expect(livenessIndex).toBeGreaterThan(postActivationCron);
		expect(seedIndex).toBeGreaterThan(livenessIndex);
		expect(seedIndex).toBeGreaterThan(postActivationCron);
		expect(graphIndex).toBeGreaterThan(seedIndex);
		expect(cronDeployIndex).toBeGreaterThan(graphIndex);
		expect(qualificationIndex).toBeGreaterThan(cronDeployIndex);
		expect(edgeIndex).toBeGreaterThan(qualificationIndex);
		expect(commitIndex).toBeGreaterThan(edgeIndex);
	});

	it('proves the external Pages namespace in both reachable normal realms', () => {
		const preview = workflowNamedStepInJob(
			'qualify-preview-generation',
			'production-queue-preflight',
			'Prove exact inert Pages publication before candidate dispatch'
		);
		const production = workflowNamedStepInJob(
			'qualify-production-generation',
			'deploy',
			'Prove trusted production controls and qualify authority'
		);
		expect(preview).toContain(
			'node gate/scripts/verify-pages-durable-object-binding.mjs --environment preview'
		);
		expect(preview).not.toContain('--environment production');
		expect(production).toContain(
			'node gate/scripts/verify-pages-durable-object-binding.mjs --environment production'
		);
		expect(production).not.toContain('--environment preview');
	});

	it('deploys and proves one monotonic Commons Pages work-budget Worker before production Pages', () => {
		const preflight = workflowJob(
			'production-queue-preflight',
			'bootstrap-production-discovery'
		);
		const productionActivation = workflowJob(
			'activate-production',
			'qualify-production-generation'
		);
		const workBudgetDeploy = workflowStep(
			'Deploy and prove exact team-global Convex work-budget Worker',
			'Prove both Convex deployments have zero cron authority'
		);
		const quotaIndex = preflight.indexOf(
			'- name: Prove fresh signed Convex quota before Cloudflare producer eligibility'
		);
		const workBudgetIndex = preflight.indexOf(
			'- name: Deploy and prove exact team-global Convex work-budget Worker'
		);
		const handoffIndex = preflight.indexOf(
			'- name: Seal production preflight handoff before receipt capture'
		);

		expect(quotaIndex).toBeGreaterThan(0);
		expect(workBudgetIndex).toBeGreaterThan(quotaIndex);
		expect(handoffIndex).toBeGreaterThan(workBudgetIndex);
		expect(productionActivation).toContain('- production-queue-preflight');
		expect(productionActivation).toContain(
			'needs.production-queue-preflight.result == \'success\''
		);
		expect(workBudgetDeploy).toContain('$ARTIFACT_ROOT/convex-work-budget/index.js');
		expect(workBudgetDeploy).toContain('finalize-trusted-release-worker.mjs validate');
		expect(workBudgetDeploy).toContain('--profile convex-work-budget');
		expect(workBudgetDeploy.indexOf('finalize-trusted-release-worker.mjs validate')).toBeLessThan(
			workBudgetDeploy.indexOf('--no-bundle')
		);
		expect(workBudgetDeploy).toContain('--config gate/wrangler.convex-work-budget.toml');
		expect(workBudgetDeploy).toContain('--tag "$DEPLOY_SHA"');
		expect(workBudgetDeploy).toContain(
			'verify-convex-work-budget-deployment.mjs \\\n            --environment production --worker-only'
		);
		expect(workBudgetDeploy).not.toContain('wrangler rollback');
		expect(workBudgetDeploy).not.toContain('wrangler delete');
		expect(workflow).toContain('.publicDiscoveryCache.workBudgetBound == true');
		expect(branchAliasWorkflow).not.toContain('CONVEX_WORK_BUDGET');
		expect(branchAliasWorkflow).not.toContain('verify-convex-work-budget-deployment.mjs');
		expect(pagesConfig).toContain('name = "CONVEX_WORK_BUDGET"');
		expect(pagesConfig).toContain('script_name = "commons-convex-work-budget"');
		expect(pagesConfig).not.toContain('script_name = "commons-convex-work-budget-nonprod"');
	});

	it('treats the signed shared-Free receipt as evidence before producer eligibility', () => {
		const preflight = workflowJob(
			'production-queue-preflight',
			'bootstrap-production-discovery'
		);
		const quotaProof = workflowStep(
			'Prove fresh signed Convex quota before Cloudflare producer eligibility',
			'Deploy and prove exact team-global Convex work-budget Worker'
		);
		const workBudgetDeploy = workflowStep(
			'Deploy and prove exact team-global Convex work-budget Worker',
			'Prove both Convex deployments have zero cron authority'
		);
		const queueReceipt = workflowStep(
			'Materialize fresh post-qualification production Queue Free receipt',
			'Execute fresh-receipt production activation transaction'
		);
		const quotaConfig = JSON.parse(readFileSync('config/convex-native-usage-limits.json', 'utf8'));

		expect(quotaProof).toContain('PROTECTED_CONVEX_TEAM_QUOTA_ATTESTATION_B64');
		expect(quotaProof).toContain('PROTECTED_CONVEX_TEAM_QUOTA_SIGNATURE_B64');
		expect(quotaProof).toContain('PROTECTED_CONVEX_USAGE_LIMITS_VIEW_TOKEN');
		expect(quotaProof).not.toContain('CONVEX_DASHBOARD_ACCESS_TOKEN');
		expect(quotaProof).toContain('--environment production');
		expect(quotaProof).toContain('--source-sha "$DEPLOY_SHA"');
		expect(quotaProof).toContain('--purpose full-normal-release');
		expect(quotaProof).toContain('--minimum-validity-seconds 180');
		expect(quotaProof).toContain('--attestation "$attestation"');
		expect(quotaProof).toContain('--signature "$signature"');
		expect(quotaProof).toContain('--allowed-signers gate/.github/convex-quota-allowed-signers');
		expect(preflight.indexOf('verify-convex-native-usage-limits.mjs')).toBeLessThan(
			preflight.indexOf('$ARTIFACT_ROOT/convex-work-budget/index.js')
		);
		expect(workBudgetDeploy).toContain('--profile convex-work-budget');
		expect(queueReceipt).toContain(
			'PREVIEW_QUALIFIED_AT: ${{ needs.qualify-preview-generation.outputs.completed_at }}'
		);
		expect(queueReceipt).toContain(
			'BOOTSTRAP_COMPLETED_AT: ${{ needs.bootstrap-production-discovery.outputs.completed_at }}'
		);
		expect(queueReceipt).toContain('.observations[0].observedAt >= $previewCompleted');
		expect(queueReceipt).toContain('.observations[1].observedAt >= $bootstrapCompleted');
		expect(queueReceipt).toContain('.capturedAt >= .observations[1].observedAt');
		expect(quotaConfig.normalReleaseAuthority).toEqual({
			reasonCode: 'SHARED_FREE_BROWSER_DIRECT_UNARBITRATED',
			requiredReplacementAuthorityKinds: ['paid-no-shared-hard-disable', 'quota-isolation'],
			status: 'blocked-shared-free'
		});
	});

	it('bounds the quota-to-budget handoff and every receipt-scoped release mutation', () => {
		const quotaConfig = JSON.parse(readFileSync('config/convex-native-usage-limits.json', 'utf8'));
		const quotaProof = workflowStep(
			'Prove fresh signed Convex quota before Cloudflare producer eligibility',
			'Deploy and prove exact team-global Convex work-budget Worker'
		);
		const previewActivation = workflowStep(
			'Execute receipt-scoped preview activation transaction',
			'Recover an interrupted preview activation from its durable journal'
		);
		const productionActivation = workflowStep(
			'Execute fresh-receipt production activation transaction',
			'Recover an interrupted production activation from its durable journal'
		);
		const authority = quotaConfig.teamUsageAuthority;

		expect(quotaProof).toContain('timeout-minutes: 3');
		expect(quotaProof).toContain(
			`--minimum-validity-seconds ${authority.minimumFinalProofRemainingValiditySeconds}`
		);
		expect(previewActivation).toContain('timeout-minutes: 35');
		expect(productionActivation).toContain('timeout-minutes: 35');
		expect(releasePhaseSource).toContain('const SUCCESS_WINDOW_MS = 8 * 60 * 1000;');
		expect(releasePhaseSource).toContain(
			"const assertSuccessWindow = () =>\n\t\tinvariant(Date.now() < deadlineAt, 'The receipt-scoped release success window expired.')"
		);
		expect(releasePhaseSource).toContain(
			'// The signed account-wide/live check is deliberately the final awaited'
		);
		expect(releasePhaseSource).toContain("return prove(state)");
		expect(releasePhaseSource.match(/await authorizeMutation\(/g)?.length).toBeGreaterThanOrEqual(6);
		expect(authority.maximumLifetimeSeconds).toBeGreaterThan(
			authority.minimumFirstProofRemainingValiditySeconds
		);
		expect(authority.futureWorkAllowanceWindowSeconds).toBe(
			authority.maximumLifetimeSeconds + 600 + authority.maximumFutureSkewSeconds
		);
	});
});
