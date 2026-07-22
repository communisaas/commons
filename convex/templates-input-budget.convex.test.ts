/// <reference types="vite/client" />

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { convexTest, type TestConvex } from 'convex-test';

import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema from './schema';
import { SEED_TEMPLATES } from './seedData';

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts']);
const SECRET = 'template-input-budget-secret-32-bytes';

type Harness = TestConvex<typeof schema>;

function newHarness(): Harness {
	return convexTest(schema, modules);
}

async function createAuthenticatedUser(t: Harness) {
	const tokenIdentifier = 'https://issuer.example|input-budget-author';
	const userId = await t.run((ctx) =>
		ctx.db.insert('users', {
			tokenIdentifier,
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
	return {
		userId,
		authenticated: t.withIdentity({
			subject: 'input-budget-author',
			issuer: 'https://issuer.example',
			tokenIdentifier
		})
	};
}

function baseCreateArgs(userId: Id<'users'>) {
	return {
		_secret: SECRET,
		userId,
		title: 'Bounded authoring input',
		slug: 'bounded-authoring-input',
		description: 'Direct Convex boundary regression fixture.',
		messageBody: 'Body',
		preview: 'Preview',
		type: 'email',
		deliveryMethod: 'email',
		domain: 'civic',
		topics: ['availability'],
		contentHash: 'bounded-authoring-input',
		status: 'published',
		isPublic: true,
		consensusApproved: true
	};
}

describe('templates.createTemplate input budgets', () => {
	beforeEach(() => {
		vi.stubEnv('INTERNAL_API_SECRET', SECRET);
		vi.stubEnv('INTERNAL_API_SECRET_PREVIOUS', '');
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it('rejects unsafe direct-Convex inputs before any source or discovery-state write', async () => {
		const t = newHarness();
		const { authenticated, userId } = await createAuthenticatedUser(t);
		const base = baseCreateArgs(userId);

		await expect(
			authenticated.mutation(api.templates.createTemplate, {
				...base,
				recipientConfig: { payload: 'x'.repeat(8_300) }
			})
		).rejects.toThrow('TEMPLATE_INPUT_BUDGET_EXCEEDED:configs:max_bytes');

		await expect(
			authenticated.mutation(api.templates.createTemplate, {
				...base,
				deliveryConfig: []
			})
		).rejects.toThrow('TEMPLATE_INPUT_BUDGET_EXCEEDED:configs:non_plain_object');

		await expect(
			authenticated.mutation(api.templates.createTemplate, {
				...base,
				researchLog: Array.from({ length: 17 }, (_, index) => `${index}:${'x'.repeat(1_000)}`)
			})
		).rejects.toThrow('TEMPLATE_INPUT_BUDGET_EXCEEDED:authoring_input:max_bytes');

		await expect(
			authenticated.mutation(api.templates.createTemplate, {
				...base,
				messageBody: 'x'.repeat(13_000)
			})
		).rejects.toThrow('TEMPLATE_INPUT_BUDGET_EXCEEDED:public_input:max_bytes');

		await expect(
			authenticated.mutation(api.templates.createTemplate, {
				...base,
				geographicScope: { type: 'nationwide', country: 'ca' }
			})
		).rejects.toThrow('TEMPLATE_INPUT_BUDGET_EXCEEDED:geographic_scope:invalid_geographic_scope');

		await expect(
			authenticated.mutation(api.templates.createTemplate, {
				...base,
				geographicScope: {
					type: 'nationwide',
					country: 'CA',
					displayName: 'x'.repeat(201)
				}
			})
		).rejects.toThrow('TEMPLATE_INPUT_BUDGET_EXCEEDED:geographic_scope:invalid_geographic_scope');

		const scopeWithUnknownKey = {
			type: 'nationwide' as const,
			country: 'CA',
			unexpected: 'not accepted by the exact Convex validator'
		};
		await expect(
			authenticated.mutation(api.templates.createTemplate, {
				...base,
				geographicScope: scopeWithUnknownKey
			})
		).rejects.toThrow();

		await t.run(async (ctx) => {
			expect(await ctx.db.query('templates').collect()).toEqual([]);
			expect(await ctx.db.query('publicDiscoveryManifest').collect()).toEqual([]);
		});
	});

	it('accepts the richest current production seed within the preventive budgets', async () => {
		const t = newHarness();
		const { authenticated, userId } = await createAuthenticatedUser(t);
		const seed = SEED_TEMPLATES.find(({ slug }) => slug === 'montreal-bixi-savings');
		expect(seed).toBeDefined();

		const created = await authenticated.mutation(api.templates.createTemplate, {
			...baseCreateArgs(userId),
			title: seed!.title,
			slug: seed!.slug,
			description: seed!.description,
			messageBody: seed!.messageBody,
			preview: seed!.preview,
			type: seed!.type,
			deliveryMethod: seed!.deliveryMethod,
			domain: seed!.domain,
			topics: seed!.topics,
			sources: seed!.sources,
			researchLog: seed!.researchLog,
			deliveryConfig: seed!.deliveryConfig,
			cwcConfig: seed!.cwcConfig,
			recipientConfig: seed!.recipientConfig,
			contentHash: seed!.contentHash,
			geographicScope: { type: 'nationwide', country: 'CA' }
		});

		expect(created).toMatchObject({
			title: seed!.title,
			slug: seed!.slug,
			status: 'published',
			isPublic: true,
			scopes: [expect.objectContaining({ countryCode: 'CA', scopeLevel: 'country' })]
		});
		await t.run(async (ctx) => {
			expect(await ctx.db.query('templates').collect()).toHaveLength(1);
			expect(await ctx.db.query('publicDiscoveryManifest').collect()).toHaveLength(1);
		});
	});

	it('accepts a valid 3,800-byte title and persists it exactly', async () => {
		const t = newHarness();
		const { authenticated, userId } = await createAuthenticatedUser(t);
		const title = '🧱'.repeat(950);
		expect(new TextEncoder().encode(title)).toHaveLength(3_800);

		const created = await authenticated.mutation(api.templates.createTemplate, {
			...baseCreateArgs(userId),
			title,
			slug: 'valid-long-title',
			contentHash: 'valid-long-title'
		});

		await t.run(async (ctx) => {
			const row = await ctx.db.get(created!._id);
			expect(row?.title).toBe(title);
		});
	});

	it('rejects an individually oversized public-detail field before writing a template row', async () => {
		const t = newHarness();
		const { authenticated, userId } = await createAuthenticatedUser(t);

		await expect(
			authenticated.mutation(api.templates.createTemplate, {
				...baseCreateArgs(userId),
				title: 'x'.repeat(4_001),
				slug: 'oversized-detail-title',
				contentHash: 'oversized-detail-title'
			})
		).rejects.toThrow('TEMPLATE_INPUT_BUDGET_EXCEEDED:public_input:max_bytes');

		await t.run(async (ctx) => {
			expect(await ctx.db.query('templates').take(1)).toEqual([]);
		});
	});

	it('enforces slug uniqueness inside the authoritative create mutation', async () => {
		const t = newHarness();
		const { authenticated, userId } = await createAuthenticatedUser(t);
		const base = baseCreateArgs(userId);

		const attempts = await Promise.allSettled([
			authenticated.mutation(api.templates.createTemplate, base),
			authenticated.mutation(api.templates.createTemplate, {
				...base,
				title: 'A concurrent request chose the same slug',
				contentHash: 'different-content-same-slug'
			})
		]);
		const fulfilled = attempts.filter((result) => result.status === 'fulfilled');
		const rejected = attempts.filter(
			(result): result is PromiseRejectedResult => result.status === 'rejected'
		);
		expect(fulfilled).toHaveLength(1);
		expect(rejected).toHaveLength(1);
		expect(String(rejected[0].reason)).toContain('TEMPLATE_SLUG_TAKEN');

		await t.run(async (ctx) => {
			const rows = await ctx.db
				.query('templates')
				.withIndex('by_slug', (q) => q.eq('slug', base.slug))
				.collect();
			expect(rows).toHaveLength(1);
		});
	});

	it('rechecks the resulting public projection when metadata is patched', async () => {
		const t = newHarness();
		const { authenticated, userId } = await createAuthenticatedUser(t);
		const created = await authenticated.mutation(
			api.templates.createTemplate,
			baseCreateArgs(userId)
		);

		await expect(
			authenticated.mutation(api.templates.patchMetadata, {
				templateId: created!._id,
				domain: 'x'.repeat(13_000)
			})
		).rejects.toThrow('TEMPLATE_INPUT_BUDGET_EXCEEDED:public_input:max_bytes');

		await expect(t.run((ctx) => ctx.db.get(created!._id))).resolves.toMatchObject({
			domain: 'civic',
			topics: ['availability']
		});
	});

	it('grandfathers unchanged oversized legacy config during bounded metadata patches', async () => {
		const t = newHarness();
		const { authenticated, userId } = await createAuthenticatedUser(t);
		const deliveryConfig = { legacy: 'x'.repeat(20_000) };
		const templateId = await t.run((ctx) =>
			ctx.db.insert('templates', {
				userId,
				slug: 'legacy-oversized-config',
				title: 'Legacy oversized config',
				description: 'Predates the current authoring boundary.',
				topics: ['legacy'],
				type: 'email',
				deliveryMethod: 'email',
				preview: 'Preview',
				messageBody: 'Body',
				deliveryConfig,
				recipientConfig: {},
				status: 'published',
				isPublic: true,
				verifiedSends: 0,
				uniqueDistricts: 0,
				embeddingVersion: 'legacy',
				flaggedByModeration: false,
				consensusApproved: true,
				reputationDelta: 0,
				reputationApplied: false,
				updatedAt: 1
			})
		);

		await expect(
			authenticated.mutation(api.templates.patchMetadata, {
				templateId,
				domain: 'water',
				topics: ['clean water']
			})
		).resolves.toBeNull();
		await expect(t.run((ctx) => ctx.db.get(templateId))).resolves.toMatchObject({
			domain: 'water',
			topics: ['clean water'],
			deliveryConfig
		});

		await expect(
			authenticated.mutation(api.templates.patchMetadata, {
				templateId,
				topics: Array.from({ length: 6 }, (_, i) => `t${i}`)
			})
		).rejects.toThrow('TEMPLATE_INPUT_BUDGET_EXCEEDED:public_input:max_container_entries');
		await expect(
			authenticated.mutation(api.templates.patchMetadata, {
				templateId,
				domain: 'x'.repeat(201)
			})
		).rejects.toThrow('TEMPLATE_INPUT_BUDGET_EXCEEDED:public_input:max_bytes');
	});
});
