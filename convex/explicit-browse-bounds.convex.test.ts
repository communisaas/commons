/// <reference types="vite/client" />

import { describe, expect, it } from 'vitest';
import { convexTest, type TestConvex } from 'convex-test';

import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema from './schema';

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts']);
const TOKEN = 'https://issuer.example|explicit-browse-bounds';
const NOW = Date.parse('2026-07-19T12:00:00.000Z');
type Harness = TestConvex<typeof schema>;

async function seedOrg(t: Harness) {
	return t.run(async (ctx) => {
		const userId = await ctx.db.insert('users', {
			tokenIdentifier: TOKEN,
			email: 'browse-bounds@example.test',
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
		const orgId = await ctx.db.insert('organizations', {
			name: 'Explicit Browse Bounds',
			slug: 'explicit-browse-bounds',
			maxSeats: 10,
			maxTemplatesMonth: 100,
			dmCacheTtlDays: 30,
			countryCode: 'US',
			isPublic: true,
			memberCount: 1,
			updatedAt: NOW
		});
		await ctx.db.insert('orgMemberships', { userId, orgId, role: 'owner', joinedAt: NOW });
		await ctx.db.insert('publicOrganizationDirectory', {
			orgId,
			slug: 'explicit-browse-bounds',
			name: 'Explicit Browse Bounds',
			nameSort: 'explicit browse bounds',
			supporterCount: 0,
			campaignCount: 0,
			memberCount: 1,
			updatedAt: NOW,
			version: 1
		});
		return { orgId };
	});
}

async function insertReadyAccountability(t: Harness): Promise<void> {
	await t.run((ctx) =>
		ctx.db.insert('accountabilityReadModelMigrations', {
			key: 'v1',
			status: 'ready',
			runToken: 'explicit-browse-ready',
			phase: 'complete',
			scanComplete: true,
			scanned: 0,
			projected: 0,
			userProjected: 0,
			startedAt: NOW,
			completedAt: NOW,
			updatedAt: NOW
		})
	);
}

async function insertFollowProjection(
	t: Harness,
	orgId: Id<'organizations'>,
	index: number
): Promise<Id<'decisionMakers'>> {
	return t.run(async (ctx) => {
		const decisionMakerId = await ctx.db.insert('decisionMakers', {
			type: 'legislator',
			name: `Representative ${String(index).padStart(3, '0')}`,
			lastName: `Representative-${String(index).padStart(3, '0')}`,
			active: true,
			updatedAt: NOW + index
		});
		await ctx.db.insert('orgDmFollows', {
			orgId,
			decisionMakerId,
			reason: 'manual',
			alertsEnabled: true,
			followedAt: NOW + index
		});
		await ctx.db.insert('accountabilityOrgDmProjections', {
			orgId,
			decisionMakerId,
			name: `Representative ${String(index).padStart(3, '0')}`,
			type: 'legislator',
			followed: true,
			followReason: 'manual',
			alertsEnabled: true,
			followedAt: NOW + index,
			receiptCount: 0,
			alignedCount: 0,
			opposedCount: 0,
			pendingCount: 0,
			responseLoggedCount: 0,
			anchorFieldCount: 0,
			proofWeightTotal: 0,
			version: 1,
			projectionBytes: 512,
			updatedAt: NOW + index
		});
		return decisionMakerId;
	});
}

describe('explicit decision-maker browse bounds', () => {
	it('requires an indexed representative scope and pages constituency matches opaquely', async () => {
		const t = convexTest({ schema, modules });
		await seedOrg(t);
		for (let start = 0; start < 65; start += 25) {
			await t.run(async (ctx) => {
				for (let index = start; index < Math.min(65, start + 25); index += 1) {
					const decisionMakerId = await ctx.db.insert('decisionMakers', {
						type: 'legislator',
						name: `District Representative ${index}`,
						lastName: `Representative-${String(index).padStart(3, '0')}`,
						jurisdiction: 'US',
						jurisdictionLevel: 'international',
						district: 'District One',
						active: true,
						updatedAt: NOW + index
					});
					await ctx.db.insert('externalIds', {
						decisionMakerId,
						system: 'constituency',
						value: 'district-1'
					});
				}
			});
		}
		const authenticated = t.withIdentity({ tokenIdentifier: TOKEN });
		await expect(
			authenticated.query(api.legislation.listRepresentatives, {
				slug: 'explicit-browse-bounds'
			})
		).rejects.toThrow('REPRESENTATIVE_BROWSE_SCOPE_REQUIRED');
		await expect(
			authenticated.query(api.legislation.listRepresentatives, {
				slug: 'explicit-browse-bounds',
				country: 'US',
				limit: -1
			})
		).rejects.toThrow('REPRESENTATIVE_PAGE_SIZE_INVALID');

		const first = await authenticated.query(api.legislation.listRepresentatives, {
			slug: 'explicit-browse-bounds',
			constituency: 'district-1',
			limit: 25
		});
		expect(first.data).toHaveLength(25);
		expect(first.hasMore).toBe(true);
		expect(first.cursor).toEqual(expect.any(String));
		const second = await authenticated.query(api.legislation.listRepresentatives, {
			slug: 'explicit-browse-bounds',
			constituency: 'district-1',
			limit: 25,
			cursor: first.cursor
		});
		expect(second.data).toHaveLength(25);
		expect(new Set([...first.data, ...second.data].map((row) => row._id)).size).toBe(50);
	});

	it('retires the unused public bill browse surface before database I/O', async () => {
		const t = convexTest({ schema, modules });
		await expect(
			t.query(api.legislation.listBills, {
				jurisdiction: 'us-federal',
				limit: 10_000
			})
		).rejects.toThrow('LEGISLATION_PUBLIC_BILL_LIST_RETIRED');
	});

	it('uses opaque continuation over the compact follow plane', async () => {
		const t = convexTest({ schema, modules });
		const { orgId } = await seedOrg(t);
		await insertReadyAccountability(t);
		for (let index = 0; index < 60; index += 1) await insertFollowProjection(t, orgId, index);
		const authenticated = t.withIdentity({ tokenIdentifier: TOKEN });

		const first = await authenticated.query(api.legislation.listOrgDmFollows, {
			slug: 'explicit-browse-bounds',
			limit: 20
		});
		expect(first.followed).toHaveLength(20);
		expect(first.followedCount).toBe(60);
		expect(first.hasMore).toBe(true);
		expect(first.nextCursor).toEqual(expect.any(String));

		const second = await authenticated.query(api.legislation.listOrgDmFollows, {
			slug: 'explicit-browse-bounds',
			limit: 20,
			cursor: first.nextCursor ?? undefined
		});
		expect(second.followed).toHaveLength(20);
		expect(new Set([...first.followed, ...second.followed].map((row) => row._id)).size).toBe(40);
	});

	it('rejects oversized calls and serializes creation behind a 100-follow cap', async () => {
		const t = convexTest({ schema, modules });
		const { orgId } = await seedOrg(t);
		await insertReadyAccountability(t);
		for (let index = 0; index < 100; index += 1) await insertFollowProjection(t, orgId, index);
		const newDecisionMakerId = await t.run((ctx) =>
			ctx.db.insert('decisionMakers', {
				type: 'legislator',
				name: 'Representative Overflow',
				lastName: 'Overflow',
				active: true,
				updatedAt: NOW
			})
		);
		const authenticated = t.withIdentity({ tokenIdentifier: TOKEN });
		await expect(
			authenticated.query(api.legislation.listOrgDmFollows, {
				slug: 'explicit-browse-bounds',
				limit: 10_000
			})
		).rejects.toThrow('ACCOUNTABILITY_PAGE_SIZE_INVALID:browse');
		await expect(
			authenticated.query(api.legislation.discoverDms, {
				slug: 'explicit-browse-bounds',
				limit: 10_000
			})
		).rejects.toThrow('DM_DISCOVERY_PAGE_SIZE_INVALID');
		await expect(
			authenticated.mutation(api.legislation.followDm, {
				slug: 'explicit-browse-bounds',
				decisionMakerId: newDecisionMakerId
			})
		).rejects.toThrow('ORG_DM_FOLLOW_LIMIT_EXCEEDED');
	});
});

describe('explicit coalition browse bounds', () => {
	it('tombstones the unpaged two-status roster before any database fan-out', async () => {
		const t = convexTest({
			schema,
			modules,
			transactionLimits: { documentsRead: 0, databaseQueries: 0, bytesRead: 0 }
		});
		const { orgId } = await seedOrg(t);
		const networkId = await t.run((ctx) =>
			ctx.db.insert('orgNetworks', {
				name: 'Tombstoned Coalition',
				slug: 'tombstoned-coalition',
				ownerOrgId: orgId,
				status: 'active',
				applicableCountries: ['US'],
				updatedAt: NOW
			})
		);
		await expect(
			t.withIdentity({ tokenIdentifier: TOKEN }).query(api.networks.getMembers, {
				orgSlug: 'explicit-browse-bounds',
				networkId
			})
		).rejects.toThrow('NETWORK_GET_MEMBERS_REMOVED_USE_PAGINATED_GET');
	});

	it('cannot re-enter pending from removed after the target org pending cap', async () => {
		const t = convexTest({ schema, modules });
		const { orgId } = await seedOrg(t);
		const { targetOrgId, networkId } = await t.run(async (ctx) => {
			const targetOrgId = await ctx.db.insert('organizations', {
				name: 'Pending Target',
				slug: 'pending-target',
				maxSeats: 1,
				maxTemplatesMonth: 1,
				dmCacheTtlDays: 30,
				countryCode: 'US',
				isPublic: false,
				updatedAt: NOW
			});
			const networkId = await ctx.db.insert('orgNetworks', {
				name: 'Admission Coalition',
				slug: 'admission-coalition',
				ownerOrgId: orgId,
				status: 'active',
				applicableCountries: ['US'],
				updatedAt: NOW
			});
			await ctx.db.insert('orgNetworkMembers', {
				networkId,
				orgId,
				role: 'admin',
				status: 'active',
				joinedAt: NOW
			});
			await ctx.db.insert('orgNetworkMembers', {
				networkId,
				orgId: targetOrgId,
				role: 'member',
				status: 'removed',
				joinedAt: NOW
			});
			for (let index = 0; index < 8; index += 1) {
				const pendingNetworkId = await ctx.db.insert('orgNetworks', {
					name: `Pending Coalition ${index}`,
					slug: `pending-coalition-${index}`,
					ownerOrgId: orgId,
					status: 'active',
					applicableCountries: ['US'],
					updatedAt: NOW
				});
				await ctx.db.insert('orgNetworkMembers', {
					networkId: pendingNetworkId,
					orgId: targetOrgId,
					role: 'member',
					status: 'pending',
					joinedAt: NOW + index
				});
			}
			return { targetOrgId, networkId };
		});

		await expect(
			t.withIdentity({ tokenIdentifier: TOKEN }).mutation(api.networks.updateMemberStatus, {
				orgSlug: 'explicit-browse-bounds',
				networkId,
				targetOrgId,
				status: 'pending'
			})
		).rejects.toThrow('COALITION_ORG_PENDING_NETWORK_LIMIT_EXCEEDED');
	});

	it('pages a 60-member roster without rereading the first 50', async () => {
		const t = convexTest({ schema, modules });
		const { orgId } = await seedOrg(t);
		const networkId = await t.run(async (ctx) => {
			const id = await ctx.db.insert('orgNetworks', {
				name: 'Paged Coalition',
				slug: 'paged-coalition',
				ownerOrgId: orgId,
				status: 'active',
				applicableCountries: ['US'],
				coalitionMembershipRevision: 1,
				activeMemberCount: 60,
				updatedAt: NOW
			});
			await ctx.db.insert('orgNetworkMembers', {
				networkId: id,
				orgId,
				role: 'admin',
				status: 'active',
				joinedAt: NOW
			});
			return id;
		});
		for (let index = 1; index < 60; index += 1) {
			await t.run(async (ctx) => {
				const memberOrgId = await ctx.db.insert('organizations', {
					name: `Member ${index}`,
					slug: `member-${index}`,
					maxSeats: 1,
					maxTemplatesMonth: 1,
					dmCacheTtlDays: 30,
					countryCode: 'US',
					isPublic: true,
					updatedAt: NOW
				});
				await ctx.db.insert('publicOrganizationDirectory', {
					orgId: memberOrgId,
					slug: `member-${index}`,
					name: `Member ${index}`,
					nameSort: `member ${String(index).padStart(3, '0')}`,
					supporterCount: 0,
					campaignCount: 0,
					memberCount: 1,
					updatedAt: NOW,
					version: 1
				});
				await ctx.db.insert('orgNetworkMembers', {
					networkId,
					orgId: memberOrgId,
					role: 'member',
					status: 'active',
					joinedAt: NOW + index
				});
			});
		}
		const authenticated = t.withIdentity({ tokenIdentifier: TOKEN });
		const first = await authenticated.query(api.networks.get, {
			orgSlug: 'explicit-browse-bounds',
			networkId,
			memberLimit: 50
		});
		expect(first.members).toHaveLength(50);
		expect(first.memberCount).toBe(60);
		expect(first.membersHasMore).toBe(true);

		const second = await authenticated.query(api.networks.get, {
			orgSlug: 'explicit-browse-bounds',
			networkId,
			memberLimit: 50,
			memberCursor: first.memberNextCursor ?? undefined
		});
		expect(second.members).toHaveLength(10);
		expect(second.membersHasMore).toBe(false);
		expect(new Set([...first.members, ...second.members].map((row) => row._id)).size).toBe(60);
	});

	it('ignores unbounded removed history and reads the compact member count', async () => {
		const t = convexTest({
			schema,
			modules,
			transactionLimits: { documentsRead: 12, databaseQueries: 12, bytesRead: 64 * 1024 }
		});
		const { orgId } = await seedOrg(t);
		const networkId = await t.run(async (ctx) => {
			const id = await ctx.db.insert('orgNetworks', {
				name: 'Bounded Coalition',
				slug: 'bounded-coalition',
				ownerOrgId: orgId,
				status: 'active',
				applicableCountries: ['US'],
				coalitionMembershipRevision: 1,
				activeMemberCount: 1,
				updatedAt: NOW
			});
			await ctx.db.insert('orgNetworkMembers', {
				networkId: id,
				orgId,
				role: 'admin',
				status: 'active',
				joinedAt: NOW
			});
			return id;
		});
		for (let start = 0; start < 1_000; start += 100) {
			await t.run(async (ctx) => {
				for (let index = start; index < start + 100; index += 1) {
					await ctx.db.insert('orgNetworkMembers', {
						networkId,
						orgId,
						role: 'member',
						status: 'removed',
						joinedAt: NOW + index
					});
				}
			});
		}

		const result = await t
			.withIdentity({ tokenIdentifier: TOKEN })
			.query(api.networks.list, { orgSlug: 'explicit-browse-bounds' });
		expect(result).toHaveLength(1);
		expect(result[0]).toMatchObject({ memberCount: 1, memberStatus: 'active' });
	});
});
