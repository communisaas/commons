/// <reference types="vite/client" />

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { convexTest, type TestConvex } from 'convex-test';

import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema from './schema';

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts']);
const SECRET = 'position-input-budget-secret-32b';

type Harness = TestConvex<typeof schema>;

type DeliveryRecipient = {
	name: string;
	email?: string;
	deliveryMethod: string;
	encryptedRecipientEmail?: string;
	recipientEmailHash?: string;
	encryptedRecipientName?: string;
};

function newHarness(): Harness {
	return convexTest(schema, modules);
}

async function createUser(t: Harness): Promise<Id<'users'>> {
	return await t.run((ctx) =>
		ctx.db.insert('users', {
			tokenIdentifier: 'https://issuer.example|position-input-budget-user',
			updatedAt: Date.now(),
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
		})
	);
}

async function createTemplate(t: Harness): Promise<Id<'templates'>> {
	const userId = await createUser(t);
	return await t.run((ctx) =>
		ctx.db.insert('templates', {
			userId,
			slug: 'position-input-budget-template',
			title: 'Position input budget template',
			description: 'Template used by position input budget tests.',
			topics: ['positions'],
			type: 'email',
			deliveryMethod: 'email',
			preview: 'Preview',
			messageBody: 'Body',
			deliveryConfig: {},
			recipientConfig: {},
			status: 'published',
			isPublic: true,
			verifiedSends: 0,
			uniqueDistricts: 0,
			embeddingVersion: 'test',
			flaggedByModeration: false,
			consensusApproved: true,
			reputationDelta: 0,
			reputationApplied: false,
			updatedAt: 1
		})
	);
}

function recipient(overrides: Partial<DeliveryRecipient> = {}): DeliveryRecipient {
	return {
		name: 'Alice Example',
		email: 'alice@example.org',
		deliveryMethod: 'email',
		...overrides
	};
}

describe('positions input budgets', () => {
	beforeEach(() => {
		vi.stubEnv('INTERNAL_API_SECRET', SECRET);
		vi.stubEnv('INTERNAL_API_SECRET_PREVIOUS', '');
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it('bounds registration identity and stance inputs', async () => {
		const t = newHarness();
		const templateId = await createTemplate(t);

		await expect(
			t.mutation(api.positions.register, {
				_secret: SECRET,
				templateId,
				identityCommitment: 'x'.repeat(513),
				stance: 'support'
			})
		).rejects.toThrow(/POSITION_IDENTITY_INVALID/);
		await expect(
			t.mutation(api.positions.register, {
				_secret: SECRET,
				templateId,
				identityCommitment: 'c'.repeat(64),
				stance: 'x'.repeat(33)
			})
		).rejects.toThrow(/POSITION_STANCE_INVALID/);
		await expect(
			t.mutation(api.positions.register, {
				_secret: SECRET,
				templateId,
				identityCommitment: 'c'.repeat(64),
				stance: 'support'
			})
		).resolves.toMatchObject({ isNew: true });
	});

	it('bounds confirmMailtoSend template titles', async () => {
		const t = newHarness();
		const templateId = await createTemplate(t);

		await expect(
			t.mutation(api.positions.confirmMailtoSend, {
				_secret: SECRET,
				templateId,
				identityCommitment: 'd'.repeat(64),
				templateTitle: 'x'.repeat(201)
			})
		).rejects.toThrow(/POSITION_TEMPLATE_TITLE_INVALID/);
	});

	it('bounds batch delivery recipients and accepts bounded batches', async () => {
		const t = newHarness();
		const templateId = await createTemplate(t);
		const registration = await t.mutation(api.positions.register, {
			_secret: SECRET,
			templateId,
			identityCommitment: 'e'.repeat(64),
			stance: 'support'
		});
		const registrationId = registration._id;

		await expect(
			t.mutation(api.positions.batchRegisterDeliveries, {
				_secret: SECRET,
				registrationId,
				identityCommitment: 'e'.repeat(64),
				recipients: Array.from({ length: 21 }, (_, i) => recipient({ name: `Person ${i}` }))
			})
		).rejects.toThrow(/POSITION_DELIVERY_RECIPIENT_LIMIT_EXCEEDED/);
		await expect(
			t.mutation(api.positions.batchRegisterDeliveries, {
				_secret: SECRET,
				registrationId,
				identityCommitment: 'e'.repeat(64),
				recipients: [recipient({ name: 'x'.repeat(201) })]
			})
		).rejects.toThrow(/POSITION_DELIVERY_RECIPIENT_NAME_INVALID/);
		await expect(
			t.mutation(api.positions.batchRegisterDeliveries, {
				_secret: SECRET,
				registrationId,
				identityCommitment: 'e'.repeat(64),
				recipients: [recipient({ encryptedRecipientEmail: 'x'.repeat(2_049) })]
			})
		).rejects.toThrow(/POSITION_DELIVERY_ENVELOPE_TOO_LARGE/);
		await expect(
			t.mutation(api.positions.batchRegisterDeliveries, {
				_secret: SECRET,
				registrationId,
				identityCommitment: 'e'.repeat(64),
				recipients: Array.from({ length: 20 }, (_, i) =>
					recipient({
						name: `Aggregate ${i}`,
						encryptedRecipientEmail: 'a'.repeat(2_048),
						encryptedRecipientName: 'b'.repeat(2_048),
						recipientEmailHash: 'c'.repeat(2_048)
					})
				)
			})
		).rejects.toThrow(/POSITION_DELIVERY_INPUT_TOO_LARGE/);

		await expect(
			t.mutation(api.positions.batchRegisterDeliveries, {
				_secret: SECRET,
				registrationId,
				identityCommitment: 'e'.repeat(64),
				recipients: [
					recipient({ name: 'Alice Example', encryptedRecipientEmail: 'cipher-a' }),
					recipient({ name: 'Bob Example', encryptedRecipientEmail: 'cipher-b' })
				]
			})
		).resolves.toEqual({ created: 2 });
		await t.run(async (ctx) => {
			const rows = await ctx.db
				.query('positionDeliveries')
				.withIndex('by_registrationId', (q) => q.eq('registrationId', registrationId))
				.collect();
			expect(rows).toHaveLength(2);
		});
	});

	it('keeps direct delivery recording fail-closed', async () => {
		const t = newHarness();
		const templateId = await createTemplate(t);

		await expect(
			t.mutation(api.positions.recordDirectDeliveries, {
				_secret: SECRET,
				pseudonymousId: 'pseudonymous-position-budget-user',
				templateId,
				recipients: [recipient()]
			})
		).rejects.toThrow(/DIRECT_DELIVERY_RECORDING_DISABLED/);
	});
});
