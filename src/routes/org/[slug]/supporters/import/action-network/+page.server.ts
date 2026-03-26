import { fail, redirect } from '@sveltejs/kit';
import { serverQuery, serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { PageServerLoad, Actions } from './$types';

function requireRole(role: string, required: string): void {
	const hierarchy = ['viewer', 'member', 'editor', 'owner'];
	if (hierarchy.indexOf(role) < hierarchy.indexOf(required)) {
		throw new Error(`Role '${required}' required, got '${role}'`);
	}
}

export const load: PageServerLoad = async ({ parent, params }) => {
	const { membership } = await parent();
	requireRole(membership.role, 'editor');

	// Get AN sync state from org document
	const sync = await serverQuery(api.organizations.getAnSync, {
		slug: params.slug
	});

	return {
		sync: sync
			? {
					status: sync.status,
					syncType: sync.syncType,
					imported: sync.imported ?? 0,
					updated: sync.updated ?? 0,
					skipped: sync.skipped ?? 0,
					errors: sync.errors ?? null,
					lastSyncAt: sync.lastSyncAt ? new Date(sync.lastSyncAt).toISOString() : null,
					startedAt: sync.startedAt ? new Date(sync.startedAt).toISOString() : null,
					completedAt: sync.completedAt ? new Date(sync.completedAt).toISOString() : null,
					createdAt: new Date(sync.createdAt).toISOString()
				}
			: null,
		connected: sync?.connected ?? false
	};
};

export const actions: Actions = {
	connect: async ({ request, params, locals }) => {
		if (!locals.user) {
			throw redirect(302, `/auth/google?returnTo=/org/${params.slug}/supporters/import/action-network`);
		}

		const formData = await request.formData();
		const apiKey = formData.get('api_key')?.toString().trim();

		if (!apiKey) {
			return fail(400, { error: 'API key is required.' });
		}

		// Validate and store via Convex (validation + encryption happens server-side)
		try {
			await serverMutation(api.organizations.connectAnSync, {
				slug: params.slug,
				apiKey
			});
		} catch (e: any) {
			return fail(400, { error: e.message ?? 'Invalid API key.' });
		}

		return { connected: true };
	},

	sync: async ({ request, params, locals }) => {
		if (!locals.user) {
			throw redirect(302, `/auth/google?returnTo=/org/${params.slug}/supporters/import/action-network`);
		}

		const formData = await request.formData();
		const syncType = formData.get('sync_type')?.toString() === 'incremental' ? 'incremental' : 'full';

		// Start sync via Convex (validates no running sync, runs background sync)
		try {
			await serverMutation(api.organizations.startAnSync, {
				slug: params.slug,
				syncType
			});
		} catch (e: any) {
			return fail(400, { error: e.message ?? 'Failed to start sync.' });
		}

		return { syncing: true };
	},

	disconnect: async ({ params, locals }) => {
		if (!locals.user) {
			throw redirect(302, `/auth/google?returnTo=/org/${params.slug}/supporters/import/action-network`);
		}

		await serverMutation(api.organizations.disconnectAnSync, {
			slug: params.slug
		});

		return { disconnected: true };
	},

	refresh: async ({ params, locals }) => {
		if (!locals.user) {
			throw redirect(302, `/auth/google?returnTo=/org/${params.slug}/supporters/import/action-network`);
		}

		// Just reload — the load function will fetch the latest sync status
		return { refreshed: true };
	}
};
