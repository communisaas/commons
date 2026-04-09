import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';

/**
 * POST /api/pii/migrate — client writes back plaintext email/name
 * after successfully decrypting a client-encrypted blob. One-time
 * migration path: the mutation is a no-op if email is already set.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.user || !locals.session) {
		throw error(401, 'Not authenticated');
	}

	const body = await request.json();
	const { email, name } = body;

	if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
		throw error(400, 'Invalid email');
	}

	await serverMutation(api.users.migrateEmailToPlaintext, {
		email,
		name: name ?? undefined,
	});

	return json({ ok: true });
};
