import { error } from '@sveltejs/kit';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, parent }) => {
	const { org } = await parent();

	const convexBlast = await serverQuery(api.email.getBlast, {
		orgSlug: org.slug,
		blastId: params.blastId as any
	});

	if (!convexBlast) throw error(404, 'Email not found');

	return {
		isAbTest: false,
		blast: {
			id: convexBlast._id,
			subject: convexBlast.subject,
			status: convexBlast.status,
			abVariant: convexBlast.abVariant ?? null,
			totalRecipients: convexBlast.totalRecipients ?? 0,
			totalSent: convexBlast.totalSent ?? 0,
			totalBounced: convexBlast.totalBounced ?? 0,
			totalOpened: convexBlast.totalOpened ?? 0,
			totalClicked: convexBlast.totalClicked ?? 0,
			totalComplained: convexBlast.totalComplained ?? 0,
			sentAt: typeof convexBlast.sentAt === 'number'
				? new Date(convexBlast.sentAt).toISOString()
				: null,
			createdAt: typeof convexBlast._creationTime === 'number'
				? new Date(convexBlast._creationTime).toISOString()
				: String(convexBlast._creationTime),
			abWinnerPickedAt: typeof convexBlast.abWinnerPickedAt === 'number'
				? new Date(convexBlast.abWinnerPickedAt).toISOString()
				: null
		},
		variants: [],
		winnerBlast: null,
		bounceEvents: []
	};
};
