import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';

export const GET: RequestHandler = async ({ locals }) => {
	const diag: Record<string, unknown> = {
		hasUser: !!locals.user,
		hasSession: !!locals.session,
		hasConvexToken: !!locals.convexToken,
		userId: locals.user?.id ?? null,
		custodyMode: (locals.user as Record<string, unknown>)?.custody_mode ?? 'NOT_SET',
		userEmail: locals.user?.email ?? 'NULL',
		userName: locals.user?.name ?? 'NULL',
	};

	if (locals.convexToken) {
		try {
			const debugResult = await serverQuery(api.users.debugAuth, {});
			diag.debugAuth = debugResult;
		} catch (err) {
			diag.debugAuth = { error: err instanceof Error ? err.message : String(err) };
		}

		try {
			const profile = await serverQuery(api.users.getProfile, {});
			diag.profileQuery = 'SUCCESS';
			diag.profileCustodyMode = (profile as any)?.custodyMode ?? 'NOT_SET';
			diag.profileEmail = (profile as any)?.email ?? 'NULL';
			diag.profileEncryptedEmail = (profile as any)?.encryptedEmail ? 'PRESENT' : 'NULL';
			diag.profileEncryptedName = (profile as any)?.encryptedName ? 'PRESENT' : 'NULL';
		} catch (err) {
			diag.profileQuery = 'FAILED';
			diag.profileError = err instanceof Error ? err.message : String(err);
		}
	}

	return json(diag);
};
