import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';

/**
 * Versioned read-side contract for the People browser.
 *
 * A row carrying this marker has both of the compact fields consumed by the
 * list query (`browseSource` and `browseTagIds`). A tag link carrying it has
 * the supporter creation time needed by the tag-anchored cursor index and has
 * already been folded into `tags.supporterCount` exactly once.
 */
export const SUPPORTER_BROWSE_VERSION = 1;
export const SUPPORTER_BROWSE_MIGRATION_KEY = 'supporter-browse-v1';

/** Deliberate product envelopes, not query-time truncation. */
export const MAX_SUPPORTER_TAGS = 100;
export const MAX_ORG_TAGS = 256;
export const MAX_SUPPORTER_SOURCE_BYTES = 128;
export const MAX_SUPPORTER_BROWSE_PAGE = 100;
export const MAX_SUPPORTER_BROWSE_CURSOR_BYTES = 2_048;
// A single People/API page can consume at most 1/2,048 (0.0488%) of the
// shared 1 GiB free allowance before Convex returns SplitRequired.
export const MAX_SUPPORTER_BROWSE_PAGE_BYTES = 512 * 1024;

type BrowseReadCtx = Pick<QueryCtx, 'db'>;
type BrowseWriteCtx = Pick<MutationCtx, 'db'>;

function utf8Bytes(value: string): number {
	return new TextEncoder().encode(value).length;
}

/** Stable indexed value for absent/blank legacy sources. */
export function normalizeSupporterBrowseSource(source: string | undefined): string {
	const normalized = source?.trim() || 'unknown';
	if (utf8Bytes(normalized) > MAX_SUPPORTER_SOURCE_BYTES) {
		throw new Error('SUPPORTER_SOURCE_TOO_LARGE');
	}
	return normalized;
}

/** Case-folded uniqueness key; display casing remains in `tags.name`. */
export function supporterTagNameKey(name: string): string {
	return name.normalize('NFKC').toLocaleLowerCase('en-US');
}

export function normalizeSupporterTagName(name: string): string {
	const normalized = name.trim().replace(/\s+/g, ' ');
	if (!normalized) throw new Error('TAG_NAME_REQUIRED');
	if (normalized.length > 48) throw new Error('TAG_NAME_TOO_LONG');
	return normalized;
}

export function uniqueSupporterTagIds(tagIds: readonly Id<'tags'>[]): Id<'tags'>[] {
	const unique = Array.from(new Map(tagIds.map((tagId) => [String(tagId), tagId])).values());
	if (unique.length > MAX_SUPPORTER_TAGS) throw new Error('SUPPORTER_TAG_LIMIT_EXCEEDED');
	return unique;
}

export async function assertSupporterBrowseReady(ctx: BrowseReadCtx): Promise<void> {
	const migration = await ctx.db
		.query('supporterBrowseMigrations')
		.withIndex('by_key', (q) => q.eq('key', SUPPORTER_BROWSE_MIGRATION_KEY))
		.unique();
	if (
		migration?.status !== 'ready' ||
		migration.phase !== 'complete' ||
		migration.cursor !== undefined ||
		migration.failureCode !== undefined ||
		migration.scanned !== migration.projected
	) {
		throw new Error(migration?.failureCode ?? 'SUPPORTER_BROWSE_NOT_READY');
	}
}

export type SupporterBrowseFilters = {
	emailStatus?: string;
	verified?: boolean;
	source?: string;
	tagId?: Id<'tags'>;
};

function validatedPageSize(requested: number): number {
	if (!Number.isFinite(requested)) throw new Error('SUPPORTER_PAGE_SIZE_INVALID');
	const value = Math.trunc(requested);
	if (value < 1) throw new Error('SUPPORTER_PAGE_SIZE_INVALID');
	return Math.min(MAX_SUPPORTER_BROWSE_PAGE, value);
}

function validatedCursor(cursor: string | null): string | null {
	if (cursor !== null && utf8Bytes(cursor) > MAX_SUPPORTER_BROWSE_CURSOR_BYTES) {
		throw new Error('SUPPORTER_CURSOR_TOO_LARGE');
	}
	return cursor;
}

function matchesBrowseFilters(
	supporter: Doc<'supporters'>,
	filters: Omit<SupporterBrowseFilters, 'tagId'>
): boolean {
	if (filters.emailStatus && supporter.emailStatus !== filters.emailStatus) return false;
	if (filters.verified !== undefined && supporter.verified !== filters.verified) return false;
	if (filters.source && supporter.browseSource !== filters.source) return false;
	return true;
}

/**
 * Canonical bounded People-browser page used by both the authenticated app and
 * API v1. Every branch owns one database continuation token. Tag membership is
 * anchored on the versioned link index; all other supported filter combinations
 * use an exact supporter index. The helper never expands tags into an N-by-M
 * join — callers resolve the compact `browseTagIds` through one bounded org tag
 * directory read when they need display names.
 */
export async function readSupporterBrowsePage(
	ctx: BrowseReadCtx,
	args: {
		orgId: Id<'organizations'>;
		cursor: string | null;
		numItems: number;
		filters?: SupporterBrowseFilters;
	}
): Promise<{
	page: Array<Doc<'supporters'>>;
	continueCursor: string | null;
	isDone: boolean;
}> {
	await assertSupporterBrowseReady(ctx);
	const limit = validatedPageSize(args.numItems);
	const cursor = validatedCursor(args.cursor);
	const emailStatus = args.filters?.emailStatus;
	if (emailStatus !== undefined && utf8Bytes(emailStatus) > 64) {
		throw new Error('SUPPORTER_EMAIL_STATUS_TOO_LARGE');
	}
	const verified = args.filters?.verified;
	const source =
		args.filters?.source === undefined
			? undefined
			: normalizeSupporterBrowseSource(args.filters.source);
	const pagination = {
		cursor,
		numItems: limit,
		maximumRowsRead: limit + 1,
		maximumBytesRead: MAX_SUPPORTER_BROWSE_PAGE_BYTES
	};

	if (args.filters?.tagId) {
		// The tag-link cursor used to fan out to as many as 100 unrestricted
		// supporter document gets after its own byte-bounded page. Convex cannot
		// put an aggregate byte cap around those point reads, so a crafted set of
		// large encrypted rows could still consume tens of MiB in one request.
		// Keep tag writes/counts live, but fail this read surface closed until the
		// link carries a separately size-capped browse projection.
		throw new Error('SUPPORTER_TAG_BROWSE_PROJECTION_NOT_READY');
	}

	const result =
		emailStatus && verified !== undefined && source
			? await ctx.db
					.query('supporters')
					.withIndex('by_orgId_emailStatus_verified_browseSource', (q) =>
						q
							.eq('orgId', args.orgId)
							.eq('emailStatus', emailStatus)
							.eq('verified', verified)
							.eq('browseSource', source)
					)
					.order('desc')
					.paginate(pagination)
			: emailStatus && verified !== undefined
				? await ctx.db
						.query('supporters')
						.withIndex('by_orgId_emailStatus_verified', (q) =>
							q.eq('orgId', args.orgId).eq('emailStatus', emailStatus).eq('verified', verified)
						)
						.order('desc')
						.paginate(pagination)
				: emailStatus && source
					? await ctx.db
							.query('supporters')
							.withIndex('by_orgId_emailStatus_browseSource', (q) =>
								q.eq('orgId', args.orgId).eq('emailStatus', emailStatus).eq('browseSource', source)
							)
							.order('desc')
							.paginate(pagination)
					: verified !== undefined && source
						? await ctx.db
								.query('supporters')
								.withIndex('by_orgId_verified_browseSource', (q) =>
									q.eq('orgId', args.orgId).eq('verified', verified).eq('browseSource', source)
								)
								.order('desc')
								.paginate(pagination)
						: emailStatus
							? await ctx.db
									.query('supporters')
									.withIndex('by_orgId_emailStatus', (q) =>
										q.eq('orgId', args.orgId).eq('emailStatus', emailStatus)
									)
									.order('desc')
									.paginate(pagination)
							: verified !== undefined
								? await ctx.db
										.query('supporters')
										.withIndex('by_orgId_verified', (q) =>
											q.eq('orgId', args.orgId).eq('verified', verified)
										)
										.order('desc')
										.paginate(pagination)
								: source
									? await ctx.db
											.query('supporters')
											.withIndex('by_orgId_browseSource', (q) =>
												q.eq('orgId', args.orgId).eq('browseSource', source)
											)
											.order('desc')
											.paginate(pagination)
									: await ctx.db
											.query('supporters')
											.withIndex('by_orgId', (q) => q.eq('orgId', args.orgId))
											.order('desc')
											.paginate(pagination);
	if (result.pageStatus === 'SplitRequired') throw new Error('SUPPORTER_PAGE_SPLIT_REQUIRED');
	for (const supporter of result.page) {
		if (supporter.supporterBrowseVersion !== SUPPORTER_BROWSE_VERSION) {
			throw new Error('SUPPORTER_BROWSE_ROW_NOT_PROJECTED');
		}
	}
	return {
		page: result.page,
		continueCursor: result.isDone ? null : result.continueCursor,
		isDone: result.isDone
	};
}

async function readBoundedSupporterLinks(
	ctx: BrowseReadCtx,
	supporterId: Id<'supporters'>
): Promise<Array<Doc<'supporterTags'>>> {
	const links = await ctx.db
		.query('supporterTags')
		.withIndex('by_supporterId', (q) => q.eq('supporterId', supporterId))
		.take(MAX_SUPPORTER_TAGS + 1);
	if (links.length > MAX_SUPPORTER_TAGS) throw new Error('SUPPORTER_TAG_LIMIT_EXCEEDED');
	return links;
}

/**
 * Repair the compact tag-id projection for one supporter from a deliberately
 * bounded link set. This is a writer/migration helper; the hot list path never
 * performs this join.
 */
export async function syncSupporterBrowseProjection(
	ctx: BrowseWriteCtx,
	supporterId: Id<'supporters'>
): Promise<Id<'tags'>[]> {
	const supporter = await ctx.db.get(supporterId);
	if (!supporter) return [];
	const links = await readBoundedSupporterLinks(ctx, supporterId);
	const tagIds: Id<'tags'>[] = [];
	const seen = new Set<string>();
	for (const link of links) {
		const tag = await ctx.db.get(link.tagId);
		if (!tag || tag.orgId !== supporter.orgId || seen.has(String(tag._id))) continue;
		seen.add(String(tag._id));
		tagIds.push(tag._id);
	}
	await ctx.db.patch(supporterId, {
		browseSource: normalizeSupporterBrowseSource(supporter.source),
		browseTagIds: tagIds,
		supporterBrowseVersion: SUPPORTER_BROWSE_VERSION
	});
	return tagIds;
}

async function incrementTagCount(
	ctx: BrowseWriteCtx,
	tagId: Id<'tags'>,
	delta: 1 | -1
): Promise<void> {
	const tag = await ctx.db.get(tagId);
	if (!tag) return;
	await ctx.db.patch(tagId, {
		supporterCount: Math.max(0, (tag.supporterCount ?? 0) + delta)
	});
}

/**
 * Insert/project one unique link and dual-write every field the read model
 * needs. The marker and counter transition happen in the same transaction, so
 * a migration retry cannot double-count the link.
 */
export async function attachSupporterTagProjection(
	ctx: BrowseWriteCtx,
	args: {
		supporterId: Id<'supporters'>;
		tagId: Id<'tags'>;
	}
): Promise<{ linkId: Id<'supporterTags'>; created: boolean }> {
	const supporter = await ctx.db.get(args.supporterId);
	if (!supporter) throw new Error('SUPPORTER_NOT_FOUND');
	const tag = await ctx.db.get(args.tagId);
	if (!tag) throw new Error('TAG_NOT_FOUND');
	if (tag.orgId !== supporter.orgId) throw new Error('TAG_CROSS_ORG');

	let link = await ctx.db
		.query('supporterTags')
		.withIndex('by_supporterId_tagId', (q) =>
			q.eq('supporterId', supporter._id).eq('tagId', tag._id)
		)
		.first();
	let created = false;
	if (!link) {
		const existingIds =
			supporter.supporterBrowseVersion === SUPPORTER_BROWSE_VERSION
				? uniqueSupporterTagIds(supporter.browseTagIds ?? [])
				: (await readBoundedSupporterLinks(ctx, supporter._id)).map((row) => row.tagId);
		if (
			!existingIds.some((tagId) => tagId === tag._id) &&
			existingIds.length >= MAX_SUPPORTER_TAGS
		) {
			throw new Error('SUPPORTER_TAG_LIMIT_EXCEEDED');
		}
		const linkId = await ctx.db.insert('supporterTags', {
			supporterId: supporter._id,
			tagId: tag._id,
			supporterCreatedAt: supporter._creationTime,
			supporterBrowseVersion: SUPPORTER_BROWSE_VERSION
		});
		link = (await ctx.db.get(linkId))!;
		created = true;
		await incrementTagCount(ctx, tag._id, 1);
	} else if (link.supporterBrowseVersion !== SUPPORTER_BROWSE_VERSION) {
		await ctx.db.patch(link._id, {
			supporterCreatedAt: supporter._creationTime,
			supporterBrowseVersion: SUPPORTER_BROWSE_VERSION
		});
		await incrementTagCount(ctx, tag._id, 1);
	}

	if (supporter.supporterBrowseVersion === SUPPORTER_BROWSE_VERSION) {
		const tagIds = uniqueSupporterTagIds([...(supporter.browseTagIds ?? []), tag._id]);
		await ctx.db.patch(supporter._id, {
			browseSource: normalizeSupporterBrowseSource(supporter.source),
			browseTagIds: tagIds,
			supporterBrowseVersion: SUPPORTER_BROWSE_VERSION
		});
	} else {
		await syncSupporterBrowseProjection(ctx, supporter._id);
	}

	return { linkId: link._id, created };
}

/** Delete one link and reverse its exact counter/projection transition. */
export async function detachSupporterTagProjection(
	ctx: BrowseWriteCtx,
	link: Doc<'supporterTags'>
): Promise<void> {
	const supporter = await ctx.db.get(link.supporterId);
	await ctx.db.delete(link._id);
	if (link.supporterBrowseVersion === SUPPORTER_BROWSE_VERSION) {
		await incrementTagCount(ctx, link.tagId, -1);
	}
	if (!supporter) return;
	if (supporter.supporterBrowseVersion === SUPPORTER_BROWSE_VERSION) {
		await ctx.db.patch(supporter._id, {
			browseTagIds: (supporter.browseTagIds ?? []).filter((tagId) => tagId !== link.tagId),
			browseSource: normalizeSupporterBrowseSource(supporter.source),
			supporterBrowseVersion: SUPPORTER_BROWSE_VERSION
		});
	} else {
		await syncSupporterBrowseProjection(ctx, supporter._id);
	}
}

/**
 * Delete every bounded link for a supporter before deleting the supporter.
 * Counter transitions remain exact; the soon-to-be-deleted inline projection
 * does not need to be rebuilt.
 */
export async function detachAllSupporterTagProjections(
	ctx: BrowseWriteCtx,
	supporterId: Id<'supporters'>
): Promise<number> {
	const links = await readBoundedSupporterLinks(ctx, supporterId);
	for (const link of links) {
		await ctx.db.delete(link._id);
		if (link.supporterBrowseVersion === SUPPORTER_BROWSE_VERSION) {
			await incrementTagCount(ctx, link.tagId, -1);
		}
	}
	return links.length;
}
