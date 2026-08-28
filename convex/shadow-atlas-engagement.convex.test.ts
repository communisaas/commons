/// <reference types="vite/client" />

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { convexTest, type TestConvex } from 'convex-test';

import { api, internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import schema from './schema';

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts']);
const SECRET = 'shadow-atlas-engagement-test-secret';
const TOKEN_IDENTIFIER = 'https://commons.email|shadow-atlas-user';
const IDENTITY = 'ab'.repeat(32);
const NORMALIZED_IDENTITY = `0x${IDENTITY}`;
const SIGNER = `0x${'12'.repeat(20)}`;
const ZERO_HASH = `0x${'0'.repeat(64)}`;
type Harness = TestConvex<typeof schema>;

function userValue(): Omit<Doc<'users'>, '_id' | '_creationTime'> {
	return {
		email: 'atlas@example.org',
		name: 'Atlas User',
		tokenIdentifier: TOKEN_IDENTIFIER,
		updatedAt: 1,
		isVerified: true,
		identityCommitment: IDENTITY,
		walletAddress: SIGNER,
		walletType: 'evm',
		authorityLevel: 3,
		trustTier: 3,
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

function claimArgs(userId: Id<'users'>, leaseToken: string) {
	return { _secret: SECRET, userId, leaseToken };
}

const TOKENS = {
	one: '00000000-0000-4000-8000-000000000001',
	two: '00000000-0000-4000-8000-000000000002',
	three: '00000000-0000-4000-8000-000000000003',
	four: '00000000-0000-4000-8000-000000000004'
} as const;

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

describe('durable Shadow Atlas engagement replay state', () => {
	it('serializes concurrent claims to one owner and one coalesced replay', async () => {
		const { authed, userId } = await harness();
		const results = await Promise.all([
			authed.mutation(api.users.claimShadowAtlasEngagement, claimArgs(userId, TOKENS.one)),
			authed.mutation(api.users.claimShadowAtlasEngagement, claimArgs(userId, TOKENS.two))
		]);

		expect(results.filter((result) => result.kind === 'owner')).toHaveLength(1);
		expect(results.filter((result) => result.kind === 'in_flight')).toHaveLength(1);
		expect(results.find((result) => result.kind === 'owner')).toMatchObject({
			identityCommitment: NORMALIZED_IDENTITY,
			signerAddress: SIGNER,
			registrationStatus: 'unseen'
		});
	});

	it('persists one registration-write entitlement across expiry and requires operator repair', async () => {
		const { authed, userId } = await harness();
		await authed.mutation(api.users.claimShadowAtlasEngagement, claimArgs(userId, TOKENS.one));
		await expect(
			authed.mutation(api.users.reserveShadowAtlasEngagementRegistration, {
				_secret: SECRET,
				userId,
				identityCommitment: NORMALIZED_IDENTITY,
				leaseToken: TOKENS.one
			})
		).resolves.toMatchObject({ reserved: true, registrationStatus: 'write_reserved' });

		vi.advanceTimersByTime(45_001);
		await expect(
			authed.mutation(api.users.claimShadowAtlasEngagement, claimArgs(userId, TOKENS.two))
		).resolves.toMatchObject({ kind: 'owner', registrationStatus: 'write_reserved' });
		await expect(
			authed.mutation(api.users.reserveShadowAtlasEngagementRegistration, {
				_secret: SECRET,
				userId,
				identityCommitment: NORMALIZED_IDENTITY,
				leaseToken: TOKENS.two
			})
		).resolves.toMatchObject({ reserved: false, registrationStatus: 'write_reserved' });
	});

	it('requires delayed exact-CAS operator evidence, repairs once, then advances the generation', async () => {
		const { t, authed, userId } = await harness();
		await authed.mutation(api.users.claimShadowAtlasEngagement, claimArgs(userId, TOKENS.one));
		await authed.mutation(api.users.reserveShadowAtlasEngagementRegistration, {
			_secret: SECRET,
			userId,
			identityCommitment: NORMALIZED_IDENTITY,
			leaseToken: TOKENS.one
		});
		const reservationTimestamp = Date.now();
		const repairArgs = {
			userId,
			identityCommitment: NORMALIZED_IDENTITY,
			expectedReservationTimestamp: reservationTimestamp,
			expectedGeneration: 1,
			operator: 'on-call@example.org',
			evidenceReference: 'incident/SA-2026-07-21/metrics-404-and-relay-absent'
		};

		await expect(
			t.mutation(internal.users.repairShadowAtlasEngagementReservation, repairArgs)
		).rejects.toThrow('SHADOW_ATLAS_ENGAGEMENT_REPAIR_LEASE_ACTIVE');
		vi.advanceTimersByTime(45_001);
		await expect(
			t.mutation(internal.users.repairShadowAtlasEngagementReservation, repairArgs)
		).rejects.toThrow('SHADOW_ATLAS_ENGAGEMENT_REPAIR_TOO_EARLY');

		vi.advanceTimersByTime(15 * 60_000 - 45_000);
		await expect(
			t.mutation(internal.users.repairShadowAtlasEngagementReservation, {
				...repairArgs,
				expectedGeneration: 2
			})
		).rejects.toThrow('SHADOW_ATLAS_ENGAGEMENT_REPAIR_CAS_MISMATCH');
		await expect(
			t.mutation(internal.users.repairShadowAtlasEngagementReservation, {
				...repairArgs,
				expectedReservationTimestamp: reservationTimestamp + 1
			})
		).rejects.toThrow('SHADOW_ATLAS_ENGAGEMENT_REPAIR_CAS_MISMATCH');

		await expect(
			t.mutation(internal.users.repairShadowAtlasEngagementReservation, repairArgs)
		).resolves.toEqual({ repaired: true, registrationGeneration: 2, repairCount: 1 });
		await expect(
			t.mutation(internal.users.repairShadowAtlasEngagementReservation, repairArgs)
		).rejects.toThrow('SHADOW_ATLAS_ENGAGEMENT_REPAIR_CAS_MISMATCH');

		await t.run(async (ctx) => {
			expect((await ctx.db.get(userId))?.shadowAtlasEngagement).toMatchObject({
				registrationStatus: 'unseen',
				registrationGeneration: 2,
				repairCount: 1,
				lastRepairOperator: 'on-call@example.org',
				lastRepairEvidence: repairArgs.evidenceReference
			});
		});

		await expect(
			authed.mutation(api.users.claimShadowAtlasEngagement, claimArgs(userId, TOKENS.two))
		).resolves.toMatchObject({
			kind: 'owner',
			registrationStatus: 'unseen',
			registrationGeneration: 2
		});
		await expect(
			authed.mutation(api.users.reserveShadowAtlasEngagementRegistration, {
				_secret: SECRET,
				userId,
				identityCommitment: NORMALIZED_IDENTITY,
				leaseToken: TOKENS.two
			})
		).resolves.toMatchObject({ reserved: true, registrationGeneration: 2 });
	});

	it('repairs a post-write crash from metrics and retains registration across path failure', async () => {
		const { t, authed, userId } = await harness();
		await authed.mutation(api.users.claimShadowAtlasEngagement, claimArgs(userId, TOKENS.one));
		await authed.mutation(api.users.reserveShadowAtlasEngagementRegistration, {
			_secret: SECRET,
			userId,
			identityCommitment: NORMALIZED_IDENTITY,
			leaseToken: TOKENS.one
		});

		// Simulate process loss after the POST: a later metrics read finds index 7.
		vi.advanceTimersByTime(45_001);
		await authed.mutation(api.users.claimShadowAtlasEngagement, claimArgs(userId, TOKENS.two));
		await authed.mutation(api.users.markShadowAtlasEngagementRegistered, {
			_secret: SECRET,
			userId,
			identityCommitment: NORMALIZED_IDENTITY,
			leaseToken: TOKENS.two,
			leafIndex: 7
		});
		await authed.mutation(api.users.recordShadowAtlasEngagementFailure, {
			_secret: SECRET,
			userId,
			identityCommitment: NORMALIZED_IDENTITY,
			leaseToken: TOKENS.two,
			stage: 'path'
		});

		await t.run(async (ctx) => {
			const user = await ctx.db.get(userId);
			expect(user?.shadowAtlasEngagement).toMatchObject({
				registrationStatus: 'registered',
				leafIndex: 7,
				lastFailureStage: 'path'
			});
			expect(user?.shadowAtlasEngagement?.leaseToken).toBeUndefined();
		});
	});

	it('serves only a 60-second registered-root snapshot, then grants one refresh owner', async () => {
		const { authed, userId } = await harness();
		await authed.mutation(api.users.claimShadowAtlasEngagement, claimArgs(userId, TOKENS.one));
		await authed.mutation(api.users.markShadowAtlasEngagementRegistered, {
			_secret: SECRET,
			userId,
			identityCommitment: NORMALIZED_IDENTITY,
			leaseToken: TOKENS.one,
			leafIndex: 3
		});
		const snapshot = {
			engagementRoot: ZERO_HASH,
			engagementPath: Array(20).fill(ZERO_HASH) as string[],
			engagementIndex: 3,
			engagementTier: 1,
			actionCount: '8',
			diversityScore: '2'
		};
		await authed.mutation(api.users.completeShadowAtlasEngagement, {
			_secret: SECRET,
			userId,
			identityCommitment: NORMALIZED_IDENTITY,
			leaseToken: TOKENS.one,
			snapshot
		});

		await expect(
			authed.mutation(api.users.claimShadowAtlasEngagement, claimArgs(userId, TOKENS.two))
		).resolves.toEqual({ kind: 'cached', snapshot });
		vi.advanceTimersByTime(60_001);
		await expect(
			authed.mutation(api.users.claimShadowAtlasEngagement, claimArgs(userId, TOKENS.three))
		).resolves.toMatchObject({ kind: 'owner', registrationStatus: 'registered', leafIndex: 3 });
	});

	it('requires both the server secret and the matching authenticated user', async () => {
		const { t, userId } = await harness();
		await expect(
			t.mutation(api.users.claimShadowAtlasEngagement, claimArgs(userId, TOKENS.one))
		).rejects.toThrow('Not authenticated');

		const wrong = t.withIdentity({ tokenIdentifier: 'https://commons.email|wrong-user' });
		const wrongUserId = await t.run((ctx) =>
			ctx.db.insert('users', {
				...userValue(),
				email: 'wrong@example.org',
				tokenIdentifier: 'https://commons.email|wrong-user'
			})
		);
		await expect(
			wrong.mutation(api.users.claimShadowAtlasEngagement, claimArgs(userId, TOKENS.four))
		).rejects.toThrow('Unauthorized');
		expect(wrongUserId).toBeTruthy();
	});
});
