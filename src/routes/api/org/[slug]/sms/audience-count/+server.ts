// CONVEX: Keep SvelteKit — SMS audience count boundary
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import type { Id } from '$convex/_generated/dataModel';
import { FEATURES } from '$lib/config/features';
import { countSmsAudience } from '$lib/server/sms/audience';
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

	let result: Awaited<ReturnType<typeof countSmsAudience>>;
	try {
		result = await countSmsAudience(params.slug, {
			tags: parsed.data.tags as Id<'tags'>[] | undefined,
			segments: parsed.data.segments as Id<'segments'>[] | undefined,
			excludeTags: parsed.data.excludeTags as Id<'tags'>[] | undefined
		});
	} catch (cause) {
		const code = cause instanceof Error ? cause.message : 'SMS_AUDIENCE_COUNT_FAILED';
		if (code.includes('SMS_AUDIENCE_COHORT_TOO_LARGE')) {
			return json(
				{
					error: 'text_audience_too_large',
					message: 'Text audiences are limited to 10,000 eligible recipients.'
				},
				{ status: 422 }
			);
		}
		throw cause;
	}

	return json({
		eligibleCount: result.eligibleCount,
		batchLimit: result.batchLimit,
		hasMoreThanBatchLimit: result.hasMoreThanBatchLimit,
		source: result.source
	});
};
