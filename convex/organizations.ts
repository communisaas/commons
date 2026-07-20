import {
	query,
	mutation,
	action,
	internalMutation,
	internalQuery,
	type MutationCtx,
	type QueryCtx
} from './_generated/server';
import { internal } from './_generated/api';
import { v } from 'convex/values';
import { requireAuth, requireOrgRole, loadOrg } from './_authHelpers';
import {
	effectivePlan,
	decideAccentWrite,
	logoWriteAllowed,
	whiteLabelWriteAllowed
} from './_brandingGate';
import { capOrThrow, parseHttpUrlOrThrow } from './_validators';
import { sealOrgKey as sealOrgKeyHelper } from './_orgKeyUnseal';
import { emptySupporterStats, computeSupporterStats, visibleSourceCounts } from './_supporterStats';
import { markPublicDiscoveryListDirty } from './lib/publicDiscovery';
import type { Doc, Id } from './_generated/dataModel';
import { requireInternalSecret } from './_internalAuth';
import {
	PUBLIC_ORGANIZATION_DIRECTORY_MIGRATION_KEY,
	PUBLIC_ORGANIZATION_DIRECTORY_PAGE_LIMIT,
	PUBLIC_ORGANIZATION_DIRECTORY_VERSION,
	getPublicOrganizationDirectoryMigration,
	syncPublicOrganizationDirectory,
	writePublicOrganizationProjection
} from './lib/publicOrganizationDirectory';
import {
	CAMPAIGN_ACTIVE_COUNTER_MIGRATION_KEY,
	CAMPAIGN_ACTIVE_COUNTER_VERSION,
	adoptLegacyCampaignCounter
} from './lib/campaignOrgCounters';
import { isAccountabilityReadModelReady } from './lib/accountabilityReadModel';
import {
	boundedOrgSeatLimit,
	MAX_INVITE_RECORDS_PER_ORG,
	MAX_ORG_SEATS
} from './lib/orgConfigurationLimits';
// Billing email: returned as encrypted blob, client decrypts with org key

// =============================================================================
// QUERIES
// =============================================================================

/**
 * Load org by slug for organization workspace pages.
 */
export const getBySlug = query({
	args: { slug: v.string() },
	handler: async (ctx, { slug }) => {
		const { org } = await requireOrgRole(ctx, slug, 'member');

		return {
			_id: org._id,
			name: org.name,
			slug: org.slug,
			description: org.description ?? null,
			avatar: org.avatar ?? null,
			mission: org.mission ?? null,
			websiteUrl: org.websiteUrl ?? null,
			logoUrl: org.logoUrl ?? null,
			isPublic: org.isPublic,
			countryCode: org.countryCode,
			_creationTime: org._creationTime
		};
	}
});

/**
 * Authenticated slug availability check for organization creation.
 */
export const slugExists = query({
	args: { slug: v.string() },
	handler: async (ctx, { slug }) => {
		await requireAuth(ctx);
		const org = await ctx.db
			.query('organizations')
			.withIndex('by_slug', (q) => q.eq('slug', slug))
			.first();
		return !!org;
	}
});

/**
 * Public query: outbound branding for an org by slug. No auth required.
 * Returns ONLY the fields an outbound surface needs to honor white-label
 * (the scorecard embed reads this to decide whether to drop the Commons
 * "powered by"). Coalition-gated at the writer, so these reflect a paid
 * configuration; null org → caller falls back to default Commons chrome.
 * Used by: src/routes/api/embed/scorecard/[id]/+server.ts
 */
export const getPublicBrandingBySlug = query({
	args: { _secret: v.string(), slug: v.string() },
	handler: async (ctx, { _secret, slug }) => {
		requireInternalSecret(_secret);
		const org = await ctx.db
			.query('organizations')
			.withIndex('by_slug', (q) => q.eq('slug', slug))
			.first();
		if (!org) return null;
		return {
			name: org.name,
			brandingAccent: org.brandingAccent ?? null,
			logoUrl: org.logoUrl ?? null,
			whiteLabel: org.whiteLabel ?? false
		};
	}
});

/**
 * SSR-only public organization directory.
 *
 * Reads the compact projection in deterministic name order. The direct Convex
 * surface is secret-gated before any database access; the browser reaches it
 * through `/directory`, which hard-bounds opaque cursors and page size.
 */
export const listPublic = query({
	args: {
		_secret: v.string(),
		paginationOpts: v.object({
			numItems: v.number(),
			cursor: v.union(v.string(), v.null())
		})
	},
	handler: async (ctx, args) => {
		requireInternalSecret(args._secret);
		if (args.paginationOpts.cursor !== null && args.paginationOpts.cursor.length > 2_048) {
			throw new Error('PUBLIC_ORGANIZATION_DIRECTORY_CURSOR_TOO_LARGE');
		}
		if (!Number.isSafeInteger(args.paginationOpts.numItems) || args.paginationOpts.numItems < 1) {
			throw new Error('PUBLIC_ORGANIZATION_DIRECTORY_LIMIT_INVALID');
		}
		const migration = await getPublicOrganizationDirectoryMigration(ctx);
		if (migration?.status !== 'ready') {
			return {
				ready: false as const,
				status: migration?.status ?? 'missing',
				data: [],
				cursor: null,
				hasMore: false,
				total: migration?.total ?? 0,
				revision: null,
				updatedAt: migration?.updatedAt ?? null
			};
		}
		const numItems = Math.min(
			args.paginationOpts.numItems,
			PUBLIC_ORGANIZATION_DIRECTORY_PAGE_LIMIT
		);
		const page = await ctx.db
			.query('publicOrganizationDirectory')
			.withIndex('by_nameSort_orgId')
			.paginate({
				numItems,
				cursor: args.paginationOpts.cursor,
				maximumRowsRead: numItems + 1,
				maximumBytesRead: 512 * 1_024
			});
		return {
			ready: true as const,
			status: 'ready' as const,
			data: page.page.map((o) => ({
				orgId: o.orgId,
				name: o.name,
				slug: o.slug,
				description: o.description ?? null,
				mission: o.mission ?? null,
				avatar: o.avatar ?? null,
				logoUrl: o.logoUrl ?? null,
				supporterCount: o.supporterCount,
				campaignCount: o.campaignCount,
				memberCount: o.memberCount
			})),
			cursor: page.isDone ? null : page.continueCursor,
			hasMore: !page.isDone,
			total: migration.total,
			revision: `${PUBLIC_ORGANIZATION_DIRECTORY_VERSION}:${migration.updatedAt}`,
			updatedAt: migration.updatedAt
		};
	}
});

/**
 * @deprecated The route-owned organization shell superseded this wide payload.
 * Retain the generated API name so stale clients receive an explicit pre-I/O
 * failure instead of rebuilding memberships and user documents.
 */
export const getDashboard = query({
	args: { slug: v.string() },
	handler: async () => {
		throw new Error('ORGANIZATION_DASHBOARD_RETIRED');
	}
});

/**
 * @deprecated The org shell now reads compact workspace projections through
 * `getOrgContext`. Keep the exported name as an explicit tombstone so stale
 * clients fail before database work instead of retaining a 30,003-row read
 * surface.
 */
export const getDashboardStats = query({
	args: { slug: v.string() },
	handler: async () => {
		throw new Error('ORGANIZATION_DASHBOARD_STATS_RETIRED');
	}
});

/** @deprecated Memberships are supplied by compact, route-owned settings reads. */
export const getMembers = query({
	args: { slug: v.string() },
	handler: async () => {
		throw new Error('ORGANIZATION_MEMBERS_QUERY_RETIRED');
	}
});

/**
 * Authenticated query: org context (org + membership) for layout loading.
 * Lighter than getDashboard — returns only what loadOrgContext() provides.
 */
export const getOrgContext = query({
	args: {
		slug: v.string(),
		workspace: v.optional(
			v.union(
				v.literal('base'),
				v.literal('operating'),
				v.literal('landscape'),
				v.literal('return')
			)
		)
	},
	handler: async (ctx, { slug, workspace }) => {
		const { org, membership } = await requireOrgRole(ctx, slug, 'member');
		const supporterStats = org.supporterStats ?? emptySupporterStats();
		const campaignCounterMigration = await ctx.db
			.query('campaignActiveCounterMigrations')
			.withIndex('by_key', (q) => q.eq('key', CAMPAIGN_ACTIVE_COUNTER_MIGRATION_KEY))
			.unique();
		const campaignCountersReady = campaignCounterMigration?.status === 'ready';

		// A canonical workspace may add one purpose-built, bounded read inside
		// this transaction. Deep routes pass no workspace and therefore stop after
		// the four compact exact-index reads above (user, org, membership, marker).
		let workspaceSummary:
			| null
			| {
					kind: 'return';
					campaigns: Array<{
						_id: Id<'campaigns'>;
						title: string;
						type: string;
						status: string;
						actionCount: number;
						verifiedActionCount: number;
						updatedAt: number;
					}>;
					receipts: null | {
						receiptCount: number;
						pendingCount: number;
						responseLoggedCount: number;
						anchorFieldCount: number;
						proofWeightTotal: number;
						latestProofDeliveredAt: number | null;
					};
					campaignCardsReady: boolean;
					readModelReady: boolean;
			  }
			| {
					kind: 'landscape';
					followed: Array<{
						decisionMakerId: Id<'decisionMakers'>;
						reason: string;
						name: string;
						party: string | null;
						title: string | null;
						jurisdiction: string | null;
						district: string | null;
					}>;
					followedReady: boolean;
					followedTruncated: boolean;
					readModelReady: boolean;
			  } = null;

		if (workspace === 'return') {
			const [campaignPage, accountabilityMigration] = await Promise.all([
				ctx.db
					.query('campaigns')
					.withIndex('by_orgId', (q) => q.eq('orgId', org._id))
					.order('desc')
					.paginate({
						cursor: null,
						numItems: 10,
						maximumRowsRead: 11,
						maximumBytesRead: 256 * 1024
					}),
				ctx.db
					.query('accountabilityReadModelMigrations')
					.withIndex('by_key', (q) => q.eq('key', 'v1'))
					.unique()
			]);
			const campaignCardsReady = campaignPage.pageStatus !== 'SplitRequired';
			const campaigns = campaignCardsReady ? campaignPage.page : [];
			const readModelReady = isAccountabilityReadModelReady(accountabilityMigration);
			const receipts = readModelReady
				? await ctx.db
						.query('accountabilityOrganizationAggregates')
						.withIndex('by_orgId', (q) => q.eq('orgId', org._id))
						.unique()
				: null;
			workspaceSummary = {
				kind: 'return',
				campaigns: campaigns.map((campaign) => ({
					_id: campaign._id,
					title: campaign.title,
					type: campaign.type,
					status: campaign.status,
					actionCount: campaign.actionCount ?? 0,
					verifiedActionCount: campaign.verifiedActionCount ?? 0,
					updatedAt: campaign.updatedAt
				})),
				receipts: receipts
					? {
							receiptCount: receipts.receiptCount,
							pendingCount: receipts.pendingCount,
							responseLoggedCount: receipts.responseLoggedCount,
							anchorFieldCount: receipts.anchorFieldCount,
							proofWeightTotal: receipts.proofWeightTotal,
							latestProofDeliveredAt: receipts.latestProofDeliveredAt ?? null
						}
					: readModelReady
						? {
								receiptCount: 0,
								pendingCount: 0,
								responseLoggedCount: 0,
								anchorFieldCount: 0,
								proofWeightTotal: 0,
								latestProofDeliveredAt: null
							}
						: null,
				campaignCardsReady,
				readModelReady
			};
		} else if (workspace === 'landscape') {
			const accountabilityMigration = await ctx.db
				.query('accountabilityReadModelMigrations')
				.withIndex('by_key', (q) => q.eq('key', 'v1'))
				.unique();
			const readModelReady = isAccountabilityReadModelReady(accountabilityMigration);
			const followedPage = readModelReady
				? await ctx.db
						.query('accountabilityOrgDmProjections')
						.withIndex('by_orgId_followed_decisionMakerId', (q) =>
							q.eq('orgId', org._id).eq('followed', true)
						)
						.order('asc')
						.paginate({
							cursor: null,
							numItems: 13,
							maximumRowsRead: 14,
							maximumBytesRead: 256 * 1024
						})
				: null;
			const followedRows =
				followedPage && followedPage.pageStatus !== 'SplitRequired' ? followedPage.page : [];
			const followedReady = Boolean(
				readModelReady && followedPage && followedPage.pageStatus !== 'SplitRequired'
			);
			workspaceSummary = {
				kind: 'landscape',
				followed: followedRows.slice(0, 12).map((row) => ({
					decisionMakerId: row.decisionMakerId,
					reason: row.followReason ?? 'manual',
					name: row.name,
					party: row.party ?? null,
					title: row.title ?? null,
					jurisdiction: row.jurisdiction ?? null,
					district: row.district ?? null
				})),
				followedReady,
				followedTruncated:
					followedPage?.pageStatus === 'SplitRequired' ||
					followedRows.length > 12 ||
					Boolean(followedPage && !followedPage.isDone),
				readModelReady
			};
		}

		return {
			org: {
				_id: org._id,
				name: org.name,
				slug: org.slug,
				description: org.description ?? null,
				avatar: org.avatar ?? null,
				maxSeats: org.maxSeats,
				maxTemplatesMonth: org.maxTemplatesMonth,
				dmCacheTtlDays: org.dmCacheTtlDays ?? 7,
				identityCommitment: org.identityCommitment ?? null,
				brandingAccent: org.brandingAccent ?? null,
				logoUrl: org.logoUrl ?? null,
				whiteLabel: org.whiteLabel ?? false,
				isPublic: org.isPublic,
				_creationTime: org._creationTime
			},
			membership: {
				role: membership.role,
				joinedAt: membership.joinedAt
			},
			// Compact shell badges are write-maintained scalars on the org row.
			// Do not add feature histories here: this query runs for every org
			// route, including deep tools that own their own data loads.
			navBadges: {
				supporters: org.supporterCount ?? 0,
				campaigns: org.campaignCount ?? 0,
				members: org.memberCount ?? 0,
				sentEmails: org.sentEmailCount ?? 0,
				activeCampaigns: campaignCountersReady ? (org.activeCampaignCount ?? 0) : null
			},
			badgeReadiness: {
				campaignCounters: {
					ready: campaignCountersReady,
					status: campaignCounterMigration?.status ?? 'missing'
				}
			},
			supporterSummary: {
				total: org.supporterCount ?? 0,
				identityVerified: supporterStats.identityVerified,
				postalResolved: supporterStats.postalResolved,
				sourceCounts: visibleSourceCounts(supporterStats.sourceCounts),
				emailHealth: {
					subscribed: supporterStats.emailSubscribed,
					unsubscribed: supporterStats.emailUnsubscribed,
					bounced: supporterStats.emailBounced,
					complained: supporterStats.emailComplained
				},
				smsHealth: {
					subscribed: supporterStats.smsSubscribed,
					unsubscribed: supporterStats.smsUnsubscribed,
					stopped: supporterStats.smsStopped,
					none: supporterStats.smsNone,
					phonePresent: supporterStats.phonePresent
				},
				consentEvidence: {
					email: supporterStats.emailConsentEvidence,
					emailSubscribed: supporterStats.emailSubscribedConsentEvidence,
					sms: supporterStats.smsConsentEvidence,
					smsSubscribed: supporterStats.smsSubscribedConsentEvidence
				}
			},
			operatingState: {
				orgKeyConfigured: Boolean(org.orgKeyVerifier),
				platformApi:
					membership.role === 'owner' || membership.role === 'editor'
						? {
								credentialStoredAt: org.anSync?.credentialStoredAt ?? null,
								credentialProbeCompletedAt: org.anSync?.credentialProbeCompletedAt ?? null,
								adapterSource: org.anSync?.adapterSource ?? null
							}
						: null
			},
			workspace: workspaceSummary
		};
	}
});

/**
 * Authenticated query: current user's org memberships for the identity bridge.
 * Used by the root layout to populate user.orgMemberships.
 */
export const getMyMemberships = query({
	args: {
		cursor: v.optional(v.union(v.string(), v.null())),
		limit: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const { userId } = await requireAuth(ctx);
		const limit = Math.min(Math.max(Math.floor(args.limit ?? 12), 1), 24);
		const counterMigration = await ctx.db
			.query('campaignActiveCounterMigrations')
			.withIndex('by_key', (q) => q.eq('key', CAMPAIGN_ACTIVE_COUNTER_MIGRATION_KEY))
			.unique();
		const countersReady = counterMigration?.status === 'ready';

		const page = await ctx.db
			.query('orgMemberships')
			.withIndex('by_userId_orgId', (q) => q.eq('userId', userId))
			.paginate({ numItems: limit, cursor: args.cursor ?? null });

		const rows = await Promise.all(
			page.page.map(async (m) => {
				const org = await ctx.db.get(m.orgId);
				if (!org) return null;

				return {
					orgSlug: org.slug,
					orgName: org.name,
					orgAvatar: org.avatar ?? null,
					role: m.role,
					// Optional until the bounded counter migration reaches its explicit
					// ready cutover. Null is an honest unread state; never substitute a
					// campaign scan on this every-navigation identity shell.
					activeCampaignCount: countersReady ? (org.activeCampaignCount ?? 0) : null
				};
			})
		);

		return {
			data: rows.filter((row): row is NonNullable<typeof row> => row !== null),
			cursor: page.isDone ? null : page.continueCursor,
			hasMore: !page.isDone,
			limit
		};
	}
});

const CAMPAIGN_COUNTER_MIGRATION_PAGE = 64;

/** Marker-safe, self-paging adoption of legacy campaign status counters. */
export const migrateCampaignActiveCounters = internalMutation({
	args: { cursor: v.optional(v.union(v.string(), v.null())) },
	handler: async (ctx, args) => {
		const now = Date.now();
		let migration = await ctx.db
			.query('campaignActiveCounterMigrations')
			.withIndex('by_key', (q) => q.eq('key', CAMPAIGN_ACTIVE_COUNTER_MIGRATION_KEY))
			.unique();
		if (!migration) {
			const id = await ctx.db.insert('campaignActiveCounterMigrations', {
				key: CAMPAIGN_ACTIVE_COUNTER_MIGRATION_KEY,
				status: 'running',
				scanned: 0,
				adopted: 0,
				activeCounted: 0,
				updatedAt: now
			});
			migration = await ctx.db.get(id);
		}
		if (!migration) throw new Error('CAMPAIGN_ACTIVE_COUNTER_MIGRATION_STATE_MISSING');
		if (migration.status === 'ready' || migration.status === 'migrated') return migration;
		if (migration.status === 'blocked') {
			throw new Error(migration.failureCode ?? 'CAMPAIGN_ACTIVE_COUNTER_MIGRATION_BLOCKED');
		}
		if (migration.status === 'pending') {
			await ctx.db.patch(migration._id, { status: 'running', updatedAt: now });
		}
		const expectedCursor = migration.cursor ?? null;
		if ((args.cursor ?? null) !== expectedCursor) {
			throw new Error('CAMPAIGN_ACTIVE_COUNTER_MIGRATION_CURSOR_MISMATCH');
		}

		const page = await ctx.db.query('campaigns').paginate({
			numItems: CAMPAIGN_COUNTER_MIGRATION_PAGE,
			cursor: expectedCursor,
			maximumRowsRead: CAMPAIGN_COUNTER_MIGRATION_PAGE + 1,
			maximumBytesRead: 4 * 1024 * 1024
		});
		let adopted = 0;
		let activeCounted = 0;
		for (const campaign of page.page) {
			if (campaign.orgCounterVersion === CAMPAIGN_ACTIVE_COUNTER_VERSION) continue;
			await adoptLegacyCampaignCounter(ctx, campaign, now);
			adopted += 1;
			if (campaign.status === 'ACTIVE' || campaign.status === 'PAUSED') activeCounted += 1;
		}

		const patch = {
			status: page.isDone ? ('migrated' as const) : ('running' as const),
			cursor: page.isDone ? undefined : page.continueCursor,
			scanned: migration.scanned + page.page.length,
			adopted: migration.adopted + adopted,
			activeCounted: migration.activeCounted + activeCounted,
			updatedAt: now
		};
		await ctx.db.patch(migration._id, patch);
		if (!page.isDone) {
			await ctx.scheduler.runAfter(0, internal.organizations.migrateCampaignActiveCounters, {
				cursor: page.continueCursor
			});
		}
		return { ...migration, ...patch };
	}
});

export const activateCampaignActiveCounters = internalMutation({
	args: {},
	handler: async (ctx) => {
		const migration = await ctx.db
			.query('campaignActiveCounterMigrations')
			.withIndex('by_key', (q) => q.eq('key', CAMPAIGN_ACTIVE_COUNTER_MIGRATION_KEY))
			.unique();
		if (migration?.status === 'ready') return migration;
		if (!migration || migration.status !== 'migrated') {
			throw new Error('CAMPAIGN_ACTIVE_COUNTER_MIGRATION_INCOMPLETE');
		}
		await ctx.db.patch(migration._id, { status: 'ready', updatedAt: Date.now() });
		return { ...migration, status: 'ready' as const };
	}
});

const PUBLIC_ORG_DIRECTORY_MIGRATION_PAGE = 16;

/** Self-paging, idempotent directory materialization. Activation is separate. */
export const migratePublicOrganizationDirectory = internalMutation({
	args: {
		token: v.string(),
		cursor: v.optional(v.union(v.string(), v.null()))
	},
	handler: async (ctx, args) => {
		if (args.token.length < 16 || args.token.length > 128) {
			throw new Error('PUBLIC_ORGANIZATION_DIRECTORY_MIGRATION_TOKEN_INVALID');
		}
		const now = Date.now();
		let migration = await getPublicOrganizationDirectoryMigration(ctx);
		if (!migration) {
			const id = await ctx.db.insert('publicOrganizationDirectoryMigrations', {
				key: PUBLIC_ORGANIZATION_DIRECTORY_MIGRATION_KEY,
				status: 'running',
				token: args.token,
				scanned: 0,
				processed: 0,
				written: 0,
				rejected: 0,
				total: 0,
				updatedAt: now
			});
			migration = await ctx.db.get(id);
		}
		if (!migration) throw new Error('PUBLIC_ORGANIZATION_DIRECTORY_MIGRATION_STATE_MISSING');
		if (migration.token !== args.token) {
			throw new Error('PUBLIC_ORGANIZATION_DIRECTORY_MIGRATION_TOKEN_MISMATCH');
		}
		if (migration.status === 'ready') return migration;
		if (migration.status === 'failed') {
			throw new Error(migration.failureCode ?? 'PUBLIC_ORGANIZATION_DIRECTORY_MIGRATION_FAILED');
		}
		if (migration.scanComplete) return migration;
		const expectedCursor = migration.cursor ?? null;
		if ((args.cursor ?? null) !== expectedCursor) {
			throw new Error('PUBLIC_ORGANIZATION_DIRECTORY_MIGRATION_CURSOR_MISMATCH');
		}

		const page = await ctx.db.query('organizations').paginate({
			numItems: PUBLIC_ORG_DIRECTORY_MIGRATION_PAGE,
			cursor: expectedCursor,
			maximumRowsRead: PUBLIC_ORG_DIRECTORY_MIGRATION_PAGE + 1,
			maximumBytesRead: 4 * 1024 * 1024
		});
		let processed = 0;
		let written = 0;
		let rejected = 0;
		let totalDelta = 0;
		try {
			for (const org of page.page) {
				if (org.publicDirectoryVersion === PUBLIC_ORGANIZATION_DIRECTORY_VERSION) continue;
				const result = await writePublicOrganizationProjection(ctx, org);
				await ctx.db.patch(org._id, {
					publicDirectoryVersion: PUBLIC_ORGANIZATION_DIRECTORY_VERSION
				});
				processed += 1;
				if (result.exists) {
					written += 1;
					totalDelta += 1;
				} else {
					rejected += 1;
				}
			}
		} catch (error) {
			const failureCode =
				error instanceof Error ? error.message.slice(0, 200) : 'DIRECTORY_PROJECTION_WRITE_FAILED';
			await ctx.db.patch(migration._id, { status: 'failed', failureCode, updatedAt: now });
			return { ...migration, status: 'failed' as const, failureCode };
		}

		const patch = {
			status: 'running' as const,
			cursor: page.isDone ? undefined : page.continueCursor,
			scanComplete: page.isDone,
			scanned: migration.scanned + page.page.length,
			processed: migration.processed + processed,
			written: migration.written + written,
			rejected: migration.rejected + rejected,
			total: migration.total + totalDelta,
			updatedAt: now
		};
		await ctx.db.patch(migration._id, patch);
		if (!page.isDone) {
			await ctx.scheduler.runAfter(0, internal.organizations.migratePublicOrganizationDirectory, {
				token: args.token,
				cursor: page.continueCursor
			});
		}
		return { ...migration, ...patch };
	}
});

export const activatePublicOrganizationDirectory = internalMutation({
	args: { token: v.string() },
	handler: async (ctx, args) => {
		const migration = await getPublicOrganizationDirectoryMigration(ctx);
		if (migration?.status === 'ready') return migration;
		if (
			!migration ||
			migration.token !== args.token ||
			migration.status !== 'running' ||
			migration.scanComplete !== true
		) {
			throw new Error('PUBLIC_ORGANIZATION_DIRECTORY_MIGRATION_INCOMPLETE');
		}
		await ctx.db.patch(migration._id, { status: 'ready', updatedAt: Date.now() });
		return { ...migration, status: 'ready' as const };
	}
});

export const getOrganizationProjectionReadiness = query({
	args: { _secret: v.string() },
	handler: async (ctx, args) => {
		requireInternalSecret(args._secret);
		const [directory, counters] = await Promise.all([
			getPublicOrganizationDirectoryMigration(ctx),
			ctx.db
				.query('campaignActiveCounterMigrations')
				.withIndex('by_key', (q) => q.eq('key', CAMPAIGN_ACTIVE_COUNTER_MIGRATION_KEY))
				.unique()
		]);
		return {
			directory: directory
				? {
						status: directory.status,
						ready: directory.status === 'ready',
						total: directory.total,
						failureCode: directory.failureCode ?? null,
						updatedAt: directory.updatedAt
					}
				: { status: 'missing', ready: false, total: 0, failureCode: null, updatedAt: null },
			campaignCounters: counters
				? {
						status: counters.status,
						ready: counters.status === 'ready',
						failureCode: counters.failureCode ?? null,
						updatedAt: counters.updatedAt
					}
				: { status: 'missing', ready: false, failureCode: null, updatedAt: null }
		};
	}
});

// =============================================================================
// MUTATIONS
// =============================================================================

const ROLE_RANK: Record<string, number> = { owner: 3, editor: 2, member: 1 };

/**
 * Remove a member from the organization. Requires owner role. Owners cannot
 * be removed if they are the last remaining owner (would lock out the org).
 * Members may self-leave via the same path.
 */
export const removeMember = mutation({
	args: {
		slug: v.string(),
		membershipId: v.id('orgMemberships')
	},
	handler: async (ctx, { slug, membershipId }) => {
		const { org, membership: actor, userId } = await requireOrgRole(ctx, slug, 'member');

		const target = await ctx.db.get(membershipId);
		if (!target || target.orgId !== org._id) {
			throw new Error('Membership not found');
		}

		const isSelf = target.userId === userId;
		if (!isSelf && actor.role !== 'owner') {
			throw new Error('Only owners can remove other members');
		}

		if (target.role === 'owner') {
			const owners = await ctx.db
				.query('orgMemberships')
				.withIndex('by_orgId_role', (q) => q.eq('orgId', org._id).eq('role', 'owner'))
				.take(2);
			if (owners.length <= 1) {
				throw new Error('Cannot remove the last owner — promote another member to owner first');
			}
		}

		await ctx.db.delete(target._id);
		const currentCount = org.memberCount ?? 1;
		await ctx.db.patch(org._id, {
			memberCount: Math.max(0, currentCount - 1)
		});
		await syncPublicOrganizationDirectory(ctx, org._id);
		return { removed: true as const };
	}
});

/**
 * Change a member's role. Requires owner role. Owners may not self-demote
 * if they are the sole owner — same lockout guard as removal.
 */
export const updateMemberRole = mutation({
	args: {
		slug: v.string(),
		membershipId: v.id('orgMemberships'),
		role: v.union(v.literal('owner'), v.literal('editor'), v.literal('member'))
	},
	handler: async (ctx, { slug, membershipId, role }) => {
		const { org, membership: actor, userId } = await requireOrgRole(ctx, slug, 'owner');

		const target = await ctx.db.get(membershipId);
		if (!target || target.orgId !== org._id) {
			throw new Error('Membership not found');
		}
		if (target.role === role) return { updated: false as const };

		if (target.role === 'owner' && role !== 'owner') {
			const owners = await ctx.db
				.query('orgMemberships')
				.withIndex('by_orgId_role', (q) => q.eq('orgId', org._id).eq('role', 'owner'))
				.take(2);
			if (owners.length <= 1) {
				throw new Error('Cannot demote the last owner — promote another member to owner first');
			}
		}

		// Defense-in-depth: keep the rank ladder simple. Actor must always be at
		// least equal in rank to the new role they're assigning.
		if ((ROLE_RANK[role] ?? 0) > (ROLE_RANK[actor.role] ?? 0)) {
			throw new Error('Cannot assign a role higher than your own');
		}

		void userId; // self-check is implicit in owner-required gate
		await ctx.db.patch(target._id, { role });
		return { updated: true as const };
	}
});

/**
 * Resolve an org's effective billing plan. Only `active`/`trialing`
 * subscriptions count toward a paid tier; anything else (canceled, past_due,
 * none) reads as `free`. Shared by every Coalition-gated branding writer so the
 * gate is enforced in exactly one place.
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

/**
 * Issue a short-lived Convex storage upload URL for an org logo. Coalition-tier
 * gated and editor+ — the caller PUTs the image bytes to the returned URL, then
 * passes the resulting storageId to `setBranding`. Replaces the prior
 * URL-paste-only path so logos are first-class uploads, not arbitrary remote
 * URLs.
 */
export const generateBrandingUploadUrl = mutation({
	args: { slug: v.string() },
	handler: async (ctx, { slug }) => {
		const { org } = await requireOrgRole(ctx, slug, 'editor');
		const plan = await resolveOrgPlan(ctx, org._id);
		if (plan !== 'coalition') {
			throw new Error('Custom branding requires Coalition tier');
		}
		return await ctx.storage.generateUploadUrl();
	}
});

/**
 * Coalition-gated branding writer: accent color, uploaded logo, and the
 * outbound white-label flag. All three fields are Coalition-only (the gate is
 * the single source of truth for who can de-brand outbound surfaces). Editor+
 * role required. Each field is independently optional so the editor can patch
 * one at a time; passing `null` clears accent or logo.
 *
 * White-label is OUTBOUND-ONLY by design — it suppresses Commons chrome on the
 * report email, embed widget, and scorecard embed. It deliberately does NOT
 * touch the /v/[hash] verification page, which keeps its Commons attestation
 * because that page is the independent third-party proof.
 */
export const setBranding = mutation({
	args: {
		slug: v.string(),
		brandingAccent: v.optional(v.union(v.string(), v.null())),
		logoStorageId: v.optional(v.union(v.id('_storage'), v.null())),
		whiteLabel: v.optional(v.boolean())
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.slug, 'editor');
		const plan = await resolveOrgPlan(ctx, org._id);

		const updates: Partial<Doc<'organizations'>> = { updatedAt: Date.now() };
		let touched = false;

		if (args.brandingAccent !== undefined) {
			const decision = decideAccentWrite(plan, args.brandingAccent);
			if (!decision.ok) {
				throw new Error(
					decision.reason === 'tier'
						? 'Custom accent color requires Coalition tier'
						: 'brandingAccent must be a valid hex color (e.g. #0d9488)'
				);
			}
			updates.brandingAccent = decision.cleared ? undefined : decision.value;
			touched = true;
		}

		if (args.logoStorageId !== undefined) {
			if (!logoWriteAllowed(plan, args.logoStorageId === null)) {
				throw new Error('Custom logo requires Coalition tier');
			}
			if (args.logoStorageId === null) {
				updates.logoUrl = undefined;
			} else {
				const url = await ctx.storage.getUrl(args.logoStorageId);
				if (!url) throw new Error('Uploaded logo could not be resolved');
				updates.logoUrl = url;
			}
			touched = true;
		}

		if (args.whiteLabel !== undefined) {
			// whiteLabel=false is always allowed (re-attaching Commons branding).
			if (!whiteLabelWriteAllowed(plan, args.whiteLabel)) {
				throw new Error('White-label requires Coalition tier');
			}
			updates.whiteLabel = args.whiteLabel;
			touched = true;
		}

		if (!touched) throw new Error('No branding fields to update');

		await ctx.db.patch(org._id, updates);
		await syncPublicOrganizationDirectory(ctx, org._id);
		return org._id;
	}
});

/**
 * Privileged publication transition for the public organization directory.
 * The canonical flag and compact projection change atomically, so there is no
 * interval where an unpublished organization remains discoverable.
 */
export const setPublicDirectoryVisibility = mutation({
	args: { slug: v.string(), isPublic: v.boolean() },
	handler: async (ctx, { slug, isPublic }) => {
		const { org } = await requireOrgRole(ctx, slug, 'editor');
		const now = Date.now();
		if (org.isPublic !== isPublic) {
			await ctx.db.patch(org._id, { isPublic, updatedAt: now });
		}
		await syncPublicOrganizationDirectory(ctx, org._id);
		const projection = await ctx.db
			.query('publicOrganizationDirectory')
			.withIndex('by_orgId', (q) => q.eq('orgId', org._id))
			.unique();
		if (isPublic !== Boolean(projection)) {
			throw new Error('PUBLIC_ORGANIZATION_DIRECTORY_VISIBILITY_DIVERGED');
		}
		return { orgId: org._id, isPublic };
	}
});

/**
 * Update org profile fields. Requires editor+ role.
 */
export const update = mutation({
	args: {
		slug: v.string(),
		description: v.optional(v.string()),
		encryptedBillingEmail: v.optional(v.string()),
		billingEmailHash: v.optional(v.string()),
		avatar: v.optional(v.string()),
		mission: v.optional(v.string()),
		websiteUrl: v.optional(v.string()),
		logoUrl: v.optional(v.string()),
		brandingAccent: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.slug, 'editor');
		const avatarChanged = args.avatar !== undefined && args.avatar !== org.avatar;

		const updates: Partial<Doc<'organizations'>> = {
			updatedAt: Date.now()
		};

		if (args.description !== undefined) {
			capOrThrow('description', args.description);
			updates.description = args.description;
		}
		if (args.encryptedBillingEmail !== undefined) {
			updates.encryptedBillingEmail = args.encryptedBillingEmail;
		}
		if (args.billingEmailHash !== undefined) {
			updates.billingEmailHash = args.billingEmailHash;
		}
		if (args.avatar !== undefined) {
			capOrThrow('avatar', args.avatar);
			updates.avatar = args.avatar;
		}
		if (args.mission !== undefined) {
			capOrThrow('mission', args.mission);
			updates.mission = args.mission;
		}
		// websiteUrl is rendered as a clickable link — parse + scheme-allowlist it,
		// not just length-cap, so a javascript:/data: payload can't be stored.
		if (args.websiteUrl !== undefined) {
			updates.websiteUrl = parseHttpUrlOrThrow('websiteUrl', args.websiteUrl);
		}
		if (args.logoUrl !== undefined) {
			capOrThrow('logoUrl', args.logoUrl);
			// Coalition-tier gate — a custom logo is a white-label feature, same gate
			// `setBranding` enforces. Without this, the editor-gated `update`/profile
			// path is a paywall bypass for the logo. Empty string clears it (any tier).
			const plan = await resolveOrgPlan(ctx, org._id);
			if (!logoWriteAllowed(plan, args.logoUrl === '')) {
				throw new Error('Custom logo requires Coalition tier');
			}
			updates.logoUrl = args.logoUrl;
		}
		if (args.brandingAccent !== undefined) {
			// FIX-V4: Coalition-tier gate. brandingAccent (white-label Layer a) is
			// a Coalition plan feature only. Gate + hex validation routed through
			// the shared `decideAccentWrite` helper (same gate as `setBranding`).
			// Empty string is always allowed (clears the override).
			const plan = await resolveOrgPlan(ctx, org._id);
			const decision = decideAccentWrite(plan, args.brandingAccent);
			if (!decision.ok) {
				throw new Error(
					decision.reason === 'tier'
						? 'brandingAccent requires Coalition tier'
						: 'brandingAccent must be a valid hex color (e.g. #0d9488)'
				);
			}
			updates.brandingAccent = decision.cleared ? undefined : decision.value;
		}

		// Update onboarding state if description was set
		if (args.description !== undefined) {
			const currentOnboarding = org.onboardingState ?? {
				hasDescription: false,
				hasIssueDomains: false,
				hasSupporters: false,
				hasCampaigns: false,
				hasTeam: false,
				hasSentEmail: false
			};
			updates.onboardingState = {
				...currentOnboarding,
				hasDescription: !!args.description
			};
		}

		await ctx.db.patch(org._id, updates);
		await syncPublicOrganizationDirectory(ctx, org._id);
		// Public template cards read exactly organization `{ name, slug, avatar }`.
		// This mutation cannot rename an organization or change its slug, so avatar
		// is its only projection-affecting input. Invalidate the one list singleton
		// directly; discovering referencing templates here would turn a profile edit
		// into an unbounded reverse scan. The writer-contract test couples this field
		// inventory to the materializer so adding another public org field fails CI.
		if (avatarChanged) {
			await markPublicDiscoveryListDirty(ctx, 'visibility');
		}
		return org._id;
	}
});

/**
 * Authenticated query: settings page payload.
 * Returns subscription, usage summary, members (with user join), invites, issue domains.
 * Used by: src/routes/org/[slug]/settings/+page.server.ts
 */
export const getSettingsData = query({
	args: { slug: v.string() },
	handler: async (ctx, { slug }) => {
		const { org, membership } = await requireOrgRole(ctx, slug, 'member');
		const seatLimit = boundedOrgSeatLimit(org.maxSeats);

		// Subscription
		const subscriptionRows = await ctx.db
			.query('subscriptions')
			.withIndex('by_orgId', (idx) => idx.eq('orgId', org._id))
			.take(2);
		if (subscriptionRows.length > 1) {
			throw new Error('SUBSCRIPTION_CARDINALITY_REPAIR_REQUIRED');
		}
		const sub = subscriptionRows[0] ?? null;

		// Members with user data
		const memberships = await ctx.db
			.query('orgMemberships')
			.withIndex('by_orgId', (q) => q.eq('orgId', org._id))
			.take(MAX_ORG_SEATS + 1);
		if (memberships.length > seatLimit) {
			throw new Error('ORG_MEMBERSHIP_CARDINALITY_REPAIR_REQUIRED');
		}

		// Sort by joinedAt ascending
		memberships.sort((a, b) => a.joinedAt - b.joinedAt);

		const members = await Promise.all(
			memberships.map(async (m) => {
				const user = await ctx.db.get(m.userId);
				return {
					_id: m._id,
					userId: m.userId,
					name: user?.name ?? null,
					email: user?.email ?? null,
					avatar: user?.avatar ?? null,
					role: m.role,
					joinedAt: m.joinedAt
				};
			})
		);

		// Return the bounded pending register. The route applies wall-clock expiry
		// after this deterministic read, so time passing does not invalidate an
		// otherwise unchanged Convex result.
		const allInvites = await ctx.db
			.query('orgInvites')
			.withIndex('by_orgId', (idx) => idx.eq('orgId', org._id))
			.take(MAX_INVITE_RECORDS_PER_ORG + 1);
		if (allInvites.length > MAX_INVITE_RECORDS_PER_ORG) {
			throw new Error('ORG_INVITE_CARDINALITY_REPAIR_REQUIRED');
		}

		const pendingInvites = allInvites
			.filter((i) => !i.accepted)
			.sort((a, b) => a.expiresAt - b.expiresAt);

		// Only show invite emails to editors/owners
		const invites =
			membership.role === 'editor' || membership.role === 'owner'
				? pendingInvites.map((i) => ({
						_id: i._id,
						encryptedEmail: i.encryptedEmail,
						emailHash: i.emailHash,
						role: i.role,
						expiresAt: i.expiresAt
					}))
				: [];

		// Issue domains
		const issueDomains = await ctx.db
			.query('orgIssueDomains')
			.withIndex('by_orgId', (idx) => idx.eq('orgId', org._id))
			.order('asc')
			.take(MAX_DOMAINS_PER_ORG + 1);
		if (issueDomains.length > MAX_DOMAINS_PER_ORG) {
			throw new Error('ISSUE_DOMAIN_CARDINALITY_REPAIR_REQUIRED');
		}

		// Sort by creation time ascending
		issueDomains.sort((a, b) => a._creationTime - b._creationTime);

		return {
			subscription: sub
				? {
						plan: sub.plan,
						status: sub.status,
						priceCents: sub.priceCents,
						currentPeriodEnd: sub.currentPeriodEnd
					}
				: null,

			usage: {
				verifiedActions: org.verifiedActionsLifetime ?? 0,
				emailsSent: org.sentEmailCount ?? 0
			},

			members,
			invites,

			issueDomains: issueDomains.map((d) => ({
				_id: d._id,
				_creationTime: d._creationTime,
				label: d.label,
				description: d.description ?? null,
				weight: d.weight,
				updatedAt: d.updatedAt
			}))
		};
	}
});

/**
 * Rebuild an org's denormalized DISPLAY counters from the actual rows — the
 * recovery path a denormalized-counter system needs.
 *
 * Pre-launch there is no production data to "backfill"; this exists to (a) correct
 * dev/seed orgs created before the counters existed, and (b) repair drift if a
 * writer ever bypasses applySupporterStatsDelta despite the coverage guard. Run
 * manually per org (compose for many).
 *
 * Bounded by the same scan caps as the reads, so it can never throw the doc cap;
 * for an org past the cap the rebuilt values are the same bounded truth the reads
 * serve. It rebuilds supporterStats / supporterCount / actionTierCounts (the
 * multi-writer, drift-prone counters). It deliberately does NOT touch
 * verifiedActionsLifetime or the billing baseline — those have a single writer
 * (createCampaignAction) and the billing read self-heals off a bounded range, so
 * recomputing them here would risk a baseline-vs-lifetime inconsistency for no gain.
 */
const RECONCILE_SCAN_CAP = 16_000;
export const reconcileOrgStats = internalMutation({
	args: { orgId: v.id('organizations') },
	handler: async (ctx, args) => {
		const org = await ctx.db.get(args.orgId);
		if (!org) return { skipped: true as const };

		const supporters = await ctx.db
			.query('supporters')
			.withIndex('by_orgId', (idx) => idx.eq('orgId', args.orgId))
			.take(RECONCILE_SCAN_CAP);
		let stats = emptySupporterStats();
		for (const s of supporters) stats = computeSupporterStats(stats, null, s);

		const actions = await ctx.db
			.query('campaignActions')
			.withIndex('by_orgId_supporterId', (idx) => idx.eq('orgId', args.orgId))
			.take(RECONCILE_SCAN_CAP);
		const tierCounts = [0, 0, 0, 0, 0];
		for (const a of actions) {
			const t = a.engagementTier;
			if (typeof t === 'number' && t >= 0 && t < 5) tierCounts[t]++;
		}

		await ctx.db.patch(args.orgId, {
			supporterStats: stats,
			supporterCount: supporters.length,
			actionTierCounts: tierCounts
		});
		await syncPublicOrganizationDirectory(ctx, args.orgId);

		return {
			supporterCount: supporters.length,
			truncated: supporters.length >= RECONCILE_SCAN_CAP || actions.length >= RECONCILE_SCAN_CAP
		};
	}
});

/**
 * Internal mutation: update onboarding state from other modules.
 * Called when supporters are added, campaigns created, emails sent, etc.
 */
export const updateOnboardingState = internalMutation({
	args: {
		orgId: v.id('organizations'),
		patch: v.object({
			hasDescription: v.optional(v.boolean()),
			hasIssueDomains: v.optional(v.boolean()),
			hasSupporters: v.optional(v.boolean()),
			hasCampaigns: v.optional(v.boolean()),
			hasTeam: v.optional(v.boolean()),
			hasSentEmail: v.optional(v.boolean())
		})
	},
	handler: async (ctx, { orgId, patch }) => {
		const org = await ctx.db.get(orgId);
		if (!org) throw new Error('Organization not found');

		const current = org.onboardingState ?? {
			hasDescription: !!org.description,
			hasIssueDomains: false,
			hasSupporters: false,
			hasCampaigns: false,
			hasTeam: false,
			hasSentEmail: false
		};

		await ctx.db.patch(orgId, {
			onboardingState: { ...current, ...patch },
			updatedAt: Date.now()
		});
	}
});

// =============================================================================
// ORG CREATE
// =============================================================================

/**
 * Create a new organization. The authenticated user becomes the owner.
 */
export const create = mutation({
	args: {
		name: v.string(),
		slug: v.string(),
		description: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const { userId } = await requireAuth(ctx);

		if (!args.name || !args.slug) {
			throw new Error('name and slug are required');
		}

		if (!/^[a-z0-9-]+$/.test(args.slug) || args.slug.length < 2 || args.slug.length > 48) {
			throw new Error('slug must be 2-48 lowercase alphanumeric characters or hyphens');
		}

		capOrThrow('name', args.name);
		if (args.description !== undefined) capOrThrow('description', args.description);

		// Check slug uniqueness
		const existing = await ctx.db
			.query('organizations')
			.withIndex('by_slug', (q) => q.eq('slug', args.slug))
			.first();

		if (existing) {
			throw new Error('An organization with this slug already exists');
		}

		const now = Date.now();
		const nowDate = new Date(now);
		const calendarPeriodStart = Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth(), 1);

		const orgId = await ctx.db.insert('organizations', {
			name: args.name,
			slug: args.slug,
			description: args.description ?? undefined,
			// A new org has no subscription, so it starts on the gated `inactive`
			// floor: owner-only seat + 2 templates (author a campaign or two to
			// experience the product). Delivery + scale unlock on subscribe; the
			// Stripe webhook syncs these to the paid tier's limits. Mirrors
			// PLANS.inactive at src/lib/server/billing/plans.ts.
			maxSeats: 1,
			maxTemplatesMonth: 2,
			dmCacheTtlDays: 7,
			countryCode: 'US',
			isPublic: false,
			supporterCount: 0,
			districtVerifiedSupporterCount: 0,
			supporterStats: emptySupporterStats(),
			campaignCount: 0,
			activeCampaignCount: 0,
			memberCount: 1,
			sentEmailCount: 0,
			smsSentCount: 0,
			verifiedActionsLifetime: 0,
			verifiedActionsPeriodBaseline: 0,
			verifiedActionsPeriodBaselineAt: calendarPeriodStart,
			sentEmailPeriodBaseline: 0,
			sentEmailPeriodBaselineAt: calendarPeriodStart,
			emailReservedCount: 0,
			emailReservationPeriodStart: calendarPeriodStart,
			emailReservationState: 'ready',
			smsSentPeriodBaseline: 0,
			smsSentPeriodBaselineAt: calendarPeriodStart,
			updatedAt: now
		});
		await syncPublicOrganizationDirectory(ctx, orgId);

		// Create owner membership
		await ctx.db.insert('orgMemberships', {
			userId,
			orgId,
			role: 'owner',
			joinedAt: now
		});

		return { _id: orgId, slug: args.slug };
	}
});

// =============================================================================
// ISSUE DOMAINS
// =============================================================================

const MAX_DOMAINS_PER_ORG = 20;
const RESERVED_LABELS = ['__alert_preferences__'];

/**
 * List issue domains for an org.
 */
export const listIssueDomains = query({
	args: { slug: v.string() },
	handler: async (ctx, { slug }) => {
		const { org } = await requireOrgRole(ctx, slug, 'member');

		const domains = await ctx.db
			.query('orgIssueDomains')
			.withIndex('by_orgId', (q) => q.eq('orgId', org._id))
			.order('asc')
			.take(MAX_DOMAINS_PER_ORG + 1);

		if (domains.length > MAX_DOMAINS_PER_ORG) {
			throw new Error('ISSUE_DOMAIN_CARDINALITY_REPAIR_REQUIRED');
		}

		return {
			domains: domains.map((d) => ({
				_id: d._id,
				label: d.label,
				description: d.description ?? null,
				weight: d.weight,
				createdAt: d._creationTime,
				updatedAt: d.updatedAt
			}))
		};
	}
});

/**
 * Create a new issue domain. Requires editor+ role.
 */
export const createIssueDomain = mutation({
	args: {
		slug: v.string(),
		label: v.string(),
		description: v.optional(v.string()),
		weight: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.slug, 'editor');

		const label = args.label?.trim();
		if (!label || label.length > 100) {
			throw new Error('Label is required (max 100 chars)');
		}
		const description = args.description?.trim();
		if (description && description.length > 500) {
			throw new Error('Description must be 500 characters or fewer');
		}

		if (RESERVED_LABELS.some((r) => label.startsWith(r))) {
			throw new Error('This label is reserved');
		}

		const weight = args.weight ?? 1.0;
		if (!Number.isFinite(weight) || weight < 0.5 || weight > 2.0) {
			throw new Error('Weight must be between 0.5 and 2.0');
		}

		// Check domain count limit
		const existingDomains = await ctx.db
			.query('orgIssueDomains')
			.withIndex('by_orgId', (q) => q.eq('orgId', org._id))
			.take(MAX_DOMAINS_PER_ORG + 1);

		if (existingDomains.length >= MAX_DOMAINS_PER_ORG) {
			throw new Error(`Maximum of ${MAX_DOMAINS_PER_ORG} issue domains per organization`);
		}

		// Check for duplicate label
		const duplicate = await ctx.db
			.query('orgIssueDomains')
			.withIndex('by_orgId_label', (q) => q.eq('orgId', org._id).eq('label', label))
			.first();

		if (duplicate) {
			throw new Error('An issue domain with this label already exists');
		}

		const now = Date.now();
		const domainId = await ctx.db.insert('orgIssueDomains', {
			orgId: org._id,
			label,
			description: description || undefined,
			weight,
			updatedAt: now
		});

		// Update onboarding state
		const onboarding = org.onboardingState ?? {
			hasDescription: false,
			hasIssueDomains: false,
			hasSupporters: false,
			hasCampaigns: false,
			hasTeam: false,
			hasSentEmail: false
		};
		await ctx.db.patch(org._id, {
			onboardingState: { ...onboarding, hasIssueDomains: true },
			updatedAt: now
		});

		const domain = await ctx.db.get(domainId);
		return {
			_id: domainId,
			label: domain!.label,
			description: domain!.description ?? null,
			weight: domain!.weight,
			createdAt: domain!._creationTime,
			updatedAt: domain!.updatedAt
		};
	}
});

/**
 * Update an issue domain. Requires editor+ role.
 */
export const updateIssueDomain = mutation({
	args: {
		slug: v.string(),
		domainId: v.id('orgIssueDomains'),
		label: v.optional(v.string()),
		description: v.optional(v.string()),
		weight: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.slug, 'editor');

		const existing = await ctx.db.get(args.domainId);
		if (!existing || existing.orgId !== org._id) {
			throw new Error('Issue domain not found');
		}

		const patch: Record<string, unknown> = { updatedAt: Date.now() };

		if (args.label !== undefined) {
			const label = args.label.trim();
			if (!label || label.length > 100) {
				throw new Error('Label is required (max 100 chars)');
			}
			if (RESERVED_LABELS.some((r) => label.startsWith(r))) {
				throw new Error('This label is reserved');
			}
			// Check duplicate on label change
			if (label !== existing.label) {
				const dup = await ctx.db
					.query('orgIssueDomains')
					.withIndex('by_orgId_label', (q) => q.eq('orgId', org._id).eq('label', label))
					.first();
				if (dup) {
					throw new Error('An issue domain with this label already exists');
				}
			}
			patch.label = label;
		}

		if (args.description !== undefined) {
			patch.description = args.description || undefined;
		}

		if (args.weight !== undefined) {
			if (args.weight < 0.5 || args.weight > 2.0) {
				throw new Error('Weight must be between 0.5 and 2.0');
			}
			patch.weight = args.weight;
		}

		if (Object.keys(patch).length <= 1) {
			throw new Error('No fields to update');
		}

		await ctx.db.patch(args.domainId, patch);

		const updated = await ctx.db.get(args.domainId);
		return {
			_id: args.domainId,
			label: updated!.label,
			description: updated!.description ?? null,
			weight: updated!.weight,
			createdAt: updated!._creationTime,
			updatedAt: updated!.updatedAt
		};
	}
});

/**
 * Delete an issue domain. Requires editor+ role.
 */
export const deleteIssueDomain = mutation({
	args: {
		slug: v.string(),
		domainId: v.id('orgIssueDomains')
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.slug, 'editor');

		const existing = await ctx.db.get(args.domainId);
		if (!existing || existing.orgId !== org._id) {
			throw new Error('Issue domain not found');
		}

		if (RESERVED_LABELS.some((r) => existing.label.startsWith(r))) {
			throw new Error('Cannot delete reserved domain');
		}

		await ctx.db.delete(args.domainId);
		return { ok: true };
	}
});

// =============================================================================
// PLATFORM API SYNC / CREDENTIAL CUSTODY
// =============================================================================

/**
 * Get stored platform API adapter state from the org document.
 *
 * The storage slot is the legacy `anSync` object for compatibility with older
 * data, but the public contract is platform-neutral: a stored credential is
 * custody evidence only until a paginated adapter runner is armed.
 */
export const getPlatformApiState = query({
	args: { slug: v.string() },
	handler: async (ctx, { slug }) => {
		const { org } = await requireOrgRole(ctx, slug, 'editor');
		return org.anSync ?? null;
	}
});

/**
 * Save a platform API credential after SvelteKit has encrypted it.
 *
 * This does not start an import and does not imply that any vendor runner is
 * armed. It records custody state so the org can see the platform boundary has
 * advanced from "no credential" to "credential stored, runner gated".
 */
export const connectPlatformApiCredential = mutation({
	args: {
		slug: v.string(),
		encryptedApiKey: v.string(),
		adapterSource: v.string(),
		credentialStoredAt: v.number(),
		credentialVersion: v.string()
	},
	handler: async (
		ctx,
		{ slug, encryptedApiKey, adapterSource, credentialStoredAt, credentialVersion }
	) => {
		const { org } = await requireOrgRole(ctx, slug, 'editor');
		await ctx.db.patch(org._id, {
			anSync: {
				apiKey: encryptedApiKey,
				adapterSource,
				credentialStoredAt,
				credentialVersion,
				status: 'credential_stored',
				syncType: 'credential-only',
				totalResources: 0,
				processedResources: 0,
				imported: 0,
				updated: 0,
				skipped: 0
			}
		});
		return { connected: true };
	}
});

/**
 * Record that SvelteKit successfully opened the encrypted credential envelope
 * for this org/profile. This is custody proof only: no vendor API was called
 * and no people were imported.
 */
export const recordPlatformApiCredentialProbe = mutation({
	args: {
		slug: v.string(),
		adapterSource: v.string(),
		credentialVersion: v.string(),
		probedAt: v.number()
	},
	handler: async (ctx, { slug, adapterSource, credentialVersion, probedAt }) => {
		const { org } = await requireOrgRole(ctx, slug, 'editor');
		const existing = org.anSync;
		if (!existing) {
			throw new Error(
				'No platform credential configured. Store a credential before probing custody.'
			);
		}
		if (existing.adapterSource && existing.adapterSource !== adapterSource) {
			throw new Error('Stored platform credential source does not match the opened envelope.');
		}

		// A parked or resumable run keeps its lifecycle fields: probing custody
		// mid-run must not flip status/syncType and break checkpoint resume.
		const runParked =
			existing.status === 'running' || (existing.status === 'failed' && !!existing.checkpoint);
		await ctx.db.patch(org._id, {
			anSync: runParked
				? {
						...existing,
						adapterSource,
						credentialVersion,
						credentialProbeCompletedAt: probedAt,
						credentialProbeVersion: credentialVersion
					}
				: {
						...existing,
						adapterSource,
						credentialVersion,
						credentialProbeCompletedAt: probedAt,
						credentialProbeVersion: credentialVersion,
						status: 'credential_probe_complete',
						syncType: 'credential-probe',
						currentResource: 'credential-envelope',
						completedAt: probedAt
					}
		});
		return { probed: true, probedAt };
	}
});

/**
 * Claim a sync run for the bounded platform import runner. SvelteKit opens the
 * credential and fetches vendor pages; this mutation only manages run state.
 * `resume` continues from a persisted checkpoint; a fresh run resets counters.
 */
export const startPlatformApiSync = mutation({
	args: {
		slug: v.string(),
		syncType: v.union(v.literal('full'), v.literal('incremental')),
		resume: v.boolean()
	},
	handler: async (ctx, { slug, syncType, resume }) => {
		const { org } = await requireOrgRole(ctx, slug, 'editor');
		const existing = org.anSync;
		if (!existing) {
			throw new Error('No platform credential configured. Store a credential before syncing.');
		}
		if (resume && !existing.checkpoint) {
			throw new Error('No continuation checkpoint to resume. Start a new sync instead.');
		}
		// A 'running' row with a checkpoint is a parked slice boundary. A
		// running row without one is either a slice currently in flight or a
		// run whose process died before its first checkpoint; slices are
		// bounded to a few vendor pages, so anything older than the claim
		// window is reclaimable rather than wedged behind an owner-only
		// credential disconnect.
		const STALE_SYNC_CLAIM_MS = 10 * 60 * 1000;
		const startedAt = Date.now();
		if (existing.status === 'running' && !existing.checkpoint && !resume) {
			const claimAge = startedAt - (existing.startedAt ?? 0);
			if (claimAge < STALE_SYNC_CLAIM_MS) {
				throw new Error('A sync is already in progress.');
			}
		}
		await ctx.db.patch(org._id, {
			anSync: resume
				? { ...existing, status: 'running', syncType, startedAt: existing.startedAt ?? startedAt }
				: {
						...existing,
						status: 'running',
						syncType,
						startedAt,
						checkpoint: undefined,
						totalResources: 0,
						processedResources: 0,
						currentResource: undefined,
						imported: 0,
						updated: 0,
						skipped: 0,
						errors: undefined
					}
		});
		return { started: true, resumed: resume, lastSyncAt: existing.lastSyncAt ?? null };
	}
});

/**
 * Persist a continuation checkpoint between bounded slices. Counters are
 * absolute (the route reads current state and adds its slice results).
 */
export const recordPlatformApiSyncProgress = mutation({
	args: {
		slug: v.string(),
		processedResources: v.number(),
		totalResources: v.number(),
		imported: v.number(),
		updated: v.number(),
		skipped: v.number(),
		checkpoint: v.string(),
		currentResource: v.optional(v.string()),
		rowErrors: v.optional(v.array(v.string()))
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.slug, 'editor');
		const existing = org.anSync;
		if (!existing || existing.status !== 'running') {
			throw new Error('No running sync to checkpoint.');
		}
		await ctx.db.patch(org._id, {
			anSync: {
				...existing,
				processedResources: args.processedResources,
				totalResources: args.totalResources,
				imported: args.imported,
				updated: args.updated,
				skipped: args.skipped,
				checkpoint: args.checkpoint,
				currentResource: args.currentResource,
				errors: args.rowErrors?.length ? args.rowErrors.slice(0, 20) : existing.errors
			}
		});
		return { checkpointed: true };
	}
});

/**
 * Complete a sync run. `lastSyncAt` is set to the run's start time so the next
 * incremental sync also catches records modified while this run was fetching.
 */
export const completePlatformApiSync = mutation({
	args: {
		slug: v.string(),
		processedResources: v.number(),
		totalResources: v.number(),
		imported: v.number(),
		updated: v.number(),
		skipped: v.number(),
		rowErrors: v.optional(v.array(v.string()))
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.slug, 'editor');
		const existing = org.anSync;
		if (!existing || existing.status !== 'running') {
			throw new Error('No running sync to complete.');
		}
		const completedAt = Date.now();
		await ctx.db.patch(org._id, {
			anSync: {
				...existing,
				processedResources: args.processedResources,
				totalResources: args.totalResources,
				imported: args.imported,
				updated: args.updated,
				skipped: args.skipped,
				status: 'completed',
				checkpoint: undefined,
				currentResource: undefined,
				lastSyncAt: existing.startedAt ?? completedAt,
				completedAt,
				errors: args.rowErrors?.length ? args.rowErrors.slice(0, 20) : existing.errors
			}
		});
		return { completed: true, completedAt };
	}
});

/**
 * Mark a sync run failed. The checkpoint is preserved so a rate-limited or
 * transiently failing run can resume instead of refetching from page one.
 */
export const failPlatformApiSync = mutation({
	args: { slug: v.string(), errorMessage: v.string() },
	handler: async (ctx, { slug, errorMessage }) => {
		const { org } = await requireOrgRole(ctx, slug, 'editor');
		const existing = org.anSync;
		if (!existing) {
			throw new Error('No platform sync state to fail.');
		}
		// Only a running run can be failed: a racer that lost a
		// complete/record conflict must not stomp a terminal state.
		if (existing.status !== 'running') {
			return { failed: false, ignored: true };
		}
		await ctx.db.patch(org._id, {
			anSync: {
				...existing,
				status: 'failed',
				errors: [errorMessage]
			}
		});
		return { failed: true };
	}
});

/**
 * Disconnect platform API credential state. Imported people are not deleted.
 */
export const disconnectPlatformApiCredential = mutation({
	args: { slug: v.string() },
	handler: async (ctx, { slug }) => {
		const { org } = await requireOrgRole(ctx, slug, 'owner');
		await ctx.db.patch(org._id, { anSync: undefined });
		return { disconnected: true };
	}
});

// =============================================================================
// ORG MEMBERSHIP LOOKUP (for billing plan checks)
// =============================================================================

/**
 * Get user's org membership with subscription plan.
 */
export const getUserOrgPlan = query({
	args: {},
	handler: async () => {
		throw new Error('ORGANIZATION_USER_PLAN_QUERY_RETIRED');
	}
});

// =============================================================================
// BILLING — Checkout helpers
// =============================================================================

/**
 * Get org context for billing checkout (org + membership + subscription + billing info).
 * Requires owner role.
 */
export const getBillingContext = query({
	args: { slug: v.string() },
	handler: async (ctx, { slug }) => {
		const { org, membership } = await requireOrgRole(ctx, slug, 'owner');

		const subscriptionRows = await ctx.db
			.query('subscriptions')
			.withIndex('by_orgId', (idx) => idx.eq('orgId', org._id))
			.take(2);
		if (subscriptionRows.length > 1) {
			throw new Error('SUBSCRIPTION_CARDINALITY_REPAIR_REQUIRED');
		}
		const sub = subscriptionRows[0] ?? null;

		return {
			org: {
				_id: org._id,
				slug: org.slug,
				stripeCustomerId: org.stripeCustomerId ?? null,
				encryptedBillingEmail: org.encryptedBillingEmail ?? null
			},
			membership: { role: membership.role },
			subscription: sub ? { plan: sub.plan, status: sub.status } : null
		};
	}
});

/**
 * Update Stripe customer ID on org.
 */
/**
 * Update Stripe customer ID on org. Requires owner role.
 * Called from the checkout route after creating a Stripe customer.
 */
export const updateStripeCustomerId = mutation({
	args: {
		orgId: v.id('organizations'),
		slug: v.string(),
		stripeCustomerId: v.string()
	},
	handler: async (ctx, { orgId, slug, stripeCustomerId }) => {
		// Authorize by caller-supplied slug before touching an attacker-selected
		// org ID, then bind the authorized row back to that ID.
		const { org } = await requireOrgRole(ctx, slug, 'owner');
		if (org._id !== orgId) throw new Error('Organization not found');

		await ctx.db.patch(orgId, { stripeCustomerId });
	}
});

/**
 * Get the org key verifier for passphrase validation.
 * Used by client-direct blast flow to verify the admin's passphrase.
 * Requires editor+ role.
 */
export const getOrgKeyVerifier = query({
	args: { slug: v.string() },
	handler: async (ctx, { slug }) => {
		const { org, membership } = await requireOrgRole(ctx, slug, 'editor');
		return {
			orgKeyVerifier: org.orgKeyVerifier ?? null,
			hasRecoveryKey: Boolean(org.recoveryWrappedOrgKey),
			// Only return the wrapped key to owners (needed for recovery flow)
			recoveryWrappedOrgKey:
				membership.role === 'owner' ? (org.recoveryWrappedOrgKey ?? null) : null,
			piiVersion: org.piiVersion ?? 'legacy'
		};
	}
});

/**
 * Set org encryption passphrase — creates verifier, stores recovery + server-sealed keys.
 * Called once during org encryption setup. Requires owner role.
 */
export const setOrgKeyVerifier = mutation({
	args: {
		slug: v.string(),
		orgKeyVerifier: v.string(),
		recoveryWrappedOrgKey: v.string(),
		serverSealedOrgKey: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.slug, 'owner');

		if (org.orgKeyVerifier) {
			throw new Error('Org encryption already configured. Use key rotation instead.');
		}

		await ctx.db.patch(org._id, {
			orgKeyVerifier: args.orgKeyVerifier,
			recoveryWrappedOrgKey: args.recoveryWrappedOrgKey,
			...(args.serverSealedOrgKey ? { serverSealedOrgKey: args.serverSealedOrgKey } : {}),
			piiVersion: 'legacy',
			updatedAt: Date.now()
		});
	}
});

/**
 * Seal the org key with the server wrapping key.
 * Called during org encryption setup — client sends raw key bytes,
 * server wraps them so automated operations can encrypt/decrypt PII.
 */
export const sealOrgKey = action({
	args: {
		slug: v.string(),
		rawKeyBase64: v.string()
	},
	handler: async (ctx, args) => {
		// action-boundary length caps. AES-256 raw key base64 = 44
		// chars; 128 is generous slack with no realistic legitimate exceedance.
		if (args.slug.length > 64) throw new Error('SLUG_TOO_LARGE');
		if (args.rawKeyBase64.length > 128) throw new Error('RAW_KEY_TOO_LARGE');

		// Verify caller is org owner via query
		const orgData = await ctx.runQuery(internal.organizations.verifyOwner, {
			slug: args.slug
		});
		if (!orgData) throw new Error('Not authorized or org not found');

		const sealedBlob = await sealOrgKeyHelper(args.rawKeyBase64, orgData.orgId);

		await ctx.runMutation(internal.organizations.patchServerSealedKey, {
			orgId: orgData.orgId,
			serverSealedOrgKey: sealedBlob
		});

		return { sealed: true };
	}
});

/**
 * Rotate the org encryption passphrase. Overwrites verifier, recovery key,
 * and server-sealed key. The underlying AES key doesn't change — only the
 * passphrase wrapping changes. Owner-only.
 */
export const rotateOrgPassphrase = mutation({
	args: {
		slug: v.string(),
		orgKeyVerifier: v.string(),
		recoveryWrappedOrgKey: v.string()
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.slug, 'owner');

		if (!org.orgKeyVerifier) {
			throw new Error('Org encryption not configured. Use setup instead.');
		}

		await ctx.db.patch(org._id, {
			orgKeyVerifier: args.orgKeyVerifier,
			recoveryWrappedOrgKey: args.recoveryWrappedOrgKey,
			updatedAt: Date.now()
		});
	}
});

/**
 * Internal query: read org record by ID. Used by _orgKeyUnseal.ts
 * in action contexts where ctx.db is not available.
 */
export const getOrgById = internalQuery({
	args: { orgId: v.id('organizations') },
	handler: async (ctx, { orgId }) => {
		const org = await ctx.db.get(orgId);
		if (!org) return null;
		return {
			_id: org._id,
			serverSealedOrgKey: org.serverSealedOrgKey ?? null
		};
	}
});

/**
 * Internal query: verify the authenticated user is an owner of the org.
 * Used by actions that can't call requireOrgRole directly.
 */
export const verifyOwner = internalQuery({
	args: { slug: v.string() },
	handler: async (ctx, { slug }) => {
		const { org } = await requireOrgRole(ctx, slug, 'owner');
		return { orgId: org._id };
	}
});

export const patchServerSealedKey = internalMutation({
	args: {
		orgId: v.id('organizations'),
		serverSealedOrgKey: v.string()
	},
	handler: async (ctx, args) => {
		await ctx.db.patch(args.orgId, {
			serverSealedOrgKey: args.serverSealedOrgKey,
			updatedAt: Date.now()
		});
	}
});

// =============================================================================
// TWILIO NUMBER REGISTRY
// =============================================================================

/**
 * List the Twilio numbers registered for this org. Owner-only — exposes
 * which inbound destination numbers route STOP/START to which org.
 */
export const listTwilioNumbers = query({
	args: { slug: v.string() },
	handler: async () => {
		throw new Error('ORGANIZATION_TWILIO_NUMBER_LIST_RETIRED');
	}
});

/**
 * Register a Twilio destination number for this org. Owner-only. Refuses
 * if another org already registered the same number (per-application
 * uniqueness enforcement — Convex has no native unique index).
 *
 * `verifiedAt` is null at registration; a future verification step can
 * wire the Twilio webhook signature against an owner-controlled secret
 * to flip the verified bit. Until then, registration alone scopes START
 * correctly but operators should audit the registry for unverified rows.
 */
export const registerTwilioNumber = mutation({
	args: {
		slug: v.string(),
		phoneNumber: v.string()
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.slug, 'owner');

		// E.164 sanity check — match the supporters phone normalization
		// contract so a registered number actually compares equal to the
		// `To` field on inbound webhooks (which Twilio sends in E.164).
		const trimmed = args.phoneNumber.trim();
		if (!trimmed.startsWith('+')) {
			throw new Error('PHONE_NUMBER_MUST_START_WITH_PLUS');
		}
		const digits = trimmed.slice(1).replace(/\D/g, '');
		if (digits.length < 7 || digits.length > 15) {
			throw new Error('PHONE_NUMBER_NOT_E164');
		}
		const normalized = '+' + digits;
		if (normalized.length > 32) {
			throw new Error('PHONE_NUMBER_TOO_LARGE');
		}

		// Cross-org uniqueness: only one org may own a given Twilio number.
		// Shared-pool numbers should not be registered — the inbound SMS
		// webhook treats multi-match as ambiguous and falls back to cross-
		// org behavior, so registering a shared number would defeat scoping.
		const existing = await ctx.db
			.query('orgTwilioNumbers')
			.withIndex('by_phoneNumber', (q) => q.eq('phoneNumber', normalized))
			.first();
		if (existing) {
			if (String(existing.orgId) === String(org._id)) {
				return { _id: existing._id, alreadyRegistered: true };
			}
			throw new Error('PHONE_NUMBER_OWNED_BY_OTHER_ORG');
		}

		const _id = await ctx.db.insert('orgTwilioNumbers', {
			orgId: org._id,
			phoneNumber: normalized,
			verifiedAt: undefined,
			updatedAt: Date.now()
		});
		return { _id, alreadyRegistered: false };
	}
});

/**
 * Remove a Twilio number from the org's registry. Owner-only. After
 * removal, inbound STOP/START on that number falls back to cross-org
 * resubscribe (matches pre-registry behavior). Deleted numbers can be
 * re-registered.
 */
export const unregisterTwilioNumber = mutation({
	args: {
		slug: v.string(),
		twilioNumberId: v.id('orgTwilioNumbers')
	},
	handler: async (ctx, args) => {
		const { org } = await requireOrgRole(ctx, args.slug, 'owner');
		const existing = await ctx.db.get(args.twilioNumberId);
		if (!existing || String(existing.orgId) !== String(org._id)) {
			throw new Error('TWILIO_NUMBER_NOT_FOUND');
		}
		await ctx.db.delete(existing._id);
		return { ok: true };
	}
});
