import { error } from '@sveltejs/kit';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { Id } from '$convex/_generated/dataModel';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, url }) => {
	const cursor = url.searchParams.get('cursor');
	const numItems = Math.min(
		Math.max(Number(url.searchParams.get('limit') ?? '50'), 1),
		100
	);

	const blast = await serverQuery(api.email.getBlast, {
		orgSlug: params.slug,
		blastId: params.blastId as Id<'emailBlasts'>
	});
	if (!blast) {
		throw error(404, 'Blast not found');
	}

	const page = await serverQuery(api.email.listReceiptsForBlast, {
		orgSlug: params.slug,
		blastId: params.blastId as Id<'emailBlasts'>,
		paginationOpts: {
			numItems,
			cursor
		}
	});

	return {
		blast: {
			id: blast._id,
			subject: blast.subject,
			status: blast.status,
			totalRecipients: blast.totalRecipients,
			totalSent: blast.totalSent,
			totalBounced: blast.totalBounced,
			sentAt: blast.sentAt ?? null
		},
		receipts: page.page.map((r) => ({
			id: r._id,
			recipientEmailHash: r.recipientEmailHash,
			sesMessageId: r.sesMessageId ?? null,
			status: r.status,
			sentAt: r.sentAt,
			error: r.error ?? null
		})),
		cursor: page.continueCursor,
		hasMore: !page.isDone
	};
};
