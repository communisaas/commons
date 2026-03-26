import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';

import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
	const { org } = await parent();

	const convexResult = await serverQuery(api.email.listBlasts, {
		orgSlug: org.slug,
		paginationOpts: { numItems: 50, cursor: null }
	});

	return {
		blasts: convexResult.page.map((b: Record<string, unknown>) => ({
			id: b._id,
			subject: b.subject,
			status: b.status,
			totalRecipients: b.totalRecipients ?? 0,
			totalSent: b.totalSent ?? 0,
			totalBounced: b.totalBounced ?? 0,
			sentAt: typeof b.sentAt === 'number'
				? new Date(b.sentAt as number).toISOString()
				: null,
			createdAt: typeof b._creationTime === 'number'
				? new Date(b._creationTime as number).toISOString()
				: new Date().toISOString(),
			campaignId: b.campaignId ?? null,
			campaignTitle: null,
			isAbTest: b.isAbTest ?? false,
			abVariant: b.abVariant ?? null,
			abParentId: b.abParentId ?? null
		}))
	};
};
