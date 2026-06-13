// CONVEX: Keep SvelteKit — donation list with server-side display
import { error, fail, redirect } from '@sveltejs/kit';
import { serverMutation, serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { Id } from '$convex/_generated/dataModel';
import { FEATURES } from '$lib/config/features';
import type { Actions, PageServerLoad } from './$types';

type DonorResult = {
	data: Array<{
		_id: string;
		encryptedName?: string | null;
		encryptedEmail?: string | null;
		amountCents: number;
		recurring: boolean;
		engagementTier: number;
		districtHash: string | null;
		completedAt: string | null;
		confirmationEmailStatus: 'sending' | 'sent' | 'skipped' | 'failed' | null;
		confirmationEmailAttemptedAt: string | null;
		confirmationEmailSentAt: string | null;
		confirmationEmailFailureReason: string | null;
		confirmationEmailProvider: string | null;
		confirmationEmailProviderMessageId: string | null;
	}>;
};

type ConfirmationSummary = {
	completed: number;
	sent: number;
	sending: number;
	skipped: number;
	failed: number;
	notRecorded: number;
	attempted: number;
	providerAccepted: number;
};

type ReceiptPolicyMode = 'confirmation_only' | 'tax_acknowledgment_policy';

function cleanReceiptPolicyInput(formData: FormData):
	| {
			mode: ReceiptPolicyMode;
			legalName?: string;
			acknowledgmentText?: string;
	  }
	| null
	| { error: string } {
	const mode = formData.get('receipt_policy_mode')?.toString();
	if (mode === 'none') return null;
	if (mode !== 'confirmation_only' && mode !== 'tax_acknowledgment_policy') {
		return { error: 'Receipt policy mode is invalid.' };
	}
	const legalName = formData.get('receipt_legal_name')?.toString().trim() ?? '';
	const acknowledgmentText = formData.get('receipt_acknowledgment_text')?.toString().trim() ?? '';
	if (legalName.length > 200) {
		return { error: 'Receipt legal name must be 200 characters or fewer.' };
	}
	if (acknowledgmentText.length > 1000) {
		return { error: 'Receipt acknowledgment text must be 1,000 characters or fewer.' };
	}
	return {
		mode,
		legalName: legalName || undefined,
		acknowledgmentText: acknowledgmentText || undefined
	};
}

export const load: PageServerLoad = async ({ params, locals }) => {
	if (!FEATURES.FUNDRAISING) throw error(404, 'Not found');
	if (!locals.user) throw redirect(302, '/auth/login');

	const orgCtx = await serverQuery(api.organizations.getOrgContext, { slug: params.slug });
	const campaign = await serverQuery(api.campaigns.get, {
		campaignId: params.id as Id<'campaigns'>
	});

	if (!campaign || campaign.type !== 'FUNDRAISER') throw error(404, 'Fundraiser not found');

	const [donors, confirmationSummary] = (await Promise.all([
		serverQuery(api.donations.listDonors, {
			orgSlug: params.slug,
			campaignId: params.id as Id<'campaigns'>
		}),
		serverQuery(api.donations.getConfirmationSummary, {
			orgSlug: params.slug,
			campaignId: params.id as Id<'campaigns'>
		})
	])) as [DonorResult, ConfirmationSummary];

	const memberRole = orgCtx?.membership?.role;
	const canManageFundraiser = Boolean(
		memberRole && ['editor', 'admin', 'owner'].includes(memberRole)
	);

	return {
		org: { name: orgCtx.org.name, slug: orgCtx.org.slug },
		canManageFundraiser,
		campaign: {
			id: campaign._id,
			title: campaign.title,
			body: campaign.body,
			status: campaign.status,
			goalAmountCents: campaign.goalAmountCents,
			raisedAmountCents: campaign.raisedAmountCents,
			donorCount: campaign.donorCount,
			donationCurrency: campaign.donationCurrency ?? 'usd',
			donationReceiptPolicy: campaign.donationReceiptPolicy ?? null,
			createdAt: new Date(campaign._creationTime).toISOString()
		},
		confirmationSummary,
		donors: donors.data.map((d) => ({
			id: d._id,
			name: d.encryptedName ? '[encrypted]' : 'Anonymous',
			email: d.encryptedEmail ? '[encrypted]' : '',
			amountCents: d.amountCents,
			recurring: d.recurring,
			engagementTier: d.engagementTier,
			districtHash: d.districtHash,
			completedAt: d.completedAt,
			confirmationEmailStatus: d.confirmationEmailStatus,
			confirmationEmailAttemptedAt: d.confirmationEmailAttemptedAt,
			confirmationEmailSentAt: d.confirmationEmailSentAt,
			confirmationEmailFailureReason: d.confirmationEmailFailureReason,
			confirmationEmailProvider: d.confirmationEmailProvider,
			confirmationEmailProviderMessageId: d.confirmationEmailProviderMessageId
		}))
	};
};

async function setFundraiserStatus(
	params: { slug: string; id: string },
	status: 'ACTIVE' | 'COMPLETE'
) {
	await serverMutation(api.donations.updateFundraiser, {
		orgSlug: params.slug,
		campaignId: params.id as Id<'campaigns'>,
		status
	});
	return { statusChanged: status };
}

export const actions: Actions = {
	publish: async ({ params, locals }) => {
		if (!FEATURES.FUNDRAISING) throw error(404, 'Not found');
		if (!locals.user) throw redirect(302, '/auth/login');
		try {
			return await setFundraiserStatus(params, 'ACTIVE');
		} catch (e) {
			return fail(400, {
				error: e instanceof Error ? e.message : 'Fundraiser could not be published.'
			});
		}
	},
	complete: async ({ params, locals }) => {
		if (!FEATURES.FUNDRAISING) throw error(404, 'Not found');
		if (!locals.user) throw redirect(302, '/auth/login');
		try {
			return await setFundraiserStatus(params, 'COMPLETE');
		} catch (e) {
			return fail(400, {
				error: e instanceof Error ? e.message : 'Fundraiser could not be closed.'
			});
		}
	},
	saveReceiptPolicy: async ({ request, params, locals }) => {
		if (!FEATURES.FUNDRAISING) throw error(404, 'Not found');
		if (!locals.user) throw redirect(302, '/auth/login');
		const formData = await request.formData();
		const policy = cleanReceiptPolicyInput(formData);
		if (policy && 'error' in policy) {
			return fail(400, { error: policy.error });
		}
		try {
			await serverMutation(api.donations.updateFundraiser, {
				orgSlug: params.slug,
				campaignId: params.id as Id<'campaigns'>,
				donationReceiptPolicy: policy
			});
			return { receiptPolicySaved: true };
		} catch (e) {
			return fail(400, {
				error: e instanceof Error ? e.message : 'Receipt policy could not be saved.'
			});
		}
	}
};
