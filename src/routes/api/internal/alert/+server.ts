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
import { captureWithContext } from '$lib/server/monitoring/sentry';
import { enforceInternalRateLimit } from '$lib/server/internal/rate-limit';
import { matchInternalSecret } from '$lib/server/internal/secret-auth';

type Severity = 'fatal' | 'error' | 'warning';

export const POST: RequestHandler = async ({ request }) => {
	const auth = matchInternalSecret(request.headers.get('x-internal-secret'));
	if (!auth.ok) {
		throw error(
			auth.reason === 'not_configured' ? 503 : 403,
			auth.reason === 'not_configured'
				? 'INTERNAL_API_SECRET not configured'
				: 'Invalid internal secret'
		);
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
