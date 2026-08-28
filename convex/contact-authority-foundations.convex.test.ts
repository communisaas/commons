/// <reference types="vite/client" />

import { describe, expect, it } from 'vitest';
import { convexTest, type TestConvex } from 'convex-test';

import { api, internal } from './_generated/api';
import { computeGlobalEmailHash, computeGlobalPhoneHash } from './_orgHash';
import type { Doc, Id } from './_generated/dataModel';
import { filterEmailSendAuthorized, readContactAuthorityEpoch } from './lib/contactAuthority';
import schema from './schema';

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts']);
const TOKEN = 'https://issuer.example|contact-authority-foundations';
const NOW = Date.parse('2026-07-19T12:00:00.000Z');
type Harness = TestConvex<typeof schema>;

async function seedOrg(t: Harness, slug: string) {
	return t.run(async (ctx) => {
		const userId = await ctx.db.insert('users', {
			tokenIdentifier: `${TOKEN}:${slug}`,
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
			maxTemplatesMonth: 100,
			dmCacheTtlDays: 30,
			countryCode: 'US',
			isPublic: false,
			updatedAt: NOW
		});
		await ctx.db.insert('orgMemberships', { userId, orgId, role: 'owner', joinedAt: NOW });
		return { orgId, tokenIdentifier: `${TOKEN}:${slug}` };
	});
}

async function insertSupporter(
	t: Harness,
	args: {
		orgId: Id<'organizations'>;
		index: number;
		globalEmailHash?: string;
		globalPhoneHash?: string;
		emailStatus?: string;
		smsStatus?: string;
	}
): Promise<Id<'supporters'>> {
	return t.run((ctx) =>
		ctx.db.insert('supporters', {
			orgId: args.orgId,
			encryptedEmail: `cipher-email-${args.index}`,
			emailHash: `org-email-${args.orgId}-${args.index}`,
			globalEmailHash: args.globalEmailHash,
			encryptedPhone: args.globalPhoneHash ? `cipher-phone-${args.index}` : undefined,
			phoneHash: args.globalPhoneHash ? `org-phone-${args.orgId}-${args.index}` : undefined,
			globalPhoneHash: args.globalPhoneHash,
			verified: true,
			emailStatus: args.emailStatus ?? 'subscribed',
			smsStatus: args.smsStatus ?? (args.globalPhoneHash ? 'subscribed' : 'none'),
			updatedAt: NOW
		})
	);
}

async function installReadyContactMigration(t: Harness): Promise<void> {
	await t.run((ctx) =>
		ctx.db.insert('contactAuthorityMigrations', {
			key: 'contact-authority-v1',
			status: 'ready',
			scanned: 0,
			startedAt: NOW,
			completedAt: NOW,
			updatedAt: NOW
		})
	);
}

async function drainFanout(t: Harness, jobId: Id<'contactFanoutJobs'>) {
	const pages: number[] = [];
	for (let page = 0; page < 20; page += 1) {
		const job = await t.run((ctx) => ctx.db.get(jobId));
		if (!job || job.status !== 'pending') return { job, pages };
		const result = await t.mutation(internal.webhooks.processContactFanoutPage, {
			jobId,
			expectedCursor: job.cursor,
			asOf: Math.max(Date.now(), job.nextAttemptAt) + page + 1
		});
		const processed = 'processed' in result ? result.processed : undefined;
		if (typeof processed === 'number') pages.push(processed);
	}
	throw new Error('fanout did not finish within 20 bounded pages');
}

function requireFanoutJobId(result: { jobId?: Id<'contactFanoutJobs'> }): Id<'contactFanoutJobs'> {
	if (!result.jobId) throw new Error('expected durable contact fanout job');
	return result.jobId;
}

describe('global contact authority foundations', () => {
	it('blocks STOP synchronously, deduplicates provider retries, and converges in 32-row pages', async () => {
		const t = convexTest({ schema, modules });
		const { orgId, tokenIdentifier } = await seedOrg(t, 'contact-stop');
		await installReadyContactMigration(t);
		const from = '+15550001111';
		const phoneHash = await computeGlobalPhoneHash(from);
		const emailHash = await computeGlobalEmailHash('shared-stop@example.test');
		expect(phoneHash).toBeTruthy();
		expect(emailHash).toBeTruthy();
		const supporterIds: Id<'supporters'>[] = [];
		for (let start = 0; start < 70; start += 20) {
			const chunk = await Promise.all(
				Array.from({ length: Math.min(20, 70 - start) }, (_, offset) =>
					insertSupporter(t, {
						orgId,
						index: start + offset,
						globalEmailHash: emailHash!,
						globalPhoneHash: phoneHash!
					})
				)
			);
			supporterIds.push(...chunk);
		}
		const authenticated = t.withIdentity({ tokenIdentifier });
		await expect(
			authenticated.query(api.sms.assertDispatchRecipientsAuthorized, {
				slug: 'contact-stop',
				supporterIds: [supporterIds[0]]
			})
		).resolves.toEqual({ authorized: true, checked: 1 });

		const first = await t.mutation(internal.webhooks.handleInboundSms, {
			from,
			to: '+15559990000',
			messageSid: 'SM-stop-idempotent',
			body: 'STOP'
		});
		const duplicate = await t.mutation(internal.webhooks.handleInboundSms, {
			from,
			to: '+15559990000',
			messageSid: 'SM-stop-idempotent',
			body: 'STOP'
		});
		const firstJobId = requireFanoutJobId(first);
		expect(requireFanoutJobId(duplicate)).toBe(firstJobId);
		expect(duplicate.duplicate).toBe(true);
		expect(await t.run((ctx) => readContactAuthorityEpoch(ctx))).toBe(1);
		await expect(
			authenticated.query(api.sms.assertDispatchRecipientsAuthorized, {
				slug: 'contact-stop',
				supporterIds: [supporterIds[0]]
			})
		).rejects.toThrow('SMS_CONTACT_AUTHORITY_DENIED');
		expect((await t.run((ctx) => ctx.db.get(supporterIds[0])))?.smsStatus).toBe('subscribed');

		const drained = await drainFanout(t, firstJobId);
		// The transactionally scheduled worker can win a page between these
		// explicit test drains. Every page we observe must stay within the fixed
		// envelope; durable job totals prove all 70 rows crossed exactly 3 pages.
		expect(drained.pages.length).toBeGreaterThan(0);
		expect(drained.pages.every((processed) => processed > 0 && processed <= 32)).toBe(true);
		expect(drained.job?.status).toBe('complete');
		expect(drained.job?.pageCount).toBe(3);
		expect(drained.job?.processedCount).toBe(70);
		const stopped = await t.run((ctx) =>
			ctx.db
				.query('supporters')
				.withIndex('by_globalPhoneHash_smsStatus', (q) =>
					q.eq('globalPhoneHash', phoneHash!).eq('smsStatus', 'stopped')
				)
				.take(71)
		);
		expect(stopped).toHaveLength(70);
		await expect(
			t.query(internal.webhooks.contactFanoutReadiness, { asOf: Date.now() })
		).resolves.toMatchObject({ ready: true, failedJobId: null });
	});

	it('never turns START into a global opt-in when routing is missing, unknown, or ambiguous', async () => {
		const t = convexTest({ schema, modules });
		const firstOrg = await seedOrg(t, 'contact-start-a');
		const secondOrg = await seedOrg(t, 'contact-start-b');
		await installReadyContactMigration(t);
		const from = '+15550002222';
		const phoneHash = await computeGlobalPhoneHash(from);
		await insertSupporter(t, {
			orgId: firstOrg.orgId,
			index: 1,
			globalEmailHash: (await computeGlobalEmailHash('start@example.test'))!,
			globalPhoneHash: phoneHash!
		});
		await t.mutation(internal.webhooks.handleInboundSms, {
			from,
			messageSid: 'SM-global-stop',
			body: 'STOP'
		});
		const epochAfterStop = await t.run((ctx) => readContactAuthorityEpoch(ctx));

		const missing = await t.mutation(internal.webhooks.handleInboundSms, {
			from,
			messageSid: 'SM-start-missing',
			body: 'START'
		});
		const unknown = await t.mutation(internal.webhooks.handleInboundSms, {
			from,
			to: '+15558880000',
			messageSid: 'SM-start-unknown',
			body: 'START'
		});
		await t.run(async (ctx) => {
			await ctx.db.insert('orgTwilioNumbers', {
				orgId: firstOrg.orgId,
				phoneNumber: '+15557770000',
				updatedAt: NOW
			});
			await ctx.db.insert('orgTwilioNumbers', {
				orgId: secondOrg.orgId,
				phoneNumber: '+15557770000',
				updatedAt: NOW
			});
		});
		const ambiguous = await t.mutation(internal.webhooks.handleInboundSms, {
			from,
			to: '+15557770000',
			messageSid: 'SM-start-ambiguous',
			body: 'START'
		});
		expect([missing.failureCode, unknown.failureCode, ambiguous.failureCode]).toEqual([
			'SMS_START_ROUTE_MISSING',
			'SMS_START_ROUTE_UNREGISTERED',
			'SMS_START_ROUTE_AMBIGUOUS'
		]);
		expect([missing.status, unknown.status, ambiguous.status]).toEqual([
			'failed',
			'failed',
			'failed'
		]);
		expect(await t.run((ctx) => readContactAuthorityEpoch(ctx))).toBe(epochAfterStop);
		const globalAuthority = await t.run((ctx) =>
			ctx.db
				.query('contactAuthorities')
				.withIndex('by_channel_contactHash_scopeOrgId', (q) =>
					q.eq('channel', 'sms').eq('contactHash', phoneHash!).eq('scopeOrgId', undefined)
				)
				.unique()
		);
		expect(globalAuthority?.state).toBe('sms_stopped');
		const missingJobId = requireFanoutJobId(missing);

		await expect(
			t.mutation(internal.webhooks.retryContactFanoutJob, {
				jobId: missingJobId,
				scopeOrgId: firstOrg.orgId
			})
		).resolves.toMatchObject({ status: 'pending', retried: true, scopeOrgId: firstOrg.orgId });
		const scopedAuthority = await t.run((ctx) =>
			ctx.db
				.query('contactAuthorities')
				.withIndex('by_channel_contactHash_scopeOrgId', (q) =>
					q.eq('channel', 'sms').eq('contactHash', phoneHash!).eq('scopeOrgId', firstOrg.orgId)
				)
				.unique()
		);
		expect(scopedAuthority?.state).toBe('sms_allowed');
		expect(scopedAuthority!.updatedAt).toBeGreaterThan(globalAuthority!.updatedAt);
		const events = await t.query(internal.webhooks.listContactFanoutJobEvents, {
			jobId: missingJobId,
			limit: 10
		});
		expect(events.map((event) => event.type).sort()).toEqual(['ingress_failed', 'operator_retry']);
	});

	it('adopts legacy complaint and STOP truth across sibling organizations and is restart-idempotent', async () => {
		const t = convexTest({ schema, modules });
		const firstOrg = await seedOrg(t, 'contact-migrate-a');
		const secondOrg = await seedOrg(t, 'contact-migrate-b');
		const thirdOrg = await seedOrg(t, 'contact-migrate-c');
		const emailHash = await computeGlobalEmailHash('legacy-shared@example.test');
		const phoneHash = await computeGlobalPhoneHash('+15550003333');
		await insertSupporter(t, {
			orgId: firstOrg.orgId,
			index: 1,
			globalEmailHash: emailHash!,
			globalPhoneHash: phoneHash!,
			emailStatus: 'bounced',
			smsStatus: 'stopped'
		});
		await insertSupporter(t, {
			orgId: secondOrg.orgId,
			index: 2,
			globalEmailHash: emailHash!,
			globalPhoneHash: phoneHash!,
			emailStatus: 'complained',
			smsStatus: 'subscribed'
		});
		const subscribedId = await insertSupporter(t, {
			orgId: thirdOrg.orgId,
			index: 3,
			globalEmailHash: emailHash!,
			globalPhoneHash: phoneHash!
		});

		await t.mutation(internal.webhooks.startContactAuthorityMigration, {});
		await expect(
			t.mutation(internal.webhooks.runContactAuthorityMigrationPage, {})
		).resolves.toMatchObject({ status: 'ready', scanned: 3 });
		const [emailAuthority, smsAuthority, subscribed] = await t.run(async (ctx) => [
			await ctx.db
				.query('contactAuthorities')
				.withIndex('by_channel_contactHash_scopeOrgId', (q) =>
					q.eq('channel', 'email').eq('contactHash', emailHash!).eq('scopeOrgId', undefined)
				)
				.unique(),
			await ctx.db
				.query('contactAuthorities')
				.withIndex('by_channel_contactHash_scopeOrgId', (q) =>
					q.eq('channel', 'sms').eq('contactHash', phoneHash!).eq('scopeOrgId', undefined)
				)
				.unique(),
			await ctx.db.get(subscribedId)
		]);
		expect(emailAuthority?.state).toBe('email_complained');
		expect(smsAuthority?.state).toBe('sms_stopped');
		expect(
			await t.run((ctx) => filterEmailSendAuthorized(ctx, [subscribed as Doc<'supporters'>]))
		).toEqual([]);
		const epochBeforeRestart = await t.run((ctx) => readContactAuthorityEpoch(ctx));
		await t.run(async (ctx) => {
			const migration = await ctx.db
				.query('contactAuthorityMigrations')
				.withIndex('by_key', (q) => q.eq('key', 'contact-authority-v1'))
				.unique();
			await ctx.db.patch(migration!._id, {
				status: 'running',
				cursor: undefined,
				scanned: 0,
				completedAt: undefined,
				updatedAt: NOW + 1
			});
		});
		await expect(
			t.mutation(internal.webhooks.runContactAuthorityMigrationPage, {})
		).resolves.toMatchObject({ status: 'ready', scanned: 3, authoritiesSeeded: 0 });
		expect(await t.run((ctx) => readContactAuthorityEpoch(ctx))).toBe(epochBeforeRestart);

		const blocked = convexTest({ schema, modules });
		const blockedOrg = await seedOrg(blocked, 'contact-migrate-blocked');
		await insertSupporter(blocked, {
			orgId: blockedOrg.orgId,
			index: 1,
			emailStatus: 'complained',
			smsStatus: 'none'
		});
		await blocked.mutation(internal.webhooks.startContactAuthorityMigration, {});
		await expect(
			blocked.mutation(internal.webhooks.runContactAuthorityMigrationPage, {})
		).resolves.toMatchObject({ status: 'blocked' });
		const blockedState = await blocked.run((ctx) =>
			ctx.db
				.query('contactAuthorityMigrations')
				.withIndex('by_key', (q) => q.eq('key', 'contact-authority-v1'))
				.unique()
		);
		expect(blockedState?.failureCode).toBe('CONTACT_AUTHORITY_EMAIL_HASH_MISSING');
	});

	it('turns duplicate reply attribution into a repairable terminal signal', async () => {
		const t = convexTest({ schema, modules });
		const { orgId } = await seedOrg(t, 'contact-reply');
		await installReadyContactMigration(t);
		const from = '+15550004444';
		const to = '+15556660000';
		const phoneHash = await computeGlobalPhoneHash(from);
		const emailHash = await computeGlobalEmailHash('reply@example.test');
		await t.run((ctx) =>
			ctx.db.insert('orgTwilioNumbers', { orgId, phoneNumber: to, updatedAt: NOW })
		);
		const firstId = await insertSupporter(t, {
			orgId,
			index: 1,
			globalEmailHash: emailHash!,
			globalPhoneHash: phoneHash!
		});
		const duplicateId = await insertSupporter(t, {
			orgId,
			index: 2,
			globalEmailHash: emailHash!,
			globalPhoneHash: phoneHash!
		});
		const accepted = await t.mutation(internal.webhooks.handleInboundSms, {
			from,
			to,
			messageSid: 'SM-reply-multiplicity',
			body: 'Please call me'
		});
		const acceptedJobId = requireFanoutJobId(accepted);
		await expect(
			t.mutation(internal.webhooks.processContactFanoutPage, {
				jobId: acceptedJobId,
				asOf: Date.now() + 1
			})
		).rejects.toThrow('SMS_REPLY_SUPPORTER_MULTIPLICITY');
		for (let attempt = 1; attempt <= 6; attempt += 1) {
			await t.mutation(internal.webhooks.recordContactFanoutFailure, {
				jobId: acceptedJobId,
				asOf: NOW + attempt,
				error: 'SMS_REPLY_SUPPORTER_MULTIPLICITY'
			});
		}
		await expect(
			t.query(internal.webhooks.contactFanoutReadiness, { asOf: NOW + 10_000 })
		).resolves.toMatchObject({ ready: false, failedJobId: acceptedJobId });
		await t.run((ctx) => ctx.db.delete(duplicateId));
		await t.mutation(internal.webhooks.retryContactFanoutJob, { jobId: acceptedJobId });
		const drained = await drainFanout(t, acceptedJobId);
		expect(drained.job?.status).toBe('complete');
		const replies = await t.run((ctx) =>
			ctx.db
				.query('smsReplies')
				.withIndex('by_twilioSid', (q) => q.eq('twilioSid', 'SM-reply-multiplicity'))
				.take(2)
		);
		expect(replies).toHaveLength(1);
		expect(replies[0].supporterId).toBe(firstId);
		const events = await t.query(internal.webhooks.listContactFanoutJobEvents, {
			jobId: acceptedJobId,
			limit: 10
		});
		expect(events.map((event) => event.type)).toEqual(
			expect.arrayContaining(['worker_failed', 'operator_retry'])
		);
	});
});
