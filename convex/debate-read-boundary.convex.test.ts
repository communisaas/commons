/// <reference types="vite/client" />

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { convexTest, type TestConvex } from 'convex-test';

import { api } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts']);
type Harness = TestConvex<typeof schema>;
const NOW = Date.parse('2026-07-19T12:00:00.000Z');
const SECRET = 'test-internal-secret-0123456789abcdef';

async function fixture(t: Harness) {
	const tokenIdentifier = 'https://issuer.example|debate-read-boundary';
	const email = 'debate-read-boundary@example.test';
	const { userId, templateId, debateId } = await t.run(async (ctx) => {
		const userId = await ctx.db.insert('users', {
			tokenIdentifier,
			email,
			updatedAt: NOW,
			isVerified: true,
			authorityLevel: 3,
			trustTier: 3,
			trustScore: 100,
			reputationTier: 'veteran',
			districtVerified: true,
			templatesContributed: 0,
			templateAdoptionRate: 0,
			peerEndorsements: 0,
			activeMonths: 0,
			profileVisibility: 'private'
		});
		const templateId = await ctx.db.insert('templates', {
			slug: 'debate-read-boundary',
			title: 'Debate read boundary',
			description: 'A bounded debate fixture',
			type: 'email',
			deliveryMethod: 'email',
			preview: 'Preview',
			messageBody: 'Message body',
			deliveryConfig: {},
			recipientConfig: {},
			status: 'published',
			isPublic: true,
			verifiedSends: 0,
			uniqueDistricts: 0,
			embeddingVersion: 'test-v1',
			flaggedByModeration: false,
			consensusApproved: true,
			reputationDelta: 0,
			reputationApplied: false,
			updatedAt: NOW,
			userId
		});
		const debateId = await ctx.db.insert('debates', {
			templateId,
			debateIdOnchain: 'offchain-debate-read-boundary',
			actionDomain: `0x${'11'.repeat(32)}`,
			propositionHash: `0x${'22'.repeat(32)}`,
			propositionText: 'Should the bounded debate fixture proceed?',
			deadline: NOW + 24 * 60 * 60 * 1000,
			jurisdictionSize: 100,
			status: 'active',
			argumentCount: 0,
			uniqueParticipants: 0,
			totalStake: 0,
			resolvedFromChain: false,
			proposerAddress: `0x${'00'.repeat(20)}`,
			proposerBond: 0,
			marketStatus: 'pre_market',
			currentEpoch: 0,
			updatedAt: NOW
		});
		return { userId, templateId, debateId };
	});
	return {
		userId,
		templateId,
		debateId,
		authenticated: t.withIdentity({
			subject: 'debate-read-boundary',
			issuer: 'https://issuer.example',
			tokenIdentifier,
			email
		})
	};
}

describe('debate read and write boundaries', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(NOW);
		vi.stubEnv('INTERNAL_API_SECRET', SECRET);
		vi.stubEnv('INTERNAL_API_SECRET_PREVIOUS', '');
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllEnvs();
	});

	it('secret-gates the canonical write and enforces Tier 3, bounded content, and nullifier dedup', async () => {
		const t = convexTest(schema, modules);
		const seeded = await fixture(t);
		const valid = {
			debateId: seeded.debateId,
			stance: 'SUPPORT' as const,
			body: 'A sufficiently detailed argument body.',
			bodyHash: `0x${'33'.repeat(32)}`,
			nullifierHash: `0x${'44'.repeat(32)}`,
			stakeAmount: 1_000_000
		};

		await expect(
			seeded.authenticated.mutation(api.debates.createArgument, {
				...valid,
				_secret: 'wrong'
			})
		).rejects.toThrow();
		await expect(
			seeded.authenticated.mutation(api.debates.createArgument, {
				...valid,
				_secret: SECRET
			})
		).resolves.toEqual(expect.any(String));
		await expect(
			seeded.authenticated.mutation(api.debates.createArgument, {
				...valid,
				_secret: SECRET
			})
		).rejects.toThrow('already submitted');

		await expect(
			seeded.authenticated.mutation(api.debates.createArgument, {
				...valid,
				_secret: SECRET,
				nullifierHash: `0x${'55'.repeat(32)}`,
				body: 'x'.repeat(8_001)
			})
		).rejects.toThrow('too large');

		await t.run((ctx) => ctx.db.patch(seeded.userId, { trustTier: 2 }));
		await expect(
			seeded.authenticated.mutation(api.debates.createArgument, {
				...valid,
				_secret: SECRET,
				nullifierHash: `0x${'66'.repeat(32)}`
			})
		).rejects.toThrow('Tier 3+');
	});

	it('fails readiness closed, then pages score-ordered arguments through the 50-row ceiling', async () => {
		const t = convexTest(schema, modules);
		const seeded = await fixture(t);
		await expect(
			t.query(api.debates.listArguments, {
				_secret: SECRET,
				debateId: seeded.debateId,
				limit: 100
			})
		).rejects.toThrow('DEBATE_READ_MODEL_NOT_READY');

		await t.run(async (ctx) => {
			await ctx.db.insert('debateReadModelMigrations', {
				key: 'v1',
				status: 'ready',
				scanned: 1,
				projected: 1,
				updatedAt: NOW
			});
			for (let index = 0; index < 60; index += 1) {
				await ctx.db.insert('debateArguments', {
					debateId: seeded.debateId,
					argumentIndex: index,
					stance: index % 2 === 0 ? 'SUPPORT' : 'OPPOSE',
					body: `Bounded argument ${index}`,
					bodyHash: `hash-${index}`,
					stakeAmount: index + 1,
					engagementTier: 3,
					weightedScore: index,
					totalStake: index + 1,
					coSignCount: index,
					positionCount: index,
					verificationStatus: 'verified'
				});
			}
		});

		const first = await t.query(api.debates.listArguments, {
			_secret: SECRET,
			debateId: seeded.debateId,
			limit: 100
		});
		expect(first.arguments).toHaveLength(50);
		expect(first.arguments[0].weightedScore).toBe(59);
		expect(first.hasMore).toBe(true);
		expect(first.cursor).toEqual(expect.any(String));

		const second = await t.query(api.debates.listArguments, {
			_secret: SECRET,
			debateId: seeded.debateId,
			limit: 100,
			cursor: first.cursor
		});
		expect(second.arguments).toHaveLength(10);
		expect(second.hasMore).toBe(false);
		await expect(
			t.query(api.debates.listArguments, {
				_secret: SECRET,
				debateId: seeded.debateId,
				cursor: 'x'.repeat(2_049)
			})
		).rejects.toThrow('DEBATE_CURSOR_INVALID');
	});

	it('selects only the active debate and atomically rejects a second active debate', async () => {
		const t = convexTest(schema, modules);
		const seeded = await fixture(t);
		await t.run((ctx) => ctx.db.patch(seeded.debateId, { status: 'resolved', updatedAt: NOW }));

		await expect(
			t.query(api.debates.getByTemplateId, {
				_secret: SECRET,
				templateId: seeded.templateId
			})
		).resolves.toBeNull();

		const base = {
			_secret: SECRET,
			templateId: seeded.templateId,
			actionDomain: `0x${'77'.repeat(32)}`,
			propositionHash: `0x${'88'.repeat(32)}`,
			propositionText: 'Should concurrent debate creation preserve one active record?',
			deadline: NOW + 48 * 60 * 60 * 1000,
			jurisdictionSize: 100,
			proposerAddress: `0x${'00'.repeat(20)}`,
			proposerBond: 1_000_000
		};
		const attempts = await Promise.allSettled([
			t.mutation(api.debates.insertDebateForCaller, {
				...base,
				debateIdOnchain: 'concurrent-debate-a'
			}),
			t.mutation(api.debates.insertDebateForCaller, {
				...base,
				debateIdOnchain: 'concurrent-debate-b'
			})
		]);
		expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1);
		expect(attempts.filter((attempt) => attempt.status === 'rejected')).toHaveLength(1);

		const active = await t.run((ctx) =>
			ctx.db
				.query('debates')
				.withIndex('by_templateId_status', (q) =>
					q.eq('templateId', seeded.templateId).eq('status', 'active')
				)
				.collect()
		);
		expect(active).toHaveLength(1);
		const selected = await t.query(api.debates.getByTemplateId, {
			_secret: SECRET,
			templateId: seeded.templateId
		});
		expect(selected?._id).toBe(active[0]._id);
		expect(selected?.status).toBe('active');
	});

	it('CAS-guards status transitions and rejects stale or oversized resolution writes', async () => {
		const t = convexTest(schema, modules);
		const seeded = await fixture(t);

		await expect(
			t.mutation(api.debates.updateStatus, {
				_secret: SECRET,
				debateId: seeded.debateId,
				expectedStatus: 'active',
				status: 'resolved',
				winningStance: 'SUPPORT',
				winningArgumentIndex: 0,
				resolutionMethod: 'community_only'
			})
		).resolves.toEqual({ success: true });

		await expect(
			t.mutation(api.debates.updateStatus, {
				_secret: SECRET,
				debateId: seeded.debateId,
				expectedStatus: 'active',
				status: 'awaiting_governance'
			})
		).rejects.toMatchObject({
			data: expect.objectContaining({ code: 'DEBATE_STATUS_CONFLICT' })
		});

		await expect(
			t.mutation(api.debates.updateStatus, {
				_secret: SECRET,
				debateId: seeded.debateId,
				expectedStatus: 'resolved',
				status: 'active'
			})
		).rejects.toMatchObject({
			data: expect.objectContaining({ code: 'DEBATE_STATUS_TRANSITION_INVALID' })
		});

		await expect(
			t.mutation(api.debates.updateStatus, {
				_secret: SECRET,
				debateId: seeded.debateId,
				expectedStatus: 'resolved',
				status: 'under_appeal'
			})
		).resolves.toEqual({ success: true });

		await expect(
			t.mutation(api.debates.updateStatus, {
				_secret: SECRET,
				debateId: seeded.debateId,
				expectedStatus: 'under_appeal',
				status: 'resolved',
				governanceJustification: 'x'.repeat(2_001)
			})
		).rejects.toThrow('DEBATE_GOVERNANCE_JUSTIFICATION_INVALID');

		const debate = await t.run((ctx) => ctx.db.get(seeded.debateId));
		expect(debate?.status).toBe('under_appeal');
	});
});
