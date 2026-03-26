// CONVEX: Keep SvelteKit — server-secret auth (AUTOMATION_SECRET via timingSafeEqual),
// processScheduledWorkflows calls complex Prisma workflow engine.
/**
 * POST /api/automation/process — Process scheduled workflows
 *
 * Authenticated via AUTOMATION_SECRET header. Called by cron or manual trigger.
 */

import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { timingSafeEqual } from 'crypto';
import { FEATURES } from '$lib/config/features';
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

	const processed = await processScheduledWorkflows();
	return json({ processed });
};
