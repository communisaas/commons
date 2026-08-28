import { json, error } from '@sveltejs/kit';
import { serverQuery, serverAction, serverMutation } from '$lib/server/convex-work-budget';
import { api } from '$lib/convex';
import { getInternalSecret } from '$lib/server/internal/secret-auth';
import type { RequestHandler } from './$types';

/** Send invites to join an organization. */
export const POST: RequestHandler = async ({ params, locals, request }) => {
	if (!locals.user) {
		throw error(401, 'Authentication required');
	}

	const body = await request.json();
	const { invites } = body as {
		invites?: Array<{ emailHash: string; encryptedEmail: string; role?: string }>;
	};

	if (!invites?.length) {
		throw error(400, 'invites array is required');
	}
	if (invites.length > 20) {
		throw error(400, 'Maximum 20 invites at once');
	}
	for (const invite of invites) {
		if (
			typeof invite.emailHash !== 'string' ||
			invite.emailHash.length === 0 ||
			invite.emailHash.length > 128 ||
			typeof invite.encryptedEmail !== 'string' ||
			invite.encryptedEmail.length === 0 ||
			invite.encryptedEmail.length > 512 ||
			(invite.role !== undefined && (typeof invite.role !== 'string' || invite.role.length > 32))
		) {
			throw error(400, 'Invalid invite payload');
		}
	}

	const result = await serverAction(api.invites.create, {
		slug: params.slug,
		invites: invites.map((inv) => ({
			emailHash: inv.emailHash,
			encryptedEmail: inv.encryptedEmail,
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

	const result = await serverQuery(api.invites.list, {
		_secret: getInternalSecret(),
		slug: params.slug,
		nowBucket: Math.floor(Date.now() / 60_000) * 60_000
	});
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
	if (typeof inviteId !== 'string' || inviteId.length > 64) {
		throw error(400, 'Invalid inviteId');
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
	if (typeof inviteId !== 'string' || inviteId.length > 64) {
		throw error(400, 'Invalid inviteId');
	}

	const result = await serverAction(api.invites.resend, {
		slug: params.slug,
		inviteId
	});
	return json(result);
};
