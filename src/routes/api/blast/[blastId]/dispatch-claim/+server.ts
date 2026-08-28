import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { serverMutation, serverQuery } from '$lib/server/convex-work-budget';
import { api } from '$lib/convex';
import { signDispatchClaim } from '$lib/server/email/dispatch-claim';
import { FEATURES } from '$lib/config/features';
import type { Id } from '$convex/_generated/dataModel';
import type { RequestHandler } from './$types';

type EncryptedSupporterPage = {
	recipients: Array<{ emailHash: string }>;
	continueCursor: string | null;
	isDone: boolean;
	scannedCount: number;
	maxRecipients: number;
	maxScanned: number;
};

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
	// Launch tombstone. A signed claim without a ledger reservation still mints
	// carrier authority, so deny before auth, Convex cohort reads, or signing.
	if (!FEATURES.EMAIL_SERVER_DISPATCH) {
		throw error(503, 'Bulk email dispatch is disabled');
	}
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

	// Gate-at-delivery: refuse to sign a dispatch claim when the org may not send.
	// Slug-first so a blocked org never pays the cohort scan, and BEFORE
	// signDispatchClaim so a direct API call can't mint send authority past quota.
	// inactive ⇒ maxEmails:0 ⇒ refused; exhausted ⇒ refused; null ⇒ fail closed.
	const limits = await serverQuery(api.subscriptions.checkPlanLimits, { orgSlug });
	if (!limits.usageReady) {
		if (limits.usageRepairRequired) {
			await serverMutation(api.subscriptions.requestPlanUsageRepair, { orgSlug });
		}
		throw error(503, {
			message: 'Billing usage is being rebuilt. No send authority was issued; retry shortly.',
			code: limits.usageFailureCode ?? 'PLAN_USAGE_NOT_READY'
		});
	}
	if (!limits?.current || limits.current.emailsSent >= limits.limits.maxEmails) {
		const subscribeGate = (limits?.limits.maxEmails ?? 0) <= 0;
		throw error(403, {
			message: subscribeGate
				? 'Sending to your people needs a plan. Authoring stays free.'
				: 'Email send limit reached for the current billing period. Upgrade your plan to send more.',
			code: subscribeGate ? 'DELIVERY_QUOTA_SUBSCRIBE_GATE' : 'EMAIL_QUOTA_EXCEEDED'
		});
	}

	let cursor: string | null = null;
	let scanned = 0;
	const allowedHashes: string[] = [];
	for (;;) {
		const page: EncryptedSupporterPage = await serverQuery(
			api.blasts.getEncryptedSupportersForBlast,
			{
				orgSlug,
				blastId: params.blastId as Id<'emailBlasts'>,
				cursor
			}
		);
		scanned += page.scannedCount;
		allowedHashes.push(...page.recipients.map((supporter) => supporter.emailHash));
		if (scanned > page.maxScanned || allowedHashes.length > page.maxRecipients) {
			throw error(400, 'Cohort exceeds the exact 10000-row audience envelope — narrow filters');
		}
		if (page.isDone) break;
		if (!page.continueCursor || page.continueCursor === cursor || scanned >= page.maxScanned) {
			throw error(400, 'Cohort scan exceeds the exact 10000-row audience envelope');
		}
		cursor = page.continueCursor;
	}
	if (allowedHashes.length === 0) {
		throw error(400, 'No recipients match the blast filter');
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
