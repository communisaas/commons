import {
	query,
	mutation,
	action,
	internalQuery,
	internalMutation,
	internalAction
} from './_generated/server';
import { v } from 'convex/values';
import { internal } from './_generated/api';
import { requireAuth } from './_authHelpers';
import { selectActiveCredentialForUser } from './_credentialSelect';
import { applyDowngradeGuard } from './_downgradeGuard';

// =============================================================================
// USERS — Queries & Mutations
// =============================================================================

/**
 * Internal: Look up user by email hash (used by auth helpers and delegation).
 * Accepts either an email (computes hash) or a pre-computed emailHash.
 */
export const getByEmail = internalQuery({
	args: { email: v.optional(v.string()) },
	handler: async (ctx, args) => {
		if (!args.email) return null;
		return await ctx.db
			.query('users')
			.withIndex('by_email', (q) => q.eq('email', args.email))
			.first();
	}
});

/**
 * Internal: Look up user by ID.
 */
export const getById = internalQuery({
	args: { id: v.id('users') },
	handler: async (ctx, args) => {
		return await ctx.db.get(args.id);
	}
});

/**
 * Authenticated query: Returns current user's profile with decrypted PII.
 *
 * Decryption is deterministic (known IV) so safe in queries.
 * On decryption failure, returns masked PII — session stays valid.
 */
export const getProfile = query({
	args: {},
	handler: async (ctx) => {
		const { userId } = await requireAuth(ctx);
		const user = await ctx.db.get(userId);
		if (!user) throw new Error('User not found');

		return {
			_id: user._id,
			_creationTime: user._creationTime,
			email: user.email ?? null,
			name: user.name ?? null,
			avatar: user.avatar ?? null,
			trustTier: user.trustTier ?? 0,
			isVerified: user.isVerified ?? false,
			verificationMethod: user.verificationMethod ?? null,
			verifiedAt: user.verifiedAt ?? null,
			hasPasskey: Boolean(user.passkeyCredentialId),
			districtHash: user.districtHash ?? null,
			districtVerified: user.districtVerified ?? false,
			hasWallet: Boolean(user.walletAddress),
			trustScore: user.trustScore ?? 0,
			reputationTier: user.reputationTier ?? 'novice',
			role: user.role ?? null,
			organization: user.organization ?? null,
			location: user.location ?? null,
			connection: user.connection ?? null,
			profileVisibility: user.profileVisibility ?? 'private',
			profileCompletedAt: user.profileCompletedAt ?? null
		};
	}
});

/**
 * Authenticated query: Returns templates created by the current user.
 */
export const getMyTemplates = query({
	args: {},
	handler: async (ctx) => {
		const { userId } = await requireAuth(ctx);
		return await ctx.db
			.query('templates')
			.withIndex('by_userId', (q) => q.eq('userId', userId))
			.collect();
	}
});

/**
 * Authenticated query: Returns the current user's linked representatives.
 */
export const getMyRepresentatives = query({
	args: {},
	handler: async (ctx) => {
		const { userId } = await requireAuth(ctx);
		const relations = await ctx.db
			.query('userDmRelations')
			.withIndex('by_userId', (q) => q.eq('userId', userId))
			.collect();
		if (relations.length === 0) return [];
		const reps = await Promise.all(relations.map((r) => ctx.db.get(r.decisionMakerId)));
		return reps.filter(Boolean);
	}
});

/**
 * Update user profile fields.
 * Sets updatedAt, and profileCompletedAt if all profile fields are present.
 */
export const updateProfile = mutation({
	args: {
		role: v.optional(v.string()),
		organization: v.optional(v.string()),
		location: v.optional(v.string()),
		connection: v.optional(v.string()),
		profileVisibility: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const { userId } = await requireAuth(ctx);
		const user = await ctx.db.get(userId);
		if (!user) {
			throw new Error('User not found');
		}

		// Build patch from provided fields only
		const patch: Record<string, unknown> = {
			updatedAt: Date.now()
		};

		if (args.role !== undefined) patch.role = args.role;
		if (args.organization !== undefined) patch.organization = args.organization;
		if (args.location !== undefined) patch.location = args.location;
		if (args.connection !== undefined) patch.connection = args.connection;
		if (args.profileVisibility !== undefined) patch.profileVisibility = args.profileVisibility;

		// Check if all profile fields will be present after patch
		const finalRole = args.role ?? user.role;
		const finalOrganization = args.organization ?? user.organization;
		const finalLocation = args.location ?? user.location;
		const finalConnection = args.connection ?? user.connection;

		if (finalRole && finalOrganization && finalLocation && finalConnection) {
			if (!user.profileCompletedAt) {
				patch.profileCompletedAt = Date.now();
			}
		}

		await ctx.db.patch(userId, patch);
	}
});

// =============================================================================
// WALLET
// =============================================================================

/**
 * Get wallet status for the authenticated user.
 */
export const getWalletStatus = query({
	args: {},
	handler: async (ctx) => {
		const { userId } = await requireAuth(ctx);
		const user = await ctx.db.get(userId);
		if (!user) throw new Error('User not found');

		return {
			wallet_address: user.walletAddress ?? null,
			wallet_type: user.walletType ?? null,
			near_derived_scroll_address: user.nearDerivedScrollAddress ?? null
		};
	}
});

/**
 * Connect an EVM wallet to the authenticated user.
 * Checks uniqueness constraint on walletAddress.
 */
export const connectWallet = mutation({
	args: {
		address: v.string(),
		walletType: v.string()
	},
	handler: async (ctx, args) => {
		const { userId } = await requireAuth(ctx);

		// Check if this wallet is already bound to a different user
		const existing = await ctx.db
			.query('users')
			.withIndex('by_walletAddress', (q) => q.eq('walletAddress', args.address))
			.first();

		if (existing && existing._id !== userId) {
			throw new Error('This wallet is already connected to another account');
		}

		await ctx.db.patch(userId, {
			walletAddress: args.address,
			walletType: args.walletType,
			updatedAt: Date.now()
		});

		return { success: true, address: args.address };
	}
});

/**
 * Disconnect the EVM wallet from the authenticated user.
 */
export const disconnectWallet = mutation({
	args: {},
	handler: async (ctx) => {
		const { userId } = await requireAuth(ctx);
		const user = await ctx.db.get(userId);
		if (!user) throw new Error('User not found');

		if (!user.walletAddress) {
			throw new Error('No wallet connected');
		}

		await ctx.db.patch(userId, {
			walletAddress: undefined,
			walletType: undefined,
			updatedAt: Date.now()
		});

		return { success: true };
	}
});

/**
 * Get user's NEAR account ID (for meta-tx sender validation).
 */
export const getNearAccountId = query({
	args: {},
	handler: async (ctx) => {
		const { userId } = await requireAuth(ctx);
		const user = await ctx.db.get(userId);
		if (!user) throw new Error('User not found');

		return {
			nearAccountId: user.nearAccountId ?? null
		};
	}
});

/**
 * Get user's identity commitment (for position registration).
 */
export const getIdentityCommitment = query({
	args: {},
	handler: async (ctx) => {
		const { userId } = await requireAuth(ctx);
		const user = await ctx.db.get(userId);
		if (!user) throw new Error('User not found');

		return {
			identityCommitment: user.identityCommitment ?? null
		};
	}
});

/**
 * Internal: Look up user by wallet address.
 */
export const getByWalletAddress = internalQuery({
	args: { walletAddress: v.string() },
	handler: async (ctx, args) => {
		return await ctx.db
			.query('users')
			.withIndex('by_walletAddress', (q) => q.eq('walletAddress', args.walletAddress))
			.first();
	}
});

// =============================================================================
// PASSKEY
// =============================================================================

/**
 * Check if user has a passkey registered.
 */
export const getPasskeyStatus = query({
	args: { userId: v.id('users') },
	handler: async (ctx, args) => {
		const { userId: authUserId } = await requireAuth(ctx);
		if (args.userId !== authUserId) throw new Error('Unauthorized');
		const user = await ctx.db.get(args.userId);
		if (!user) return null;
		return { hasPasskey: Boolean(user.passkeyCredentialId) };
	}
});

/**
 * Clear all passkey fields from a user.
 */
export const clearPasskey = mutation({
	args: { userId: v.id('users') },
	handler: async (ctx, args) => {
		const { userId: authUserId } = await requireAuth(ctx);
		if (args.userId !== authUserId) throw new Error('Unauthorized');
		const user = await ctx.db.get(args.userId);
		if (!user) throw new Error('User not found');
		if (!user.passkeyCredentialId) throw new Error('No passkey registered');
		await ctx.db.patch(args.userId, {
			passkeyCredentialId: undefined,
			passkeyPublicKeyJwk: undefined,
			passkeyCreatedAt: undefined,
			passkeyLastUsedAt: undefined,
			didKey: undefined,
			updatedAt: Date.now()
		});
	}
});

// =============================================================================
// MDL / ADDRESS VERIFICATION
// =============================================================================

/**
 * Internal legacy helper for mDL verification metadata. Only upgrades trust_tier,
 * never downgrades.
 *
 * Do not expose this as a public mutation: clients must not be able to self-assert
 * mDL verification. New server routes should prefer finalizeMdlVerification so
 * commitment binding and tier mutation stay atomic.
 */
export const updateMdlVerification = internalMutation({
	args: {
		userId: v.id('users'),
		verifiedAt: v.number(),
		addressVerificationMethod: v.string(),
		documentType: v.string()
	},
	handler: async (ctx, args) => {
		const user = await ctx.db.get(args.userId);
		if (!user) throw new Error('User not found');
		const patch: Record<string, unknown> = {
			verifiedAt: args.verifiedAt,
			addressVerificationMethod: args.addressVerificationMethod,
			addressVerifiedAt: args.verifiedAt,
			documentType: args.documentType,
			updatedAt: Date.now()
		};
		if (user.trustTier < 5) {
			patch.trustTier = 5;
		}
		await ctx.db.patch(args.userId, patch);
	}
});

const MDL_CREDENTIAL_REUSE_COOLDOWN_MS = 10 * 60 * 1000;
const MDL_CREDENTIAL_HASH_REUSED = 'MDL_CREDENTIAL_HASH_REUSED';
const MDL_SESSION_NONCE_REUSED = 'MDL_SESSION_NONCE_REUSED';
const MDL_CREDENTIAL_HASH_INVALID = 'MDL_CREDENTIAL_HASH_INVALID';

/**
 * Server-only mDL finalizer.
 *
 * Same-device and bridge verification routes have already authenticated the
 * flow (session cookie or bridge HMAC) before calling this internal mutation.
 * Keeping commitment binding and the tier upgrade in one internal mutation
 * avoids two bad states:
 *   - bridge completion failing because the phone request has no Convex auth
 *   - account-merge flows failing when the canonical user is not the session user
 */
export const finalizeMdlVerification = internalMutation({
	args: {
		userId: v.id('users'),
		identityCommitment: v.string(),
		credentialHash: v.string(),
		nonce: v.string(),
		protocol: v.string(),
		sessionChannel: v.union(v.literal('same-device'), v.literal('bridge'), v.literal('direct')),
		verifiedAt: v.number(),
		addressVerificationMethod: v.string(),
		documentType: v.string(),
		identityHash: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const existing = await ctx.db
			.query('users')
			.filter((q) => q.eq(q.field('identityCommitment'), args.identityCommitment))
			.first();

		const linkedToExisting = Boolean(existing && existing._id !== args.userId);
		const canonicalUserId = linkedToExisting ? existing!._id : args.userId;
		const user = await ctx.db.get(canonicalUserId);
		if (!user) throw new Error('User not found');
		const now = Date.now();

		if (!/^[0-9a-f]{64}$/i.test(args.credentialHash)) {
			throw new Error(MDL_CREDENTIAL_HASH_INVALID);
		}

		const activeReuse = await ctx.db
			.query('mdlCredentialUses')
			.withIndex('by_credentialHash', (q) => q.eq('credentialHash', args.credentialHash))
			.filter((q) => q.gt(q.field('expiresAt'), now))
			.first();

		if (activeReuse) {
			throw new Error(MDL_CREDENTIAL_HASH_REUSED);
		}

		const activeNonceReuse = await ctx.db
			.query('mdlCredentialUses')
			.withIndex('by_nonce', (q) => q.eq('nonce', args.nonce))
			.filter((q) => q.gt(q.field('expiresAt'), now))
			.first();

		if (activeNonceReuse) {
			throw new Error(MDL_SESSION_NONCE_REUSED);
		}

		await ctx.db.insert('mdlCredentialUses', {
			credentialHash: args.credentialHash,
			userId: canonicalUserId,
			identityCommitment: args.identityCommitment,
			nonce: args.nonce,
			protocol: args.protocol,
			sessionChannel: args.sessionChannel,
			firstSeenAt: now,
			expiresAt: now + MDL_CREDENTIAL_REUSE_COOLDOWN_MS
		});

		const patch: Record<string, unknown> = {
			identityCommitment: args.identityCommitment,
			isVerified: true,
			verificationMethod: 'mdl',
			verifiedAt: args.verifiedAt,
			addressVerificationMethod: args.addressVerificationMethod,
			addressVerifiedAt: args.verifiedAt,
			documentType: args.documentType,
			updatedAt: Date.now()
		};
		if (args.identityHash) patch.identityHash = args.identityHash;
		if ((user.trustTier ?? 0) < 5) {
			patch.trustTier = 5;
		}

		await ctx.db.patch(canonicalUserId, patch);

		return {
			userId: canonicalUserId,
			linkedToExisting,
			requireReauth: linkedToExisting,
			mergeDetails: linkedToExisting ? { accountsMoved: 1 } : undefined
		};
	}
});

/**
 * Verify address: revoke old credentials, create new one, update user, upsert DM relations.
 *
 * Rate-limited by query-time aggregation on districtCredentials.issuedAt:
 *   - 24h between re-verifications (per userId)
 *   - 6 re-verifications per trailing 180d (per userId + per emailHash)
 * Bypass at trust_tier >= 3 (mDL/passport verified identity).
 */
const ADDRESS_VERIFICATION_METHODS = ['shadow_atlas', 'civic_api', 'postal'] as const;
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
const ONE_EIGHTY_DAYS_MS = 180 * 24 * 60 * 60 * 1000;
const MAX_REVERIFICATIONS_PER_180D = 6;
const MAX_USERIDS_PER_EMAIL_HASH_180D = 3;

export const verifyAddress = mutation({
	args: {
		userId: v.id('users'),
		district: v.optional(v.string()),
		stateSenateDistrict: v.optional(v.string()),
		stateAssemblyDistrict: v.optional(v.string()),
		verificationMethod: v.string(),
		credentialHash: v.optional(v.string()),
		districtHash: v.optional(v.string()),
		districtCommitment: v.optional(v.string()),
		slotCount: v.optional(v.number()),
		expiresAt: v.number(),
		isCommitmentOnly: v.boolean(),
		officials: v.optional(
			v.array(
				v.object({
					name: v.string(),
					chamber: v.string(),
					party: v.string(),
					state: v.string(),
					district: v.string(),
					bioguideId: v.string(),
					isVotingMember: v.optional(v.boolean()),
					delegateType: v.optional(v.string()),
					phone: v.optional(v.string())
				})
			)
		)
	},
	handler: async (ctx, args) => {
		const { userId: authUserId } = await requireAuth(ctx);
		if (args.userId !== authUserId) throw new Error('Unauthorized');
		const user = await ctx.db.get(args.userId);
		if (!user) throw new Error('User not found');
		const now = Date.now();

		// (1d) verificationMethod allowlist — prevent client from claiming "mdl" etc.
		if (
			!ADDRESS_VERIFICATION_METHODS.includes(
				args.verificationMethod as (typeof ADDRESS_VERIFICATION_METHODS)[number]
			)
		) {
			throw new Error('INVALID_VERIFICATION_METHOD');
		}

		const existing = await ctx.db
			.query('districtCredentials')
			.withIndex('by_userId_expiresAt', (q) => q.eq('userId', args.userId))
			.collect();

		// (1e) Commitment-downgrade guard. Once a user has held a v2 (commitment-
		// bearing) credential, every subsequent credential MUST carry one.
		//
		// Motivation: AddressCollectionForm.svelte silently catches client-side
		// Poseidon2 sponge failures ("proceeding without") and submits a verify
		// request with no districtCommitment. Pre-guard, that request would retire
		// the prior v2 credential and issue a commitment-less one — after which
		// every submission 403s with CREDENTIAL_MIGRATION_REQUIRED and the 24h
		// throttle blocks the user from re-verifying for a day.
		//
		// Scope: this is a PRESENCE check, not an AUTHENTICITY check. A client
		// supplying any 64-hex string satisfies the guard. Authenticity is
		// enforced downstream at the TEE gate (resolver-gates.ts:195-237), where
		// the decrypted witness's districts are hashed and compared to the stored
		// commitment. A client with a dummy commitment produces submissions that
		// fail at the TEE gate — same practical result as the pre-guard bug, but
		// localized to a buggy client rather than propagating to a persistent
		// server-side downgrade. Server-side commitment recomputation from the
		// verified coordinates would close this remaining gap, but requires
		// server access to the H3 cell data and is out of scope for Wave 1.
		//
		// Ordering: runs BEFORE the throttle check. A rejected attempt does NOT
		// increment the 24h throttle counter — the user can retry immediately
		// with a valid commitment. Prior v2 row stays intact (revoke-prior runs
		// at line 462+, which is unreachable when this throws).
		//
		// Legacy (never-had-commitment) users are unaffected; they can still
		// re-verify via civic_api/postal during the transition period.
		//
		// FU-1.2: extracted to `_downgradeGuard.ts` as a pure helper so tests
		// can assert the guard logic directly without a MockConvex mirror.
		const guardResult = applyDowngradeGuard(existing, args.districtCommitment);
		if (guardResult !== null) {
			throw new Error(guardResult);
		}

		// (1c) Re-verification throttle — bypass at trust_tier >= 3 (mDL-verified identity).
		if (user.trustTier < 3) {
			const within24h = existing.filter((c) => now - c.issuedAt < TWENTY_FOUR_HOURS_MS);
			if (within24h.length >= 1) {
				throw new Error('ADDRESS_VERIFICATION_THROTTLED_24H');
			}
			const within180d = existing.filter((c) => now - c.issuedAt < ONE_EIGHTY_DAYS_MS);
			if (within180d.length >= MAX_REVERIFICATIONS_PER_180D) {
				throw new Error('ADDRESS_VERIFICATION_THROTTLED_180D');
			}

			// Email-sybil gate: cap distinct userIds sharing this emailHash within
			// the trailing 180-day window. Throwaway-account farms bypass per-userId
			// throttle; this closes that hole while permitting legitimate users who
			// have accumulated accounts over years (measured by users._creationTime).
			if (user.emailHash) {
				const siblingUsers = await ctx.db
					.query('users')
					.withIndex('by_emailHash', (q) => q.eq('emailHash', user.emailHash))
					.collect();
				const recentSiblings = siblingUsers.filter(
					(u) => now - u._creationTime < ONE_EIGHTY_DAYS_MS
				);
				if (recentSiblings.length > MAX_USERIDS_PER_EMAIL_HASH_180D) {
					throw new Error('ADDRESS_VERIFICATION_EMAIL_SYBIL');
				}
			}
		}

		// Revoke existing unexpired credentials (server-layer gate; Stage 1).
		// F1 closure (Stage 5): additionally mark the credential as having a
		// pending on-chain revocation emit. A separate internalAction drains the
		// queue and calls RevocationRegistry.emitRevocation via the relayer.
		// revokedAt and revocationStatus are intentionally orthogonal — revokedAt
		// controls submission admissibility (Stage 1), revocationStatus tracks the
		// circuit-layer non-membership set (Stage 5). A credential with
		// revocationStatus='pending' but revokedAt=null is invalid and should never
		// exist; verifyAddress sets them together.
		const credentialsToRevoke: typeof existing = [];
		for (const cred of existing) {
			if (!cred.revokedAt) {
				credentialsToRevoke.push(cred);
				const scheduleOnChain = Boolean(cred.districtCommitment);
				await ctx.db.patch(cred._id, {
					revokedAt: now,
					// Only flag for on-chain revocation when the credential carries a
					// districtCommitment (post-sponge-24 credentials). Legacy credentials
					// without a commitment have no revocation_nullifier preimage and are
					// gated solely at the Stage 1 server layer.
					...(scheduleOnChain
						? {
								revocationStatus: 'pending' as const,
								revocationAttempts: 0,
								revocationLastAttemptAt: now
							}
						: {})
				});
			}
		}

		// Create new credential.
		await ctx.db.insert('districtCredentials', {
			userId: args.userId,
			credentialType: 'district_residency',
			congressionalDistrict: args.district ?? '',
			stateSenateDistrict: args.stateSenateDistrict,
			stateAssemblyDistrict: args.stateAssemblyDistrict,
			verificationMethod: args.verificationMethod,
			issuedAt: now,
			expiresAt: args.expiresAt,
			credentialHash: args.credentialHash ?? '',
			districtCommitment: args.districtCommitment,
			slotCount: args.slotCount
		});

		// Update user
		const userPatch: Record<string, unknown> = {
			trustTier: Math.max(user.trustTier, 2),
			districtVerified: true,
			addressVerifiedAt: now,
			addressVerificationMethod: args.verificationMethod,
			verifiedAt: now,
			verificationMethod: args.verificationMethod,
			isVerified: true,
			updatedAt: now
		};
		if (args.districtHash) {
			userPatch.districtHash = args.districtHash;
		}
		await ctx.db.patch(args.userId, userPatch);

		// F1 closure (Stage 5): schedule per-credential on-chain revocation emits.
		// Kicked off AFTER the user patch so a mid-flight failure of the scheduler
		// leaves the credential gated server-side (revokedAt is set) even if the
		// on-chain write lags. The stuck-pending cron catches orphans.
		for (const cred of credentialsToRevoke) {
			if (cred.districtCommitment) {
				await ctx.scheduler.runAfter(0, internal.users.emitOnChainRevocation, {
					credentialId: cred._id
				});
			}
		}

		// Upsert representatives
		if (!args.isCommitmentOnly && args.officials && args.officials.length > 0) {
			const existingRelations = await ctx.db
				.query('userDmRelations')
				.withIndex('by_userId', (q) => q.eq('userId', args.userId))
				.collect();
			for (const rel of existingRelations) {
				await ctx.db.patch(rel._id, { isActive: false });
			}

			for (const official of args.officials) {
				const existingExt = await ctx.db
					.query('externalIds')
					.withIndex('by_system_value', (q) =>
						q.eq('system', 'bioguide').eq('value', official.bioguideId)
					)
					.first();

				let dmId;
				if (existingExt) {
					dmId = existingExt.decisionMakerId;
				} else {
					const nameParts = official.name.split(' ');
					const lastName = nameParts.pop() || official.name;
					const firstName = nameParts.join(' ') || undefined;
					const title = official.chamber === 'senate' ? 'Senator' : 'Representative';

					dmId = await ctx.db.insert('decisionMakers', {
						type: 'legislator',
						name: official.name,
						firstName,
						lastName,
						party: official.party,
						jurisdiction: official.state,
						jurisdictionLevel: 'federal',
						district: official.district,
						title,
						phone: official.phone,
						active: true,
						lastSyncedAt: now,
						updatedAt: now
					});
					await ctx.db.insert('externalIds', {
						decisionMakerId: dmId,
						system: 'bioguide',
						value: official.bioguideId
					});
				}

				const existingRel = await ctx.db
					.query('userDmRelations')
					.withIndex('by_userId_decisionMakerId', (q) =>
						q.eq('userId', args.userId).eq('decisionMakerId', dmId)
					)
					.first();

				if (existingRel) {
					await ctx.db.patch(existingRel._id, {
						isActive: true,
						lastValidated: now,
						source: args.verificationMethod
					});
				} else {
					await ctx.db.insert('userDmRelations', {
						userId: args.userId,
						decisionMakerId: dmId,
						relationship: 'constituent',
						isActive: true,
						assignedAt: now,
						lastValidated: now,
						source: args.verificationMethod
					});
				}
			}
		}
	}
});

/**
 * Get user's did_key for credential issuance.
 */
export const getDidKey = query({
	args: { userId: v.id('users') },
	handler: async (ctx, args) => {
		const user = await ctx.db.get(args.userId);
		if (!user) return null;
		return { didKey: user.didKey ?? null };
	}
});

/**
 * Re-verification budget for the current user.
 *
 * Mirrors the three throttle gates inside `verifyAddress` (24h cooldown,
 * 6-per-180d cap, email-sybil cap) but as a read-only projection so the
 * client can render preconditions BEFORE the user clicks "I moved" — and
 * before any local credential is retired. This closes the half-retired-state
 * hole where retire-then-reject left users wedged.
 */
export const getReverificationBudget = query({
	args: { userId: v.id('users') },
	handler: async (ctx, args) => {
		const { userId: authUserId } = await requireAuth(ctx);
		if (args.userId !== authUserId) throw new Error('Unauthorized');
		const user = await ctx.db.get(args.userId);
		if (!user) throw new Error('User not found');

		const now = Date.now();
		const tierBypass = (user.trustTier ?? 0) >= 3;

		const credentials = await ctx.db
			.query('districtCredentials')
			.withIndex('by_userId_expiresAt', (q) => q.eq('userId', args.userId))
			.collect();

		// Most-recent issuance drives the 24h cooldown.
		let mostRecentIssuedAt = 0;
		for (const c of credentials) {
			if (c.issuedAt > mostRecentIssuedAt) mostRecentIssuedAt = c.issuedAt;
		}
		const nextAllowedAt =
			mostRecentIssuedAt > 0 && now - mostRecentIssuedAt < TWENTY_FOUR_HOURS_MS
				? mostRecentIssuedAt + TWENTY_FOUR_HOURS_MS
				: null;

		const recentCount = credentials.filter((c) => now - c.issuedAt < ONE_EIGHTY_DAYS_MS).length;

		let emailSybilTripped = false;
		if (!tierBypass && user.emailHash) {
			const siblings = await ctx.db
				.query('users')
				.withIndex('by_emailHash', (q) => q.eq('emailHash', user.emailHash))
				.collect();
			const recentSiblings = siblings.filter((u) => now - u._creationTime < ONE_EIGHTY_DAYS_MS);
			emailSybilTripped = recentSiblings.length > MAX_USERIDS_PER_EMAIL_HASH_180D;
		}

		return {
			tierBypass,
			nextAllowedAt: tierBypass ? null : nextAllowedAt,
			recentCount,
			periodCap: MAX_REVERIFICATIONS_PER_180D,
			windowMs: ONE_EIGHTY_DAYS_MS,
			emailSybilTripped
		};
	}
});

/**
 * Return the active (non-revoked, unexpired) districtCredentials row's
 * `districtCommitment` for the given user.
 *
 * Consumed by the submissions API (/api/submissions/create) to canonically
 * recompute the action domain server-side. Stage 2.5 — the v2 action-domain
 * builder requires districtCommitment as part of its preimage, and the server
 * re-derives from the canonical Convex row (not client-supplied) to prevent
 * a malicious client from forging a new nullifier scope per send.
 *
 * Returns `null` if no active commitment-bearing credential exists; the caller
 * must surface CREDENTIAL_MIGRATION_REQUIRED so the user can re-verify.
 */
export const getActiveCredentialDistrictCommitment = query({
	args: { userId: v.id('users') },
	handler: async (ctx, args) => {
		// Canonical selector (see convex/_credentialSelect.ts) — picks the same
		// authoritative row that `hasActiveDistrictCredential` picks. KG-4 closure:
		// if two active rows ever coexist, both call sites agree on which wins.
		const active = await selectActiveCredentialForUser(ctx, args.userId);
		if (!active || !active.districtCommitment) return null;
		return { districtCommitment: active.districtCommitment };
	}
});

/**
 * Get user's identity commitment + verification method for Shadow Atlas.
 */
export const getIdentityForAtlas = query({
	args: { userId: v.id('users') },
	handler: async (ctx, args) => {
		const user = await ctx.db.get(args.userId);
		if (!user) return null;
		// Derive authority from trustTier so leaf computation matches client-side value.
		// authorityLevel in the DB is set to 1 at creation and never updated on mDL verify,
		// so we must derive it here to stay consistent with the client's leaf hash.
		const trustTier = user.trustTier ?? 0;
		const derivedAuthority = trustTier >= 5 ? 5 : trustTier >= 3 ? 3 : 1;
		return {
			identityCommitment: user.identityCommitment ?? null,
			verificationMethod: user.verificationMethod ?? null,
			authorityLevel: derivedAuthority
		};
	}
});

/**
 * Get user's identity commitment + wallet address for engagement.
 */
export const getIdentityForEngagement = query({
	args: { userId: v.id('users') },
	handler: async (ctx, args) => {
		const user = await ctx.db.get(args.userId);
		if (!user) return null;
		return {
			identityCommitment: user.identityCommitment ?? null,
			walletAddress: user.walletAddress ?? null
		};
	}
});

/**
 * Resolve a credential hash to verification data for the /v/[hash] certificate page.
 * Returns user trust tier, verification method, districts, and issuance data.
 * No PII returned — only verification status and district codes.
 */
export const resolveCredentialHash = query({
	args: { credentialHash: v.string() },
	handler: async (ctx, { credentialHash }) => {
		const credential = await ctx.db
			.query('districtCredentials')
			.withIndex('by_credentialHash', (idx) => idx.eq('credentialHash', credentialHash))
			.first();

		if (!credential) return null;
		if (credential.revokedAt) return null;
		if (credential.expiresAt < Date.now()) return null;

		const user = await ctx.db.get(credential.userId);
		if (!user) return null;

		return {
			trustTier: user.trustTier,
			verificationMethod: credential.verificationMethod,
			congressionalDistrict: credential.congressionalDistrict || null,
			stateSenateDistrict: credential.stateSenateDistrict ?? null,
			stateAssemblyDistrict: credential.stateAssemblyDistrict ?? null,
			issuedAt: credential.issuedAt,
			expiresAt: credential.expiresAt,
			hasDistrictCommitment: !!credential.districtCommitment
		};
	}
});

// =============================================================================
// ENCRYPTED DELIVERY DATA (Identity blobs)
// =============================================================================

export const upsertEncryptedBlob = mutation({
	args: {
		userId: v.id('users'),
		ciphertext: v.string(),
		nonce: v.string(),
		ephemeralPublicKey: v.string(),
		teeKeyId: v.string(),
		encryptionVersion: v.string()
	},
	handler: async (ctx, args) => {
		const { userId: authUserId } = await requireAuth(ctx);
		if (args.userId !== authUserId) throw new Error('Unauthorized');
		const existing = await ctx.db
			.query('encryptedDeliveryData')
			.withIndex('by_userId', (q) => q.eq('userId', args.userId))
			.first();
		if (existing) {
			await ctx.db.patch(existing._id, {
				ciphertext: args.ciphertext,
				nonce: args.nonce,
				ephemeralPublicKey: args.ephemeralPublicKey,
				teeKeyId: args.teeKeyId,
				encryptionVersion: args.encryptionVersion,
				updatedAt: Date.now()
			});
			return existing._id;
		}
		return await ctx.db.insert('encryptedDeliveryData', {
			userId: args.userId,
			ciphertext: args.ciphertext,
			nonce: args.nonce,
			ephemeralPublicKey: args.ephemeralPublicKey,
			teeKeyId: args.teeKeyId,
			encryptionVersion: args.encryptionVersion,
			updatedAt: Date.now()
		});
	}
});

export const getEncryptedBlob = query({
	args: { userId: v.id('users') },
	handler: async (ctx, args) => {
		const { userId: authUserId } = await requireAuth(ctx);
		if (args.userId !== authUserId) throw new Error('Unauthorized');
		return await ctx.db
			.query('encryptedDeliveryData')
			.withIndex('by_userId', (q) => q.eq('userId', args.userId))
			.first();
	}
});

export const deleteEncryptedBlob = mutation({
	args: { userId: v.id('users') },
	handler: async (ctx, args) => {
		const { userId: authUserId } = await requireAuth(ctx);
		if (args.userId !== authUserId) throw new Error('Unauthorized');
		const existing = await ctx.db
			.query('encryptedDeliveryData')
			.withIndex('by_userId', (q) => q.eq('userId', args.userId))
			.first();
		if (!existing) throw new Error('NOT_FOUND');
		await ctx.db.delete(existing._id);
	}
});

// =============================================================================
// SHADOW ATLAS REGISTRATION
// =============================================================================

export const getShadowAtlasRegistration = query({
	args: { userId: v.id('users') },
	handler: async (ctx, args) => {
		const { userId: authUserId } = await requireAuth(ctx);
		if (args.userId !== authUserId) throw new Error('Unauthorized');
		return await ctx.db
			.query('shadowAtlasRegistrations')
			.withIndex('by_userId', (q) => q.eq('userId', args.userId))
			.first();
	}
});

export const createShadowAtlasRegistration = mutation({
	args: {
		userId: v.id('users'),
		identityCommitment: v.string(),
		leafIndex: v.number(),
		merkleRoot: v.string(),
		merklePath: v.any(),
		verificationMethod: v.string(),
		verificationId: v.string()
	},
	handler: async (ctx, args) => {
		const { userId: authUserId } = await requireAuth(ctx);
		if (args.userId !== authUserId) throw new Error('Unauthorized');
		return await ctx.db.insert('shadowAtlasRegistrations', {
			userId: args.userId,
			congressionalDistrict: 'three-tree',
			identityCommitment: args.identityCommitment,
			leafIndex: args.leafIndex,
			merkleRoot: args.merkleRoot,
			merklePath: args.merklePath,
			credentialType: 'three-tree',
			verificationMethod: args.verificationMethod,
			verificationId: args.verificationId,
			verificationTimestamp: Date.now(),
			registrationStatus: 'registered',
			expiresAt: Date.now() + 180 * 24 * 60 * 60 * 1000,
			updatedAt: Date.now()
		});
	}
});

export const updateShadowAtlasRegistration = mutation({
	args: {
		userId: v.id('users'),
		identityCommitment: v.string(),
		leafIndex: v.number(),
		merkleRoot: v.string(),
		merklePath: v.any()
	},
	handler: async (ctx, args) => {
		const { userId: authUserId } = await requireAuth(ctx);
		if (args.userId !== authUserId) throw new Error('Unauthorized');
		const existing = await ctx.db
			.query('shadowAtlasRegistrations')
			.withIndex('by_userId', (q) => q.eq('userId', args.userId))
			.first();
		if (!existing) throw new Error('No registration found');
		await ctx.db.patch(existing._id, {
			identityCommitment: args.identityCommitment,
			leafIndex: args.leafIndex,
			merkleRoot: args.merkleRoot,
			merklePath: args.merklePath,
			updatedAt: Date.now()
		});
	}
});

// =============================================================================
// COMMUNITY FIELD CONTRIBUTIONS
// =============================================================================

export const checkCommunityFieldContribution = query({
	args: { epochDate: v.string(), epochNullifier: v.string() },
	handler: async (ctx, args) => {
		return await ctx.db
			.query('communityFieldContributions')
			.withIndex('by_epochDate_epochNullifier', (q) =>
				q.eq('epochDate', args.epochDate).eq('epochNullifier', args.epochNullifier)
			)
			.first();
	}
});

export const createCommunityFieldContribution = mutation({
	args: {
		epochDate: v.string(),
		epochNullifier: v.string(),
		cellTreeRoot: v.string(),
		proofHash: v.string(),
		verificationStatus: v.string()
	},
	handler: async (ctx, args) => {
		const { userId } = await requireAuth(ctx);
		return await ctx.db.insert('communityFieldContributions', {
			userId,
			epochDate: args.epochDate,
			epochNullifier: args.epochNullifier,
			cellTreeRoot: args.cellTreeRoot,
			proofHash: args.proofHash,
			verificationStatus: args.verificationStatus
		});
	}
});

// =============================================================================
// ADMIN: SHADOW ATLAS RECONCILIATION
// =============================================================================

/**
 * Count all shadow atlas registrations.
 */
export const countRegistrations = query({
	args: {},
	handler: async (ctx) => {
		const regs = await ctx.db.query('shadowAtlasRegistrations').collect();
		return regs.length;
	}
});

/**
 * List recent shadow atlas registrations (for spot-check reconciliation).
 */
export const listRecentRegistrations = query({
	args: { limit: v.optional(v.number()) },
	handler: async (ctx, { limit }) => {
		const max = Math.min(limit ?? 50, 100);
		const regs = await ctx.db.query('shadowAtlasRegistrations').order('desc').take(max);
		return regs.map((r) => ({
			_id: r._id,
			userId: r.userId,
			leafIndex: r.leafIndex,
			merkleRoot: r.merkleRoot
		}));
	}
});

/**
 * Upsert a shadow atlas registration (for retry queue processing).
 */
/**
 * Bind an identity commitment to a user for Sybil detection.
 *
 * If another user already has this commitment, merges accounts
 * (returns the canonical userId). Otherwise patches the current user.
 */
export const bindIdentityCommitment = mutation({
	args: {
		userId: v.id('users'),
		identityCommitment: v.string(),
		identityHash: v.optional(v.string()),
		documentType: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const { userId: authUserId } = await requireAuth(ctx);
		if (args.userId !== authUserId) throw new Error('Unauthorized');
		// Check if commitment already bound to another user (Sybil / account merge)
		const existing = await ctx.db
			.query('users')
			.filter((q) => q.eq(q.field('identityCommitment'), args.identityCommitment))
			.first();

		if (existing && existing._id !== args.userId) {
			// Account merge: canonical user is the one that already has the commitment
			return {
				userId: existing._id,
				linkedToExisting: true,
				requireReauth: true,
				mergeDetails: { accountsMoved: 1 }
			};
		}

		// Bind commitment to this user
		const patch: Record<string, unknown> = {
			identityCommitment: args.identityCommitment,
			isVerified: true,
			verificationMethod: 'mdl',
			verifiedAt: Date.now(),
			updatedAt: Date.now()
		};
		if (args.identityHash) patch.identityHash = args.identityHash;
		if (args.documentType) patch.documentType = args.documentType;

		await ctx.db.patch(args.userId, patch);

		return {
			userId: args.userId,
			linkedToExisting: false,
			requireReauth: false
		};
	}
});

export const upsertRegistration = mutation({
	args: {
		userId: v.string(),
		identityCommitment: v.string(),
		leafIndex: v.number(),
		merkleRoot: v.string(),
		merklePath: v.any(),
		isReplace: v.boolean(),
		verificationMethod: v.string(),
		queuedAt: v.string()
	},
	handler: async (ctx, args) => {
		const { userId: authUserId } = await requireAuth(ctx);
		if (args.userId !== (authUserId as string)) throw new Error('Unauthorized');
		const existing = await ctx.db
			.query('shadowAtlasRegistrations')
			.withIndex('by_userId', (q) => q.eq('userId', args.userId as any))
			.first();

		if (args.isReplace && existing) {
			await ctx.db.patch(existing._id, {
				identityCommitment: args.identityCommitment,
				leafIndex: args.leafIndex,
				merkleRoot: args.merkleRoot,
				merklePath: args.merklePath,
				updatedAt: Date.now()
			});
		} else if (existing) {
			await ctx.db.patch(existing._id, {
				identityCommitment: args.identityCommitment,
				leafIndex: args.leafIndex,
				merkleRoot: args.merkleRoot,
				merklePath: args.merklePath,
				updatedAt: Date.now()
			});
		} else {
			await ctx.db.insert('shadowAtlasRegistrations', {
				userId: args.userId as any,
				congressionalDistrict: 'three-tree',
				identityCommitment: args.identityCommitment,
				leafIndex: args.leafIndex,
				merkleRoot: args.merkleRoot,
				merklePath: args.merklePath,
				credentialType: 'three-tree',
				verificationMethod: args.verificationMethod,
				verificationId: args.userId,
				verificationTimestamp: new Date(args.queuedAt).getTime(),
				registrationStatus: 'registered',
				expiresAt: Date.now() + 180 * 24 * 60 * 60 * 1000,
				updatedAt: Date.now()
			});
		}
	}
});

// =============================================================================
// F1 CLOSURE — ON-CHAIN REVOCATION PROPAGATION (Stage 5)
// =============================================================================
//
// verifyAddress marks a credential with revocationStatus='pending' at the DB
// layer. The internalAction below drains pending revocations, computes the
// revocation nullifier server-side, and calls the relayer endpoint to submit
// RevocationRegistry.emitRevocation on Scroll L2.
//
// Retry policy: exponential backoff via ctx.scheduler.runAfter. Attempts cap
// at MAX_REVOCATION_ATTEMPTS; terminal failure flips revocationStatus='failed'
// and alerts operator via the existing /api/internal/alert endpoint.
//
// Atomicity model: verifyAddress commits revokedAt + revocationStatus='pending'
// atomically with the mutation. The scheduled emit runs independently and can
// fail without reverting the server-side gate. Stuck-pending cron catches
// orphans (e.g. Convex scheduler restart during emit).
//
// INVARIANT (Stage 5, precise): if districtCredentials.revokedAt is set AND
// the row carries a districtCommitment, then revocationStatus is in
// {pending, confirmed, failed}. Rows WITHOUT districtCommitment are
// intentionally revoked server-side only — verifyAddress at lines ~447-461
// and cutover.ts:53 both elect NOT to flag them for the emit queue because
// there is no commitment preimage from which to derive a revocation
// nullifier. These rows are legacy/malformed (pre-sponge-24) and are covered
// by the Stage 2.5 CREDENTIAL_MIGRATION_REQUIRED client path in
// ProofGenerator.svelte, which forces re-verification. The server Stage 1
// gate (revokedAt set) continues to block submissions regardless.
//
// A credential with revocationStatus='pending' but revokedAt undefined is a
// bug and should never exist — verifyAddress writes them together.

const MAX_REVOCATION_ATTEMPTS = 6;
/** Backoff schedule in milliseconds: 1m, 5m, 30m, 3h, 12h, 24h. */
const REVOCATION_BACKOFF_MS: number[] = [
	60_000,
	5 * 60_000,
	30 * 60_000,
	3 * 60 * 60_000,
	12 * 60 * 60_000,
	24 * 60 * 60_000
];
const STUCK_PENDING_AGE_MS = 60 * 60_000; // 1 hour

/**
 * Internal query: look up a credential for the on-chain revocation worker.
 */
export const getCredentialForRevocation = internalQuery({
	args: { credentialId: v.id('districtCredentials') },
	handler: async (ctx, { credentialId }) => {
		const credential = await ctx.db.get(credentialId);
		if (!credential) return null;
		return {
			_id: credential._id,
			districtCommitment: credential.districtCommitment ?? null,
			revocationStatus: credential.revocationStatus ?? null,
			revocationAttempts: credential.revocationAttempts ?? 0
		};
	}
});

/**
 * Internal mutation: update the on-chain revocation state of a credential.
 * Conditional patch builder — only sets the fields the caller passed, so a
 * retry-bump does not clobber unrelated fields.
 */
export const updateRevocationState = internalMutation({
	args: {
		credentialId: v.id('districtCredentials'),
		revocationStatus: v.optional(
			v.union(v.literal('pending'), v.literal('confirmed'), v.literal('failed'))
		),
		revocationTxHash: v.optional(v.string()),
		revocationAttempts: v.optional(v.number()),
		revocationLastAttemptAt: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const patch: Record<string, unknown> = {};
		if (args.revocationStatus !== undefined) patch.revocationStatus = args.revocationStatus;
		if (args.revocationTxHash !== undefined) patch.revocationTxHash = args.revocationTxHash;
		if (args.revocationAttempts !== undefined) patch.revocationAttempts = args.revocationAttempts;
		if (args.revocationLastAttemptAt !== undefined)
			patch.revocationLastAttemptAt = args.revocationLastAttemptAt;
		if (Object.keys(patch).length > 0) {
			await ctx.db.patch(args.credentialId, patch);
		}
	}
});

/**
 * Internal action: submit a single credential's revocation nullifier to the
 * on-chain RevocationRegistry via the operator-funded relayer endpoint.
 *
 * Flow:
 *   1. Read credential, early-exit if already confirmed/failed or missing
 *      districtCommitment.
 *   2. POST to internal `/api/internal/emit-revocation` endpoint with
 *      districtCommitment. The endpoint derives revocationNullifier
 *      server-side (shares the same poseidon2 wrapper as the circuit) and
 *      calls RevocationRegistry.emitRevocation.
 *   3. On success: status=confirmed + txHash.
 *   4. On transient failure: increment attempts; schedule next retry per
 *      REVOCATION_BACKOFF_MS.
 *   5. On terminal failure (attempts exhausted): status=failed + alert.
 */
export const emitOnChainRevocation = internalAction({
	args: { credentialId: v.id('districtCredentials') },
	handler: async (ctx, { credentialId }) => {
		const credential = await ctx.runQuery(internal.users.getCredentialForRevocation, {
			credentialId
		});
		if (!credential) return;
		if (credential.revocationStatus === 'confirmed' || credential.revocationStatus === 'failed') {
			return;
		}
		if (!credential.districtCommitment) {
			// Cannot derive revocation_nullifier without a commitment. Mark failed
			// so ops can audit; server-layer gate is still in effect.
			await ctx.runMutation(internal.users.updateRevocationState, {
				credentialId,
				revocationStatus: 'failed',
				revocationLastAttemptAt: Date.now()
			});
			return;
		}

		const internalUrl = process.env.COMMONS_INTERNAL_URL;
		const internalSecret = process.env.INTERNAL_API_SECRET;
		if (!internalUrl || !internalSecret) {
			console.error(
				`[emitOnChainRevocation] Missing COMMONS_INTERNAL_URL or INTERNAL_API_SECRET — credential=${credentialId} stays pending`
			);
			// Do not advance attempts; this is an env misconfiguration, not a
			// failure we want to retry-limit.
			return;
		}

		const attempts = (credential.revocationAttempts ?? 0) + 1;
		await ctx.runMutation(internal.users.updateRevocationState, {
			credentialId,
			revocationAttempts: attempts,
			revocationLastAttemptAt: Date.now()
		});

		try {
			const response = await fetch(`${internalUrl}/api/internal/emit-revocation`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-Internal-Secret': internalSecret
				},
				body: JSON.stringify({
					credentialId: String(credentialId),
					districtCommitment: credential.districtCommitment
				})
			});

			const result: {
				success?: boolean;
				txHash?: string;
				error?: string;
				kind?: 'success' | 'rpc_transient' | 'contract_revert' | 'config';
			} = await response.json().catch(() => ({}));

			if (response.ok && result.success === true) {
				await ctx.runMutation(internal.users.updateRevocationState, {
					credentialId,
					revocationStatus: 'confirmed',
					revocationTxHash: typeof result.txHash === 'string' ? result.txHash : undefined
				});
				return;
			}

			// Stage 5.5a: `kind='contract_revert'` is terminal — retrying hits the
			// same revert (AlreadyRevoked, UnauthorizedRelayer, Paused). Short-circuit
			// to 'failed' immediately and alert so operators can investigate,
			// instead of burning the 6-attempt retry budget on gas-wasting retries.
			// `kind='config'` is likewise terminal: the endpoint cannot make progress
			// without env changes. `rpc_transient` and missing-kind fall through to
			// the existing backoff + budget logic.
			if (result.kind === 'contract_revert' || result.kind === 'config') {
				await ctx.runMutation(internal.users.updateRevocationState, {
					credentialId,
					revocationStatus: 'failed'
				});
				try {
					await fetch(`${internalUrl}/api/internal/alert`, {
						method: 'POST',
						headers: {
							'Content-Type': 'application/json',
							'X-Internal-Secret': internalSecret
						},
						body: JSON.stringify({
							code: 'REVOCATION_EMIT_FAILED',
							severity: 'error',
							message: `RevocationRegistry emit returned terminal ${result.kind} for credential ${credentialId}`,
							context: {
								credentialId: String(credentialId),
								kind: result.kind,
								lastError: result.error?.slice(0, 200)
							}
						})
					});
				} catch (alertErr) {
					console.error('[emitOnChainRevocation] alert fire failed:', alertErr);
				}
				return;
			}

			// Transient failure — schedule retry if budget remains.
			if (attempts >= MAX_REVOCATION_ATTEMPTS) {
				await ctx.runMutation(internal.users.updateRevocationState, {
					credentialId,
					revocationStatus: 'failed'
				});
				// Fire operator alert (fire-and-forget).
				try {
					await fetch(`${internalUrl}/api/internal/alert`, {
						method: 'POST',
						headers: {
							'Content-Type': 'application/json',
							'X-Internal-Secret': internalSecret
						},
						body: JSON.stringify({
							code: 'REVOCATION_EMIT_FAILED',
							severity: 'error',
							message: `RevocationRegistry emit retries exhausted for credential ${credentialId}`,
							context: {
								credentialId: String(credentialId),
								attempts,
								lastError: result.error?.slice(0, 200)
							}
						})
					});
				} catch (alertErr) {
					console.error('[emitOnChainRevocation] alert fire failed:', alertErr);
				}
				return;
			}

			const delayMs =
				REVOCATION_BACKOFF_MS[Math.min(attempts - 1, REVOCATION_BACKOFF_MS.length - 1)];
			await ctx.scheduler.runAfter(delayMs, internal.users.emitOnChainRevocation, {
				credentialId
			});
		} catch (err) {
			console.error(
				`[emitOnChainRevocation] network error credential=${credentialId}:`,
				err instanceof Error ? err.message : err
			);
			// Treat as transient; retry budget applies.
			if (attempts >= MAX_REVOCATION_ATTEMPTS) {
				await ctx.runMutation(internal.users.updateRevocationState, {
					credentialId,
					revocationStatus: 'failed'
				});
			} else {
				const delayMs =
					REVOCATION_BACKOFF_MS[Math.min(attempts - 1, REVOCATION_BACKOFF_MS.length - 1)];
				await ctx.scheduler.runAfter(delayMs, internal.users.emitOnChainRevocation, {
					credentialId
				});
			}
		}
	}
});

/**
 * Internal query: list credentials whose on-chain revocation has been pending
 * for too long. Drives the stuck-pending cron (every 15 min).
 */
export const listStuckRevocations = internalQuery({
	args: { olderThanMs: v.number() },
	handler: async (ctx, { olderThanMs }) => {
		const cutoff = Date.now() - olderThanMs;
		const rows = await ctx.db
			.query('districtCredentials')
			.withIndex('by_revocationStatus', (q) => q.eq('revocationStatus', 'pending'))
			.filter((q) =>
				q.or(
					q.eq(q.field('revocationLastAttemptAt'), undefined),
					q.lt(q.field('revocationLastAttemptAt'), cutoff)
				)
			)
			.take(100);
		return rows.map((r) => ({
			_id: r._id,
			revocationAttempts: r.revocationAttempts ?? 0
		}));
	}
});

/**
 * Internal action: re-schedule stuck-pending revocations. Runs every 15 min
 * via convex/crons.ts. Re-queues any credential in 'pending' whose last
 * attempt is older than STUCK_PENDING_AGE_MS, up to the retry budget.
 */
export const rescheduleStuckRevocations = internalAction({
	args: {},
	handler: async (ctx) => {
		const stuck = await ctx.runQuery(internal.users.listStuckRevocations, {
			olderThanMs: STUCK_PENDING_AGE_MS
		});
		for (const row of stuck) {
			if (row.revocationAttempts >= MAX_REVOCATION_ATTEMPTS) continue;
			await ctx.scheduler.runAfter(0, internal.users.emitOnChainRevocation, {
				credentialId: row._id
			});
		}
	}
});

// =============================================================================
// OPERATOR RESCUE — Stage 5.5c
// =============================================================================
//
// When a credential's on-chain revocation emit exhausts the 6-attempt retry
// budget, `revocationStatus` flips to 'failed'. Before Stage 5.5 the only
// recourse was manual Convex-dashboard edits; that is error-prone and leaves
// no audit trail. These two functions give operators a first-class path:
//
//   listFailedRevocations() — surface failed rows for triage.
//   rescueFailedRevocation({credentialId}) — reset to 'pending' and re-queue
//                                            the scheduled emit.
//
// Security model: both are `internalQuery` / `internalMutation`. Callers must
// hold a Convex admin deploy key — the same posture as the cutover script.
// Opening these as a public `query`/`mutation` would let any authenticated
// user force-retry a failed emit against the relayer wallet (gas drain).

/**
 * Internal query: list credentials whose on-chain revocation emit has
 * terminally failed (retry budget exhausted). Used by operator tooling to
 * triage and by the V2-CREDENTIAL-CUTOVER runbook's Recovery section.
 *
 * Returns the minimal fields needed for triage — no PII, no userId→email
 * correlation material. Operators correlate via Convex dashboard if needed.
 */
export const listFailedRevocations = internalQuery({
	args: { limit: v.optional(v.number()) },
	handler: async (ctx, { limit }) => {
		const rows = await ctx.db
			.query('districtCredentials')
			.withIndex('by_revocationStatus', (q) => q.eq('revocationStatus', 'failed'))
			.take(Math.min(limit ?? 100, 500));
		return rows.map((r) => ({
			_id: r._id,
			userId: r.userId,
			revokedAt: r.revokedAt,
			revocationAttempts: r.revocationAttempts ?? 0,
			revocationLastAttemptAt: r.revocationLastAttemptAt,
			hasDistrictCommitment: Boolean(r.districtCommitment)
		}));
	}
});

/**
 * Internal mutation: rescue a `revocationStatus='failed'` credential by
 * resetting its retry state and scheduling a fresh emit. Idempotent — calling
 * against a non-failed row is a no-op returning `{rescued: false, reason}`.
 *
 * The operator is expected to have already investigated WHY the prior emits
 * failed (relayer balance low? RPC degraded? registry paused?) and remediated
 * before calling this. Rescuing without remediation will just burn the retry
 * budget again.
 *
 * Wrapped as an `internalMutation` so the Convex deploy-key gate is the only
 * path to invoke it — matches the cutover script's access posture.
 */
export const rescueFailedRevocation = internalMutation({
	args: { credentialId: v.id('districtCredentials') },
	handler: async (ctx, { credentialId }) => {
		const cred = await ctx.db.get(credentialId);
		if (!cred) {
			return { rescued: false as const, reason: 'not_found' as const };
		}
		if (cred.revocationStatus !== 'failed') {
			return {
				rescued: false as const,
				reason: 'not_failed' as const,
				currentStatus: cred.revocationStatus ?? null
			};
		}
		// Require a districtCommitment — rescuing a row without one cannot derive
		// a revocation_nullifier, so the emit would just flip back to 'failed'
		// immediately (see emitOnChainRevocation early-exit guard). Block here
		// to avoid retry-budget churn and surface the underlying data problem.
		if (!cred.districtCommitment) {
			return {
				rescued: false as const,
				reason: 'missing_district_commitment' as const
			};
		}

		await ctx.db.patch(credentialId, {
			revocationStatus: 'pending' as const,
			revocationAttempts: 0,
			revocationLastAttemptAt: Date.now()
		});

		await ctx.scheduler.runAfter(0, internal.users.emitOnChainRevocation, {
			credentialId
		});

		return { rescued: true as const };
	}
});
