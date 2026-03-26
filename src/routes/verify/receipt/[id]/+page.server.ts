// CONVEX: Keep SvelteKit — server-only narrative generation
import { error } from '@sveltejs/kit';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import { FEATURES } from '$lib/config/features';
import { generateNarrative } from '$lib/server/legislation/receipts/narrative';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	if (!FEATURES.ACCOUNTABILITY) {
		throw error(404, 'Not found');
	}

	const receipt = await serverQuery(api.verify.getReceipt, { receiptId: params.id });

	if (!receipt) {
		throw error(404, 'Receipt not found');
	}

	// K-anonymity: suppress counts below thresholds to prevent pool-size inference
	const safeVerifiedCount = receipt.verifiedCount >= 5 ? receipt.verifiedCount : null;
	const safeTotalCount = receipt.totalCount >= 5 ? receipt.totalCount : null;
	const safeDistrictCount = receipt.districtCount >= 3 ? receipt.districtCount : null;

	const narrative = generateNarrative({
		dmName: receipt.dmName,
		dmAction: receipt.dmAction,
		proofVerifiedAt: receipt.proofVerifiedAt ? new Date(receipt.proofVerifiedAt) : null,
		verifiedCount: safeVerifiedCount,
		districtCount: safeDistrictCount,
		proofWeight: receipt.proofWeight,
		causalityClass: receipt.causalityClass
	});

	return {
		receipt: {
			id: receipt._id,
			dmName: receipt.dmName,
			decisionMakerId: receipt.decisionMakerId,
			proofWeight: receipt.proofWeight,
			verifiedCount: safeVerifiedCount,
			totalCount: safeTotalCount,
			districtCount: safeDistrictCount,
			gds: receipt.gds,
			ald: receipt.ald,
			cai: receipt.cai,
			attestationDigest: receipt.attestationDigest,
			proofDeliveredAt: receipt.proofDeliveredAt ? new Date(receipt.proofDeliveredAt).toISOString() : null,
			proofVerifiedAt: receipt.proofVerifiedAt ? new Date(receipt.proofVerifiedAt).toISOString() : null,
			actionOccurredAt: receipt.actionOccurredAt ? new Date(receipt.actionOccurredAt).toISOString() : null,
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
