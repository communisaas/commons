import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { ConvexError, getConvexSize, v, type Value } from 'convex/values';
import { assertPublicDiscoveryDirectSourceServingReady } from './publicDiscovery';

export const TEMPLATE_LIST_PROJECTION_VERSION = 1;
export const TEMPLATE_LIST_PROJECTION_KEY = 'v1' as const;
export const TEMPLATE_LIST_MAX_PAGE_SIZE = 50;
export const TEMPLATE_LIST_MAX_PAGE_BYTES = 256 * 1024;

// Writers cap the value before Convex adds `_id` and `_creationTime`. Readers
// independently cap the stored document at 4.5 KiB. Fifty requested rows plus
// the one-row pagination lookahead therefore remain below 256 KiB.
export const TEMPLATE_LIST_MAX_PROJECTION_VALUE_BYTES = 4_000;
export const TEMPLATE_LIST_MAX_STORED_ROW_BYTES = 4_500;
export const TEMPLATE_LIST_DESCRIPTION_PREVIEW_BYTES = 2_048;
export const TEMPLATE_LIST_TITLE_PREVIEW_BYTES = 512;
export const TEMPLATE_LIST_SLUG_PREVIEW_BYTES = 400;
export const TEMPLATE_LIST_DOMAIN_PREVIEW_BYTES = 200;

const utf8Encoder = new TextEncoder();

export const templateListPaginationValidator = v.object({
	numItems: v.number(),
	cursor: v.union(v.string(), v.null())
});

export type TemplateListPagination = {
	numItems: number;
	cursor: string | null;
};

type TemplateListProjectionValue = Omit<Doc<'templateListProjections'>, '_id' | '_creationTime'>;

function resolveTemplateDomain(template: Doc<'templates'>): string {
	if (template.domain) return template.domain;
	return template.category && template.category !== 'General' ? template.category : '';
}

/** Deterministic code-point prefix; never emits a split UTF-16 surrogate/UTF-8 sequence. */
export function boundedTemplateListString(
	value: string,
	maxBytes: number
): {
	preview: string;
	truncated: boolean;
	originalBytes: number;
} {
	const originalBytes = utf8Encoder.encode(value).byteLength;
	if (originalBytes <= maxBytes) {
		return { preview: value, truncated: false, originalBytes };
	}
	let preview = '';
	let previewBytes = 0;
	for (const codePoint of value) {
		const codePointBytes = utf8Encoder.encode(codePoint).byteLength;
		if (previewBytes + codePointBytes > maxBytes) break;
		preview += codePoint;
		previewBytes += codePointBytes;
	}
	return { preview, truncated: true, originalBytes };
}

export function boundedTemplateListDescription(description: string) {
	return boundedTemplateListString(description, TEMPLATE_LIST_DESCRIPTION_PREVIEW_BYTES);
}

function projectionValue(template: Doc<'templates'>): TemplateListProjectionValue {
	const description = boundedTemplateListDescription(template.description);
	const title = boundedTemplateListString(template.title, TEMPLATE_LIST_TITLE_PREVIEW_BYTES);
	const slug = boundedTemplateListString(template.slug, TEMPLATE_LIST_SLUG_PREVIEW_BYTES);
	const domain = boundedTemplateListString(
		resolveTemplateDomain(template),
		TEMPLATE_LIST_DOMAIN_PREVIEW_BYTES
	);
	const base = {
		templateId: template._id,
		templateCreatedAt: template._creationTime,
		userId: template.userId,
		orgId: template.orgId,
		slug: slug.preview,
		slugTruncated: slug.truncated,
		slugOriginalBytes: slug.originalBytes,
		title: title.preview,
		titleTruncated: title.truncated,
		titleOriginalBytes: title.originalBytes,
		description: description.preview,
		descriptionTruncated: description.truncated,
		descriptionOriginalBytes: description.originalBytes,
		domain: domain.preview,
		domainTruncated: domain.truncated,
		domainOriginalBytes: domain.originalBytes,
		domainHue: template.domainHue,
		status: template.status,
		isPublic: template.isPublic,
		verifiedSends: template.verifiedSends,
		templateUpdatedAt: template.updatedAt,
		projectionVersion: TEMPLATE_LIST_PROJECTION_VERSION,
		projectionWrittenAt: Date.now()
	};
	let value = { ...base, projectionBytes: 0 };
	value = { ...value, projectionBytes: getConvexSize(value as unknown as Value) };
	value = { ...value, projectionBytes: getConvexSize(value as unknown as Value) };
	if (value.projectionBytes > TEMPLATE_LIST_MAX_PROJECTION_VALUE_BYTES) {
		throw new Error(
			`TEMPLATE_LIST_PROJECTION_TOO_LARGE:${template._id}:${value.projectionBytes}>${TEMPLATE_LIST_MAX_PROJECTION_VALUE_BYTES}`
		);
	}
	return value;
}

/** Maintain one embedding-free row from a canonical document already in memory. */
export async function syncTemplateListProjection(
	ctx: MutationCtx,
	template: Doc<'templates'>
): Promise<{ inserted: boolean; projectionBytes: number }> {
	const existing = await ctx.db
		.query('templateListProjections')
		.withIndex('by_templateId', (q) => q.eq('templateId', template._id))
		.unique();
	const value = projectionValue(template);
	if (existing) await ctx.db.patch(existing._id, value);
	else await ctx.db.insert('templateListProjections', value);
	return { inserted: existing === null, projectionBytes: value.projectionBytes };
}

export async function deleteTemplateListProjection(
	ctx: MutationCtx,
	templateId: Id<'templates'>
): Promise<void> {
	const existing = await ctx.db
		.query('templateListProjections')
		.withIndex('by_templateId', (q) => q.eq('templateId', templateId))
		.unique();
	if (existing) await ctx.db.delete(existing._id);
}

export async function getTemplateListProjectionMigration(
	ctx: Pick<QueryCtx, 'db'> | Pick<MutationCtx, 'db'>
) {
	return await ctx.db
		.query('templateListProjectionMigrations')
		.withIndex('by_key', (q) => q.eq('key', TEMPLATE_LIST_PROJECTION_KEY))
		.unique();
}

export async function requireTemplateListProjectionReady(
	ctx: Pick<QueryCtx, 'db'> | Pick<MutationCtx, 'db'>
): Promise<void> {
	// A coordinated clear/reseed mutates this plane over many transactions.
	// The public manifest is the shared corpus lock, so authenticated readers
	// must fail closed between pages just like direct public-source readers.
	await assertPublicDiscoveryDirectSourceServingReady(ctx);
	const migration = await getTemplateListProjectionMigration(ctx);
	if (migration?.status !== 'ready') {
		throw new ConvexError({
			code: 'TEMPLATE_LIST_PROJECTION_NOT_READY',
			status: migration?.status ?? 'not-started'
		});
	}
}

export function templateListPaginationOptions(
	pagination: TemplateListPagination,
	invalidCode = 'INVALID_TEMPLATE_LIST_PAGE_SIZE'
) {
	if (!Number.isSafeInteger(pagination.numItems) || pagination.numItems < 1) {
		throw new ConvexError({ code: invalidCode });
	}
	const numItems = Math.min(pagination.numItems, TEMPLATE_LIST_MAX_PAGE_SIZE);
	return {
		cursor: pagination.cursor,
		numItems,
		maximumRowsRead: numItems + 1,
		maximumBytesRead: TEMPLATE_LIST_MAX_PAGE_BYTES
	};
}

type ProjectionPage = {
	page: Doc<'templateListProjections'>[];
	continueCursor: string;
	isDone: boolean;
	splitCursor?: string | null;
	pageStatus?: 'SplitRecommended' | 'SplitRequired' | null;
};

/**
 * A corrupt/legacy oversized projection must never make a manual cursor skip
 * the unread half of a Convex page. SplitRequired is therefore coded no-progress.
 */
export function assertCompleteTemplateListPage<T extends ProjectionPage>(
	page: T,
	maxReturnedRows = TEMPLATE_LIST_MAX_PAGE_SIZE
): T {
	if (page.pageStatus === 'SplitRequired') {
		throw new ConvexError({ code: 'TEMPLATE_LIST_PAGE_SPLIT_REQUIRED' });
	}
	if (page.page.length > maxReturnedRows) {
		throw new ConvexError({
			code: 'TEMPLATE_LIST_PAGE_ROW_OVERFLOW',
			returnedRows: page.page.length,
			maxReturnedRows
		});
	}
	for (const row of page.page) {
		const storedBytes = getConvexSize(row as unknown as Value);
		if (
			row.projectionVersion !== TEMPLATE_LIST_PROJECTION_VERSION ||
			row.projectionBytes > TEMPLATE_LIST_MAX_PROJECTION_VALUE_BYTES ||
			storedBytes > TEMPLATE_LIST_MAX_STORED_ROW_BYTES
		) {
			throw new ConvexError({
				code: 'TEMPLATE_LIST_PROJECTION_INVALID',
				templateId: String(row.templateId)
			});
		}
	}
	return page;
}

export async function readTemplateListPageByUser(
	ctx: QueryCtx,
	userId: Id<'users'>,
	pagination: TemplateListPagination,
	invalidCode?: string
) {
	await requireTemplateListProjectionReady(ctx);
	const options = templateListPaginationOptions(pagination, invalidCode);
	const page = await ctx.db
		.query('templateListProjections')
		.withIndex('by_userId', (q) => q.eq('userId', userId))
		.order('desc')
		.paginate(options);
	return assertCompleteTemplateListPage(page, options.numItems);
}

export async function readTemplateListPageByOrg(
	ctx: QueryCtx,
	orgId: Id<'organizations'>,
	pagination: TemplateListPagination,
	invalidCode?: string
) {
	await requireTemplateListProjectionReady(ctx);
	const options = templateListPaginationOptions(pagination, invalidCode);
	const page = await ctx.db
		.query('templateListProjections')
		.withIndex('by_orgId', (q) => q.eq('orgId', orgId))
		.order('desc')
		.paginate(options);
	return assertCompleteTemplateListPage(page, options.numItems);
}

export function toAuthenticatedTemplateListItem(row: Doc<'templateListProjections'>) {
	return {
		_id: row.templateId,
		_creationTime: row.templateCreatedAt,
		slug: row.slug,
		title: row.title,
		description: row.description,
		descriptionTruncated: row.descriptionTruncated,
		descriptionOriginalBytes: row.descriptionOriginalBytes,
		domain: row.domain,
		domainHue: row.domainHue,
		status: row.status,
		isPublic: row.isPublic,
		verifiedSends: row.verifiedSends,
		updatedAt: row.templateUpdatedAt
	};
}

export function toProfileTemplateListItem(row: Doc<'templateListProjections'>) {
	return {
		_id: row.templateId,
		_creationTime: row.templateCreatedAt,
		title: row.title,
		slug: row.slug,
		status: row.status,
		isPublic: row.isPublic
	};
}

export function toOrgTemplateListItem(row: Doc<'templateListProjections'>) {
	return { _id: row.templateId, title: row.title };
}
