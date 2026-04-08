import { redirect, error } from '@sveltejs/kit';
import { serverQuery, serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { PageServerLoad, Actions } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	const invite = await serverQuery(api.invites.getByToken, { token: params.token });

	if (!invite) {
		throw error(404, 'Invite not found');
	}

	if (invite.accepted) {
		throw redirect(302, `/org/${invite.orgSlug}`);
	}

	if (invite.expiresAt < Date.now()) {
		return {
			expired: true,
			orgName: invite.orgName,
			orgSlug: invite.orgSlug
		};
	}

	return {
		expired: false,
		orgName: invite.orgName,
		orgSlug: invite.orgSlug,
		orgAvatar: invite.orgAvatar,
		inviteEmail: invite.email,
		inviteRole: invite.role,
		isAuthenticated: !!locals.user,
		userEmail: locals.user?.email ?? null
	};
};

export const actions: Actions = {
	accept: async ({ params, locals }) => {
		if (!locals.user) {
			throw redirect(302, `/auth/google?returnTo=/org/invite/${params.token}`);
		}

		const invite = await serverQuery(api.invites.getByToken, { token: params.token });

		if (!invite || invite.accepted || invite.expiresAt < Date.now()) {
			throw error(400, 'This invite is no longer valid');
		}

		// Token-only acceptance — emailHash matching removed (compensating controls:
		// hashed token at rest, 72h TTL, owner notification on accept)

		// Accept invite via Convex mutation (handles membership creation + invite marking atomically)
		try {
			await serverMutation(api.invites.accept, { token: params.token });
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			if (msg.includes('already a member')) {
				// Already a member — just redirect
			} else {
				throw error(500, msg);
			}
		}

		throw redirect(302, `/org/${invite.orgSlug}`);
	}
};
