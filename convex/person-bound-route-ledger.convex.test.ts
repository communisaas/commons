/// <reference types="vite/client" />

import { describe, expect, it } from 'vitest';
import { convexTest, type TestConvex } from 'convex-test';

import { api } from './_generated/api';
import { emptyCampaignReadModel } from './lib/campaignReadModel';
import { readContactAuthorityEpoch } from './lib/contactAuthority';
import {
	admitPersonBoundRoute,
	isPersonBoundTargetClass,
	PERSON_BOUND_DISTINCT_SENDER_CEILING,
	PERSON_BOUND_WINDOW_MS,
	recordPersonBoundRoute,
	type PersonBoundRouteInput,
	type PersonBoundTargetClass
} from './lib/personBoundRouteLedger';
import schema from './schema';

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts']);
type Harness = TestConvex<typeof schema>;
const NOW = Date.parse('2026-08-11T12:00:00.000Z');

async function admitAndRecord(t: Harness, input: PersonBoundRouteInput) {
	return t.run(async (ctx) => {
		const decision = await admitPersonBoundRoute(ctx, input);
		if (decision.decision !== 'refused') {
			await recordPersonBoundRoute(ctx, {
				...input,
				decidedEmail: decision.email
			});
		}
		return decision;
	});
}

async function ledgerRows(t: Harness) {
	return t.run(async (ctx) => {
		const bindings = await ctx.db.query('personBoundRouteBindings').take(101);
		const sends = await ctx.db.query('personBoundRouteSends').take(101);
		return { bindings, sends };
	});
}

async function campaignIntegrationFixture(t: Harness) {
	const fixture = await t.run(async (ctx) => {
		await ctx.db.insert('planUsageMigrations', {
			key: 'v1',
			status: 'ready',
			runToken: 'person-bound-route-ready',
			phase: 'complete',
			verifiedActions: 0,
			emailsSent: 0,
			emailReserved: 0,
			smsSent: 0,
			restarts: 0,
			scannedOrganizations: 2,
			projectedOrganizations: 2,
			scannedSourceRows: 0,
			startedAt: NOW,
			completedAt: NOW,
			updatedAt: NOW
		});
		await ctx.db.insert('campaignReadModelMigrations', {
			key: 'v1',
			status: 'ready',
			phase: 'deliveries',
			actionsScanned: 0,
			actionsAdopted: 0,
			deliveriesScanned: 0,
			deliveriesAdopted: 0,
			updatedAt: NOW
		});

		const createOrg = async (suffix: string) => {
			const tokenIdentifier = `https://issuer.example|ledger-${suffix}`;
			const userId = await ctx.db.insert('users', {
				tokenIdentifier,
				email: `editor-${suffix}@example.test`,
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
				name: `Ledger ${suffix}`,
				slug: `ledger-${suffix}`,
				maxSeats: 5,
				maxTemplatesMonth: 10,
				dmCacheTtlDays: 30,
				countryCode: 'US',
				isPublic: false,
				memberCount: 1,
				verifiedActionsLifetime: 0,
				verifiedActionsPeriodBaseline: 0,
				verifiedActionsPeriodBaselineAt: NOW,
				sentEmailCount: 0,
				sentEmailPeriodBaseline: 0,
				sentEmailPeriodBaselineAt: NOW,
				emailReservedCount: 0,
				emailReservationPeriodStart: NOW,
				emailReservationState: 'ready',
				smsSentCount: 0,
				smsSentPeriodBaseline: 0,
				smsSentPeriodBaselineAt: NOW,
				updatedAt: NOW
			});
			await ctx.db.insert('subscriptions', {
				orgId,
				plan: 'starter',
				priceCents: 1_000,
				status: 'active',
				paymentMethod: 'stripe',
				stripeSubscriptionId: `sub_ledger_${suffix}`,
				currentPeriodStart: NOW,
				currentPeriodEnd: NOW + PERSON_BOUND_WINDOW_MS,
				updatedAt: NOW
			});
			await ctx.db.insert('orgMemberships', {
				userId,
				orgId,
				role: 'editor',
				joinedAt: NOW
			});
			return { orgId, tokenIdentifier };
		};

		const createCampaign = async (
			orgId: Awaited<ReturnType<typeof createOrg>>['orgId'],
			title: string,
			target: Record<string, unknown>
		) => {
			const campaignId = await ctx.db.insert('campaigns', {
				orgId,
				type: 'LETTER',
				title,
				status: 'ACTIVE',
				targets: [target],
				debateEnabled: false,
				debateThreshold: 50,
				raisedAmountCents: 0,
				donorCount: 0,
				targetCountry: 'US',
				actionCount: 0,
				verifiedActionCount: 0,
				updatedAt: NOW
			});
			await ctx.db.insert('campaignReadModels', {
				campaignId,
				orgId,
				state: emptyCampaignReadModel(NOW)
			});
			return campaignId;
		};

		const orgA = await createOrg('a');
		const orgB = await createOrg('b');
		const firstCampaignId = await createCampaign(orgA.orgId, 'First person route', {
			name: 'Named contact',
			email: 'person@example.org',
			targetClass: 'person_bound',
			officeFallbackEmail: 'office-a@example.org'
		});
		const fallbackCampaignId = await createCampaign(orgB.orgId, 'Fallback route', {
			name: 'Named contact',
			email: 'person@example.org',
			targetClass: 'person_bound',
			officeFallbackEmail: 'office-b@example.org'
		});
		const refusedCampaignId = await createCampaign(orgB.orgId, 'Refused route', {
			name: 'Named contact',
			email: 'person@example.org',
			targetClass: 'person_bound'
		});
		const officeCampaignId = await createCampaign(orgB.orgId, 'Office route', {
			name: 'Main office',
			email: 'office-main@example.org',
			targetClass: 'office_inbox'
		});

		return {
			orgA,
			orgB,
			firstCampaignId,
			fallbackCampaignId,
			refusedCampaignId,
			officeCampaignId
		};
	});

	return {
		...fixture,
		authA: t.withIdentity({
			subject: 'ledger-a',
			issuer: 'https://issuer.example',
			tokenIdentifier: fixture.orgA.tokenIdentifier,
			email: 'editor-a@example.test'
		}),
		authB: t.withIdentity({
			subject: 'ledger-b',
			issuer: 'https://issuer.example',
			tokenIdentifier: fixture.orgB.tokenIdentifier,
			email: 'editor-b@example.test'
		})
	};
}

describe('person-bound route ledger', () => {
	it('binds canonicalized addresses across campaigns and preserves the policy reason on refusal', async () => {
		const t = convexTest(schema, modules);
		await expect(
			admitAndRecord(t, {
				personEmail: ' Person@Example.ORG ',
				campaignKey: 'campaign-a',
				senderScope: 'org-a',
				now: NOW
			})
		).resolves.toEqual({ decision: 'send', email: ' Person@Example.ORG ' });

		await expect(
			admitAndRecord(t, {
				personEmail: 'person@example.org',
				officeFallbackEmail: 'office@example.org',
				campaignKey: 'campaign-b',
				senderScope: 'org-b',
				now: NOW + 1
			})
		).resolves.toEqual({
			decision: 'degraded',
			email: 'office@example.org',
			reason: 'bound_to_other_campaign'
		});

		await expect(
			admitAndRecord(t, {
				personEmail: 'person@example.org',
				campaignKey: 'campaign-c',
				senderScope: 'org-c',
				now: NOW + 2
			})
		).resolves.toEqual({
			decision: 'refused',
			reason: 'bound_to_other_campaign'
		});
		await expect(
			admitAndRecord(t, {
				personEmail: 'person@example.org',
				officeFallbackEmail: ' PERSON@example.org ',
				campaignKey: 'campaign-d',
				senderScope: 'org-d',
				now: NOW + 3
			})
		).resolves.toEqual({
			decision: 'refused',
			reason: 'bound_to_other_campaign'
		});

		const rows = await ledgerRows(t);
		expect(rows.bindings).toHaveLength(1);
		expect(rows.sends).toHaveLength(1);
		expect(rows.bindings[0]?.boundCampaignKey).toBe('campaign-a');
	});

	it('re-admits one campaign and refreshes rather than duplicating its sender row', async () => {
		const t = convexTest(schema, modules);
		const input = {
			personEmail: 'person@example.org',
			campaignKey: 'campaign-a',
			senderScope: 'org-a',
			now: NOW
		};
		await expect(admitAndRecord(t, input)).resolves.toEqual({
			decision: 'send',
			email: input.personEmail
		});
		await expect(admitAndRecord(t, { ...input, now: NOW + 1_000 })).resolves.toEqual({
			decision: 'send',
			email: input.personEmail
		});

		const rows = await ledgerRows(t);
		expect(rows.bindings).toHaveLength(1);
		expect(rows.sends).toHaveLength(1);
		expect(rows.sends[0]).toMatchObject({
			campaignKey: 'campaign-a',
			firstSeenAt: NOW + 1_000,
			expiresAt: NOW + 1_000 + PERSON_BOUND_WINDOW_MS
		});
	});

	it('enforces the exact distinct-sender ceiling and rolls the window forward', async () => {
		const t = convexTest(schema, modules);
		await t.run(async (ctx) => {
			for (let index = 0; index < PERSON_BOUND_DISTINCT_SENDER_CEILING; index += 1) {
				const input = {
					personEmail: 'person@example.org',
					campaignKey: 'campaign-a',
					senderScope: `org-${index}`,
					now: NOW
				};
				const decision = await admitPersonBoundRoute(ctx, input);
				expect(decision).toEqual({ decision: 'send', email: input.personEmail });
				await recordPersonBoundRoute(ctx, { ...input, decidedEmail: decision.email });
			}

			const capped = {
				personEmail: 'person@example.org',
				officeFallbackEmail: 'office@example.org',
				campaignKey: 'campaign-a',
				senderScope: 'org-over-ceiling',
				now: NOW
			};
			const cappedDecision = await admitPersonBoundRoute(ctx, capped);
			expect(cappedDecision).toEqual({
				decision: 'degraded',
				email: 'office@example.org',
				reason: 'distinct_sender_ceiling'
			});
			if (cappedDecision.decision !== 'refused') {
				await recordPersonBoundRoute(ctx, {
					...capped,
					decidedEmail: cappedDecision.email
				});
			}

			const afterWindow = {
				personEmail: 'person@example.org',
				campaignKey: 'campaign-after-window',
				senderScope: 'org-after-window',
				now: NOW + PERSON_BOUND_WINDOW_MS + 1
			};
			const rolledDecision = await admitPersonBoundRoute(ctx, afterWindow);
			expect(rolledDecision).toEqual({
				decision: 'send',
				email: afterWindow.personEmail
			});
			await recordPersonBoundRoute(ctx, {
				...afterWindow,
				decidedEmail: rolledDecision.email
			});
		});

		const rows = await ledgerRows(t);
		expect(rows.bindings).toHaveLength(1);
		expect(rows.bindings[0]?.boundCampaignKey).toBe('campaign-after-window');
		expect(rows.sends).toHaveLength(1);
		expect(rows.sends[0]?.campaignKey).toBe('campaign-after-window');
	}, 20_000);

	it('keeps every uncapped class out of both ledger tables', async () => {
		const t = convexTest(schema, modules);
		const uncappedClasses: PersonBoundTargetClass[] = [
			'officeholder',
			'statutory_record',
			'office_inbox'
		];
		for (let index = 0; index < 30; index += 1) {
			const targetClass = uncappedClasses[index % uncappedClasses.length];
			expect(isPersonBoundTargetClass(targetClass)).toBe(false);
			if (isPersonBoundTargetClass(targetClass)) {
				await admitAndRecord(t, {
					personEmail: `office-${index}@example.org`,
					campaignKey: `campaign-${index}`,
					senderScope: `org-${index}`,
					now: NOW + index
				});
			}
		}

		await expect(ledgerRows(t)).resolves.toMatchObject({ bindings: [], sends: [] });
	});

	it('gates the campaign send path before delivery insertion and quota reservation', async () => {
		const t = convexTest(schema, modules);
		const fixture = await campaignIntegrationFixture(t);

		await expect(
			fixture.authA.mutation(api.campaigns.sendReport, {
				campaignId: fixture.firstCampaignId,
				orgSlug: 'ledger-a',
				targetEmails: ['person@example.org']
			})
		).resolves.toMatchObject({ error: null, deliveryCount: 1 });

		await expect(
			fixture.authB.mutation(api.campaigns.sendReport, {
				campaignId: fixture.fallbackCampaignId,
				orgSlug: 'ledger-b',
				targetEmails: ['person@example.org']
			})
		).resolves.toEqual({
			error: null,
			deliveryCount: 1,
			degraded: [
				{
					requestedEmail: 'person@example.org',
					deliveredEmail: 'office-b@example.org',
					reason: 'bound_to_other_campaign'
				}
			]
		});
		await expect(
			fixture.authB.mutation(api.campaigns.sendReport, {
				campaignId: fixture.fallbackCampaignId,
				orgSlug: 'ledger-b',
				targetEmails: ['person@example.org']
			})
		).resolves.toMatchObject({
			error: null,
			deliveryCount: 0,
			degraded: [{ deliveredEmail: 'office-b@example.org' }]
		});

		await expect(
			fixture.authB.mutation(api.campaigns.sendReport, {
				campaignId: fixture.refusedCampaignId,
				orgSlug: 'ledger-b',
				targetEmails: ['person@example.org']
			})
		).resolves.toEqual({
			error: null,
			deliveryCount: 0,
			degraded: [
				{
					requestedEmail: 'person@example.org',
					deliveredEmail: null,
					reason: 'bound_to_other_campaign'
				}
			]
		});

		await expect(
			fixture.authB.mutation(api.campaigns.sendReport, {
				campaignId: fixture.officeCampaignId,
				orgSlug: 'ledger-b',
				targetEmails: ['office-main@example.org']
			})
		).resolves.toEqual({ error: null, deliveryCount: 1 });

		const rows = await t.run(async (ctx) => {
			const firstDeliveries = await ctx.db
				.query('campaignDeliveries')
				.withIndex('by_campaignId', (q) => q.eq('campaignId', fixture.firstCampaignId))
				.take(2);
			const fallbackDeliveries = await ctx.db
				.query('campaignDeliveries')
				.withIndex('by_campaignId', (q) => q.eq('campaignId', fixture.fallbackCampaignId))
				.take(2);
			const refusedDeliveries = await ctx.db
				.query('campaignDeliveries')
				.withIndex('by_campaignId', (q) => q.eq('campaignId', fixture.refusedCampaignId))
				.take(2);
			const officeDeliveries = await ctx.db
				.query('campaignDeliveries')
				.withIndex('by_campaignId', (q) => q.eq('campaignId', fixture.officeCampaignId))
				.take(2);
			const bindings = await ctx.db.query('personBoundRouteBindings').take(2);
			const sends = await ctx.db.query('personBoundRouteSends').take(2);
			const orgBReservations = await ctx.db
				.query('planUsageReservations')
				.withIndex('by_orgId_status_periodStart', (q) =>
					q.eq('orgId', fixture.orgB.orgId).eq('status', 'active')
				)
				.take(10);
			return {
				firstDeliveries,
				fallbackDeliveries,
				refusedDeliveries,
				officeDeliveries,
				bindings,
				sends,
				orgBReservations
			};
		});

		expect(rows.firstDeliveries).toHaveLength(1);
		expect(rows.fallbackDeliveries).toHaveLength(1);
		expect(rows.fallbackDeliveries[0]?.targetEmail).toBe('office-b@example.org');
		expect(rows.refusedDeliveries).toHaveLength(0);
		expect(rows.officeDeliveries).toHaveLength(1);
		expect(rows.bindings).toHaveLength(1);
		expect(rows.sends).toHaveLength(1);
		expect(rows.orgBReservations).toHaveLength(2);
	});

	it('does not change contact-authority epoch during a complete admit and record cycle', async () => {
		const t = convexTest(schema, modules);
		const before = await t.run((ctx) => readContactAuthorityEpoch(ctx));
		await expect(
			admitAndRecord(t, {
				personEmail: 'person@example.org',
				campaignKey: 'campaign-a',
				senderScope: 'org-a',
				now: NOW
			})
		).resolves.toMatchObject({ decision: 'send' });
		const after = await t.run((ctx) => readContactAuthorityEpoch(ctx));
		expect(after).toBe(before);
	});
});
