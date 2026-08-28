/// <reference types="vite/client" />

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { convexTest, type TestConvex } from 'convex-test';
import { makeFunctionReference, type FunctionReference } from 'convex/server';

import { api, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import {
	matterExternalIdDigest,
	ORG_AUTHORED_RELEVANCE_BLOCK_REASON,
	ORG_MATTER_CAP_PER_ORG,
	ORG_MATTER_EXTERNAL_ID_PREFIX
} from './lib/matterAuthority';
import schema from './schema';

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts']);
const NOW = Date.parse('2026-08-07T12:00:00.000Z');
const SECRET = 'matter-tenant-test-secret-0123456789';
const EMBEDDING = Array.from({ length: 768 }, () => 0.25);
type Harness = TestConvex<typeof schema>;

type MatterArgs = {
	slug: string;
	title: string;
	summary?: string;
	institution: string;
	jurisdiction: string;
	jurisdictionLevel: string;
	status: string;
	statusDate?: number;
	sourceUrl: string;
	topics?: string[];
};

type MatterResult =
	| { _id: Id<'bills'>; externalId: string; created: true }
	| { _id: Id<'bills'>; created: false };

const createMatterRef = makeFunctionReference<'mutation'>(
	'matters:create'
) as unknown as FunctionReference<'mutation', 'public', MatterArgs, MatterResult>;

function orgValue(name: string, slug: string) {
	return {
		name,
		slug,
		maxSeats: 10,
		maxTemplatesMonth: 100,
		dmCacheTtlDays: 30,
		countryCode: 'US',
		isPublic: false,
		updatedAt: NOW
	};
}

function userValue(tokenIdentifier: string) {
	return {
		tokenIdentifier,
		updatedAt: NOW,
		isVerified: true,
		authorityLevel: 1,
		trustTier: 1,
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

function matterArgs(overrides: Partial<MatterArgs> = {}): MatterArgs {
	return {
		slug: 'org-a',
		title: 'University Research Governance Proceeding',
		summary: 'A formal proceeding about the institution research policy.',
		institution: 'Example University',
		jurisdiction: 'example-university',
		jurisdictionLevel: 'institution',
		status: 'open',
		statusDate: NOW,
		sourceUrl: 'https://example.test/proceedings/research-governance',
		topics: ['research', 'governance'],
		...overrides
	};
}

async function seedTenants(t: Harness) {
	const tokens = {
		editorA: 'https://issuer.example|matter-editor-a',
		memberA: 'https://issuer.example|matter-member-a',
		editorB: 'https://issuer.example|matter-editor-b'
	};
	const { orgA, orgB } = await t.run(async (ctx) => {
		const orgA = await ctx.db.insert('organizations', orgValue('Organization A', 'org-a'));
		const orgB = await ctx.db.insert('organizations', orgValue('Organization B', 'org-b'));
		for (const [key, tokenIdentifier] of Object.entries(tokens)) {
			const userId = await ctx.db.insert('users', userValue(tokenIdentifier));
			await ctx.db.insert('orgMemberships', {
				userId,
				orgId: key === 'editorB' ? orgB : orgA,
				role: key === 'memberA' ? 'member' : 'editor',
				joinedAt: NOW
			});
		}
		return { orgA, orgB };
	});
	return {
		orgA,
		orgB,
		editorA: t.withIdentity({ tokenIdentifier: tokens.editorA }),
		memberA: t.withIdentity({ tokenIdentifier: tokens.memberA }),
		editorB: t.withIdentity({ tokenIdentifier: tokens.editorB })
	};
}

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

describe('org-minted matters', () => {
	it('mints one tenant-owned bill and idempotently preserves one relevance row', async () => {
		const t = convexTest(schema, modules);
		const fixture = await seedTenants(t);

		const first = await fixture.editorA.mutation(createMatterRef, matterArgs());
		expect(first.created).toBe(true);
		if (!first.created) throw new Error('matter unexpectedly reused');
		expect(first.externalId).toMatch(/^org-matter:/);

		const stored = await t.run(async (ctx) => {
			const bill = await ctx.db.get(first._id);
			const relevances = await ctx.db
				.query('orgBillRelevances')
				.withIndex('by_orgId_billId', (q) =>
					q.eq('orgId', fixture.orgA).eq('billId', first._id)
				)
				.take(2);
			return { bill, relevances };
		});
		expect(stored.bill).toMatchObject({
			orgId: fixture.orgA,
			externalId: first.externalId,
			title: 'University Research Governance Proceeding',
			sourceUrl: 'https://example.test/proceedings/research-governance'
		});
		expect(stored.relevances).toEqual([
			expect.objectContaining({
				orgId: fixture.orgA,
				billId: first._id,
				scoreFact: {
					state: 'blocked',
					why: ORG_AUTHORED_RELEVANCE_BLOCK_REASON
				},
				matchedOn: ['org_authored']
			})
		]);
		expect(stored.relevances[0]).not.toHaveProperty('presentScore');

		const browse = await fixture.editorA.query(api.legislation.browseBills, {
			slug: 'org-a',
			limit: 10
		});
		expect(browse.bills).toEqual([
			expect.objectContaining({
				_id: first._id,
				relevance: {
					state: 'blocked',
					why: ORG_AUTHORED_RELEVANCE_BLOCK_REASON
				}
			})
		]);
		expect(browse.bills[0]).not.toHaveProperty('relevanceScore');
		await expect(
			fixture.editorA.query(api.legislation.listRelevantBills, { slug: 'org-a', limit: 10 })
		).resolves.toEqual([]);

		await expect(fixture.editorA.mutation(createMatterRef, matterArgs())).resolves.toEqual({
			_id: first._id,
			created: false
		});
		const counts = await t.run(async (ctx) => ({
			bills: await ctx.db
				.query('bills')
				.withIndex('by_orgId', (q) => q.eq('orgId', fixture.orgA))
				.take(2),
			relevances: await ctx.db
				.query('orgBillRelevances')
				.withIndex('by_orgId_billId', (q) =>
					q.eq('orgId', fixture.orgA).eq('billId', first._id)
				)
				.take(2)
		}));
		expect(counts.bills).toHaveLength(1);
		expect(counts.relevances).toHaveLength(1);
	});

	it('refuses creation when the org already holds the structural matter cap', async () => {
		const t = convexTest(schema, modules);
		const fixture = await seedTenants(t);
		await t.run(async (ctx) => {
			for (let index = 0; index < ORG_MATTER_CAP_PER_ORG - 1; index += 1) {
				await ctx.db.insert('bills', {
					orgId: fixture.orgA,
					externalId: `org-matter:cap-fixture:${index}`,
					jurisdiction: 'example-university',
					jurisdictionLevel: 'institution',
					title: `Capped matter ${index}`,
					status: 'open',
					statusDate: NOW,
					committees: [],
					sourceUrl: `https://example.test/matters/${index}`,
					topics: [],
					entities: ['Example University'],
					updatedAt: NOW
				});
			}
		});

		const atCap = await fixture.editorA.mutation(createMatterRef, matterArgs());
		expect(atCap.created).toBe(true);
		await expect(fixture.editorA.mutation(createMatterRef, matterArgs())).resolves.toEqual({
			_id: atCap._id,
			created: false
		});
		await expect(
			fixture.editorA.mutation(
				createMatterRef,
				matterArgs({
					title: 'One matter beyond the structural cap',
					sourceUrl: 'https://example.test/matters/over-cap'
				})
			)
		).rejects.toThrow('MATTER_CAP_EXCEEDED');
		const orgMatters = await t.run((ctx) =>
			ctx.db
				.query('bills')
				.withIndex('by_orgId', (q) => q.eq('orgId', fixture.orgA))
				.take(ORG_MATTER_CAP_PER_ORG + 1)
		);
		expect(orgMatters).toHaveLength(ORG_MATTER_CAP_PER_ORG);
	});

	it('rejects unsafe source URLs and non-editor creation', async () => {
		const t = convexTest(schema, modules);
		const fixture = await seedTenants(t);

		for (const sourceUrl of [
			'http://example.test/matter',
			'javascript:alert(1)',
			'https://user:secret@example.test/matter'
		]) {
			await expect(
				fixture.editorA.mutation(createMatterRef, matterArgs({ sourceUrl }))
			).rejects.toThrow('MATTER_SOURCE_URL_INVALID');
		}
		await expect(fixture.memberA.mutation(createMatterRef, matterArgs())).rejects.toThrow(
			'Requires editor role or higher'
		);
	});

	it('refuses a generated external-id collision with a row it did not mint', async () => {
		const t = convexTest(schema, modules);
		const fixture = await seedTenants(t);
		const args = matterArgs();
		const normalizedUrl = new URL(args.sourceUrl).toString();
		const digest = await matterExternalIdDigest(`${normalizedUrl}\u0000${args.title.trim()}`);
		await t.run(async (ctx) => {
			await ctx.db.insert('bills', {
				orgId: fixture.orgB,
				externalId: `${ORG_MATTER_EXTERNAL_ID_PREFIX}${fixture.orgA}:${digest}`,
				jurisdiction: 'foreign-org',
				jurisdictionLevel: 'institution',
				title: 'Foreign collision',
				status: 'open',
				statusDate: NOW,
				committees: [],
				sourceUrl: 'https://example.test/foreign',
				topics: [],
				entities: [],
				updatedAt: NOW
			});
		});

		await expect(fixture.editorA.mutation(createMatterRef, args)).rejects.toThrow(
			'MATTER_EXTERNAL_ID_CONFLICT'
		);
	});

	it('hides, refuses, and does not rescore a foreign tenant matter', async () => {
		const t = convexTest(schema, modules);
		const fixture = await seedTenants(t);
		const created = await fixture.editorA.mutation(
			createMatterRef,
			matterArgs({ title: 'Rare Tenant Boundary Proceeding' })
		);
		await t.run((ctx) => ctx.db.patch(created._id, { topicEmbedding: EMBEDDING }));

		const ownSearch = await fixture.editorA.query(api.legislation.searchBills, {
			slug: 'org-a',
			q: 'Rare Tenant Boundary'
		});
		const foreignSearch = await fixture.editorB.query(api.legislation.searchBills, {
			slug: 'org-b',
			q: 'Rare Tenant Boundary'
		});
		expect(ownSearch.bills.map((bill) => bill._id)).toContain(created._id);
		expect(foreignSearch).toMatchObject({ bills: [], total: 0 });

		const ownRecent = await fixture.editorA.query(api.legislation.listRecentBills, {
			slug: 'org-a'
		});
		const foreignRecent = await fixture.editorB.query(api.legislation.listRecentBills, {
			slug: 'org-b'
		});
		expect(ownRecent.map((bill) => bill._id)).toContain(created._id);
		expect(foreignRecent.map((bill) => bill._id)).not.toContain(created._id);

		await expect(
			fixture.editorB.mutation(api.legislation.watchBill, {
				slug: 'org-b',
				billId: created._id
			})
		).rejects.toThrow('MATTER_NOT_FOUND');
		await expect(
			fixture.editorB.mutation(api.campaigns.create, {
				slug: 'org-b',
				title: 'Foreign matter campaign',
				type: 'LETTER',
				billId: created._id
			})
		).rejects.toThrow('MATTER_NOT_FOUND');
		await expect(
			fixture.editorA.mutation(api.campaigns.create, {
				slug: 'org-a',
				title: 'Own matter campaign',
				type: 'LETTER',
				billId: created._id
			})
		).resolves.toBeDefined();

		const rescore = await fixture.editorB.action(api.legislation.rescoreBills, {
			_secret: SECRET,
			slug: 'org-b',
			billIds: [created._id]
		});
		expect(rescore).toMatchObject({
			billsScored: 1,
			rowsUpserted: 0,
			errors: [`${created._id}: MATTER_NOT_FOUND`]
		});
		const foreignRelevance = await t.run((ctx) =>
			ctx.db
				.query('orgBillRelevances')
				.withIndex('by_orgId_billId', (q) =>
					q.eq('orgId', fixture.orgB).eq('billId', created._id)
				)
				.first()
		);
		expect(foreignRelevance).toBeNull();
	});

	it('prunes ingested legislation but preserves org-minted matters', async () => {
		const t = convexTest(schema, modules);
		const fixture = await seedTenants(t);
		const matter = await fixture.editorA.mutation(createMatterRef, matterArgs());
		const ingestedId = await t.run((ctx) =>
			ctx.db.insert('bills', {
				externalId: 'hr-99-119',
				jurisdiction: 'us-federal',
				jurisdictionLevel: 'federal',
				title: 'Disposable ingested bill',
				status: 'introduced',
				statusDate: NOW,
				committees: [],
				sourceUrl: 'https://example.test/hr-99-119',
				topics: [],
				entities: [],
				updatedAt: NOW
			})
		);

		await expect(
			t.mutation(internal.legislation.pruneBillsBatch, {
				batchSize: 10,
				dryRun: false
			})
		).resolves.toMatchObject({ counted: 1, deleted: 1 });
		const survivors = await t.run(async (ctx) => ({
			matter: await ctx.db.get(matter._id),
			ingested: await ctx.db.get(ingestedId)
		}));
		expect(survivors.matter?.orgId).toBe(fixture.orgA);
		expect(survivors.ingested).toBeNull();
	});

	it('projects an accountability receipt with the matter facts end to end', async () => {
		const t = convexTest(schema, modules);
		const fixture = await seedTenants(t);
		const matter = await fixture.editorA.mutation(
			createMatterRef,
			matterArgs({
				title: 'Hospital Service Accountability Hearing',
				jurisdiction: 'example-hospital',
				status: 'scheduled'
			})
		);
		const seeded = await t.run(async (ctx) => {
			const decisionMakerId = await ctx.db.insert('decisionMakers', {
				type: 'executive',
				name: 'Hospital President Example',
				lastName: 'Example',
				active: true,
				updatedAt: NOW
			});
			const campaignId = await ctx.db.insert('campaigns', {
				orgId: fixture.orgA,
				type: 'LETTER',
				title: 'Hospital accountability campaign',
				status: 'ACTIVE',
				debateEnabled: false,
				debateThreshold: 0,
				raisedAmountCents: 0,
				donorCount: 0,
				targetCountry: 'US',
				billId: matter._id,
				updatedAt: NOW
			});
			const deliveryId = await ctx.db.insert('campaignDeliveries', {
				campaignId,
				orgId: fixture.orgA,
				decisionMakerId,
				billId: matter._id,
				targetEmail: 'president@example.test',
				targetName: 'Hospital President Example',
				targetTitle: 'President',
				status: 'queued',
				sentAt: NOW,
				packetSnapshot: {
					summary: {
						verified: 3,
						total: 4,
						districtCount: 2,
						gds: null,
						ald: null,
						cai: null,
						temporalEntropy: null
					}
				},
				packetDigest: 'matter-receipt-packet',
				receiptEligibility: 'eligible',
				createdAt: NOW
			});
			return { decisionMakerId, campaignId, deliveryId };
		});

		await t.mutation(internal.campaigns.updateDeliveryStatus, {
			deliveryId: seeded.deliveryId,
			status: 'sent'
		});

		const result = await t.run(async (ctx) => {
			const receipt = await ctx.db
				.query('accountabilityReceipts')
				.withIndex('by_deliveryId', (q) => q.eq('deliveryId', seeded.deliveryId))
				.first();
			const projection = receipt
				? await ctx.db
						.query('accountabilityReceiptProjections')
						.withIndex('by_receiptId', (q) => q.eq('receiptId', receipt._id))
						.unique()
				: null;
			return { receipt, projection };
		});
		expect(result.receipt).toMatchObject({
			billId: matter._id,
			decisionMakerId: seeded.decisionMakerId,
			orgId: fixture.orgA,
			verifiedCount: 3,
			totalCount: 4
		});
		expect(result.projection).toMatchObject({
			billId: matter._id,
			billExternalId: matter.created ? matter.externalId : expect.any(String),
			billTitle: 'Hospital Service Accountability Hearing',
			billStatus: 'scheduled',
			billJurisdiction: 'example-hospital'
		});
	});
});
