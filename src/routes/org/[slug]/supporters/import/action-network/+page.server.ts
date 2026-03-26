// CONVEX: Keep SvelteKit — external Action Network API + encrypted key storage + background sync (no Convex anSync table)
import { fail, redirect } from '@sveltejs/kit';
import { serverQuery, serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';
import { serverAction } from 'convex-sveltekit';
import { loadOrgContext, requireRole } from '$lib/server/org';
import { encryptApiKey, decryptApiKey } from '$lib/server/an/crypto';
import { validateApiKey } from '$lib/server/an/client';
import { runSync } from '$lib/server/an/importer';
import type { PageServerLoad, Actions } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
	const { org, membership } = await parent();
	requireRole(membership.role, 'editor');

	// Get latest sync for this org
	const latestSync = await db.anSync.findFirst({
		where: { orgId: org.id },
		orderBy: { createdAt: 'desc' },
		select: {
			id: true,
			status: true,
			syncType: true,
			totalResources: true,
			processedResources: true,
			currentResource: true,
			imported: true,
			updated: true,
			skipped: true,
			errors: true,
			lastSyncAt: true,
			startedAt: true,
			completedAt: true,
			createdAt: true
		}
	});

	// Check if an API key is connected (any sync record exists with a key)
	const hasConnection = await db.anSync.count({
		where: { orgId: org.id }
	});

	return {
		sync: latestSync
			? {
					...latestSync,
					lastSyncAt: latestSync.lastSyncAt?.toISOString() ?? null,
					startedAt: latestSync.startedAt?.toISOString() ?? null,
					completedAt: latestSync.completedAt?.toISOString() ?? null,
					createdAt: latestSync.createdAt.toISOString(),
					errors: (latestSync.errors as string[] | null) ?? null
				}
			: null,
		connected: hasConnection > 0
	};
};

export const actions: Actions = {
	connect: async ({ request, params, locals }) => {
		if (!locals.user) {
			throw redirect(302, `/auth/google?returnTo=/org/${params.slug}/supporters/import/action-network`);
		}
		const { org, membership } = await loadOrgContext(params.slug, locals.user.id);
		requireRole(membership.role, 'editor');

		const formData = await request.formData();
		const apiKey = formData.get('api_key')?.toString().trim();

		if (!apiKey) {
			return fail(400, { error: 'API key is required.' });
		}

		// Validate the key
		const validation = await validateApiKey(apiKey);
		if (!validation.valid) {
			return fail(400, { error: validation.error ?? 'Invalid API key.' });
		}

		// Encrypt and store
		const encryptedKey = encryptApiKey(apiKey);

		// Create initial sync record (idle, so we have the key stored)
		await db.anSync.create({
			data: {
				orgId: org.id,
				apiKey: encryptedKey,
				status: 'idle',
				syncType: 'full'
			}
		});

		return { connected: true };
	},

	sync: async ({ request, params, locals, platform }) => {
		if (!locals.user) {
			throw redirect(302, `/auth/google?returnTo=/org/${params.slug}/supporters/import/action-network`);
		}
		const { org, membership } = await loadOrgContext(params.slug, locals.user.id);
		requireRole(membership.role, 'editor');

		const formData = await request.formData();
		const syncType = formData.get('sync_type')?.toString() === 'incremental' ? 'incremental' : 'full';

		// Check no sync is currently running
		const runningSync = await db.anSync.findFirst({
			where: { orgId: org.id, status: 'running' }
		});
		if (runningSync) {
			return fail(400, { error: 'A sync is already in progress.' });
		}

		// Get the stored API key from the most recent sync record
		const existingSync = await db.anSync.findFirst({
			where: { orgId: org.id },
			orderBy: { createdAt: 'desc' },
			select: { apiKey: true, lastSyncAt: true }
		});

		if (!existingSync) {
			return fail(400, { error: 'No API key configured. Please connect first.' });
		}

		let apiKey: string;
		try {
			apiKey = decryptApiKey(existingSync.apiKey);
		} catch {
			return fail(400, { error: 'Failed to decrypt API key. Please reconnect.' });
		}

		// Create new sync record
		const newSync = await db.anSync.create({
			data: {
				orgId: org.id,
				apiKey: existingSync.apiKey,
				status: 'running',
				syncType,
				startedAt: new Date()
			}
		});

		// Capture concrete PrismaClient before async context
		const prisma = getRequestClient();

		// Run sync in background
		const syncPromise = runSync(
			newSync.id,
			org.id,
			apiKey,
			syncType as 'full' | 'incremental',
			existingSync.lastSyncAt,
			prisma
		).catch((err) => {
			console.error(`[an-sync] Sync ${newSync.id} error:`, err);
		});

		// Use waitUntil on CF Workers to keep the isolate alive
		if (platform?.context?.waitUntil) {
			platform.context.waitUntil(syncPromise);
		}

		return { syncing: true, syncId: newSync.id };
	},

	disconnect: async ({ params, locals }) => {
		if (!locals.user) {
			throw redirect(302, `/auth/google?returnTo=/org/${params.slug}/supporters/import/action-network`);
		}
		const { org, membership } = await loadOrgContext(params.slug, locals.user.id);
		requireRole(membership.role, 'owner');

		// Delete all sync records for this org
		await db.anSync.deleteMany({
			where: { orgId: org.id }
		});

		return { disconnected: true };
	},

	refresh: async ({ params, locals }) => {
		if (!locals.user) {
			throw redirect(302, `/auth/google?returnTo=/org/${params.slug}/supporters/import/action-network`);
		}
		const { org } = await loadOrgContext(params.slug, locals.user.id);

		// Just reload — the load function will fetch the latest sync status
		return { refreshed: true };
	}
};
