import type { LayoutServerLoad } from './$types';
import { db } from '$lib/core/db';
import { PUBLIC_CONVEX_URL } from '$env/static/public';

// Convex dual-stack imports (primary data source when available)
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';

export const load: LayoutServerLoad = async ({ locals, depends }) => {
	// Cache user data across navigations — only re-fetch when explicitly invalidated
	depends('data:user');

	if (!locals.user) {
		return { user: null };
	}

	// ─── DUAL-STACK: Try Convex first, fallback to Prisma ───
	if (PUBLIC_CONVEX_URL) {
		try {
			const [convexProfile, convexMemberships] = await Promise.all([
				serverQuery(api.users.getProfile, {}),
				serverQuery(api.organizations.getMyMemberships, {})
			]);

			if (convexProfile) {
				console.log('[Layout] Convex: loaded user profile + org memberships');
				return {
					user: {
						id: locals.user.id,
						email: convexProfile.email ?? locals.user.email,
						name: convexProfile.name ?? locals.user.name,
						avatar: convexProfile.avatar ?? locals.user.avatar,
						trust_tier: convexProfile.trustTier ?? 0,
						is_verified: convexProfile.isVerified || false,
						verification_method: convexProfile.verificationMethod,
						verified_at: convexProfile.verifiedAt,
						hasPasskey: convexProfile.hasPasskey,
						district_hash: convexProfile.districtHash,
						district_verified: convexProfile.districtVerified,
						hasWallet: convexProfile.hasWallet,
						hasDistrictCredential: Boolean(convexProfile.districtVerified),
						orgMemberships: convexMemberships ?? []
					}
				};
			}
		} catch (err) {
			console.error('[Layout] Convex load failed, falling back to Prisma:', err);
			// Fall through to Prisma below
		}
	}

	// ─── PRISMA FALLBACK ───
	// Fetch user with representatives data + org memberships in parallel
	try {
		const [userWithRepresentatives, orgMemberships] = await Promise.all([
			db.user.findUnique({
				where: { id: locals.user.id }
				// Representatives resolved client-side via client-rep-resolver.ts
				// (IndexedDB credential + IPFS officials). Legacy representatives relation removed.
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
				orgMemberships: []
			}
		};
	}
};
