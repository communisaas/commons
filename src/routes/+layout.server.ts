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
					// Legacy path — kept as server-side fallback until client-rep-resolver
					// is wired into all consumer components. Remove in S1-07.
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
					}
					// DM relations removed — reps now resolved client-side via
					// client-rep-resolver.ts (IndexedDB credential + IPFS officials).
					// Client uses district_verified flag to know when to call resolver.
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

		// Legacy representatives — server-side fallback until all consumers
		// migrate to client-rep-resolver.ts. Remove in S1-07.
		const representatives =
			userWithRepresentatives?.representatives?.map((ur) => ({
				name: ur.representative.name,
				party: ur.representative.party,
				chamber: ur.representative.chamber,
				state: ur.representative.state,
				district: ur.representative.district
			})) || [];

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
				// Client-side rep resolution signal — when true, components use
				// resolveRepsFromCredential() instead of server-provided reps
				hasDistrictCredential: Boolean(userWithRepresentatives?.district_verified),
				// Legacy representatives — server-side fallback. Remove in S1-07.
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
				hasDistrictCredential: false,
				representatives: [],
				orgMemberships: []
			}
		};
	}
};
