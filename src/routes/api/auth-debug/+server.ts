// TEMP: diagnostic endpoint to trace auth chain failures. DELETE after fix.
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';

export const GET: RequestHandler = async ({ locals }) => {
	const diag: Record<string, unknown> = {
		timestamp: new Date().toISOString(),
		hasUser: !!locals.user,
		hasSession: !!locals.session,
		hasConvexToken: !!locals.convexToken,
		convexTokenLength: locals.convexToken?.length ?? 0,
		userId: locals.user?.id ?? null,
		envCheck: {
			hasJwtKey: !!process.env.CONVEX_JWT_PRIVATE_KEY,
			jwtKeyLength: process.env.CONVEX_JWT_PRIVATE_KEY?.length ?? 0,
			hasPiiKey: !!process.env.PII_ENCRYPTION_KEY,
			convexUrl: process.env.PUBLIC_CONVEX_URL ?? 'NOT SET',
			oauthRedirect: process.env.OAUTH_REDIRECT_BASE_URL ?? 'NOT SET',
		}
	};

	if (locals.user && locals.convexToken) {
		try {
			const profile = await serverQuery(api.users.getProfile, {});
			diag.convexProfileQuery = profile ? 'SUCCESS' : 'RETURNED_NULL';
			diag.profileHasTokenIdentifier = !!(profile as any)?.tokenIdentifier;
		} catch (err) {
			diag.convexProfileQuery = 'FAILED';
			diag.convexProfileError = err instanceof Error ? err.message : String(err);
		}
	} else if (locals.user && !locals.convexToken) {
		diag.diagnosis = 'JWT_MINT_FAILED — user exists but no convexToken. Check CONVEX_JWT_PRIVATE_KEY.';
	}

	return json(diag);
};
