/**
 * OAuth authentication operations — user upsert + session creation.
 *
 * Called from SvelteKit OAuth callback routes after token exchange.
 * SvelteKit keeps cookie management; Convex handles all DB operations.
 *
 * These are public mutations (not internal) so serverMutation() from
 * convex-sveltekit can call them. They intentionally skip auth checks
 * because they ARE the auth creation path.
 */

import { mutation, query, internalMutation } from './_generated/server';
import { v } from 'convex/values';
import { requireAuth } from './_authHelpers';
import { requireInternalSecret } from './_internalAuth';
import { toArrayBuffer } from './_bufferSource';
import type { Doc, Id } from './_generated/dataModel';
import { syncSessionAuthority } from './lib/sessionAuthority';
import { bumpPublicTemplatePageArtifactsForAuthor } from './lib/publicTemplateDiscoverySource';

// Issuer prefix for `tokenIdentifier` (Convex's `<issuer>|<sub>` convention
// for custom JWT providers). MUST match the SvelteKit JWT minter
// (src/lib/server/convex-jwt.ts) and convex/auth.config.ts. Defaults to the
// reference commons.email deployment; peer implementations override via the
// CONVEX_AUTH_ISSUER env var (set in Convex dashboard).
// Trailing slash is stripped to prevent operator-typo drift between this
// stored prefix and the SvelteKit-minted JWT `iss` claim.

declare const process: { env: Record<string, string | undefined> };
const ISSUER_PREFIX = (process.env.CONVEX_AUTH_ISSUER || 'https://commons.email').replace(
	/\/$/,
	''
);

type UpsertFromOAuthResult = {
	userId: Id<'users'>;
	isNew: boolean;
};

type CreateSessionResult = {
	sessionId: string;
};

type AuthOpsQuery<T> = {
	withIndex(indexName: string, cb: (q: any) => any): AuthOpsQuery<T>;
	filter(cb: (q: any) => any): AuthOpsQuery<T>;
	first(): Promise<T | null>;
	collect(): Promise<T[]>;
};

type AuthOpsDb = {
	query(tableName: 'accounts'): AuthOpsQuery<Doc<'accounts'>>;
	query(tableName: 'users'): AuthOpsQuery<Doc<'users'>>;
	query(tableName: 'sessions'): AuthOpsQuery<Doc<'sessions'>>;
	get(id: Id<'users'>): Promise<Doc<'users'> | null>;
	get(id: Id<'sessions'>): Promise<Doc<'sessions'> | null>;
	normalizeId(tableName: 'users', id: string): Id<'users'> | null;
	normalizeId(tableName: 'sessions', id: string): Id<'sessions'> | null;
	insert(tableName: 'users', value: Record<string, unknown>): Promise<Id<'users'>>;
	insert(tableName: 'accounts', value: Record<string, unknown>): Promise<Id<'accounts'>>;
	insert(tableName: 'sessions', value: Record<string, unknown>): Promise<Id<'sessions'>>;
	// Insert-only — written by the OAuth email-change tripwire path;
	// never read or patched from this file. No consumer wired in-tree.
	insert(
		tableName: 'verificationAudits',
		value: Record<string, unknown>
	): Promise<Id<'verificationAudits'>>;
	patch(
		id: Id<'users'> | Id<'accounts'> | Id<'sessions'>,
		value: Record<string, unknown>
	): Promise<void>;
	delete(id: Id<'sessions'>): Promise<void>;
};

function authOpsDb(ctx: any): AuthOpsDb {
	return ctx.db as AuthOpsDb;
}

// =============================================================================
// OAUTH USER UPSERT
// =============================================================================

/**
 * Find or create a user from an OAuth callback.
 *
 * Logic:
 * 1. Check for existing OAuth account (provider + providerAccountId)
 * 2. If found, update tokens and return existing user
 * 3. If not found, check for existing user by emailHash
 * 4. If user exists, link new OAuth account
 * 5. If no user, create new user + account
 *
 * Returns the user ID for session creation.
 */
export const upsertFromOAuth = mutation({
	args: {
		_secret: v.string(),
		provider: v.string(),
		providerAccountId: v.string(),
		scope: v.string(),

		// User data from provider. email is REQUIRED — per
		// [[feedback_email_sybil]] anti-sybil throttle at users.ts:747
		// keys off emailHash, which is derived from this field. Both
		// callers (oauth-callback-handler at line 167, dev-login at :94)
		// already guard against missing email before invoking; the args
		// validator now matches that real-world invariant. A future
		// OAuth provider that legitimately omits email needs an
		// explicit feature-flag carve-out (none today).
		email: v.string(),
		name: v.optional(v.string()),
		avatar: v.optional(v.string()),
		emailVerified: v.boolean(),

		// Token data (encrypted)
		encryptedAccessToken: v.optional(v.any()),
		encryptedRefreshToken: v.optional(v.any()),
		expiresAt: v.optional(v.number())
	},
	returns: v.object({
		userId: v.id('users'),
		isNew: v.boolean()
	}),
	handler: async (ctx: any, args): Promise<UpsertFromOAuthResult> => {
		// Trust gate: only SvelteKit's OAuth callback (which has verified the
		// provider's `code → token → user-info` round-trip) should be able to
		// link a provider account to a user record. Without this gate, an
		// attacker could call api.authOps.upsertFromOAuth directly with a
		// chosen providerAccountId and a victim's email — the email-match path
		// at line 154 would link the attacker's provider identity to the
		// victim's user record, enabling account takeover on the next legitimate
		// OAuth login.
		requireInternalSecret(args._secret);

		// v.string() accepts "" — the sybil throttle would then hash the
		// empty string and collide every empty-email caller onto one
		// emailHash bucket. Reject at the runtime gate so the validator
		// shape stays simple.
		if (args.email.trim().length === 0) {
			throw new Error('UPSERT_OAUTH_EMAIL_EMPTY');
		}

		const db = authOpsDb(ctx);
		const now = Date.now();

		// user.emailHash is the dedup key for the email-sybil ceiling in
		// `verifyAddress` (convex/users.ts:894 reads the siblings, :948-954
		// throws ADDRESS_VERIFICATION_EMAIL_SYBIL, :1210 projects the same count
		// read-only). It caps distinct userIds sharing one mailbox inside a
		// trailing 180-day window; leaving it unset on signup silently neutered
		// the gate, so it is set on every path below.
		//
		// The hash is taken over a CANONICAL mailbox, not the raw string. The
		// gate's own rationale is that throwaway-account farms bypass the
		// per-userId throttle — and a plus-tag is the cheapest possible farm:
		// one real inbox, unlimited addresses, each landing in its own bucket
		// and clearing the ceiling independently.
		const canonicalMailbox = (email: string): string => {
			const trimmed = email.toLowerCase().trim();
			const at = trimmed.lastIndexOf('@');
			if (at <= 0) return trimmed;
			const local = trimmed.slice(0, at);
			const domain = trimmed.slice(at + 1);
			// Sub-addressing is near-universal (Gmail, Outlook, Fastmail, most
			// self-hosted). Dot-insensitivity is NOT — it is a Gmail behaviour,
			// and stripping dots globally would merge two genuinely different
			// mailboxes on hosts that treat them as distinct. Only the tag goes.
			const plus = local.indexOf('+');
			return `${plus >= 0 ? local.slice(0, plus) : local}@${domain}`;
		};

		const emailHashFor = async (email: string): Promise<string> => {
			const buf = await crypto.subtle.digest(
				'SHA-256',
				new TextEncoder().encode(canonicalMailbox(email))
			);
			return Array.from(new Uint8Array(buf))
				.map((b) => b.toString(16).padStart(2, '0'))
				.join('');
		};

		// Step 1: Check for existing OAuth account
		const existingAccount = await db
			.query('accounts')
			.withIndex('by_provider_providerAccountId', (q) =>
				q.eq('provider', args.provider).eq('providerAccountId', args.providerAccountId)
			)
			.first();

		if (existingAccount) {
			// Update existing account tokens
			await db.patch(existingAccount._id, {
				expiresAt: args.expiresAt,
				encryptedAccessToken: args.encryptedAccessToken,
				encryptedRefreshToken: args.encryptedRefreshToken,
				emailVerified: args.emailVerified,
				updatedAt: now
			});

			// Backfill tokenIdentifier + plaintext email + emailHash if missing.
			//
			// F37-drift cure: an OAuth provider may return a NEW email for an
			// existing account (Google/Microsoft email-change without account
			// re-link). The lookup above is by providerAccountId, so args.email
			// can diverge from existingUser0.email. Hashing args.email and
			// storing the hash without updating existingUser0.email would
			// create a drift: by_email index points at OLD, by_emailHash index
			// points at NEW. The sybil throttle would then mis-attribute the
			// user. Fix: derive emailHash from the CANONICAL stored email
			// (existingUser0.email), not args.email. If existingUser0.email is
			// empty (legacy user), use args.email AND set existingUser0.email
			// atomically so both indices agree.
			//
			// Provider-returned email-change: the stored email wins (drift
			// cure preserves canonical state). A verificationAudits row is
			// written below as a tripwire — see the email-change audit
			// block.
			const existingUser0 = await db.get(existingAccount.userId);
			if (existingUser0) {
				const patch: Record<string, unknown> = {};
				if (!existingUser0.tokenIdentifier) {
					patch.tokenIdentifier = `${ISSUER_PREFIX}|${existingAccount.userId}`;
				}
				const canonicalEmail = existingUser0.email ?? args.email;
				if (!existingUser0.email) {
					patch.email = args.email;
					patch.name = args.name ?? existingUser0.name;
					patch.custodyMode = 'plaintext';
				}
				if (!existingUser0.emailHash && canonicalEmail) {
					patch.emailHash = await emailHashFor(canonicalEmail);
				}
				if (Object.keys(patch).length > 0) {
					await db.patch(existingAccount.userId, patch);
					if (patch.name !== undefined && patch.name !== existingUser0.name) {
						await bumpPublicTemplatePageArtifactsForAuthor(ctx, existingAccount.userId, now);
					}
				}

				// Provider-returned email-change observability. When the OAuth
				// provider returns an email different from the canonical stored
				// email (Google/Microsoft account email-change without re-link),
				// write a verificationAudits row so ops sees the drift. The
				// stored email is preserved (drift cure); this row is the
				// tripwire — it does NOT carry old/new email values (privacy
				// minimization; verificationAudits has no oldEmailHash /
				// newEmailHash fields). Ops investigation requires correlating
				// verificationAudits.userId with provider-side audit logs.
				// result='success' because the OAuth handshake succeeded and
				// the user logs in normally; this is an observation event, not
				// a verification failure. errorCode carries the divergence
				// signal for query filtering. Duplicate rows can land under
				// OCC retry; dedup is a consumer responsibility (no consumer
				// wired in-tree yet).
				if (args.email !== existingUser0.email) {
					await db.insert('verificationAudits', {
						userId: existingAccount.userId,
						verificationMethod: `oauth-email-change:${args.provider}`,
						result: 'success',
						errorCode: 'PROVIDER_EMAIL_DIFFERS_FROM_STORED'
					});
				}

				// Lazy repair plus transactional maintenance for the two-row session
				// authority path. OAuth-token churn itself does not touch this row.
				await syncSessionAuthority(ctx, existingAccount.userId);
			}

			return { userId: existingAccount.userId, isNew: false };
		}

		// Step 2: Check for existing user by email (dedup for existing accounts)
		const existingUser = args.email
			? await db
					.query('users')
					.withIndex('by_email', (q) => q.eq('email', args.email))
					.first()
			: null;

		if (existingUser) {
			// Link OAuth account to existing user
			await db.insert('accounts', {
				userId: existingUser._id,
				type: 'oauth',
				provider: args.provider,
				providerAccountId: args.providerAccountId,
				expiresAt: args.expiresAt,
				tokenType: 'Bearer',
				scope: args.scope,
				encryptedAccessToken: args.encryptedAccessToken,
				encryptedRefreshToken: args.encryptedRefreshToken,
				emailVerified: args.emailVerified,
				updatedAt: now
			});

			// Backfill tokenIdentifier + plaintext email + emailHash if missing.
			// In this branch, existingUser was FOUND via the by_email index
			// against args.email, so the two are guaranteed equal at lookup
			// time — no F37-drift risk here. Hash whichever is present.
			const userPatch: Record<string, unknown> = {};
			if (!existingUser.tokenIdentifier) {
				userPatch.tokenIdentifier = `${ISSUER_PREFIX}|${existingUser._id}`;
			}
			if (!existingUser.email && args.email) {
				userPatch.email = args.email;
				userPatch.name = args.name ?? existingUser.name;
				userPatch.custodyMode = 'plaintext';
			}
			const canonicalEmail = existingUser.email ?? args.email ?? undefined;
			if (!existingUser.emailHash && canonicalEmail) {
				userPatch.emailHash = await emailHashFor(canonicalEmail);
			}
			if (Object.keys(userPatch).length > 0) {
				await db.patch(existingUser._id, userPatch);
				if (userPatch.name !== undefined && userPatch.name !== existingUser.name) {
					await bumpPublicTemplatePageArtifactsForAuthor(ctx, existingUser._id, now);
				}
			}

			await syncSessionAuthority(ctx, existingUser._id);

			return { userId: existingUser._id, isNew: false };
		}

		// Step 3: Create new user + account
		const baseTrustScore = args.emailVerified ? 100 : 50;
		// Reputation tier starts at 'new' regardless of email-verification — email
		// verification raises trustTier to 1, but reputation is a behavioral
		// axis (templates contributed, peer endorsements, etc.) that begins at 0.
		// The T10-1 cron is the only writer for promotions.
		const baseReputationTier = 'new';

		const userId = await db.insert('users', {
			avatar: args.avatar,
			email: args.email,
			emailHash: args.email ? await emailHashFor(args.email) : undefined,
			name: args.name,
			updatedAt: now,

			// Verification
			isVerified: false,

			// Authority & trust
			authorityLevel: 1,
			trustTier: args.emailVerified ? 1 : 0,
			trustScore: baseTrustScore,
			reputationTier: baseReputationTier,

			// Defaults
			districtVerified: false,
			templatesContributed: 0,
			templateAdoptionRate: 0,
			peerEndorsements: 0,
			activeMonths: 0,
			profileVisibility: 'private'
		});

		// Store tokenIdentifier so requireAuth() can resolve JWT identity → user.
		// Format matches Convex's `<issuer>|<sub>` convention for custom JWT providers.
		await db.patch(userId, {
			tokenIdentifier: `${ISSUER_PREFIX}|${userId}`
		});

		await syncSessionAuthority(ctx, userId);

		// Create linked account
		await db.insert('accounts', {
			userId,
			type: 'oauth',
			provider: args.provider,
			providerAccountId: args.providerAccountId,
			expiresAt: args.expiresAt,
			tokenType: 'Bearer',
			scope: args.scope,
			encryptedAccessToken: args.encryptedAccessToken,
			encryptedRefreshToken: args.encryptedRefreshToken,
			emailVerified: args.emailVerified,
			updatedAt: now
		});

		return { userId, isNew: true };
	}
});

// =============================================================================
// SESSION MANAGEMENT
// =============================================================================

/**
 * Create a session for a user. Called from SvelteKit after OAuth upsert.
 *
 * Requires an HMAC proof: HMAC-SHA256(userId, SESSION_CREATION_SECRET).
 * Only the SvelteKit server knows SESSION_CREATION_SECRET, preventing
 * arbitrary clients from forging sessions via the public Convex API.
 */
export const createSession = mutation({
	args: {
		userId: v.string(),
		expiresAt: v.number(),
		proof: v.string() // HMAC-SHA256(userId, SESSION_CREATION_SECRET) — hex
	},
	returns: v.object({
		sessionId: v.string()
	}),
	handler: async (ctx: any, args): Promise<CreateSessionResult> => {
		const db = authOpsDb(ctx);
		// Verify the caller knows SESSION_CREATION_SECRET. Dual-secret rotation:
		// try the active secret first, then the optional previous (set during
		// a rotation window). Web Crypto's subtle.verify is the constant-time
		// primitive; iterating candidates does NOT leak which secret matched
		// (every candidate runs to completion via verify; we simply OR the
		// results).
		const activeSecret = process.env.SESSION_CREATION_SECRET;
		if (!activeSecret) {
			throw new Error('SESSION_CREATION_SECRET not configured');
		}
		if (activeSecret.length < 32) {
			throw new Error('SESSION_CREATION_SECRET must be >= 32 bytes');
		}
		const previousSecret = process.env.SESSION_CREATION_SECRET_PREVIOUS;
		const candidates = previousSecret ? [activeSecret, previousSecret] : [activeSecret];

		const encoder = new TextEncoder();

		function hexToBytes(hex: string): Uint8Array {
			const bytes = new Uint8Array(hex.length / 2);
			for (let i = 0; i < bytes.length; i++) {
				bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
			}
			return bytes;
		}

		// Proof is bound to userId + expiresAt to prevent replay.
		const proofBytes = toArrayBuffer(hexToBytes(args.proof));
		const payloadBytes = toArrayBuffer(encoder.encode(`${args.userId}|${args.expiresAt}`));

		let valid = false;
		for (const secret of candidates) {
			const key = await crypto.subtle.importKey(
				'raw',
				encoder.encode(secret),
				{ name: 'HMAC', hash: 'SHA-256' },
				false,
				['verify']
			);
			const candidateValid = await crypto.subtle.verify('HMAC', key, proofBytes, payloadBytes);
			if (candidateValid) {
				valid = true;
				// Don't break early — keep timing comparable between rotation and
				// single-secret operation. The cost is one extra subtle.verify
				// when running with _PREVIOUS set, only during the rotation window.
			}
		}

		if (!valid) {
			throw new Error('Invalid session creation proof');
		}

		// Validate expiresAt is reasonable (within 95 days — buffer for cross-server clock skew)
		const maxExpiry = Date.now() + 95 * 24 * 60 * 60 * 1000;
		if (args.expiresAt > maxExpiry || args.expiresAt < Date.now() - 60000) {
			throw new Error('Invalid session expiry');
		}

		// Validate the userId refers to an actual user
		const userId = db.normalizeId('users', args.userId);
		const user = userId ? await db.get(userId) : null;

		if (!user) {
			throw new Error('User not found');
		}

		const sessionId = await db.insert('sessions', {
			userId: user._id,
			expiresAt: args.expiresAt
		});

		return { sessionId };
	}
});

/**
 * Invalidate (delete) a session. Called from SvelteKit logout route.
 * Accepts session ID as string for cross-system compatibility.
 */
export const invalidateSession = mutation({
	args: {
		sessionId: v.string()
	},
	returns: v.null(),
	handler: async (ctx: any, args): Promise<null> => {
		const db = authOpsDb(ctx);
		const { userId: authUserId } = await requireAuth(ctx);
		const sessionId = db.normalizeId('sessions', args.sessionId);
		const session = sessionId ? await db.get(sessionId) : null;
		if (session) {
			if (session.userId !== authUserId) throw new Error('Unauthorized');
			await db.delete(session._id);
		}
		return null;
	}
});

// =============================================================================
// RETIRED SESSION VALIDATION
// =============================================================================

const DAY_MS = 1000 * 60 * 60 * 24;
const MAX_SESSION_LIFETIME_MS = 90 * DAY_MS;

/**
 * Retired compatibility surface.
 *
 * Request authentication now uses the compact sessionAuthority projection and
 * performs expiry at the SvelteKit request boundary. Keeping this historical
 * two-document reader reachable would create a second authority path and its
 * Date.now() dependency would defeat Convex query-cache reuse. Fail before
 * authorization or database work so a stale caller cannot silently bypass the
 * launch authority plane.
 */
export const validateSession = query({
	args: { _secret: v.string(), sessionId: v.string() },
	handler: async () => {
		throw new Error('AUTHOPS_VALIDATE_SESSION_RETIRED');
	}
});

/**
 * Backfill tokenIdentifier for users created before the JWT auth bridge.
 * Called fire-and-forget from hooks.server.ts when a valid session exists
 * but the user doc has no tokenIdentifier.
 */
export const backfillTokenIdentifier = mutation({
	args: {},
	returns: v.null(),
	handler: async (ctx: any): Promise<null> => {
		const db = authOpsDb(ctx);
		const { userId } = await requireAuth(ctx);
		const user = await db.get(userId);
		if (user && !user.tokenIdentifier) {
			await db.patch(user._id, {
				tokenIdentifier: `${ISSUER_PREFIX}|${user._id}`
			});
			await syncSessionAuthority(ctx, user._id);
		}
		return null;
	}
});

/**
 * Renew a session's expiry after the request-boundary clock check. Separated
 * from the stable two-row query so the read path remains cacheable.
 */
export const renewSession = mutation({
	args: {
		_secret: v.optional(v.string()),
		sessionId: v.string(),
		renewTo: v.optional(v.number())
	},
	returns: v.null(),
	handler: async (ctx: any, { _secret, sessionId, renewTo }): Promise<null> => {
		const db = authOpsDb(ctx);
		// Validate caller authority before touching the session index. New server
		// hooks use the internal secret; the fallback exists only for one rolling
		// deploy window with an older authenticated Pages worker.
		const fallbackAuth = _secret === undefined ? await requireAuth(ctx) : null;
		if (_secret !== undefined) requireInternalSecret(_secret);
		const normalizedSessionId = db.normalizeId('sessions', sessionId);
		const session = normalizedSessionId ? await db.get(normalizedSessionId) : null;
		if (!session) return null;
		if (fallbackAuth && session.userId !== fallbackAuth.userId) throw new Error('Unauthorized');
		const now = Date.now();
		const absoluteExpiresAt = session._creationTime + MAX_SESSION_LIFETIME_MS;
		if (now >= Math.min(session.expiresAt, absoluteExpiresAt)) return null;
		const nextExpiresAt = renewTo ?? Math.min(now + DAY_MS * 30, absoluteExpiresAt);
		if (
			!Number.isFinite(nextExpiresAt) ||
			nextExpiresAt <= now ||
			nextExpiresAt > absoluteExpiresAt ||
			nextExpiresAt > now + DAY_MS * 31
		) {
			throw new Error('SESSION_RENEWAL_EXPIRY_INVALID');
		}
		await db.patch(session._id, {
			expiresAt: nextExpiresAt
		});
		return null;
	}
});
