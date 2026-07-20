import { makeFunctionReference, type FunctionReference } from 'convex/server';
import { ConvexError, v } from 'convex/values';
import { internalMutation, internalQuery, query } from './_generated/server';
import { requireInternalSecret } from './_internalAuth';
import {
	getSessionAuthorityMigration,
	projectSessionAuthority,
	syncSessionAuthority
} from './lib/sessionAuthority';

const DAY_MS = 24 * 60 * 60 * 1000;
export const MAX_SESSION_LIFETIME_MS = 90 * DAY_MS;
const MIGRATION_PAGE_SIZE = 16;
const MIGRATION_MAX_BYTES = 4 * 1024 * 1024;

const migrateSessionAuthoritiesRef = makeFunctionReference<'mutation'>(
	'sessionAuthority:migrateSessionAuthorities'
) as unknown as FunctionReference<
	'mutation',
	'internal',
	{ runToken?: string; restart?: boolean; scheduleContinuation?: boolean },
	unknown
>;

function authorityDto(row: NonNullable<Awaited<ReturnType<typeof readAuthorityRow>>>) {
	return {
		userId: row.userId,
		userCreatedAt: row.userCreatedAt,
		email: row.email,
		tokenIdentifier: row.tokenIdentifier,
		name: row.name,
		avatar: row.avatar,
		isVerified: row.isVerified,
		verificationMethod: row.verificationMethod,
		verifiedAt: row.verifiedAt,
		passkeyCredentialId: row.passkeyCredentialId,
		identityCommitment: row.identityCommitment,
		documentType: row.documentType,
		districtHash: row.districtHash,
		districtVerified: row.districtVerified,
		addressVerifiedAt: row.addressVerifiedAt,
		trustScore: row.trustScore,
		walletAddress: row.walletAddress,
		version: row.version
	};
}

async function readAuthorityRow(ctx: { db: any }, userId: any) {
	return await ctx.db
		.query('userSessionAuthorities')
		.withIndex('by_userId', (q: any) => q.eq('userId', userId))
		.unique();
}

/**
 * Stable two-row hot path. Expiry is returned as data and evaluated against the
 * SvelteKit request clock, so an otherwise unchanged session can remain cached.
 */
export const get = query({
	args: { _secret: v.string(), sessionId: v.string() },
	handler: async (ctx, args) => {
		requireInternalSecret(args._secret);
		const sessionId = ctx.db.normalizeId('sessions', args.sessionId);
		const session = sessionId ? await ctx.db.get(sessionId) : null;
		if (!session) return { status: 'invalid' as const };

		const authority = await readAuthorityRow(ctx, session.userId);
		if (!authority) {
			return {
				status: 'not_ready' as const,
				reason: 'SESSION_AUTHORITY_MISSING' as const
			};
		}

		return {
			status: 'ok' as const,
			session: {
				id: session._id,
				userId: session.userId,
				createdAt: session._creationTime,
				expiresAt: session.expiresAt,
				absoluteExpiresAt: session._creationTime + MAX_SESSION_LIFETIME_MS
			},
			authority: authorityDto(authority)
		};
	}
});

export const migrationStatus = internalQuery({
	args: {},
	handler: async (ctx) => {
		const migration = await getSessionAuthorityMigration(ctx);
		return migration
			? {
					status: migration.status,
					runToken: migration.runToken,
					scanComplete: migration.scanComplete,
					scanned: migration.scanned,
					written: migration.written,
					failureCode: migration.failureCode ?? null,
					failureUserId: migration.failureUserId ?? null,
					startedAt: migration.startedAt,
					completedAt: migration.completedAt ?? null
				}
			: { status: 'not-started' as const };
	}
});

/** Secret-gated readiness for the frontend deployment verifier. */
export const readiness = query({
	args: { _secret: v.string() },
	handler: async (ctx, args) => {
		requireInternalSecret(args._secret);
		const migration = await getSessionAuthorityMigration(ctx);
		return {
			ready:
				migration?.status === 'ready' &&
				migration.scanComplete === true &&
				migration.scanned === migration.written,
			status: migration?.status ?? ('not-started' as const),
			scanned: migration?.scanned ?? 0,
			written: migration?.written ?? 0,
			failureCode: migration?.failureCode ?? null
		};
	}
});

/** Bounded migrate-then-activate cutover; live writers dual-write immediately. */
export const migrateSessionAuthorities = internalMutation({
	args: {
		runToken: v.optional(v.string()),
		restart: v.optional(v.boolean()),
		scheduleContinuation: v.optional(v.boolean())
	},
	handler: async (ctx, args) => {
		if (args.runToken !== undefined && args.restart) {
			throw new Error('SESSION_AUTHORITY_MIGRATION_INVALID_CONTROL');
		}

		let migration = await getSessionAuthorityMigration(ctx);
		let runToken: string;
		let cursor: string | undefined;
		let scanned: number;
		let written: number;

		if (args.runToken !== undefined) {
			if (!migration || migration.status !== 'running' || migration.runToken !== args.runToken) {
				return { status: 'superseded' as const, runToken: args.runToken };
			}
			runToken = args.runToken;
			cursor = migration.cursor;
			scanned = migration.scanned;
			written = migration.written;
		} else if (!args.restart && migration?.status === 'ready') {
			return {
				status: 'already-ready' as const,
				runToken: migration.runToken,
				scanned: migration.scanned,
				written: migration.written
			};
		} else if (!args.restart && migration?.status === 'migrated') {
			return {
				status: 'already-migrated' as const,
				runToken: migration.runToken,
				scanned: migration.scanned,
				written: migration.written
			};
		} else if (!args.restart && migration?.status === 'running') {
			return {
				status: 'already-running' as const,
				runToken: migration.runToken,
				scanned: migration.scanned,
				written: migration.written
			};
		} else if (!args.restart && migration?.status === 'blocked') {
			return {
				status: 'blocked' as const,
				runToken: migration.runToken,
				failureCode: migration.failureCode ?? null,
				failureUserId: migration.failureUserId ?? null
			};
		} else {
			runToken = crypto.randomUUID();
			cursor = undefined;
			scanned = 0;
			written = 0;
			const now = Date.now();
			const initial = {
				key: 'v1' as const,
				status: 'running' as const,
				runToken,
				cursor: undefined,
				scanComplete: false,
				scanned,
				written,
				failureCode: undefined,
				failureUserId: undefined,
				startedAt: now,
				completedAt: undefined,
				updatedAt: now
			};
			if (migration) await ctx.db.patch(migration._id, initial);
			else await ctx.db.insert('sessionAuthorityMigrations', initial);
			migration = await getSessionAuthorityMigration(ctx);
		}

		if (!migration || migration.runToken !== runToken) {
			throw new Error('SESSION_AUTHORITY_MIGRATION_STATE_MISSING');
		}

		const page = await ctx.db
			.query('users')
			.order('asc')
			.paginate({
				cursor: cursor ?? null,
				numItems: MIGRATION_PAGE_SIZE,
				maximumRowsRead: MIGRATION_PAGE_SIZE + 1,
				maximumBytesRead: MIGRATION_MAX_BYTES
			});
		if (page.pageStatus === 'SplitRequired') {
			const failureCode = 'SESSION_AUTHORITY_MIGRATION_PAGE_SPLIT_REQUIRED';
			await ctx.db.patch(migration._id, {
				status: 'blocked',
				failureCode,
				updatedAt: Date.now()
			});
			return { status: 'blocked' as const, runToken, failureCode };
		}

		for (const user of page.page) {
			try {
				projectSessionAuthority(user);
				await syncSessionAuthority(ctx, user._id);
			} catch (error) {
				const failureCode = error instanceof Error ? error.message : String(error);
				await ctx.db.patch(migration._id, {
					status: 'blocked',
					failureCode,
					failureUserId: user._id,
					updatedAt: Date.now()
				});
				return {
					status: 'blocked' as const,
					runToken,
					failureCode,
					failureUserId: user._id
				};
			}
		}

		scanned += page.page.length;
		written += page.page.length;
		const completedAt = page.isDone ? Date.now() : undefined;
		await ctx.db.patch(migration._id, {
			status: page.isDone ? 'migrated' : 'running',
			cursor: page.isDone ? undefined : page.continueCursor,
			scanComplete: page.isDone,
			scanned,
			written,
			failureCode: undefined,
			failureUserId: undefined,
			completedAt,
			updatedAt: Date.now()
		});

		if (!page.isDone && args.scheduleContinuation !== false) {
			await ctx.scheduler.runAfter(0, migrateSessionAuthoritiesRef, { runToken });
		}
		return {
			status: page.isDone ? ('migrated' as const) : ('running' as const),
			runToken,
			scanned,
			written,
			continueCursor: page.isDone ? null : page.continueCursor
		};
	}
});

export const activateSessionAuthorities = internalMutation({
	args: {},
	handler: async (ctx) => {
		const migration = await getSessionAuthorityMigration(ctx);
		if (migration?.status === 'ready') return { status: 'ready' as const };
		if (
			!migration ||
			migration.status !== 'migrated' ||
			!migration.scanComplete ||
			migration.scanned !== migration.written
		) {
			throw new ConvexError({
				code: 'SESSION_AUTHORITY_MIGRATION_INCOMPLETE',
				status: migration?.status ?? 'not-started'
			});
		}
		await ctx.db.patch(migration._id, { status: 'ready', updatedAt: Date.now() });
		return {
			status: 'ready' as const,
			scanned: migration.scanned,
			written: migration.written
		};
	}
});
