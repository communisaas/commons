/// <reference types="vite/client" />

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { convexTest, type TestConvex } from 'convex-test';
import type { TransactionMetrics } from 'convex/server';

import { api, internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import schema from './schema';

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts']);
const SECRET = 'recipient-metrics-secret-with-32-byte-floor';
type Harness = TestConvex<typeof schema>;
type TemplateValue = Omit<Doc<'templates'>, '_id' | '_creationTime'>;

function templateValue(slug: string): TemplateValue {
	return {
		slug,
		title: slug,
		description: 'Recipient metrics fixture',
		topics: [],
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
	};
}

function messageValue(
	templateId: Id<'templates'>,
	index: number,
	districtHash: string,
	deliveryStatus = 'delivered'
) {
	return {
		templateId,
		content: `Message ${index}`,
		verificationProof: `proof-${index}`,
		districtHash,
		reputationScore: 0,
		sentAt: index + 1,
		officeRead: false,
		officeResponded: false,
		deliveryMethod: 'email',
		deliveryStatus
	};
}

async function finishMigration(t: Harness): Promise<void> {
	let result = (await t.mutation(internal.templatePage.migrateRecipientMetrics, {
		scheduleContinuation: false
	})) as { status: string; runToken: string };
	for (let attempt = 0; result.status === 'running' && attempt < 100; attempt += 1) {
		result = (await t.mutation(internal.templatePage.migrateRecipientMetrics, {
			runToken: result.runToken,
			scheduleContinuation: false
		})) as { status: string; runToken: string };
	}
	expect(result.status).toBe('migrated');
	await expect(
		t.mutation(internal.templatePage.activateRecipientMetrics, {})
	).resolves.toMatchObject({ status: 'ready' });
}

function transactionMetrics(ctx: unknown): Promise<TransactionMetrics> {
	return (
		ctx as {
			meta: { getTransactionMetrics: () => Promise<TransactionMetrics> };
		}
	).meta.getTransactionMetrics();
}

beforeEach(() => {
	vi.stubEnv('INTERNAL_API_SECRET', SECRET);
	vi.stubEnv('INTERNAL_API_SECRET_PREVIOUS', '');
});

afterEach(() => vi.unstubAllEnvs());

describe('compact recipient metrics plane', () => {
	it('migrates legacy rows idempotently and preserves the privacy floors', async () => {
		const t = convexTest({ schema, modules });
		const templateId = await t.run((ctx) =>
			ctx.db.insert('templates', templateValue('legacy-recipient-metrics'))
		);
		await t.run(async (ctx) => {
			for (let index = 0; index < 5; index += 1) {
				await ctx.db.insert('messages', messageValue(templateId, index, 'district-a'));
			}
			for (let index = 5; index < 9; index += 1) {
				await ctx.db.insert('messages', messageValue(templateId, index, 'district-b'));
			}
			await ctx.db.insert('messages', messageValue(templateId, 9, 'district-b', 'pending'));

			let registration = 0;
			for (const [districtCode, stance, count] of [
				['US-CA-01', 'support', 5],
				['US-NY-01', 'oppose', 5],
				['US-TX-01', 'support', 1]
			] as const) {
				for (let index = 0; index < count; index += 1) {
					await ctx.db.insert('positionRegistrations', {
						templateId,
						identityCommitment: `legacy-${registration++}`,
						stance,
						districtCode,
						registeredAt: registration
					});
				}
			}
			await ctx.db.insert('positionRegistrations', {
				templateId,
				identityCommitment: `legacy-${registration++}`,
				stance: 'support',
				registeredAt: registration
			});
		});

		await finishMigration(t);

		await expect(
			t.query(api.templatePage.getMessageDistrictCounts, {
				_secret: SECRET,
				templateId,
				viewerDistrictHash: 'district-b'
			})
		).resolves.toEqual({
			districtCounts: { 'district-a': 5 },
			totalDistricts: 1,
			viewerDistrictCount: 0
		});
		const positions = await t.query(api.positions.getMetrics, {
			_secret: SECRET,
			templateId,
			userDistrictCode: 'US-TX-01'
		});
		expect(positions.counts).toEqual({ support: 7, oppose: 5, districts: 3 });
		expect(positions.engagement?.aggregate).toEqual({
			total_districts: 3,
			total_positions: 12,
			total_support: 7,
			total_oppose: 5
		});
		expect(positions.engagement?.districts.map((district) => district.district_code)).toEqual([
			'US-CA-01',
			'US-NY-01'
		]);

		await t.run(async (ctx) => {
			const messages = await ctx.db.query('messages').collect();
			const registrations = await ctx.db.query('positionRegistrations').collect();
			expect(messages.every((row) => row.recipientMetricsVersion === 1)).toBe(true);
			expect(registrations.every((row) => row.recipientMetricsVersion === 1)).toBe(true);
		});
		await expect(
			t.mutation(internal.templatePage.migrateRecipientMetrics, {})
		).resolves.toMatchObject({ status: 'already-ready' });
		await expect(
			t.query(api.positions.getCounts, { _secret: SECRET, templateId })
		).resolves.toEqual({ support: 7, oppose: 5, districts: 3 });
		await expect(
			t.query(api.templatePage.recipientMetricsStatus, { _secret: SECRET })
		).resolves.toMatchObject({
			status: 'ready',
			phase: 'complete',
			scannedMessages: 10,
			projectedMessages: 10,
			scannedPositions: 12,
			projectedPositions: 12
		});
	});

	it('fails position writers closed until the compact plane is ready', async () => {
		const t = convexTest({ schema, modules });
		const templateId = await t.run((ctx) =>
			ctx.db.insert('templates', templateValue('recipient-writer-cutover'))
		);

		await expect(
			t.mutation(api.positions.register, {
				_secret: SECRET,
				templateId,
				identityCommitment: 'pre-cutover-register',
				stance: 'support',
				districtCode: 'US-CA-01'
			})
		).rejects.toThrow('RECIPIENT_METRICS_WRITES_NOT_READY');
		await expect(
			t.mutation(api.positions.confirmMailtoSend, {
				_secret: SECRET,
				templateId,
				identityCommitment: 'pre-cutover-mailto',
				districtCode: 'US-CA-01'
			})
		).rejects.toThrow('RECIPIENT_METRICS_WRITES_NOT_READY');

		await t.run(async (ctx) => {
			expect(await ctx.db.query('positionRegistrations').collect()).toEqual([]);
			expect(await ctx.db.query('templateRecipientMetrics').collect()).toEqual([]);
			expect(await ctx.db.query('templatePositionDistrictMetrics').collect()).toEqual([]);
		});
	});

	it('dual-writes every new position exactly once in the registration transaction', async () => {
		const t = convexTest({ schema, modules });
		await finishMigration(t);
		const templateId = await t.run((ctx) =>
			ctx.db.insert('templates', templateValue('live-recipient-metrics'))
		);

		for (let index = 0; index < 5; index += 1) {
			await t.mutation(api.positions.register, {
				_secret: SECRET,
				templateId,
				identityCommitment: `support-${index}`,
				stance: 'support',
				districtCode: 'US-CA-01'
			});
			await t.mutation(api.positions.register, {
				_secret: SECRET,
				templateId,
				identityCommitment: `oppose-${index}`,
				stance: 'oppose',
				districtCode: 'US-NY-01'
			});
		}
		const first = await t.mutation(api.positions.register, {
			_secret: SECRET,
			templateId,
			identityCommitment: 'support-0',
			stance: 'support',
			districtCode: 'US-CA-01'
		});
		expect(first.isNew).toBe(false);
		await t.mutation(api.positions.confirmMailtoSend, {
			_secret: SECRET,
			templateId,
			identityCommitment: 'mailto-new',
			districtCode: 'US-TX-01'
		});

		await expect(
			t.query(api.positions.getCounts, { _secret: SECRET, templateId })
		).resolves.toEqual({ support: 6, oppose: 5, districts: 3 });
		await t.run(async (ctx) => {
			const registrations = await ctx.db
				.query('positionRegistrations')
				.withIndex('by_templateId', (q) => q.eq('templateId', templateId))
				.collect();
			expect(registrations).toHaveLength(11);
			expect(registrations.every((row) => row.recipientMetricsVersion === 1)).toBe(true);
		});

		await expect(
			t.mutation(api.positions.register, {
				_secret: SECRET,
				templateId,
				identityCommitment: 'invalid-stance',
				stance: 'maybe'
			})
		).rejects.toThrow('POSITION_STANCE_INVALID');
		await expect(
			t.mutation(api.positions.register, {
				_secret: SECRET,
				templateId,
				identityCommitment: 'invalid-district',
				stance: 'support',
				districtCode: ' '
			})
		).rejects.toThrow('POSITION_DISTRICT_CODE_INVALID');
	});

	it('denies direct-origin reads before the first database query', async () => {
		const t = convexTest({ schema, modules });
		const templateId = await t.run(async (ctx) => {
			const id = await ctx.db.insert('templates', templateValue('recipient-auth-boundary'));
			for (const suffix of ['a', 'b']) {
				await ctx.db.insert('recipientMetricsMigrations', {
					key: 'v1',
					status: 'ready',
					runToken: `duplicate-${suffix}`,
					phase: 'complete',
					scannedMessages: 0,
					projectedMessages: 0,
					scannedPositions: 0,
					projectedPositions: 0,
					startedAt: 1,
					completedAt: 2,
					updatedAt: 2
				});
			}
			return id;
		});

		const unauthorized = [
			() =>
				t.query(api.templatePage.getMessageDistrictCounts, {
					_secret: 'anonymous',
					templateId
				}),
			() => t.query(api.templatePage.getTotalStates, { _secret: 'anonymous' }),
			() => t.query(api.templatePage.recipientMetricsStatus, { _secret: 'anonymous' }),
			() => t.query(api.positions.getCounts, { _secret: 'anonymous', templateId }),
			() => t.query(api.positions.getMetrics, { _secret: 'anonymous', templateId }),
			() =>
				t.query(api.positions.getEngagementByDistrict, {
					_secret: 'anonymous',
					templateId
				}),
			() =>
				t.query(api.positions.getFullEngagementByDistrict, {
					_secret: 'anonymous',
					templateId
				})
		];
		for (const call of unauthorized) await expect(call()).rejects.toThrow('Unauthorized');

		await expect(
			t.query(api.templatePage.recipientMetricsStatus, { _secret: SECRET })
		).rejects.toThrow();
		await expect(t.query(api.templatePage.getTotalStates, { _secret: SECRET })).resolves.toEqual({
			count: 50
		});
	});

	it('keeps read cost constant when raw event cardinality grows', async () => {
		const t = convexTest({
			schema,
			modules,
			transactionLimits: {
				bytesRead: 60_000,
				documentsRead: 3,
				databaseQueries: 3
			}
		});
		const templateId = await t.run(async (ctx) => {
			const id = await ctx.db.insert('templates', templateValue('bounded-recipient-read'));
			await ctx.db.insert('recipientMetricsMigrations', {
				key: 'v1',
				status: 'ready',
				runToken: 'bounded-read-generation',
				phase: 'complete',
				scannedMessages: 200,
				projectedMessages: 200,
				scannedPositions: 2_000,
				projectedPositions: 2_000,
				startedAt: 1,
				completedAt: 2,
				updatedAt: 2
			});
			await ctx.db.insert('templateRecipientMetrics', {
				templateId: id,
				version: 1,
				messageDeliveredCount: 200,
				messageVisibleDistrictCount: 40,
				messageTopDistricts: Array.from({ length: 20 }, (_, index) => ({
					districtHash: `message-top-${index}`,
					count: 100 - index
				})),
				positionCount: 2_000,
				positionSupport: 1_100,
				positionOppose: 900,
				positionDistrictCount: 400,
				positionTopDistricts: Array.from({ length: 20 }, (_, index) => ({
					districtCode: `position-top-${index}`,
					support: 50 - index,
					oppose: 20
				})),
				updatedAt: 2
			});
			await ctx.db.insert('templateMessageDistrictMetrics', {
				templateId: id,
				districtHash: 'viewer-message-district',
				deliveredCount: 7,
				updatedAt: 2
			});
			await ctx.db.insert('templatePositionDistrictMetrics', {
				templateId: id,
				districtCode: 'viewer-position-district',
				support: 3,
				oppose: 2,
				updatedAt: 2
			});

			// These growing source rows are deliberately present. A regression back
			// to `.collect()` fails the 3-document transaction budget immediately.
			for (let index = 0; index < 2_000; index += 1) {
				await ctx.db.insert('positionRegistrations', {
					templateId: id,
					identityCommitment: `raw-position-${index}`,
					stance: index % 2 === 0 ? 'support' : 'oppose',
					districtCode: `raw-${index % 400}`,
					registeredAt: index
				});
			}
			for (let index = 0; index < 200; index += 1) {
				await ctx.db.insert('messages', messageValue(id, index, `raw-message-${index % 40}`));
			}
			return id;
		});

		const positions = await t.query(async (ctx) => {
			const value = await ctx.runQuery(api.positions.getMetrics, {
				_secret: SECRET,
				templateId,
				userDistrictCode: 'viewer-position-district'
			});
			return { value, metrics: await transactionMetrics(ctx) };
		});
		expect(positions.value.counts).toEqual({ support: 1_100, oppose: 900, districts: 400 });
		expect(positions.value.engagement?.districts).toHaveLength(21);
		expect(positions.metrics.documentsRead.used).toBe(3);
		expect(positions.metrics.databaseQueries.used).toBe(3);
		expect(positions.metrics.bytesRead.used).toBeLessThan(60_000);

		const messages = await t.query(async (ctx) => {
			const value = await ctx.runQuery(api.templatePage.getMessageDistrictCounts, {
				_secret: SECRET,
				templateId,
				viewerDistrictHash: 'viewer-message-district'
			});
			return { value, metrics: await transactionMetrics(ctx) };
		});
		expect(messages.value).toMatchObject({ totalDistricts: 40, viewerDistrictCount: 7 });
		expect(Object.keys(messages.value.districtCounts)).toHaveLength(21);
		expect(messages.metrics.documentsRead.used).toBe(3);
		expect(messages.metrics.databaseQueries.used).toBe(3);
		expect(messages.metrics.bytesRead.used).toBeLessThan(60_000);
	});
});
