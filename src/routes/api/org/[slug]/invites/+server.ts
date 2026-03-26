import { json, error } from '@sveltejs/kit';
import { serverQuery, serverAction, serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { RequestHandler } from './$types';

/** Send invites to join an organization. */
export const POST: RequestHandler = async ({ params, locals, request }) => {
	if (!locals.user) {
		throw error(401, 'Authentication required');
	}

	const body = await request.json();
	const { invites } = body as {
		invites?: Array<{ email: string; role?: string }>;
	};

	const result = await serverAction(api.invites.create, {
		slug: params.slug,
		invites: (invites ?? []).map((inv) => ({
			email: inv.email,
			role: inv.role
		}))
	});
	return json(result, { status: 201 });
};

/** List pending invites for an org. */
export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) {
		throw error(401, 'Authentication required');
	}

	const result = await serverQuery(api.invites.list, { slug: params.slug });
	return json(result);
};

/** Revoke a pending invite. */
export const DELETE: RequestHandler = async ({ params, locals, request }) => {
	if (!locals.user) {
		throw error(401, 'Authentication required');
	}

	const body = await request.json();
	const { inviteId } = body as { inviteId?: string };

	if (!inviteId) {
		throw error(400, 'inviteId is required');
	}

	await serverMutation(api.invites.remove, {
		slug: params.slug,
		inviteId
	});
	return json({ ok: true });
};

/** Resend a pending invite (regenerate token + reset expiry). */
export const PATCH: RequestHandler = async ({ params, locals, request }) => {
	if (!locals.user) {
		throw error(401, 'Authentication required');
	}

	const body = await request.json();
	const { inviteId } = body as { inviteId?: string };

	if (!inviteId) {
		throw error(400, 'inviteId is required');
	}

	const result = await serverAction(api.invites.resend, {
		slug: params.slug,
		inviteId
	});
	return json(result);
};
