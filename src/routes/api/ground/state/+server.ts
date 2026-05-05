import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getMyGroundState } from '$lib/server/ground/ground-service';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) {
		throw error(401, 'Authentication required');
	}

	return json(await getMyGroundState());
};
