import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';

type CredentialReadCtx = QueryCtx | MutationCtx;

export const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
export const ONE_EIGHTY_DAYS_MS = 180 * 24 * 60 * 60 * 1000;
export const MAX_REVERIFICATIONS_PER_180D = 6;
export const MAX_USERIDS_PER_EMAIL_HASH_180D = 3;

/**
 * Read exactly the rows that can affect the 180-day throttle, newest first.
 * Taking the enforcement threshold is sufficient: once six rows are present,
 * the mutation rejects and no exact count above the cap can change the result.
 */
export async function readReverificationWindow(
	ctx: CredentialReadCtx,
	userId: Id<'users'>,
	now: number
): Promise<Array<Doc<'districtCredentials'>>> {
	return await ctx.db
		.query('districtCredentials')
		.withIndex('by_userId_issuedAt', (q) =>
			q.eq('userId', userId).gt('issuedAt', now - ONE_EIGHTY_DAYS_MS)
		)
		.order('desc')
		.take(MAX_REVERIFICATIONS_PER_180D);
}

/** Constant-cardinality lifetime proof for the no-commitment-downgrade rule. */
export async function hasEverHeldDistrictCommitment(
	ctx: CredentialReadCtx,
	userId: Id<'users'>
): Promise<boolean> {
	const credential = await ctx.db
		.query('districtCredentials')
		.withIndex('by_userId_districtCommitment', (q) =>
			q.eq('userId', userId).gt('districtCommitment', '')
		)
		.first();
	return credential !== null;
}

/**
 * Read only enough recent sibling accounts to decide the email-Sybil gate.
 * `by_emailHash` carries Convex's implicit `_creationTime` suffix, so the
 * trailing-window predicate is enforced by the index rather than in memory.
 */
export async function readRecentEmailHashUsers(
	ctx: CredentialReadCtx,
	emailHash: string,
	now: number
): Promise<Array<Doc<'users'>>> {
	return await ctx.db
		.query('users')
		.withIndex('by_emailHash', (q) =>
			q.eq('emailHash', emailHash).gt('_creationTime', now - ONE_EIGHTY_DAYS_MS)
		)
		.take(MAX_USERIDS_PER_EMAIL_HASH_180D + 1);
}

/**
 * Return the sole unrevoked credential that a replacement must retire.
 * Multiple rows violate the issuance invariant; fail closed before any write
 * rather than revoking an arbitrary bounded subset and leaving a credential
 * active by accident.
 */
export async function readCredentialToReplace(
	ctx: MutationCtx,
	userId: Id<'users'>
): Promise<Doc<'districtCredentials'> | null> {
	const unrevoked = await ctx.db
		.query('districtCredentials')
		.withIndex('by_userId_revokedAt_issuedAt', (q) =>
			q.eq('userId', userId).eq('revokedAt', undefined)
		)
		.order('desc')
		.take(2);
	if (unrevoked.length > 1) {
		throw new Error('DISTRICT_CREDENTIAL_ACTIVE_MULTIPLICITY');
	}
	return unrevoked[0] ?? null;
}
