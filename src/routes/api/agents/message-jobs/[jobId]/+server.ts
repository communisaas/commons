import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { serverQuery } from '$lib/server/convex-work-budget';
import { api } from '$lib/convex';

export const GET: RequestHandler = async (event) => {
	if (!event.locals.session?.userId) {
		return json({ error: 'Authentication required' }, { status: 401 });
	}

	const job = await serverQuery(api.messageJobs.getForUser, {
		jobId: event.params.jobId
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
