import { redirect } from '@sveltejs/kit';
import { db } from '$lib/core/db';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	// Ensure user is authenticated
	if (!locals.user) {
		throw redirect(302, '/');
	}

	// Stream ALL database queries - don't await anything
	const userDetailsPromise = db.user.findUnique({
		where: { id: locals.user.id },
		select: {
			id: true,
			name: true,
			email: true,
			avatar: true,
			// Profile fields
			role: true,
			organization: true,
			location: true,
			connection: true,
			profile_completed_at: true,
			profile_visibility: true,
			// Verification
			is_verified: true,
			verification_method: true,
			verified_at: true,
			district_verified: true,
			// Reputation & trust
			trust_tier: true,
			trust_score: true,
			reputation_tier: true,
			authority_level: true,
			active_months: true,
			templates_contributed: true,
			peer_endorsements: true,
			template_adoption_rate: true,
			// Timestamps
			createdAt: true,
			updatedAt: true
		}
	});

	// Stream heavy data as deferred promises
	const templatesPromise = db.template
		.findMany({
			where: { userId: locals.user.id },
			select: {
				id: true,
				slug: true,
				title: true,
				description: true,
				category: true,
				deliveryMethod: true,
				status: true,
				is_public: true,
				createdAt: true,
				updatedAt: true,
				metrics: true,
				// Template usage analytics
				template_campaign: {
					select: {
						id: true,
						status: true,
						sent_at: true,
						delivered_at: true
					}
				}
			},
			orderBy: { createdAt: 'desc' }
		})
		.then((templates) => {
			// Calculate template statistics after templates load
			const templateStats = templates.reduce(
				(acc, template) => {
					acc.total++;
					if (template.status === 'published') acc.published++;
					if (template.is_public) acc.public++;

					// Count campaigns/uses
					const campaigns = template.template_campaign;
					acc.totalUses += campaigns.length;
					acc.totalSent += campaigns.filter((c) => c.sent_at).length;
					acc.totalDelivered += campaigns.filter((c) => c.delivered_at).length;

					return acc;
				},
				{
					total: 0,
					published: 0,
					public: 0,
					totalUses: 0,
					totalSent: 0,
					totalDelivered: 0
				}
			);

			return { templates, templateStats };
		});

	// Stream representatives data separately
	// DUAL-WRITE: Read from both legacy and DM paths; prefer DM when populated. Remove legacy in S1-07.
	const representativesPromise = db.user
		.findUnique({
			where: { id: locals.user.id },
			select: {
				// DUAL-WRITE: Remove in S1-07
				representatives: {
					where: { is_active: true },
					select: {
						relationship: true,
						representative: {
							select: {
								id: true,
								name: true,
								party: true,
								state: true,
								district: true,
								chamber: true,
								phone: true,
								email: true
							}
						}
					}
				},
				// New DecisionMaker path
				dmRelations: {
					where: { isActive: true },
					select: {
						relationship: true,
						decisionMaker: {
							select: {
								id: true,
								name: true,
								party: true,
								title: true,
								jurisdiction: true,
								district: true,
								phone: true,
								email: true
							}
						}
					}
				}
			}
		})
		.then((result) => {
			if (!result) return [];

			// Transform DM relations to match the expected shape
			const dmReps = result.dmRelations.map((dr: { relationship: string; decisionMaker: Record<string, unknown> }) => {
				const title = (dr.decisionMaker.title as string) ?? '';
				const isSenate = title.toLowerCase().includes('senator') || title.toLowerCase().includes('senate');
				return {
					relationship: dr.relationship,
					id: dr.decisionMaker.id,
					name: dr.decisionMaker.name,
					party: dr.decisionMaker.party ?? '',
					state: dr.decisionMaker.jurisdiction ?? '',
					district: dr.decisionMaker.district ?? '',
					chamber: isSenate ? 'senate' : 'house',
					phone: dr.decisionMaker.phone ?? null,
					email: dr.decisionMaker.email ?? null,
					title,
					jurisdiction: dr.decisionMaker.jurisdiction ?? ''
				};
			});

			// Prefer DM path when populated; fall back to legacy. Remove in S1-07.
			if (dmReps.length > 0) return dmReps;

			return result.representatives.map((ur: { relationship: string; representative: Record<string, unknown> }) => ({
				relationship: ur.relationship,
				...(ur.representative as object)
			}));
		});

	// Return immediately — user from locals (no DB hit), everything else streamed
	return {
		user: {
			id: locals.user.id,
			email: locals.user.email,
			name: locals.user.name,
			avatar: locals.user.avatar,
			trust_tier: locals.user.trust_tier ?? 0
		},
		streamed: {
			userDetails: userDetailsPromise
				.then((user) => {
					if (!user) return null;
					return {
						id: user.id,
						name: user.name,
						email: user.email,
						avatar: user.avatar,
						profile: {
							role: user.role,
							organization: user.organization,
							location: user.location,
							connection: user.connection,
							completed_at: user.profile_completed_at,
							visibility: user.profile_visibility
						},
						verification: {
							is_verified: user.is_verified,
							method: user.verification_method,
							verified_at: user.verified_at,
							district_verified: user.district_verified
						},
						reputation: {
							trust_tier: user.trust_tier,
							trust_score: user.trust_score,
							tier: user.reputation_tier,
							authority_level: user.authority_level,
							active_months: user.active_months,
							templates_contributed: user.templates_contributed,
							template_adoption_rate: user.template_adoption_rate,
							peer_endorsements: user.peer_endorsements
						},
						timestamps: {
							created_at: user.createdAt,
							updated_at: user.updatedAt
						}
					};
				})
				.catch((error) => {
					console.error('[Profile] Activity fetch failed:', error instanceof Error ? error.message : String(error));
					return null;
				}),
			templatesData: templatesPromise.catch((error) => {
				console.error('[Profile] Templates fetch failed:', error instanceof Error ? error.message : String(error));
				return {
					templates: [],
					templateStats: {
						total: 0,
						published: 0,
						public: 0,
						totalUses: 0,
						totalSent: 0,
						totalDelivered: 0
					}
				};
			}),
			representatives: representativesPromise.catch((error) => {
				console.error('[Profile] Representatives fetch failed:', error instanceof Error ? error.message : String(error));
				return [];
			})
		}
	};
};
