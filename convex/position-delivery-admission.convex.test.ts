/// <reference types="vite/client" />

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { convexTest, type TestConvex } from 'convex-test';

import { api } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import schema from './schema';

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts']);
const SECRET = 'position-delivery-test-secret-32-bytes';
type Harness = TestConvex<typeof schema>;
type TemplateValue = Omit<Doc<'templates'>, '_id' | '_creationTime'>;

function templateValue(slug: string): TemplateValue {
	return {
		slug,
		title: slug,
		description: 'Position delivery admission fixture',
		topics: [],
		type: 'email',
		deliveryMethod: 'email' as const,
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
	};
}

async function registration(
	t: Harness,
	identityCommitment = 'identity-commitment-1'
): Promise<Id<'positionRegistrations'>> {
	return t.run(async (ctx) => {
		const templateId = await ctx.db.insert('templates', templateValue(crypto.randomUUID()));
		return ctx.db.insert('positionRegistrations', {
			templateId,
			identityCommitment,
			stance: 'support',
			registeredAt: Date.now(),
			recipientMetricsVersion: 1
		});
	});
}

async function enableRecipientMetricsWrites(t: Harness): Promise<void> {
	await t.run((ctx) =>
		ctx.db.insert('recipientMetricsMigrations', {
			key: 'v1',
			status: 'ready',
			runToken: 'position-delivery-admission-test',
			phase: 'complete',
			scannedMessages: 0,
			projectedMessages: 0,
			scannedPositions: 0,
			projectedPositions: 0,
			startedAt: Date.now(),
			completedAt: Date.now(),
			updatedAt: Date.now()
		})
	);
}

async function registrationTemplateId(
	t: Harness,
	registrationId: Id<'positionRegistrations'>
): Promise<Id<'templates'>> {
	return t.run(async (ctx) => {
		const row = await ctx.db.get(registrationId);
		if (!row) throw new Error('test registration missing');
		return row.templateId;
	});
}

function args(
	registrationId: Id<'positionRegistrations'>,
	recipients: Array<{
		name: string;
		email?: string;
		deliveryMethod: string;
		encryptedRecipientEmail?: string;
		recipientEmailHash?: string;
		encryptedRecipientName?: string;
	}>,
	identityCommitment = 'identity-commitment-1'
) {
	return { _secret: SECRET, registrationId, identityCommitment, recipients };
}

beforeEach(() => {
	vi.stubEnv('INTERNAL_API_SECRET', SECRET);
	vi.stubEnv('INTERNAL_API_SECRET_PREVIOUS', '');
	vi.useFakeTimers();
	vi.setSystemTime(new Date('2026-07-21T00:00:30.000Z'));
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllEnvs();
});

describe('position registration delivery admission', () => {
	it('canonicalizes request duplicates and remains durably idempotent across retries', async () => {
		const t = convexTest({ schema, modules });
		const registrationId = await registration(t);
		const recipients = [
			{
				name: '  Rep. Jos\u00e9   Smith ',
				email: ' REP@EXAMPLE.COM ',
				deliveryMethod: 'email' as const
			},
			{
				name: 'rep jose smith',
				email: 'rep@example.com',
				deliveryMethod: 'email' as const
			}
		];

		await expect(
			t.mutation(api.positions.batchRegisterDeliveries, args(registrationId, recipients))
		).resolves.toEqual({ created: 1, duplicates: 1, existing: 0 });
		await expect(
			t.mutation(api.positions.batchRegisterDeliveries, args(registrationId, recipients))
		).resolves.toEqual({ created: 0, duplicates: 1, existing: 1 });

		await t.run(async (ctx) => {
			const rows = await ctx.db
				.query('positionDeliveries')
				.withIndex('by_registrationId', (q) => q.eq('registrationId', registrationId))
				.collect();
			expect(rows).toHaveLength(1);
			expect(rows[0]).toMatchObject({
				recipientName: 'Rep. Jos\u00e9 Smith',
				recipientKey: 'rep-jose-smith',
				deliveryMethod: 'email' as const
			});
			await expect(
				ctx.db
					.query('positionDeliveries')
					.withIndex('by_registrationId_recipientKey', (q) =>
						q.eq('registrationId', registrationId).eq('recipientKey', 'rep-jose-smith')
					)
					.unique()
			).resolves.toMatchObject({ recipientName: 'Rep. Jos\u00e9 Smith' });
		});
	});

	it('serializes concurrent retries to one durable recipient row', async () => {
		const t = convexTest({ schema, modules });
		const registrationId = await registration(t);
		const mutationArgs = args(registrationId, [
			{ name: 'Representative Smith', deliveryMethod: 'recorded' }
		]);

		const results = await Promise.all([
			t.mutation(api.positions.batchRegisterDeliveries, mutationArgs),
			t.mutation(api.positions.batchRegisterDeliveries, mutationArgs)
		]);
		expect(results.map((result) => result.created).sort()).toEqual([0, 1]);
		await t.run(async (ctx) => {
			const rows = await ctx.db
				.query('positionDeliveries')
				.withIndex('by_registrationId', (q) => q.eq('registrationId', registrationId))
				.collect();
			expect(rows).toHaveLength(1);
		});
	});

	it('serializes concurrent mailto replays through the same durable append boundary', async () => {
		const t = convexTest({ schema, modules });
		await enableRecipientMetricsWrites(t);
		const registrationId = await registration(t);
		const templateId = await registrationTemplateId(t, registrationId);
		const mutationArgs = {
			_secret: SECRET,
			templateId,
			identityCommitment: 'identity-commitment-1'
		};

		const results = await Promise.all([
			t.mutation(api.positions.confirmMailtoSend, mutationArgs),
			t.mutation(api.positions.confirmMailtoSend, mutationArgs)
		]);
		expect(results.map((result) => result.created).sort()).toEqual([0, 1]);
		expect(results.map((result) => result.existing).sort()).toEqual([0, 1]);
		await t.run(async (ctx) => {
			const rows = await ctx.db
				.query('positionDeliveries')
				.withIndex('by_registrationId', (q) => q.eq('registrationId', registrationId))
				.collect();
			expect(rows).toHaveLength(1);
			expect(rows[0]).toMatchObject({
				recipientName: 'Commons mailto confirmation',
				recipientKey: 'system:mailto-confirmation:v1',
				deliveryMethod: 'mailto_confirmed'
			});
			const buckets = await ctx.db.query('rateLimits').collect();
			expect(buckets).toHaveLength(1);
			expect(buckets[0]?.count).toBe(2);
		});
	});

	it('serializes concurrent first confirmations to one registration, metric, and delivery', async () => {
		const t = convexTest({ schema, modules });
		await enableRecipientMetricsWrites(t);
		const templateId = await t.run((ctx) =>
			ctx.db.insert('templates', templateValue('concurrent-first-mailto'))
		);
		const mutationArgs = {
			_secret: SECRET,
			templateId,
			identityCommitment: 'first-confirmation-identity',
			districtCode: 'US-CA-01'
		};

		const results = await Promise.all([
			t.mutation(api.positions.confirmMailtoSend, mutationArgs),
			t.mutation(api.positions.confirmMailtoSend, mutationArgs)
		]);
		expect(results.map((result) => result.isNewPosition).sort()).toEqual([false, true]);
		expect(results.map((result) => result.created).sort()).toEqual([0, 1]);
		await t.run(async (ctx) => {
			const registrations = await ctx.db
				.query('positionRegistrations')
				.withIndex('by_templateId_identityCommitment', (q) =>
					q.eq('templateId', templateId).eq('identityCommitment', 'first-confirmation-identity')
				)
				.collect();
			expect(registrations).toHaveLength(1);
			const deliveries = await ctx.db
				.query('positionDeliveries')
				.withIndex('by_registrationId', (q) => q.eq('registrationId', registrations[0]!._id))
				.collect();
			expect(deliveries).toHaveLength(1);
			const metric = await ctx.db
				.query('templateRecipientMetrics')
				.withIndex('by_templateId', (q) => q.eq('templateId', templateId))
				.unique();
			expect(metric?.positionCount).toBe(1);
		});
	});

	it('serializes cross-writer concurrency while keeping a same-named human recipient distinct', async () => {
		const t = convexTest({ schema, modules });
		await enableRecipientMetricsWrites(t);
		const registrationId = await registration(t);
		const templateId = await registrationTemplateId(t, registrationId);

		const [batch, mailto] = await Promise.all([
			t.mutation(
				api.positions.batchRegisterDeliveries,
				args(registrationId, [{ name: 'Commons mailto confirmation', deliveryMethod: 'recorded' }])
			),
			t.mutation(api.positions.confirmMailtoSend, {
				_secret: SECRET,
				templateId,
				identityCommitment: 'identity-commitment-1'
			})
		]);
		expect(batch).toMatchObject({ created: 1, existing: 0 });
		expect(mailto).toMatchObject({ created: 1, existing: 0 });

		await t.run(async (ctx) => {
			const rows = await ctx.db
				.query('positionDeliveries')
				.withIndex('by_registrationId', (q) => q.eq('registrationId', registrationId))
				.collect();
			expect(rows.map((row) => row.recipientKey).sort()).toEqual([
				'commons-mailto-confirmation',
				'system:mailto-confirmation:v1'
			]);
		});
	});

	it('enforces the lifetime ceiling across batch and mailto writers while allowing replay', async () => {
		const t = convexTest({ schema, modules });
		await enableRecipientMetricsWrites(t);
		const registrationId = await registration(t);
		const templateId = await registrationTemplateId(t, registrationId);
		const confirmArgs = {
			_secret: SECRET,
			templateId,
			identityCommitment: 'identity-commitment-1'
		};

		await expect(
			t.mutation(
				api.positions.batchRegisterDeliveries,
				args(
					registrationId,
					Array.from({ length: 19 }, (_, index) => ({
						name: `Recipient ${index}`,
						deliveryMethod: 'recorded'
					}))
				)
			)
		).resolves.toMatchObject({ created: 19 });
		await expect(t.mutation(api.positions.confirmMailtoSend, confirmArgs)).resolves.toMatchObject({
			created: 1,
			existing: 0
		});
		await expect(
			t.mutation(
				api.positions.batchRegisterDeliveries,
				args(registrationId, [{ name: 'Recipient 20', deliveryMethod: 'recorded' }])
			)
		).rejects.toThrow('POSITION_DELIVERY_REGISTRATION_CAP_EXCEEDED');
		await expect(t.mutation(api.positions.confirmMailtoSend, confirmArgs)).resolves.toMatchObject({
			created: 0,
			existing: 1
		});

		await t.run(async (ctx) => {
			const rows = await ctx.db
				.query('positionDeliveries')
				.withIndex('by_registrationId', (q) => q.eq('registrationId', registrationId))
				.collect();
			expect(rows).toHaveLength(20);
		});
	});

	it('maps one legacy mailto row to the reserved identity without appending a replacement', async () => {
		const t = convexTest({ schema, modules });
		await enableRecipientMetricsWrites(t);
		const registrationId = await registration(t);
		const templateId = await registrationTemplateId(t, registrationId);
		await t.run((ctx) =>
			ctx.db.insert('positionDeliveries', {
				registrationId,
				recipientName: 'Legacy template title',
				deliveryMethod: 'mailto_confirmed',
				deliveryStatus: 'user_confirmed',
				deliveredAt: Date.now()
			})
		);

		await expect(
			t.mutation(api.positions.confirmMailtoSend, {
				_secret: SECRET,
				templateId,
				identityCommitment: 'identity-commitment-1'
			})
		).resolves.toMatchObject({ created: 0, existing: 1 });
		await t.run(async (ctx) => {
			const rows = await ctx.db
				.query('positionDeliveries')
				.withIndex('by_registrationId', (q) => q.eq('registrationId', registrationId))
				.collect();
			expect(rows).toHaveLength(1);
			expect(rows[0]?.recipientName).toBe('Legacy template title');
		});
	});

	it('enforces a durable 20-recipient lifetime ceiling per registration', async () => {
		const t = convexTest({ schema, modules });
		const registrationId = await registration(t);
		const firstTwenty = Array.from({ length: 20 }, (_, index) => ({
			name: `Recipient ${index}`,
			deliveryMethod: 'recorded'
		}));

		await expect(
			t.mutation(api.positions.batchRegisterDeliveries, args(registrationId, firstTwenty))
		).resolves.toMatchObject({ created: 20 });
		await expect(
			t.mutation(
				api.positions.batchRegisterDeliveries,
				args(registrationId, [{ name: 'Recipient 21', deliveryMethod: 'recorded' }])
			)
		).rejects.toThrow('POSITION_DELIVERY_REGISTRATION_CAP_EXCEEDED');

		await t.run(async (ctx) => {
			const rows = await ctx.db
				.query('positionDeliveries')
				.withIndex('by_registrationId', (q) => q.eq('registrationId', registrationId))
				.collect();
			expect(rows).toHaveLength(20);
		});
	});

	it('admits at most five requests per identity and minute in Convex', async () => {
		const t = convexTest({ schema, modules });
		const registrationId = await registration(t);
		const mutationArgs = args(registrationId, [
			{ name: 'Representative Smith', deliveryMethod: 'recorded' }
		]);

		for (let attempt = 0; attempt < 5; attempt += 1) {
			await expect(
				t.mutation(api.positions.batchRegisterDeliveries, mutationArgs)
			).resolves.toMatchObject({ created: attempt === 0 ? 1 : 0 });
		}
		await expect(t.mutation(api.positions.batchRegisterDeliveries, mutationArgs)).rejects.toThrow(
			'POSITION_DELIVERY_RATE_LIMITED'
		);

		await t.run(async (ctx) => {
			const buckets = await ctx.db.query('rateLimits').collect();
			expect(buckets).toHaveLength(1);
			expect(buckets[0]).toMatchObject({ count: 5 });
		});
	});

	it('rejects cardinality, aggregate bytes, field shapes, and ownership before writes', async () => {
		const t = convexTest({ schema, modules });
		const registrationId = await registration(t);

		await expect(
			t.mutation(
				api.positions.batchRegisterDeliveries,
				args(
					registrationId,
					Array.from({ length: 21 }, (_, index) => ({
						name: `Recipient ${index}`,
						deliveryMethod: 'recorded'
					}))
				)
			)
		).rejects.toThrow('POSITION_DELIVERY_RECIPIENT_LIMIT_EXCEEDED');

		const envelope = 'x'.repeat(2_048);
		await expect(
			t.mutation(
				api.positions.batchRegisterDeliveries,
				args(
					registrationId,
					Array.from({ length: 20 }, (_, index) => ({
						name: `Recipient ${index}`,
						deliveryMethod: 'email' as const,
						encryptedRecipientEmail: envelope,
						encryptedRecipientName: envelope
					}))
				)
			)
		).rejects.toThrow('POSITION_DELIVERY_INPUT_TOO_LARGE');

		await expect(
			t.mutation(
				api.positions.batchRegisterDeliveries,
				args(registrationId, [
					{ name: 'Recipient', email: 'not-an-email', deliveryMethod: 'email' as const }
				])
			)
		).rejects.toThrow('POSITION_DELIVERY_RECIPIENT_EMAIL_INVALID');
		await expect(
			t.mutation(
				api.positions.batchRegisterDeliveries,
				args(registrationId, [{ name: 'Recipient', deliveryMethod: 'recorded' }], 'someone-else')
			)
		).rejects.toThrow('Registration not found');

		await t.run(async (ctx) => {
			expect(await ctx.db.query('positionDeliveries').collect()).toEqual([]);
			expect(await ctx.db.query('rateLimits').collect()).toEqual([]);
		});
	});

	it('applies the 64 KiB ceiling to the complete Convex argument envelope', async () => {
		const t = convexTest({ schema, modules });
		const identityCommitment = 'i'.repeat(512);
		const registrationId = await registration(t, identityCommitment);
		const emptyEnvelopeRecipients = Array.from({ length: 20 }, (_, index) => ({
			name: `Recipient ${index}`,
			deliveryMethod: 'email' as const,
			encryptedRecipientEmail: '',
			encryptedRecipientName: ''
		}));
		const baseBytes = new TextEncoder().encode(JSON.stringify(emptyEnvelopeRecipients)).byteLength;
		const envelopeLength = Math.floor((64 * 1024 - baseBytes) / 40);
		const envelope = 'x'.repeat(envelopeLength);
		const recipients = emptyEnvelopeRecipients.map((recipient) => ({
			...recipient,
			encryptedRecipientEmail: envelope,
			encryptedRecipientName: envelope
		}));
		const mutationArgs = args(registrationId, recipients, identityCommitment);

		expect(new TextEncoder().encode(JSON.stringify(recipients)).byteLength).toBeLessThanOrEqual(
			64 * 1024
		);
		expect(new TextEncoder().encode(JSON.stringify(mutationArgs)).byteLength).toBeGreaterThan(
			64 * 1024
		);
		await expect(t.mutation(api.positions.batchRegisterDeliveries, mutationArgs)).rejects.toThrow(
			'POSITION_DELIVERY_INPUT_TOO_LARGE'
		);

		await t.run(async (ctx) => {
			expect(await ctx.db.query('positionDeliveries').collect()).toEqual([]);
			expect(await ctx.db.query('rateLimits').collect()).toEqual([]);
		});
	});
});
