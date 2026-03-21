/**
 * Identity Commitment Binding Service
 *
 * Prevents Sybil attacks by binding verified identity commitments to users.
 * When a user verifies their identity, their commitment is stored.
 * Future OAuth logins producing the same commitment are linked to existing account.
 *
 * ISSUE-001: Cross-Provider Identity Deduplication
 * Problem: User can create 5 accounts via 5 different OAuth providers.
 * Solution: Bind the identity_commitment from verification to the User model.
 * When a verified user logs in with a new OAuth provider, link to existing account.
 *
 * Flow:
 * 1. User signs up via OAuth (Google, Twitter, etc.)
 * 2. User completes identity verification (Digital Credentials API / mDL)
 * 3. bindIdentityCommitment() is called with the cryptographic commitment
 * 4. If commitment already exists for another user, accounts are MERGED
 * 5. Future logins with any OAuth provider recognize the same identity
 */

import { prisma } from '$lib/core/db';
import { createHash } from 'crypto';
import { BN254_MODULUS } from '$lib/core/crypto/bn254';

// =============================================================================
// TYPES
// =============================================================================

export interface IdentityBindingResult {
	success: boolean;
	linkedToExisting: boolean;
	userId: string;
	previousUserId?: string;
	requireReauth?: boolean;
	mergeDetails?: {
		accountsMoved: number;
		sourceEmail: string;
		targetEmail: string;
	};
}

export interface MergeAccountsResult {
	accountsMoved: number;
	sourceDeleted: boolean;
}

// =============================================================================
// IDENTITY COMMITMENT GENERATION
// =============================================================================

/**
 * Compute identity commitment from verification proof data.
 *
 * Produces a deterministic value per verified person regardless of OAuth provider.
 * The output is guaranteed to be a valid BN254 field element (< modulus) so it
 * can be used directly as a private input to the ZK circuit for nullifier computation.
 *
 * Pipeline: SHA-256(SHA-256(domain:passport:nationality:birthYear:documentType)) mod BN254
 *
 * NOTE: Different from identity_hash (which is unbounded SHA-256 for Sybil detection).
 */
export function computeIdentityCommitment(
	passportNumber: string,
	nationality: string,
	birthYear: number,
	documentType: string
): string {
	// Domain separation prefix prevents cross-protocol hash collisions
	// FROZEN: changing this prefix would invalidate all existing identity commitments
	const DOMAIN_PREFIX = 'commons-identity-v1';

	// BR6-002: Platform salt prevents offline passport enumeration attacks.
	// Without salt, an attacker with passport databases could precompute
	// all commitments and link them to on-chain nullifiers.
	const COMMITMENT_SALT = process.env.IDENTITY_COMMITMENT_SALT;
	if (!COMMITMENT_SALT || !/^[0-9a-f]{64}$/i.test(COMMITMENT_SALT)) {
		throw new Error(
			'IDENTITY_COMMITMENT_SALT must be 64 hex characters (32 bytes). ' +
				'Generate with: openssl rand -hex 32'
		);
	}

	// Normalize inputs for consistent hashing
	const normalized = [
		DOMAIN_PREFIX,
		COMMITMENT_SALT,
		passportNumber.toUpperCase().trim(),
		nationality.toUpperCase().trim(),
		birthYear.toString(),
		documentType.toLowerCase().trim()
	].join(':');

	// Double-hash with domain separation for preimage resistance
	const inner = createHash('sha256').update(normalized).digest();
	const rawHex = createHash('sha256').update(inner).digest('hex');

	// Reduce mod BN254 — SHA-256 is 256 bits but BN254 field is ~254 bits.
	// ~25% of SHA-256 outputs exceed the modulus; reduction ensures the commitment
	// is always a valid field element for ZK circuit consumption.
	const value = BigInt('0x' + rawHex);
	const reduced = value % BN254_MODULUS;
	return reduced.toString(16).padStart(64, '0');
}

/**
 * Generate fingerprint for audit-safe logging (first 16 chars)
 */
export function getCommitmentFingerprint(commitment: string): string {
	return commitment.substring(0, 16);
}

// =============================================================================
// IDENTITY BINDING
// =============================================================================

/**
 * Bind an identity commitment to a user
 *
 * If the commitment already exists for another user, merge accounts:
 * - Move all OAuth accounts from current user to existing user
 * - Delete the duplicate user record
 * - Return the existing user's ID
 *
 * This prevents Sybil attacks where someone creates multiple accounts
 * via different OAuth providers and then tries to get verified on each.
 *
 * @param currentUserId - The user who just completed verification
 * @param identityCommitment - The cryptographic commitment from verification
 * @returns Binding result with merge details if applicable
 */
export async function bindIdentityCommitment(
	currentUserId: string,
	identityCommitment: string
): Promise<IdentityBindingResult> {
	const result = await prisma.$transaction(async (tx) => {
		// Lock the current user row to serialize concurrent bindings (F-R3-12: TOCTOU fix)
		await tx.$queryRaw`SELECT id FROM "user" WHERE id = ${currentUserId} FOR UPDATE`;

		// F-R3-20: Idempotency guard — if currentUserId was already merged away,
		// look up the canonical user by commitment instead of throwing RecordNotFound
		const currentUser = await tx.user.findUnique({
			where: { id: currentUserId },
			select: { id: true, email: true, identity_commitment: true }
		});
		if (!currentUser) {
			const canonicalUser = await tx.user.findUnique({
				where: { identity_commitment: identityCommitment },
				select: { id: true }
			});
			if (canonicalUser) {
				return { success: true, linkedToExisting: true, userId: canonicalUser.id, requireReauth: true };
			}
			throw new Error('User not found and no existing identity binding');
		}

		// Check if this commitment is already bound to another user
		// FOR UPDATE lock prevents a concurrent transaction from binding the same commitment
		const existingUsers = await tx.$queryRaw<Array<{ id: string; email: string }>>`
			SELECT id, email FROM "user"
			WHERE identity_commitment = ${identityCommitment}
			FOR UPDATE
		`;
		const existingUser = existingUsers[0] ?? null;

		if (existingUser && existingUser.id !== currentUserId) {
			// Commitment belongs to different user - merge accounts
			console.debug(
				`[IdentityBinding] Detected duplicate identity. Merging user ${currentUserId} into ${existingUser.id}`
			);

			const mergeResult = await mergeAccountsInTx(tx, currentUserId, existingUser.id);

			return {
				success: true,
				linkedToExisting: true,
				userId: existingUser.id,
				previousUserId: currentUserId,
				requireReauth: true,
				mergeDetails: {
					accountsMoved: mergeResult.accountsMoved,
					sourceEmail: currentUser.email || 'unknown',
					targetEmail: existingUser.email
				}
			};
		}

		// Check if current user already has a different commitment bound
		if (currentUser.identity_commitment && currentUser.identity_commitment !== identityCommitment) {
			// User is trying to bind a different identity - security violation
			console.error(
				`[IdentityBinding] SECURITY: User ${currentUserId} attempted to bind different identity commitment`
			);
			throw new Error('Cannot bind different identity to already verified user');
		}

		// Bind commitment to current user
		await tx.user.update({
			where: { id: currentUserId },
			data: {
				identity_commitment: identityCommitment
			}
		});

		console.debug(`[IdentityBinding] Bound identity commitment to user ${currentUserId}`);

		return {
			success: true,
			linkedToExisting: false,
			userId: currentUserId
		};
	});

	return result;
}

/**
 * Merge accounts within an existing transaction.
 *
 * Moves all related records from sourceUserId to targetUserId,
 * then deletes the source user. Caller must provide the transaction client
 * to avoid nested $transaction calls.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function mergeAccountsInTx(tx: any, sourceUserId: string, targetUserId: string): Promise<MergeAccountsResult> {
	// Count accounts being moved for logging
	const accountCount = await tx.account.count({
		where: { user_id: sourceUserId }
	});

	// Move all OAuth accounts to target user
	await tx.account.updateMany({
		where: { user_id: sourceUserId },
		data: { user_id: targetUserId }
	});

	// Move verification sessions (if any pending)
	await tx.verificationSession.updateMany({
		where: { user_id: sourceUserId },
		data: { user_id: targetUserId }
	});

	// Move verification audits for compliance trail
	await tx.verificationAudit.updateMany({
		where: { user_id: sourceUserId },
		data: { user_id: targetUserId }
	});

	// Move templates created by source user
	await tx.template.updateMany({
		where: { userId: sourceUserId },
		data: { userId: targetUserId }
	});

	// Move template campaigns
	await tx.template_campaign.updateMany({
		where: { user_id: sourceUserId },
		data: { user_id: targetUserId }
	});

	// Move UserDMRelation records — per-row merge to avoid updateMany aborting
	// on ANY unique violation and subsequent deleteMany losing non-conflicting rows
	{
		const sourceRels = await tx.userDMRelation.findMany({ where: { userId: sourceUserId } });
		const targetDmIds = new Set(
			(await tx.userDMRelation.findMany({
				where: { userId: targetUserId },
				select: { decisionMakerId: true }
			})).map((r: { decisionMakerId: string }) => r.decisionMakerId)
		);
		for (const rel of sourceRels) {
			if (targetDmIds.has(rel.decisionMakerId)) {
				await tx.userDMRelation.delete({ where: { id: rel.id } });
			} else {
				await tx.userDMRelation.update({ where: { id: rel.id }, data: { userId: targetUserId } });
			}
		}
	}

	// Move Shadow Atlas registrations (NUL-001: preserve nullifier continuity)
	// ShadowAtlasRegistration is @unique on user_id — per-row merge
	{
		const sourceReg = await tx.shadowAtlasRegistration.findFirst({ where: { user_id: sourceUserId } });
		if (sourceReg) {
			const targetReg = await tx.shadowAtlasRegistration.findFirst({ where: { user_id: targetUserId } });
			if (targetReg) {
				// Both users registered — keep target's registration, delete source's
				await tx.shadowAtlasRegistration.delete({ where: { id: sourceReg.id } });
			} else {
				await tx.shadowAtlasRegistration.update({
					where: { id: sourceReg.id },
					data: { user_id: targetUserId }
				});
			}
		}
	}

	// Move Segments — createdBy has no onDelete (RESTRICT), would cause FK violation
	await tx.segment.updateMany({
		where: { createdBy: sourceUserId },
		data: { createdBy: targetUserId }
	});

	// Move OrgMembership — @@unique([userId, orgId]), onDelete: Cascade
	// If both users are in same org, keep the higher-privilege role
	{
		const ROLE_RANK: Record<string, number> = { owner: 3, editor: 2, member: 1 };
		const sourceMemberships = await tx.orgMembership.findMany({ where: { userId: sourceUserId } });
		const targetOrgIds = new Map<string, { orgId: string; id: string; role: string }>(
			(await tx.orgMembership.findMany({
				where: { userId: targetUserId },
				select: { orgId: true, id: true, role: true }
			})).map((m: { orgId: string; id: string; role: string }) => [m.orgId, m] as const)
		);
		for (const mem of sourceMemberships) {
			const existing = targetOrgIds.get(mem.orgId);
			if (existing) {
				// Both in same org — keep higher role on target, delete source
				if ((ROLE_RANK[mem.role] ?? 0) > (ROLE_RANK[existing.role] ?? 0)) {
					await tx.orgMembership.update({ where: { id: existing.id }, data: { role: mem.role } });
				}
				await tx.orgMembership.delete({ where: { id: mem.id } });
			} else {
				await tx.orgMembership.update({ where: { id: mem.id }, data: { userId: targetUserId } });
			}
		}
	}

	// Move Subscription — @unique userId, onDelete: Cascade
	// Transfer source's subscription if target doesn't have one; otherwise keep higher-value
	{
		const sourceSub = await tx.subscription.findFirst({ where: { userId: sourceUserId } });
		if (sourceSub) {
			const targetSub = await tx.subscription.findFirst({ where: { userId: targetUserId } });
			if (targetSub) {
				// Both have subscriptions — keep the one with higher price, delete the other
				if (sourceSub.price_cents > targetSub.price_cents) {
					await tx.subscription.delete({ where: { id: targetSub.id } });
					await tx.subscription.update({ where: { id: sourceSub.id }, data: { userId: targetUserId } });
				} else {
					await tx.subscription.delete({ where: { id: sourceSub.id } });
				}
			} else {
				await tx.subscription.update({ where: { id: sourceSub.id }, data: { userId: targetUserId } });
			}
		}
	}

	// Move EncryptedDeliveryData — @unique user_id, onDelete: Cascade
	// Transfer if target doesn't have one; if both exist, keep target's (more recent identity)
	{
		const sourceEdd = await tx.encryptedDeliveryData.findFirst({ where: { user_id: sourceUserId } });
		if (sourceEdd) {
			const targetEdd = await tx.encryptedDeliveryData.findFirst({ where: { user_id: targetUserId } });
			if (targetEdd) {
				// Both have encrypted delivery data — keep target's, delete source's
				await tx.encryptedDeliveryData.delete({ where: { id: sourceEdd.id } });
			} else {
				await tx.encryptedDeliveryData.update({
					where: { id: sourceEdd.id },
					data: { user_id: targetUserId }
				});
			}
		}
	}

	// Move DistrictCredential — @unique user_id, onDelete: Cascade
	{
		const sourceCreds = await tx.districtCredential.findMany({ where: { user_id: sourceUserId } });
		if (sourceCreds.length > 0) {
			const targetCred = await tx.districtCredential.findFirst({ where: { user_id: targetUserId } });
			if (targetCred) {
				// Both have credentials — keep target's (more recent verification), delete source's
				await tx.districtCredential.deleteMany({ where: { user_id: sourceUserId } });
			} else {
				// Transfer source's credential to target
				await tx.districtCredential.updateMany({ where: { user_id: sourceUserId }, data: { user_id: targetUserId } });
			}
		}
	}

	// Delete the duplicate user
	// Cascades will handle any remaining relations
	await tx.user.delete({
		where: { id: sourceUserId }
	});

	console.debug(
		`[IdentityBinding] Merged user ${sourceUserId} into ${targetUserId}: ${accountCount} accounts moved`
	);

	return { accountsMoved: accountCount, sourceDeleted: true };
}

// =============================================================================
// QUERY HELPERS
// =============================================================================

/**
 * Check if a user has a bound identity commitment
 */
export async function hasIdentityCommitment(userId: string): Promise<boolean> {
	const user = await prisma.user.findUnique({
		where: { id: userId },
		select: { identity_commitment: true }
	});
	return !!user?.identity_commitment;
}

/**
 * Find user by identity commitment
 * Returns null if no user has this commitment bound
 */
export async function findUserByCommitment(commitment: string): Promise<string | null> {
	const user = await prisma.user.findUnique({
		where: { identity_commitment: commitment },
		select: { id: true }
	});
	return user?.id ?? null;
}

/**
 * Get identity commitment for a user
 * Returns null if user hasn't completed identity verification
 */
export async function getIdentityCommitment(userId: string): Promise<string | null> {
	const user = await prisma.user.findUnique({
		where: { id: userId },
		select: { identity_commitment: true }
	});
	return user?.identity_commitment ?? null;
}

/**
 * Check if an identity commitment is already in use
 * Useful for pre-flight check before verification
 */
export async function isCommitmentInUse(commitment: string, excludeUserId?: string): Promise<boolean> {
	const user = await prisma.user.findUnique({
		where: { identity_commitment: commitment },
		select: { id: true }
	});

	if (!user) return false;
	if (excludeUserId && user.id === excludeUserId) return false;
	return true;
}
