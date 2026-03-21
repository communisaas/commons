import type { LayoutServerLoad } from './$types';
import { db } from '$lib/core/db';
export const load: LayoutServerLoad = async ({ locals, depends }) => {
	// Cache user data across navigations — only re-fetch when explicitly invalidated
	depends('data:user');

	if (!locals.user) {
		return { user: null };
	}

	// Fetch user with representatives data + org memberships in parallel
	try {
		const [userWithRepresentatives, orgMemberships] = await Promise.all([
			db.user.findUnique({
				where: { id: locals.user.id },
				include: {
					// DUAL-WRITE: Remove in S1-07
					representatives: {
						include: {
							representative: {
								select: {
									name: true,
									party: true,
									chamber: true,
									state: true,
									district: true,
									is_active: true
								}
							}
						},
						where: {
							is_active: true
						}
					},
					// New DecisionMaker path via UserDMRelation
					dmRelations: {
						include: {
							decisionMaker: {
								select: {
									name: true,
									party: true,
									title: true,
									jurisdiction: true,
									district: true,
									active: true
								}
							}
						},
						where: {
							isActive: true
						}
					}
				}
			}),
			// Org memberships: lightweight query for the identity bridge
			db.orgMembership.findMany({
				where: { userId: locals.user.id },
				include: {
					org: {
						select: {
							slug: true,
							name: true,
							avatar: true,
							_count: {
								select: {
									campaigns: {
										where: { status: { in: ['ACTIVE', 'PAUSED'] } }
									}
								}
							}
						}
					}
				}
			})
		]);

		// DUAL-WRITE: Read from both sources, prefer DM if populated, fall back to legacy
		// Transform legacy representatives to simple format
		const legacyReps =
			userWithRepresentatives?.representatives?.map((ur) => ({
				name: ur.representative.name,
				party: ur.representative.party,
				chamber: ur.representative.chamber,
				state: ur.representative.state,
				district: ur.representative.district
			})) || [];

		// Transform DM relations — derive chamber from title, state from jurisdiction
		const dmReps =
			userWithRepresentatives?.dmRelations?.map((dr) => {
				const title = dr.decisionMaker.title ?? '';
				const isSenate = title.toLowerCase().includes('senator') || title.toLowerCase().includes('senate');
				return {
					name: dr.decisionMaker.name,
					party: dr.decisionMaker.party ?? '',
					chamber: isSenate ? 'senate' : 'house',
					state: dr.decisionMaker.jurisdiction ?? '',
					district: dr.decisionMaker.district ?? '',
					title,
					jurisdiction: dr.decisionMaker.jurisdiction ?? ''
				};
			}) || [];

		// Prefer DM path when populated; fall back to legacy. Remove in S1-07.
		const representatives = dmReps.length > 0 ? dmReps : legacyReps;

		// Transform org memberships for the header bridge
		const userOrgMemberships = orgMemberships.map((m) => ({
			orgSlug: m.org.slug,
			orgName: m.org.name,
			orgAvatar: m.org.avatar,
			role: m.role,
			activeCampaignCount: m.org._count.campaigns
		}));

		return {
			user: {
				id: locals.user.id,
				email: locals.user.email,
				name: locals.user.name,
				avatar: locals.user.avatar,
				// Graduated trust tier (0-5)
				trust_tier: locals.user.trust_tier ?? 0,
				// Verification status
				is_verified: locals.user.is_verified || false,
				verification_method: locals.user.verification_method,
				verified_at: locals.user.verified_at,
				// Passkey status (boolean — credential ID is PII, not sent to client)
				hasPasskey: Boolean(userWithRepresentatives?.passkey_credential_id),
				// Privacy-preserving district (hash only)
				district_hash: locals.user.district_hash,
				district_verified: locals.user.district_verified,
				// Wallet integration (boolean flags — addresses are PII, not sent to client)
				hasWallet: Boolean(userWithRepresentatives?.wallet_address),
				// Representatives data for template resolution
				representatives: representatives,
				// Org layer bridge
				orgMemberships: userOrgMemberships
			}
		};
	} catch (error) {
		console.error('[Layout] Failed to load user context:', error instanceof Error ? error.message : String(error));
		// Fallback to basic user data without representatives or org memberships
		return {
			user: {
				id: locals.user.id,
				email: locals.user.email,
				name: locals.user.name,
				avatar: locals.user.avatar,
				trust_tier: locals.user.trust_tier ?? 0,
				is_verified: locals.user.is_verified || false,
				verification_method: locals.user.verification_method,
				verified_at: locals.user.verified_at,
				hasPasskey: false,
				district_hash: locals.user.district_hash,
				district_verified: locals.user.district_verified,
				// Wallet integration (boolean flags — addresses are PII, not sent to client)
				hasWallet: false,
				representatives: [],
				orgMemberships: []
			}
		};
	}
};
