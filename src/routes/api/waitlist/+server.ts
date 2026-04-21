/**
 * POST /api/waitlist — Join the beta waitlist
 *
 * Unauthenticated: body { email }
 * Authenticated: email pulled from session, body optional
 */

import { json, error } from '@sveltejs/kit';
import { serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';
import { getRateLimiter } from '$lib/core/security/rate-limiter';
import crypto from 'node:crypto';
import type { RequestHandler } from './$types';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function hashEmail(email: string): string {
	return crypto.createHash('sha256').update(email.toLowerCase().trim()).digest('hex');
}

export const POST: RequestHandler = async ({ locals, request, getClientAddress }) => {
	const ip = getClientAddress();
	const rl = await getRateLimiter().check(`ratelimit:waitlist:ip:${ip}`, {
		maxRequests: 5,
		windowMs: 60_000
	});
	if (!rl.allowed) throw error(429, 'Too many requests');

	let email: string;
	let userId: string | undefined;

	if (locals.user) {
		email = locals.user.email;
		userId = locals.user.id;
	} else {
		const body = await request.json().catch(() => null);
		if (!body?.email || typeof body.email !== 'string' || !EMAIL_RE.test(body.email)) {
			throw error(400, 'Valid email is required');
		}
		email = body.email;
	}

	const normalized = email.toLowerCase().trim();

	await serverMutation(api.waitlist.join, {
		email: normalized,
		emailHash: hashEmail(normalized),
		userId: userId as any,
		source: 'landing'
	});

	return json({ success: true });
};
