import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';

export const GET: RequestHandler = async ({ locals, cookies }) => {
	const seedCookie = cookies.get('oauth_pii_seed');
	let parsedSeed = null;
	if (seedCookie) {
		try { parsedSeed = JSON.parse(seedCookie); } catch {}
	}

	const diag: Record<string, unknown> = {
		hasUser: !!locals.user,
		hasSession: !!locals.session,
		hasConvexToken: !!locals.convexToken,
		userId: locals.user?.id ?? null,
		userEmail: locals.user?.email ?? 'NULL',
		userName: locals.user?.name ?? 'NULL',
		// Seed cookie state
		hasSeedCookie: !!seedCookie,
		seedEmail: parsedSeed?.email ?? 'NULL',
		seedName: parsedSeed?.name ?? 'NULL',
	};

	if (locals.convexToken) {
		try {
			const profile = await serverQuery(api.users.getProfile, {});
			diag.profileQuery = 'SUCCESS';
			diag.profileEmail = (profile as any)?.email ?? 'NULL';
			diag.profileHasEncryptedEmail = !!(profile as any)?.encryptedEmail;
			diag.profileEncryptedEmailLen = ((profile as any)?.encryptedEmail ?? '').length;
			diag.profileHasEncryptedName = !!(profile as any)?.encryptedName;
		} catch (err) {
			diag.profileQuery = 'FAILED';
			diag.profileError = err instanceof Error ? err.message : String(err);
		}
	}

	return json(diag);
};
