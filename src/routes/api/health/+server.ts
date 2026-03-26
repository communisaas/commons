import { json } from '@sveltejs/kit';
// CONVEX: Keep SvelteKit
import type { RequestHandler } from './$types';
import { db } from '$lib/core/db';

const startTime = Date.now();

export const GET: RequestHandler = async () => {
	let postgres = false;

	try {
		await db.$queryRaw`SELECT 1`;
		postgres = true;
	} catch {
		// postgres unreachable
	}

	const status = postgres ? 'ok' : 'down';
	const code = postgres ? 200 : 503;

	return json(
		{
			status,
			postgres,
			uptime: Math.floor((Date.now() - startTime) / 1000)
		},
		{ status: code }
	);
};
