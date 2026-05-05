import { error } from '@sveltejs/kit';
import { FEATURES } from '$lib/config/features';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { PageServerLoad } from './$types';

type PublicBill = {
	_id: string;
	externalId: string;
	title: string;
	status: string;
	jurisdiction: string;
};

type PublicReceipt = {
	_id: string;
	proofWeight: number;
	verifiedCount: number | null;
	causalityClass: string;
	dmAction: string | null;
	alignment: number;
	proofDeliveredAt: number | string;
	actionOccurredAt: number | string | null;
};

const isoDate = (value: number | string | null): string | null =>
	typeof value === 'number' ? new Date(value).toISOString() : value;

export const load: PageServerLoad = async ({ params }) => {
	if (!FEATURES.ACCOUNTABILITY) {
		throw error(404, 'Not found');
	}

	const { bioguideId } = params;

	const result = await serverQuery(api.legislation.getDmPublicProfile, { identifier: bioguideId });

	if (!result) throw error(404, 'No accountability records found');

	return {
		decisionMakerId: result.decisionMakerId,
		dmName: result.dmName,
		summary: result.summary,
		bills: result.bills
			.filter((entry): entry is typeof entry & { bill: PublicBill } => entry.bill !== null)
			.map((entry) => {
				const bill = entry.bill;
				return {
					bill: {
						id: bill._id,
						externalId: bill.externalId,
						title: bill.title,
						status: bill.status,
						jurisdiction: bill.jurisdiction
					},
					receipts: (entry.receipts as PublicReceipt[]).map((receipt) => ({
						id: receipt._id,
						proofWeight: receipt.proofWeight,
						verifiedCount: receipt.verifiedCount,
						causalityClass: receipt.causalityClass,
						dmAction: receipt.dmAction,
						alignment: receipt.alignment,
						proofDeliveredAt: isoDate(receipt.proofDeliveredAt) ?? '',
						actionOccurredAt: isoDate(receipt.actionOccurredAt)
					})),
					maxProofWeight: entry.maxProofWeight,
					totalVerified: entry.totalVerified,
					latestAction: entry.latestAction
				};
			})
	};
};
