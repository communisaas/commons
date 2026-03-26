/**
 * Bounce Report Endpoint
 *
 * POST /api/emails/report-bounce
 *
 * Allows verified users (trust_tier >= 2) to report a suspected bounce.
 * The report is triaged — NOT immediately suppressed.
 *
 * Rate limited: 5 req/min (external middleware), 10 active reports per user cap
 */

import type { RequestHandler } from './$types';
import { serverQuery, serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 254; // RFC 5321
const MAX_ACTIVE_REPORTS_PER_USER = 10;
const MIN_TRUST_TIER = 2; // Require address-verified identity

export const POST: RequestHandler = async (event) => {
	const session = event.locals.session;
	const user = event.locals.user;

	if (!session?.userId || !user) {
		return new Response(JSON.stringify({ error: 'Authentication required' }), {
			status: 401,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	// Trust tier gate — only verified users can submit reports
	if ((user.trust_tier ?? 0) < MIN_TRUST_TIER) {
		return new Response(
			JSON.stringify({ error: 'Account verification required to report bounces' }),
			{ status: 403, headers: { 'Content-Type': 'application/json' } }
		);
	}

	let body: { email?: string };
	try {
		body = (await event.request.json()) as { email?: string };
	} catch {
		return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	const email = body.email?.trim().toLowerCase();
	if (!email || email.length > MAX_EMAIL_LENGTH || !EMAIL_RE.test(email)) {
		return new Response(JSON.stringify({ error: 'Valid email address required' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	// Per-user cap — prevent mass reporting
	const activeReports = await serverQuery(api.email.countActiveReports, {
		userId: session.userId
	});

	if (activeReports >= MAX_ACTIVE_REPORTS_PER_USER) {
		return new Response(
			JSON.stringify({ error: 'Maximum bounce reports reached' }),
			{ status: 429, headers: { 'Content-Type': 'application/json' } }
		);
	}

	// Deduplicate: same user can't report same email twice while unresolved
	// Returns identical 202 to prevent resolution-state oracle
	const existing = await serverQuery(api.email.findUnresolvedReport, {
		userId: session.userId,
		email
	});
	if (existing) {
		return new Response(
			JSON.stringify({
				status: 'reported',
				message: 'Report received. We will investigate and take action if confirmed.',
			}),
			{ status: 202, headers: { 'Content-Type': 'application/json' } }
		);
	}

	try {
		await serverMutation(api.email.createBounceReport, {
			email,
			reportedBy: session.userId
		});

		// Opaque response — never leak domain classification, probe state, or report count
		return new Response(
			JSON.stringify({
				status: 'reported',
				message: 'Report received. We will investigate and take action if confirmed.',
			}),
			{ status: 202, headers: { 'Content-Type': 'application/json' } }
		);
	} catch {
		return new Response(
			JSON.stringify({ error: 'Failed to record bounce report' }),
			{ status: 500, headers: { 'Content-Type': 'application/json' } }
		);
	}
};
