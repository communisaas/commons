import {
	query,
	mutation,
	action,
	internalQuery,
	internalMutation,
	internalAction,
	type MutationCtx,
	type QueryCtx
} from './_generated/server';
import { makeFunctionReference, type FunctionReference } from 'convex/server';
import { ConvexError, v } from 'convex/values';
import { internal } from './_generated/api';
import { requireAuth } from './_authHelpers';
import { requireInternalSecret } from './_internalAuth';
import { selectActiveCredentialForUser } from './_credentialSelect';
import { applyDowngradeGuardFromHistory } from './_downgradeGuard';
import { upsertExternalId } from './_externalIds';
import type { Doc, Id } from './_generated/dataModel';
import {
	TEMPLATE_LIST_MAX_PAGE_SIZE,
	readTemplateListPageByUser,
	templateListPaginationValidator,
	toProfileTemplateListItem
} from './lib/templateListProjection';
import { syncSessionAuthority } from './lib/sessionAuthority';
import { reputationStateForActionCount } from './lib/reputationTier';
import {
	SHADOW_ATLAS_ENGAGEMENT_CACHE_TTL_MS,
	SHADOW_ATLAS_ENGAGEMENT_FAILURE_COOLDOWN_MS,
	SHADOW_ATLAS_ENGAGEMENT_LEASE_MS,
	SHADOW_ATLAS_ENGAGEMENT_REPAIR_OBSERVATION_MS,
	assertShadowAtlasEngagementSnapshot,
	assertShadowAtlasLeafIndex,
	assertShadowAtlasLeaseToken,
	assertShadowAtlasRegistrationGeneration,
	normalizeShadowAtlasIdentityCommitment,
	normalizeShadowAtlasRepairReference,
	normalizeShadowAtlasSignerAddress,
	shadowAtlasEngagementSnapshotValidator,
	type ShadowAtlasEngagementState
} from './lib/shadowAtlasEngagement';
import {
	SHADOW_ATLAS_TREE1_MAX_GENERATION,
	SHADOW_ATLAS_TREE1_REPAIR_OBSERVATION_MS,
	assertShadowAtlasTree1FailureCode,
	assertShadowAtlasTree1Generation,
	assertShadowAtlasTree1IdempotencyKey,
	assertShadowAtlasTree1LeafDigest,
	assertShadowAtlasTree1LeafIndex,
	assertShadowAtlasTree1Proof,
	normalizeShadowAtlasTree1Identity,
	publicShadowAtlasCongressionalDistrict,
	sameShadowAtlasTree1Proof,
	type ShadowAtlasTree1Operation,
	type ShadowAtlasTree1OperationState,
	type ShadowAtlasTree1Proof
} from './lib/shadowAtlasRegistration';
import {
	MAX_REVERIFICATIONS_PER_180D,
	MAX_USERIDS_PER_EMAIL_HASH_180D,
	ONE_EIGHTY_DAYS_MS,
	TWENTY_FOUR_HOURS_MS,
	hasEverHeldDistrictCommitment,
	readCredentialToReplace,
	readRecentEmailHashUsers,
	readReverificationWindow
} from './lib/credentialHistory';

// =============================================================================
// USERS — Queries & Mutations
// =============================================================================

const MAX_VERIFICATION_OFFICIALS = 10;
const PROFILE_REPRESENTATIVE_MAX_BYTES = 32 * 1024;
const PROFILE_REPRESENTATIVE_NAME_MAX_CHARS = 256;
const PROFILE_REPRESENTATIVE_SHORT_FIELD_MAX_CHARS = 64;

function boundedProfileField(value: string | undefined, maxChars: number): string | null {
	return typeof value === 'string' ? value.slice(0, maxChars) : null;
}

function profileRepresentativeChamber(title: string | undefined): string {
	const normalized = title?.trim().toLowerCase() ?? '';
	if (normalized.includes('senator')) return 'senate';
	if (normalized.includes('representative') || normalized.includes('delegate')) return 'house';
	return '';
}

function assertTrustedQueryAsOf(asOf: number): void {
	if (!Number.isSafeInteger(asOf) || asOf < 0) throw new Error('INVALID_QUERY_AS_OF');
}

/**
 * Internal: Look up user by email hash (used by auth helpers and delegation).
 * Accepts either an email (computes hash) or a pre-computed emailHash.
 */

declare const process: { env: Record<string, string | undefined> };
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
			addressVerifiedAt: user.addressVerifiedAt ?? null,
			hasPasskey: Boolean(user.passkeyCredentialId),
			districtHash: user.districtHash ?? null,
			districtVerified: user.districtVerified ?? false,
			hasWallet: Boolean(user.walletAddress),
			trustScore: user.trustScore ?? 0,
			reputationTier: user.reputationTier ?? 'new',
			role: user.role ?? null,
			organization: user.organization ?? null,
			location: user.location ?? null,
			connection: user.connection ?? null,
			profileVisibility: user.profileVisibility ?? 'private',
			profileCompletedAt: user.profileCompletedAt ?? null
		};
	}
});

/** Authenticated, bounded template page for the current user's profile. */
export const getMyTemplatesPage = query({
	args: { paginationOpts: templateListPaginationValidator },
	handler: async (ctx, { paginationOpts }) => {
		const { userId } = await requireAuth(ctx);
		const result = await readTemplateListPageByUser(
			ctx,
			userId,
			paginationOpts,
			'INVALID_PROFILE_TEMPLATE_PAGE_SIZE'
		);
		return { ...result, page: result.page.map(toProfileTemplateListItem) };
	}
});

/**
 * @deprecated Use `getMyTemplatesPage`.
 *
 * Intentional safety correction: this legacy array is compact and never
 * rehydrates canonical configs or embeddings. It is exact only when the whole
 * range fits one bounded page and fails explicitly instead of truncating.
 */
export const getMyTemplates = query({
	args: {},
	handler: async (ctx) => {
		const { userId } = await requireAuth(ctx);
		const result = await readTemplateListPageByUser(
			ctx,
			userId,
			{
				cursor: null,
				numItems: TEMPLATE_LIST_MAX_PAGE_SIZE
			},
			'INVALID_PROFILE_TEMPLATE_PAGE_SIZE'
		);
		if (!result.isDone) {
			throw new ConvexError({
				code: 'PROFILE_TEMPLATE_PAGINATION_REQUIRED',
				maxPageSize: TEMPLATE_LIST_MAX_PAGE_SIZE
			});
		}
		return result.page.map(toProfileTemplateListItem);
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
			.withIndex('by_userId_isActive_decisionMakerId', (q) =>
				q.eq('userId', userId).eq('isActive', true)
			)
			.take(MAX_VERIFICATION_OFFICIALS);
		if (relations.length === 0) return [];

		// The profile needs five small display fields, not the full decision-maker
		// documents (which may carry delivery configuration). The relation count and
		// every returned string are capped; the running four-bytes-per-code-unit
		// bound makes the response budget explicit even for non-ASCII text.
		const representatives: Array<{
			name: string;
			party: string | null;
			chamber: string;
			state: string | null;
			district: string | null;
		}> = [];
		let outputBytesUpperBound = 2;
		for (const relation of relations) {
			const representative = await ctx.db.get(relation.decisionMakerId);
			if (!representative) continue;
			const summary = {
				name: representative.name.slice(0, PROFILE_REPRESENTATIVE_NAME_MAX_CHARS),
				party: boundedProfileField(
					representative.party,
					PROFILE_REPRESENTATIVE_SHORT_FIELD_MAX_CHARS
				),
				chamber: profileRepresentativeChamber(representative.title),
				state: boundedProfileField(
					representative.jurisdiction,
					PROFILE_REPRESENTATIVE_SHORT_FIELD_MAX_CHARS
				),
				district: boundedProfileField(
					representative.district,
					PROFILE_REPRESENTATIVE_SHORT_FIELD_MAX_CHARS
				)
			};
			const summaryBytesUpperBound = JSON.stringify(summary).length * 4 + 1;
			if (outputBytesUpperBound + summaryBytesUpperBound > PROFILE_REPRESENTATIVE_MAX_BYTES) {
				break;
			}
			representatives.push(summary);
			outputBytesUpperBound += summaryBytesUpperBound;
		}
		return representatives;
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
		await syncSessionAuthority(ctx, userId);

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
		await syncSessionAuthority(ctx, userId);

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

async function markActiveGroundVaultsForRewrap(ctx: { db: any }, userId: unknown, now: number) {
	const activeVaults = await ctx.db
		.query('groundVaults')
		.withIndex('by_userId_status', (q: any) => q.eq('userId', userId).eq('status', 'active'))
		.take(2);
	if (activeVaults.length > 1) throw new Error('GROUND_VAULT_MULTIPLICITY');
	for (const vault of activeVaults) {
		await ctx.db.patch(vault._id, {
			status: 'rewrap_needed',
			updatedAt: now
		});
	}
}

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
 * Store the user's current passkey credential after server-side WebAuthn
 * registration verification.
 *
 * The historic passkeyPublicKeyJwk field is retained for existing rows, but
 * SimpleWebAuthn v13 verifies authentication with COSE public key bytes.
 */
export const storePasskey = mutation({
	args: {
		userId: v.id('users'),
		credentialId: v.string(),
		publicKey: v.string(),
		counter: v.number(),
		transports: v.optional(v.array(v.string())),
		deviceType: v.optional(v.string()),
		backedUp: v.optional(v.boolean()),
		aaguid: v.optional(v.string()),
		didKey: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const { userId: authUserId } = await requireAuth(ctx);
		if (args.userId !== authUserId) throw new Error('Unauthorized');
		const user = await ctx.db.get(args.userId);
		if (!user) throw new Error('User not found');

		const now = Date.now();
		const activeWrappers = await ctx.db
			.query('passkeyVaultWrappers')
			.withIndex('by_userId_status', (q) => q.eq('userId', args.userId).eq('status', 'active'))
			.take(2);
		if (activeWrappers.length > 1) throw new Error('GROUND_WRAPPER_MULTIPLICITY');
		for (const wrapper of activeWrappers) {
			await ctx.db.patch(wrapper._id, {
				status: 'revoked',
				revokedAt: now,
				updatedAt: now
			});
		}
		await markActiveGroundVaultsForRewrap(ctx, args.userId, now);

		await ctx.db.patch(args.userId, {
			passkeyCredentialId: args.credentialId,
			passkeyPublicKey: args.publicKey,
			passkeyCounter: args.counter,
			passkeyTransports: args.transports,
			passkeyDeviceType: args.deviceType,
			passkeyBackedUp: args.backedUp,
			passkeyAaguid: args.aaguid,
			didKey: args.didKey,
			passkeyCreatedAt: now,
			passkeyLastUsedAt: now,
			updatedAt: now
		});
		await syncSessionAuthority(ctx, args.userId);
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
		const now = Date.now();
		const wrappers = await ctx.db
			.query('passkeyVaultWrappers')
			.withIndex('by_userId_status', (q) => q.eq('userId', args.userId).eq('status', 'active'))
			.take(2);
		if (wrappers.length > 1) throw new Error('GROUND_WRAPPER_MULTIPLICITY');
		for (const wrapper of wrappers) {
			await ctx.db.patch(wrapper._id, {
				status: 'revoked',
				revokedAt: now,
				updatedAt: now
			});
		}
		await markActiveGroundVaultsForRewrap(ctx, args.userId, now);
		await ctx.db.patch(args.userId, {
			passkeyCredentialId: undefined,
			passkeyPublicKeyJwk: undefined,
			passkeyPublicKey: undefined,
			passkeyCounter: undefined,
			passkeyTransports: undefined,
			passkeyDeviceType: undefined,
			passkeyBackedUp: undefined,
			passkeyAaguid: undefined,
			passkeyCreatedAt: undefined,
			passkeyLastUsedAt: undefined,
			didKey: undefined,
			updatedAt: now
		});
		await syncSessionAuthority(ctx, args.userId);
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
		await syncSessionAuthority(ctx, args.userId);
	}
});

const MDL_CREDENTIAL_REUSE_COOLDOWN_MS = 10 * 60 * 1000;
const MDL_CREDENTIAL_HASH_REUSED = 'MDL_CREDENTIAL_HASH_REUSED';
const MDL_SESSION_NONCE_REUSED = 'MDL_SESSION_NONCE_REUSED';
const MDL_CREDENTIAL_HASH_INVALID = 'MDL_CREDENTIAL_HASH_INVALID';

/**
 * Server-only mDL finalizer.
 *
 * Browser-mediated Digital Credentials and direct verification routes have
 * already authenticated the flow before calling this internal mutation.
 * Keeping commitment binding and the tier upgrade in one internal mutation
 * avoids two bad states:
 *   - direct wallet completion failing because the phone request has no Convex auth
 *   - account-merge flows failing when the canonical user is not the session user
 */
export const finalizeMdlVerification = mutation({
	args: {
		_secret: v.string(),
		userId: v.id('users'),
		identityCommitment: v.string(),
		credentialHash: v.string(),
		nonce: v.string(),
		protocol: v.string(),
		sessionChannel: v.union(v.literal('digital-credentials'), v.literal('direct')),
		verifiedAt: v.number(),
		addressVerificationMethod: v.string(),
		documentType: v.string(),
		identityHash: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		requireInternalSecret(args._secret);
		const existingCommitments = await ctx.db
			.query('users')
			.withIndex('by_identityCommitment', (q) =>
				q.eq('identityCommitment', args.identityCommitment)
			)
			.take(2);
		if (existingCommitments.length > 1) {
			throw new Error('IDENTITY_COMMITMENT_CARDINALITY_REPAIR_REQUIRED');
		}
		const existing = existingCommitments[0];

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
			.withIndex('by_credentialHash_expiresAt', (q) =>
				q.eq('credentialHash', args.credentialHash).gt('expiresAt', now)
			)
			.first();

		if (activeReuse) {
			throw new Error(MDL_CREDENTIAL_HASH_REUSED);
		}

		const activeNonceReuse = await ctx.db
			.query('mdlCredentialUses')
			.withIndex('by_nonce_expiresAt', (q) => q.eq('nonce', args.nonce).gt('expiresAt', now))
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
		await syncSessionAuthority(ctx, canonicalUserId);

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

// H1 — must stay in sync with src/lib/core/identity/session-credentials.ts
// CELL_ANCHOR_MODES. Convex functions cannot import from src/lib (different
// runtime root), so we duplicate the allowlist here. If you add a value to
// the canonical list, update this allowlist or the mutation will reject it.
const CELL_ANCHOR_MODES_ALLOWLIST = [
	'address-resolved',
	'random-fallback',
	'recovery-explicit',
	'recovery-pivot',
	'legacy-inferred',
	'legacy-unknown'
] as const;

export const verifyAddress = mutation({
	args: {
		_secret: v.string(),
		userId: v.id('users'),
		district: v.optional(v.string()),
		stateSenateDistrict: v.optional(v.string()),
		stateAssemblyDistrict: v.optional(v.string()),
		countyFips: v.optional(v.string()),
		congressionalDistrictSource: v.optional(v.string()),
		stateSenateDistrictSource: v.optional(v.string()),
		stateAssemblyDistrictSource: v.optional(v.string()),
		countyFipsSource: v.optional(v.string()),
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
		),
		// H1 — trust-context plumbed through from the client when available.
		// All optional. Server snapshots `user.trustTier` separately (clients
		// must not be able to self-assert tier). Legacy callers omit these and
		// the corresponding fields stay undefined on the credential row.
		cellStraddles: v.optional(v.boolean()),
		cellAnchorMode: v.optional(v.string()),
		atlasVersion: v.optional(v.string()),
		// B3 — district-resolution freshness provenance, pass-through-when-known.
		// All optional. `null` is a legitimate value meaning "resolver had no
		// clock" (honestly-unknown) and is DISTINCT from undefined ("legacy caller
		// omitted the field"). boundaryAsOf and officialsAsOf are two independent
		// clocks; never copy one into the other.
		boundaryAsOf: v.optional(v.union(v.string(), v.null())),
		officialsAsOf: v.optional(v.union(v.string(), v.null())),
		tigerVintage: v.optional(v.string()),
		resolutionConfidence: v.optional(v.float64())
	},
	handler: async (ctx, args) => {
		// Trust gate: only SvelteKit's `/api/identity/verify-address` route
		// (which validates the address_token proving the user actually
		// completed address verification) may invoke this. Without this gate,
		// any authenticated user could self-issue district credentials with
		// arbitrary claims via direct Convex call — bypassing the address-
		// verification artifact check and inflating their own trust tier.
		requireInternalSecret(args._secret);
		// The SvelteKit route already caps this array, but the mutation is a second
		// trust boundary. Reject direct/internal callers before auth or any database
		// work so an oversized roster cannot amplify relation/decision-maker writes.
		if ((args.officials?.length ?? 0) > MAX_VERIFICATION_OFFICIALS) {
			throw new Error('ADDRESS_VERIFICATION_OFFICIALS_LIMIT_EXCEEDED');
		}

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
		if (args.countyFips !== undefined && !/^\d{5}$/.test(args.countyFips)) {
			throw new Error('INVALID_COUNTY_FIPS');
		}
		const containmentSources = [
			args.congressionalDistrictSource,
			args.stateSenateDistrictSource,
			args.stateAssemblyDistrictSource,
			args.countyFipsSource
		];
		for (const source of containmentSources) {
			if (source !== undefined && source !== 'atlas-derived' && source !== 'self-reported') {
				throw new Error('INVALID_CONTAINMENT_SOURCE');
			}
		}
		if (
			(args.congressionalDistrictSource !== undefined && !args.district?.trim()) ||
			(args.stateSenateDistrictSource !== undefined && !args.stateSenateDistrict?.trim()) ||
			(args.stateAssemblyDistrictSource !== undefined && !args.stateAssemblyDistrict?.trim()) ||
			(args.countyFipsSource !== undefined && args.countyFips === undefined) ||
			(args.countyFips !== undefined && args.countyFipsSource !== 'atlas-derived') ||
			args.countyFipsSource === 'self-reported'
		) {
			throw new Error('INVALID_CONTAINMENT_SOURCE');
		}

		// H1 — defend cellAnchorMode at the handler boundary. Schema is permissive
		// (v.optional(v.string())) for forward-compat, but unknown values would
		// silently corrupt H6 outbound copy and H5 cross-check semantics. Reject
		// at the door instead.
		if (
			args.cellAnchorMode !== undefined &&
			!CELL_ANCHOR_MODES_ALLOWLIST.includes(
				args.cellAnchorMode as (typeof CELL_ANCHOR_MODES_ALLOWLIST)[number]
			)
		) {
			throw new Error('INVALID_CELL_ANCHOR_MODE');
		}

		// H5 — structural cross-check on client-asserted cellAnchorMode. Defense
		// in depth: the cell-anchor mode is provenance metadata, but it's
		// client-supplied and unverified. We can't crypto-prove it, but we CAN
		// check that the asserted value is consistent with server-known facts:
		//   - 'legacy-*' values are reserved for READ-side backfill (pre-G8
		//     credentials get them inferred at session-credential read). A
		//     fresh write must never claim a legacy mode — if it does, the
		//     client is buggy or malicious.
		//   - 'address-resolved' implies the user had a real cell to resolve
		//     to. A user at tier 0 (no verification at all) cannot have a
		//     real cell — they came in via the random-fallback path. NOTE:
		//     verifyAddress itself bumps tier to ≥ 2 for civic_api/postal
		//     paths, so user.trustTier read at the START of the handler is
		//     pre-bump. mDL users come in already at 5.
		//   - 'random-fallback' AND user.trustTier ≥ 3 (mDL-verified) is a
		//     structural inconsistency: mDL users have a wallet-derived cell.
		//     Could be a legitimate edge (atlas migration mid-flight) so we
		//     warn rather than reject.
		if (args.cellAnchorMode === 'legacy-inferred' || args.cellAnchorMode === 'legacy-unknown') {
			throw new Error('INVALID_CELL_ANCHOR_MODE_LEGACY_RESERVED');
		}
		if (args.cellAnchorMode === 'address-resolved' && user.trustTier < 1) {
			throw new Error('INVALID_CELL_ANCHOR_MODE_TIER_MISMATCH');
		}
		if (args.cellAnchorMode === 'random-fallback' && user.trustTier >= 3) {
			// Soft-warn (don't reject) — legitimate edge cases exist (mDL
			// completed but client lost cell during atlas migration). Ops
			// should grep for this in logs to spot client tampering trends.
			console.warn(
				'[verifyAddress H5] cellAnchorMode=random-fallback inconsistent with trustTier>=3',
				{ userId: args.userId, trustTier: user.trustTier }
			);
		}

		const tierBypass = user.trustTier >= 3;
		const [hasEverHeldCommitment, credentialToReplace, recentCredentials, recentSiblings] =
			await Promise.all([
				hasEverHeldDistrictCommitment(ctx, args.userId),
				readCredentialToReplace(ctx, args.userId),
				tierBypass ? Promise.resolve([]) : readReverificationWindow(ctx, args.userId, now),
				!tierBypass && user.emailHash
					? readRecentEmailHashUsers(ctx, user.emailHash, now)
					: Promise.resolve([])
			]);

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
		// server access to the H3 cell data and is out of scope for step.
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
		const guardResult = applyDowngradeGuardFromHistory(
			hasEverHeldCommitment,
			args.districtCommitment
		);
		if (guardResult !== null) {
			throw new Error(guardResult);
		}

		// (1c) Re-verification throttle — bypass at trust_tier >= 3 (mDL-verified identity).
		if (!tierBypass) {
			const mostRecent = recentCredentials[0];
			if (mostRecent && now - mostRecent.issuedAt < TWENTY_FOUR_HOURS_MS) {
				throw new Error('ADDRESS_VERIFICATION_THROTTLED_24H');
			}
			if (recentCredentials.length >= MAX_REVERIFICATIONS_PER_180D) {
				throw new Error('ADDRESS_VERIFICATION_THROTTLED_180D');
			}

			// Email-sybil gate: cap distinct userIds sharing this emailHash within
			// the trailing 180-day window. Throwaway-account farms bypass per-userId
			// throttle; this closes that hole while permitting legitimate users who
			// have accumulated accounts over years (measured by users._creationTime).
			if (recentSiblings.length > MAX_USERIDS_PER_EMAIL_HASH_180D) {
				throw new Error('ADDRESS_VERIFICATION_EMAIL_SYBIL');
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
		const credentialsToRevoke = credentialToReplace ? [credentialToReplace] : [];
		for (const cred of credentialsToRevoke) {
			const scheduleOnChain = Boolean(cred.districtCommitment);
			await ctx.db.patch(cred._id, {
				revokedAt: now,
				retirementReason: 'superseded_by_reissue' as const,
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

		// H1r F3 — capture the EFFECTIVE trustTier (post-userPatch), not the
		// pre-flow tier. For a tier-0/1 user verifying via civic_api, the credential
		// itself ESTABLISHES tier 2; rendering /v/[hash] as "tier 1 credential"
		// would be misleading. mDL users (tier ≥ 3) keep their tier (Math.max
		// preserves the higher value). The userPatch below applies the same
		// formula to users.trustTier, so the credential row matches user state
		// at end-of-mutation.
		const effectiveTrustTier = Math.max(user.trustTier, 2);

		// Create new credential.
		//
		// H1 — trust-context fields. trustTier is server-derived (effective
		// post-issuance value, see above), not client-supplied: clients must
		// not be able to forge their own tier label. The other three
		// (cellStraddles, cellAnchorMode, atlasVersion) are pass-through-
		// when-known: the client knows them from session-credentials state,
		// and H5 will structurally cross-check cellAnchorMode against
		// authorityLevel and h3Cell-presence. H0r CRITICAL: omit each field
		// when args don't supply it, do NOT default — `undefined` on the row
		// means "unknown at issuance", and H6 must surface that distinctly
		// from "false/clean".
		const districtCredentialId = await ctx.db.insert('districtCredentials', {
			userId: args.userId,
			credentialType: 'district_residency',
			congressionalDistrict: args.district ?? '',
			stateSenateDistrict: args.stateSenateDistrict,
			stateAssemblyDistrict: args.stateAssemblyDistrict,
			...(args.countyFips !== undefined ? { countyFips: args.countyFips } : {}),
			...(args.congressionalDistrictSource !== undefined
				? { congressionalDistrictSource: args.congressionalDistrictSource }
				: {}),
			...(args.stateSenateDistrictSource !== undefined
				? { stateSenateDistrictSource: args.stateSenateDistrictSource }
				: {}),
			...(args.stateAssemblyDistrictSource !== undefined
				? { stateAssemblyDistrictSource: args.stateAssemblyDistrictSource }
				: {}),
			...(args.countyFipsSource !== undefined ? { countyFipsSource: args.countyFipsSource } : {}),
			verificationMethod: args.verificationMethod,
			issuedAt: now,
			expiresAt: args.expiresAt,
			credentialHash: args.credentialHash ?? '',
			districtCommitment: args.districtCommitment,
			slotCount: args.slotCount,
			// H1 trust-context snapshot. trustTier reflects the user's state at
			// end-of-mutation (after the userPatch below). The other three are
			// spread-conditional so omitted args produce undefined fields, not
			// literal defaults.
			trustTier: effectiveTrustTier,
			...(args.cellStraddles !== undefined ? { cellStraddles: args.cellStraddles } : {}),
			...(args.cellAnchorMode !== undefined ? { cellAnchorMode: args.cellAnchorMode } : {}),
			...(args.atlasVersion !== undefined ? { atlasVersion: args.atlasVersion } : {}),
			// B3 freshness provenance — persisted VERBATIM. The `!== undefined`
			// guard keeps absent args as undefined ("pre-dates field"), while a
			// client-supplied `null` ("honestly unknown") is written through as a
			// real value. We never fabricate a date and never copy boundaryAsOf
			// into officialsAsOf (or vice versa).
			...(args.boundaryAsOf !== undefined ? { boundaryAsOf: args.boundaryAsOf } : {}),
			...(args.officialsAsOf !== undefined ? { officialsAsOf: args.officialsAsOf } : {}),
			...(args.tigerVintage !== undefined ? { tigerVintage: args.tigerVintage } : {}),
			...(args.resolutionConfidence !== undefined
				? { resolutionConfidence: args.resolutionConfidence }
				: {})
		});

		// Update user
		const userPatch: Record<string, unknown> = {
			trustTier: effectiveTrustTier,
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
		await syncSessionAuthority(ctx, args.userId);

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
				.withIndex('by_userId_isActive_decisionMakerId', (q) =>
					q.eq('userId', args.userId).eq('isActive', true)
				)
				.take(MAX_VERIFICATION_OFFICIALS + 1);
			if (existingRelations.length > MAX_VERIFICATION_OFFICIALS) {
				throw new Error('USER_DM_ACTIVE_RELATION_LIMIT_EXCEEDED');
			}
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
					await upsertExternalId(ctx, dmId, 'bioguide', official.bioguideId);
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

		return {
			districtCredentialId,
			revokedCredentialIds: credentialsToRevoke.map((cred) => cred._id)
		};
	}
});

/**
 * Get user's did_key for credential issuance.
 */
export const getDidKey = query({
	args: { userId: v.id('users') },
	handler: async (ctx, args) => {
		const { userId: authUserId } = await requireAuth(ctx);
		if (args.userId !== authUserId) throw new Error('Unauthorized');
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
	args: { _secret: v.string(), userId: v.id('users'), asOf: v.number() },
	handler: async (ctx, args) => {
		requireInternalSecret(args._secret);
		assertTrustedQueryAsOf(args.asOf);
		const { userId: authUserId } = await requireAuth(ctx);
		if (args.userId !== authUserId) throw new Error('Unauthorized');
		const user = await ctx.db.get(args.userId);
		if (!user) throw new Error('User not found');

		const tierBypass = (user.trustTier ?? 0) >= 3;
		const credentials = await readReverificationWindow(ctx, args.userId, args.asOf);

		// Most-recent issuance drives the 24h cooldown.
		const mostRecentIssuedAt = credentials[0]?.issuedAt ?? 0;
		const nextAllowedAt =
			mostRecentIssuedAt > 0 && args.asOf - mostRecentIssuedAt < TWENTY_FOUR_HOURS_MS
				? mostRecentIssuedAt + TWENTY_FOUR_HOURS_MS
				: null;

		const recentCount = credentials.length;

		let emailSybilTripped = false;
		if (!tierBypass && user.emailHash) {
			const recentSiblings = await readRecentEmailHashUsers(ctx, user.emailHash, args.asOf);
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
	args: { _secret: v.string(), userId: v.id('users'), asOf: v.number() },
	handler: async (ctx, args) => {
		requireInternalSecret(args._secret);
		assertTrustedQueryAsOf(args.asOf);
		const { userId: authUserId } = await requireAuth(ctx);
		if (args.userId !== authUserId) throw new Error('Unauthorized');

		// Canonical selector (see convex/_credentialSelect.ts) — picks the same
		// authoritative row that `hasActiveDistrictCredential` picks. KG-4 closure:
		// if two active rows ever coexist, both call sites agree on which wins.
		const active = await selectActiveCredentialForUser(ctx, args.userId, args.asOf);
		if (!active || !active.districtCommitment) return null;
		return { districtCommitment: active.districtCommitment };
	}
});

/**
 * Return the caller's own active credential hash for the `/v/[hash]` verify URL
 * shown in proof footers. The hash is public by design (it is already printed in
 * recipient email footers and `resolveCredentialHash` is unauthenticated), but
 * this query is auth-scoped so a client only ever learns ITS OWN — preventing a
 * userId→credentialHash→district enumeration oracle.
 *
 * Returns null when there is no active credential, or the active row predates
 * hash issuance (empty `credentialHash`). Callers MUST render no verification
 * link in that case rather than a guaranteed-404 one. The row returned here is
 * the same authoritative active credential `resolveCredentialHash` validates
 * against, so any hash returned is guaranteed to resolve.
 */
export const getActiveCredentialHash = query({
	args: { _secret: v.string(), userId: v.id('users'), asOf: v.number() },
	handler: async (ctx, args) => {
		requireInternalSecret(args._secret);
		assertTrustedQueryAsOf(args.asOf);
		const { userId: authUserId } = await requireAuth(ctx);
		if (args.userId !== authUserId) throw new Error('Unauthorized');

		const active = await selectActiveCredentialForUser(ctx, args.userId, args.asOf);
		if (!active || !active.credentialHash) return null;
		return { credentialHash: active.credentialHash };
	}
});

/**
 * Get user's identity commitment + verification method for Shadow Atlas.
 */
export const getIdentityForAtlas = query({
	args: { userId: v.id('users') },
	handler: async (ctx, args) => {
		const { userId: authUserId } = await requireAuth(ctx);
		if (args.userId !== authUserId) throw new Error('Unauthorized');
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
 * Resolve a credential hash to verification data for the /v/[hash] certificate page.
 * Known hashes retain their issuance facts after revocation or expiry and carry an
 * explicit active, lapsed, superseded, operator-retired, or unrecorded-reason state.
 * Unknown hashes still return null. No PII or successor-credential data is returned.
 */
export const resolveCredentialHash = query({
	args: { _secret: v.string(), credentialHash: v.string(), asOf: v.number() },
	handler: async (ctx, { _secret, credentialHash, asOf }) => {
		requireInternalSecret(_secret);
		assertTrustedQueryAsOf(asOf);
		const credential = await ctx.db
			.query('districtCredentials')
			.withIndex('by_credentialHash', (idx) => idx.eq('credentialHash', credentialHash))
			.first();

		if (!credential) return null;
		const status =
			credential.revokedAt !== undefined
				? credential.retirementReason === 'superseded_by_reissue'
					? ('superseded' as const)
					: credential.retirementReason === 'operator_cutover'
						? ('operator_retired' as const)
						: ('retired_reason_unrecorded' as const)
				: credential.expiresAt <= asOf
					? ('lapsed' as const)
					: ('active' as const);
		const retiredAt = credential.revokedAt ?? (status === 'lapsed' ? credential.expiresAt : null);

		const user = await ctx.db.get(credential.userId);

		return {
			status,
			retiredAt,
			trustTier: credential.trustTier ?? user?.trustTier ?? null,
			verificationMethod: credential.verificationMethod,
			congressionalDistrict: credential.congressionalDistrict ?? null,
			stateSenateDistrict: credential.stateSenateDistrict ?? null,
			stateAssemblyDistrict: credential.stateAssemblyDistrict ?? null,
			countyFips: credential.countyFips ?? null,
			congressionalDistrictSource: credential.congressionalDistrictSource ?? null,
			stateSenateDistrictSource: credential.stateSenateDistrictSource ?? null,
			stateAssemblyDistrictSource: credential.stateAssemblyDistrictSource ?? null,
			countyFipsSource: credential.countyFipsSource ?? null,
			issuedAt: credential.issuedAt,
			expiresAt: credential.expiresAt,
			hasDistrictCommitment: !!credential.districtCommitment,
			// B3 — freshness provenance for the public certificate. `?? null`
			// collapses BOTH "field absent on the row" (legacy pre-B3 credential)
			// and a stored `null` to the same public value: the surface renders
			// the clock only when it carries a real value, so collapsing here is
			// honest (we never invent a date). boundaryAsOf and officialsAsOf
			// remain independent — neither is derived from the other.
			boundaryAsOf: credential.boundaryAsOf ?? null,
			officialsAsOf: credential.officialsAsOf ?? null,
			tigerVintage: credential.tigerVintage ?? null,
			resolutionConfidence: credential.resolutionConfidence ?? null
		};
	}
});

// =============================================================================
// ENCRYPTED DELIVERY DATA (Identity blobs) — retired
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
		throw new Error('DEPRECATED_IDENTITY_BLOB_PATH');
	}
});

export const getEncryptedBlob = query({
	args: { userId: v.id('users') },
	handler: async (ctx, args) => {
		const { userId: authUserId } = await requireAuth(ctx);
		if (args.userId !== authUserId) throw new Error('Unauthorized');
		throw new Error('DEPRECATED_IDENTITY_BLOB_PATH');
	}
});

export const deleteEncryptedBlob = mutation({
	args: { userId: v.id('users') },
	handler: async (ctx, args) => {
		const { userId: authUserId } = await requireAuth(ctx);
		if (args.userId !== authUserId) throw new Error('Unauthorized');
		throw new Error('DEPRECATED_IDENTITY_BLOB_PATH');
	}
});

// =============================================================================
// SHADOW ATLAS REGISTRATION
// =============================================================================

type ShadowAtlasEngagementFailureStage = 'metrics' | 'registration' | 'path';

function clearShadowAtlasEngagementLease(
	state: ShadowAtlasEngagementState
): ShadowAtlasEngagementState {
	const { leaseToken: _leaseToken, leaseExpiresAt: _leaseExpiresAt, ...withoutLease } = state;
	return withoutLease;
}

function clearShadowAtlasEngagementCooldown(
	state: ShadowAtlasEngagementState
): ShadowAtlasEngagementState {
	const {
		nextAttemptAt: _nextAttemptAt,
		lastFailureStage: _lastFailureStage,
		...withoutCooldown
	} = state;
	return withoutCooldown;
}

/**
 * Atomically load the canonical Tree-3 identity and claim one bounded refresh
 * lease. Replays consume one small mutation and either receive the fresh
 * snapshot or coalesce behind the existing owner; they never fan out to the
 * Shadow Atlas relay independently.
 */
export const claimShadowAtlasEngagement = mutation({
	args: {
		_secret: v.string(),
		userId: v.id('users'),
		leaseToken: v.string()
	},
	handler: async (ctx, args) => {
		requireInternalSecret(args._secret);
		assertShadowAtlasLeaseToken(args.leaseToken);
		const { userId: authUserId } = await requireAuth(ctx);
		if (args.userId !== authUserId) throw new Error('Unauthorized');

		const user = await ctx.db.get(args.userId);
		if (!user) throw new Error('User not found');
		const identityCommitment = user.identityCommitment
			? normalizeShadowAtlasIdentityCommitment(user.identityCommitment)
			: null;
		if (!identityCommitment) return { kind: 'identity_required' as const };

		const signerAddress = normalizeShadowAtlasSignerAddress(user.walletAddress);
		if (!signerAddress) return { kind: 'signer_required' as const };

		const now = Date.now();
		const prior = user.shadowAtlasEngagement;
		let state: ShadowAtlasEngagementState =
			prior?.identityCommitment === identityCommitment
				? prior
				: {
						identityCommitment,
						registrationGeneration: 1,
						registrationStatus: 'unseen',
						failureCount: 0,
						repairCount: 0,
						updatedAt: now
					};

		if (state.snapshot && (state.snapshotExpiresAt ?? 0) > now) {
			return { kind: 'cached' as const, snapshot: state.snapshot };
		}
		if (state.leaseToken && (state.leaseExpiresAt ?? 0) > now) {
			return { kind: 'in_flight' as const, snapshot: state.snapshot ?? null };
		}
		if ((state.nextAttemptAt ?? 0) > now) {
			return { kind: 'cooldown' as const, snapshot: state.snapshot ?? null };
		}

		if (state.registrationStatus === 'registered') {
			try {
				assertShadowAtlasLeafIndex(state.leafIndex ?? -1);
			} catch {
				// Corrupt legacy state must not reopen the registration write. Metrics
				// can repair the leaf index, so retain the one-write reservation.
				const { leafIndex: _leafIndex, ...withoutLeaf } = state;
				state = { ...withoutLeaf, registrationStatus: 'write_reserved' };
			}
		}

		const claimed = clearShadowAtlasEngagementCooldown({
			...state,
			leaseToken: args.leaseToken,
			leaseExpiresAt: now + SHADOW_ATLAS_ENGAGEMENT_LEASE_MS,
			updatedAt: now
		});
		await ctx.db.patch(args.userId, { shadowAtlasEngagement: claimed });

		return {
			kind: 'owner' as const,
			identityCommitment,
			signerAddress,
			registrationStatus: claimed.registrationStatus,
			registrationGeneration: claimed.registrationGeneration,
			leafIndex: claimed.leafIndex ?? null,
			snapshot: claimed.snapshot ?? null
		};
	}
});

/** Persist a permanent one-write reservation before the external POST begins. */
export const reserveShadowAtlasEngagementRegistration = mutation({
	args: {
		_secret: v.string(),
		userId: v.id('users'),
		identityCommitment: v.string(),
		leaseToken: v.string()
	},
	handler: async (ctx, args) => {
		requireInternalSecret(args._secret);
		assertShadowAtlasLeaseToken(args.leaseToken);
		const identityCommitment = normalizeShadowAtlasIdentityCommitment(args.identityCommitment);
		if (!identityCommitment) throw new Error('SHADOW_ATLAS_ENGAGEMENT_IDENTITY_INVALID');
		const { userId: authUserId } = await requireAuth(ctx);
		if (args.userId !== authUserId) throw new Error('Unauthorized');

		const user = await ctx.db.get(args.userId);
		const state = user?.shadowAtlasEngagement;
		if (
			!state ||
			state.identityCommitment !== identityCommitment ||
			state.leaseToken !== args.leaseToken
		) {
			throw new Error('SHADOW_ATLAS_ENGAGEMENT_LEASE_LOST');
		}
		if (state.registrationStatus !== 'unseen') {
			return {
				reserved: false,
				registrationStatus: state.registrationStatus,
				leafIndex: state.leafIndex ?? null
			};
		}

		const now = Date.now();
		const reserved: ShadowAtlasEngagementState = {
			...state,
			registrationStatus: 'write_reserved',
			registrationWriteReservedAt: now,
			leaseExpiresAt: now + SHADOW_ATLAS_ENGAGEMENT_LEASE_MS,
			updatedAt: now
		};
		await ctx.db.patch(args.userId, { shadowAtlasEngagement: reserved });
		return {
			reserved: true,
			registrationStatus: 'write_reserved' as const,
			registrationGeneration: state.registrationGeneration,
			leafIndex: null
		};
	}
});

/** Commit registration before attempting the later Merkle-path read. */
export const markShadowAtlasEngagementRegistered = mutation({
	args: {
		_secret: v.string(),
		userId: v.id('users'),
		identityCommitment: v.string(),
		leaseToken: v.string(),
		leafIndex: v.number()
	},
	handler: async (ctx, args) => {
		requireInternalSecret(args._secret);
		assertShadowAtlasLeaseToken(args.leaseToken);
		assertShadowAtlasLeafIndex(args.leafIndex);
		const identityCommitment = normalizeShadowAtlasIdentityCommitment(args.identityCommitment);
		if (!identityCommitment) throw new Error('SHADOW_ATLAS_ENGAGEMENT_IDENTITY_INVALID');
		const { userId: authUserId } = await requireAuth(ctx);
		if (args.userId !== authUserId) throw new Error('Unauthorized');

		const user = await ctx.db.get(args.userId);
		const state = user?.shadowAtlasEngagement;
		if (
			!state ||
			state.identityCommitment !== identityCommitment ||
			state.leaseToken !== args.leaseToken
		) {
			throw new Error('SHADOW_ATLAS_ENGAGEMENT_LEASE_LOST');
		}
		const now = Date.now();
		await ctx.db.patch(args.userId, {
			shadowAtlasEngagement: {
				...state,
				registrationStatus: 'registered',
				leafIndex: args.leafIndex,
				leaseExpiresAt: now + SHADOW_ATLAS_ENGAGEMENT_LEASE_MS,
				updatedAt: now
			}
		});
		return { registered: true };
	}
});

/** Validate and publish a short-lived proof/metrics snapshot, then release the lease. */
export const completeShadowAtlasEngagement = mutation({
	args: {
		_secret: v.string(),
		userId: v.id('users'),
		identityCommitment: v.string(),
		leaseToken: v.string(),
		snapshot: shadowAtlasEngagementSnapshotValidator
	},
	handler: async (ctx, args) => {
		requireInternalSecret(args._secret);
		assertShadowAtlasLeaseToken(args.leaseToken);
		assertShadowAtlasEngagementSnapshot(args.snapshot);
		const identityCommitment = normalizeShadowAtlasIdentityCommitment(args.identityCommitment);
		if (!identityCommitment) throw new Error('SHADOW_ATLAS_ENGAGEMENT_IDENTITY_INVALID');
		const { userId: authUserId } = await requireAuth(ctx);
		if (args.userId !== authUserId) throw new Error('Unauthorized');

		const user = await ctx.db.get(args.userId);
		const state = user?.shadowAtlasEngagement;
		if (
			!state ||
			state.identityCommitment !== identityCommitment ||
			state.leaseToken !== args.leaseToken ||
			state.registrationStatus !== 'registered' ||
			state.leafIndex !== args.snapshot.engagementIndex
		) {
			throw new Error('SHADOW_ATLAS_ENGAGEMENT_LEASE_LOST');
		}
		const now = Date.now();
		const completed = clearShadowAtlasEngagementCooldown(
			clearShadowAtlasEngagementLease({
				...state,
				snapshot: args.snapshot,
				snapshotExpiresAt: now + SHADOW_ATLAS_ENGAGEMENT_CACHE_TTL_MS,
				failureCount: 0,
				updatedAt: now
			})
		);
		await ctx.db.patch(args.userId, { shadowAtlasEngagement: completed });
		return { cachedUntil: now + SHADOW_ATLAS_ENGAGEMENT_CACHE_TTL_MS };
	}
});

/** Release an owned lease into a bounded cooldown while retaining any last snapshot. */
export const recordShadowAtlasEngagementFailure = mutation({
	args: {
		_secret: v.string(),
		userId: v.id('users'),
		identityCommitment: v.string(),
		leaseToken: v.string(),
		stage: v.union(v.literal('metrics'), v.literal('registration'), v.literal('path'))
	},
	handler: async (ctx, args) => {
		requireInternalSecret(args._secret);
		assertShadowAtlasLeaseToken(args.leaseToken);
		const identityCommitment = normalizeShadowAtlasIdentityCommitment(args.identityCommitment);
		if (!identityCommitment) throw new Error('SHADOW_ATLAS_ENGAGEMENT_IDENTITY_INVALID');
		const { userId: authUserId } = await requireAuth(ctx);
		if (args.userId !== authUserId) throw new Error('Unauthorized');

		const user = await ctx.db.get(args.userId);
		const state = user?.shadowAtlasEngagement;
		if (
			!state ||
			state.identityCommitment !== identityCommitment ||
			state.leaseToken !== args.leaseToken
		) {
			return { recorded: false };
		}
		const now = Date.now();
		const failed = clearShadowAtlasEngagementLease({
			...state,
			nextAttemptAt: now + SHADOW_ATLAS_ENGAGEMENT_FAILURE_COOLDOWN_MS,
			failureCount: Math.min(state.failureCount + 1, 1_000_000),
			lastFailureStage: args.stage as ShadowAtlasEngagementFailureStage,
			updatedAt: now
		});
		await ctx.db.patch(args.userId, { shadowAtlasEngagement: failed });
		return { recorded: true };
	}
});

/**
 * Operator-only recovery for an ambiguous external POST.
 *
 * Automatic requests can never clear `write_reserved`. An operator must first
 * independently prove that metrics still reports the identity absent, then use
 * the exact reservation timestamp + generation as a CAS after a 15-minute
 * observation window. The mutation advances the generation and performs no
 * scheduling or external work; each generation therefore authorizes at most
 * one registration POST.
 */
export const repairShadowAtlasEngagementReservation = internalMutation({
	args: {
		userId: v.id('users'),
		identityCommitment: v.string(),
		expectedReservationTimestamp: v.number(),
		expectedGeneration: v.number(),
		operator: v.string(),
		evidenceReference: v.string()
	},
	handler: async (ctx, args) => {
		const identityCommitment = normalizeShadowAtlasIdentityCommitment(args.identityCommitment);
		if (!identityCommitment) throw new Error('SHADOW_ATLAS_ENGAGEMENT_IDENTITY_INVALID');
		assertShadowAtlasRegistrationGeneration(args.expectedGeneration);
		if (
			!Number.isSafeInteger(args.expectedReservationTimestamp) ||
			args.expectedReservationTimestamp < 0
		) {
			throw new Error('SHADOW_ATLAS_ENGAGEMENT_REPAIR_TIMESTAMP_INVALID');
		}
		const operator = normalizeShadowAtlasRepairReference(args.operator, 'operator');
		const evidenceReference = normalizeShadowAtlasRepairReference(
			args.evidenceReference,
			'evidence'
		);

		const user = await ctx.db.get(args.userId);
		const state = user?.shadowAtlasEngagement;
		if (
			!state ||
			state.identityCommitment !== identityCommitment ||
			state.registrationStatus !== 'write_reserved' ||
			state.registrationGeneration !== args.expectedGeneration ||
			state.registrationWriteReservedAt !== args.expectedReservationTimestamp
		) {
			throw new Error('SHADOW_ATLAS_ENGAGEMENT_REPAIR_CAS_MISMATCH');
		}
		const now = Date.now();
		if ((state.leaseExpiresAt ?? 0) > now) {
			throw new Error('SHADOW_ATLAS_ENGAGEMENT_REPAIR_LEASE_ACTIVE');
		}
		if (
			state.leafIndex !== undefined ||
			state.snapshot !== undefined ||
			state.snapshotExpiresAt !== undefined
		) {
			throw new Error('SHADOW_ATLAS_ENGAGEMENT_REPAIR_REGISTRATION_EVIDENCE_PRESENT');
		}
		if (now - state.registrationWriteReservedAt < SHADOW_ATLAS_ENGAGEMENT_REPAIR_OBSERVATION_MS) {
			throw new Error('SHADOW_ATLAS_ENGAGEMENT_REPAIR_TOO_EARLY');
		}

		const {
			registrationWriteReservedAt: _registrationWriteReservedAt,
			leaseToken: _leaseToken,
			leaseExpiresAt: _leaseExpiresAt,
			nextAttemptAt: _nextAttemptAt,
			lastFailureStage: _lastFailureStage,
			...retained
		} = state;
		const nextGeneration = state.registrationGeneration + 1;
		assertShadowAtlasRegistrationGeneration(nextGeneration);
		await ctx.db.patch(args.userId, {
			shadowAtlasEngagement: {
				...retained,
				registrationGeneration: nextGeneration,
				registrationStatus: 'unseen',
				repairCount: Math.min(state.repairCount + 1, 1_000_000),
				lastRepairAt: now,
				lastRepairOperator: operator,
				lastRepairEvidence: evidenceReference,
				updatedAt: now
			}
		});
		return {
			repaired: true,
			registrationGeneration: nextGeneration,
			repairCount: Math.min(state.repairCount + 1, 1_000_000)
		};
	}
});

type ShadowAtlasTree1Coordinates = {
	userId: Id<'users'>;
	identityCommitment: string;
	operation: ShadowAtlasTree1Operation;
	generation: number;
	leafDigest: string;
	idempotencyKey: string;
	priorLeafIndex?: number;
};

type ShadowAtlasTree1CommitInput = ShadowAtlasTree1Coordinates & ShadowAtlasTree1Proof;

const shadowAtlasTree1CoordinateValidators = {
	userId: v.id('users'),
	identityCommitment: v.string(),
	operation: v.union(v.literal('register'), v.literal('replace')),
	generation: v.number(),
	leafDigest: v.string(),
	idempotencyKey: v.string(),
	priorLeafIndex: v.optional(v.number())
};

async function readSingleShadowAtlasRegistration(
	ctx: QueryCtx | MutationCtx,
	userId: Id<'users'>
): Promise<Doc<'shadowAtlasRegistrations'> | null> {
	const rows = await ctx.db
		.query('shadowAtlasRegistrations')
		.withIndex('by_userId', (q) => q.eq('userId', userId))
		.take(2);
	if (rows.length > 1) throw new Error('SHADOW_ATLAS_TREE1_REGISTRATION_MULTIPLICITY');
	return rows[0] ?? null;
}

function shadowAtlasTree1ProofFromRegistration(
	registration: Doc<'shadowAtlasRegistrations'>
): ShadowAtlasTree1Proof {
	if (
		!Array.isArray(registration.merklePath) ||
		registration.merklePath.some((field) => typeof field !== 'string')
	) {
		throw new Error('SHADOW_ATLAS_TREE1_PATH_INVALID');
	}
	const proof = {
		leafIndex: registration.leafIndex,
		merkleRoot: registration.merkleRoot,
		merklePath: registration.merklePath as string[]
	};
	assertShadowAtlasTree1Proof(proof);
	return proof;
}

function publicShadowAtlasRegistration(registration: Doc<'shadowAtlasRegistrations'>) {
	const proof = shadowAtlasTree1ProofFromRegistration(registration);
	return {
		...registration,
		...proof,
		congressionalDistrict: publicShadowAtlasCongressionalDistrict(
			registration.congressionalDistrict
		)
	};
}

function shadowAtlasTree1AuthorityLevel(user: Doc<'users'>): number {
	const trustTier = user.trustTier ?? 0;
	return trustTier >= 5 ? 5 : trustTier >= 3 ? 3 : 1;
}

function shadowAtlasTree1VerificationMethod(user: Doc<'users'>): string {
	const value = user.verificationMethod?.normalize('NFKC').trim();
	return value && value.length <= 64 ? value : 'unknown';
}

function assertShadowAtlasTree1Coordinates(args: ShadowAtlasTree1Coordinates): void {
	const identityCommitment = normalizeShadowAtlasTree1Identity(args.identityCommitment);
	if (!identityCommitment || identityCommitment !== args.identityCommitment) {
		throw new Error('SHADOW_ATLAS_TREE1_IDENTITY_INVALID');
	}
	assertShadowAtlasTree1Generation(args.generation);
	assertShadowAtlasTree1LeafDigest(args.leafDigest);
	assertShadowAtlasTree1IdempotencyKey(args.idempotencyKey);
	if (args.operation === 'register' && args.priorLeafIndex !== undefined) {
		throw new Error('SHADOW_ATLAS_TREE1_PRIOR_INDEX_INVALID');
	}
	if (args.operation === 'replace') {
		if (args.priorLeafIndex === undefined) {
			throw new Error('SHADOW_ATLAS_TREE1_PRIOR_INDEX_REQUIRED');
		}
		assertShadowAtlasTree1LeafIndex(args.priorLeafIndex);
	}
}

function shadowAtlasTree1StateMatches(
	state: ShadowAtlasTree1OperationState,
	args: ShadowAtlasTree1Coordinates
): boolean {
	return (
		state.identityCommitment === args.identityCommitment &&
		state.operation === args.operation &&
		state.generation === args.generation &&
		state.leafDigest === args.leafDigest &&
		state.idempotencyKey === args.idempotencyKey &&
		(state.priorLeafIndex ?? undefined) === (args.priorLeafIndex ?? undefined)
	);
}

/**
 * Claim the sole external Tree-1 register/replace entitlement for this user.
 * The winning idempotency key is persisted before the route can call Atlas.
 */
export const reserveShadowAtlasRegistrationOperation = mutation({
	args: {
		_secret: v.string(),
		userId: v.id('users'),
		leafDigest: v.string(),
		requestedReplace: v.boolean(),
		idempotencyKey: v.string()
	},
	handler: async (ctx, args) => {
		requireInternalSecret(args._secret);
		assertShadowAtlasTree1LeafDigest(args.leafDigest);
		assertShadowAtlasTree1IdempotencyKey(args.idempotencyKey);
		const { userId: authUserId } = await requireAuth(ctx);
		if (args.userId !== authUserId) throw new Error('Unauthorized');

		const user = await ctx.db.get(args.userId);
		if (!user) throw new Error('User not found');
		const identityCommitment = normalizeShadowAtlasTree1Identity(user.identityCommitment);
		if (!identityCommitment) throw new Error('SHADOW_ATLAS_TREE1_IDENTITY_REQUIRED');
		const registration = await readSingleShadowAtlasRegistration(ctx, args.userId);
		const prior = user.shadowAtlasTree1Operation;

		if (prior && prior.status !== 'committed') {
			if (prior.identityCommitment === identityCommitment && prior.leafDigest === args.leafDigest) {
				if (prior.status === 'reserved') {
					return {
						kind: 'owner' as const,
						resumed: true,
						identityCommitment,
						authorityLevel: shadowAtlasTree1AuthorityLevel(user),
						operation: prior.operation,
						generation: prior.generation,
						leafDigest: prior.leafDigest,
						idempotencyKey: prior.idempotencyKey,
						...(prior.priorLeafIndex === undefined ? {} : { priorLeafIndex: prior.priorLeafIndex })
					};
				}
				return {
					kind: 'in_flight' as const,
					status: prior.status,
					operation: prior.operation,
					generation: prior.generation
				};
			}
			throw new Error('SHADOW_ATLAS_TREE1_OPERATION_CONFLICT');
		}

		if (prior?.status === 'committed') {
			if (!registration || prior.committedLeafIndex !== registration.leafIndex) {
				throw new Error('SHADOW_ATLAS_TREE1_COMMITTED_STATE_CORRUPT');
			}
			if (prior.identityCommitment === identityCommitment && prior.leafDigest === args.leafDigest) {
				return {
					kind: 'cached' as const,
					identityCommitment,
					authorityLevel: shadowAtlasTree1AuthorityLevel(user),
					registration: publicShadowAtlasRegistration(registration)
				};
			}
		}

		if (registration && !args.requestedReplace) {
			if (
				normalizeShadowAtlasTree1Identity(registration.identityCommitment) !== identityCommitment
			) {
				throw new Error('SHADOW_ATLAS_TREE1_IDENTITY_REPLACEMENT_REQUIRED');
			}
			return {
				kind: 'cached' as const,
				identityCommitment,
				authorityLevel: shadowAtlasTree1AuthorityLevel(user),
				registration: publicShadowAtlasRegistration(registration)
			};
		}

		const operation: ShadowAtlasTree1Operation = registration ? 'replace' : 'register';
		const generation = (prior?.generation ?? 0) + 1;
		if (generation > SHADOW_ATLAS_TREE1_MAX_GENERATION) {
			throw new Error('SHADOW_ATLAS_TREE1_GENERATION_EXHAUSTED');
		}
		const now = Date.now();
		const reserved: ShadowAtlasTree1OperationState = {
			v: 1,
			identityCommitment,
			operation,
			generation,
			leafDigest: args.leafDigest,
			idempotencyKey: args.idempotencyKey,
			...(registration ? { priorLeafIndex: registration.leafIndex } : {}),
			status: 'reserved',
			reservedAt: now,
			updatedAt: now
		};
		await ctx.db.patch(args.userId, { shadowAtlasTree1Operation: reserved });
		return {
			kind: 'owner' as const,
			identityCommitment,
			authorityLevel: shadowAtlasTree1AuthorityLevel(user),
			operation,
			generation,
			leafDigest: args.leafDigest,
			idempotencyKey: args.idempotencyKey,
			...(registration ? { priorLeafIndex: registration.leafIndex } : {})
		};
	}
});

/**
 * Cross the external-dispatch boundary exactly once. A crash before this
 * mutation is safely resumable with the persisted key; a crash after it is
 * ambiguous and must fail closed until exact operator repair or reconciliation.
 */
export const beginShadowAtlasRegistrationDispatch = mutation({
	args: {
		_secret: v.string(),
		...shadowAtlasTree1CoordinateValidators
	},
	handler: async (ctx, args) => {
		requireInternalSecret(args._secret);
		assertShadowAtlasTree1Coordinates(args);
		const { userId: authUserId } = await requireAuth(ctx);
		if (args.userId !== authUserId) throw new Error('Unauthorized');
		const user = await ctx.db.get(args.userId);
		const state = user?.shadowAtlasTree1Operation;
		if (!state || !shadowAtlasTree1StateMatches(state, args)) {
			throw new Error('SHADOW_ATLAS_TREE1_DISPATCH_CAS_MISMATCH');
		}
		if (state.status !== 'reserved') {
			return { started: false, status: state.status };
		}
		const now = Date.now();
		await ctx.db.patch(args.userId, {
			shadowAtlasTree1Operation: {
				...state,
				status: 'dispatching',
				dispatchStartedAt: now,
				updatedAt: now
			}
		});
		return { started: true, status: 'dispatching' as const };
	}
});

async function commitShadowAtlasTree1Operation(
	ctx: MutationCtx,
	args: ShadowAtlasTree1CommitInput,
	staleSafe: boolean
): Promise<{ status: 'committed' | 'already_committed' | 'stale' }> {
	assertShadowAtlasTree1Coordinates(args);
	assertShadowAtlasTree1Proof(args);
	const user = await ctx.db.get(args.userId);
	const canonicalIdentity = normalizeShadowAtlasTree1Identity(user?.identityCommitment);
	if (!user || canonicalIdentity !== args.identityCommitment) {
		if (staleSafe) return { status: 'stale' };
		throw new Error('SHADOW_ATLAS_TREE1_IDENTITY_CHANGED');
	}
	const state = user.shadowAtlasTree1Operation;
	if (!state || !shadowAtlasTree1StateMatches(state, args)) {
		if (staleSafe) return { status: 'stale' };
		throw new Error('SHADOW_ATLAS_TREE1_COMMIT_CAS_MISMATCH');
	}

	const registration = await readSingleShadowAtlasRegistration(ctx, args.userId);
	if (state.status === 'committed') {
		if (
			!registration ||
			state.committedLeafIndex !== args.leafIndex ||
			!sameShadowAtlasTree1Proof(shadowAtlasTree1ProofFromRegistration(registration), args)
		) {
			throw new Error('SHADOW_ATLAS_TREE1_COMMITTED_STATE_CORRUPT');
		}
		return { status: 'already_committed' };
	}
	if (state.status !== 'dispatching' && state.status !== 'ambiguous') {
		if (staleSafe) return { status: 'stale' };
		throw new Error('SHADOW_ATLAS_TREE1_COMMIT_STATE_INVALID');
	}

	const now = Date.now();
	const verificationMethod = shadowAtlasTree1VerificationMethod(user);
	if (args.operation === 'register') {
		if (registration) throw new Error('SHADOW_ATLAS_TREE1_REGISTER_PRECONDITION_FAILED');
		await ctx.db.insert('shadowAtlasRegistrations', {
			userId: args.userId,
			// Tree 1 contains no district plaintext. Empty remains non-attributable
			// at position/recipient metric boundaries; never publish a sentinel.
			congressionalDistrict: '',
			identityCommitment: args.identityCommitment,
			leafIndex: args.leafIndex,
			merkleRoot: args.merkleRoot,
			merklePath: args.merklePath,
			credentialType: 'three-tree',
			verificationMethod,
			verificationId: args.userId,
			verificationTimestamp: now,
			registrationStatus: 'registered',
			expiresAt: now + 180 * 24 * 60 * 60 * 1000,
			updatedAt: now
		});
	} else {
		if (!registration || registration.leafIndex !== args.priorLeafIndex) {
			throw new Error('SHADOW_ATLAS_TREE1_REPLACE_PRECONDITION_FAILED');
		}
		await ctx.db.patch(registration._id, {
			identityCommitment: args.identityCommitment,
			leafIndex: args.leafIndex,
			merkleRoot: args.merkleRoot,
			merklePath: args.merklePath,
			verificationMethod,
			verificationId: args.userId,
			verificationTimestamp: now,
			registrationStatus: 'registered',
			expiresAt: now + 180 * 24 * 60 * 60 * 1000,
			updatedAt: now
		});
	}

	const { ambiguousAt: _ambiguousAt, lastFailureCode: _lastFailureCode, ...retainedState } = state;
	await ctx.db.patch(args.userId, {
		shadowAtlasTree1Operation: {
			...retainedState,
			status: 'committed',
			committedAt: now,
			committedLeafIndex: args.leafIndex,
			updatedAt: now
		}
	});
	return { status: 'committed' };
}

/** Owner-bound normal completion for the route that owns the reservation. */
export const commitShadowAtlasRegistrationOperation = mutation({
	args: {
		_secret: v.string(),
		...shadowAtlasTree1CoordinateValidators,
		leafIndex: v.number(),
		merkleRoot: v.string(),
		merklePath: v.array(v.string())
	},
	handler: async (ctx, args) => {
		requireInternalSecret(args._secret);
		const { userId: authUserId } = await requireAuth(ctx);
		if (args.userId !== authUserId) throw new Error('Unauthorized');
		return await commitShadowAtlasTree1Operation(ctx, args, false);
	}
});

/** Exact generation-bound completion for the protected KV reconciler. */
export const reconcileShadowAtlasRegistrationOperation = mutation({
	args: {
		_secret: v.string(),
		...shadowAtlasTree1CoordinateValidators,
		leafIndex: v.number(),
		merkleRoot: v.string(),
		merklePath: v.array(v.string())
	},
	handler: async (ctx, args) => {
		requireInternalSecret(args._secret);
		return await commitShadowAtlasTree1Operation(ctx, args, true);
	}
});

/** Preserve an uncertain external outcome permanently; automatic callers cannot reopen it. */
export const markShadowAtlasRegistrationOperationAmbiguous = mutation({
	args: {
		_secret: v.string(),
		...shadowAtlasTree1CoordinateValidators,
		failureCode: v.string()
	},
	handler: async (ctx, args) => {
		requireInternalSecret(args._secret);
		assertShadowAtlasTree1Coordinates(args);
		assertShadowAtlasTree1FailureCode(args.failureCode);
		const { userId: authUserId } = await requireAuth(ctx);
		if (args.userId !== authUserId) throw new Error('Unauthorized');
		const user = await ctx.db.get(args.userId);
		const state = user?.shadowAtlasTree1Operation;
		if (!state || !shadowAtlasTree1StateMatches(state, args)) {
			throw new Error('SHADOW_ATLAS_TREE1_AMBIGUOUS_CAS_MISMATCH');
		}
		if (state.status === 'committed') return { recorded: false, status: 'committed' as const };
		if (state.status === 'ambiguous') return { recorded: false, status: 'ambiguous' as const };
		if (state.status !== 'dispatching') {
			throw new Error('SHADOW_ATLAS_TREE1_DISPATCH_NOT_STARTED');
		}
		const now = Date.now();
		await ctx.db.patch(args.userId, {
			shadowAtlasTree1Operation: {
				...state,
				status: 'ambiguous',
				ambiguousAt: now,
				lastFailureCode: args.failureCode,
				updatedAt: now
			}
		});
		return { recorded: true, status: 'ambiguous' as const };
	}
});

/**
 * Operator-only reopening after independent proof that Atlas did not apply the
 * dispatch. The exact operation is returned to `reserved` with the SAME
 * generation and idempotency key; repair never creates external entitlement.
 */
export const repairShadowAtlasRegistrationOperation = internalMutation({
	args: {
		...shadowAtlasTree1CoordinateValidators,
		expectedDispatchStartedAt: v.number(),
		operator: v.string(),
		evidenceReference: v.string()
	},
	handler: async (ctx, args) => {
		assertShadowAtlasTree1Coordinates(args);
		if (
			!Number.isSafeInteger(args.expectedDispatchStartedAt) ||
			args.expectedDispatchStartedAt < 0
		) {
			throw new Error('SHADOW_ATLAS_TREE1_REPAIR_TIMESTAMP_INVALID');
		}
		const operator = normalizeShadowAtlasRepairReference(args.operator, 'operator');
		const evidenceReference = normalizeShadowAtlasRepairReference(
			args.evidenceReference,
			'evidence'
		);
		const user = await ctx.db.get(args.userId);
		const state = user?.shadowAtlasTree1Operation;
		if (
			!state ||
			!shadowAtlasTree1StateMatches(state, args) ||
			(state.status !== 'dispatching' && state.status !== 'ambiguous') ||
			state.dispatchStartedAt !== args.expectedDispatchStartedAt
		) {
			throw new Error('SHADOW_ATLAS_TREE1_REPAIR_CAS_MISMATCH');
		}
		const now = Date.now();
		if (now - args.expectedDispatchStartedAt < SHADOW_ATLAS_TREE1_REPAIR_OBSERVATION_MS) {
			throw new Error('SHADOW_ATLAS_TREE1_REPAIR_TOO_EARLY');
		}
		const registration = await readSingleShadowAtlasRegistration(ctx, args.userId);
		if (
			(args.operation === 'register' && registration) ||
			(args.operation === 'replace' &&
				(!registration || registration.leafIndex !== args.priorLeafIndex))
		) {
			throw new Error('SHADOW_ATLAS_TREE1_REPAIR_REGISTRATION_CHANGED');
		}
		const {
			dispatchStartedAt: _dispatchStartedAt,
			ambiguousAt: _ambiguousAt,
			lastFailureCode: _lastFailureCode,
			...retained
		} = state;
		await ctx.db.patch(args.userId, {
			shadowAtlasTree1Operation: {
				...retained,
				status: 'reserved',
				updatedAt: now
			}
		});
		return {
			repaired: true,
			generation: state.generation,
			idempotencyKey: state.idempotencyKey,
			operator,
			evidenceReference
		};
	}
});

export const getShadowAtlasRegistration = query({
	args: { userId: v.id('users') },
	handler: async (ctx, args) => {
		const { userId: authUserId } = await requireAuth(ctx);
		if (args.userId !== authUserId) throw new Error('Unauthorized');
		const registration = await readSingleShadowAtlasRegistration(ctx, args.userId);
		return registration ? publicShadowAtlasRegistration(registration) : null;
	}
});

// =============================================================================
// ADMIN: SHADOW ATLAS RECONCILIATION
// =============================================================================

/**
 * Count one page of shadow atlas registrations. Admin reconciliation walks the
 * returned cursor across separate Convex query executions, so no single query
 * transaction can accumulate an unbounded database read.
 *
 * The durable high-volume cure remains a denormalized counter document; this
 * cursor contract is the bounded migration-safe path until that projection is
 * available.
 */
export const countRegistrations = query({
	args: { _secret: v.string(), cursor: v.optional(v.string()) },
	handler: async (ctx, args) => {
		requireInternalSecret(args._secret);
		if (args.cursor !== undefined && args.cursor.length > 2_048) {
			throw new Error('SHADOW_ATLAS_CURSOR_TOO_LARGE');
		}
		const page = await ctx.db
			.query('shadowAtlasRegistrations')
			.paginate({ numItems: 256, cursor: args.cursor ?? null });
		return {
			count: page.page.length,
			isDone: page.isDone,
			continueCursor: page.isDone ? null : page.continueCursor
		};
	}
});

/**
 * List recent shadow atlas registrations (for spot-check reconciliation).
 */
export const listRecentRegistrations = query({
	args: { _secret: v.string(), limit: v.optional(v.number()) },
	handler: async (ctx, { _secret, limit }) => {
		requireInternalSecret(_secret);
		const requestedLimit = Number.isSafeInteger(limit) ? (limit ?? 50) : 50;
		const max = Math.min(Math.max(requestedLimit, 1), 100);
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
export const bindIdentityCommitment = internalMutation({
	args: {
		userId: v.id('users'),
		identityCommitment: v.string(),
		identityHash: v.optional(v.string()),
		documentType: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		// Check if commitment already bound to another user (Sybil / account merge)
		const existingCommitments = await ctx.db
			.query('users')
			.withIndex('by_identityCommitment', (q) =>
				q.eq('identityCommitment', args.identityCommitment)
			)
			.take(2);
		if (existingCommitments.length > 1) {
			throw new Error('IDENTITY_COMMITMENT_CARDINALITY_REPAIR_REQUIRED');
		}
		const existing = existingCommitments[0];

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
		await syncSessionAuthority(ctx, args.userId);

		return {
			userId: args.userId,
			linkedToExisting: false,
			requireReauth: false
		};
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
 * Atomic claim CAS for `emitOnChainRevocation`. Without this CAS, a
 * status-only filter (status ∈ {confirmed, failed}) lets two concurrent
 * invocations (cron re-fire racing a `verifyAddressInternal`-scheduled
 * emit, etc.) both pass the filter, both read `revocationAttempts`,
 * both increment (last-write-wins → counter loses a tick), both POST to
 * the relayer (gas burn + duplicate emit), and the terminal-write race
 * could leave the row in a non-deterministic confirmed/failed state.
 *
 * The claim is CAS-style: status MUST be 'pending' AND the read-modify-
 * write of `revocationAttempts` happens INSIDE the mutation (Convex
 * mutations are serializable, so only one invocation's claim succeeds).
 * The handler still patches `revocationStatus` back to 'pending' for the
 * retry pattern, but the increment-once invariant holds.
 */
export const claimEmitRevocation = internalMutation({
	args: { credentialId: v.id('districtCredentials') },
	handler: async (
		ctx,
		{ credentialId }
	): Promise<{ ok: boolean; reason?: string; attempts?: number }> => {
		const credential = await ctx.db.get(credentialId);
		if (!credential) return { ok: false, reason: 'not_found' };
		if (credential.revocationStatus !== 'pending') {
			return { ok: false, reason: `wrong_status:${credential.revocationStatus ?? 'unset'}` };
		}
		if (!credential.districtCommitment) {
			return { ok: false, reason: 'no_district_commitment' };
		}
		const attempts = (credential.revocationAttempts ?? 0) + 1;
		await ctx.db.patch(credentialId, {
			revocationAttempts: attempts,
			revocationLastAttemptAt: Date.now()
		});
		return { ok: true, attempts };
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
		// Env-check first — don't burn a claim attempt on env
		// misconfiguration. The claim flow is cleaner with the env gate
		// ahead of the claim mutation.
		const internalUrl = process.env.COMMONS_INTERNAL_URL;
		const internalSecret = process.env.INTERNAL_API_SECRET;
		if (!internalUrl || !internalSecret) {
			console.error(
				`[emitOnChainRevocation] Missing COMMONS_INTERNAL_URL or INTERNAL_API_SECRET — credential=${credentialId} stays pending`
			);
			return;
		}

		// Atomic claim CAS. Without it, concurrent invocations (cron
		// re-fire racing a `verifyAddressInternal`-scheduled emit) both
		// pass the status filter, both increment attempts (last-write-
		// wins), both POST to the relayer → gas burn + duplicate
		// revocation emit + non-deterministic terminal state. With the
		// CAS only one invocation gets `{ok:true}`; the other returns
		// early. Mirrors `submissions.claimForAnchor` +
		// `blasts.claimForBlastDispatch` + `workflows.claimExecution`.
		const claim: { ok: boolean; reason?: string; attempts?: number } = await ctx.runMutation(
			internal.users.claimEmitRevocation,
			{ credentialId }
		);
		if (!claim.ok) {
			// reason cases: not_found, wrong_status, no_district_commitment.
			// `no_district_commitment` is the case that previously marked
			// the row as failed; do that here so ops audit still works.
			if (claim.reason === 'no_district_commitment') {
				await ctx.runMutation(internal.users.updateRevocationState, {
					credentialId,
					revocationStatus: 'failed',
					revocationLastAttemptAt: Date.now()
				});
			}
			return;
		}
		const attempts = claim.attempts ?? 1;

		// Re-fetch credential AFTER claim — we need districtCommitment +
		// other fields for the relayer payload, and the claim's atomic
		// increment guarantees this read sees post-claim state.
		const credential = await ctx.runQuery(internal.users.getCredentialForRevocation, {
			credentialId
		});
		if (!credential) return;

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
			.withIndex('by_revocationStatus_revocationLastAttemptAt', (q) =>
				q.eq('revocationStatus', 'pending').lt('revocationLastAttemptAt', cutoff)
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

// =============================================================================
// CROSS-ORG REPUTATION (NEW-T7-3)
// =============================================================================

/** Retired before launch: no caller consumes this cross-organization fan-out. */
export const getMyReputationPortable = query({
	args: {},
	handler: async () => {
		throw new Error('USER_REPUTATION_PORTABLE_RETIRED');
	}
});

// =============================================================================
// EXPLICIT LEGACY REPUTATION TIER REPAIR (T10-1)
// =============================================================================

const REPUTATION_RECOMPUTE_PAGE_SIZE = 100;
const REPUTATION_RECOMPUTE_MAX_CURSOR_CHARS = 2_048;
const REPUTATION_RECOMPUTE_MAX_BYTES = 8 * 1024 * 1024;

type ReputationRecomputeArgs = {
	cursor?: string | null;
	limit?: number;
	sweepUpperBoundId?: Id<'users'>;
	sweepUpperBoundCreationTime?: number;
};

const continueReputationTierRecomputeRef = makeFunctionReference<'mutation'>(
	'users:recomputeAllReputationTiers'
) as unknown as FunctionReference<'mutation', 'internal', ReputationRecomputeArgs, unknown>;

/**
 * Return the calling user's actionCount (0 if absent). Used by the
 * /api/submissions/create boundary for T10-2 cross-check — no PII exposure.
 */
export const getMyActionCount = query({
	args: {},
	handler: async (ctx) => {
		const { userId } = await requireAuth(ctx);
		const user = await ctx.db.get(userId);
		return user?.actionCount ?? 0;
	}
});

/**
 * Explicit one-time repair for legacy rows whose stored reputationTier
 * predates transactional action-count derivation. This function is not
 * registered in convex/crons.ts. An operator invocation freezes the repair at
 * the last user that exists when it starts; one bounded page schedules at most
 * one successor and the endpoint page schedules none.
 */
export const recomputeAllReputationTiers = internalMutation({
	args: {
		cursor: v.optional(v.union(v.string(), v.null())),
		limit: v.optional(v.number()),
		sweepUpperBoundId: v.optional(v.id('users')),
		sweepUpperBoundCreationTime: v.optional(v.number())
	},
	returns: v.object({
		status: v.union(v.literal('running'), v.literal('complete')),
		scanned: v.number(),
		updated: v.number(),
		nextCursor: v.union(v.string(), v.null()),
		pageSize: v.number()
	}),
	handler: async (ctx, args) => {
		const cursor = args.cursor ?? null;
		const hasCursor = cursor !== null;
		if (cursor !== null && cursor.length > REPUTATION_RECOMPUTE_MAX_CURSOR_CHARS) {
			throw new Error('REPUTATION_RECOMPUTE_CURSOR_INVALID');
		}
		const requestedLimit = args.limit ?? REPUTATION_RECOMPUTE_PAGE_SIZE;
		if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1) {
			throw new Error('REPUTATION_RECOMPUTE_LIMIT_INVALID');
		}
		const pageSize = Math.min(requestedLimit, REPUTATION_RECOMPUTE_PAGE_SIZE);
		const hasUpperBoundId = args.sweepUpperBoundId !== undefined;
		const hasUpperBoundCreationTime = args.sweepUpperBoundCreationTime !== undefined;
		if (hasUpperBoundId !== hasUpperBoundCreationTime || (hasCursor && !hasUpperBoundId)) {
			throw new Error('REPUTATION_RECOMPUTE_BOUNDARY_INVALID');
		}
		if (
			args.sweepUpperBoundCreationTime !== undefined &&
			(!Number.isFinite(args.sweepUpperBoundCreationTime) || args.sweepUpperBoundCreationTime < 0)
		) {
			throw new Error('REPUTATION_RECOMPUTE_BOUNDARY_INVALID');
		}

		const rootUpperBound = hasUpperBoundId
			? null
			: await ctx.db.query('users').order('desc').first();
		if (!hasUpperBoundId && !rootUpperBound) {
			return {
				status: 'complete' as const,
				scanned: 0,
				updated: 0,
				nextCursor: null,
				pageSize
			};
		}
		const sweepUpperBoundId = args.sweepUpperBoundId ?? rootUpperBound!._id;
		const sweepUpperBoundCreationTime =
			args.sweepUpperBoundCreationTime ?? rootUpperBound!._creationTime;
		const page = await ctx.db
			.query('users')
			.order('asc')
			.paginate({
				cursor,
				numItems: pageSize,
				maximumRowsRead: pageSize + 1,
				maximumBytesRead: REPUTATION_RECOMPUTE_MAX_BYTES
			});

		if (page.pageStatus === 'SplitRequired') {
			if (pageSize === 1) throw new Error('REPUTATION_RECOMPUTE_ROW_TOO_LARGE');
			const retryPageSize = Math.max(1, Math.floor(pageSize / 2));
			await ctx.scheduler.runAfter(0, continueReputationTierRecomputeRef, {
				cursor,
				limit: retryPageSize,
				sweepUpperBoundId,
				sweepUpperBoundCreationTime
			});
			return {
				status: 'running' as const,
				scanned: 0,
				updated: 0,
				nextCursor: cursor,
				pageSize: retryPageSize
			};
		}

		const endpointIndex = page.page.findIndex((user) => user._id === sweepUpperBoundId);
		const beyondEndpointIndex = page.page.findIndex(
			(user) => user._creationTime > sweepUpperBoundCreationTime
		);
		const users =
			endpointIndex >= 0
				? page.page.slice(0, endpointIndex + 1)
				: beyondEndpointIndex >= 0
					? page.page.slice(0, beyondEndpointIndex)
					: page.page;
		let updated = 0;
		for (const u of users) {
			const next = reputationStateForActionCount(u.actionCount ?? 0).reputationTier;
			if (u.reputationTier !== next) {
				const userId: Id<'users'> = u._id;
				await ctx.db.patch(userId, { reputationTier: next, updatedAt: Date.now() });
				updated++;
			}
		}

		const complete = endpointIndex >= 0 || beyondEndpointIndex >= 0 || page.isDone;
		if (!complete) {
			await ctx.scheduler.runAfter(0, continueReputationTierRecomputeRef, {
				cursor: page.continueCursor,
				limit:
					page.pageStatus === 'SplitRecommended' ? Math.max(1, Math.floor(pageSize / 2)) : pageSize,
				sweepUpperBoundId,
				sweepUpperBoundCreationTime
			});
		}
		return {
			status: complete ? ('complete' as const) : ('running' as const),
			scanned: users.length,
			updated,
			nextCursor: complete ? null : page.continueCursor,
			pageSize
		};
	}
});
