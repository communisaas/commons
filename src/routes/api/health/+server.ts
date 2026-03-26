import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';

const startTime = Date.now();

export const GET: RequestHandler = async () => {
	let convex = false;

	try {
		// Ping Convex with a lightweight paginated query (1 item, no data needed)
		await serverQuery(api.templates.list, {
			paginationOpts: { numItems: 1, cursor: null }
		});
		convex = true;
	} catch {
		// If Convex is unreachable, convex stays false
	}

	const status = convex ? 'ok' : 'down';
	const code = convex ? 200 : 503;

	return json(
		{
			status,
			convex,
			uptime: Math.floor((Date.now() - startTime) / 1000)
		},
		{ status: code }
	);
};
