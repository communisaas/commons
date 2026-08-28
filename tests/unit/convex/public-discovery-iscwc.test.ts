/// <reference types="vite/client" />

/**
 * Membership in the congressional-free public feed is decided by a constrained
 * column, not by a string read back out of an unconstrained blob.
 *
 * Each `publicTemplateDiscoverySources` row carries two projections of one
 * write: `isCwc: v.boolean()`, which the schema constrains, and `source`, which
 * is `v.any()` and therefore constrained by nothing. The feed the homepage
 * serves when congressional delivery is off is built by excluding congressional
 * templates, so whichever field that filter reads is the field that decides
 * containment. It reads the boolean.
 *
 * The load-bearing case is disagreement. A blob claiming `deliveryMethod:
 * 'email'` beside a row classified `isCwc: true` used to be admitted to the
 * congressional-free feed on the blob's word. It is now refused, and refusal is
 * observable: the published feed is unchanged and still contains no
 * congressional template.
 */
import { describe, expect, it } from 'vitest';
import { convexTest, type TestConvex } from 'convex-test';

import { internal } from '../../../convex/_generated/api';
import schema from '../../../convex/schema';
import {
	assertCompactPublicTemplateSource,
	readPublicTemplateDiscoveryCandidate,
	type CompactPublicTemplateSource
} from '../../../convex/lib/publicTemplateDiscoverySource';

const modules = import.meta.glob(['../../../convex/**/*.ts', '!../../../convex/**/*.test.ts']);
const VECTOR = Array.from({ length: 768 }, (_, index) => index / 768);
type Harness = TestConvex<typeof schema>;
type SnapshotKey = 'all' | 'excludeCwc';
type FeedMember = { slug: string; deliveryMethod: 'cwc' | 'email' };

const FEED: readonly FeedMember[] = [
	{ slug: 'transit-funding', deliveryMethod: 'email' },
	{ slug: 'school-board-budget', deliveryMethod: 'email' },
	{ slug: 'federal-rail-bill', deliveryMethod: 'cwc' },
	{ slug: 'federal-water-act', deliveryMethod: 'cwc' }
];
const DIRECT_SLUGS = FEED.filter((member) => member.deliveryMethod === 'email')
	.map((member) => member.slug)
	.sort();
const ALL_SLUGS = FEED.map((member) => member.slug).sort();

/** Mirrors `PUBLIC_TEMPLATE_SNAPSHOT_SCAN_CAP` in convex/templates.ts. */
const SCAN_CAP = 250;

function templateValue(member: FeedMember, index: number) {
	const topic = `topic-${index}`;
	return {
		slug: member.slug,
		title: `Feed member ${index}`,
		description: 'Compact producer fixture for feed containment.',
		domain: 'civic',
		topics: [topic],
		type: 'email',
		deliveryMethod: member.deliveryMethod,
		preview: 'Preview',
		messageBody: 'Message',
		deliveryConfig: {},
		recipientConfig: {},
		status: 'published',
		isPublic: true,
		verifiedSends: 10,
		uniqueDistricts: 4,
		endorsementCount: 0,
		locationEmbedding: VECTOR,
		topicEmbedding: VECTOR,
		tagEmbeddings: [{ tag: topic, embedding: VECTOR }],
		embeddingVersion: 'test-v1',
		flaggedByModeration: false,
		consensusApproved: true,
		reputationDelta: 0,
		reputationApplied: false,
		updatedAt: 1_800_000_000_000 + index
	};
}

async function migrateEndorsementCounts(t: Harness) {
	let state = await t.mutation(internal.templates.migrateEndorsementCounts, {
		restart: true,
		scheduleContinuation: false
	});
	while (state.status === 'running') {
		state = await t.mutation(internal.templates.migrateEndorsementCounts, {
			runToken: state.runToken,
			scheduleContinuation: false
		});
	}
	expect(state.status).toBe('complete');
}

async function migrateSourcePlane(t: Harness) {
	let state = await t.mutation(internal.templates.migratePublicDiscoverySourcePage, {
		scheduleContinuation: false
	});
	while (state.status === 'running') {
		state = await t.mutation(internal.templates.migratePublicDiscoverySourcePage, {
			runToken: state.runToken,
			cursor: state.continueCursor,
			startedAt: state.startedAt,
			scanned: state.scanned,
			eligible: state.eligible,
			sourcesWritten: state.sourcesWritten,
			topicVectorsWritten: state.topicVectorsWritten,
			tagVectorsWritten: state.tagVectorsWritten,
			rejected: state.rejected,
			scheduleContinuation: false
		});
	}
	expect(state.status).toBe('migrated');
}

/** A source plane holding {@link FEED}, activated and ready to publish. */
async function activatedFeed(): Promise<Harness> {
	const t = convexTest({ schema, modules });
	await t.run(async (ctx) => {
		for (const [index, member] of FEED.entries()) {
			await ctx.db.insert('templates', templateValue(member, index));
		}
	});
	await migrateEndorsementCounts(t);
	await migrateSourcePlane(t);
	await t.mutation(internal.templates.activatePublicDiscoverySourcePlane, {});
	return t;
}

/**
 * One congressional-free template older than a full congressional scan window.
 * The mixed newest-first scan is capped, so this row is reachable only through
 * the `isCwc` index.
 */
async function crowdedFeed(scanCap: number): Promise<Harness> {
	const t = convexTest({ schema, modules });
	await t.run(async (ctx) => {
		await ctx.db.insert(
			'templates',
			templateValue({ slug: 'buried-direct', deliveryMethod: 'email' }, 0)
		);
		for (let index = 1; index <= scanCap; index += 1) {
			await ctx.db.insert(
				'templates',
				templateValue({ slug: `crowding-cwc-${index}`, deliveryMethod: 'cwc' }, index)
			);
		}
	});
	await migrateEndorsementCounts(t);
	await migrateSourcePlane(t);
	await t.mutation(internal.templates.activatePublicDiscoverySourcePlane, {});
	return t;
}

async function publishedSlugs(t: Harness, key: SnapshotKey): Promise<string[]> {
	return await t.run(async (ctx) => {
		const row = await ctx.db
			.query('publicTemplateSnapshots')
			.withIndex('by_key', (q) => q.eq('key', key))
			.unique();
		const cards = (row?.templates ?? []) as Array<{ slug: string }>;
		return cards.map((card) => card.slug).sort();
	});
}

/**
 * Rewrite only the blob's delivery method, leaving the row's `isCwc` column as
 * the writer set it. This is the drift the read guard exists for: one write, two
 * projections, and no schema check on the second.
 */
async function driftBlobDeliveryMethod(t: Harness, slug: string, deliveryMethod: unknown) {
	await t.run(async (ctx) => {
		const template = await ctx.db
			.query('templates')
			.withIndex('by_slug', (q) => q.eq('slug', slug))
			.unique();
		if (!template) throw new Error(`fixture template missing: ${slug}`);
		const row = await ctx.db
			.query('publicTemplateDiscoverySources')
			.withIndex('by_templateId', (q) => q.eq('templateId', template._id))
			.unique();
		if (!row) throw new Error(`fixture source row missing: ${slug}`);
		await ctx.db.patch(row._id, {
			source: { ...(row.source as Record<string, unknown>), deliveryMethod }
		});
	});
}

function compactSource(overrides: Record<string, unknown> = {}): unknown {
	return {
		_id: 'k1000000000000000000000000000000',
		_creationTime: 1_800_000_000_000,
		slug: 'transit-funding',
		title: 'Fund the crosstown bus',
		description: 'The crosstown route has been cut twice this year.',
		domain: 'civic',
		topics: ['transit'],
		type: 'email',
		deliveryMethod: 'email',
		messageBody: 'Please restore the crosstown route.',
		preview: 'Please restore the crosstown route.',
		endorsementCount: 0,
		verifiedSends: 0,
		uniqueDistricts: 0,
		recipientCount: 0,
		districtCounts: [],
		districtCountsSuppressedDistricts: 0,
		districtCountsSuppressedCount: 0,
		status: 'published',
		isPublic: true,
		...overrides
	};
}

describe('the congressional-free feed reads the constrained column', () => {
	it('publishes every template to the open variant and only direct ones to the gated variant', async () => {
		const t = await activatedFeed();

		await t.mutation(internal.templates.rebuildHomepageSnapshots, {});

		expect(await publishedSlugs(t, 'all')).toEqual(ALL_SLUGS);
		expect(await publishedSlugs(t, 'excludeCwc')).toEqual(DIRECT_SLUGS);
	});

	it(
		'reaches a congressional-free template that a full window of congressional rows buried',
		async () => {
			const t = await crowdedFeed(SCAN_CAP);

			await t.mutation(internal.templates.rebuildHomepageSnapshots, {});

			// The newest-first scan is entirely congressional, so the gated variant
			// exists only because the isCwc index answered for the rows behind it.
			expect(await publishedSlugs(t, 'excludeCwc')).toEqual(['buried-direct']);
			expect(await publishedSlugs(t, 'all')).not.toContain('buried-direct');
		},
		120_000
	);

	it('keeps a congressional row out of the gated variant when its blob claims direct email', async () => {
		const t = await activatedFeed();
		await t.mutation(internal.templates.rebuildHomepageSnapshots, {});
		expect(await publishedSlugs(t, 'excludeCwc')).toEqual(DIRECT_SLUGS);

		// The row stays `isCwc: true`; only the unconstrained blob claims 'email'.
		await driftBlobDeliveryMethod(t, 'federal-rail-bill', 'email');

		await expect(t.mutation(internal.templates.rebuildHomepageSnapshots, {})).rejects.toThrow(
			'PUBLIC_DISCOVERY_SOURCE_INVALID:isCwc'
		);
		const gated = await publishedSlugs(t, 'excludeCwc');
		expect(gated).toEqual(DIRECT_SLUGS);
		expect(gated).not.toContain('federal-rail-bill');
	});

	it('refuses the opposite drift too, so the blob cannot pull a direct row out either', async () => {
		const t = await activatedFeed();
		await t.mutation(internal.templates.rebuildHomepageSnapshots, {});

		await driftBlobDeliveryMethod(t, 'transit-funding', 'cwc');

		await expect(t.mutation(internal.templates.rebuildHomepageSnapshots, {})).rejects.toThrow(
			'PUBLIC_DISCOVERY_SOURCE_INVALID:isCwc'
		);
		expect(await publishedSlugs(t, 'excludeCwc')).toEqual(DIRECT_SLUGS);
	});

	it('refuses a delivery method outside the stored vocabulary instead of reading it as not-congressional', async () => {
		const t = await activatedFeed();
		await t.mutation(internal.templates.rebuildHomepageSnapshots, {});

		await driftBlobDeliveryMethod(t, 'federal-water-act', 'certified');

		await expect(t.mutation(internal.templates.rebuildHomepageSnapshots, {})).rejects.toThrow(
			'PUBLIC_DISCOVERY_SOURCE_INVALID:shape'
		);
		expect(await publishedSlugs(t, 'excludeCwc')).not.toContain('federal-water-act');
	});
});

describe('the source-row read guard', () => {
	it('admits a delivery method by membership, not by type', () => {
		expect(() => assertCompactPublicTemplateSource(compactSource())).not.toThrow();
		expect(() =>
			assertCompactPublicTemplateSource(compactSource({ deliveryMethod: 'cwc' }))
		).not.toThrow();
		for (const outside of ['certified', 'direct', 'email_attested', 'mailto', '', 'CWC']) {
			expect(() =>
				assertCompactPublicTemplateSource(compactSource({ deliveryMethod: outside }))
			).toThrow('PUBLIC_DISCOVERY_SOURCE_INVALID:shape');
		}
	});

	it('refuses a blob that disagrees with its row classification', () => {
		expect(() =>
			assertCompactPublicTemplateSource(compactSource({ deliveryMethod: 'email' }), true)
		).toThrow('PUBLIC_DISCOVERY_SOURCE_INVALID:isCwc');
		expect(() =>
			assertCompactPublicTemplateSource(compactSource({ deliveryMethod: 'cwc' }), false)
		).toThrow('PUBLIC_DISCOVERY_SOURCE_INVALID:isCwc');
		expect(() =>
			assertCompactPublicTemplateSource(compactSource({ deliveryMethod: 'email' }), false)
		).not.toThrow();
		expect(() =>
			assertCompactPublicTemplateSource(compactSource({ deliveryMethod: 'cwc' }), true)
		).not.toThrow();
	});

	it('hands callers the constrained column as the congressional answer', () => {
		const congressional = readPublicTemplateDiscoveryCandidate({
			isCwc: true,
			source: compactSource({ deliveryMethod: 'cwc' }) as CompactPublicTemplateSource
		});
		expect(congressional.isCwc).toBe(true);

		const direct = readPublicTemplateDiscoveryCandidate({
			isCwc: false,
			source: compactSource() as CompactPublicTemplateSource
		});
		expect(direct.isCwc).toBe(false);
		expect(direct.source.slug).toBe('transit-funding');

		expect(() =>
			readPublicTemplateDiscoveryCandidate({
				isCwc: true,
				source: compactSource({ deliveryMethod: 'email' }) as CompactPublicTemplateSource
			})
		).toThrow('PUBLIC_DISCOVERY_SOURCE_INVALID:isCwc');
	});
});
