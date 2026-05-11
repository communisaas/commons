import { json, error } from '@sveltejs/kit';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import { buildUnsubscribeUrl } from '$lib/server/email/unsubscribe';
import type { Id } from '$convex/_generated/dataModel';
import type { RequestHandler } from './$types';

// Vend per-recipient unsubscribe URLs for a blast. Required to populate the
// `List-Unsubscribe` MIME header in the bulk-send Lambda — the HMAC secret
// stays server-side; the browser never sees it. cure path.
//
// Auth: caller MUST be an editor of the blast's owning org.
// `getBlast` is member-gated; using it here would let any org member mint
// valid unsubscribe URLs and unsubscribe the org's entire supporter list.
// `getBlastForEditor` enforces editor role server-side and returns just
// (orgId, blastId).
//
// Caller passes supporter IDs they intend to send to; this endpoint computes
// each `${baseUrl}/unsubscribe/${supporterId}/${orgId}/${token}` URL with the
// existing `unsubscribe.ts` HMAC scheme and returns them in the same order.
export const POST: RequestHandler = async ({ params, request, locals, url }) => {
	if (!locals.user) {
		throw error(401, 'Authentication required');
	}

	const orgSlug = url.searchParams.get('orgSlug');
	if (!orgSlug) {
		throw error(400, 'orgSlug query parameter required');
	}

	let body: { supporters?: Array<{ supporterId: string }> };
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON body');
	}

	const supporters = body.supporters;
	if (!Array.isArray(supporters)) {
		throw error(400, 'supporters must be an array');
	}
	if (supporters.length > 1000) {
		throw error(400, 'supporters batch limited to 1000 per request');
	}

	// `getBlastForEditor` enforces editor role server-side: caller must be an
	// editor of orgSlug, and the blast must belong to that org. Returns null
	// on either failure, which we map to 404. Members cannot reach this path.
	const verifiedBlast = await serverQuery(api.email.getBlastForEditor, {
		blastId: params.blastId as Id<'emailBlasts'>,
		orgSlug
	});
	if (!verifiedBlast) {
		throw error(404, 'Blast not found');
	}

	// orgId is taken from the verified blast row, NOT from the caller. This
	// removes any possibility of cross-org token vending (a caller cannot
	// request tokens scoped to an arbitrary org by claiming foreign supporter
	// rows belong there).
	const blastOrgId = String(verifiedBlast.orgId);

	// `buildUnsubscribeUrl` reads UNSUBSCRIBE_SECRET + PUBLIC_BASE_URL from
	// server env and throws if either is missing — surface as 503 so the
	// operator sees a clear configuration error rather than a silent
	// miscompute. The output URLs are 1:1 with the input order.
	let urls: string[];
	try {
		urls = supporters.map((s) => buildUnsubscribeUrl(s.supporterId, blastOrgId));
	} catch (err) {
		console.error('[unsubscribe-tokens] cannot build URL:', err);
		throw error(503, 'Unsubscribe service not configured');
	}

	return json({ urls });
};
