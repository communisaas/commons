import { error, fail, redirect } from '@sveltejs/kit';
import { FEATURES } from '$lib/config/features';
import { api } from '$lib/convex';
import { serverMutation, serverQuery } from 'convex-sveltekit';
import type { Id } from '$convex/_generated/dataModel';
import type { Actions, PageServerLoad } from './$types';

type FundraiserFormValues = {
	title: string;
	description: string;
	goal_amount: string;
	currency: string;
	publish_now: boolean;
};

function stringValue(formData: FormData, key: keyof FundraiserFormValues): string {
	return formData.get(key)?.toString().trim() ?? '';
}

function valuesFromForm(formData: FormData): FundraiserFormValues {
	return {
		title: stringValue(formData, 'title'),
		description: stringValue(formData, 'description'),
		goal_amount: stringValue(formData, 'goal_amount'),
		currency: stringValue(formData, 'currency') || 'usd',
		publish_now: formData.get('publish_now') === 'on'
	};
}

function parseGoalCents(raw: string): number | undefined {
	if (!raw) return undefined;
	const dollars = Number(raw);
	if (!Number.isFinite(dollars)) return NaN;
	return Math.round(dollars * 100);
}

export const load: PageServerLoad = async ({ params, locals }) => {
	if (!FEATURES.FUNDRAISING) throw error(404, 'Not found');
	if (!locals.user) throw redirect(302, '/auth/login');

	const convexOrg = await serverQuery(api.organizations.getBySlug, { slug: params.slug });

	return {
		org: { name: convexOrg?.name ?? params.slug, slug: params.slug }
	};
};

export const actions: Actions = {
	default: async ({ request, params, locals }) => {
		if (!FEATURES.FUNDRAISING) throw error(404, 'Not found');
		if (!locals.user) throw redirect(302, '/auth/login');

		const formData = await request.formData();
		const values = valuesFromForm(formData);
		const goalAmountCents = parseGoalCents(values.goal_amount);

		if (values.title.length < 3 || values.title.length > 200) {
			return fail(400, { error: 'Fundraiser title must be 3-200 characters.', values });
		}
		if (values.description.length > 5000) {
			return fail(400, { error: 'Story must be 5,000 characters or fewer.', values });
		}
		if (!/^[a-zA-Z]{3,8}$/.test(values.currency)) {
			return fail(400, { error: 'Currency must be a short ISO currency code.', values });
		}
		if (
			goalAmountCents !== undefined &&
			(!Number.isInteger(goalAmountCents) ||
				goalAmountCents <= 0 ||
				goalAmountCents > 100_000_000_000)
		) {
			return fail(400, {
				error: 'Goal must be a positive amount up to $1,000,000,000.',
				values
			});
		}

		try {
			const created = (await serverMutation(api.donations.createFundraiser, {
				orgSlug: params.slug,
				title: values.title,
				description: values.description || undefined,
				goalAmountCents,
				currency: values.currency.toLowerCase()
			})) as { id: Id<'campaigns'> };

			if (values.publish_now) {
				await serverMutation(api.donations.updateFundraiser, {
					orgSlug: params.slug,
					campaignId: created.id,
					status: 'ACTIVE'
				});
			}

			throw redirect(303, `/org/${params.slug}/fundraising/${created.id}`);
		} catch (e) {
			if (
				e &&
				typeof e === 'object' &&
				'status' in e &&
				(e as { status?: number }).status === 303
			) {
				throw e;
			}
			return fail(400, {
				error: e instanceof Error ? e.message : 'Fundraiser could not be created.',
				values
			});
		}
	}
};
