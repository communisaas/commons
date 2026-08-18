/// <reference types="vite/client" />

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { convexTest, type TestConvex } from 'convex-test';

import { api } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import schema from './schema';

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts']);
const SECRET = 'direct-delivery-secret-with-32-byte-floor';
const PSEUDONYMOUS_ID = 'a'.repeat(64);
type Harness = TestConvex<typeof schema>;
type TemplateValue = Omit<Doc<'templates'>, '_id' | '_creationTime'>;

function templateValue(slug: string, overrides: Partial<TemplateValue> = {}): TemplateValue {
	return {
		slug,
		title: slug,
		description: 'Direct delivery admission fixture',
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
		updatedAt: 1,
		...overrides
	};
}

async function template(
	t: Harness,
	slug: string = crypto.randomUUID(),
	overrides: Partial<TemplateValue> = {}
): Promise<Id<'templates'>> {
	return t.run((ctx) => ctx.db.insert('templates', templateValue(slug, overrides)));
}

function args(
	templateId: Id<'templates'>,
	recipients: Array<{ name: string; deliveryMethod: string }>,
	pseudonymousId = PSEUDONYMOUS_ID,
	secret = SECRET
) {
	return { _secret: secret, pseudonymousId, templateId, recipients };
}

async function directRows(
	t: Harness,
	templateId: Id<'templates'>,
	pseudonymousId = PSEUDONYMOUS_ID
) {
	return t.run((ctx) =>
		ctx.db
			.query('positionDeliveries')
			.withIndex('by_templateId_pseudonymousId', (q) =>
				q.eq('templateId', templateId).eq('pseudonymousId', pseudonymousId)
			)
			.collect()
	);
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

describe('direct delivery durable admission and lifetime history', () => {
	it('canonicalizes aliases and remains idempotent across replay', async () => {
		const t = convexTest({ schema, modules });
		const templateId = await template(t, 'direct-canonical');
		const recipients = [
			{ name: '  Rep. Jos\u00e9   Smith ', deliveryMethod: 'email' as const },
			{ name: 'rep jose smith', deliveryMethod: 'email' as const }
		];

		await expect(
			t.mutation(api.positions.recordDirectDeliveries, args(templateId, recipients))
		).resolves.toEqual({ created: 1, existing: 0, duplicates: 1 });
		await expect(
			t.mutation(api.positions.recordDirectDeliveries, args(templateId, recipients))
		).resolves.toEqual({ created: 0, existing: 1, duplicates: 1 });

		const rows = await directRows(t, templateId);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			pseudonymousId: PSEUDONYMOUS_ID,
			recipientName: 'Rep. Jos\u00e9 Smith',
			recipientKey: 'rep-jose-smith',
			deliveryMethod: 'email' as const
		});
		expect(rows[0]).not.toHaveProperty('recipientEmail');
	});

	it('serializes concurrent replays to exactly one row', async () => {
		const t = convexTest({ schema, modules });
		const templateId = await template(t, 'direct-concurrent-replay');
		const mutationArgs = args(templateId, [
			{ name: 'Representative Smith', deliveryMethod: 'recorded' }
		]);

		const results = await Promise.all([
			t.mutation(api.positions.recordDirectDeliveries, mutationArgs),
			t.mutation(api.positions.recordDirectDeliveries, mutationArgs)
		]);
		expect(results.map((result) => result.created).sort()).toEqual([0, 1]);
		expect(await directRows(t, templateId)).toHaveLength(1);
		await t.run(async (ctx) => {
			const buckets = await ctx.db.query('rateLimits').collect();
			expect(buckets).toHaveLength(1);
			expect(buckets[0]?.count).toBe(2);
			expect(buckets[0]?.key).toMatch(/^positions\.directDeliveries:v1:[0-9a-f]{64}$/u);
			expect(buckets[0]?.key).not.toContain(PSEUDONYMOUS_ID);
		});
	});

	it('serializes competing batches so lifetime cardinality can never exceed 20', async () => {
		const t = convexTest({ schema, modules });
		const templateId = await template(t, 'direct-concurrent-cap');
		const first = Array.from({ length: 11 }, (_, index) => ({
			name: `First recipient ${index}`,
			deliveryMethod: 'recorded'
		}));
		const second = Array.from({ length: 11 }, (_, index) => ({
			name: `Second recipient ${index}`,
			deliveryMethod: 'recorded'
		}));

		const results = await Promise.allSettled([
			t.mutation(api.positions.recordDirectDeliveries, args(templateId, first)),
			t.mutation(api.positions.recordDirectDeliveries, args(templateId, second))
		]);
		expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
		expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
		expect(
			String(
				(results.find((result) => result.status === 'rejected') as PromiseRejectedResult).reason
			)
		).toContain('DIRECT_DELIVERY_LIFETIME_CAP_EXCEEDED');
		expect(await directRows(t, templateId)).toHaveLength(11);
	});

	it('preserves a legitimate 20-recipient workflow and rejects every 21st identity', async () => {
		const t = convexTest({ schema, modules });
		const templateId = await template(t, 'direct-lifetime-cap');
		const recipients = Array.from({ length: 20 }, (_, index) => ({
			name: `Recipient ${index}`,
			deliveryMethod: 'email' as const
		}));

		await expect(
			t.mutation(api.positions.recordDirectDeliveries, args(templateId, recipients))
		).resolves.toEqual({ created: 20, existing: 0, duplicates: 0 });
		await expect(
			t.mutation(
				api.positions.recordDirectDeliveries,
				args(templateId, [{ name: ' recipient 0 ', deliveryMethod: 'email' as const }])
			)
		).resolves.toEqual({ created: 0, existing: 1, duplicates: 0 });
		await expect(
			t.mutation(
				api.positions.recordDirectDeliveries,
				args(templateId, [{ name: 'Twenty first recipient', deliveryMethod: 'email' as const }])
			)
		).rejects.toThrow('DIRECT_DELIVERY_LIFETIME_CAP_EXCEEDED');
		expect(await directRows(t, templateId)).toHaveLength(20);
	});

	it('adopts legacy recipient-key aliases without minting a second row', async () => {
		const t = convexTest({ schema, modules });
		const templateId = await template(t, 'direct-legacy-alias');
		await t.run((ctx) =>
			ctx.db.insert('positionDeliveries', {
				pseudonymousId: PSEUDONYMOUS_ID,
				templateId,
				recipientName: 'Rep. Jos\u00e9 Smith',
				recipientKey: 'rep-jos-smith',
				deliveryMethod: 'email' as const,
				deliveryStatus: 'pending'
			})
		);

		await expect(
			t.mutation(
				api.positions.recordDirectDeliveries,
				args(templateId, [{ name: 'rep jose smith', deliveryMethod: 'email' as const }])
			)
		).resolves.toEqual({ created: 0, existing: 1, duplicates: 0 });
		expect(await directRows(t, templateId)).toHaveLength(1);
	});

	it('enforces one durable five-per-minute budget for each actor-template pair', async () => {
		const t = convexTest({ schema, modules });
		const templateId = await template(t, 'direct-durable-rate');
		const mutationArgs = args(templateId, [{ name: 'Recipient', deliveryMethod: 'recorded' }]);

		for (let attempt = 0; attempt < 5; attempt += 1) {
			await expect(
				t.mutation(api.positions.recordDirectDeliveries, mutationArgs)
			).resolves.toMatchObject({ created: attempt === 0 ? 1 : 0 });
		}
		await expect(t.mutation(api.positions.recordDirectDeliveries, mutationArgs)).rejects.toThrow(
			'DIRECT_DELIVERY_RATE_LIMITED'
		);
		expect(await directRows(t, templateId)).toHaveLength(1);
	});

	it('isolates lifetime and admission budgets across templates', async () => {
		const t = convexTest({ schema, modules });
		const firstTemplateId = await template(t, 'direct-first-template');
		const secondTemplateId = await template(t, 'direct-second-template');
		const recipients = Array.from({ length: 20 }, (_, index) => ({
			name: `Recipient ${index}`,
			deliveryMethod: 'recorded'
		}));

		await expect(
			t.mutation(api.positions.recordDirectDeliveries, args(firstTemplateId, recipients))
		).resolves.toMatchObject({ created: 20 });
		await expect(
			t.mutation(api.positions.recordDirectDeliveries, args(secondTemplateId, recipients))
		).resolves.toMatchObject({ created: 20 });
		expect(await directRows(t, firstTemplateId)).toHaveLength(20);
		expect(await directRows(t, secondTemplateId)).toHaveLength(20);
		await t.run(async (ctx) => {
			const buckets = await ctx.db.query('rateLimits').collect();
			expect(buckets).toHaveLength(2);
			expect(new Set(buckets.map((bucket) => bucket.key)).size).toBe(2);
		});
	});

	it.each([
		['draft', { status: 'draft' }],
		['private', { isPublic: false }]
	] as const)(
		'rejects an ineligible %s template before history or admission',
		async (_name, overrides) => {
			const t = convexTest({ schema, modules });
			const templateId = await template(t, `direct-${_name}`, overrides);
			await expect(
				t.mutation(
					api.positions.recordDirectDeliveries,
					args(templateId, [{ name: 'Recipient', deliveryMethod: 'recorded' }])
				)
			).rejects.toThrow('DIRECT_DELIVERY_TEMPLATE_INELIGIBLE');
			await t.run(async (ctx) => {
				expect(await ctx.db.query('positionDeliveries').collect()).toEqual([]);
				expect(await ctx.db.query('rateLimits').collect()).toEqual([]);
			});
		}
	);

	it('rejects noncanonical pseudonymous aliases before database work', async () => {
		const t = convexTest({ schema, modules });
		const templateId = await template(t, 'direct-canonical-pseudonym');
		await expect(
			t.mutation(
				api.positions.recordDirectDeliveries,
				args(templateId, [{ name: 'Recipient', deliveryMethod: 'email' as const }], 'A'.repeat(64))
			)
		).rejects.toThrow('DIRECT_DELIVERY_PSEUDONYM_INVALID');
		await t.run(async (ctx) => {
			expect(await ctx.db.query('positionDeliveries').collect()).toEqual([]);
			expect(await ctx.db.query('rateLimits').collect()).toEqual([]);
		});
	});

	it('rejects an oversized complete Convex envelope', async () => {
		const oversizedSecret = 's'.repeat(65_536);
		vi.stubEnv('INTERNAL_API_SECRET', oversizedSecret);
		const t = convexTest({ schema, modules });
		const templateId = await template(t, 'direct-oversized-envelope');
		await expect(
			t.mutation(
				api.positions.recordDirectDeliveries,
				args(
					templateId,
					[{ name: 'Recipient', deliveryMethod: 'email' as const }],
					PSEUDONYMOUS_ID,
					oversizedSecret
				)
			)
		).rejects.toThrow('DIRECT_DELIVERY_INPUT_TOO_LARGE');
		await t.run(async (ctx) => {
			expect(await ctx.db.query('positionDeliveries').collect()).toEqual([]);
			expect(await ctx.db.query('rateLimits').collect()).toEqual([]);
		});
	});
});
