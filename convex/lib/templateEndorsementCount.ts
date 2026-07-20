import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { ConvexError } from 'convex/values';

export const LEGACY_ENDORSEMENT_COUNT_REPAIR_LIMIT = 500;

export function isAuthoritativeEndorsementCount(value: number | undefined): value is number {
	return Number.isSafeInteger(value) && (value ?? -1) >= 0;
}

export async function boundedExactEndorsementCount(
	ctx: MutationCtx,
	templateId: Id<'templates'>
): Promise<number | null> {
	const rows = await ctx.db
		.query('templateEndorsements')
		.withIndex('by_templateId', (q) => q.eq('templateId', templateId))
		.take(LEGACY_ENDORSEMENT_COUNT_REPAIR_LIMIT + 1);
	return rows.length > LEGACY_ENDORSEMENT_COUNT_REPAIR_LIMIT ? null : rows.length;
}

export function throwEndorsementCountRepairRequired(templateId: Id<'templates'>): never {
	throw new ConvexError({
		code: 'ENDORSEMENT_COUNT_REPAIR_REQUIRED',
		templateId: String(templateId),
		limit: LEGACY_ENDORSEMENT_COUNT_REPAIR_LIMIT
	});
}
