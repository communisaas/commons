import { redirect } from '@sveltejs/kit';
import { db } from '$lib/core/db';
import { PUBLIC_CONVEX_URL } from '$env/static/public';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) {
		throw redirect(302, '/');
	}

	// ─── DUAL-STACK: Try Convex first, fallback to Prisma ───
	if (PUBLIC_CONVEX_URL) {
		try {
			const convexProfile = await serverQuery(api.users.getProfile, {});

			if (convexProfile) {
				console.log('[Security] Convex: loaded passkey status');

				return {
					passkey: convexProfile.hasPasskey
						? {
								createdAt: null, // Convex profile doesn't expose passkey dates
								lastUsedAt: null
							}
						: null
				};
			}
		} catch (err) {
			console.error('[Security] Convex failed, falling back to Prisma:', err);
		}
	}

	// ─── PRISMA FALLBACK ───

	const user = await db.user.findUnique({
		where: { id: locals.user.id },
		select: {
			passkey_credential_id: true,
			passkey_created_at: true,
			passkey_last_used_at: true
		}
	});

	return {
		passkey: user?.passkey_credential_id
			? {
					createdAt: user.passkey_created_at?.toISOString() ?? null,
					lastUsedAt: user.passkey_last_used_at?.toISOString() ?? null
				}
			: null
	};
};
