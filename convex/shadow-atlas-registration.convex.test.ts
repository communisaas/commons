/// <reference types="vite/client" />

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { convexTest, type TestConvex } from 'convex-test';

import { api, internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import schema from './schema';

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts']);
const SECRET = 'shadow-atlas-tree1-test-secret-32-bytes';
const TOKEN_IDENTIFIER = 'https://commons.email|shadow-atlas-tree1-user';
const IDENTITY = 'ab'.repeat(32);
const NORMALIZED_IDENTITY = `0x${IDENTITY}`;
const ROOT = `0x${'0'.repeat(64)}`;
const PATH = Array(20).fill(ROOT) as string[];
const DIGEST_ONE = '11'.repeat(32);
const DIGEST_TWO = '22'.repeat(32);
const KEYS = {
	one: '00000000-0000-4000-8000-000000000001',
	two: '00000000-0000-4000-8000-000000000002',
	three: '00000000-0000-4000-8000-000000000003'
} as const;

type Harness = TestConvex<typeof schema>;

function userValue(
	tokenIdentifier = TOKEN_IDENTIFIER
): Omit<Doc<'users'>, '_id' | '_creationTime'> {
	return {
		email: `${tokenIdentifier.split('|').at(-1)}@example.org`,
		name: 'Atlas User',
		tokenIdentifier,
		updatedAt: 1,
		isVerified: true,
		identityCommitment: IDENTITY,
		verificationMethod: 'mdl',
		authorityLevel: 1,
		trustTier: 5,
		trustScore: 0,
		reputationTier: 'new',
		districtVerified: false,
		templatesContributed: 0,
		templateAdoptionRate: 0,
		peerEndorsements: 0,
		activeMonths: 0,
		profileVisibility: 'private'
	};
}

async function harness(): Promise<{
	t: Harness;
	authed: ReturnType<Harness['withIdentity']>;
	userId: Id<'users'>;
}> {
	const t = convexTest({ schema, modules });
	const userId = await t.run((ctx) => ctx.db.insert('users', userValue()));
	return {
		t,
		authed: t.withIdentity({ tokenIdentifier: TOKEN_IDENTIFIER }),
		userId
	};
}

function reserveArgs(
	userId: Id<'users'>,
	leafDigest: string = DIGEST_ONE,
	idempotencyKey: string = KEYS.one,
	requestedReplace: boolean = false
) {
	return {
		_secret: SECRET,
		userId,
		leafDigest,
		requestedReplace,
		idempotencyKey
	};
}

function coordinates(owner: {
	identityCommitment: string;
	operation: 'register' | 'replace';
	generation: number;
	leafDigest: string;
	idempotencyKey: string;
	priorLeafIndex?: number;
}) {
	return {
		identityCommitment: owner.identityCommitment,
		operation: owner.operation,
		generation: owner.generation,
		leafDigest: owner.leafDigest,
		idempotencyKey: owner.idempotencyKey,
		...(owner.priorLeafIndex === undefined ? {} : { priorLeafIndex: owner.priorLeafIndex })
	};
}

async function committedRegistration(
	authed: ReturnType<Harness['withIdentity']>,
	userId: Id<'users'>
) {
	const owner = await authed.mutation(
		api.users.reserveShadowAtlasRegistrationOperation,
		reserveArgs(userId)
	);
	if (owner.kind !== 'owner') throw new Error('expected owner');
	const operation = coordinates(owner);
	await authed.mutation(api.users.beginShadowAtlasRegistrationDispatch, {
		_secret: SECRET,
		userId,
		...operation
	});
	await authed.mutation(api.users.commitShadowAtlasRegistrationOperation, {
		_secret: SECRET,
		userId,
		...operation,
		leafIndex: 7,
		merkleRoot: ROOT,
		merklePath: PATH
	});
	return operation;
}

beforeEach(() => {
	vi.stubEnv('INTERNAL_API_SECRET', SECRET);
	vi.stubEnv('INTERNAL_API_SECRET_PREVIOUS', '');
	vi.useFakeTimers();
	vi.setSystemTime(new Date('2026-07-21T00:00:00.000Z'));
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllEnvs();
});

describe('durable Shadow Atlas Tree-1 registration operations', () => {
	it('persists one key, then serializes concurrent dispatch claims to one external owner', async () => {
		const { t, authed, userId } = await harness();
		const reservations = await Promise.all([
			authed.mutation(
				api.users.reserveShadowAtlasRegistrationOperation,
				reserveArgs(userId, DIGEST_ONE, KEYS.one)
			),
			authed.mutation(
				api.users.reserveShadowAtlasRegistrationOperation,
				reserveArgs(userId, DIGEST_ONE, KEYS.two)
			)
		]);
		expect(reservations.every((result) => result.kind === 'owner')).toBe(true);
		const owners = reservations.filter((result) => result.kind === 'owner');
		expect(new Set(owners.map((owner) => owner.idempotencyKey))).toEqual(new Set([KEYS.one]));
		expect(owners.filter((owner) => 'resumed' in owner && owner.resumed === true)).toHaveLength(1);

		const operation = coordinates(owners[0]!);
		const dispatches = await Promise.all([
			authed.mutation(api.users.beginShadowAtlasRegistrationDispatch, {
				_secret: SECRET,
				userId,
				...operation
			}),
			authed.mutation(api.users.beginShadowAtlasRegistrationDispatch, {
				_secret: SECRET,
				userId,
				...operation
			})
		]);
		expect(dispatches.filter((result) => result.started)).toHaveLength(1);
		expect(dispatches.filter((result) => !result.started)).toHaveLength(1);
		await t.run(async (ctx) => {
			expect((await ctx.db.get(userId))?.shadowAtlasTree1Operation).toMatchObject({
				status: 'dispatching',
				idempotencyKey: KEYS.one,
				generation: 1
			});
		});
	});

	it('resumes a crash before dispatch with the persisted key and never mints another', async () => {
		const { authed, userId } = await harness();
		const first = await authed.mutation(
			api.users.reserveShadowAtlasRegistrationOperation,
			reserveArgs(userId, DIGEST_ONE, KEYS.one)
		);
		expect(first).toMatchObject({ kind: 'owner', idempotencyKey: KEYS.one });

		const resumed = await authed.mutation(
			api.users.reserveShadowAtlasRegistrationOperation,
			reserveArgs(userId, DIGEST_ONE, KEYS.two)
		);
		expect(resumed).toMatchObject({
			kind: 'owner',
			resumed: true,
			idempotencyKey: KEYS.one,
			generation: 1
		});
		if (resumed.kind !== 'owner') throw new Error('expected resumed owner');
		await expect(
			authed.mutation(api.users.beginShadowAtlasRegistrationDispatch, {
				_secret: SECRET,
				userId,
				...coordinates(resumed)
			})
		).resolves.toMatchObject({ started: true });
	});

	it('keeps a timeout ambiguous and blocks every automatic redispatch', async () => {
		const { t, authed, userId } = await harness();
		const owner = await authed.mutation(
			api.users.reserveShadowAtlasRegistrationOperation,
			reserveArgs(userId)
		);
		if (owner.kind !== 'owner') throw new Error('expected owner');
		const operation = coordinates(owner);
		await authed.mutation(api.users.beginShadowAtlasRegistrationDispatch, {
			_secret: SECRET,
			userId,
			...operation
		});
		await authed.mutation(api.users.markShadowAtlasRegistrationOperationAmbiguous, {
			_secret: SECRET,
			userId,
			...operation,
			failureCode: 'SHADOW_ATLAS_EXTERNAL_OUTCOME_UNKNOWN'
		});

		await expect(
			authed.mutation(
				api.users.reserveShadowAtlasRegistrationOperation,
				reserveArgs(userId, DIGEST_ONE, KEYS.two)
			)
		).resolves.toMatchObject({ kind: 'in_flight', status: 'ambiguous', generation: 1 });
		await expect(
			authed.mutation(api.users.beginShadowAtlasRegistrationDispatch, {
				_secret: SECRET,
				userId,
				...operation
			})
		).resolves.toMatchObject({ started: false, status: 'ambiguous' });
		await t.run(async (ctx) => {
			expect((await ctx.db.get(userId))?.shadowAtlasTree1Operation?.idempotencyKey).toBe(
				KEYS.one
			);
		});
	});

	it('retains dispatch state on commit failure and lets only the exact queue result commit', async () => {
		const { t, authed, userId } = await harness();
		const owner = await authed.mutation(
			api.users.reserveShadowAtlasRegistrationOperation,
			reserveArgs(userId)
		);
		if (owner.kind !== 'owner') throw new Error('expected owner');
		const operation = coordinates(owner);
		await authed.mutation(api.users.beginShadowAtlasRegistrationDispatch, {
			_secret: SECRET,
			userId,
			...operation
		});
		await expect(
			authed.mutation(api.users.commitShadowAtlasRegistrationOperation, {
				_secret: SECRET,
				userId,
				...operation,
				leafIndex: 7,
				merkleRoot: ROOT,
				merklePath: [ROOT]
			})
		).rejects.toThrow('SHADOW_ATLAS_TREE1_PATH_LENGTH_INVALID');
		await expect(
			authed.mutation(api.users.commitShadowAtlasRegistrationOperation, {
				_secret: SECRET,
				userId,
				...operation,
				leafIndex: 2 ** 18,
				merkleRoot: ROOT,
				merklePath: Array(18).fill(ROOT) as string[]
			})
		).rejects.toThrow('SHADOW_ATLAS_TREE1_LEAF_INDEX_INVALID');
		await expect(
			authed.mutation(
				api.users.reserveShadowAtlasRegistrationOperation,
				reserveArgs(userId, DIGEST_ONE, KEYS.two)
			)
		).resolves.toMatchObject({ kind: 'in_flight', status: 'dispatching' });

		await expect(
			t.mutation(api.users.reconcileShadowAtlasRegistrationOperation, {
				_secret: SECRET,
				userId,
				...operation,
				leafIndex: 7,
				merkleRoot: ROOT,
				merklePath: PATH
			})
		).resolves.toEqual({ status: 'committed' });
		await t.run(async (ctx) => {
			const rows = await ctx.db
				.query('shadowAtlasRegistrations')
				.withIndex('by_userId', (q) => q.eq('userId', userId))
				.take(2);
			expect(rows).toHaveLength(1);
			expect(rows[0]).toMatchObject({
				identityCommitment: NORMALIZED_IDENTITY,
				verificationMethod: 'mdl',
				congressionalDistrict: '',
				leafIndex: 7
			});
		});
	});

	it('serializes replacement, patches one canonical row, and rejects a stale generation', async () => {
		const { t, authed, userId } = await harness();
		const firstOperation = await committedRegistration(authed, userId);
		const reservations = await Promise.all([
			authed.mutation(
				api.users.reserveShadowAtlasRegistrationOperation,
				reserveArgs(userId, DIGEST_TWO, KEYS.two, true)
			),
			authed.mutation(
				api.users.reserveShadowAtlasRegistrationOperation,
				reserveArgs(userId, DIGEST_TWO, KEYS.three, true)
			)
		]);
		const owners = reservations.filter((result) => result.kind === 'owner');
		expect(new Set(owners.map((owner) => owner.idempotencyKey))).toEqual(new Set([KEYS.two]));
		expect(owners[0]).toMatchObject({ operation: 'replace', generation: 2, priorLeafIndex: 7 });
		const replaceOperation = coordinates(owners[0]!);
		const dispatches = await Promise.all([
			authed.mutation(api.users.beginShadowAtlasRegistrationDispatch, {
				_secret: SECRET,
				userId,
				...replaceOperation
			}),
			authed.mutation(api.users.beginShadowAtlasRegistrationDispatch, {
				_secret: SECRET,
				userId,
				...replaceOperation
			})
		]);
		expect(dispatches.filter((result) => result.started)).toHaveLength(1);
		await authed.mutation(api.users.commitShadowAtlasRegistrationOperation, {
			_secret: SECRET,
			userId,
			...replaceOperation,
			leafIndex: 9,
			merkleRoot: ROOT,
			merklePath: PATH
		});

		await expect(
			authed.mutation(
				api.users.reserveShadowAtlasRegistrationOperation,
				reserveArgs(userId, DIGEST_TWO, KEYS.three, true)
			)
		).resolves.toMatchObject({ kind: 'cached' });
		await expect(
			t.mutation(api.users.reconcileShadowAtlasRegistrationOperation, {
				_secret: SECRET,
				userId,
				...firstOperation,
				leafIndex: 7,
				merkleRoot: ROOT,
				merklePath: PATH
			})
		).resolves.toEqual({ status: 'stale' });
		await t.run(async (ctx) => {
			const rows = await ctx.db
				.query('shadowAtlasRegistrations')
				.withIndex('by_userId', (q) => q.eq('userId', userId))
				.take(2);
			expect(rows).toHaveLength(1);
			expect(rows[0]?.leafIndex).toBe(9);
		});
	});

	it('requires delayed exact operator evidence, then reopens the same key only', async () => {
		const { t, authed, userId } = await harness();
		const owner = await authed.mutation(
			api.users.reserveShadowAtlasRegistrationOperation,
			reserveArgs(userId)
		);
		if (owner.kind !== 'owner') throw new Error('expected owner');
		const operation = coordinates(owner);
		await authed.mutation(api.users.beginShadowAtlasRegistrationDispatch, {
			_secret: SECRET,
			userId,
			...operation
		});
		const expectedDispatchStartedAt = Date.now();
		const repair = {
			userId,
			...operation,
			expectedDispatchStartedAt,
			operator: 'on-call@example.org',
			evidenceReference: 'incident/SA-TREE1/provider-confirmed-leaf-absent'
		};
		await expect(
			t.mutation(internal.users.repairShadowAtlasRegistrationOperation, repair)
		).rejects.toThrow('SHADOW_ATLAS_TREE1_REPAIR_TOO_EARLY');
		vi.advanceTimersByTime(15 * 60_000);
		await expect(
			t.mutation(internal.users.repairShadowAtlasRegistrationOperation, repair)
		).resolves.toMatchObject({ repaired: true, generation: 1, idempotencyKey: KEYS.one });
		await expect(
			authed.mutation(
				api.users.reserveShadowAtlasRegistrationOperation,
				reserveArgs(userId, DIGEST_ONE, KEYS.two)
			)
		).resolves.toMatchObject({
			kind: 'owner',
			resumed: true,
			generation: 1,
			idempotencyKey: KEYS.one
		});
	});

	it('fails closed when legacy duplicate rows violate the user cardinality invariant', async () => {
		const { t, authed, userId } = await harness();
		await t.run(async (ctx) => {
			for (const leafIndex of [1, 2]) {
				await ctx.db.insert('shadowAtlasRegistrations', {
					userId,
					congressionalDistrict: 'three-tree',
					identityCommitment: NORMALIZED_IDENTITY,
					leafIndex,
					merkleRoot: ROOT,
					merklePath: PATH,
					credentialType: 'three-tree',
					verificationMethod: 'mdl',
					verificationId: userId,
					verificationTimestamp: 1,
					registrationStatus: 'registered',
					expiresAt: Date.now() + 1_000,
					updatedAt: 1
				});
			}
		});
		await expect(
			authed.query(api.users.getShadowAtlasRegistration, { userId })
		).rejects.toThrow('SHADOW_ATLAS_TREE1_REGISTRATION_MULTIPLICITY');
		await expect(
			authed.mutation(
				api.users.reserveShadowAtlasRegistrationOperation,
				reserveArgs(userId)
			)
		).rejects.toThrow('SHADOW_ATLAS_TREE1_REGISTRATION_MULTIPLICITY');
	});
});
