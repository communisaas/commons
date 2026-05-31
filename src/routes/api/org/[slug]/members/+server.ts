import { json, error } from '@sveltejs/kit';
import { serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { Id } from '$convex/_generated/dataModel';
import type { RequestHandler } from './$types';

/** Remove a member from the org (or self-leave). */
export const DELETE: RequestHandler = async ({ params, locals, request }) => {
	if (!locals.user) {
		throw error(401, 'Authentication required');
	}

	const body = await request.json();
	const { membershipId } = body as { membershipId?: string };
	if (!membershipId) throw error(400, 'membershipId is required');

	try {
		const result = await serverMutation(api.organizations.removeMember, {
			slug: params.slug!,
			membershipId: membershipId as Id<'orgMemberships'>
		});
		return json(result);
	} catch (e) {
		const message = e instanceof Error ? e.message : 'Failed to remove member';
		throw error(400, message);
	}
};

/** Update a member's role. */
export const PATCH: RequestHandler = async ({ params, locals, request }) => {
	if (!locals.user) {
		throw error(401, 'Authentication required');
	}

	const body = await request.json();
	const { membershipId, role } = body as {
		membershipId?: string;
		role?: 'owner' | 'editor' | 'member';
	};
	if (!membershipId) throw error(400, 'membershipId is required');
	if (role !== 'owner' && role !== 'editor' && role !== 'member') {
		throw error(400, 'role must be owner, editor, or member');
	}

	try {
		const result = await serverMutation(api.organizations.updateMemberRole, {
			slug: params.slug!,
			membershipId: membershipId as Id<'orgMemberships'>,
			role
		});
		return json(result);
	} catch (e) {
		const message = e instanceof Error ? e.message : 'Failed to update role';
		throw error(400, message);
	}
};
