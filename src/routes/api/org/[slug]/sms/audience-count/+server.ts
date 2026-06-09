// CONVEX: Keep SvelteKit — SMS audience count boundary
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { Id } from '$convex/_generated/dataModel';
import { FEATURES } from '$lib/config/features';
import type { RequestHandler } from './$types';

const RecipientFilterSchema = z
	.object({
		tags: z.array(z.string().max(64)).max(20).optional(),
		segments: z.array(z.string().max(64)).max(10).optional(),
		excludeTags: z.array(z.string().max(64)).max(20).optional()
	})
	.strict();

export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!FEATURES.SMS) throw error(404, 'Not found');
	if (!locals.user) throw error(401, 'Authentication required');

	const body = await request.json().catch(() => ({}));
	const parsed = RecipientFilterSchema.safeParse(body?.recipientFilter ?? {});
	if (!parsed.success) {
		return json(
			{
				error: 'text_audience_filter_invalid',
				message: 'Text audience filters must use saved tag, segment, or exclude-tag ids.',
				issues: parsed.error.issues.map((issue) => ({
					path: issue.path.join('.'),
					message: issue.message
				}))
			},
			{ status: 422 }
		);
	}

	const result = (await serverQuery(api.sms.countEligibleRecipientsForFilter, {
		slug: params.slug,
		recipientFilter: {
			tags: parsed.data.tags as Id<'tags'>[] | undefined,
			segments: parsed.data.segments as Id<'segments'>[] | undefined,
			excludeTags: parsed.data.excludeTags as Id<'tags'>[] | undefined
		}
	})) as {
		eligibleCount: number;
		batchLimit: number;
		hasMoreThanBatchLimit: boolean;
		source: string;
	};

	return json({
		eligibleCount: result.eligibleCount,
		batchLimit: result.batchLimit,
		hasMoreThanBatchLimit: result.hasMoreThanBatchLimit,
		source: result.source
	});
};
