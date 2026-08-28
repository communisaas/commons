/// <reference types="vite/client" />

import { describe, expect, it } from 'vitest';
import { convexTest, type TestConvex } from 'convex-test';

import { api } from './_generated/api';
import type { Doc } from './_generated/dataModel';
import schema from './schema';

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts']);
type Harness = TestConvex<typeof schema>;

function userValue(index: number): Omit<Doc<'users'>, '_id' | '_creationTime'> {
	return {
		email: `message-job-${index}@example.org`,
		name: `Message Job User ${index}`,
		tokenIdentifier: `https://commons.email|message-job-${index}`,
		updatedAt: index + 1,
		isVerified: true,
		authorityLevel: 1,
		trustTier: 1,
		trustScore: 100,
		reputationTier: 'novice',
		districtVerified: false,
		templatesContributed: 0,
		templateAdoptionRate: 0,
		peerEndorsements: 0,
		activeMonths: 0,
		profileVisibility: 'private'
	};
}

async function authenticatedUser(t: Harness, index: number) {
	const value = userValue(index);
	const userId = await t.run((ctx) => ctx.db.insert('users', value));
	return {
		userId,
		client: t.withIdentity({
			subject: `message-job-${index}`,
			issuer: 'https://commons.email',
			tokenIdentifier: value.tokenIdentifier!
		})
	};
}

function startArgs(jobId: string) {
	return {
		jobId,
		inputHash: 'a'.repeat(64),
		recoveryPublicKeyJwk: { kty: 'RSA', n: 'modulus', e: 'AQAB' },
		expiresAt: Date.now() + 60_000
	};
}

describe('message job admission gate', () => {
	it('atomically creates one owner-bound job when duplicate starts race', async () => {
		const t = convexTest(schema, modules);
		const owner = await authenticatedUser(t, 1);
		const args = startArgs('concurrent-message-job');

		const starts = await Promise.all([
			owner.client.mutation(api.messageJobs.startOrGet, args),
			owner.client.mutation(api.messageJobs.startOrGet, args)
		]);

		expect(starts.map((start) => start.created).sort()).toEqual([false, true]);
		expect(new Set(starts.map((start) => start.job.jobId))).toEqual(
			new Set(['concurrent-message-job'])
		);
		await expect(
			t.run((ctx) => ctx.db.query('messageGenerationJobs').collect())
		).resolves.toHaveLength(1);
	});

	it("does not reveal or replay another user's existing job", async () => {
		const t = convexTest(schema, modules);
		const owner = await authenticatedUser(t, 1);
		const stranger = await authenticatedUser(t, 2);
		const args = startArgs('owner-only-message-job');

		await expect(owner.client.mutation(api.messageJobs.startOrGet, args)).resolves.toMatchObject({
			created: true,
			job: { jobId: args.jobId, inputHash: args.inputHash }
		});
		await expect(stranger.client.mutation(api.messageJobs.startOrGet, args)).rejects.toThrow(
			'Message generation job not found'
		);
	});
});
