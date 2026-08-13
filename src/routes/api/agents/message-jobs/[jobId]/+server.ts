import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { serverQuery } from '$lib/server/convex-work-budget';
import { api } from '$lib/convex';
import { requireAuthenticatedAgentRequest } from '$lib/server/agent-request-authority';
import { readBoundedAgentRequest } from '$lib/server/agent-request-envelope';

export const GET: RequestHandler = async (event) => {
	const authenticatedUserId = requireAuthenticatedAgentRequest(event);
	if (authenticatedUserId instanceof Response) return authenticatedUserId;
	const requestEnvelope = await readBoundedAgentRequest(event, 'message-job');
	if (requestEnvelope instanceof Response) return requestEnvelope;

	const job = await serverQuery(api.messageJobs.getForUser, {
		jobId: requestEnvelope.jobId
	});

	if (!job) {
		return json({ error: 'Message generation job not found' }, { status: 404 });
	}

	const terminal =
		job.status === 'completed' || job.status === 'failed' || job.status === 'expired';
	const responseJob =
		!terminal && job.expiresAt <= Date.now() ? { ...job, status: 'expired' as const } : job;

	return json({ job: responseJob });
};
