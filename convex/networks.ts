/**
 * Coalition network CRUD — queries and mutations.
 *
 * Networks are org-to-org coalitions. The owning org is always an admin member.
 * Other orgs are invited and can accept/decline.
 */

import { makeFunctionReference } from 'convex/server';
import type { FunctionReference } from 'convex/server';
import { v } from 'convex/values';
import { internalMutation, internalQuery, mutation, query } from './_generated/server';
import { requireOrgRole, loadOrg } from './_authHelpers';
import { requireInternalSecret } from './_internalAuth';
import { effectivePlan, isCoalitionPlan } from './_brandingGate';
import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import {
	COALITION_DIMENSION_KINDS,
	COALITION_MAX_ACTIVE_MEMBERS,
	COALITION_MAX_ACTIVE_NETWORKS_PER_ORG,
	COALITION_MAX_PRESSURE_BILLS,
	COALITION_METRICS_MIGRATION_KEY,
	COALITION_METRICS_VERSION,
	applyCoalitionActionTransition,
	applyCoalitionReceiptProjection,
	applyCoalitionSupporterTransition,
	boundedStateDistribution,
	markCoalitionNetworkDirty,
	readCoalitionPressure,
	readCoalitionStats,
	xLog2X
} from './lib/coalitionMetrics';

const continueCoalitionNetworkRebuildRef = makeFunctionReference<'mutation'>(
	'networks:continueCoalitionNetworkRebuild'
) as unknown as FunctionReference<
	'mutation',
	'internal',
	{ networkId: Id<'orgNetworks'> },
	unknown
>;

const migrateCoalitionMetricsRef = makeFunctionReference<'mutation'>(
	'networks:migrateCoalitionMetrics'
) as unknown as FunctionReference<'mutation', 'internal', { runToken: string }, unknown>;

const COALITION_REBUILD_PAGE_ROWS = 24;
const COALITION_REBUILD_PAGE_BYTES = 512 * 1024;
const COALITION_MIGRATION_SUPPORTER_ROWS = 8;
const COALITION_MIGRATION_ACTION_ROWS = 24;
const COALITION_MIGRATION_RECEIPT_ROWS = 8;
const COALITION_MIGRATION_PAGE_BYTES = 2 * 1024 * 1024;
const COALITION_MAX_PENDING_NETWORKS_PER_ORG = 8;
const COALITION_ROSTER_PAGE_DEFAULT = 50;
const COALITION_ROSTER_PAGE_MAX = 50;
const COALITION_ROSTER_PAGE_MAX_BYTES = 256 * 1024;
const COALITION_CURSOR_MAX_BYTES = 2 * 1024;

function normalizeCoalitionRosterPageSize(value: number | undefined): number {
	const resolved = value ?? COALITION_ROSTER_PAGE_DEFAULT;
	if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > COALITION_ROSTER_PAGE_MAX) {
		throw new Error('COALITION_ROSTER_PAGE_SIZE_INVALID');
	}
	return resolved;
}

function normalizeCoalitionCursor(value: string | undefined): string | null {
	if (!value) return null;
	if (utf8Bytes(value) > COALITION_CURSOR_MAX_BYTES) {
		throw new Error('COALITION_ROSTER_CURSOR_INVALID');
	}
	return value;
}

type CoalitionRebuildAccumulator = {
	totalSupporters: number;
	verifiedSupporters: number;
	totalCampaignActions: number;
	verifiedCampaignActions: number;
	messageHashedTotal: number;
	uniqueSupporters: number;
	uniqueMessages: number;
	districtCount: number;
	districtSquareSum: number;
	hourCountXLogXSum: number;
	tier1: number;
	tier3: number;
	tier4: number;
	stateCounts: Record<string, number>;
	previousGeneration?: number;
	cleanupGeneration?: number;
	restartAfterCleanup?: boolean;
};

/**
 * Resolve an org's effective billing plan from its subscription row. Only
 * `active`/`trialing` subscriptions count toward a paid tier (the shared
 * `effectivePlan` rule). Mirrors `organizations.ts:resolveOrgPlan` so the
 * coalition-create gate reads plans the same way every other paid gate does.
 */
async function resolveOrgPlan(
	ctx: MutationCtx | QueryCtx,
	orgId: Id<'organizations'>
): Promise<string> {
	const rows = await ctx.db
		.query('subscriptions')
		.withIndex('by_orgId', (q) => q.eq('orgId', orgId))
		.take(2);
	if (rows.length > 1) throw new Error('SUBSCRIPTION_CARDINALITY_REPAIR_REQUIRED');
	const sub = rows[0] ?? null;
	return effectivePlan(sub);
}

// =============================================================================
// QUERIES
// =============================================================================

/**
 * List networks the org belongs to (active or pending).
 */
export const list = query({
	args: {
		orgSlug: v.string()
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.orgSlug, 'member');

		const [activeMemberships, pendingMemberships] = await Promise.all([
			ctx.db
				.query('orgNetworkMembers')
				.withIndex('by_orgId_status', (idx) => idx.eq('orgId', org._id).eq('status', 'active'))
				.take(COALITION_MAX_ACTIVE_NETWORKS_PER_ORG + 1),
			ctx.db
				.query('orgNetworkMembers')
				.withIndex('by_orgId_status', (idx) => idx.eq('orgId', org._id).eq('status', 'pending'))
				.take(COALITION_MAX_PENDING_NETWORKS_PER_ORG + 1)
		]);
		if (activeMemberships.length > COALITION_MAX_ACTIVE_NETWORKS_PER_ORG) {
			throw new Error('COALITION_ORG_ACTIVE_NETWORK_LEGACY_OVERFLOW');
		}
		if (pendingMemberships.length > COALITION_MAX_PENDING_NETWORKS_PER_ORG) {
			throw new Error('COALITION_ORG_PENDING_NETWORK_LEGACY_OVERFLOW');
		}
		const memberships = [...activeMemberships, ...pendingMemberships];
		const results = await Promise.all(
			memberships.map(async (m) => {
				const network = await ctx.db.get(m.networkId);
				if (!network) return null;

				const [ownerOrg, legacyAggregate] = await Promise.all([
					ctx.db
						.query('publicOrganizationDirectory')
						.withIndex('by_orgId', (idx) => idx.eq('orgId', network.ownerOrgId))
						.unique(),
					network.activeMemberCount === undefined
						? ctx.db
								.query('coalitionNetworkAggregates')
								.withIndex('by_networkId', (idx) => idx.eq('networkId', network._id))
								.unique()
						: Promise.resolve(null)
				]);
				const memberCount = network.activeMemberCount ?? legacyAggregate?.memberCount;
				if (memberCount === undefined) {
					throw new Error('COALITION_NETWORK_BROWSE_PROJECTION_NOT_READY');
				}

				return {
					_id: network._id,
					_creationTime: network._creationTime,
					name: network.name,
					slug: network.slug,
					description: network.description ?? null,
					status: network.status,
					role: m.role,
					memberStatus: m.status,
					memberCount,
					ownerOrg: ownerOrg
						? { _id: ownerOrg._id, name: ownerOrg.name, slug: ownerOrg.slug }
						: null
				};
			})
		);

		return results.filter((r): r is NonNullable<typeof r> => r !== null);
	}
});

/**
 * Get a single network with its active member list.
 */
export const get = query({
	args: {
		orgSlug: v.string(),
		networkId: v.id('orgNetworks'),
		memberCursor: v.optional(v.string()),
		memberLimit: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.orgSlug, 'member');
		const memberLimit = normalizeCoalitionRosterPageSize(args.memberLimit);
		const memberCursor = normalizeCoalitionCursor(args.memberCursor);

		// Verify caller org is an active member
		const callerMembership = await ctx.db
			.query('orgNetworkMembers')
			.withIndex('by_networkId_orgId', (idx) =>
				idx.eq('networkId', args.networkId).eq('orgId', org._id)
			)
			.first();

		if (!callerMembership || callerMembership.status !== 'active') {
			throw new Error('Your organization is not an active member of this network');
		}

		const network = await ctx.db.get(args.networkId);
		if (!network) throw new Error('Network not found');

		const ownerOrg = await ctx.db
			.query('publicOrganizationDirectory')
			.withIndex('by_orgId', (idx) => idx.eq('orgId', network.ownerOrgId))
			.unique();

		const activeMembers = await ctx.db
			.query('orgNetworkMembers')
			.withIndex('by_networkId_status_joinedAt', (idx) =>
				idx.eq('networkId', network._id).eq('status', 'active')
			)
			.order('asc')
			.paginate({
				cursor: memberCursor,
				numItems: memberLimit,
				maximumRowsRead: memberLimit + 1,
				maximumBytesRead: COALITION_ROSTER_PAGE_MAX_BYTES
			});
		if (activeMembers.pageStatus === 'SplitRequired') {
			throw new Error('COALITION_ROSTER_PAGE_TOO_LARGE');
		}

		const memberDetails = await Promise.all(
			activeMembers.page.map(async (m) => {
				const memberOrg = await ctx.db
					.query('publicOrganizationDirectory')
					.withIndex('by_orgId', (idx) => idx.eq('orgId', m.orgId))
					.unique();
				return {
					_id: m._id,
					orgId: m.orgId,
					orgName: memberOrg?.name ?? 'Unknown',
					orgSlug: memberOrg?.slug ?? '',
					role: m.role,
					joinedAt: m.joinedAt
				};
			})
		);
		const legacyAggregate =
			network.activeMemberCount === undefined
				? await ctx.db
						.query('coalitionNetworkAggregates')
						.withIndex('by_networkId', (idx) => idx.eq('networkId', network._id))
						.unique()
				: null;
		const memberCount = network.activeMemberCount ?? legacyAggregate?.memberCount;
		if (memberCount === undefined) {
			throw new Error('COALITION_NETWORK_BROWSE_PROJECTION_NOT_READY');
		}

		return {
			_id: network._id,
			_creationTime: network._creationTime,
			name: network.name,
			slug: network.slug,
			description: network.description ?? null,
			status: network.status,
			ownerOrg: ownerOrg ? { _id: ownerOrg._id, name: ownerOrg.name, slug: ownerOrg.slug } : null,
			members: memberDetails,
			memberCount,
			callerRole: callerMembership.role,
			membersHasMore: !activeMembers.isDone,
			memberNextCursor: activeMembers.isDone ? null : activeMembers.continueCursor
		};
	}
});

const NETWORK_CHARTER_PROJECTION_VERSION = 1;
const NETWORK_CHARTER_MIGRATION_KEY = 'v1';
const NETWORK_CHARTER_MAX_BYTES = 64 * 1024;
const NETWORK_CHARTER_MIGRATION_PAGE_SIZE = 1;
const NETWORK_CHARTER_MIGRATION_MAX_BYTES = 1024 * 1024;
const migrateNetworkChartersRef = makeFunctionReference<'mutation'>(
	'networks:migrateNetworkCharters'
) as unknown as FunctionReference<'mutation', 'internal', { runToken: string }, unknown>;

function utf8Bytes(value: string): number {
	return new TextEncoder().encode(value).byteLength;
}

function assertBoundedCharterText(value: string | undefined, maximum: number, code: string): void {
	if (value !== undefined && utf8Bytes(value) > maximum) throw new Error(code);
}

async function requirePublicOrganizationDirectoryReady(ctx: MutationCtx): Promise<void> {
	const migration = await ctx.db
		.query('publicOrganizationDirectoryMigrations')
		.withIndex('by_key', (q) => q.eq('key', 'v1'))
		.unique();
	if (migration?.status !== 'ready') throw new Error('PUBLIC_ORG_DIRECTORY_NOT_READY');
}

async function buildNetworkCharterProjection(ctx: MutationCtx, network: Doc<'orgNetworks'>) {
	if (!network.charterPublishedAt || !Number.isFinite(network.charterPublishedAt)) {
		throw new Error('NETWORK_CHARTER_NOT_PUBLISHED');
	}
	assertBoundedCharterText(network.name, 256, 'NETWORK_CHARTER_NAME_TOO_LARGE');
	assertBoundedCharterText(network.slug, 128, 'NETWORK_CHARTER_SLUG_TOO_LARGE');
	assertBoundedCharterText(network.mission, 500, 'NETWORK_CHARTER_MISSION_TOO_LARGE');
	assertBoundedCharterText(network.charterText, 10_000, 'NETWORK_CHARTER_TEXT_TOO_LARGE');
	if ((network.principles?.length ?? 0) > 20) {
		throw new Error('NETWORK_CHARTER_PRINCIPLES_TOO_MANY');
	}
	for (const principle of network.principles ?? []) {
		assertBoundedCharterText(principle, 200, 'NETWORK_CHARTER_PRINCIPLE_TOO_LARGE');
	}
	if (
		network.applicableCountries.length === 0 ||
		network.applicableCountries.length > 32 ||
		network.applicableCountries.some((country) => !/^[A-Z]{2}$/.test(country)) ||
		new Set(network.applicableCountries).size !== network.applicableCountries.length
	) {
		throw new Error('NETWORK_CHARTER_COUNTRIES_INVALID');
	}

	await requirePublicOrganizationDirectoryReady(ctx);
	const founders = await ctx.db
		.query('orgNetworkMembers')
		.withIndex('by_networkId_status_joinedAt', (q) =>
			q
				.eq('networkId', network._id)
				.eq('status', 'active')
				.lte('joinedAt', network.charterPublishedAt!)
		)
		.take(COALITION_MAX_ACTIVE_MEMBERS + 1);
	if (founders.length > COALITION_MAX_ACTIVE_MEMBERS) {
		throw new Error('NETWORK_CHARTER_FOUNDER_LIMIT_EXCEEDED');
	}
	const founderDetails = await Promise.all(
		founders.map(async (membership) => {
			const identity = await ctx.db
				.query('publicOrganizationDirectory')
				.withIndex('by_orgId', (q) => q.eq('orgId', membership.orgId))
				.unique();
			if (!identity) {
				throw new Error(`NETWORK_CHARTER_FOUNDER_NOT_PUBLIC:${membership.orgId}`);
			}
			return {
				orgName: identity.name,
				orgSlug: identity.slug,
				role: membership.role,
				joinedAt: membership.joinedAt
			};
		})
	);
	founderDetails.sort((left, right) =>
		left.joinedAt !== right.joinedAt
			? left.joinedAt - right.joinedAt
			: left.orgSlug.localeCompare(right.orgSlug)
	);
	const owner = await ctx.db
		.query('publicOrganizationDirectory')
		.withIndex('by_orgId', (q) => q.eq('orgId', network.ownerOrgId))
		.unique();
	if (!owner) throw new Error('NETWORK_CHARTER_OWNER_NOT_PUBLIC');

	const countries = [...network.applicableCountries].sort();
	const canonical = [
		'voter-protocol-charter-v1',
		network.slug,
		network.name,
		String(network.charterPublishedAt),
		countries.join('|'),
		`${owner.slug}\t${owner.name}`,
		network.mission ?? '',
		(network.principles ?? []).join('\n'),
		network.charterText ?? '',
		founderDetails
			.map(
				(founder) => `${founder.orgSlug}\t${founder.orgName}\t${founder.joinedAt}\t${founder.role}`
			)
			.join('\n')
	].join('\n---\n');
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
	const charterHash = Array.from(new Uint8Array(digest))
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('');
	const value = {
		networkId: network._id,
		slug: network.slug,
		name: network.name,
		applicableCountries: countries,
		mission: network.mission,
		principles: network.principles ?? [],
		charterText: network.charterText,
		charterPublishedAt: network.charterPublishedAt,
		charterHash,
		ownerOrg: { name: owner.name, slug: owner.slug },
		founders: founderDetails,
		projectionVersion: NETWORK_CHARTER_PROJECTION_VERSION,
		payloadBytes: 0,
		createdAt: Date.now()
	};
	value.payloadBytes = utf8Bytes(JSON.stringify(value));
	if (value.payloadBytes > NETWORK_CHARTER_MAX_BYTES) {
		throw new Error(`NETWORK_CHARTER_PROJECTION_TOO_LARGE:${value.payloadBytes}`);
	}
	return value;
}

async function writeNetworkCharterProjection(ctx: MutationCtx, network: Doc<'orgNetworks'>) {
	const value = await buildNetworkCharterProjection(ctx, network);
	const existing = await ctx.db
		.query('publicNetworkCharters')
		.withIndex('by_networkId', (q) => q.eq('networkId', network._id))
		.unique();
	if (existing) {
		if (existing.charterHash !== value.charterHash) {
			throw new Error('NETWORK_CHARTER_IMMUTABLE_CONFLICT');
		}
		return existing;
	}
	await ctx.db.insert('publicNetworkCharters', value);
	return value;
}

/** Publish charter fields and their immutable compact artifact atomically. */
export const publishCharter = mutation({
	args: {
		orgSlug: v.string(),
		networkId: v.id('orgNetworks'),
		mission: v.optional(v.string()),
		principles: v.array(v.string()),
		charterText: v.optional(v.string()),
		applicableCountries: v.array(v.string())
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.orgSlug, 'member');
		const membership = await ctx.db
			.query('orgNetworkMembers')
			.withIndex('by_networkId_orgId', (q) =>
				q.eq('networkId', args.networkId).eq('orgId', org._id)
			)
			.unique();
		if (membership?.status !== 'active' || membership.role !== 'admin') {
			throw new Error('Network admin role required');
		}
		const network = await ctx.db.get(args.networkId);
		if (!network) throw new Error('Network not found');
		if (network.charterPublishedAt) throw new Error('NETWORK_CHARTER_ALREADY_PUBLISHED');
		const activeMembers = await ctx.db
			.query('orgNetworkMembers')
			.withIndex('by_networkId_status', (q) =>
				q.eq('networkId', args.networkId).eq('status', 'active')
			)
			.take(COALITION_MAX_ACTIVE_MEMBERS + 1);
		if (activeMembers.length > COALITION_MAX_ACTIVE_MEMBERS) {
			throw new Error('NETWORK_CHARTER_FOUNDER_LIMIT_EXCEEDED');
		}
		const charterPublishedAt = Math.max(
			Date.now(),
			...activeMembers.map((member) => member.joinedAt + 1)
		);
		const next = {
			...network,
			mission: args.mission,
			principles: args.principles,
			charterText: args.charterText,
			applicableCountries: args.applicableCountries,
			charterPublishedAt
		};
		await writeNetworkCharterProjection(ctx, next);
		await ctx.db.patch(network._id, {
			mission: args.mission,
			principles: args.principles,
			charterText: args.charterText,
			applicableCountries: args.applicableCountries,
			charterPublishedAt,
			updatedAt: Date.now()
		});
		return { charterPublishedAt };
	}
});

/** Secret-gated, exact immutable charter lookup. Never joins live members. */
export const getPublicCharter = query({
	args: { _secret: v.string(), slug: v.string() },
	handler: async (ctx, { _secret, slug }) => {
		requireInternalSecret(_secret);
		if (slug.length === 0 || utf8Bytes(slug) > 128) return null;
		const migration = await ctx.db
			.query('networkCharterMigrations')
			.withIndex('by_key', (q) => q.eq('key', NETWORK_CHARTER_MIGRATION_KEY))
			.unique();
		if (migration?.status !== 'ready' || migration.scanned !== migration.projected) {
			throw new Error('NETWORK_CHARTER_PROJECTION_NOT_READY');
		}
		const charter = await ctx.db
			.query('publicNetworkCharters')
			.withIndex('by_slug', (q) => q.eq('slug', slug))
			.unique();
		return charter
			? {
					_id: charter.networkId,
					name: charter.name,
					slug: charter.slug,
					applicableCountries: charter.applicableCountries,
					mission: charter.mission ?? null,
					principles: charter.principles,
					charterText: charter.charterText ?? null,
					charterPublishedAt: charter.charterPublishedAt,
					charterHash: charter.charterHash,
					ownerOrg: charter.ownerOrg ?? null,
					founders: charter.founders
				}
			: null;
	}
});

/** Durable one-row/one-network legacy charter migration. */
export const migrateNetworkCharters = internalMutation({
	args: {
		runToken: v.optional(v.string()),
		restart: v.optional(v.boolean()),
		scheduleContinuation: v.optional(v.boolean())
	},
	handler: async (ctx, args) => {
		if (args.runToken !== undefined && args.restart) {
			throw new Error('NETWORK_CHARTER_MIGRATION_INVALID_CONTROL');
		}
		let migration = await ctx.db
			.query('networkCharterMigrations')
			.withIndex('by_key', (q) => q.eq('key', NETWORK_CHARTER_MIGRATION_KEY))
			.unique();
		let runToken: string;
		if (args.runToken !== undefined) {
			if (!migration || migration.status !== 'running' || migration.runToken !== args.runToken) {
				return { status: 'superseded' as const, runToken: args.runToken };
			}
			runToken = args.runToken;
		} else if (!args.restart && migration?.status === 'ready') {
			return { status: 'already-ready' as const, runToken: migration.runToken };
		} else if (!args.restart && migration?.status === 'migrated') {
			return { status: 'already-migrated' as const, runToken: migration.runToken };
		} else if (!args.restart && migration?.status === 'running') {
			return { status: 'already-running' as const, runToken: migration.runToken };
		} else if (!args.restart && migration?.status === 'blocked') {
			return {
				status: 'blocked' as const,
				runToken: migration.runToken,
				failureCode: migration.failureCode ?? null
			};
		} else {
			runToken = crypto.randomUUID();
			const initial = {
				key: NETWORK_CHARTER_MIGRATION_KEY,
				status: 'running',
				runToken,
				cursor: undefined,
				scanned: 0,
				projected: 0,
				failureCode: undefined,
				failureSourceId: undefined,
				startedAt: Date.now(),
				completedAt: undefined,
				updatedAt: Date.now()
			};
			if (migration) await ctx.db.patch(migration._id, initial);
			else await ctx.db.insert('networkCharterMigrations', initial);
			migration = await ctx.db
				.query('networkCharterMigrations')
				.withIndex('by_key', (q) => q.eq('key', NETWORK_CHARTER_MIGRATION_KEY))
				.unique();
		}
		if (!migration || migration.runToken !== runToken || migration.status !== 'running') {
			throw new Error('NETWORK_CHARTER_MIGRATION_STATE_MISSING');
		}
		const page = await ctx.db
			.query('orgNetworks')
			.order('asc')
			.paginate({
				cursor: migration.cursor ?? null,
				numItems: NETWORK_CHARTER_MIGRATION_PAGE_SIZE,
				maximumRowsRead: NETWORK_CHARTER_MIGRATION_PAGE_SIZE + 1,
				maximumBytesRead: NETWORK_CHARTER_MIGRATION_MAX_BYTES
			});
		if (page.pageStatus === 'SplitRequired') {
			await ctx.db.patch(migration._id, {
				status: 'blocked',
				failureCode: 'NETWORK_CHARTER_MIGRATION_PAGE_SPLIT_REQUIRED',
				updatedAt: Date.now()
			});
			return { status: 'blocked' as const, runToken };
		}
		let projected = migration.projected;
		for (const network of page.page) {
			try {
				if (network.charterPublishedAt) await writeNetworkCharterProjection(ctx, network);
				projected += 1;
			} catch (error) {
				const failureCode = error instanceof Error ? error.message : String(error);
				await ctx.db.patch(migration._id, {
					status: 'blocked',
					failureCode: failureCode.slice(0, 500),
					failureSourceId: String(network._id),
					updatedAt: Date.now()
				});
				return { status: 'blocked' as const, runToken, failureCode };
			}
		}
		const scanned = migration.scanned + page.page.length;
		const completedAt = page.isDone ? Date.now() : undefined;
		await ctx.db.patch(migration._id, {
			status: page.isDone ? 'migrated' : 'running',
			cursor: page.isDone ? undefined : page.continueCursor,
			scanned,
			projected,
			completedAt,
			updatedAt: Date.now()
		});
		if (!page.isDone && args.scheduleContinuation !== false) {
			await ctx.scheduler.runAfter(0, migrateNetworkChartersRef, { runToken });
		}
		return {
			status: page.isDone ? ('migrated' as const) : ('running' as const),
			runToken,
			scanned,
			projected
		};
	}
});

export const activateNetworkCharters = internalMutation({
	args: {},
	handler: async (ctx) => {
		const migration = await ctx.db
			.query('networkCharterMigrations')
			.withIndex('by_key', (q) => q.eq('key', NETWORK_CHARTER_MIGRATION_KEY))
			.unique();
		if (migration?.status === 'ready') return { status: 'ready' as const };
		if (!migration || migration.status !== 'migrated' || !migration.completedAt) {
			throw new Error('NETWORK_CHARTER_MIGRATION_INCOMPLETE');
		}
		if (migration.scanned !== migration.projected) {
			throw new Error('NETWORK_CHARTER_MIGRATION_INEXACT');
		}
		await ctx.db.patch(migration._id, { status: 'ready', updatedAt: Date.now() });
		return { status: 'ready' as const, scanned: migration.scanned };
	}
});

export const networkCharterMigrationStatus = internalQuery({
	args: {},
	handler: async (ctx) => {
		const migration = await ctx.db
			.query('networkCharterMigrations')
			.withIndex('by_key', (q) => q.eq('key', NETWORK_CHARTER_MIGRATION_KEY))
			.unique();
		return migration
			? {
					status: migration.status,
					runToken: migration.runToken,
					scanned: migration.scanned,
					projected: migration.projected,
					failureCode: migration.failureCode ?? null,
					failureSourceId: migration.failureSourceId ?? null,
					startedAt: migration.startedAt,
					completedAt: migration.completedAt ?? null
				}
			: { status: 'not-started' as const };
	}
});

/**
 * Removed launch surface. `get` is the sole roster browser and carries an
 * opaque cursor, byte ceiling, exact member count, and active-only index. Keep
 * this tombstone exported for old clients so they fail before any database
 * read instead of silently reintroducing a two-status full-roster fan-out.
 */
export const getMembers = query({
	args: {
		orgSlug: v.string(),
		networkId: v.id('orgNetworks')
	},
	handler: async () => {
		throw new Error('NETWORK_GET_MEMBERS_REMOVED_USE_PAGINATED_GET');
	}
});

// =============================================================================
// MUTATIONS
// =============================================================================

async function invalidateCoalitionRoster(
	ctx: MutationCtx,
	networkId: Id<'orgNetworks'>
): Promise<void> {
	const network = await ctx.db.get(networkId);
	if (!network) throw new Error('Network not found');
	const activeMembers = await ctx.db
		.query('orgNetworkMembers')
		.withIndex('by_networkId_status', (q) => q.eq('networkId', networkId).eq('status', 'active'))
		.take(COALITION_MAX_ACTIVE_MEMBERS + 1);
	if (activeMembers.length > COALITION_MAX_ACTIVE_MEMBERS) {
		throw new Error('COALITION_NETWORK_ACTIVE_MEMBER_LEGACY_OVERFLOW');
	}
	await ctx.db.patch(networkId, {
		coalitionMembershipRevision: (network.coalitionMembershipRevision ?? 0) + 1,
		activeMemberCount: activeMembers.length,
		lastPacketHash: undefined,
		lastPacketComputedAt: undefined,
		updatedAt: Date.now()
	});
	await markCoalitionNetworkDirty(ctx, networkId);
}

/**
 * Create a new coalition network. The creating org becomes admin.
 */
export const create = mutation({
	args: {
		orgSlug: v.string(),
		name: v.string(),
		slug: v.string(),
		description: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const { org, userId } = await requireOrgRole(ctx, args.orgSlug, 'owner');

		// Coalition-tier gate — THE FENCE. The SvelteKit endpoint also checks the
		// plan, but a public Convex mutation is callable directly, so the paywall
		// must be enforced here or it is bypassable. Creating a coalition network
		// requires an active/trialing Coalition plan; everything below (inactive
		// floor, starter, organization) is rejected with a clear upgrade message.
		const plan = await resolveOrgPlan(ctx, org._id);
		if (!isCoalitionPlan(plan)) {
			throw new Error(
				'Coalition networks require an active Coalition plan. Upgrade your organization to create one.'
			);
		}

		if (args.name.length < 3 || args.name.length > 100) {
			throw new Error('Name must be 3-100 characters');
		}
		if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(args.slug)) {
			throw new Error('Slug must be lowercase alphanumeric with hyphens');
		}

		// Check slug uniqueness
		const existingSlug = await ctx.db
			.query('orgNetworks')
			.withIndex('by_slug', (idx) => idx.eq('slug', args.slug))
			.first();
		if (existingSlug) {
			throw new Error('A network with this slug already exists');
		}
		const activeNetworks = await ctx.db
			.query('orgNetworkMembers')
			.withIndex('by_orgId_status', (q) => q.eq('orgId', org._id).eq('status', 'active'))
			.take(COALITION_MAX_ACTIVE_NETWORKS_PER_ORG + 1);
		if (activeNetworks.length >= COALITION_MAX_ACTIVE_NETWORKS_PER_ORG) {
			throw new Error('COALITION_ORG_ACTIVE_NETWORK_LIMIT_EXCEEDED');
		}

		const now = Date.now();

		const networkId = await ctx.db.insert('orgNetworks', {
			name: args.name,
			slug: args.slug,
			description: args.description,
			ownerOrgId: org._id,
			status: 'active',
			applicableCountries: [org.countryCode],
			coalitionMembershipRevision: 1,
			activeMemberCount: 1,
			updatedAt: now
		});

		// Add creating org as admin member
		await ctx.db.insert('orgNetworkMembers', {
			networkId,
			orgId: org._id,
			role: 'admin',
			status: 'active',
			joinedAt: now,
			invitedBy: userId
		});
		await markCoalitionNetworkDirty(ctx, networkId);

		return networkId;
	}
});

/**
 * Invite an org to the network. Requires admin role in the network.
 */
export const invite = mutation({
	args: {
		orgSlug: v.string(),
		networkId: v.id('orgNetworks'),
		targetOrgSlug: v.string()
	},
	handler: async (ctx, args) => {
		const { org, userId } = await requireOrgRole(ctx, args.orgSlug, 'member');

		// Verify caller is admin
		const callerMembership = await ctx.db
			.query('orgNetworkMembers')
			.withIndex('by_networkId_orgId', (idx) =>
				idx.eq('networkId', args.networkId).eq('orgId', org._id)
			)
			.first();

		if (
			!callerMembership ||
			callerMembership.status !== 'active' ||
			callerMembership.role !== 'admin'
		) {
			throw new Error('Network admin role required');
		}

		// Find target org
		const targetOrg = await loadOrg(ctx, args.targetOrgSlug);
		const targetPendingNetworks = await ctx.db
			.query('orgNetworkMembers')
			.withIndex('by_orgId_status', (q) => q.eq('orgId', targetOrg._id).eq('status', 'pending'))
			.take(COALITION_MAX_PENDING_NETWORKS_PER_ORG + 1);
		if (targetPendingNetworks.length >= COALITION_MAX_PENDING_NETWORKS_PER_ORG) {
			throw new Error('COALITION_ORG_PENDING_NETWORK_LIMIT_EXCEEDED');
		}
		const activeRoster = await ctx.db
			.query('orgNetworkMembers')
			.withIndex('by_networkId_status', (q) =>
				q.eq('networkId', args.networkId).eq('status', 'active')
			)
			.take(COALITION_MAX_ACTIVE_MEMBERS + 1);
		const pendingRoster = await ctx.db
			.query('orgNetworkMembers')
			.withIndex('by_networkId_status', (q) =>
				q.eq('networkId', args.networkId).eq('status', 'pending')
			)
			.take(COALITION_MAX_ACTIVE_MEMBERS + 1);
		if (activeRoster.length + pendingRoster.length >= COALITION_MAX_ACTIVE_MEMBERS) {
			throw new Error('COALITION_NETWORK_MEMBERSHIP_LIMIT_EXCEEDED');
		}

		// Check not already a member
		const existing = await ctx.db
			.query('orgNetworkMembers')
			.withIndex('by_networkId_orgId', (idx) =>
				idx.eq('networkId', args.networkId).eq('orgId', targetOrg._id)
			)
			.first();

		if (existing && existing.status !== 'removed') {
			throw new Error('Organization is already a member or has a pending invitation');
		}

		const now = Date.now();

		if (existing && existing.status === 'removed') {
			// Re-activate
			await ctx.db.patch(existing._id, {
				status: 'pending',
				role: 'member',
				invitedBy: userId,
				joinedAt: now
			});
			return existing._id;
		}

		return await ctx.db.insert('orgNetworkMembers', {
			networkId: args.networkId,
			orgId: targetOrg._id,
			role: 'member',
			status: 'pending',
			invitedBy: userId,
			joinedAt: now
		});
	}
});

/**
 * Update a member's status (accept, decline, remove).
 */
export const updateMemberStatus = mutation({
	args: {
		orgSlug: v.string(),
		networkId: v.id('orgNetworks'),
		targetOrgId: v.optional(v.id('organizations')),
		status: v.string()
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.orgSlug, 'member');

		const validStatuses = ['active', 'pending', 'removed'];
		if (!validStatuses.includes(args.status)) {
			throw new Error(`Invalid status: ${args.status}`);
		}

		// If no targetOrgId provided, it's a self-action on the caller's org
		const effectiveTargetOrgId = args.targetOrgId ?? org._id;
		const isSelfAction = effectiveTargetOrgId === org._id;

		if (!isSelfAction) {
			// Modifying another org requires admin
			const callerMembership = await ctx.db
				.query('orgNetworkMembers')
				.withIndex('by_networkId_orgId', (idx) =>
					idx.eq('networkId', args.networkId).eq('orgId', org._id)
				)
				.first();

			if (
				!callerMembership ||
				callerMembership.status !== 'active' ||
				callerMembership.role !== 'admin'
			) {
				throw new Error('Network admin role required to modify other members');
			}
		}

		const membership = await ctx.db
			.query('orgNetworkMembers')
			.withIndex('by_networkId_orgId', (idx) =>
				idx.eq('networkId', args.networkId).eq('orgId', effectiveTargetOrgId)
			)
			.first();

		if (!membership) {
			throw new Error('Membership not found');
		}
		if (membership.status === args.status) return { success: true, changed: false };

		if (isSelfAction) {
			// Self-actions: can only accept (pending→active) or leave (active→removed)
			if (membership.status === 'pending' && args.status === 'active') {
				// Accept invitation — allowed
			} else if (membership.status === 'active' && args.status === 'removed') {
				// Leave network — allowed
			} else {
				throw new Error(`Self-action not allowed: ${membership.status} → ${args.status}`);
			}
		}
		if (args.status === 'pending' && membership.status !== 'pending') {
			const targetPendingNetworks = await ctx.db
				.query('orgNetworkMembers')
				.withIndex('by_orgId_status', (q) =>
					q.eq('orgId', effectiveTargetOrgId).eq('status', 'pending')
				)
				.take(COALITION_MAX_PENDING_NETWORKS_PER_ORG + 1);
			if (targetPendingNetworks.length >= COALITION_MAX_PENDING_NETWORKS_PER_ORG) {
				throw new Error('COALITION_ORG_PENDING_NETWORK_LIMIT_EXCEEDED');
			}
		}
		if (
			membership.status === 'removed' &&
			(args.status === 'active' || args.status === 'pending')
		) {
			const [activeRoster, pendingRoster] = await Promise.all([
				ctx.db
					.query('orgNetworkMembers')
					.withIndex('by_networkId_status', (q) =>
						q.eq('networkId', args.networkId).eq('status', 'active')
					)
					.take(COALITION_MAX_ACTIVE_MEMBERS + 1),
				ctx.db
					.query('orgNetworkMembers')
					.withIndex('by_networkId_status', (q) =>
						q.eq('networkId', args.networkId).eq('status', 'pending')
					)
					.take(COALITION_MAX_ACTIVE_MEMBERS + 1)
			]);
			if (activeRoster.length + pendingRoster.length >= COALITION_MAX_ACTIVE_MEMBERS) {
				throw new Error('COALITION_NETWORK_MEMBERSHIP_LIMIT_EXCEEDED');
			}
		}

		const activeRosterChanged = (membership.status === 'active') !== (args.status === 'active');
		if (args.status === 'active' && membership.status !== 'active') {
			const activeMembers = await ctx.db
				.query('orgNetworkMembers')
				.withIndex('by_networkId_status', (q) =>
					q.eq('networkId', args.networkId).eq('status', 'active')
				)
				.take(COALITION_MAX_ACTIVE_MEMBERS + 1);
			if (activeMembers.length >= COALITION_MAX_ACTIVE_MEMBERS) {
				throw new Error('COALITION_NETWORK_ACTIVE_MEMBER_LIMIT_EXCEEDED');
			}
			const targetNetworks = await ctx.db
				.query('orgNetworkMembers')
				.withIndex('by_orgId_status', (q) =>
					q.eq('orgId', effectiveTargetOrgId).eq('status', 'active')
				)
				.take(COALITION_MAX_ACTIVE_NETWORKS_PER_ORG + 1);
			if (targetNetworks.length >= COALITION_MAX_ACTIVE_NETWORKS_PER_ORG) {
				throw new Error('COALITION_ORG_ACTIVE_NETWORK_LIMIT_EXCEEDED');
			}
		}
		await ctx.db.patch(membership._id, {
			status: args.status,
			joinedAt: args.status === 'active' ? Date.now() : membership.joinedAt
		});
		if (activeRosterChanged) await invalidateCoalitionRoster(ctx, args.networkId);
		return { success: true, changed: true };
	}
});

/**
 * Promote/demote a member org's role within a network. Owner org cannot be
 * demoted. Distinct from updateMemberStatus (which moves between
 * active/pending/removed). T7-8.
 */
export const updateMemberRole = mutation({
	args: {
		orgSlug: v.string(),
		networkId: v.id('orgNetworks'),
		targetOrgId: v.id('organizations'),
		role: v.union(v.literal('admin'), v.literal('member'))
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.orgSlug, 'member');

		// Caller must be a network admin
		const callerMembership = await ctx.db
			.query('orgNetworkMembers')
			.withIndex('by_networkId_orgId', (idx) =>
				idx.eq('networkId', args.networkId).eq('orgId', org._id)
			)
			.first();
		if (
			!callerMembership ||
			callerMembership.status !== 'active' ||
			callerMembership.role !== 'admin'
		) {
			throw new Error('Network admin role required');
		}

		// Owner org of the network cannot be demoted — that would orphan the
		// network. Load the network to check ownerOrgId.
		const network = await ctx.db.get(args.networkId);
		if (!network) throw new Error('Network not found');
		if (network.ownerOrgId === args.targetOrgId && args.role !== 'admin') {
			throw new Error('Owner org of the network cannot be demoted');
		}

		const target = await ctx.db
			.query('orgNetworkMembers')
			.withIndex('by_networkId_orgId', (idx) =>
				idx.eq('networkId', args.networkId).eq('orgId', args.targetOrgId)
			)
			.first();
		if (!target) throw new Error('Membership not found');
		if (target.role === args.role) return { success: true, changed: false };

		await ctx.db.patch(target._id, { role: args.role });
		return { success: true, changed: true };
	}
});

/**
 * Update network name/description. Requires admin role in the network.
 */
export const update = mutation({
	args: {
		orgSlug: v.string(),
		networkId: v.id('orgNetworks'),
		name: v.optional(v.string()),
		description: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.orgSlug, 'member');

		if (args.name === undefined && args.description === undefined) {
			throw new Error('At least one field (name or description) is required');
		}
		const network = await ctx.db.get(args.networkId);
		if (!network) throw new Error('Network not found');
		if (args.name !== undefined && network.charterPublishedAt) {
			throw new Error('NETWORK_CHARTER_IDENTITY_IMMUTABLE');
		}

		// Verify caller is admin
		const callerMembership = await ctx.db
			.query('orgNetworkMembers')
			.withIndex('by_networkId_orgId', (idx) =>
				idx.eq('networkId', args.networkId).eq('orgId', org._id)
			)
			.first();

		if (
			!callerMembership ||
			callerMembership.status !== 'active' ||
			callerMembership.role !== 'admin'
		) {
			throw new Error('Network admin role required');
		}

		const updates: Record<string, unknown> = { updatedAt: Date.now() };
		if (args.name !== undefined) {
			if (args.name.length < 3 || args.name.length > 100) {
				throw new Error('Name must be 3-100 characters');
			}
			updates.name = args.name;
		}
		if (args.description !== undefined) updates.description = args.description;

		await ctx.db.patch(args.networkId, updates);

		const updatedNetwork = await ctx.db.get(args.networkId);
		return {
			_id: args.networkId,
			name: updatedNetwork!.name,
			description: updatedNetwork!.description ?? null
		};
	}
});

/**
 * Remove a network entirely (owner only). Deletes all memberships.
 */
export const remove = mutation({
	args: {
		orgSlug: v.string(),
		networkId: v.id('orgNetworks')
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.orgSlug, 'owner');

		const network = await ctx.db.get(args.networkId);
		if (!network) throw new Error('Network not found');
		if (network.ownerOrgId !== org._id) {
			throw new Error('Only the network owner can delete it');
		}

		// Logical removal lets the generation materializer swap to an empty
		// roster and delete the prior high-cardinality generation in bounded
		// pages. The immutable public charter, if any, remains an audit record.
		const activeMembers = await ctx.db
			.query('orgNetworkMembers')
			.withIndex('by_networkId_status', (q) =>
				q.eq('networkId', args.networkId).eq('status', 'active')
			)
			.take(COALITION_MAX_ACTIVE_MEMBERS + 1);
		const pendingMembers = await ctx.db
			.query('orgNetworkMembers')
			.withIndex('by_networkId_status', (q) =>
				q.eq('networkId', args.networkId).eq('status', 'pending')
			)
			.take(COALITION_MAX_ACTIVE_MEMBERS + 1);
		if (activeMembers.length + pendingMembers.length > COALITION_MAX_ACTIVE_MEMBERS) {
			throw new Error('COALITION_NETWORK_MEMBERSHIP_LIMIT_EXCEEDED');
		}

		for (const m of [...activeMembers, ...pendingMembers]) {
			if (m.status !== 'removed') await ctx.db.patch(m._id, { status: 'removed' });
		}
		await ctx.db.patch(args.networkId, { status: 'removed', updatedAt: Date.now() });
		await invalidateCoalitionRoster(ctx, args.networkId);
		return { deleted: true };
	}
});

/**
 * Check if an org is an active member of a network (for public API stats).
 */
export const checkMembership = query({
	args: { networkId: v.id('orgNetworks'), orgId: v.id('organizations'), _secret: v.string() },
	handler: async (ctx, { networkId, orgId, _secret }) => {
		requireInternalSecret(_secret);
		const member = await ctx.db
			.query('orgNetworkMembers')
			.withIndex('by_networkId_orgId', (idx) => idx.eq('networkId', networkId).eq('orgId', orgId))
			.unique();
		return member?.status === 'active' ? { _id: member._id } : null;
	}
});

/**
 * @deprecated The launch-safe coalition projection is rebuilt by the bounded,
 * cursor-driven coordinator below. Keeping the historical public mutation live
 * would permit one request to scan every member, campaign, and delivery.
 */
export const refreshCoalitionPacketHash = mutation({
	args: {
		orgSlug: v.string(),
		networkId: v.id('orgNetworks')
	},
	handler: async () => {
		throw new Error('COALITION_PACKET_HASH_RETIRED');
	}
});

function rebuildAccumulator(rebuild: Doc<'coalitionNetworkRebuilds'>): CoalitionRebuildAccumulator {
	return rebuild.accumulator as CoalitionRebuildAccumulator;
}

async function scheduleCoalitionRebuild(
	ctx: MutationCtx,
	networkId: Id<'orgNetworks'>,
	delay = 0
): Promise<void> {
	await ctx.scheduler.runAfter(delay, continueCoalitionNetworkRebuildRef, { networkId });
}

async function blockCoalitionRebuild(
	ctx: MutationCtx,
	rebuild: Doc<'coalitionNetworkRebuilds'>,
	failureCode: string
): Promise<void> {
	const aggregate = await ctx.db
		.query('coalitionNetworkAggregates')
		.withIndex('by_networkId', (q) => q.eq('networkId', rebuild.networkId))
		.unique();
	await ctx.db.patch(rebuild._id, {
		status: 'blocked',
		failureCode: failureCode.slice(0, 500),
		completedAt: Date.now(),
		updatedAt: Date.now()
	});
	if (aggregate) {
		await ctx.db.patch(aggregate._id, {
			status: aggregate.activeGeneration ? 'ready' : 'blocked',
			failureCode: failureCode.slice(0, 500),
			refreshScheduledAt: undefined,
			updatedAt: Date.now()
		});
	}
}

async function startCoalitionNetworkRebuild(
	ctx: MutationCtx,
	networkId: Id<'orgNetworks'>
): Promise<{ status: 'started' | 'missing' | 'blocked' }> {
	const network = await ctx.db.get(networkId);
	if (!network) return { status: 'missing' };
	const members = await ctx.db
		.query('orgNetworkMembers')
		.withIndex('by_networkId_status', (q) => q.eq('networkId', networkId).eq('status', 'active'))
		.take(COALITION_MAX_ACTIVE_MEMBERS + 1);
	const previous = await ctx.db
		.query('coalitionNetworkRebuilds')
		.withIndex('by_networkId', (q) => q.eq('networkId', networkId))
		.unique();
	if (members.length > COALITION_MAX_ACTIVE_MEMBERS) {
		const now = Date.now();
		const blocked = {
			networkId,
			status: 'blocked',
			runToken: crypto.randomUUID(),
			targetGeneration: Math.max((previous?.targetGeneration ?? 0) + 1, 1),
			phase: 'blocked',
			memberOrgIds: [],
			memberRevisions: [],
			membershipRevision: network.coalitionMembershipRevision ?? 0,
			memberIndex: 0,
			kindIndex: 0,
			cursor: undefined,
			accumulator: {},
			failureCode: 'COALITION_NETWORK_ACTIVE_MEMBER_LIMIT_EXCEEDED',
			startedAt: now,
			completedAt: now,
			updatedAt: now
		};
		if (previous) await ctx.db.patch(previous._id, blocked);
		else await ctx.db.insert('coalitionNetworkRebuilds', blocked);
		const aggregate = await ctx.db
			.query('coalitionNetworkAggregates')
			.withIndex('by_networkId', (q) => q.eq('networkId', networkId))
			.unique();
		if (aggregate) {
			await ctx.db.patch(aggregate._id, {
				status: aggregate.activeGeneration ? 'ready' : 'blocked',
				failureCode: blocked.failureCode,
				refreshScheduledAt: undefined,
				updatedAt: now
			});
		}
		return { status: 'blocked' };
	}

	const memberOrgIds = members
		.map((member) => member.orgId)
		.sort((left, right) => String(left).localeCompare(String(right)));
	const inputs = await Promise.all(
		memberOrgIds.map(
			async (orgId) =>
				await ctx.db
					.query('coalitionOrgMetricInputs')
					.withIndex('by_orgId', (q) => q.eq('orgId', orgId))
					.unique()
		)
	);
	const aggregate = await ctx.db
		.query('coalitionNetworkAggregates')
		.withIndex('by_networkId', (q) => q.eq('networkId', networkId))
		.unique();
	const accumulator: CoalitionRebuildAccumulator = {
		totalSupporters: inputs.reduce((sum, row) => sum + (row?.totalSupporters ?? 0), 0),
		verifiedSupporters: inputs.reduce((sum, row) => sum + (row?.verifiedSupporters ?? 0), 0),
		totalCampaignActions: inputs.reduce((sum, row) => sum + (row?.totalCampaignActions ?? 0), 0),
		verifiedCampaignActions: inputs.reduce(
			(sum, row) => sum + (row?.verifiedCampaignActions ?? 0),
			0
		),
		messageHashedTotal: inputs.reduce((sum, row) => sum + (row?.messageHashedTotal ?? 0), 0),
		uniqueSupporters: 0,
		uniqueMessages: 0,
		districtCount: 0,
		districtSquareSum: 0,
		hourCountXLogXSum: 0,
		tier1: inputs.reduce((sum, row) => sum + (row?.tier1 ?? 0), 0),
		tier3: inputs.reduce((sum, row) => sum + (row?.tier3 ?? 0), 0),
		tier4: inputs.reduce((sum, row) => sum + (row?.tier4 ?? 0), 0),
		stateCounts: {},
		previousGeneration: aggregate?.activeGeneration
	};
	const targetGeneration = Math.max(
		(aggregate?.activeGeneration ?? 0) + 1,
		(previous?.targetGeneration ?? 0) + 1
	);
	const now = Date.now();
	const next = {
		networkId,
		status: 'running',
		runToken: crypto.randomUUID(),
		targetGeneration,
		phase: 'dimensions',
		memberOrgIds,
		memberRevisions: inputs.map((row) => row?.revision ?? 0),
		membershipRevision: network.coalitionMembershipRevision ?? 0,
		memberIndex: 0,
		kindIndex: 0,
		cursor: undefined,
		accumulator,
		failureCode: undefined,
		startedAt: now,
		completedAt: undefined,
		updatedAt: now
	};
	if (previous) await ctx.db.patch(previous._id, next);
	else await ctx.db.insert('coalitionNetworkRebuilds', next);
	if (aggregate) {
		await ctx.db.patch(aggregate._id, {
			status: aggregate.activeGeneration ? 'ready' : 'building',
			failureCode: undefined,
			refreshScheduledAt: now,
			updatedAt: now
		});
	}
	await scheduleCoalitionRebuild(ctx, networkId);
	return { status: 'started' };
}

async function beginCoalitionGenerationCleanup(
	ctx: MutationCtx,
	rebuild: Doc<'coalitionNetworkRebuilds'>,
	generation: number | undefined,
	restartAfterCleanup: boolean,
	failureCode?: string
): Promise<void> {
	const accumulator = rebuildAccumulator(rebuild);
	if (generation === undefined) {
		await ctx.db.patch(rebuild._id, {
			status: restartAfterCleanup ? 'superseded' : 'complete',
			phase: 'complete',
			failureCode,
			completedAt: Date.now(),
			updatedAt: Date.now()
		});
		if (restartAfterCleanup) {
			const aggregate = await ctx.db
				.query('coalitionNetworkAggregates')
				.withIndex('by_networkId', (q) => q.eq('networkId', rebuild.networkId))
				.unique();
			if (aggregate) {
				await ctx.db.patch(aggregate._id, { refreshScheduledAt: undefined });
				await markCoalitionNetworkDirty(ctx, rebuild.networkId);
			}
		}
		return;
	}
	await ctx.db.patch(rebuild._id, {
		status: 'cleanup',
		phase: 'cleanup_dimensions',
		memberIndex: 0,
		kindIndex: 0,
		cursor: undefined,
		accumulator: {
			...accumulator,
			cleanupGeneration: generation,
			restartAfterCleanup
		},
		failureCode,
		updatedAt: Date.now()
	});
	await scheduleCoalitionRebuild(ctx, rebuild.networkId);
}

async function continueCoalitionDimensions(
	ctx: MutationCtx,
	rebuild: Doc<'coalitionNetworkRebuilds'>
): Promise<void> {
	if (rebuild.memberIndex >= rebuild.memberOrgIds.length) {
		await ctx.db.patch(rebuild._id, {
			phase: 'pressure',
			memberIndex: 0,
			kindIndex: 0,
			cursor: undefined,
			updatedAt: Date.now()
		});
		await scheduleCoalitionRebuild(ctx, rebuild.networkId);
		return;
	}
	const kind = COALITION_DIMENSION_KINDS[rebuild.kindIndex];
	if (!kind) {
		await ctx.db.patch(rebuild._id, {
			memberIndex: rebuild.memberIndex + 1,
			kindIndex: 0,
			cursor: undefined,
			updatedAt: Date.now()
		});
		await scheduleCoalitionRebuild(ctx, rebuild.networkId);
		return;
	}
	const orgId = rebuild.memberOrgIds[rebuild.memberIndex]!;
	const page = await ctx.db
		.query('coalitionOrgMetricDimensions')
		.withIndex('by_orgId_kind', (q) => q.eq('orgId', orgId).eq('kind', kind))
		.paginate({
			cursor: rebuild.cursor ?? null,
			numItems: COALITION_REBUILD_PAGE_ROWS,
			maximumRowsRead: COALITION_REBUILD_PAGE_ROWS + 1,
			maximumBytesRead: COALITION_REBUILD_PAGE_BYTES
		});
	if (page.pageStatus === 'SplitRequired') {
		await blockCoalitionRebuild(ctx, rebuild, 'COALITION_DIMENSION_PAGE_SPLIT_REQUIRED');
		return;
	}
	const accumulator = rebuildAccumulator(rebuild);
	for (const source of page.page) {
		const current = await ctx.db
			.query('coalitionNetworkMetricDimensions')
			.withIndex('by_networkId_generation_kind_key', (q) =>
				q
					.eq('networkId', rebuild.networkId)
					.eq('generation', rebuild.targetGeneration)
					.eq('kind', kind)
					.eq('key', source.key)
			)
			.unique();
		const oldCount = current?.count ?? 0;
		const count = oldCount + source.count;
		if (current) await ctx.db.patch(current._id, { count, updatedAt: Date.now() });
		else {
			await ctx.db.insert('coalitionNetworkMetricDimensions', {
				networkId: rebuild.networkId,
				generation: rebuild.targetGeneration,
				kind,
				key: source.key,
				count,
				updatedAt: Date.now()
			});
		}
		if (kind === 'supporter_hash' && oldCount === 0) accumulator.uniqueSupporters += 1;
		else if (kind === 'action_message' && oldCount === 0) accumulator.uniqueMessages += 1;
		else if (kind === 'action_district') {
			if (oldCount === 0) accumulator.districtCount += 1;
			accumulator.districtSquareSum += count * count - oldCount * oldCount;
		} else if (kind === 'action_hour') {
			accumulator.hourCountXLogXSum += xLog2X(count) - xLog2X(oldCount);
		} else if (kind === 'country') {
			accumulator.stateCounts[source.key] = count;
		}
	}
	await ctx.db.patch(rebuild._id, {
		memberIndex: page.isDone ? rebuild.memberIndex : rebuild.memberIndex,
		kindIndex: page.isDone ? rebuild.kindIndex + 1 : rebuild.kindIndex,
		cursor: page.isDone ? undefined : page.continueCursor,
		accumulator,
		updatedAt: Date.now()
	});
	await scheduleCoalitionRebuild(ctx, rebuild.networkId);
}

async function continueCoalitionPressure(
	ctx: MutationCtx,
	rebuild: Doc<'coalitionNetworkRebuilds'>
): Promise<void> {
	if (rebuild.memberIndex >= rebuild.memberOrgIds.length) {
		await ctx.db.patch(rebuild._id, {
			phase: 'bills',
			memberIndex: 0,
			cursor: undefined,
			updatedAt: Date.now()
		});
		await scheduleCoalitionRebuild(ctx, rebuild.networkId);
		return;
	}
	const orgId = rebuild.memberOrgIds[rebuild.memberIndex]!;
	const page = await ctx.db
		.query('coalitionOrgPressureInputs')
		.withIndex('by_orgId', (q) => q.eq('orgId', orgId))
		.paginate({
			cursor: rebuild.cursor ?? null,
			numItems: COALITION_REBUILD_PAGE_ROWS,
			maximumRowsRead: COALITION_REBUILD_PAGE_ROWS + 1,
			maximumBytesRead: COALITION_REBUILD_PAGE_BYTES
		});
	if (page.pageStatus === 'SplitRequired') {
		await blockCoalitionRebuild(ctx, rebuild, 'COALITION_PRESSURE_PAGE_SPLIT_REQUIRED');
		return;
	}
	for (const source of page.page) {
		const current = await ctx.db
			.query('coalitionNetworkPressureRows')
			.withIndex('by_networkId_generation_decisionMakerId', (q) =>
				q
					.eq('networkId', rebuild.networkId)
					.eq('generation', rebuild.targetGeneration)
					.eq('decisionMakerId', source.decisionMakerId)
			)
			.unique();
		const patch = {
			canonicalSlug: current?.canonicalSlug ?? source.canonicalSlug,
			dmName:
				!current || source.latestReceiptAt >= current.latestReceiptAt
					? source.dmName
					: current.dmName,
			orgCount: (current?.orgCount ?? 0) + 1,
			combinedProofWeight: (current?.combinedProofWeight ?? 0) + source.maxProofWeight,
			verifiedActionEvidence:
				(current?.verifiedActionEvidence ?? 0) + source.verifiedActionEvidence,
			districtSignalCount: (current?.districtSignalCount ?? 0) + source.districtSignalCount,
			receiptCount: (current?.receiptCount ?? 0) + source.receiptCount,
			latestReceiptAt: Math.max(current?.latestReceiptAt ?? 0, source.latestReceiptAt),
			updatedAt: Date.now()
		};
		if (current) await ctx.db.patch(current._id, patch);
		else {
			await ctx.db.insert('coalitionNetworkPressureRows', {
				networkId: rebuild.networkId,
				generation: rebuild.targetGeneration,
				decisionMakerId: source.decisionMakerId,
				bills: [],
				...patch
			});
		}
	}
	await ctx.db.patch(rebuild._id, {
		memberIndex: page.isDone ? rebuild.memberIndex + 1 : rebuild.memberIndex,
		cursor: page.isDone ? undefined : page.continueCursor,
		updatedAt: Date.now()
	});
	await scheduleCoalitionRebuild(ctx, rebuild.networkId);
}

async function continueCoalitionBills(
	ctx: MutationCtx,
	rebuild: Doc<'coalitionNetworkRebuilds'>
): Promise<void> {
	if (rebuild.memberIndex >= rebuild.memberOrgIds.length) {
		await ctx.db.patch(rebuild._id, {
			phase: 'commit',
			memberIndex: 0,
			cursor: undefined,
			updatedAt: Date.now()
		});
		await scheduleCoalitionRebuild(ctx, rebuild.networkId);
		return;
	}
	const orgId = rebuild.memberOrgIds[rebuild.memberIndex]!;
	const page = await ctx.db
		.query('coalitionOrgPressureBillInputs')
		.withIndex('by_orgId', (q) => q.eq('orgId', orgId))
		.paginate({
			cursor: rebuild.cursor ?? null,
			numItems: COALITION_REBUILD_PAGE_ROWS,
			maximumRowsRead: COALITION_REBUILD_PAGE_ROWS + 1,
			maximumBytesRead: COALITION_REBUILD_PAGE_BYTES
		});
	if (page.pageStatus === 'SplitRequired') {
		await blockCoalitionRebuild(ctx, rebuild, 'COALITION_BILL_PAGE_SPLIT_REQUIRED');
		return;
	}
	for (const source of page.page) {
		const current = await ctx.db
			.query('coalitionNetworkPressureBills')
			.withIndex('by_networkId_generation_decisionMakerId_billId', (q) =>
				q
					.eq('networkId', rebuild.networkId)
					.eq('generation', rebuild.targetGeneration)
					.eq('decisionMakerId', source.decisionMakerId)
					.eq('billId', source.billId)
			)
			.unique();
		const merged = {
			billTitle:
				!current || source.latestReceiptAt >= current.latestReceiptAt
					? source.billTitle
					: current.billTitle,
			alignmentNumerator: (current?.alignmentNumerator ?? 0) + source.alignmentNumerator,
			alignmentWeight: (current?.alignmentWeight ?? 0) + source.alignmentWeight,
			dmAction:
				!current || source.latestReceiptAt >= current.latestReceiptAt
					? (source.dmAction ?? current?.dmAction)
					: (current.dmAction ?? source.dmAction),
			receiptCount: (current?.receiptCount ?? 0) + source.receiptCount,
			latestReceiptAt: Math.max(current?.latestReceiptAt ?? 0, source.latestReceiptAt),
			updatedAt: Date.now()
		};
		if (current) await ctx.db.patch(current._id, merged);
		else {
			await ctx.db.insert('coalitionNetworkPressureBills', {
				networkId: rebuild.networkId,
				generation: rebuild.targetGeneration,
				decisionMakerId: source.decisionMakerId,
				billId: source.billId,
				...merged
			});
		}
		const pressure = await ctx.db
			.query('coalitionNetworkPressureRows')
			.withIndex('by_networkId_generation_decisionMakerId', (q) =>
				q
					.eq('networkId', rebuild.networkId)
					.eq('generation', rebuild.targetGeneration)
					.eq('decisionMakerId', source.decisionMakerId)
			)
			.unique();
		if (!pressure) {
			await blockCoalitionRebuild(ctx, rebuild, 'COALITION_PRESSURE_PARENT_MISSING');
			return;
		}
		const candidate = {
			billId: String(source.billId),
			billTitle: merged.billTitle,
			alignment:
				merged.alignmentWeight > 0 ? merged.alignmentNumerator / merged.alignmentWeight : 0,
			dmAction: merged.dmAction,
			receiptCount: merged.receiptCount
		};
		const bills = pressure.bills
			.filter((bill) => bill.billId !== candidate.billId)
			.concat(candidate)
			.sort(
				(left, right) =>
					right.receiptCount - left.receiptCount || left.billId.localeCompare(right.billId)
			)
			.slice(0, COALITION_MAX_PRESSURE_BILLS);
		await ctx.db.patch(pressure._id, { bills, updatedAt: Date.now() });
	}
	await ctx.db.patch(rebuild._id, {
		memberIndex: page.isDone ? rebuild.memberIndex + 1 : rebuild.memberIndex,
		cursor: page.isDone ? undefined : page.continueCursor,
		updatedAt: Date.now()
	});
	await scheduleCoalitionRebuild(ctx, rebuild.networkId);
}

async function commitCoalitionNetworkGeneration(
	ctx: MutationCtx,
	rebuild: Doc<'coalitionNetworkRebuilds'>
): Promise<void> {
	const network = await ctx.db.get(rebuild.networkId);
	if (!network) {
		await beginCoalitionGenerationCleanup(
			ctx,
			rebuild,
			rebuild.targetGeneration,
			false,
			'COALITION_NETWORK_REMOVED'
		);
		return;
	}
	const activeMembers = await ctx.db
		.query('orgNetworkMembers')
		.withIndex('by_networkId_status', (q) =>
			q.eq('networkId', rebuild.networkId).eq('status', 'active')
		)
		.take(COALITION_MAX_ACTIVE_MEMBERS + 1);
	const currentMemberIds = activeMembers
		.map((member) => member.orgId)
		.sort((left, right) => String(left).localeCompare(String(right)));
	const rosterMatches =
		(network.coalitionMembershipRevision ?? 0) === rebuild.membershipRevision &&
		currentMemberIds.length === rebuild.memberOrgIds.length &&
		currentMemberIds.every((orgId, index) => orgId === rebuild.memberOrgIds[index]);
	let inputsMatch = rosterMatches;
	if (inputsMatch) {
		for (let index = 0; index < rebuild.memberOrgIds.length; index += 1) {
			const input = await ctx.db
				.query('coalitionOrgMetricInputs')
				.withIndex('by_orgId', (q) => q.eq('orgId', rebuild.memberOrgIds[index]!))
				.unique();
			if ((input?.revision ?? 0) !== rebuild.memberRevisions[index]) {
				inputsMatch = false;
				break;
			}
		}
	}
	if (!inputsMatch) {
		await beginCoalitionGenerationCleanup(
			ctx,
			rebuild,
			rebuild.targetGeneration,
			true,
			'COALITION_REBUILD_SOURCE_REVISION_CHANGED'
		);
		return;
	}

	const accumulator = rebuildAccumulator(rebuild);
	const distribution = boundedStateDistribution(new Map(Object.entries(accumulator.stateCounts)));
	const totalActions = accumulator.totalCampaignActions;
	const gds =
		accumulator.districtCount > 0 && totalActions > 0
			? Math.max(0, Math.min(1, 1 - accumulator.districtSquareSum / (totalActions * totalActions)))
			: undefined;
	const ald =
		accumulator.messageHashedTotal > 0
			? Math.max(0, Math.min(1, accumulator.uniqueMessages / accumulator.messageHashedTotal))
			: undefined;
	const temporalEntropy =
		totalActions > 0
			? Math.max(0, Math.log2(totalActions) - accumulator.hourCountXLogXSum / totalActions)
			: undefined;
	const cai =
		accumulator.tier1 + accumulator.tier3 + accumulator.tier4 > 0
			? Math.round(
					((accumulator.tier3 + accumulator.tier4) / Math.max(accumulator.tier1, 1)) * 100
				) / 100
			: undefined;
	const aggregate = await ctx.db
		.query('coalitionNetworkAggregates')
		.withIndex('by_networkId', (q) => q.eq('networkId', rebuild.networkId))
		.unique();
	if (!aggregate) {
		await blockCoalitionRebuild(ctx, rebuild, 'COALITION_NETWORK_AGGREGATE_MISSING');
		return;
	}
	await ctx.db.patch(aggregate._id, {
		version: COALITION_METRICS_VERSION,
		status: 'ready',
		activeGeneration: rebuild.targetGeneration,
		revision: aggregate.revision + 1,
		memberCount: rebuild.memberOrgIds.length,
		totalSupporters: accumulator.totalSupporters,
		uniqueSupporters: accumulator.uniqueSupporters,
		verifiedSupporters: accumulator.verifiedSupporters,
		totalCampaignActions: accumulator.totalCampaignActions,
		verifiedCampaignActions: accumulator.verifiedCampaignActions,
		messageHashedTotal: accumulator.messageHashedTotal,
		uniqueMessages: accumulator.uniqueMessages,
		districtCount: accumulator.districtCount,
		districtSquareSum: accumulator.districtSquareSum,
		hourCountXLogXSum: accumulator.hourCountXLogXSum,
		tier1: accumulator.tier1,
		tier3: accumulator.tier3,
		tier4: accumulator.tier4,
		stateDistribution: distribution.buckets,
		stateDistributionOtherCount: distribution.otherCount,
		gds,
		ald,
		temporalEntropy,
		cai,
		dirtyAt: undefined,
		refreshScheduledAt: undefined,
		failureCode: undefined,
		updatedAt: Date.now()
	});
	await beginCoalitionGenerationCleanup(ctx, rebuild, accumulator.previousGeneration, false);
}

async function continueCoalitionCleanup(
	ctx: MutationCtx,
	rebuild: Doc<'coalitionNetworkRebuilds'>
): Promise<void> {
	const accumulator = rebuildAccumulator(rebuild);
	const generation = accumulator.cleanupGeneration;
	if (generation === undefined) {
		await beginCoalitionGenerationCleanup(
			ctx,
			rebuild,
			undefined,
			accumulator.restartAfterCleanup ?? false,
			rebuild.failureCode
		);
		return;
	}
	let page:
		| Awaited<
				ReturnType<ReturnType<typeof ctx.db.query<'coalitionNetworkMetricDimensions'>>['paginate']>
		  >
		| undefined;
	if (rebuild.phase === 'cleanup_dimensions') {
		page = await ctx.db
			.query('coalitionNetworkMetricDimensions')
			.withIndex('by_networkId_generation_kind', (q) =>
				q.eq('networkId', rebuild.networkId).eq('generation', generation)
			)
			.paginate({
				cursor: rebuild.cursor ?? null,
				numItems: COALITION_REBUILD_PAGE_ROWS,
				maximumRowsRead: COALITION_REBUILD_PAGE_ROWS + 1,
				maximumBytesRead: COALITION_REBUILD_PAGE_BYTES
			});
	} else if (rebuild.phase === 'cleanup_pressure') {
		const pressurePage = await ctx.db
			.query('coalitionNetworkPressureRows')
			.withIndex('by_networkId_generation_decisionMakerId', (q) =>
				q.eq('networkId', rebuild.networkId).eq('generation', generation)
			)
			.paginate({
				cursor: rebuild.cursor ?? null,
				numItems: COALITION_REBUILD_PAGE_ROWS,
				maximumRowsRead: COALITION_REBUILD_PAGE_ROWS + 1,
				maximumBytesRead: COALITION_REBUILD_PAGE_BYTES
			});
		if (pressurePage.pageStatus === 'SplitRequired') {
			await blockCoalitionRebuild(ctx, rebuild, 'COALITION_CLEANUP_PAGE_SPLIT_REQUIRED');
			return;
		}
		for (const row of pressurePage.page) await ctx.db.delete(row._id);
		await ctx.db.patch(rebuild._id, {
			phase: pressurePage.isDone ? 'cleanup_bills' : rebuild.phase,
			cursor: pressurePage.isDone ? undefined : pressurePage.continueCursor,
			updatedAt: Date.now()
		});
		await scheduleCoalitionRebuild(ctx, rebuild.networkId);
		return;
	} else if (rebuild.phase === 'cleanup_bills') {
		const billPage = await ctx.db
			.query('coalitionNetworkPressureBills')
			.withIndex('by_networkId_generation', (q) =>
				q.eq('networkId', rebuild.networkId).eq('generation', generation)
			)
			.paginate({
				cursor: rebuild.cursor ?? null,
				numItems: COALITION_REBUILD_PAGE_ROWS,
				maximumRowsRead: COALITION_REBUILD_PAGE_ROWS + 1,
				maximumBytesRead: COALITION_REBUILD_PAGE_BYTES
			});
		if (billPage.pageStatus === 'SplitRequired') {
			await blockCoalitionRebuild(ctx, rebuild, 'COALITION_CLEANUP_PAGE_SPLIT_REQUIRED');
			return;
		}
		for (const row of billPage.page) await ctx.db.delete(row._id);
		if (!billPage.isDone) {
			await ctx.db.patch(rebuild._id, {
				cursor: billPage.continueCursor,
				updatedAt: Date.now()
			});
			await scheduleCoalitionRebuild(ctx, rebuild.networkId);
			return;
		}
		await ctx.db.patch(rebuild._id, {
			status: accumulator.restartAfterCleanup ? 'superseded' : 'complete',
			phase: 'complete',
			cursor: undefined,
			completedAt: Date.now(),
			updatedAt: Date.now()
		});
		const aggregate = await ctx.db
			.query('coalitionNetworkAggregates')
			.withIndex('by_networkId', (q) => q.eq('networkId', rebuild.networkId))
			.unique();
		if (accumulator.restartAfterCleanup && aggregate) {
			await ctx.db.patch(aggregate._id, { refreshScheduledAt: undefined });
			await markCoalitionNetworkDirty(ctx, rebuild.networkId);
		} else if (aggregate?.dirtyAt) {
			await scheduleCoalitionRebuild(ctx, rebuild.networkId);
		}
		return;
	}
	if (!page) {
		await blockCoalitionRebuild(ctx, rebuild, 'COALITION_CLEANUP_PHASE_INVALID');
		return;
	}
	if (page.pageStatus === 'SplitRequired') {
		await blockCoalitionRebuild(ctx, rebuild, 'COALITION_CLEANUP_PAGE_SPLIT_REQUIRED');
		return;
	}
	for (const row of page.page) await ctx.db.delete(row._id);
	await ctx.db.patch(rebuild._id, {
		phase: page.isDone ? 'cleanup_pressure' : rebuild.phase,
		cursor: page.isDone ? undefined : page.continueCursor,
		updatedAt: Date.now()
	});
	await scheduleCoalitionRebuild(ctx, rebuild.networkId);
}

/** Durable, row/byte-bounded network generation materializer. */
export const continueCoalitionNetworkRebuild = internalMutation({
	args: { networkId: v.id('orgNetworks') },
	handler: async (ctx, { networkId }) => {
		const rebuild = await ctx.db
			.query('coalitionNetworkRebuilds')
			.withIndex('by_networkId', (q) => q.eq('networkId', networkId))
			.unique();
		if (!rebuild || rebuild.status === 'complete' || rebuild.status === 'superseded') {
			const aggregate = await ctx.db
				.query('coalitionNetworkAggregates')
				.withIndex('by_networkId', (q) => q.eq('networkId', networkId))
				.unique();
			if (aggregate && aggregate.dirtyAt === undefined) {
				return { status: 'idle' as const };
			}
			return await startCoalitionNetworkRebuild(ctx, networkId);
		}
		if (rebuild.status === 'blocked') {
			const aggregate = await ctx.db
				.query('coalitionNetworkAggregates')
				.withIndex('by_networkId', (q) => q.eq('networkId', networkId))
				.unique();
			if (aggregate?.refreshScheduledAt !== undefined) {
				return await startCoalitionNetworkRebuild(ctx, networkId);
			}
			return { status: 'blocked' as const };
		}
		if (rebuild.phase.startsWith('cleanup_')) {
			await continueCoalitionCleanup(ctx, rebuild);
			return { status: 'cleanup' as const, phase: rebuild.phase };
		}
		if (rebuild.phase === 'dimensions') await continueCoalitionDimensions(ctx, rebuild);
		else if (rebuild.phase === 'pressure') await continueCoalitionPressure(ctx, rebuild);
		else if (rebuild.phase === 'bills') await continueCoalitionBills(ctx, rebuild);
		else if (rebuild.phase === 'commit') await commitCoalitionNetworkGeneration(ctx, rebuild);
		else await blockCoalitionRebuild(ctx, rebuild, 'COALITION_REBUILD_PHASE_INVALID');
		return { status: 'running' as const, phase: rebuild.phase };
	}
});

async function scheduleCoalitionMigration(
	ctx: MutationCtx,
	runToken: string,
	delay = 0
): Promise<void> {
	await ctx.scheduler.runAfter(delay, migrateCoalitionMetricsRef, { runToken });
}

async function blockCoalitionMigration(
	ctx: MutationCtx,
	migration: Doc<'coalitionMetricsMigrations'>,
	failureCode: string,
	failureSourceId?: string
): Promise<{ status: 'blocked'; runToken: string; failureCode: string }> {
	await ctx.db.patch(migration._id, {
		status: 'blocked',
		failureCode: failureCode.slice(0, 500),
		failureSourceId,
		updatedAt: Date.now()
	});
	return { status: 'blocked', runToken: migration.runToken, failureCode };
}

/**
 * Exact legacy cutover. Every invocation handles one row/byte-bounded source
 * page or one network readiness check; run tokens make stale continuations
 * harmless and restartable.
 */
export const migrateCoalitionMetrics = internalMutation({
	args: {
		runToken: v.optional(v.string()),
		restart: v.optional(v.boolean()),
		scheduleContinuation: v.optional(v.boolean())
	},
	handler: async (ctx, args) => {
		if (args.runToken !== undefined && args.restart) {
			throw new Error('COALITION_MIGRATION_INVALID_CONTROL');
		}
		let migration = await ctx.db
			.query('coalitionMetricsMigrations')
			.withIndex('by_key', (q) => q.eq('key', COALITION_METRICS_MIGRATION_KEY))
			.unique();
		let runToken: string;
		if (args.runToken !== undefined) {
			if (!migration || migration.status !== 'running' || migration.runToken !== args.runToken) {
				return { status: 'superseded' as const, runToken: args.runToken };
			}
			runToken = args.runToken;
		} else if (!args.restart && migration?.status === 'ready') {
			return { status: 'already-ready' as const, runToken: migration.runToken };
		} else if (!args.restart && migration?.status === 'migrated') {
			return { status: 'already-migrated' as const, runToken: migration.runToken };
		} else if (!args.restart && migration?.status === 'running') {
			return { status: 'already-running' as const, runToken: migration.runToken };
		} else if (!args.restart && migration?.status === 'blocked') {
			return {
				status: 'blocked' as const,
				runToken: migration.runToken,
				failureCode: migration.failureCode ?? null
			};
		} else {
			runToken = crypto.randomUUID();
			const initial = {
				key: COALITION_METRICS_MIGRATION_KEY,
				status: 'running',
				runToken,
				phase: 'supporters',
				cursor: undefined,
				scannedSupporters: 0,
				projectedSupporters: 0,
				scannedActions: 0,
				projectedActions: 0,
				scannedReceipts: 0,
				projectedReceipts: 0,
				networksScheduled: 0,
				networksReady: 0,
				failureCode: undefined,
				failureSourceId: undefined,
				startedAt: Date.now(),
				completedAt: undefined,
				updatedAt: Date.now()
			};
			if (migration) await ctx.db.patch(migration._id, initial);
			else await ctx.db.insert('coalitionMetricsMigrations', initial);
			migration = await ctx.db
				.query('coalitionMetricsMigrations')
				.withIndex('by_key', (q) => q.eq('key', COALITION_METRICS_MIGRATION_KEY))
				.unique();
		}
		if (!migration || migration.status !== 'running' || migration.runToken !== runToken) {
			throw new Error('COALITION_MIGRATION_STATE_MISSING');
		}

		if (migration.phase === 'supporters') {
			const page = await ctx.db
				.query('supporters')
				.order('asc')
				.paginate({
					cursor: migration.cursor ?? null,
					numItems: COALITION_MIGRATION_SUPPORTER_ROWS,
					maximumRowsRead: COALITION_MIGRATION_SUPPORTER_ROWS + 1,
					maximumBytesRead: COALITION_MIGRATION_PAGE_BYTES
				});
			if (page.pageStatus === 'SplitRequired') {
				return await blockCoalitionMigration(
					ctx,
					migration,
					'COALITION_SUPPORTER_PAGE_SPLIT_REQUIRED'
				);
			}
			for (const supporter of page.page) {
				try {
					if (supporter.coalitionMetricsVersion !== COALITION_METRICS_VERSION) {
						await applyCoalitionSupporterTransition(ctx, supporter.orgId, null, supporter, {
							suppressNetworkRefresh: true
						});
					}
				} catch (error) {
					return await blockCoalitionMigration(
						ctx,
						migration,
						error instanceof Error ? error.message : String(error),
						String(supporter._id)
					);
				}
			}
			await ctx.db.patch(migration._id, {
				phase: page.isDone ? 'actions' : 'supporters',
				cursor: page.isDone ? undefined : page.continueCursor,
				scannedSupporters: migration.scannedSupporters + page.page.length,
				projectedSupporters: migration.projectedSupporters + page.page.length,
				updatedAt: Date.now()
			});
		} else if (migration.phase === 'actions') {
			const page = await ctx.db
				.query('campaignActions')
				.order('asc')
				.paginate({
					cursor: migration.cursor ?? null,
					numItems: COALITION_MIGRATION_ACTION_ROWS,
					maximumRowsRead: COALITION_MIGRATION_ACTION_ROWS + 1,
					maximumBytesRead: COALITION_MIGRATION_PAGE_BYTES
				});
			if (page.pageStatus === 'SplitRequired') {
				return await blockCoalitionMigration(
					ctx,
					migration,
					'COALITION_ACTION_PAGE_SPLIT_REQUIRED'
				);
			}
			for (const action of page.page) {
				try {
					if (action.coalitionMetricsVersion !== COALITION_METRICS_VERSION) {
						const campaign = action.orgId ? null : await ctx.db.get(action.campaignId);
						const orgId = action.orgId ?? campaign?.orgId;
						if (!orgId) throw new Error('COALITION_ACTION_ORG_MISSING');
						await applyCoalitionActionTransition(
							ctx,
							null,
							{ ...action, orgId },
							{ suppressNetworkRefresh: true }
						);
					}
				} catch (error) {
					return await blockCoalitionMigration(
						ctx,
						migration,
						error instanceof Error ? error.message : String(error),
						String(action._id)
					);
				}
			}
			await ctx.db.patch(migration._id, {
				phase: page.isDone ? 'receipts' : 'actions',
				cursor: page.isDone ? undefined : page.continueCursor,
				scannedActions: migration.scannedActions + page.page.length,
				projectedActions: migration.projectedActions + page.page.length,
				updatedAt: Date.now()
			});
		} else if (migration.phase === 'receipts') {
			const page = await ctx.db
				.query('accountabilityReceipts')
				.order('asc')
				.paginate({
					cursor: migration.cursor ?? null,
					numItems: COALITION_MIGRATION_RECEIPT_ROWS,
					maximumRowsRead: COALITION_MIGRATION_RECEIPT_ROWS + 1,
					maximumBytesRead: COALITION_MIGRATION_PAGE_BYTES
				});
			if (page.pageStatus === 'SplitRequired') {
				return await blockCoalitionMigration(
					ctx,
					migration,
					'COALITION_RECEIPT_PAGE_SPLIT_REQUIRED'
				);
			}
			for (const receipt of page.page) {
				try {
					if (receipt.coalitionMetricsVersion !== COALITION_METRICS_VERSION) {
						const bill = await ctx.db.get(receipt.billId);
						await applyCoalitionReceiptProjection(
							ctx,
							receipt,
							bill?.title ?? String(receipt.billId),
							{ suppressNetworkRefresh: true }
						);
					}
				} catch (error) {
					return await blockCoalitionMigration(
						ctx,
						migration,
						error instanceof Error ? error.message : String(error),
						String(receipt._id)
					);
				}
			}
			await ctx.db.patch(migration._id, {
				phase: page.isDone ? 'networks' : 'receipts',
				cursor: page.isDone ? undefined : page.continueCursor,
				scannedReceipts: migration.scannedReceipts + page.page.length,
				projectedReceipts: migration.projectedReceipts + page.page.length,
				updatedAt: Date.now()
			});
		} else if (migration.phase === 'networks') {
			const page = await ctx.db
				.query('orgNetworks')
				.order('asc')
				.paginate({
					cursor: migration.cursor ?? null,
					numItems: 4,
					maximumRowsRead: 5,
					maximumBytesRead: COALITION_MIGRATION_PAGE_BYTES
				});
			if (page.pageStatus === 'SplitRequired') {
				return await blockCoalitionMigration(
					ctx,
					migration,
					'COALITION_NETWORK_PAGE_SPLIT_REQUIRED'
				);
			}
			for (const network of page.page) {
				await markCoalitionNetworkDirty(ctx, network._id);
			}
			await ctx.db.patch(migration._id, {
				phase: page.isDone ? 'network_wait' : 'networks',
				cursor: page.isDone ? undefined : page.continueCursor,
				networksScheduled: migration.networksScheduled + page.page.length,
				updatedAt: Date.now()
			});
		} else if (migration.phase === 'network_wait') {
			const page = await ctx.db
				.query('orgNetworks')
				.order('asc')
				.paginate({
					cursor: migration.cursor ?? null,
					numItems: 1,
					maximumRowsRead: 2,
					maximumBytesRead: COALITION_MIGRATION_PAGE_BYTES
				});
			if (page.pageStatus === 'SplitRequired') {
				return await blockCoalitionMigration(
					ctx,
					migration,
					'COALITION_NETWORK_WAIT_PAGE_SPLIT_REQUIRED'
				);
			}
			const network = page.page[0];
			if (network) {
				const aggregate = await ctx.db
					.query('coalitionNetworkAggregates')
					.withIndex('by_networkId', (q) => q.eq('networkId', network._id))
					.unique();
				if (aggregate?.status === 'blocked') {
					return await blockCoalitionMigration(
						ctx,
						migration,
						aggregate.failureCode ?? 'COALITION_NETWORK_REBUILD_BLOCKED',
						String(network._id)
					);
				}
				if (
					aggregate?.status !== 'ready' ||
					aggregate.activeGeneration === undefined ||
					aggregate.dirtyAt !== undefined
				) {
					await markCoalitionNetworkDirty(ctx, network._id);
					if (args.scheduleContinuation !== false) {
						await scheduleCoalitionMigration(ctx, runToken, 100);
					}
					return { status: 'waiting' as const, runToken, networkId: network._id };
				}
			}
			const networksReady = migration.networksReady + page.page.length;
			const done = page.isDone;
			await ctx.db.patch(migration._id, {
				status: done ? 'migrated' : 'running',
				phase: done ? 'complete' : 'network_wait',
				cursor: done ? undefined : page.continueCursor,
				networksReady,
				completedAt: done ? Date.now() : undefined,
				updatedAt: Date.now()
			});
			if (done) {
				return {
					status: 'migrated' as const,
					runToken,
					networksReady
				};
			}
		} else {
			return await blockCoalitionMigration(ctx, migration, 'COALITION_MIGRATION_PHASE_INVALID');
		}

		if (args.scheduleContinuation !== false) {
			await scheduleCoalitionMigration(ctx, runToken);
		}
		return { status: 'running' as const, runToken, phase: migration.phase };
	}
});

/** Explicit cutover: readers stay closed until exact parity is proven. */
export const activateCoalitionMetrics = internalMutation({
	args: {},
	handler: async (ctx) => {
		const migration = await ctx.db
			.query('coalitionMetricsMigrations')
			.withIndex('by_key', (q) => q.eq('key', COALITION_METRICS_MIGRATION_KEY))
			.unique();
		if (migration?.status === 'ready') return { status: 'ready' as const };
		if (!migration || migration.status !== 'migrated' || migration.phase !== 'complete') {
			throw new Error('COALITION_MIGRATION_INCOMPLETE');
		}
		if (
			migration.scannedSupporters !== migration.projectedSupporters ||
			migration.scannedActions !== migration.projectedActions ||
			migration.scannedReceipts !== migration.projectedReceipts ||
			migration.networksScheduled !== migration.networksReady
		) {
			throw new Error('COALITION_MIGRATION_INEXACT');
		}
		await ctx.db.patch(migration._id, { status: 'ready', updatedAt: Date.now() });
		return {
			status: 'ready' as const,
			supporters: migration.projectedSupporters,
			actions: migration.projectedActions,
			receipts: migration.projectedReceipts,
			networks: migration.networksReady
		};
	}
});

export const coalitionMetricsMigrationStatus = internalQuery({
	args: {},
	handler: async (ctx) => {
		const migration = await ctx.db
			.query('coalitionMetricsMigrations')
			.withIndex('by_key', (q) => q.eq('key', COALITION_METRICS_MIGRATION_KEY))
			.unique();
		return migration
			? {
					status: migration.status,
					phase: migration.phase,
					runToken: migration.runToken,
					scannedSupporters: migration.scannedSupporters,
					projectedSupporters: migration.projectedSupporters,
					scannedActions: migration.scannedActions,
					projectedActions: migration.projectedActions,
					scannedReceipts: migration.scannedReceipts,
					projectedReceipts: migration.projectedReceipts,
					networksScheduled: migration.networksScheduled,
					networksReady: migration.networksReady,
					failureCode: migration.failureCode ?? null,
					failureSourceId: migration.failureSourceId ?? null,
					startedAt: migration.startedAt,
					completedAt: migration.completedAt ?? null
				}
			: { status: 'not-started' as const };
	}
});

/**
 * Coalition aggregates are member-only reads. A caller proves access either
 * as a signed-in user whose org is an active member of the network, or as
 * trusted SvelteKit server code presenting the internal secret (the v1 API
 * route authenticates by API key, carries no user identity, and performs its
 * own org-membership proof before calling).
 */
async function requireNetworkAccess(
	ctx: QueryCtx,
	networkId: Id<'orgNetworks'>,
	orgSlug: string | undefined,
	secret: string | undefined
): Promise<void> {
	if (secret !== undefined) {
		// Deliberately before the first database access. An invalid internal
		// credential cannot be amplified into even a one-row Convex read.
		requireInternalSecret(secret);
		return;
	}
	if (!orgSlug) throw new Error('Organization context required');
	const { org } = await requireOrgRole(ctx, orgSlug, 'member');
	const membership = await ctx.db
		.query('orgNetworkMembers')
		.withIndex('by_networkId_orgId', (q) => q.eq('networkId', networkId).eq('orgId', org._id))
		.unique();
	if (membership?.status !== 'active') {
		throw new Error('Access denied — no active membership in this network');
	}
}

/**
 * Constant-read coalition stats. Source cardinality only affects the durable
 * writer/materializer plane; this query reads one readiness row and one active
 * aggregate after authorization.
 */
export const getStats = query({
	args: {
		networkId: v.id('orgNetworks'),
		orgSlug: v.optional(v.string()),
		_secret: v.optional(v.string())
	},
	handler: async (ctx, { networkId, orgSlug, _secret }) => {
		await requireNetworkAccess(ctx, networkId, orgSlug, _secret);
		return await readCoalitionStats(ctx, networkId);
	}
});

/**
 * Constant-read proof-pressure ranking backed by the active immutable
 * generation. The result cap is enforced before the indexed read.
 */
export const getProofPressure = query({
	args: {
		networkId: v.id('orgNetworks'),
		orgSlug: v.optional(v.string()),
		limit: v.optional(v.number()),
		_secret: v.optional(v.string())
	},
	handler: async (ctx, { networkId, orgSlug, limit, _secret }) => {
		await requireNetworkAccess(ctx, networkId, orgSlug, _secret);
		return await readCoalitionPressure(ctx, networkId, limit ?? 12);
	}
});
