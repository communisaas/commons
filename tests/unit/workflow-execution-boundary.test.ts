import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';

function source(path: string): string {
	return readFileSync(path, 'utf8');
}

describe('workflow execution boundary', () => {
	it('arms scheduled workflow processing behind the feature flag with a typed boundary', () => {
		const features = source('src/lib/config/features.ts');
		const automationProcess = source('src/routes/api/automation/process/+server.ts');

		expect(features).toContain('WORKFLOW_EXECUTION: true');
		expect(automationProcess).toContain('serverAction(api.workflows.processScheduledNow');
		expect(automationProcess).toContain('_secret: getInternalSecret()');
		expect(automationProcess).toContain("status: 'processed'");
		expect(automationProcess).toContain('processed: result.processed');
		expect(automationProcess).toContain("runner: 'workflow_scheduled_resume'");
		expect(automationProcess).toContain("error: 'workflow_execution_not_armed'");
		expect(automationProcess).toContain("blockedVerb: 'process_workflow_schedule'");
		expect(automationProcess).toContain('runnerImplemented: true');
		expect(automationProcess).toContain('{ status: 424 }');
		expect(automationProcess).not.toContain('{ status: 501 }');
	});

	it('implements workflow step verbs in Convex', () => {
		const workflows = source('convex/workflows.ts');

		expect(workflows).toContain('async function sendWorkflowEmailStep');
		expect(workflows).toContain("if (context.supporter.emailStatus !== 'subscribed')");
		expect(workflows).toContain('getOrgKeyForAction(ctx, context.org._id)');
		expect(workflows).toContain('decryptOrgPii(');
		expect(workflows).toContain('applyWorkflowMergeFields');
		expect(workflows).toContain('sendViaSes(');
		expect(workflows).toContain('export const applySupporterTagStep = internalMutation');
		expect(workflows).toContain("if (args.mode === 'add_tag')");
		expect(workflows).toContain('await ctx.db.delete(existing._id)');
		expect(workflows).toContain("} else if (step.type === 'send_email') {");
		expect(workflows).toContain(
			"} else if (step.type === 'add_tag' || step.type === 'remove_tag') {"
		);
	});

	it('gates workflow email on runtime dependency readiness', () => {
		const api = source('src/routes/api/org/[slug]/workflows/[id]/+server.ts');
		const readiness = source('src/lib/server/workflows/workflow-email-readiness.ts');

		expect(api).toContain("error: 'workflow_email_dependency_missing'");
		expect(api).toContain("blockedVerb: 'enable_workflow_email'");
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
	});

	it('threads workflow email readiness through every workflow route load', () => {
		const indexServer = source('src/routes/org/[slug]/workflows/+page.server.ts');
		const detailServer = source('src/routes/org/[slug]/workflows/[id]/+page.server.ts');
		const draftServer = source('src/routes/org/[slug]/workflows/new/+page.server.ts');

		for (const routeServer of [indexServer, detailServer, draftServer]) {
			expect(routeServer).toContain('getWorkflowEmailRuntimeReadinessFromEnv');
			expect(routeServer).toContain('api.organizations.getOrgKeyVerifier');
			expect(routeServer).toContain('workflowEmailReadiness');
		}
	});
});
