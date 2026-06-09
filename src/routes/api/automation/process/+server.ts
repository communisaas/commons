/**
 * POST /api/automation/process — Process scheduled workflows
 *
 * Authenticated via AUTOMATION_SECRET header (timingSafeEqual). Called by cron or
 * manual trigger. SvelteKit verifies the external cron secret, then calls a
 * shared-secret-gated Convex action to drain paused workflow executions.
 */

import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { timingSafeEqual } from 'crypto';
import { serverAction } from 'convex-sveltekit';
import { api } from '$lib/convex';
import { FEATURES } from '$lib/config/features';
import { getInternalSecret } from '$lib/server/internal/secret-auth';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	if (!FEATURES.AUTOMATION) throw error(404, 'Not found');

	const secret = request.headers.get('x-automation-secret');
	const expected = env.AUTOMATION_SECRET;
	if (!expected) throw error(503, 'Automation not configured');
	const secretBuf = Buffer.from(secret || '');
	const expectedBuf = Buffer.from(expected);
	if (secretBuf.length !== expectedBuf.length || !timingSafeEqual(secretBuf, expectedBuf)) {
		throw error(401, 'Invalid secret');
	}
	if (!FEATURES.WORKFLOW_EXECUTION) {
		return json(
			{
				error: 'workflow_execution_not_armed',
				message:
					'Coordination definitions can be saved; scheduled resume, tag writes, branch conditions, and trigger dispatch stay dependency-first until the workflow execution gate opens.',
				blockedVerb: 'process_workflow_schedule',
				preservedArtifact: 'workflow_definition',
				gate: 'CP-workflow-effects',
				taskIds: ['T1-9a'],
				dependency: 'Workflow execution feature gate',
				runnerImplemented: true
			},
			{ status: 424 }
		);
	}

	try {
		const result = await serverAction(api.workflows.processScheduledNow, {
			_secret: getInternalSecret()
		});

		return json({
			status: 'processed',
			processed: result.processed,
			runner: 'workflow_scheduled_resume',
			effect: 'paused executions with elapsed delays were queued for resume'
		});
	} catch (err) {
		console.error('[automation/process] workflow processing failed', err);
		throw error(503, 'Workflow processing failed');
	}
};
