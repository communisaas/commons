import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';

function source(path: string): string {
	return readFileSync(path, 'utf8');
}

describe('workflow execution boundary', () => {
	it('arms bounded non-email workflow execution without arming workflow email by default', () => {
		const features = source('src/lib/config/features.ts');
		const automationProcess = source('src/routes/api/automation/process/+server.ts');
		const api = source('src/routes/api/org/[slug]/workflows/[id]/+server.ts');
		const index = source('src/routes/org/[slug]/workflows/+page.svelte');
		const indexServer = source('src/routes/org/[slug]/workflows/+page.server.ts');
		const detail = source('src/routes/org/[slug]/workflows/[id]/+page.svelte');
		const detailServer = source('src/routes/org/[slug]/workflows/[id]/+page.server.ts');
		const draft = source('src/routes/org/[slug]/workflows/new/+page.svelte');
		const draftServer = source('src/routes/org/[slug]/workflows/new/+page.server.ts');
		const dependencyPanel = source(
			'src/lib/components/automation/WorkflowEmailDependencyPanel.svelte'
		);
		const hypergraph = source('src/lib/data/capability-hypergraph.ts');
		const readiness = source('src/lib/server/workflows/workflow-email-readiness.ts');
		const workflows = source('convex/workflows.ts');
		const tasks = source('docs/strategy/implementation-hypergraph/nodes/tasks.json');
		const blocks = source('docs/strategy/implementation-hypergraph/edges/blocks.json');
		const canonicalDoc = source('docs/design/ORG-OS-AUTHORING-FIRST.md');
		const capabilityScope = source('docs/design/ORG-CAPABILITY-SCOPE.md');

		expect(features).toContain('WORKFLOW_EXECUTION: true');
		expect(automationProcess).toContain('serverAction(api.workflows.processScheduledNow');
		expect(automationProcess).toContain('_secret: getInternalSecret()');
		expect(automationProcess).toContain("status: 'processed'");
		expect(automationProcess).toContain('processed: result.processed');
		expect(automationProcess).toContain("runner: 'workflow_scheduled_resume'");
		expect(automationProcess).toContain(
			"effect: 'paused executions with elapsed delays were queued for resume'"
		);
		expect(automationProcess).toContain("error: 'workflow_execution_not_armed'");
		expect(automationProcess).toContain("blockedVerb: 'process_workflow_schedule'");
		expect(automationProcess).toContain("gate: 'CP-workflow-effects'");
		expect(automationProcess).toContain("taskIds: ['T1-9a']");
		expect(automationProcess).toContain('runnerImplemented: true');
		expect(automationProcess).toContain('{ status: 424 }');
		expect(automationProcess).not.toContain('{ status: 501 }');
		expect(automationProcess).not.toContain('scheduled processing and email delivery are not armed');
		expect(tasks).toContain('"id": "T1-9a"');
		expect(tasks).toContain('"slug": "workflow-non-email-runner"');
		expect(tasks).toContain('"status": "completed"');
		expect(tasks).toContain('"id": "T1-9"');
		expect(tasks).toContain('"slug": "workflow-verbs-impl"');
		expect(tasks).toContain('"Workflow runner step verbs are implemented');
		expect(tasks).toContain('"status": "completed"');
		expect(tasks).toContain('remaining launch blocker is runtime confidence/configuration');
		expect(tasks).not.toContain('behind T1-9/T2-2 dependencies');
		expect(blocks).not.toContain('"source": "T2-2", "target": "T1-9"');

		for (const route of [index, detail, draft]) {
			expect(route).toContain("getGateEvidence('CP-workflow-effects', ['T1-9a']");
			expect(route).toContain('Bounded');
			expect(route).toContain('WorkflowEmailDependencyPanel');
			expect(route).toContain('readiness={data.workflowEmailReadiness}');
		}
		for (const routeServer of [indexServer, detailServer, draftServer]) {
			expect(routeServer).toContain('getWorkflowEmailRuntimeReadinessFromEnv');
			expect(routeServer).toContain('api.organizations.getOrgKeyVerifier');
			expect(routeServer).toContain('workflowEmailReadiness');
		}

		expect(workflows).toContain('async function sendWorkflowEmailStep');
		expect(workflows).toContain("if (context.supporter.emailStatus !== 'subscribed')");
		expect(workflows).toContain('getOrgKeyForAction(ctx, context.org._id)');
		expect(workflows).toContain('decryptOrgPii(');
		expect(workflows).toContain('applyWorkflowMergeFields');
		expect(workflows).toContain('sendViaSes(');
		expect(workflows).toContain('export const applySupporterTagStep = internalMutation');
		expect(workflows).toContain("if (args.mode === 'add_tag')");
		expect(workflows).toContain("await ctx.db.delete(existing._id)");
		expect(workflows).toContain("} else if (step.type === 'send_email') {");
		expect(workflows).toContain("} else if (step.type === 'add_tag' || step.type === 'remove_tag') {");

		expect(api).toContain("error: 'workflow_email_dependency_missing'");
		expect(api).toContain("blockedVerb: 'enable_workflow_email'");
		expect(api).toContain("gate: 'CP-workflow-email'");
		expect(api).toContain("taskIds: ['T1-9']");
		expect(api).toContain('getWorkflowEmailRuntimeReadiness');
		expect(api).toContain('api.organizations.getOrgKeyVerifier');
		expect(api).toContain('missing: readiness.missing');
		expect(api).toContain('perRunDependencies: readiness.perRunDependencies');
		expect(api).toContain('function hasEmailStep(steps: unknown): boolean');
		expect(api).toContain('return workflowEmailDependencyBoundary(hasDefinitionPatch, readiness);');
		expect(readiness).toContain('WORKFLOW_EMAIL_RUNTIME_DEPENDENCY');
		expect(readiness).toContain('getWorkflowEmailRuntimeReadinessFromEnv');
		expect(readiness).toContain('AWS_ACCESS_KEY_ID');
		expect(readiness).toContain('WORKFLOW_FROM_EMAIL or SES_FROM_EMAIL or RECEIPT_FROM_EMAIL');
		expect(readiness).toContain('org key verifier');
		expect(readiness).toContain('supporter cursor');
		expect(readiness).toContain('subscribed supporter');
		expect(dependencyPanel).toContain('Workflow email dependency boundary');
		expect(dependencyPanel).toContain('workflow_email_dependency_missing');
		expect(dependencyPanel).toContain('Arm-time dependency');
		expect(dependencyPanel).toContain('Per-run checks');

		expect(hypergraph).toContain('Bounded workflow execution is armed');
		expect(hypergraph).toContain('workflow email remains dependency-bound');
		expect(canonicalDoc).toContain('bounded runner armed, email dependency-bound');
		expect(canonicalDoc).toContain('typed `workflow_execution_not_armed`');
		expect(canonicalDoc).toContain('rather than a 501 stub');
		expect(canonicalDoc).toContain('typed `workflow_email_dependency_missing`');
		expect(canonicalDoc).toContain('getWorkflowEmailRuntimeReadiness');
		expect(canonicalDoc).toContain('missing arm-time dependencies');
		expect(capabilityScope).toContain('T1-9 workflow step verbs are implemented');
		expect(capabilityScope).toContain('remaining blocker is runtime confidence');
		expect(capabilityScope).toContain('not a 501 stub');
	});
});
