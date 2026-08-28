import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';

export const SESSION_AUTHORITY_VERSION = 1;
export const SESSION_AUTHORITY_MAX_BYTES = 8 * 1024;

const encoder = new TextEncoder();

function boundedString(
	name: string,
	value: string | undefined,
	maxBytes: number
): string | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== 'string' || encoder.encode(value).byteLength > maxBytes) {
		throw new Error(`SESSION_AUTHORITY_INVALID:${name}:bytes`);
	}
	return value;
}

function requiredBoundedString(
	name: string,
	value: string | undefined,
	maxBytes: number
): string {
	const bounded = boundedString(name, value, maxBytes);
	if (bounded === undefined || bounded.trim().length === 0) {
		throw new Error(`SESSION_AUTHORITY_INVALID:${name}:required`);
	}
	return bounded;
}

function finiteNumber(name: string, value: number | undefined): number | undefined {
	if (value === undefined) return undefined;
	if (!Number.isFinite(value)) throw new Error(`SESSION_AUTHORITY_INVALID:${name}:finite`);
	return value;
}

/**
 * Reconstruct the only user fields required by the request auth boundary.
 * Never spread a user document here: the allowlist is the byte/correctness
 * contract that keeps encrypted profile material and unrelated counters out of
 * every cookie-bearing request.
 */
export function projectSessionAuthority(user: Doc<'users'>) {
	const projected = {
		userId: user._id as Id<'users'>,
		userCreatedAt: finiteNumber('_creationTime', user._creationTime) as number,
		// The projection refuses to mint an authority row without an email.
		email: requiredBoundedString('email', user.email, 320),
		tokenIdentifier: boundedString('tokenIdentifier', user.tokenIdentifier, 512),
		name: boundedString('name', user.name, 512),
		avatar: boundedString('avatar', user.avatar, 2_048),
		isVerified: user.isVerified,
		verificationMethod: boundedString('verificationMethod', user.verificationMethod, 64),
		verifiedAt: finiteNumber('verifiedAt', user.verifiedAt),
		passkeyCredentialId: boundedString('passkeyCredentialId', user.passkeyCredentialId, 2_048),
		identityCommitment: boundedString('identityCommitment', user.identityCommitment, 512),
		documentType: boundedString('documentType', user.documentType, 64),
		districtHash: boundedString('districtHash', user.districtHash, 256),
		districtVerified: user.districtVerified,
		addressVerifiedAt: finiteNumber('addressVerifiedAt', user.addressVerifiedAt),
		trustScore: finiteNumber('trustScore', user.trustScore) as number,
		walletAddress: boundedString('walletAddress', user.walletAddress, 256),
		version: SESSION_AUTHORITY_VERSION
	};

	const bytes = encoder.encode(JSON.stringify(projected)).byteLength;
	if (bytes > SESSION_AUTHORITY_MAX_BYTES) {
		throw new Error(`SESSION_AUTHORITY_INVALID:projection:${bytes}`);
	}
	return projected;
}

export async function getSessionAuthorityMigration(
	ctx: Pick<QueryCtx, 'db'> | Pick<MutationCtx, 'db'>
) {
	return await ctx.db
		.query('sessionAuthorityMigrations')
		.withIndex('by_key', (q) => q.eq('key', 'v1'))
		.unique();
}

/** Exact upsert after any mutation of a field in the authority allowlist. */
export async function syncSessionAuthority(
	ctx: Pick<MutationCtx, 'db'>,
	userId: Id<'users'>
): Promise<{ inserted: boolean } | null> {
	const [user, existing] = await Promise.all([
		ctx.db.get(userId),
		ctx.db
			.query('userSessionAuthorities')
			.withIndex('by_userId', (q) => q.eq('userId', userId))
			.unique()
	]);
	if (!user) {
		if (existing) await ctx.db.delete(existing._id);
		return null;
	}
	const value = projectSessionAuthority(user);
	if (existing) await ctx.db.patch(existing._id, value);
	else await ctx.db.insert('userSessionAuthorities', value);
	return { inserted: existing === null };
}

export async function deleteSessionAuthority(
	ctx: Pick<MutationCtx, 'db'>,
	userId: Id<'users'>
): Promise<void> {
	const existing = await ctx.db
		.query('userSessionAuthorities')
		.withIndex('by_userId', (q) => q.eq('userId', userId))
		.unique();
	if (existing) await ctx.db.delete(existing._id);
}
