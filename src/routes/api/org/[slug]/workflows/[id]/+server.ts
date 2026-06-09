/**
 * PATCH /api/org/[slug]/workflows/[id] — Update workflow
 * DELETE /api/org/[slug]/workflows/[id] — Delete workflow
 */

import { json, error } from '@sveltejs/kit';
import { FEATURES } from '$lib/config/features';
import { serverMutation, serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import {
	getWorkflowEmailRuntimeReadinessFromEnv,
	type WorkflowEmailRuntimeReadiness
} from '$lib/server/workflows/workflow-email-readiness';
import type { Id } from '$convex/_generated/dataModel';
import type { RequestHandler } from './$types';

function workflowEmailDependencyBoundary(
	definitionSaved: boolean,
	readiness: WorkflowEmailRuntimeReadiness
) {
	return json(
		{
			error: 'workflow_email_dependency_missing',
			message: `${readiness.message} Tag writes, branch conditions, delay/resume, and trigger dispatch remain armed for non-email definitions. Each email run still requires a supporter cursor and subscribed supporter before delivery.`,
			blockedVerb: 'enable_workflow_email',
			preservedArtifact: 'workflow_definition',
			definitionSaved,
			gate: 'CP-workflow-email',
			taskIds: ['T1-9'],
			dependency: readiness.dependency,
			missing: readiness.missing,
			perRunDependencies: readiness.perRunDependencies
		},
		{ status: 424 }
	);
}

function hasEmailStep(steps: unknown): boolean {
	return (
		Array.isArray(steps) &&
		steps.some((step) => {
			return Boolean(
				step && typeof step === 'object' && (step as { type?: unknown }).type === 'send_email'
			);
		})
	);
}

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	if (!FEATURES.AUTOMATION) throw error(404, 'Not found');
	if (!locals.user) throw error(401, 'Authentication required');

	const body = await request.json();
	const hasDefinitionPatch =
		body.name !== undefined ||
		body.description !== undefined ||
		body.trigger !== undefined ||
		body.steps !== undefined;

	if (hasDefinitionPatch) {
		await serverMutation(api.workflows.update, {
			workflowId: params.id as Id<'workflows'>,
			slug: params.slug,
			name: body.name,
			description: body.description,
			trigger: body.trigger,
			steps: body.steps
		});
	}

	if (body.enabled === true) {
		const workflow = await serverQuery(api.workflows.get, {
			workflowId: params.id as Id<'workflows'>,
			slug: params.slug
		});

		if (!workflow) throw error(404, 'Workflow not found');
		if (hasEmailStep(workflow.steps)) {
			const orgKeyVerifier = await serverQuery(api.organizations.getOrgKeyVerifier, {
				slug: params.slug
			});
			const readiness = getWorkflowEmailRuntimeReadinessFromEnv({
				orgKeyConfigured: Boolean(orgKeyVerifier?.orgKeyVerifier)
			});
			if (!readiness.ready) {
				return workflowEmailDependencyBoundary(hasDefinitionPatch, readiness);
			}
		}
	}

	if (body.enabled !== undefined) {
		await serverMutation(api.workflows.setEnabled, {
			workflowId: params.id as Id<'workflows'>,
			slug: params.slug,
			enabled: Boolean(body.enabled)
		});
	}
	return json({ id: params.id, updatedAt: new Date().toISOString() });
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!FEATURES.AUTOMATION) throw error(404, 'Not found');
	if (!locals.user) throw error(401, 'Authentication required');

	await serverMutation(api.workflows.remove, {
		slug: params.slug,
		workflowId: params.id as Id<'workflows'>
	});

	return json({ success: true });
};
