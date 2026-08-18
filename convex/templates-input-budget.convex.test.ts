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
		deliveryMethod: 'email' as const,
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

	it('accepts a valid 3,800-byte title without overflowing the compact list plane', async () => {
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
			const [projection, detailProjection] = await Promise.all([
				ctx.db
					.query('templateListProjections')
					.withIndex('by_templateId', (q) => q.eq('templateId', created!._id))
					.unique(),
				ctx.db
					.query('publicTemplateDetailProjections')
					.withIndex('by_templateId', (q) => q.eq('templateId', created!._id))
					.unique()
			]);
			expect(projection).toMatchObject({
				titleTruncated: true,
				titleOriginalBytes: 3_800
			});
			expect(new TextEncoder().encode(projection!.title).byteLength).toBeLessThanOrEqual(512);
			expect(projection!.projectionBytes).toBeLessThanOrEqual(4_000);
			expect(detailProjection?.detail).toMatchObject({ title, subject: title });
			expect(detailProjection!.detailBytes).toBeLessThanOrEqual(48 * 1024);
		});
	});

	it('rejects an individually oversized public-detail field before writing source state', async () => {
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
			expect(await ctx.db.query('publicTemplateDetailProjections').take(1)).toEqual([]);
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

	it('claims provider work only after secret-bound dedupe and allowance checks', async () => {
		const t = newHarness();
		const owner = await createAuthenticatedUser(t);
		const otherTokenIdentifier = 'https://issuer.example|input-budget-other';
		const otherUserId = await t.run((ctx) =>
			ctx.db.insert('users', {
				tokenIdentifier: otherTokenIdentifier,
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
		const created = await owner.authenticated.mutation(
			api.templates.createTemplate,
			baseCreateArgs(owner.userId)
		);
		await expect(
			owner.authenticated.mutation(api.templates.claimTemplateAuthoringLease, {
				_secret: 'wrong-secret',
				userId: owner.userId,
				contentHash: 'bounded-authoring-input',
				slug: 'bounded-authoring-input',
				token: 'wrong-secret-lease-token'
			})
		).rejects.toThrow('Unauthorized');
		await expect(
			owner.authenticated.mutation(api.templates.claimTemplateAuthoringLease, {
				_secret: SECRET,
				userId: otherUserId,
				contentHash: 'new-content',
				slug: 'new-content',
				token: 'mismatched-user-lease-token'
			})
		).rejects.toThrow('TEMPLATE_AUTHORING_LEASE_USER_MISMATCH');

		await expect(
			owner.authenticated.mutation(api.templates.claimTemplateAuthoringLease, {
				_secret: SECRET,
				userId: owner.userId,
				contentHash: 'bounded-authoring-input',
				slug: 'bounded-authoring-input',
				token: 'duplicate-content-lease-token'
			})
		).resolves.toMatchObject({
			outcome: 'duplicate',
			template: {
				_id: created!._id,
				deduplicated: true
			}
		});

		await expect(
			owner.authenticated.mutation(api.templates.claimTemplateAuthoringLease, {
				_secret: SECRET,
				userId: owner.userId,
				contentHash: 'new-content',
				slug: 'new-content',
				token: 'new-content-lease-token'
			})
		).resolves.toMatchObject({ outcome: 'claimed', expiresAt: expect.any(Number) });
	});

	it('lease claims deny exhausted individual and organization allowances', async () => {
		const individualHarness = newHarness();
		const individual = await createAuthenticatedUser(individualHarness);
		for (let index = 0; index < 3; index += 1) {
			await individual.authenticated.mutation(api.templates.createTemplate, {
				...baseCreateArgs(individual.userId),
				title: `Individual allowance ${index}`,
				slug: `individual-allowance-${index}`,
				contentHash: `individual-allowance-${index}`
			});
		}
		await expect(
			individual.authenticated.mutation(api.templates.claimTemplateAuthoringLease, {
				_secret: SECRET,
				userId: individual.userId,
				contentHash: 'individual-over-cap',
				slug: 'individual-over-cap',
				token: 'individual-over-cap-token'
			})
		).resolves.toMatchObject({
			outcome: 'quota_exceeded',
			code: 'AUTHORING_QUOTA_EXCEEDED',
			message: expect.stringContaining('3 free messages this month')
		});
		await individualHarness.run(async (ctx) => {
			expect(await ctx.db.query('templateListProjectionMigrations').collect()).toHaveLength(0);
			expect(await ctx.db.query('templateListProjections').collect()).toHaveLength(3);
		});

		const orgHarness = newHarness();
		const orgAuthor = await createAuthenticatedUser(orgHarness);
		await orgHarness.run(async (ctx) => {
			const orgId = await ctx.db.insert('organizations', {
				name: 'Bounded authoring org',
				slug: 'bounded-authoring-org',
				maxSeats: 1,
				maxTemplatesMonth: 1,
				dmCacheTtlDays: 7,
				countryCode: 'US',
				isPublic: false,
				updatedAt: Date.now()
			});
			await ctx.db.insert('orgMemberships', {
				userId: orgAuthor.userId,
				orgId,
				role: 'admin',
				joinedAt: Date.now()
			});
		});
		await orgAuthor.authenticated.mutation(
			api.templates.createTemplate,
			baseCreateArgs(orgAuthor.userId)
		);
		await expect(
			orgAuthor.authenticated.mutation(api.templates.claimTemplateAuthoringLease, {
				_secret: SECRET,
				userId: orgAuthor.userId,
				contentHash: 'org-over-cap',
				slug: 'org-over-cap',
				token: 'organization-over-cap-token'
			})
		).resolves.toEqual({
			outcome: 'quota_exceeded',
			code: 'TEMPLATE_QUOTA_EXCEEDED'
		});
		await orgHarness.run(async (ctx) => {
			expect(await ctx.db.query('templateListProjectionMigrations').collect()).toHaveLength(0);
			expect(await ctx.db.query('templateListProjections').collect()).toHaveLength(1);
		});
	});

	it('serializes provider-work leases by both user content and global slug', async () => {
		const contentHarness = newHarness();
		const contentAuthor = await createAuthenticatedUser(contentHarness);
		const contentTokens = ['content-lease-token-a', 'content-lease-token-b'];
		const contentClaims = await Promise.all(
			contentTokens.map((token, index) =>
				contentAuthor.authenticated.mutation(api.templates.claimTemplateAuthoringLease, {
					_secret: SECRET,
					userId: contentAuthor.userId,
					contentHash: 'same-provider-content',
					slug: `same-provider-content-${index}`,
					token
				})
			)
		);
		expect(contentClaims.map(({ outcome }) => outcome).sort()).toEqual([
			'claimed',
			'in_progress'
		]);
		const winningContentIndex = contentClaims.findIndex(({ outcome }) => outcome === 'claimed');
		const winningContentToken = contentTokens[winningContentIndex];
		const winningContentSlug = `same-provider-content-${winningContentIndex}`;

		await expect(
			contentAuthor.authenticated.mutation(api.templates.createTemplate, {
				...baseCreateArgs(contentAuthor.userId),
				slug: winningContentSlug,
				contentHash: 'same-provider-content',
				authoringLeaseToken: 'content-lease-token-wrong'
			})
		).rejects.toThrow('TEMPLATE_AUTHORING_LEASE_NOT_OWNED');

		await contentAuthor.authenticated.mutation(api.templates.createTemplate, {
			...baseCreateArgs(contentAuthor.userId),
			slug: winningContentSlug,
			contentHash: 'same-provider-content',
			authoringLeaseToken: winningContentToken
		});
		await contentHarness.run(async (ctx) => {
			expect(await ctx.db.query('templateAuthoringLeases').collect()).toEqual([]);
		});

		const slugHarness = newHarness();
		const firstAuthor = await createAuthenticatedUser(slugHarness);
		const secondTokenIdentifier = 'https://issuer.example|second-lease-author';
		const secondUserId = await slugHarness.run((ctx) =>
			ctx.db.insert('users', {
				tokenIdentifier: secondTokenIdentifier,
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
		const secondAuthor = slugHarness.withIdentity({
			subject: 'second-lease-author',
			issuer: 'https://issuer.example',
			tokenIdentifier: secondTokenIdentifier
		});
		const slugClaims = await Promise.all([
			firstAuthor.authenticated.mutation(api.templates.claimTemplateAuthoringLease, {
				_secret: SECRET,
				userId: firstAuthor.userId,
				contentHash: 'first-slug-content',
				slug: 'globally-shared-provider-slug',
				token: 'global-slug-lease-token-a'
			}),
			secondAuthor.mutation(api.templates.claimTemplateAuthoringLease, {
				_secret: SECRET,
				userId: secondUserId,
				contentHash: 'second-slug-content',
				slug: 'globally-shared-provider-slug',
				token: 'global-slug-lease-token-b'
			})
		]);
		expect(slugClaims.map(({ outcome }) => outcome).sort()).toEqual(['claimed', 'in_progress']);
	});

	it('keeps content dedupe and allowance authoritative across concurrent creates', async () => {
		const dedupeHarness = newHarness();
		const dedupeAuthor = await createAuthenticatedUser(dedupeHarness);
		const sameContent = await Promise.all([
			dedupeAuthor.authenticated.mutation(api.templates.createTemplate, {
				...baseCreateArgs(dedupeAuthor.userId),
				slug: 'concurrent-content-a',
				contentHash: 'concurrent-content'
			}),
			dedupeAuthor.authenticated.mutation(api.templates.createTemplate, {
				...baseCreateArgs(dedupeAuthor.userId),
				slug: 'concurrent-content-b',
				contentHash: 'concurrent-content'
			})
		]);
		expect(sameContent.map((result) => result!.deduplicated).sort()).toEqual([false, true]);
		await dedupeHarness.run(async (ctx) => {
			const rows = await ctx.db
				.query('templates')
				.withIndex('by_userId_contentHash', (q) =>
					q.eq('userId', dedupeAuthor.userId).eq('contentHash', 'concurrent-content')
				)
				.collect();
			expect(rows).toHaveLength(1);
		});

		const quotaHarness = newHarness();
		const quotaAuthor = await createAuthenticatedUser(quotaHarness);
		for (let index = 0; index < 2; index += 1) {
			await quotaAuthor.authenticated.mutation(api.templates.createTemplate, {
				...baseCreateArgs(quotaAuthor.userId),
				title: `Quota seed ${index}`,
				slug: `quota-seed-${index}`,
				contentHash: `quota-seed-${index}`
			});
		}
		const quotaRace = await Promise.allSettled([
			quotaAuthor.authenticated.mutation(api.templates.createTemplate, {
				...baseCreateArgs(quotaAuthor.userId),
				title: 'Quota contender A',
				slug: 'quota-contender-a',
				contentHash: 'quota-contender-a'
			}),
			quotaAuthor.authenticated.mutation(api.templates.createTemplate, {
				...baseCreateArgs(quotaAuthor.userId),
				title: 'Quota contender B',
				slug: 'quota-contender-b',
				contentHash: 'quota-contender-b'
			})
		]);
		expect(quotaRace.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
		const denied = quotaRace.find(
			(result): result is PromiseRejectedResult => result.status === 'rejected'
		);
		expect(String(denied?.reason)).toContain('AUTHORING_QUOTA_EXCEEDED');
		await quotaHarness.run(async (ctx) => {
			const rows = await ctx.db
				.query('templates')
				.withIndex('by_userId', (q) => q.eq('userId', quotaAuthor.userId))
				.collect();
			expect(rows).toHaveLength(3);
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

	it('grandfathers unchanged oversized legacy config during a bounded metadata patch', async () => {
		const t = newHarness();
		const { authenticated, userId } = await createAuthenticatedUser(t);
		const templateId = await t.run((ctx) =>
			ctx.db.insert('templates', {
				userId,
				slug: 'legacy-oversized-config',
				title: 'Legacy oversized config',
				description: 'Predates the current authoring boundary',
				topics: ['legacy'],
				type: 'email',
				deliveryMethod: 'email' as const,
				preview: 'Preview',
				messageBody: 'Body',
				deliveryConfig: { legacy: 'x'.repeat(20_000) },
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
			deliveryConfig: { legacy: 'x'.repeat(20_000) }
		});
	});
});
