/// <reference types="vite/client" />

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { convexTest, type TestConvex } from 'convex-test';

import { api, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema from './schema';

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts']);
const SECRET = 'network-charter-test-secret-0123456789';
const NOW = Date.parse('2026-07-19T12:00:00.000Z');
type Harness = TestConvex<typeof schema>;

function organization(name: string, slug: string) {
	return {
		name,
		slug,
		maxSeats: 10,
		maxTemplatesMonth: 100,
		dmCacheTtlDays: 30,
		countryCode: 'US',
		isPublic: true,
		updatedAt: NOW
	};
}

async function readyPublicDirectory(t: Harness): Promise<void> {
	await t.run((ctx) =>
		ctx.db.insert('publicOrganizationDirectoryMigrations', {
			key: 'v1',
			status: 'ready',
			token: 'charter-directory-ready',
			scanComplete: true,
			scanned: 1,
			processed: 1,
			written: 1,
			rejected: 0,
			total: 1,
			updatedAt: NOW
		})
	);
}

async function insertPublicIdentity(
	t: Harness,
	orgId: Id<'organizations'>,
	name: string,
	slug: string
): Promise<void> {
	await t.run((ctx) =>
		ctx.db.insert('publicOrganizationDirectory', {
			orgId,
			name,
			slug,
			nameSort: name.toLowerCase(),
			supporterCount: 0,
			campaignCount: 0,
			memberCount: 1,
			updatedAt: NOW,
			version: 1
		})
	);
}

async function activateChartersWithoutLegacyRows(t: Harness): Promise<void> {
	let result = (await t.mutation(internal.networks.migrateNetworkCharters, {
		scheduleContinuation: false
	})) as { status: string; runToken: string };
	for (let attempt = 0; result.status === 'running' && attempt < 20; attempt += 1) {
		result = (await t.mutation(internal.networks.migrateNetworkCharters, {
			runToken: result.runToken,
			scheduleContinuation: false
		})) as { status: string; runToken: string };
	}
	expect(result.status).toBe('migrated');
	await expect(t.mutation(internal.networks.activateNetworkCharters, {})).resolves.toMatchObject({
		status: 'ready'
	});
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

describe('immutable public network charters', () => {
	it('freezes public identity and signatories in the publication transaction', async () => {
		const t = convexTest(schema, modules);
		await readyPublicDirectory(t);
		const tokenIdentifier = 'charter-publisher-token';
		const fixture = await t.run(async (ctx) => {
			const userId = await ctx.db.insert('users', {
				tokenIdentifier,
				email: 'publisher@example.test',
				updatedAt: NOW,
				isVerified: true,
				authorityLevel: 1,
				trustTier: 1,
				trustScore: 10,
				reputationTier: 'novice',
				districtVerified: false,
				templatesContributed: 0,
				templateAdoptionRate: 0,
				peerEndorsements: 0,
				activeMonths: 0,
				profileVisibility: 'private'
			});
			const orgId = await ctx.db.insert(
				'organizations',
				organization('Founding Assembly', 'founding-assembly')
			);
			await ctx.db.insert('orgMemberships', {
				userId,
				orgId,
				role: 'owner',
				joinedAt: NOW - 10
			});
			const networkId = await ctx.db.insert('orgNetworks', {
				name: 'Immutable Coalition',
				slug: 'immutable-coalition',
				ownerOrgId: orgId,
				status: 'active',
				applicableCountries: ['US'],
				coalitionMembershipRevision: 1,
				updatedAt: NOW
			});
			const networkMemberId = await ctx.db.insert('orgNetworkMembers', {
				networkId,
				orgId,
				role: 'admin',
				status: 'active',
				joinedAt: NOW - 1
			});
			return { orgId, networkId, networkMemberId };
		});
		await insertPublicIdentity(t, fixture.orgId, 'Founding Assembly', 'founding-assembly');
		const authenticated = t.withIdentity({
			subject: 'charter-publisher',
			issuer: 'https://issuer.example',
			tokenIdentifier,
			email: 'publisher@example.test'
		});
		await expect(
			authenticated.mutation(api.networks.publishCharter, {
				orgSlug: 'founding-assembly',
				networkId: fixture.networkId,
				mission: 'Coordinate durable civic proof.',
				principles: ['Evidence before assertion', 'Consent before publication'],
				charterText: 'This text is immutable after publication.',
				applicableCountries: ['US']
			})
		).resolves.toMatchObject({ charterPublishedAt: NOW });
		await activateChartersWithoutLegacyRows(t);
		const before = await t.query(api.networks.getPublicCharter, {
			_secret: SECRET,
			slug: 'immutable-coalition'
		});
		expect(before).toMatchObject({
			name: 'Immutable Coalition',
			ownerOrg: { name: 'Founding Assembly', slug: 'founding-assembly' },
			founders: [
				{
					orgName: 'Founding Assembly',
					orgSlug: 'founding-assembly',
					role: 'admin',
					joinedAt: NOW - 1
				}
			]
		});

		await t.run(async (ctx) => {
			await ctx.db.patch(fixture.orgId, { name: 'Renamed Live Org', updatedAt: NOW + 1 });
			const directory = await ctx.db
				.query('publicOrganizationDirectory')
				.withIndex('by_orgId', (q) => q.eq('orgId', fixture.orgId))
				.unique();
			if (!directory) throw new Error('directory fixture missing');
			await ctx.db.patch(directory._id, {
				name: 'Renamed Public Org',
				nameSort: 'renamed public org',
				updatedAt: NOW + 1
			});
			await ctx.db.patch(fixture.networkMemberId, {
				role: 'member',
				joinedAt: NOW + 1
			});
		});
		const after = await t.query(api.networks.getPublicCharter, {
			_secret: SECRET,
			slug: 'immutable-coalition'
		});
		expect(after).toEqual(before);
		await expect(
			authenticated.mutation(api.networks.publishCharter, {
				orgSlug: 'founding-assembly',
				networkId: fixture.networkId,
				mission: 'Rewrite attempt',
				principles: [],
				applicableCountries: ['US']
			})
		).rejects.toThrow();
	});

	it('migrates a published legacy charter durably and idempotently', async () => {
		const t = convexTest(schema, modules);
		await readyPublicDirectory(t);
		const fixture = await t.run(async (ctx) => {
			const orgId = await ctx.db.insert(
				'organizations',
				organization('Legacy Founder', 'legacy-founder')
			);
			const networkId = await ctx.db.insert('orgNetworks', {
				name: 'Legacy Charter',
				slug: 'legacy-charter',
				ownerOrgId: orgId,
				status: 'active',
				applicableCountries: ['US'],
				mission: 'Preserve legacy intent.',
				principles: ['Exact migration'],
				charterPublishedAt: NOW,
				updatedAt: NOW
			});
			await ctx.db.insert('orgNetworkMembers', {
				networkId,
				orgId,
				role: 'admin',
				status: 'active',
				// Legacy publishers could write both timestamps in the same
				// millisecond; publication-time membership is inclusive.
				joinedAt: NOW
			});
			return { orgId, networkId };
		});
		await insertPublicIdentity(t, fixture.orgId, 'Legacy Founder', 'legacy-founder');
		await activateChartersWithoutLegacyRows(t);
		await expect(
			t.query(api.networks.getPublicCharter, { _secret: SECRET, slug: 'legacy-charter' })
		).resolves.toMatchObject({
			name: 'Legacy Charter',
			mission: 'Preserve legacy intent.',
			founders: [{ orgSlug: 'legacy-founder' }]
		});
		await expect(
			t.mutation(internal.networks.migrateNetworkCharters, { scheduleContinuation: false })
		).resolves.toMatchObject({ status: 'already-ready' });
	});

	it('rejects oversized founder cohorts and invalid secrets before projection reads', async () => {
		const t = convexTest(schema, modules);
		await readyPublicDirectory(t);
		const tokenIdentifier = 'founder-limit-token';
		const fixture = await t.run(async (ctx) => {
			const userId = await ctx.db.insert('users', {
				tokenIdentifier,
				updatedAt: NOW,
				isVerified: true,
				authorityLevel: 1,
				trustTier: 1,
				trustScore: 1,
				reputationTier: 'novice',
				districtVerified: false,
				templatesContributed: 0,
				templateAdoptionRate: 0,
				peerEndorsements: 0,
				activeMonths: 0,
				profileVisibility: 'private'
			});
			const ownerOrgId = await ctx.db.insert(
				'organizations',
				organization('Limit Owner', 'limit-owner')
			);
			await ctx.db.insert('orgMemberships', {
				userId,
				orgId: ownerOrgId,
				role: 'owner',
				joinedAt: NOW - 2
			});
			const networkId = await ctx.db.insert('orgNetworks', {
				name: 'Founder Limit',
				slug: 'founder-limit',
				ownerOrgId,
				status: 'active',
				applicableCountries: ['US'],
				updatedAt: NOW
			});
			await ctx.db.insert('orgNetworkMembers', {
				networkId,
				orgId: ownerOrgId,
				role: 'admin',
				status: 'active',
				joinedAt: NOW - 1
			});
			for (let index = 0; index < 100; index += 1) {
				const orgId = await ctx.db.insert(
					'organizations',
					organization(`Founder ${index}`, `founder-${index}`)
				);
				await ctx.db.insert('orgNetworkMembers', {
					networkId,
					orgId,
					role: 'member',
					status: 'active',
					joinedAt: NOW - 1
				});
			}
			return { ownerOrgId, networkId };
		});
		await insertPublicIdentity(t, fixture.ownerOrgId, 'Limit Owner', 'limit-owner');
		const authenticated = t.withIdentity({
			subject: 'founder-limit',
			issuer: 'https://issuer.example',
			tokenIdentifier
		});
		await expect(
			authenticated.mutation(api.networks.publishCharter, {
				orgSlug: 'limit-owner',
				networkId: fixture.networkId,
				principles: [],
				applicableCountries: ['US']
			})
		).rejects.toThrow('NETWORK_CHARTER_FOUNDER_LIMIT_EXCEEDED');

		await t.run(async (ctx) => {
			for (let index = 0; index < 2; index += 1) {
				await ctx.db.insert('networkCharterMigrations', {
					key: 'v1',
					status: 'ready',
					runToken: `duplicate-${index}`,
					scanned: 0,
					projected: 0,
					startedAt: NOW,
					completedAt: NOW,
					updatedAt: NOW
				});
			}
		});
		await expect(
			t.query(api.networks.getPublicCharter, { _secret: 'wrong-secret', slug: 'founder-limit' })
		).rejects.toThrow('Unauthorized');
	});
});
