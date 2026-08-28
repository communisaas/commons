import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';

export const PUBLIC_ORGANIZATION_DIRECTORY_VERSION = 1;
export const PUBLIC_ORGANIZATION_DIRECTORY_MIGRATION_KEY = 'v1' as const;
export const PUBLIC_ORGANIZATION_DIRECTORY_PAGE_LIMIT = 50;

function bounded(value: string | undefined, max: number): string | undefined {
	const normalized = value?.trim();
	return normalized ? normalized.slice(0, max) : undefined;
}

export function publicOrganizationNameSort(name: string): string {
	return name.trim().toLocaleLowerCase('en-US').replace(/\s+/g, ' ').slice(0, 160);
}

export function projectPublicOrganization(org: Doc<'organizations'>) {
	if (!org.isPublic) return null;
	const name = bounded(org.name, 160) ?? 'Organization';
	return {
		orgId: org._id,
		slug: org.slug.slice(0, 48),
		name,
		nameSort: publicOrganizationNameSort(name),
		description: bounded(org.description, 2_000),
		mission: bounded(org.mission, 2_000),
		logoUrl: bounded(org.logoUrl, 2_048),
		avatar: bounded(org.avatar, 2_048),
		supporterCount: Math.max(0, org.supporterCount ?? 0),
		campaignCount: Math.max(0, org.campaignCount ?? 0),
		memberCount: Math.max(0, org.memberCount ?? 0),
		updatedAt: org.updatedAt,
		version: PUBLIC_ORGANIZATION_DIRECTORY_VERSION
	};
}

export async function getPublicOrganizationDirectoryMigration(
	ctx: Pick<QueryCtx, 'db'> | Pick<MutationCtx, 'db'>
) {
	return ctx.db
		.query('publicOrganizationDirectoryMigrations')
		.withIndex('by_key', (q) => q.eq('key', PUBLIC_ORGANIZATION_DIRECTORY_MIGRATION_KEY))
		.unique();
}

/** Upsert/delete only. Caller owns migration-marker and exact-total accounting. */
export async function writePublicOrganizationProjection(
	ctx: MutationCtx,
	org: Doc<'organizations'>
): Promise<{ existed: boolean; exists: boolean; wrote: boolean }> {
	const existing = await ctx.db
		.query('publicOrganizationDirectory')
		.withIndex('by_orgId', (q) => q.eq('orgId', org._id))
		.unique();
	const projected = projectPublicOrganization(org);
	if (!projected) {
		if (existing) await ctx.db.delete(existing._id);
		return { existed: Boolean(existing), exists: false, wrote: Boolean(existing) };
	}
	if (existing) await ctx.db.patch(existing._id, projected);
	else await ctx.db.insert('publicOrganizationDirectory', projected);
	return { existed: Boolean(existing), exists: true, wrote: true };
}

/**
 * Transactional writer hook for every public field/counter transition. During
 * migration, already-scanned rows update the exact total; unscanned rows are
 * left for the cursor pass. After scan completion/activation, new orgs are
 * adopted immediately so the projection remains exact without another scan.
 */
export async function syncPublicOrganizationDirectory(
	ctx: MutationCtx,
	orgId: Id<'organizations'>
): Promise<void> {
	let org = await ctx.db.get(orgId);
	if (!org) return;
	const migration = await getPublicOrganizationDirectoryMigration(ctx);
	let versioned = org.publicDirectoryVersion === PUBLIC_ORGANIZATION_DIRECTORY_VERSION;
	const canAdoptNew =
		migration?.status === 'ready' ||
		(migration?.status === 'running' && migration.scanComplete === true);
	if (!versioned && canAdoptNew) {
		await ctx.db.patch(orgId, {
			publicDirectoryVersion: PUBLIC_ORGANIZATION_DIRECTORY_VERSION
		});
		org = { ...org, publicDirectoryVersion: PUBLIC_ORGANIZATION_DIRECTORY_VERSION };
		versioned = true;
	}

	const result = await writePublicOrganizationProjection(ctx, org);
	if (!migration || !versioned || result.existed === result.exists) return;
	await ctx.db.patch(migration._id, {
		total: Math.max(0, migration.total + (result.exists ? 1 : -1)),
		updatedAt: Date.now()
	});
}
