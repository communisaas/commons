import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';

/**
 * POST /api/pii/encrypt — client sends device-encrypted PII blobs,
 * server forwards to Convex via authenticated serverMutation.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.user || !locals.session) {
		throw error(401, 'Not authenticated');
	}

	const body = await request.json();
	const { encryptedEmail, encryptedName } = body;

	if (!encryptedEmail || typeof encryptedEmail !== 'string') {
		throw error(400, 'Missing encryptedEmail');
	}

	await serverMutation(api.users.storeClientEncryptedPii, {
		encryptedEmail,
		encryptedName: encryptedName ?? undefined,
	});

	return json({ ok: true });
};
