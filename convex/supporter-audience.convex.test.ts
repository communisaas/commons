/// <reference types="vite/client" />

import { describe, expect, it } from 'vitest';
import { convexTest, type TestConvex } from 'convex-test';

import { api, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema from './schema';
import { applyProjectedAudienceMembership } from './_emailRecipientFilter';
import { SUPPORTER_BROWSE_MIGRATION_KEY, SUPPORTER_BROWSE_VERSION } from './lib/supporterBrowse';
import {
	applySupporterAudienceActionTransition,
	detachSupporterAudienceProjection,
	SUPPORTER_AUDIENCE_ACTION_VERSION
} from './lib/supporterAudience';

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts']);
type Harness = TestConvex<typeof schema>;
const NOW = Date.parse('2026-07-19T12:00:00.000Z');

function campaignValue(orgId: Id<'organizations'>, title: string) {
	return {
		orgId,
		type: 'LETTER' as const,
		title,
		status: 'ACTIVE' as const,
		debateEnabled: false,
		debateThreshold: 50,
		raisedAmountCents: 0,
		donorCount: 0,
		targetCountry: 'US',
		actionCount: 0,
		verifiedActionCount: 0,
		updatedAt: NOW
	};
}

function supporterValue(orgId: Id<'organizations'>, index: number) {
	return {
		orgId,
		encryptedEmail: `cipher-${index}`,
		emailHash: `${String(index).padStart(64, '0')}`,
		verified: true,
		emailStatus: 'subscribed',
		smsStatus: 'subscribed',
		encryptedPhone: `phone-cipher-${index}`,
		browseSource: 'organic',
		browseTagIds: [] as Array<Id<'tags'>>,
		supporterBrowseVersion: SUPPORTER_BROWSE_VERSION,
		updatedAt: NOW + index
	};
}

async function editorFixture(t: Harness, slug: string) {
	const tokenIdentifier = `https://issuer.example|${slug}`;
	const value = await t.run(async (ctx) => {
		const userId = await ctx.db.insert('users', {
			tokenIdentifier,
			email: `${slug}@example.test`,
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
			name: slug,
			slug,
			maxSeats: 5,
			maxTemplatesMonth: 10,
			dmCacheTtlDays: 30,
			countryCode: 'US',
			isPublic: false,
			supporterCount: 0,
			districtVerifiedSupporterCount: 0,
			smsSentCount: 0,
			updatedAt: NOW
		});
		await ctx.db.insert('orgMemberships', {
			userId,
			orgId,
			role: 'editor',
			joinedAt: NOW
		});
		return { userId, orgId };
	});
	return {
		...value,
		slug,
		editor: t.withIdentity({
			subject: slug,
			issuer: 'https://issuer.example',
			tokenIdentifier
		})
	};
}

describe('supporter audience action projection', () => {
	it('migrates exact action dimensions and preserves multiplicity on delete', async () => {
		const t = convexTest(schema, modules);
		const fixture = await editorFixture(t, 'audience-actions');
		const ids = await t.run(async (ctx) => {
			const supporterA = await ctx.db.insert('supporters', supporterValue(fixture.orgId, 1));
			const supporterB = await ctx.db.insert('supporters', supporterValue(fixture.orgId, 2));
			const campaignA = await ctx.db.insert('campaigns', campaignValue(fixture.orgId, 'A'));
			const campaignB = await ctx.db.insert('campaigns', campaignValue(fixture.orgId, 'B'));
			const actionA = await ctx.db.insert('campaignActions', {
				campaignId: campaignA,
				orgId: fixture.orgId,
				supporterId: supporterA,
				verified: true,
				engagementTier: 3,
				districtHash: 'district-shared',
				districtCode: 'CA-11',
				delegated: false,
				sentAt: NOW
			});
			const actionB = await ctx.db.insert('campaignActions', {
				campaignId: campaignB,
				orgId: fixture.orgId,
				supporterId: supporterA,
				verified: true,
				engagementTier: 2,
				districtHash: 'district-shared',
				districtCode: 'CA-11',
				delegated: false,
				sentAt: NOW + 1
			});
			await ctx.db.insert('supporterBrowseMigrations', {
				key: SUPPORTER_BROWSE_MIGRATION_KEY,
				status: 'ready',
				runToken: 'audience-test-ready',
				phase: 'complete',
				scanned: 2,
				projected: 2,
				startedAt: NOW,
				completedAt: NOW,
				updatedAt: NOW
			});
			const segmentId = await ctx.db.insert('segments', {
				orgId: fixture.orgId,
				name: 'Campaign A participants',
				filters: {
					logic: 'AND',
					conditions: [
						{
							id: 'campaign-a',
							field: 'campaignParticipation',
							operator: 'participated',
							value: campaignA
						}
					]
				},
				createdBy: fixture.userId,
				updatedAt: NOW
			});
			return { supporterA, supporterB, campaignA, campaignB, actionA, actionB, segmentId };
		});

		await expect(
			t.mutation(internal.supporterAudience.migratePage, {
				restart: true,
				scheduleContinuation: false
			})
		).resolves.toMatchObject({ status: 'migrated', scanned: 2, projected: 2 });
		await expect(t.mutation(internal.supporterAudience.activate, {})).resolves.toMatchObject({
			status: 'ready',
			scanned: 2
		});

		const projected = await t.run(async (ctx) => {
			const supporterA = await ctx.db.get(ids.supporterA);
			const supporterB = await ctx.db.get(ids.supporterB);
			if (!supporterA || !supporterB) throw new Error('fixture missing');
			const matched = await applyProjectedAudienceMembership(
				ctx,
				fixture.orgId,
				[supporterA, supporterB],
				{ segmentIds: [ids.segmentId] }
			);
			const district = await ctx.db
				.query('supporterAudienceActionDimensions')
				.withIndex('by_supporter_kind_value', (q) =>
					q
						.eq('supporterId', ids.supporterA)
						.eq('kind', 'district_hash')
						.eq('value', 'district-shared')
				)
				.unique();
			const verifiedDistrict = await ctx.db
				.query('supporterAudienceActionDimensions')
				.withIndex('by_supporter_kind_value', (q) =>
					q
						.eq('supporterId', ids.supporterA)
						.eq('kind', 'verified_district_supporter')
						.eq('value', 'eligible')
				)
				.unique();
			const org = await ctx.db.get(fixture.orgId);
			return {
				supporterA,
				matchedIds: matched.map((row) => row._id),
				district,
				verifiedDistrict,
				org
			};
		});
		expect(projected.supporterA).toMatchObject({
			audienceActionProjectionVersion: SUPPORTER_AUDIENCE_ACTION_VERSION,
			audienceCampaignIds: [ids.campaignA, ids.campaignB],
			audienceDistrictHashes: ['district-shared'],
			audienceDistrictCodes: ['CA-11'],
			audienceMaxEngagementTier: 3
		});
		expect(projected.district?.count).toBe(2);
		expect(projected.verifiedDistrict?.count).toBe(2);
		expect(projected.org?.districtVerifiedSupporterCount).toBe(1);
		expect(projected.matchedIds).toEqual([ids.supporterA]);
		await expect(
			fixture.editor.query(api.supporters.getDistrictVerifiedCount, { orgSlug: fixture.slug })
		).resolves.toEqual({ districtVerified: 1, truncated: false, scanLimit: 0 });

		await t.run(async (ctx) => {
			const action = await ctx.db.get(ids.actionA);
			if (!action) throw new Error('action missing');
			await applySupporterAudienceActionTransition(ctx, action, null);
			await ctx.db.delete(action._id);
		});
		await t.run(async (ctx) => {
			const supporter = await ctx.db.get(ids.supporterA);
			const district = await ctx.db
				.query('supporterAudienceActionDimensions')
				.withIndex('by_supporter_kind_value', (q) =>
					q
						.eq('supporterId', ids.supporterA)
						.eq('kind', 'district_hash')
						.eq('value', 'district-shared')
				)
				.unique();
			const verifiedDistrict = await ctx.db
				.query('supporterAudienceActionDimensions')
				.withIndex('by_supporter_kind_value', (q) =>
					q
						.eq('supporterId', ids.supporterA)
						.eq('kind', 'verified_district_supporter')
						.eq('value', 'eligible')
				)
				.unique();
			const org = await ctx.db.get(fixture.orgId);
			expect(supporter?.audienceCampaignIds).toEqual([ids.campaignB]);
			expect(supporter?.audienceDistrictHashes).toEqual(['district-shared']);
			expect(district?.count).toBe(1);
			expect(verifiedDistrict?.count).toBe(1);
			expect(org?.districtVerifiedSupporterCount).toBe(1);
		});

		await t.run(async (ctx) => {
			const action = await ctx.db.get(ids.actionB);
			if (!action) throw new Error('action missing');
			await applySupporterAudienceActionTransition(ctx, action, null);
			await ctx.db.delete(action._id);
		});
		await expect(
			fixture.editor.query(api.supporters.getDistrictVerifiedCount, { orgSlug: fixture.slug })
		).resolves.toEqual({ districtVerified: 0, truncated: false, scanLimit: 0 });
	});

	it('adopts a v1 action by adding only the new exact marker', async () => {
		const t = convexTest(schema, modules);
		const fixture = await editorFixture(t, 'audience-v1-adoption');
		const ids = await t.run(async (ctx) => {
			await ctx.db.insert('supporterAudienceActionMigrations', {
				key: 'supporter-audience-actions-v1',
				status: 'ready',
				scanned: 1,
				projected: 1,
				startedAt: NOW - 2,
				completedAt: NOW - 1,
				updatedAt: NOW - 1
			});
			const supporterId = await ctx.db.insert('supporters', {
				...supporterValue(fixture.orgId, 1),
				audienceCampaignIds: [] as Array<Id<'campaigns'>>,
				audienceDistrictHashes: ['legacy-district'],
				audienceDistrictCodes: ['NY-01'],
				audienceMaxEngagementTier: 2,
				audienceActionProjectionVersion: 1
			});
			const campaignId = await ctx.db.insert('campaigns', campaignValue(fixture.orgId, 'Legacy'));
			await ctx.db.patch(supporterId, { audienceCampaignIds: [campaignId] });
			const actionId = await ctx.db.insert('campaignActions', {
				campaignId,
				orgId: fixture.orgId,
				supporterId,
				verified: true,
				engagementTier: 2,
				districtHash: 'legacy-district',
				districtCode: 'NY-01',
				delegated: false,
				audienceActionProjectionVersion: 1,
				sentAt: NOW
			});
			for (const [kind, value] of [
				['campaign', String(campaignId)],
				['district_hash', 'legacy-district'],
				['district_code', 'NY-01'],
				['engagement_tier', '2']
			] as const) {
				await ctx.db.insert('supporterAudienceActionDimensions', {
					orgId: fixture.orgId,
					supporterId,
					kind,
					value,
					count: 1,
					updatedAt: NOW
				});
			}
			return { supporterId, campaignId, actionId };
		});

		await t.mutation(internal.supporterAudience.migratePage, {
			restart: true,
			scheduleContinuation: false
		});
		await t.mutation(internal.supporterAudience.activate, {});

		const state = await t.run(async (ctx) => {
			const action = await ctx.db.get(ids.actionId);
			const campaignDimension = await ctx.db
				.query('supporterAudienceActionDimensions')
				.withIndex('by_supporter_kind_value', (q) =>
					q
						.eq('supporterId', ids.supporterId)
						.eq('kind', 'campaign')
						.eq('value', String(ids.campaignId))
				)
				.unique();
			const marker = await ctx.db
				.query('supporterAudienceActionDimensions')
				.withIndex('by_supporter_kind_value', (q) =>
					q
						.eq('supporterId', ids.supporterId)
						.eq('kind', 'verified_district_supporter')
						.eq('value', 'eligible')
				)
				.unique();
			const org = await ctx.db.get(fixture.orgId);
			return { action, campaignDimension, marker, org };
		});
		expect(state.action?.audienceActionProjectionVersion).toBe(SUPPORTER_AUDIENCE_ACTION_VERSION);
		expect(state.campaignDimension?.count).toBe(1);
		expect(state.marker?.count).toBe(1);
		expect(state.org?.districtVerifiedSupporterCount).toBe(1);
		await expect(
			fixture.editor.query(api.supporters.getDistrictVerifiedCount, { orgSlug: fixture.slug })
		).resolves.toEqual({ districtVerified: 1, truncated: false, scanLimit: 0 });
		await t.run(async (ctx) => {
			await detachSupporterAudienceProjection(ctx, {
				orgId: fixture.orgId,
				supporterId: ids.supporterId
			});
			await ctx.db.delete(ids.supporterId);
		});
		await expect(
			fixture.editor.query(api.supporters.getDistrictVerifiedCount, { orgSlug: fixture.slug })
		).resolves.toEqual({ districtVerified: 0, truncated: false, scanLimit: 0 });
	});
});

describe('SMS dispatch launch gate', () => {
	it('keeps every direct Convex carrier authority fail-closed', async () => {
		const t = convexTest(schema, modules);
		const fixture = await editorFixture(t, 'sms-gated');
		const supporterId = await t.run(async (ctx) => {
			return await ctx.db.insert('supporters', supporterValue(fixture.orgId, 1));
		});
		const blast = await fixture.editor.mutation(api.sms.createBlast, {
			slug: fixture.slug,
			body: 'Held dispatch',
			fromNumber: '+15555550100',
			totalRecipients: 1
		});

		await expect(
			fixture.editor.query(api.sms.getEncryptedRecipientsForBlast, {
				slug: fixture.slug,
				blastId: blast._id
			})
		).rejects.toThrow('AUDIENCE_DISPATCH_JOBS_NOT_READY');
		await expect(
			fixture.editor.mutation(api.sms.advanceEmptyDispatchPage, {
				slug: fixture.slug,
				blastId: blast._id,
				pageCursor: null,
				expectedTotalRecipients: 1
			})
		).rejects.toThrow('AUDIENCE_DISPATCH_JOBS_NOT_READY');
		await expect(
			fixture.editor.mutation(api.sms.recordDispatchBatch, {
				slug: fixture.slug,
				blastId: blast._id,
				pageCursor: null,
				expectedTotalRecipients: 1,
				finalBatch: true,
				results: [{ supporterId, status: 'sent' }]
			})
		).rejects.toThrow('AUDIENCE_DISPATCH_JOBS_NOT_READY');
		await t.run(async (ctx) => {
			const org = await ctx.db.get(fixture.orgId);
			const messages = await ctx.db
				.query('smsMessages')
				.withIndex('by_blastId', (q) => q.eq('blastId', blast._id))
				.collect();
			expect(org?.smsSentCount).toBe(0);
			expect(messages).toEqual([]);
		});
	});
});

describe('email dispatch launch gate', () => {
	it('keeps public, scheduled, enclave, and server-worker carrier authority fail-closed', async () => {
		const t = convexTest(schema, modules);
		const fixture = await editorFixture(t, 'email-gated');
		const { id: blastId } = await fixture.editor.mutation(api.email.createBlast, {
			orgSlug: fixture.slug,
			subject: 'Held dispatch',
			bodyHtml: '<p>Held dispatch</p>',
			fromName: 'Commons',
			fromEmail: 'commons@example.test',
			sendMode: 'client-direct'
		});

		const publicAuthorities: Array<[() => Promise<unknown>, string]> = [
			[
				() =>
					fixture.editor.query(api.email.getBlastForEditor, {
						orgSlug: fixture.slug,
						blastId
					}),
				'AUDIENCE_DISPATCH_JOBS_NOT_READY'
			],
			[
				() =>
					fixture.editor.mutation(api.email.enqueueServerDispatch, {
						orgSlug: fixture.slug,
						blastId
					}),
				'EMAIL_SERVER_DISPATCH_DISABLED'
			],
			[
				() =>
					fixture.editor.mutation(api.email.enqueueAbTestDispatch, {
						orgSlug: fixture.slug,
						blastId
					}),
				'EMAIL_SERVER_DISPATCH_DISABLED'
			],
			[
				() =>
					fixture.editor.mutation(api.email.enqueueAbRemainderDispatch, {
						orgSlug: fixture.slug,
						winnerBlastId: blastId
					}),
				'EMAIL_SERVER_DISPATCH_DISABLED'
			],
			[
				() =>
					fixture.editor.mutation(api.blasts.sealAndScheduleBlast, {
						orgSlug: fixture.slug,
						blastId,
						sealedOrgKey: 'held-key'
					}),
				'AUDIENCE_DISPATCH_JOBS_NOT_READY'
			],
			[
				() =>
					fixture.editor.query(api.blasts.getEncryptedSupportersForBlast, {
						orgSlug: fixture.slug,
						blastId,
						cursor: null
					}),
				'AUDIENCE_DISPATCH_JOBS_NOT_READY'
			],
			[
				() =>
					fixture.editor.mutation(api.blasts.updateClientBlastProgress, {
						orgSlug: fixture.slug,
						blastId,
						status: 'sending',
						totalSent: 0,
						totalBounced: 0,
						totalRecipients: 0
					}),
				'AUDIENCE_DISPATCH_JOBS_NOT_READY'
			]
		];
		for (const [authority, code] of publicAuthorities) {
			await expect(authority()).rejects.toThrow(code);
		}

		const internalAuthorities: Array<[() => Promise<unknown>, string]> = [
			[
				() =>
					t.query(internal.email.getBlastRecipients, {
						orgId: fixture.orgId,
						blastId,
						limit: 100,
						cursor: null
					}),
				'EMAIL_SERVER_DISPATCH_DISABLED'
			],
			[
				() => t.action(internal.email.sendBlast, { orgSlug: fixture.slug, blastId }),
				'EMAIL_SERVER_DISPATCH_DISABLED'
			],
			[
				() => t.action(internal.email.sendBlastBatch, { blastId, cursor: null }),
				'EMAIL_SERVER_DISPATCH_DISABLED'
			],
			[
				() => t.mutation(internal.blasts.claimForBlastDispatch, { blastId }),
				'AUDIENCE_DISPATCH_JOBS_NOT_READY'
			],
			[
				() =>
					t.query(internal.blasts.getEncryptedSupporters, {
						orgId: fixture.orgId,
						blastId,
						cursor: null
					}),
				'AUDIENCE_DISPATCH_JOBS_NOT_READY'
			],
			[
				() => t.action(internal.blasts.dispatchScheduledBlast, { blastId }),
				'AUDIENCE_DISPATCH_JOBS_NOT_READY'
			],
			[
				() => t.action(internal.blasts.triggerEnclaveSend, { blastId }),
				'AUDIENCE_DISPATCH_JOBS_NOT_READY'
			]
		];
		for (const [authority, code] of internalAuthorities) {
			await expect(authority()).rejects.toThrow(code);
		}
		await expect(t.action(internal.blasts.processScheduledBlasts, {})).resolves.toEqual({
			disabled: true,
			processed: 0
		});

		await t.run(async (ctx) => {
			const blast = await ctx.db.get(blastId);
			expect(blast).toMatchObject({ status: 'draft', totalSent: 0, totalRecipients: 0 });
		});
	});
});
