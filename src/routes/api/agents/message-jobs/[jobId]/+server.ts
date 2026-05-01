import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { serverQuery } from 'convex-sveltekit';
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

	return json({ job });
};
