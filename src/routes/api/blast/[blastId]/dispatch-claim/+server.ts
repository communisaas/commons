import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import { signDispatchClaim } from '$lib/server/email/dispatch-claim';
import type { Id } from '$convex/_generated/dataModel';
import type { RequestHandler } from './$types';

// Issue a server-signed dispatch claim binding (orgId, blastId, allowed
// recipient email hashes) for the Lambda bulk-send path. cure: without
// this, a compromised editor session or XSS on the compose page could direct
// the Lambda to send arbitrary HTML to arbitrary recipients with the 15-minute
// STS credential. With this, Lambda rejects any recipient whose hash is not
// in the claim — caller cannot widen the cohort beyond what the server
// authorized at this moment.
//
// Auth: caller must be an editor of the blast's owning org (verified via
// `getEncryptedSupportersForBlast`, which already enforces editor + filter).
// The claim's allowed-hash set is the SAME cohort the sender will fetch
// next (filter applied), so the dispatch envelope and the actual send list
// agree by construction.
export const GET: RequestHandler = async ({ params, locals, url }) => {
	if (!locals.user) {
		throw error(401, 'Authentication required');
	}
	const orgSlug = url.searchParams.get('orgSlug');
	if (!orgSlug) {
		throw error(400, 'orgSlug query parameter required');
	}
	const secret = env.BLAST_DISPATCH_SECRET;
	if (!secret) {
		throw error(503, 'Bulk-send dispatch is not configured (BLAST_DISPATCH_SECRET unset)');
	}

	const supporters = await serverQuery(api.blasts.getEncryptedSupportersForBlast, {
		orgSlug,
		blastId: params.blastId as Id<'emailBlasts'>
	});
	if (!Array.isArray(supporters)) {
		throw error(500, 'Recipient resolution returned non-array');
	}
	if (supporters.length === 0) {
		throw error(400, 'No recipients match the blast filter');
	}
	if (supporters.length > 10000) {
		throw error(400, 'Cohort exceeds 10000 recipients — split blasts');
	}

	// Pull orgId via the editor-gated lookup (intentional). The editor
	// gate is already enforced by `getEncryptedSupportersForBlast` above, so
	// this is belt-and-suspenders — but the call also returns just (orgId,
	// blastId) instead of the full blast row, less info exposed via this API.
	const blast = await serverQuery(api.email.getBlastForEditor, {
		blastId: params.blastId as Id<'emailBlasts'>,
		orgSlug
	});
	if (!blast) {
		throw error(404, 'Blast not found');
	}

	const allowedHashes = supporters.map((s) => s.emailHash);
	const claim = signDispatchClaim(
		{
			orgId: String(blast.orgId),
			blastId: String(params.blastId),
			allowedHashes
		},
		secret
	);
	return json({ claim, count: allowedHashes.length });
};
