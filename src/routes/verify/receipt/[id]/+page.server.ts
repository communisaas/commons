// CONVEX: Keep SvelteKit — server-only narrative generation
import { error } from '@sveltejs/kit';
import { serverQuery } from '$lib/server/convex-work-budget';
import { api } from '$lib/convex';
import { FEATURES } from '$lib/config/features';
import { generateNarrative } from '$lib/server/legislation/receipts/narrative';
import type { PageServerLoad } from './$types';
import { getInternalSecret } from '$lib/server/internal/secret-auth';

export const load: PageServerLoad = async ({ params }) => {
	if (!FEATURES.ACCOUNTABILITY) {
		throw error(404, 'Not found');
	}

	// A malformed id now comes back as null from the query rather than throwing
	// (convex/verify.ts normalizes it), so "no such receipt" is a 404. Anything
	// else reaching here is the backend being unavailable, which is a different
	// answer than "does not exist" and must not be reported as one — an
	// unguarded await surfaced both as a raw 500.
	let receipt: Awaited<ReturnType<typeof serverQuery<typeof api.verify.getReceipt>>>;
	try {
		receipt = await serverQuery(api.verify.getReceipt, {
			_secret: getInternalSecret(),
			receiptId: params.id
		});
	} catch (cause) {
		console.error(
			'[verify/receipt] receipt lookup failed:',
			cause instanceof Error ? cause.message : String(cause)
		);
		throw error(503, 'Receipt verification is temporarily unavailable');
	}

	if (!receipt) {
		throw error(404, 'Receipt not found');
	}

	// K-anonymity is enforced at the Convex query level (verify.getReceipt
	// already buckets/floors before returning); these locals are kept for
	// downstream readability and as defense-in-depth.
	const safeVerifiedCount = receipt.verifiedCount;
	const safeTotalCount = receipt.totalCount;
	const safeDistrictCount = receipt.districtCount;

	const narrative = generateNarrative({
		dmName: receipt.dmName,
		dmAction: receipt.dmAction,
		proofVerifiedAt: receipt.proofVerifiedAt ? new Date(receipt.proofVerifiedAt) : null,
		verifiedCount: safeVerifiedCount,
		districtCount: safeDistrictCount,
		causalityClass: receipt.causalityClass
	});

	return {
		receipt: {
			id: receipt._id,
			dmName: receipt.dmName,
			decisionMakerId: receipt.decisionMakerId,
			verifiedCount: safeVerifiedCount,
			totalCount: safeTotalCount,
			districtCount: safeDistrictCount,
			gds: receipt.gds,
			ald: receipt.ald,
			cai: receipt.cai,
			attestationDigest: receipt.attestationDigest,
			proofDeliveredAt: receipt.proofDeliveredAt
				? new Date(receipt.proofDeliveredAt).toISOString()
				: null,
			proofVerifiedAt: receipt.proofVerifiedAt
				? new Date(receipt.proofVerifiedAt).toISOString()
				: null,
			actionOccurredAt: receipt.actionOccurredAt
				? new Date(receipt.actionOccurredAt).toISOString()
				: null,
			causalityClass: receipt.causalityClass,
			dmAction: receipt.dmAction,
			alignment: receipt.alignment,
			actionSourceUrl: receipt.actionSourceUrl,
			anchorCid: receipt.anchorCid,
			narrative
		},
		bill: receipt.bill
	};
};
