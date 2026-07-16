/// <reference types="vite/client" />

import { describe, expect, it, vi } from 'vitest';
import { convexTest, type TestConvex } from 'convex-test';

import schema from './schema';
import { api, internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { computeTwinEdges } from './lib/relatedness';
import { clusterTagConcepts, conceptEdges, tagConceptMap } from './lib/tag_concepts';

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts']);

type Harness = TestConvex<typeof schema>;
type TemplateValue = Omit<Doc<'templates'>, '_id' | '_creationTime'>;

function newHarness(): Harness {
	return convexTest(schema, modules);
}

function templateValue(index: number, overrides: Partial<TemplateValue> = {}): TemplateValue {
	return {
		slug: `template-${index}`,
		title: `Template ${index}`,
		description: `Description ${index}`,
		topics: [],
		type: 'email',
		deliveryMethod: 'email',
		preview: `Preview ${index}`,
		messageBody: `Message ${index}`,
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
		updatedAt: 1_800_000_000_000 + index,
		...overrides
	};
}

function embedding(head: number[]): number[] {
	return [...head, ...new Array<number>(768 - head.length).fill(0)];
}

describe('templates materialized public snapshots', () => {
	it('publishes explicit ready revisions atomically and distinguishes a valid empty corpus from cold start', async () => {
		const t = newHarness();

		expect(await t.query(api.templates.publicDiscoveryManifest, {})).toEqual({
			list: { ready: false, revision: 0, updatedAt: null },
			relations: { ready: false, revision: 0, updatedAt: null }
		});
		expect(await t.query(api.templates.publicDiscoveryList, {})).toEqual({
			revision: 0,
			updatedAt: null,
			templates: []
		});
		expect(await t.query(api.templates.publicDiscoveryRelations, {})).toEqual({
			revision: 0,
			updatedAt: null,
			twinEdges: [],
			conceptRelations: { edges: [], conceptMap: {} }
		});

		await t.mutation(internal.templates.rebuildPublicTemplateSnapshots, {});
		const afterList = await t.query(api.templates.publicDiscoveryManifest, {});
		expect(afterList.list).toMatchObject({ ready: true, revision: 1 });
		expect(afterList.relations).toEqual({ ready: false, revision: 0, updatedAt: null });
		expect(await t.query(api.templates.publicDiscoveryList, {})).toMatchObject({
			revision: 1,
			templates: []
		});

		await t.mutation(internal.templates.rebuildRelationSnapshot, {});
		const afterRelations = await t.query(api.templates.publicDiscoveryManifest, {});
		expect(afterRelations.relations).toMatchObject({ ready: true, revision: 1 });
		expect(await t.query(api.templates.publicDiscoveryRelations, {})).toMatchObject({
			revision: 1,
			twinEdges: [],
			conceptRelations: { edges: [], conceptMap: {} }
		});

		// A failed composite publication must advance neither family. The list size
		// guard fires before any row/manifest write and Convex rolls the mutation back.
		await t.run(async (ctx) => {
			for (let index = 0; index < 50; index++) {
				await ctx.db.insert(
					'templates',
					templateValue(5_000 + index, { messageBody: 'x'.repeat(22_000) })
				);
			}
		});
		await expect(t.mutation(internal.templates.rebuildHomepageSnapshots, {})).rejects.toThrow(
			/PUBLIC_TEMPLATE_SNAPSHOT_TOO_LARGE:all/
		);
		expect(await t.query(api.templates.publicDiscoveryManifest, {})).toEqual(afterRelations);

		// Even if a legacy/manual row edit creates a mismatch, the payload exposes
		// its own revision so the edge can reject it against manifest revision 1.
		await t.run(async (ctx) => {
			const row = await ctx.db
				.query('publicTemplateSnapshots')
				.withIndex('by_key', (q) => q.eq('key', 'all'))
				.unique();
			if (!row) throw new Error('missing list snapshot');
			await ctx.db.patch(row._id, { revision: 999 });
		});
		expect(await t.query(api.templates.publicDiscoveryList, {})).toMatchObject({
			revision: 999,
			templates: []
		});

		await t.run(async (ctx) => {
			const row = await ctx.db
				.query('templateRelationSnapshots')
				.withIndex('by_key', (q) => q.eq('key', 'public'))
				.unique();
			if (!row) throw new Error('missing relation snapshot');
			await ctx.db.patch(row._id, { revision: 999 });
		});
		expect(await t.query(api.templates.publicDiscoveryRelations, {})).toMatchObject({
			revision: 999,
			twinEdges: [],
			conceptRelations: { edges: [], conceptMap: {} }
		});
	});

	it('coalesces dirty writes for 60 seconds and enforces six hours between scheduled list rebuilds', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-07-16T00:00:00.000Z'));
		try {
			const t = newHarness();
			const firstDirtyAt = Date.now();
			const first = await t.mutation(internal.templates.requestPublicTemplateSnapshotRefresh, {});
			vi.advanceTimersByTime(1_000);
			const duplicate = await t.mutation(
				internal.templates.requestPublicTemplateSnapshotRefresh,
				{}
			);
			expect(first.scheduled).toBe(true);
			expect(duplicate).toEqual({ scheduled: false, scheduledAt: first.scheduledAt });
			const coalescedRow = await t.run(async (ctx) =>
				ctx.db
					.query('publicDiscoveryManifest')
					.withIndex('by_key', (q) => q.eq('key', 'public'))
					.unique()
			);
			// The duplicate did not patch the singleton's dirty timestamp.
			expect(coalescedRow?.listDirtyAt).toBe(firstDirtyAt);

			vi.advanceTimersByTime(58_999);
			expect((await t.query(api.templates.publicDiscoveryManifest, {})).list.revision).toBe(0);
			vi.advanceTimersByTime(1);
			await t.finishInProgressScheduledFunctions();
			const firstPublish = await t.query(api.templates.publicDiscoveryManifest, {});
			expect(firstPublish.list).toMatchObject({ ready: true, revision: 1 });

			const next = await t.mutation(internal.templates.requestPublicTemplateSnapshotRefresh, {});
			const nextDuplicate = await t.mutation(
				internal.templates.requestPublicTemplateSnapshotRefresh,
				{}
			);
			expect(next.scheduled).toBe(true);
			expect(nextDuplicate).toEqual({ scheduled: false, scheduledAt: next.scheduledAt });
			expect(next.scheduledAt).toBe(firstPublish.list.updatedAt! + 6 * 60 * 60 * 1000);

			vi.advanceTimersByTime(6 * 60 * 60 * 1000 - 1);
			expect((await t.query(api.templates.publicDiscoveryManifest, {})).list.revision).toBe(1);
			vi.advanceTimersByTime(1);
			await t.finishInProgressScheduledFunctions();
			expect((await t.query(api.templates.publicDiscoveryManifest, {})).list).toMatchObject({
				ready: true,
				revision: 2
			});
		} finally {
			vi.useRealTimers();
		}
	});

	it('rebuilds both bounded list variants once, preserves order, and retains last-good rows on oversize', async () => {
		const t = newHarness();

		await t.run(async (ctx) => {
			for (let index = 0; index < 260; index++) {
				await ctx.db.insert(
					'templates',
					templateValue(index, {
						deliveryMethod: index % 2 === 0 ? 'cwc' : 'email'
					})
				);
			}
			// These are newer than every eligible row but the exact compound index
			// must exclude them before they can displace a snapshot member.
			await ctx.db.insert('templates', templateValue(1_000, { status: 'draft', isPublic: true }));
			await ctx.db.insert(
				'templates',
				templateValue(1_001, { status: 'published', isPublic: false })
			);
		});

		// Cold start is intentionally honest and cheap: source rows do not trigger
		// an embedding-heavy fallback.
		expect(await t.query(api.templates.listPublic, {})).toEqual([]);

		const rebuilt = await t.mutation(internal.templates.rebuildHomepageSnapshots, {});
		expect(rebuilt.list).toMatchObject({
			sourceCap: 250,
			scannedCount: 250,
			allCount: 50,
			excludeCwcCount: 50
		});
		expect(rebuilt.relations).toMatchObject({
			sourceCap: 50,
			sourceTemplateCount: 50,
			embeddedTemplateCount: 0
		});

		const all = await t.query(api.templates.listPublic, {});
		expect(all).toHaveLength(50);
		expect(all.map((template) => template.slug)).toEqual(
			Array.from({ length: 50 }, (_, offset) => `template-${259 - offset}`)
		);

		const excludingCwc = await t.query(api.templates.listPublic, {
			excludeCwc: true
		});
		expect(excludingCwc).toHaveLength(50);
		expect(excludingCwc.every((template) => template.deliveryMethod !== 'cwc')).toBe(true);
		expect(excludingCwc.map((template) => template.slug)).toEqual(
			Array.from({ length: 50 }, (_, offset) => `template-${259 - offset * 2}`)
		);

		const beforeOversize = all.map((template) => template.id);
		await t.run(async (ctx) => {
			for (let index = 0; index < 50; index++) {
				await ctx.db.insert(
					'templates',
					templateValue(2_000 + index, {
						messageBody: 'x'.repeat(22_000)
					})
				);
			}
		});

		await expect(t.mutation(internal.templates.rebuildPublicTemplateSnapshots, {})).rejects.toThrow(
			/PUBLIC_TEMPLATE_SNAPSHOT_TOO_LARGE:all/
		);
		expect((await t.query(api.templates.listPublic, {})).map((template) => template.id)).toEqual(
			beforeOversize
		);
	});

	it('caps each template to its newest six endorsement organizations and preserves the total', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-07-16T00:00:00.000Z'));
		try {
			const t = newHarness();
			const templateId = await t.run((ctx) =>
				ctx.db.insert('templates', templateValue(3_000, { endorsementCount: 30 }))
			);

			for (let index = 0; index < 30; index++) {
				vi.advanceTimersByTime(1_000);
				await t.run(async (ctx) => {
					const orgId = await ctx.db.insert('organizations', {
						name: `Endorser ${index}`,
						slug: `endorser-${index}`,
						maxSeats: 1,
						maxTemplatesMonth: 1,
						dmCacheTtlDays: 7,
						countryCode: 'US',
						isPublic: true,
						updatedAt: Date.now()
					});
					await ctx.db.insert('templateEndorsements', {
						templateId,
						orgId,
						endorsedAt: Date.now()
					});
				});
			}

			await t.mutation(internal.templates.rebuildPublicTemplateSnapshots, {});
			const [template] = await t.query(api.templates.listPublic, {});
			expect(template.endorsingOrgs).toHaveLength(6);
			expect(template.endorsingOrgs.map((org: { name: string }) => org.name)).toEqual(
				Array.from({ length: 6 }, (_, offset) => `Endorser ${29 - offset}`)
			);
			expect(template.endorsementCount).toBe(30);
		} finally {
			vi.useRealTimers();
		}
	});

	it('ages quiet daily-arrival windows to the materialization day', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-07-16T12:00:00.000Z'));
		try {
			const t = newHarness();
			const anchoredDay = Date.parse('2026-07-13T00:00:00.000Z');
			const expiredDay = Date.parse('2026-06-01T00:00:00.000Z');
			await t.run(async (ctx) => {
				await ctx.db.insert(
					'templates',
					templateValue(3_100, {
						verifiedSends: 18,
						dailyArrivals: [...new Array<number>(27).fill(0), 5, 6, 7],
						dailyArrivalsLastDay: anchoredDay
					})
				);
				await ctx.db.insert(
					'templates',
					templateValue(3_101, {
						verifiedSends: 9,
						dailyArrivals: [...new Array<number>(29).fill(0), 9],
						dailyArrivalsLastDay: expiredDay
					})
				);
			});

			await t.mutation(internal.templates.rebuildPublicTemplateSnapshots, {});
			const templates = await t.query(api.templates.listPublic, {});
			const shifted = templates.find((template) => template.slug === 'template-3100');
			const expired = templates.find((template) => template.slug === 'template-3101');

			expect(shifted?.daily_arrivals).toHaveLength(30);
			expect(shifted?.daily_arrivals.slice(-6)).toEqual([5, 6, 7, 0, 0, 0]);
			expect(expired?.daily_arrivals).toEqual(new Array<number>(30).fill(0));
		} finally {
			vi.useRealTimers();
		}
	});

	it('marks the public list dirty only when an organization avatar changes', async () => {
		const t = newHarness();
		const tokenIdentifier = 'https://issuer.example|avatar-editor';
		const { orgId } = await t.run(async (ctx) => {
			const userId = await ctx.db.insert('users', {
				tokenIdentifier,
				updatedAt: Date.now(),
				isVerified: true,
				authorityLevel: 1,
				trustTier: 1,
				trustScore: 0,
				reputationTier: 'novice',
				districtVerified: false,
				templatesContributed: 0,
				templateAdoptionRate: 0,
				peerEndorsements: 0,
				activeMonths: 0,
				profileVisibility: 'private'
			});
			const orgId = await ctx.db.insert('organizations', {
				name: 'Avatar Org',
				slug: 'avatar-org',
				maxSeats: 2,
				maxTemplatesMonth: 2,
				dmCacheTtlDays: 7,
				countryCode: 'US',
				isPublic: true,
				updatedAt: Date.now()
			});
			await ctx.db.insert('orgMemberships', {
				userId,
				orgId,
				role: 'editor',
				joinedAt: Date.now()
			});
			return { orgId };
		});
		const authenticated = t.withIdentity({
			subject: 'avatar-editor',
			issuer: 'https://issuer.example',
			tokenIdentifier
		});

		await authenticated.mutation(api.organizations.update, {
			slug: 'avatar-org',
			description: 'Description-only updates do not affect public template cards.'
		});
		expect(
			await t.run((ctx) =>
				ctx.db
					.query('publicDiscoveryManifest')
					.withIndex('by_key', (q) => q.eq('key', 'public'))
					.unique()
			)
		).toBeNull();

		await authenticated.mutation(api.organizations.update, {
			slug: 'avatar-org',
			avatar: 'https://images.example/avatar.png'
		});
		const dirtyManifest = await t.run((ctx) =>
			ctx.db
				.query('publicDiscoveryManifest')
				.withIndex('by_key', (q) => q.eq('key', 'public'))
				.unique()
		);
		expect(dirtyManifest).toMatchObject({
			key: 'public',
			listReady: false,
			listRevision: 0
		});
		expect(dirtyManifest?.listDirtyAt).toEqual(expect.any(Number));
		expect(dirtyManifest?.listRefreshScheduledAt).toEqual(expect.any(Number));
		expect(await t.run((ctx) => ctx.db.get(orgId))).toMatchObject({
			avatar: 'https://images.example/avatar.png'
		});

		const firstDirtyAt = dirtyManifest?.listDirtyAt;
		await authenticated.mutation(api.organizations.update, {
			slug: 'avatar-org',
			avatar: 'https://images.example/avatar.png'
		});
		const unchangedManifest = await t.run((ctx) =>
			ctx.db
				.query('publicDiscoveryManifest')
				.withIndex('by_key', (q) => q.eq('key', 'public'))
				.unique()
		);
		expect(unchangedManifest?.listDirtyAt).toBe(firstDirtyAt);
	});

	it('publishes pure-helper-equivalent relations and never live-scans on reads', async () => {
		const t = newHarness();
		const topicVectors = [
			embedding([10, 1, 0, 0]),
			embedding([10, 1, 0, 0]),
			embedding([10, 0, 1, 0]),
			embedding([10, 0, -1, 0])
		];
		const tags = ['libraries', 'library-card', 'rural-access', 'ceo-pay-ratio'];
		const tagVectors = [
			embedding([10, 2, 0]),
			embedding([10, 1, 0]),
			embedding([10, 0, 1]),
			embedding([10, 0, -1])
		];

		const ids = await t.run(async (ctx) => {
			const inserted: Id<'templates'>[] = [];
			for (let index = 0; index < 4; index++) {
				const id = await ctx.db.insert(
					'templates',
					templateValue(index, {
						topics: [tags[index]],
						topicEmbedding: topicVectors[index],
						tagEmbeddings: [{ tag: tags[index], embedding: tagVectors[index] }]
					})
				);
				inserted.push(id);
			}
			// Both rows carry valid vectors but are outside the exact public corpus.
			await ctx.db.insert(
				'templates',
				templateValue(10, {
					status: 'draft',
					topicEmbedding: embedding([10, 1, 0, 0])
				})
			);
			await ctx.db.insert(
				'templates',
				templateValue(11, {
					isPublic: false,
					topicEmbedding: embedding([10, 1, 0, 0])
				})
			);
			return inserted;
		});

		expect(await t.query(api.templates.relatednessEdges, {})).toEqual([]);
		expect(await t.query(api.templates.conceptRelations, {})).toEqual({
			edges: [],
			conceptMap: {}
		});

		const rebuilt = await t.mutation(internal.templates.rebuildRelationSnapshot, {});
		expect(rebuilt).toMatchObject({
			sourceCap: 50,
			sourceTemplateCount: 4,
			embeddedTemplateCount: 4,
			tagVectorCount: 4
		});

		const expectedTwins = computeTwinEdges(
			ids.map((id, index) => ({ id, embedding: topicVectors[index] }))
		);
		const concepts = clusterTagConcepts(
			tags.map((tag, index) => ({ tag, embedding: tagVectors[index] }))
		);
		const expectedConceptEdges = conceptEdges(
			ids.map((id, index) => ({ id, tags: [tags[index]] })),
			concepts
		);

		expect(await t.query(api.templates.relatednessEdges, {})).toEqual(expectedTwins);
		expect(await t.query(api.templates.conceptRelations, {})).toEqual({
			edges: expectedConceptEdges,
			conceptMap: tagConceptMap(concepts)
		});

		// Mutating an embedding after publication must not affect request reads
		// until the explicit rebuild publishes a new singleton.
		await t.run(async (ctx) => {
			await ctx.db.patch(ids[0], {
				topicEmbedding: embedding([10, -20, 0, 0])
			});
		});
		expect(await t.query(api.templates.relatednessEdges, {})).toEqual(expectedTwins);

		await t.mutation(internal.templates.rebuildRelationSnapshot, {});
		const snapshotRows = await t.run(async (ctx) =>
			ctx.db.query('templateRelationSnapshots').collect()
		);
		expect(snapshotRows).toHaveLength(1);
		expect(snapshotRows[0]).toMatchObject({
			key: 'public',
			sourceCap: 50,
			sourceTemplateCount: 4
		});
		expect(JSON.stringify(snapshotRows[0])).not.toContain('topicEmbedding');
		expect(JSON.stringify(snapshotRows[0])).not.toContain('tagEmbeddings');

		// A removed topic must not keep influencing the concept vocabulary merely
		// because its old server-side vector is still stored for cheap reuse.
		await t.run(async (ctx) => {
			await ctx.db.patch(ids[0], { topics: [] });
		});
		await t.mutation(internal.templates.rebuildRelationSnapshot, {});
		expect((await t.query(api.templates.conceptRelations, {})).conceptMap).not.toHaveProperty(
			tags[0]
		);
	});
});
