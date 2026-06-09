import { query, mutation, action, internalMutation, internalQuery } from './_generated/server';
import { internal } from './_generated/api';
import { v } from 'convex/values';
import { requireAuth, requireOrgRole, loadOrg } from './_authHelpers';
import type { Doc, Id } from './_generated/dataModel';
// Billing email: returned as encrypted blob, client decrypts with org key

// =============================================================================
// QUERIES
// =============================================================================

/**
 * Public query: load org by slug. No auth required.
 */
export const getBySlug = query({
	args: { slug: v.string() },
	handler: async (ctx, { slug }) => {
		const org = await ctx.db
			.query('organizations')
			.withIndex('by_slug', (q) => q.eq('slug', slug))
			.first();

		if (!org) return null;

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
 * Public paginated list of orgs (isPublic: true). No auth required.
 * Returns public-safe fields only. Manual offset pagination (no cursor).
 * Used by: src/routes/directory/+page.server.ts
 */
export const listPublic = query({
	args: {
		limit: v.optional(v.number()),
		offset: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const limit = Math.min(args.limit ?? 20, 50);
		const offset = Math.max(args.offset ?? 0, 0);

		// Collect all public orgs (filtered in-memory since there's no by_isPublic index)
		const allOrgs = await ctx.db.query('organizations').collect();
		const publicOrgs = allOrgs.filter((o) => o.isPublic);

		// Sort alphabetically by name
		publicOrgs.sort((a, b) => a.name.localeCompare(b.name));

		const total = publicOrgs.length;
		const page = publicOrgs.slice(offset, offset + limit);

		return {
			orgs: page.map((o) => ({
				_id: o._id,
				name: o.name,
				slug: o.slug,
				description: o.description ?? null,
				mission: o.mission ?? null,
				avatar: o.avatar ?? null,
				logoUrl: o.logoUrl ?? null,
				supporterCount: o.supporterCount ?? 0,
				campaignCount: o.campaignCount ?? 0,
				memberCount: o.memberCount ?? 0
			})),
			total,
			limit,
			offset
		};
	}
});

/**
 * Authenticated query: full dashboard payload.
 * Reads denormalized counters from org doc + recent campaigns/supporters/members.
 */
export const getDashboard = query({
	args: { slug: v.string() },
	handler: async (ctx, { slug }) => {
		const { org, membership, userId } = await requireOrgRole(ctx, slug, 'member');

		// Recent campaigns (take 10, most recently updated first)
		const recentCampaigns = await ctx.db
			.query('campaigns')
			.withIndex('by_orgId', (q) => q.eq('orgId', org._id))
			.order('desc')
			.take(10);

		// Recent supporters (take 5, most recently created first)
		const recentSupporters = await ctx.db
			.query('supporters')
			.withIndex('by_orgId', (q) => q.eq('orgId', org._id))
			.order('desc')
			.take(5);

		// Team members: memberships + user lookups
		const memberships = await ctx.db
			.query('orgMemberships')
			.withIndex('by_orgId', (q) => q.eq('orgId', org._id))
			.collect();

		const members = await Promise.all(
			memberships.map(async (m) => {
				const user = await ctx.db.get(m.userId);
				return {
					_id: m._id,
					userId: m.userId,
					role: m.role,
					joinedAt: m.joinedAt,
					userName: user?.name ?? null,
					userEmail: user?.email ?? null,
					userAvatar: user?.avatar ?? null
				};
			})
		);

		const onboardingState = org.onboardingState ?? {
			hasDescription: !!org.description,
			hasIssueDomains: false,
			hasSupporters: (org.supporterCount ?? 0) > 0,
			hasCampaigns: (org.campaignCount ?? 0) > 0,
			hasTeam: (org.memberCount ?? 0) > 1,
			hasSentEmail: (org.sentEmailCount ?? 0) > 0
		};

		const onboardingComplete =
			onboardingState.hasSupporters && onboardingState.hasCampaigns && onboardingState.hasSentEmail;

		return {
			org: {
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
				maxSeats: org.maxSeats,
				maxTemplatesMonth: org.maxTemplatesMonth,
				identityCommitment: org.identityCommitment ?? null,
				_creationTime: org._creationTime
			},

			membership: {
				role: membership.role,
				joinedAt: membership.joinedAt
			},

			stats: {
				supporters: org.supporterCount ?? 0,
				campaigns: org.campaignCount ?? 0,
				members: org.memberCount ?? 0,
				sentEmails: org.sentEmailCount ?? 0
			},

			recentCampaigns: recentCampaigns.map((c) => ({
				_id: c._id,
				title: c.title,
				type: c.type,
				status: c.status,
				actionCount: c.actionCount ?? 0,
				verifiedActionCount: c.verifiedActionCount ?? 0,
				updatedAt: c.updatedAt
			})),

			recentSupporters: recentSupporters.map((s) => ({
				_id: s._id,
				encryptedName: s.encryptedName ?? null,
				source: s.source ?? null,
				verified: s.verified,
				emailStatus: s.emailStatus,
				_creationTime: s._creationTime
			})),

			members,

			encryptedBillingEmail:
				membership.role === 'owner' ? (org.encryptedBillingEmail ?? null) : null,

			onboardingState,
			onboardingComplete
		};
	}
});

/**
 * Dashboard stats: funnel, engagement-tier histogram, growth. Held separately
 * from `getDashboard` because these aggregates scan supporters + actions and
 * we don't want them slowing the main load.
 *
 * - funnel: total imported people → postal resolved → district verified →
 *   identity verified. imported/postalResolved/identityVerified are supporter-level;
 *   districtVerified counts distinct supporters with at least one action carrying
 *   a districtHash (the strongest district-of-record signal we hold).
 * - tiers: action-level engagementTier histogram (T0 New ... T4 Pillar). Page
 *   labels confirm this is the engagement axis, not the identity-trust axis.
 * - growth: verified actions this week vs last week.
 */
export const getDashboardStats = query({
	args: { slug: v.string() },
	handler: async (ctx, { slug }) => {
		const { org } = await requireOrgRole(ctx, slug, 'member');

		const supporters = await ctx.db
			.query('supporters')
			.withIndex('by_orgId', (q) => q.eq('orgId', org._id))
			.collect();

		let imported = 0;
		let postalResolved = 0;
		let identityVerified = 0;
		for (const s of supporters) {
			imported++;
			if (s.postalCode) postalResolved++;
			if (s.identityCommitment && s.verified) identityVerified++;
		}

		// campaignActions are denormalized with orgId — use it.
		const actions = await ctx.db
			.query('campaignActions')
			.withIndex('by_orgId_verified', (q) => q.eq('orgId', org._id))
			.collect();

		const supportersWithDistrict = new Set<string>();
		const tierCounts = [0, 0, 0, 0, 0];
		const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
		const now = Date.now();
		let verifiedThisWeek = 0;
		let verifiedLastWeek = 0;
		for (const a of actions) {
			if (a.districtHash && a.supporterId) {
				supportersWithDistrict.add(a.supporterId);
			}
			const t = a.engagementTier;
			if (typeof t === 'number' && t >= 0 && t <= 4) {
				tierCounts[t]++;
			}
			if (a.verified) {
				const age = now - a.sentAt;
				if (age <= WEEK_MS) verifiedThisWeek++;
				else if (age <= 2 * WEEK_MS) verifiedLastWeek++;
			}
		}

		const TIER_LABELS = ['New', 'Active', 'Established', 'Veteran', 'Pillar'];
		const tiers = tierCounts.map((count, tier) => ({
			tier,
			label: TIER_LABELS[tier],
			count
		}));

		return {
			funnel: {
				imported,
				postalResolved,
				identityVerified,
				districtVerified: supportersWithDistrict.size
			},
			tiers,
			growth: {
				thisWeek: verifiedThisWeek,
				lastWeek: verifiedLastWeek
			}
		};
	}
});

/**
 * Authenticated query: org members with user details.
 */
export const getMembers = query({
	args: { slug: v.string() },
	handler: async (ctx, { slug }) => {
		const { org } = await requireOrgRole(ctx, slug, 'member');

		const memberships = await ctx.db
			.query('orgMemberships')
			.withIndex('by_orgId', (q) => q.eq('orgId', org._id))
			.collect();

		return await Promise.all(
			memberships.map(async (m) => {
				const user = await ctx.db.get(m.userId);
				return {
					_id: m._id,
					userId: m.userId,
					role: m.role,
					joinedAt: m.joinedAt,
					invitedBy: m.invitedBy ?? null,
					userName: user?.name ?? null,
					userEmail: user?.email ?? null,
					userAvatar: user?.avatar ?? null
				};
			})
		);
	}
});

/**
 * Authenticated query: org context (org + membership) for layout loading.
 * Lighter than getDashboard — returns only what loadOrgContext() provides.
 */
export const getOrgContext = query({
	args: { slug: v.string() },
	handler: async (ctx, { slug }) => {
		const { org, membership } = await requireOrgRole(ctx, slug, 'member');

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
				_creationTime: org._creationTime
			},
			membership: {
				role: membership.role,
				joinedAt: membership.joinedAt
			}
		};
	}
});

/**
 * Authenticated query: current user's org memberships for the identity bridge.
 * Used by the root layout to populate user.orgMemberships.
 */
export const getMyMemberships = query({
	args: {},
	handler: async (ctx) => {
		const { userId } = await requireAuth(ctx);

		const memberships = await ctx.db
			.query('orgMemberships')
			.withIndex('by_userId_orgId', (q) => q.eq('userId', userId))
			.collect();

		return await Promise.all(
			memberships.map(async (m) => {
				const org = await ctx.db.get(m.orgId);
				if (!org) return null;

				// Count active campaigns for this org
				const campaigns = await ctx.db
					.query('campaigns')
					.withIndex('by_orgId', (q) => q.eq('orgId', m.orgId))
					.collect();
				const activeCampaignCount = campaigns.filter(
					(c) => c.status === 'ACTIVE' || c.status === 'PAUSED'
				).length;

				return {
					orgSlug: org.slug,
					orgName: org.name,
					orgAvatar: org.avatar ?? null,
					role: m.role,
					activeCampaignCount
				};
			})
		).then((results) => results.filter(Boolean));
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
				.withIndex('by_orgId', (q) => q.eq('orgId', org._id))
				.collect()
				.then((rows) => rows.filter((m) => m.role === 'owner'));
			if (owners.length <= 1) {
				throw new Error('Cannot remove the last owner — promote another member to owner first');
			}
		}

		await ctx.db.delete(target._id);
		const currentCount = org.memberCount ?? 1;
		await ctx.db.patch(org._id, {
			memberCount: Math.max(0, currentCount - 1)
		});
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
				.withIndex('by_orgId', (q) => q.eq('orgId', org._id))
				.collect()
				.then((rows) => rows.filter((m) => m.role === 'owner'));
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

		const updates: Partial<Doc<'organizations'>> = {
			updatedAt: Date.now()
		};

		if (args.description !== undefined) updates.description = args.description;
		if (args.encryptedBillingEmail !== undefined) {
			updates.encryptedBillingEmail = args.encryptedBillingEmail;
		}
		if (args.billingEmailHash !== undefined) {
			updates.billingEmailHash = args.billingEmailHash;
		}
		if (args.avatar !== undefined) updates.avatar = args.avatar;
		if (args.mission !== undefined) updates.mission = args.mission;
		if (args.websiteUrl !== undefined) updates.websiteUrl = args.websiteUrl;
		if (args.logoUrl !== undefined) updates.logoUrl = args.logoUrl;
		if (args.brandingAccent !== undefined) {
			// FIX-V4: Coalition-tier gate. brandingAccent (white-label Layer a) is
			// a Coalition plan feature only. v2 spec said 'Coalition-tier gate
			// enforced at organizations.update boundary' but the original v2
			// shipped only hex-format validation. Plan check added here.
			// Empty string is always allowed (clears the override).
			if (args.brandingAccent !== '') {
				const sub = await ctx.db
					.query('subscriptions')
					.withIndex('by_orgId', (q) => q.eq('orgId', org._id))
					.first();
				const plan =
					sub?.status === 'active' || sub?.status === 'trialing' ? (sub.plan ?? 'free') : 'free';
				if (plan !== 'coalition') {
					throw new Error('brandingAccent requires Coalition tier');
				}
			}
			const hexPattern = /^#?[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/;
			if (args.brandingAccent === '' || hexPattern.test(args.brandingAccent)) {
				updates.brandingAccent = args.brandingAccent === '' ? undefined : args.brandingAccent;
			} else {
				throw new Error('brandingAccent must be a valid hex color (e.g. #0d9488)');
			}
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

		// Subscription
		const sub = await ctx.db
			.query('subscriptions')
			.withIndex('by_orgId', (idx) => idx.eq('orgId', org._id))
			.first();

		// Members with user data
		const memberships = await ctx.db
			.query('orgMemberships')
			.withIndex('by_orgId', (q) => q.eq('orgId', org._id))
			.collect();

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

		// Invites (active only: not accepted, not expired)
		const now = Date.now();
		const allInvites = await ctx.db
			.query('orgInvites')
			.withIndex('by_orgId', (idx) => idx.eq('orgId', org._id))
			.collect();

		const activeInvites = allInvites
			.filter((i) => !i.accepted && i.expiresAt > now)
			.sort((a, b) => a.expiresAt - b.expiresAt)
			.slice(0, 200);

		// Only show invite emails to editors/owners
		const invites =
			membership.role === 'editor' || membership.role === 'owner'
				? activeInvites.map((i) => ({
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
			.collect();

		// Sort by creation time ascending
		issueDomains.sort((a, b) => a._creationTime - b._creationTime);

		// Usage counts (approximate — counts from denormalized fields + queries)
		// Verified actions: count campaignActions with verified=true for this org's campaigns
		const campaigns = await ctx.db
			.query('campaigns')
			.withIndex('by_orgId', (q) => q.eq('orgId', org._id))
			.collect();

		let verifiedActions = 0;
		for (const c of campaigns) {
			verifiedActions += c.verifiedActionCount ?? 0;
		}

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
				verifiedActions,
				emailsSent: org.sentEmailCount ?? 0
			},

			members,
			invites,

			issueDomains: issueDomains.slice(0, 500).map((d) => ({
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

		// Check slug uniqueness
		const existing = await ctx.db
			.query('organizations')
			.withIndex('by_slug', (q) => q.eq('slug', args.slug))
			.first();

		if (existing) {
			throw new Error('An organization with this slug already exists');
		}

		const now = Date.now();

		const orgId = await ctx.db.insert('organizations', {
			name: args.name,
			slug: args.slug,
			description: args.description ?? undefined,
			maxSeats: 2,
			maxTemplatesMonth: 10,
			dmCacheTtlDays: 7,
			countryCode: 'US',
			isPublic: false,
			supporterCount: 0,
			campaignCount: 0,
			memberCount: 1,
			sentEmailCount: 0,
			smsSentCount: 0,
			updatedAt: now
		});

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
			.collect();

		// Sort by _creationTime ascending
		domains.sort((a, b) => a._creationTime - b._creationTime);

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

		if (RESERVED_LABELS.some((r) => label.startsWith(r))) {
			throw new Error('This label is reserved');
		}

		const weight = args.weight ?? 1.0;
		if (weight < 0.5 || weight > 2.0) {
			throw new Error('Weight must be between 0.5 and 2.0');
		}

		// Check domain count limit
		const existingDomains = await ctx.db
			.query('orgIssueDomains')
			.withIndex('by_orgId', (q) => q.eq('orgId', org._id))
			.collect();

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
			description: args.description || undefined,
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
			throw new Error('No platform credential configured. Store a credential before probing custody.');
		}
		if (existing.adapterSource && existing.adapterSource !== adapterSource) {
			throw new Error('Stored platform credential source does not match the opened envelope.');
		}

		await ctx.db.patch(org._id, {
			anSync: {
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
 * Legacy adapter-named wrappers retained for callers that still reference the
 * old Action Network sync name. New route code should use the platform-neutral
 * functions above.
 */
export const getAnSync = query({
	args: { slug: v.string() },
	handler: async (ctx, { slug }) => {
		const { org } = await requireOrgRole(ctx, slug, 'editor');
		return org.anSync ?? null;
	}
});

export const connectAnSync = mutation({
	args: { slug: v.string(), encryptedApiKey: v.string() },
	handler: async (ctx, { slug, encryptedApiKey }) => {
		const { org } = await requireOrgRole(ctx, slug, 'editor');
		const now = Date.now();
		await ctx.db.patch(org._id, {
			anSync: {
				apiKey: encryptedApiKey,
				adapterSource: 'action_network',
				credentialStoredAt: now,
				credentialVersion: 'legacy-an-sync',
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
 * Start AN sync — set status to running, return API key.
 */
export const startAnSync = mutation({
	args: { slug: v.string(), syncType: v.string() },
	handler: async (ctx, { slug, syncType }) => {
		const { org } = await requireOrgRole(ctx, slug, 'editor');
		const existing = org.anSync;
		if (!existing) throw new Error('No API key configured. Please connect first.');
		if (existing.status === 'running') throw new Error('A sync is already in progress.');

		await ctx.db.patch(org._id, {
			anSync: {
				...existing,
				status: 'running',
				syncType,
				startedAt: Date.now()
			}
		});
		return { apiKey: existing.apiKey, lastSyncAt: existing.lastSyncAt ?? null };
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

export const disconnectAnSync = mutation({
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
	handler: async (ctx) => {
		const { userId } = await requireAuth(ctx);
		const membership = await ctx.db
			.query('orgMemberships')
			.withIndex('by_userId_orgId', (idx) => idx.eq('userId', userId))
			.first();
		if (!membership) return null;
		const org = await ctx.db.get(membership.orgId);
		if (!org) return null;
		// Get subscription
		const sub = await ctx.db
			.query('subscriptions')
			.withIndex('by_orgId', (idx) => idx.eq('orgId', org._id))
			.first();
		return {
			orgId: org._id,
			orgSlug: org.slug,
			plan: sub?.plan ?? 'free'
		};
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

		const sub = await ctx.db
			.query('subscriptions')
			.withIndex('by_orgId', (idx) => idx.eq('orgId', org._id))
			.first();

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
		stripeCustomerId: v.string()
	},
	handler: async (ctx, { orgId, stripeCustomerId }) => {
		// Security: verify the caller is an owner of this org
		const org = await ctx.db.get(orgId);
		if (!org) throw new Error('Organization not found');
		await requireOrgRole(ctx, org.slug, 'owner');

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

		const { sealOrgKey: seal } = await import('./_orgKeyUnseal');
		const sealedBlob = await seal(args.rawKeyBase64, orgData.orgId);

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
	handler: async (ctx, { slug }) => {
		const { org } = await requireOrgRole(ctx, slug, 'owner');
		const rows = await ctx.db
			.query('orgTwilioNumbers')
			.withIndex('by_orgId', (q) => q.eq('orgId', org._id))
			.collect();
		return rows.map((r) => ({
			_id: r._id,
			phoneNumber: r.phoneNumber,
			verifiedAt: r.verifiedAt ?? null,
			updatedAt: r.updatedAt
		}));
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
