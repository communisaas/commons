import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';

import type { PageServerLoad } from './$types';

function asString(value: unknown, fallback = ''): string {
	return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export const load: PageServerLoad = async ({ parent }) => {
	const { org } = await parent();

	const convexResult = await serverQuery(api.email.listBlasts, {
		orgSlug: org.slug,
		paginationOpts: { numItems: 50, cursor: null }
	});

	return {
		blasts: convexResult.page.map((b: Record<string, unknown>) => ({
			id: asString(b._id),
			subject: asString(b.subject, '(no subject)'),
			status: asString(b.status, 'draft'),
			totalRecipients: asNumber(b.totalRecipients),
			totalSent: asNumber(b.totalSent),
			totalBounced: asNumber(b.totalBounced),
			sentAt: typeof b.sentAt === 'number'
				? new Date(b.sentAt).toISOString()
				: null,
			createdAt: typeof b._creationTime === 'number'
				? new Date(b._creationTime).toISOString()
				: new Date().toISOString(),
			campaignId: typeof b.campaignId === 'string' ? b.campaignId : null,
			campaignTitle: null,
			isAbTest: b.isAbTest === true,
			abVariant: typeof b.abVariant === 'string' ? b.abVariant : null,
			abParentId: typeof b.abParentId === 'string' ? b.abParentId : null
		}))
	};
};
