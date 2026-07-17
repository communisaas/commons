import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const startTime = Date.now();

/**
 * Process liveness only. Dependency and public-discovery release readiness
 * intentionally remain on /api/health so a producer incident cannot make the
 * edge process itself look dead.
 */
export const GET: RequestHandler = async () =>
	json(
		{
			status: 'ok',
			uptime: Math.floor((Date.now() - startTime) / 1000)
		},
		{
			status: 200,
			headers: { 'Cache-Control': 'no-store' }
		}
	);
