import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/deploy.yml', 'utf8');
const releaseRunner = readFileSync('scripts/run-public-template-og-release-phase.mjs', 'utf8');

function jobBlock(name: string): string {
	const headers = [...workflow.matchAll(/^  ([a-zA-Z0-9_-]+):\s*$/gmu)];
	const index = headers.findIndex((match) => match[1] === name);
	expect(index, `missing workflow job ${name}`).toBeGreaterThan(-1);
	const start = headers[index].index ?? 0;
	const end = headers[index + 1]?.index ?? workflow.length;
	return workflow.slice(start, end);
}

function stepIndex(job: string, name: string): number {
	const index = job.indexOf(`      - name: ${name}`);
	expect(index, `missing workflow step ${name}`).toBeGreaterThan(-1);
	return index;
}

describe('production public-discovery bootstrap workflow', () => {
	const preflight = jobBlock('production-queue-preflight');
	const bootstrap = jobBlock('bootstrap-production-discovery');
	const activation = jobBlock('activate-production');

	it('places one positive completion gate between preflight and production activation', () => {
		expect(bootstrap).toContain('- production-queue-preflight');
		expect(bootstrap).toContain("needs.production-queue-preflight.result == 'success'");
		expect(activation).toContain('- bootstrap-production-discovery');
		expect(activation).toContain("needs.bootstrap-production-discovery.result == 'success'");
		expect(activation).toContain(
			"needs.bootstrap-production-discovery.outputs.bootstrap_complete == 'true'"
		);
		expect(activation).toContain(
			'needs.bootstrap-production-discovery.outputs.generation != \'\''
		);
		expect(bootstrap).toContain('bootstrap_complete: ${{ steps.bootstrap_handoff.outputs.bootstrap_complete }}');
	});

	it('permits a cold corpus only at preflight and restores content-required activation', () => {
		expect(preflight).toContain("PUBLIC_DISCOVERY_REQUIRE_CONTENT: 'false'");
		expect(preflight).toContain("PUBLIC_DISCOVERY_CONTRACT_ONLY: 'true'");
		expect(activation).toContain("PUBLIC_DISCOVERY_REQUIRE_CONTENT: 'true'");
		expect(activation).toContain("PUBLIC_DISCOVERY_CONTRACT_ONLY: 'false'");
	});

	it('activates and proves the exact bootstrap-capable manifest gate before bootstrap', () => {
		const deployGate = stepIndex(
			preflight,
			'Deploy and prove exact production manifest gate before bootstrap'
		);
		const handoff = stepIndex(
			preflight,
			'Seal production preflight handoff before receipt capture'
		);
		expect(deployGate).toBeLessThan(handoff);
		expect(preflight).toContain('--profile manifest-gate');
		expect(preflight).toContain('"$ARTIFACT_ROOT/manifest-gate/index.js"');
		expect(preflight).toContain('--config gate/wrangler.public-discovery-manifest-gate.toml');
		expect(preflight).toContain('--no-bundle');
		expect(preflight).toContain('--tag "$DEPLOY_SHA"');
		expect(preflight).toContain(
			'component=manifest-gate realm=production'
		);
		expect(preflight).toContain('verify-public-discovery-gate-deployments.mjs');
		expect(preflight).toContain('.annotations["workers/tag"] == $sha');
		expect(preflight).toContain('.annotations["workers/message"] == $message');
	});

	it('classifies work from the typed incomplete sentinel but prepares one common dormant consumer', () => {
		const classify = stepIndex(
			bootstrap,
			'Classify exact production discovery completion before mutation'
		);
		const receipt = stepIndex(
			bootstrap,
			'Materialize and admit exact schema-2 bootstrap Queue receipt'
		);
		expect(classify).toBeLessThan(receipt);
		expect(bootstrap).toContain(
			"head -n 1 \"$error\" | grep -q '^PUBLIC_DISCOVERY_BOOTSTRAP_INCOMPLETE:'"
		);
		expect(bootstrap).toContain("echo 'required=false' >> \"$GITHUB_OUTPUT\"");
		expect(bootstrap).toContain("echo 'required=true' >> \"$GITHUB_OUTPUT\"");
		expect(bootstrap).toContain(
			'Production bootstrap completion failed outside the typed incomplete state.'
		);
		expect(bootstrap).toContain(
			'Prove completed corpus has no retained bootstrap route or script'
		);
		expect(bootstrap).toContain('route --expected absent');
		const receiptStep = bootstrap.slice(
			receipt,
			stepIndex(bootstrap, 'Prove completed corpus has no retained bootstrap route or script')
		);
		expect(receiptStep).not.toContain('if: steps.classify_bootstrap.outputs.required');
		const commonPreparation = bootstrap.slice(
			stepIndex(bootstrap, 'Prove completed corpus has no retained bootstrap route or script'),
			stepIndex(bootstrap, 'Arm bounded production bootstrap authority')
		);
		expect(commonPreparation).toContain(
			'Prove signed empty consumer-ready Queue baseline before code mutation'
		);
		expect(commonPreparation).toContain(
			'Deploy and converge exact transaction-bound production Queue consumer'
		);
		expect(commonPreparation).not.toContain(
			"if: steps.classify_bootstrap.outputs.required == 'true'"
		);
		const coldMutation = bootstrap.slice(
			stepIndex(bootstrap, 'Arm bounded production bootstrap authority'),
			stepIndex(bootstrap, 'Contain authority and recover the temporary route before script deletion')
		);
		expect(coldMutation).toContain(
			"if: steps.classify_bootstrap.outputs.required == 'true'"
		);
	});

	it('binds one schema-2 receipt to exact source, transaction, operator, and reserves', () => {
		expect(bootstrap).toContain(
			'PROTECTED_CLOUDFLARE_QUEUE_FREE_BOOTSTRAP_PRODUCTION_ATTESTATION_B64'
		);
		expect(bootstrap).toContain(
			'PROTECTED_CLOUDFLARE_QUEUE_FREE_BOOTSTRAP_PRODUCTION_SIGNATURE_B64'
		);
		expect(bootstrap).toContain(
			'PROTECTED_CLOUDFLARE_QUEUE_FREE_BOOTSTRAP_PRODUCTION_OPERATOR_PRINCIPAL'
		);
		expect(bootstrap).toContain('verify-cloudflare-queue-free-envelope.mjs');
		expect(bootstrap).toContain('--release-phase bootstrap-production');
		expect(bootstrap).toContain(
			'PRODUCTION_PREFLIGHT_COMPLETED_AT: ${{ needs.production-queue-preflight.outputs.completed_at }}'
		);
		expect(bootstrap).toContain('.observations[0].observedAt >= $completed');
		expect(bootstrap).toContain('.observations[1].observedAt >= $completed');
		expect(bootstrap).toContain('--min-validity-seconds 4320');
		expect(bootstrap).toContain('--state bootstrap-consumer-ready');
		expect(bootstrap).toContain('--state bootstrap-producer-attached');
		expect(bootstrap).toContain('--min-validity-seconds 3960');
		expect(bootstrap).toContain('--state bootstrap-unchanged');
		expect(bootstrap).toContain('--min-validity-seconds 180');
	});

	it('proves zero backlog, seals custody, and converges the exact consumer before authority', () => {
		const emptyBaseline = stepIndex(
			bootstrap,
			'Prove signed empty consumer-ready Queue baseline before code mutation'
		);
		const custody = stepIndex(
			bootstrap,
			'Seal durable bootstrap recovery custody before temporary authority'
		);
		const consumer = stepIndex(
			bootstrap,
			'Deploy and converge exact transaction-bound production Queue consumer'
		);
		const arm = stepIndex(bootstrap, 'Arm bounded production bootstrap authority');
		const deploy = stepIndex(
			bootstrap,
			'Deploy exact finalized Pages artifact on the temporary bootstrap route'
		);
		const record = stepIndex(
			bootstrap,
			'Prove and record the exact temporary bootstrap deployment'
		);
		expect(emptyBaseline).toBeLessThan(custody);
		expect(custody).toBeLessThan(consumer);
		expect(consumer).toBeLessThan(arm);
		expect(arm).toBeLessThan(deploy);
		expect(deploy).toBeLessThan(record);
		expect(bootstrap).toContain('public-discovery-bootstrap-recovery-custody.mjs seal');
		expect(bootstrap).toContain('public-discovery-bootstrap-recovery-custody.mjs record-deployed');
		expect(bootstrap).toContain('.positiveBacklogObserved == false');
		expect(bootstrap).toContain('.primaryProducerCount == 0');
		expect(bootstrap).toContain('.queueConfigurationUnchanged == true');
		expect(bootstrap).toContain('--var "PUBLIC_RELEASE_SHA:${DEPLOY_SHA}"');
		expect(bootstrap).toContain(
			'--var "PUBLIC_RELEASE_TRANSACTION_ID:${RELEASE_TRANSACTION_ID}"'
		);
		expect(bootstrap).toContain('--expected-transaction-id "$RELEASE_TRANSACTION_ID"');
		expect(bootstrap).toContain(
			'Consumer deploy command lost its response, but exact live convergence proved the owned result.'
		);
		expect(bootstrap.indexOf('BOOTSTRAP_AUTHORITY_LEASE_ID=$lease')).toBeLessThan(
			bootstrap.indexOf('control-public-discovery-bootstrap-authority.mjs arm')
		);
		expect(bootstrap).toContain('"$ARTIFACT_ROOT/pages/_worker.js"');
		expect(bootstrap).toContain('--config gate/wrangler.public-discovery-bootstrap.toml');
		expect(bootstrap).toContain('--no-bundle');
		expect(bootstrap).toContain('--tag "$DEPLOY_SHA"');
		expect(bootstrap).toContain('transaction=${RELEASE_TRANSACTION_ID} component=bootstrap');
		expect(bootstrap).toContain('process.env.DISCOVERY_MANIFEST_REFRESH_SECRET');
		expect(bootstrap).not.toContain('--arg refresh "$DISCOVERY_MANIFEST_REFRESH_SECRET"');
	});

	it('proves only the authorized transient producer before the Access canary and seed', () => {
		const attached = stepIndex(
			bootstrap,
			'Prove the receipt-authorized transient Queue producer attachment'
		);
		const boundary = stepIndex(
			bootstrap,
			'Prove Access and the exact bootstrap adapter boundary before work'
		);
		const seed = stepIndex(
			bootstrap,
			'Seed the complete production corpus inside the absolute authority deadline'
		);
		expect(attached).toBeLessThan(boundary);
		expect(boundary).toBeLessThan(seed);
		expect(bootstrap).toContain('.bootstrapProducerAttached == true');
		expect(bootstrap).toContain('.queueConfigurationUnchanged == false');
		expect(bootstrap).toContain(
			'.queueConfigurationUnchangedExceptAuthorizedProducer == true'
		);
		expect(bootstrap).toContain('.authorizedTransientProducerDeltaOnly == true');
		expect(bootstrap).toContain('prove-public-discovery-bootstrap-boundary.mjs');
		expect(bootstrap).toContain('--bootstrap-cleanup-reserve-milliseconds 600000');
		expect(bootstrap).toContain('.bootstrapCleanupReserveMilliseconds == 600000');
		expect(bootstrap).toContain('--maximum-attempts 25');
	});

	it('polls only exact R2 completion keys between the seed and hard cleanup reserves', () => {
		const seed = stepIndex(
			bootstrap,
			'Seed the complete production corpus inside the absolute authority deadline'
		);
		const completion = stepIndex(
			bootstrap,
			'Certify the seeded R2 corpus and exact completed authority'
		);
		const completionStep = bootstrap.slice(
			completion,
			stepIndex(bootstrap, 'Contain authority and recover the temporary route before script deletion')
		);
		expect(seed).toBeLessThan(completion);
		expect(completionStep).toContain('console.log(notAfter - 300_000)');
		expect(completionStep).toContain('sleep 15');
		expect(completionStep).toContain('timeout --signal=TERM --kill-after=5s');
		expect(completionStep).toContain(
			"grep -q '^PUBLIC_DISCOVERY_BOOTSTRAP_INCOMPLETE:'"
		);
		expect(completionStep).toContain(
			'verify-public-discovery-bootstrap-completion.ts'
		);
		expect(completionStep).not.toMatch(/\b(?:aws\s+s3|rclone)\s+(?:ls|list)\b/u);
	});

	it('certifies completion, recovers route first, and proves terminal Queue baseline', () => {
		const completion = stepIndex(
			bootstrap,
			'Certify the seeded R2 corpus and exact completed authority'
		);
		const cleanup = stepIndex(
			bootstrap,
			'Contain authority and recover the temporary route before script deletion'
		);
		const terminalQueue = stepIndex(
			bootstrap,
			'Prove Queue authority returned to the exact signed baseline'
		);
		const finalCompletion = stepIndex(
			bootstrap,
			'Re-prove exact production completion after temporary cleanup'
		);
		const handoff = stepIndex(bootstrap, 'Seal positive production bootstrap handoff');
		expect(completion).toBeLessThan(cleanup);
		expect(cleanup).toBeLessThan(terminalQueue);
		expect(terminalQueue).toBeLessThan(finalCompletion);
		expect(finalCompletion).toBeLessThan(handoff);
		expect(bootstrap).toContain('.status == "completed"');
		const cleanupStep = bootstrap.slice(cleanup, terminalQueue);
		const terminalStep = bootstrap.slice(terminalQueue, finalCompletion);
		expect(cleanupStep).toContain('if: always()');
		expect(terminalStep).toContain('if: always()');
		expect(cleanupStep).toContain('control-public-discovery-bootstrap-authority.mjs inspect');
		expect(cleanupStep).toContain('armed)');
		expect(cleanupStep).toContain('control-public-discovery-bootstrap-authority.mjs contain');
		expect(cleanupStep).toContain('absent|completed|contained) ;;');
		expect(cleanupStep.indexOf('control-public-discovery-bootstrap-authority.mjs contain')).toBeLessThan(
			cleanupStep.indexOf('recover-public-discovery-bootstrap.mjs')
		);
		expect(cleanupStep).toContain('recover-public-discovery-bootstrap.mjs');
		expect(cleanupStep).toContain('--trusted-gate-sha "$TRUSTED_GATE_SHA"');
		expect(bootstrap).toContain('.bootstrapProducerAttached == false');
		expect(bootstrap).toContain('.queueConfigurationUnchanged == true');
		expect(bootstrap).toContain(
			'.queueConfigurationUnchangedExceptAuthorizedProducer == false'
		);
		expect(bootstrap).toContain("echo 'bootstrap_complete=true'");
	});

	it('still schedules cleanup and the terminal Queue oracle after a prior-step failure', () => {
		const cleanup = stepIndex(
			bootstrap,
			'Contain authority and recover the temporary route before script deletion'
		);
		const terminal = stepIndex(
			bootstrap,
			'Prove Queue authority returned to the exact signed baseline'
		);
		const finalCompletion = stepIndex(
			bootstrap,
			'Re-prove exact production completion after temporary cleanup'
		);
		expect(bootstrap.slice(cleanup, terminal)).toContain('if: always()');
		expect(bootstrap.slice(terminal, finalCompletion)).toContain('if: always()');
		expect(bootstrap.slice(terminal, finalCompletion)).not.toContain('if: success()');
	});

	it('requires post-bootstrap activation observations and pauses production before mutation', () => {
		expect(activation).toContain(
			'BOOTSTRAP_COMPLETED_AT: ${{ needs.bootstrap-production-discovery.outputs.completed_at }}'
		);
		expect(activation).toContain(
			'.observations[0].observedAt >= $bootstrapCompleted'
		);
		expect(activation).toContain(
			'.observations[1].observedAt >= $bootstrapCompleted'
		);
		expect(releaseRunner).toContain("realm === 'production' && provisionMutation === 1");
		expect(releaseRunner).toContain("? 'baseline-contained'");
		expect(releaseRunner).toContain(": 'preparing-paused'");
		expect(releaseRunner).toContain("if (realm === 'preview') {");
		expect(releaseRunner).toContain("await appendRecoveryStage('intent-gate')");
	});

	it('uses separate least-privilege discovery reads and durable recovery credentials', () => {
		expect(bootstrap).toContain('PROTECTED_PUBLIC_DISCOVERY_R2_READ_ACCESS_KEY_ID');
		expect(bootstrap).toContain('PROTECTED_PUBLIC_DISCOVERY_R2_READ_SECRET_ACCESS_KEY');
		expect(bootstrap).toContain('PROTECTED_RELEASE_RECOVERY_R2_ACCESS_KEY_ID');
		expect(bootstrap).toContain('PROTECTED_RELEASE_RECOVERY_R2_SECRET_ACCESS_KEY');
		expect(bootstrap).not.toContain('PROTECTED_CLOUDFLARE_QUEUE_FREE_ACTIVATE_PRODUCTION');
	});
});
