/**
 * Internal alert emitter.
 *
 * Convex actions POST here to raise P0/P1 alerts that must reach Sentry
 * (and whatever paging hooks Sentry has configured) rather than only
 * appearing in Convex logs where they may go unnoticed.
 *
 * Authentication: shared INTERNAL_API_SECRET header.
 */
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { captureWithContext } from '$lib/server/monitoring/sentry';
import { enforceInternalRateLimit } from '$lib/server/internal/rate-limit';

type Severity = 'fatal' | 'error' | 'warning';

export const POST: RequestHandler = async ({ request }) => {
	const expected = env.INTERNAL_API_SECRET;
	if (!expected) {
		throw error(503, 'INTERNAL_API_SECRET not configured');
	}
	const provided = request.headers.get('x-internal-secret');
	if (!provided || provided !== expected) {
		throw error(403, 'Invalid internal secret');
	}

	// Alert fan-out hits Sentry (costs quota). 300/min tolerates burst alerts
	// during a real incident while still capping a leaked-secret flood.
	await enforceInternalRateLimit({ endpoint: 'alert', maxRequests: 300, windowMs: 60_000 });

	const body = (await request.json().catch(() => null)) as
		| { code?: string; message?: string; severity?: Severity; context?: Record<string, unknown> }
		| null;
	if (!body || typeof body.code !== 'string' || typeof body.message !== 'string') {
		throw error(400, 'Missing code or message');
	}

	const err = new Error(`[${body.code}] ${body.message}`);
	const level = body.severity ?? 'error';

	captureWithContext(err, {
		action: body.code,
		level,
		...(body.context as { userId?: string; orgId?: string } | undefined)
	});

	return json({ success: true });
};
