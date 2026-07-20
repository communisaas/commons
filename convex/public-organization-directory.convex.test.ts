/// <reference types="vite/client" />

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { convexTest, type TestConvex } from 'convex-test';

import { api, internal } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts']);
const SECRET = 'test-internal-secret-0123456789abcdef-pad';
const TOKEN = 'directory-migration-token-2026';
const NOW = Date.parse('2026-07-19T12:00:00.000Z');
type Harness = TestConvex<typeof schema>;

async function seedOrganization(t: Harness, name: string, isPublic: boolean): Promise<void> {
	await t.run(async (ctx) => {
		await ctx.db.insert('organizations', {
			name,
			slug: name.toLowerCase().replaceAll(' ', '-'),
			description: `${name} description`,
			mission: `${name} mission`,
			maxSeats: 5,
			maxTemplatesMonth: 10,
			dmCacheTtlDays: 30,
			countryCode: 'US',
			isPublic,
			memberCount: 2,
			updatedAt: NOW
		});
	});
}

async function seedAuthenticatedOrganization(
	t: Harness,
	role: 'owner' | 'editor' | 'member',
	suffix: string
) {
	const tokenIdentifier = `https://issuer.example|directory-${suffix}`;
	const email = `directory-${suffix}@example.test`;
	const { userId, orgId } = await t.run(async (ctx) => {
		const userId = await ctx.db.insert('users', {
			tokenIdentifier,
			email,
			updatedAt: NOW,
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
		});
		const orgId = await ctx.db.insert('organizations', {
			name: `Directory ${suffix}`,
			slug: `directory-${suffix}`,
			description: 'A publication boundary fixture',
			mission: 'Prove atomic publication and unpublication',
			maxSeats: 5,
			maxTemplatesMonth: 10,
			dmCacheTtlDays: 30,
			countryCode: 'US',
			isPublic: false,
			memberCount: 1,
			updatedAt: NOW
		});
		await ctx.db.insert('orgMemberships', {
			userId,
			orgId,
			role,
			joinedAt: NOW
		});
		return { userId, orgId };
	});
	return {
		userId,
		orgId,
		slug: `directory-${suffix}`,
		authenticated: t.withIdentity({
			subject: `directory-${suffix}`,
			issuer: 'https://issuer.example',
			tokenIdentifier,
			email
		})
	};
}

describe('public organization directory projection', () => {
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

	it('fails readiness closed until an operator completes and activates migration', async () => {
		const t = convexTest(schema, modules);
		await expect(
			t.query(api.organizations.listPublic, {
				_secret: SECRET,
				paginationOpts: { numItems: 20, cursor: null }
			})
		).resolves.toMatchObject({ ready: false, status: 'missing', data: [] });
	});

	it('pages only compact public rows in deterministic name order', async () => {
		const t = convexTest(schema, modules);
		await seedOrganization(t, 'Zulu Union', true);
		await seedOrganization(t, 'Private Council', false);
		await seedOrganization(t, 'Alpha Assembly', true);

		await expect(
			t.mutation(internal.organizations.migratePublicOrganizationDirectory, {
				token: TOKEN,
				cursor: null
			})
		).resolves.toMatchObject({ scanComplete: true, total: 2 });
		await expect(
			t.mutation(internal.organizations.activatePublicOrganizationDirectory, { token: TOKEN })
		).resolves.toMatchObject({ status: 'ready', total: 2 });

		const first = await t.query(api.organizations.listPublic, {
			_secret: SECRET,
			paginationOpts: { numItems: 1, cursor: null }
		});
		expect(first).toMatchObject({
			ready: true,
			hasMore: true,
			total: 2,
			data: [{ name: 'Alpha Assembly', memberCount: 2 }]
		});
		expect(first.cursor).toEqual(expect.any(String));

		const second = await t.query(api.organizations.listPublic, {
			_secret: SECRET,
			paginationOpts: { numItems: 1, cursor: first.cursor }
		});
		expect(second).toMatchObject({
			ready: true,
			hasMore: false,
			total: 2,
			cursor: null,
			data: [{ name: 'Zulu Union', memberCount: 2 }]
		});
		expect(JSON.stringify([...first.data, ...second.data])).not.toContain('Private Council');
	});

	it('rejects invalid secrets and oversized cursors before projection reads', async () => {
		const t = convexTest(schema, modules);
		await expect(
			t.query(api.organizations.listPublic, {
				_secret: 'wrong',
				paginationOpts: { numItems: 20, cursor: null }
			})
		).rejects.toThrow();
		await expect(
			t.query(api.organizations.listPublic, {
				_secret: SECRET,
				paginationOpts: { numItems: 20, cursor: 'x'.repeat(2_049) }
			})
		).rejects.toThrow('PUBLIC_ORGANIZATION_DIRECTORY_CURSOR_TOO_LARGE');
	});

	it('publishes and unpublishes the canonical organization and compact projection atomically', async () => {
		const t = convexTest(schema, modules);
		const fixture = await seedAuthenticatedOrganization(t, 'editor', 'editor');
		await t.mutation(internal.organizations.migratePublicOrganizationDirectory, {
			token: TOKEN,
			cursor: null
		});
		await t.mutation(internal.organizations.activatePublicOrganizationDirectory, { token: TOKEN });

		await expect(
			fixture.authenticated.mutation(api.organizations.setPublicDirectoryVisibility, {
				slug: fixture.slug,
				isPublic: true
			})
		).resolves.toEqual({ orgId: fixture.orgId, isPublic: true });

		await expect(
			t.run(async (ctx) => {
				const org = await ctx.db.get(fixture.orgId);
				const projection = await ctx.db
					.query('publicOrganizationDirectory')
					.withIndex('by_orgId', (q) => q.eq('orgId', fixture.orgId))
					.unique();
				const migration = await ctx.db
					.query('publicOrganizationDirectoryMigrations')
					.withIndex('by_key', (q) => q.eq('key', 'v1'))
					.unique();
				return {
					isPublic: org?.isPublic,
					publicDirectoryVersion: org?.publicDirectoryVersion,
					projectionOrgId: projection?.orgId,
					total: migration?.total
				};
			})
		).resolves.toEqual({
			isPublic: true,
			publicDirectoryVersion: 1,
			projectionOrgId: fixture.orgId,
			total: 1
		});

		await expect(
			fixture.authenticated.mutation(api.organizations.setPublicDirectoryVisibility, {
				slug: fixture.slug,
				isPublic: false
			})
		).resolves.toEqual({ orgId: fixture.orgId, isPublic: false });
		await expect(
			t.run(async (ctx) => {
				const org = await ctx.db.get(fixture.orgId);
				const projection = await ctx.db
					.query('publicOrganizationDirectory')
					.withIndex('by_orgId', (q) => q.eq('orgId', fixture.orgId))
					.unique();
				const migration = await ctx.db
					.query('publicOrganizationDirectoryMigrations')
					.withIndex('by_key', (q) => q.eq('key', 'v1'))
					.unique();
				return { isPublic: org?.isPublic, projection: projection ?? null, total: migration?.total };
			})
		).resolves.toEqual({ isPublic: false, projection: null, total: 0 });
	});

	it('rejects member publication attempts without changing canonical or projected visibility', async () => {
		const t = convexTest(schema, modules);
		const fixture = await seedAuthenticatedOrganization(t, 'member', 'member');
		await t.mutation(internal.organizations.migratePublicOrganizationDirectory, {
			token: TOKEN,
			cursor: null
		});
		await t.mutation(internal.organizations.activatePublicOrganizationDirectory, { token: TOKEN });

		await expect(
			fixture.authenticated.mutation(api.organizations.setPublicDirectoryVisibility, {
				slug: fixture.slug,
				isPublic: true
			})
		).rejects.toThrow('Requires editor role or higher');
		await expect(
			t.run(async (ctx) => {
				const org = await ctx.db.get(fixture.orgId);
				const projection = await ctx.db
					.query('publicOrganizationDirectory')
					.withIndex('by_orgId', (q) => q.eq('orgId', fixture.orgId))
					.unique();
				return { isPublic: org?.isPublic, projection: projection ?? null };
			})
		).resolves.toEqual({ isPublic: false, projection: null });
	});
});
