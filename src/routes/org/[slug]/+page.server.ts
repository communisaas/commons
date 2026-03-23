import { db } from '$lib/core/db';
import { computeOrgVerificationPacket } from '$lib/server/campaigns/verification';
import { FEATURES } from '$lib/config/features';
import { maskEmail } from '$lib/server/org/mask';
import { tryDecryptSupporterEmail } from '$lib/core/crypto/user-pii-encryption';
import { loadOrgBilling } from '$lib/server/org';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
	const { org, membership } = await parent();

	const [
		// Verification funnel counts
		totalSupporters,
		postalResolvedCount,
		verifiedCount,
		districtVerifiedCount,

		// Tier distribution (engagement tiers from campaign actions)
		tierGroups,

		// Campaign list with action counts (includes verified count in single query)
		campaigns,

		// Verification packet (coordination integrity)
		packet,

		// Recent activity
		recentActions,
		recentSupporters,

		// Endorsed templates
		endorsedTemplates,

		// Template count
		templateCount,

		// Onboarding state (I1: moved into main Promise.all)
		teamCount,
		sentEmailCount,
		issueDomainCount,

		// I2: Verified action counts per campaign
		verifiedActionGroups,

		// Growth: verified actions this week vs last week
		verifiedThisWeek,
		verifiedLastWeek,

		// Email status breakdown for effective reach
		emailStatusGroups,

		// Legislative alerts
		legislativeAlerts,

		// Intelligence loop: followed reps
		followedRepCount,
		followedRepsTop,

		// Intelligence loop: watched bills
		watchedBillCount,
		watchedBillsTop,

		// Billing email for onboarding checklist
		orgBilling
	] = await Promise.all([
		// Total supporters
		db.supporter.count({ where: { orgId: org.id } }),

		// Postal-resolved: have a postal code
		db.supporter.count({
			where: { orgId: org.id, postalCode: { not: null } }
		}),

		// Identity-verified: have identity commitment
		db.supporter.count({
			where: { orgId: org.id, verified: true }
		}),

		// District-verified: supporters that have taken a verified campaign action
		db.campaignAction.groupBy({
			by: ['supporterId'],
			where: {
				campaign: { orgId: org.id },
				verified: true,
				supporterId: { not: null }
			},
			_count: { id: true }
		}).then(rows => rows.length),

		// Tier distribution from campaign actions
		db.campaignAction.groupBy({
			by: ['engagementTier'],
			where: { campaign: { orgId: org.id } },
			_count: { id: true }
		}),

		// I2: Campaigns with both total and verified action counts in single query
		// Prisma _count only allows one filter per relation, so we use verified-only
		// and compute total from a parallel groupBy below
		db.campaign.findMany({
			where: { orgId: org.id },
			orderBy: { updatedAt: 'desc' },
			take: 10,
			select: {
				id: true,
				title: true,
				type: true,
				status: true,
				updatedAt: true,
				_count: {
					select: {
						actions: true
					}
				}
			}
		}),

		// Org-wide packet
		computeOrgVerificationPacket(org.id),

		// B1: Recent actions — select only name, mask email server-side
		db.campaignAction.findMany({
			where: {
				campaign: { orgId: org.id }
			},
			orderBy: { createdAt: 'desc' },
			take: 10,
			select: {
				id: true,
				verified: true,
				engagementTier: true,
				createdAt: true,
				campaign: { select: { title: true } },
				supporter: { select: { id: true, name: true, encrypted_email: true } }
			}
		}),

		// B1: Recent supporter signups — select only name, decrypt email server-side
		db.supporter.findMany({
			where: { orgId: org.id },
			orderBy: { createdAt: 'desc' },
			take: 5,
			select: {
				id: true,
				name: true,
				encrypted_email: true,
				source: true,
				verified: true,
				createdAt: true
			}
		}),

		// Endorsed templates
		db.templateEndorsement.findMany({
			where: { orgId: org.id },
			include: {
				template: {
					select: {
						id: true, slug: true, title: true, description: true,
						verified_sends: true, unique_districts: true
					}
				}
			},
			orderBy: { endorsedAt: 'desc' },
			take: 50
		}),

		// Template count
		db.template.count({ where: { orgId: org.id } }),

		// I1: Onboarding queries — now in main Promise.all
		db.orgMembership.count({ where: { orgId: org.id } }),
		db.emailBlast.count({ where: { orgId: org.id, status: 'sent' } }),
		db.orgIssueDomain.count({
			where: { orgId: org.id, label: { not: '__alert_preferences__' } }
		}),

		// I2: Verified action counts per campaign (org-wide, no dependency on campaign IDs)
		db.campaignAction.groupBy({
			by: ['campaignId'],
			where: {
				campaign: { orgId: org.id },
				verified: true
			},
			_count: { id: true }
		}),

		// Growth: verified actions this week
		db.campaignAction.count({
			where: {
				campaign: { orgId: org.id },
				verified: true,
				createdAt: { gte: new Date(Date.now() - 7 * 86400000) }
			}
		}),

		// Growth: verified actions last week
		db.campaignAction.count({
			where: {
				campaign: { orgId: org.id },
				verified: true,
				createdAt: {
					gte: new Date(Date.now() - 14 * 86400000),
					lt: new Date(Date.now() - 7 * 86400000)
				}
			}
		}),

		// Email status breakdown for effective reach
		db.supporter.groupBy({
			by: ['emailStatus'],
			where: { orgId: org.id },
			_count: { id: true }
		}),

		// Legislative alerts (pending, sorted by urgency then recency)
		FEATURES.LEGISLATION
			? db.legislativeAlert.findMany({
					where: { orgId: org.id, status: 'pending' },
					orderBy: [{ createdAt: 'desc' }],
					take: 5,
					include: {
						bill: {
							select: {
								id: true,
								title: true,
								status: true,
								relevances: {
									where: { orgId: org.id },
									select: { score: true },
									take: 1
								}
							}
						}
					}
				})
			: Promise.resolve([]),

		// Followed decision-makers (count + top 5)
		FEATURES.LEGISLATION
			? db.orgDMFollow.count({ where: { orgId: org.id } })
			: Promise.resolve(0),
		FEATURES.LEGISLATION
			? db.orgDMFollow.findMany({
					where: { orgId: org.id },
					orderBy: { followedAt: 'desc' },
					take: 5,
					include: {
						decisionMaker: {
							select: { id: true, name: true, party: true, jurisdiction: true }
						}
					}
				})
			: Promise.resolve([]),

		// Watched bills (count + top 5)
		FEATURES.LEGISLATION
			? db.orgBillWatch.count({ where: { orgId: org.id } })
			: Promise.resolve(0),
		FEATURES.LEGISLATION
			? db.orgBillWatch.findMany({
					where: { orgId: org.id },
					orderBy: { createdAt: 'desc' },
					take: 5,
					include: {
						bill: {
							select: { id: true, title: true, status: true }
						}
					}
				})
			: Promise.resolve([]),

		// Billing email for onboarding checklist (loaded separately from org context)
		loadOrgBilling(org.id)
	]);

	// I2: Build verified action count map from parallel query
	const verifiedActionCounts: Record<string, number> = Object.fromEntries(
		verifiedActionGroups.map(g => [g.campaignId, g._count.id])
	);

	// Build tier distribution map
	const TIER_LABELS: Record<number, string> = {
		0: 'New', 1: 'Active', 2: 'Established', 3: 'Veteran', 4: 'Pillar'
	};
	const tiers = [0, 1, 2, 3, 4].map(tier => ({
		tier,
		label: TIER_LABELS[tier],
		count: tierGroups.find(g => g.engagementTier === tier)?._count?.id ?? 0
	}));

	const activeCampaignCount = campaigns.filter(c => c.status === 'ACTIVE').length;

	const onboardingState = {
		hasDescription: !!org.description,
		hasIssueDomains: issueDomainCount > 0,
		hasSupporters: totalSupporters > 0,
		hasCampaigns: campaigns.length > 0,
		hasTeam: teamCount > 1,
		hasSentEmail: sentEmailCount > 0,
		postalResolvedCount,
		totalSupporters,
		topCampaignId: (campaigns.find(c => c.status === 'ACTIVE') || campaigns[0])?.id ?? null
	};

	const onboardingComplete = onboardingState.hasSupporters && onboardingState.hasCampaigns && onboardingState.hasSentEmail;

	return {
		// Verification funnel
		funnel: {
			imported: totalSupporters,
			postalResolved: postalResolvedCount,
			identityVerified: verifiedCount,
			districtVerified: districtVerifiedCount
		},

		// Tier distribution
		tiers,

		// Campaign list
		campaigns: campaigns.map(c => ({
			id: c.id,
			title: c.title,
			type: c.type,
			status: c.status,
			totalActions: c._count.actions,
			verifiedActions: verifiedActionCounts[c.id] ?? 0,
			updatedAt: c.updatedAt.toISOString()
		})),

		// Top campaign (first active, or first overall)
		topCampaignId: (campaigns.find(c => c.status === 'ACTIVE') || campaigns[0])?.id ?? null,

		// Stats
		stats: {
			supporters: totalSupporters,
			campaigns: campaigns.length,
			templates: templateCount,
			activeCampaigns: activeCampaignCount
		},

		// Effective reach: email status breakdown
		emailReach: {
			subscribed: emailStatusGroups.find(g => g.emailStatus === 'subscribed')?._count?.id ?? 0,
			unsubscribed: emailStatusGroups.find(g => g.emailStatus === 'unsubscribed')?._count?.id ?? 0,
			bounced: emailStatusGroups.find(g => g.emailStatus === 'bounced')?._count?.id ?? 0,
			complained: emailStatusGroups.find(g => g.emailStatus === 'complained')?._count?.id ?? 0,
			total: totalSupporters
		},

		// Packet
		packet,

		// B1: Recent activity — emails decrypted and masked server-side, never sent raw to client
		recentActivity: await (async () => {
			const actionItems = await Promise.all(recentActions.map(async a => {
				let label = 'Anonymous';
				if (a.supporter?.name) {
					label = a.supporter.name;
				} else if (a.supporter?.encrypted_email) {
					const email = await tryDecryptSupporterEmail(a.supporter).catch(() => null);
					if (email) label = maskEmail(email);
				}
				return {
					type: 'action' as const,
					id: a.id,
					label,
					detail: a.campaign.title,
					verified: a.verified,
					tier: a.engagementTier,
					timestamp: a.createdAt.toISOString()
				};
			}));
			const signupItems = await Promise.all(recentSupporters.map(async s => {
				let label = s.name ?? 'Anonymous';
				if (!s.name && s.encrypted_email) {
					const email = await tryDecryptSupporterEmail(s).catch(() => null);
					if (email) label = maskEmail(email);
				}
				return {
					type: 'signup' as const,
					id: s.id,
					label,
					detail: s.source ?? 'organic',
					verified: s.verified,
					tier: 0,
					timestamp: s.createdAt.toISOString()
				};
			}));
			return [...actionItems, ...signupItems]
				.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
				.slice(0, 10);
		})(),

		// Endorsed templates
		endorsedTemplates: endorsedTemplates.map(e => ({
			id: e.id,
			templateId: e.template.id,
			slug: e.template.slug,
			title: e.template.title,
			description: e.template.description,
			sends: e.template.verified_sends,
			districts: e.template.unique_districts,
			endorsedAt: e.endorsedAt.toISOString()
		})),

		// Verification growth rate
		growth: {
			thisWeek: verifiedThisWeek,
			lastWeek: verifiedLastWeek
		},

		// Billing email (for onboarding checklist only)
		billingEmail: ['admin', 'owner'].includes(membership.role) ? orgBilling.billing_email : null,

		// Onboarding
		onboardingState,
		onboardingComplete,

		// Intelligence loop: followed decision-makers
		followedReps: {
			count: followedRepCount,
			top: followedRepsTop.map((f: typeof followedRepsTop[number]) => ({
				id: f.decisionMaker.id,
				name: f.decisionMaker.name,
				party: f.decisionMaker.party,
				jurisdiction: f.decisionMaker.jurisdiction
			}))
		},

		// Intelligence loop: watched bills
		watchedBills: {
			count: watchedBillCount,
			top: watchedBillsTop.map((w: typeof watchedBillsTop[number]) => ({
				id: w.bill.id,
				title: w.bill.title,
				status: w.bill.status,
				position: w.position
			}))
		},

		// Legislative alerts
		legislativeAlerts: legislativeAlerts.map((a: typeof legislativeAlerts[number]) => ({
			id: a.id,
			type: a.type,
			title: a.title,
			summary: a.summary,
			urgency: a.urgency,
			status: a.status,
			createdAt: a.createdAt.toISOString(),
			bill: {
				id: a.bill.id,
				title: a.bill.title,
				status: a.bill.status,
				relevanceScore: a.bill.relevances[0]?.score ?? null
			}
		}))
	};
};
