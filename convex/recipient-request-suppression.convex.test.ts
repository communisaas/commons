/// <reference types="vite/client" />

/**
 * Recipient-request suppression: the mailbox's own route off the platform.
 *
 * Three properties are load-bearing. The write is TERMINAL — once a mailbox has
 * asked, nothing in this codebase may move it back, and the guard that
 * guarantees that sits in the single writer every other ingress funnels
 * through, so it also has to be provably inert for SMS and for every other
 * email source. The readers must work with NO contact-authority migration row,
 * because the one writer of that row has not run and a readiness gate would
 * make every enforcement seam fail open. And the enforcement has to reach
 * ALREADY-PUBLISHED projections, including the cached-reuse branch that returns
 * a stored roster without re-verifying anything.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { convexTest, type TestConvex } from 'convex-test';

import { api, internal } from './_generated/api';
import { computeGlobalEmailHash } from './_orgHash';
import type { Doc, Id } from './_generated/dataModel';
import {
	applyEmailAuthorityEvent,
	applyManualEmailSuppressionAuthority,
	applyRecipientRequestSuppressionAuthority,
	applySmsAuthorityEvent,
	filterSuppressedEmailContactHashes,
	isEmailContactSuppressed,
	readContactAuthority,
	RECIPIENT_REQUEST_SUPPRESSION_SOURCE,
	seedContactAuthorityFromSupporter
} from './lib/contactAuthority';
import {
	buildPublicTemplateDetailProjection,
	projectPublicDetailRecipientConfig,
	syncCompactPublicDiscoveryProjection
} from './lib/publicTemplateDiscoverySource';
import { issuePublicRecipientProvenance } from './lib/publicRecipientProvenance';
import schema from './schema';

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts']);
const SECRET = 'recipient-request-suppression-secret-32b';
const TOKEN = 'https://issuer.example|recipient-request-suppression';
const NOW = Date.parse('2026-07-19T12:00:00.000Z');
const PROVENANCE_TTL_MS = 24 * 60 * 60 * 1000;
type Harness = TestConvex<typeof schema>;

const ADDRESS_ONE = 'first-official@agency.example.test';
const ADDRESS_TWO = 'second-official@agency.example.test';

beforeEach(() => {
	vi.stubEnv('INTERNAL_API_SECRET', SECRET);
	vi.stubEnv('INTERNAL_API_SECRET_PREVIOUS', '');
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllEnvs();
});

async function seedUser(t: Harness, slug: string): Promise<Id<'users'>> {
	return t.run(async (ctx) =>
		ctx.db.insert('users', {
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
		})
	);
}

async function attestedRecipient(
	userId: Id<'users'>,
	email: string,
	issuedAt = Date.now()
): Promise<Record<string, unknown>> {
	const recipient = {
		name: `Official ${email}`,
		title: 'Director',
		organization: 'Public agency',
		email,
		emailGrounded: true,
		emailSource: 'https://agency.example.test/contact',
		isAiResolved: true,
		publicEmailGrounding: {
			version: 1,
			method: 'page-read',
			source: 'https://agency.example.test/contact'
		}
	};
	const publicRecipientProvenance = await issuePublicRecipientProvenance(
		recipient,
		String(userId),
		SECRET,
		issuedAt
	);
	if (!publicRecipientProvenance) throw new Error('TEST_PUBLIC_RECIPIENT_ATTESTATION_FAILED');
	return { ...recipient, publicRecipientProvenance };
}

async function seedTemplate(
	t: Harness,
	userId: Id<'users'>,
	slug: string,
	recipients: Array<Record<string, unknown>>
): Promise<Id<'templates'>> {
	return t.run(async (ctx) =>
		ctx.db.insert('templates', {
			userId,
			slug,
			title: `Template ${slug}`,
			description: 'Recipient suppression fixture',
			domain: 'housing',
			topics: ['housing'],
			type: 'email',
			deliveryMethod: 'email',
			preview: 'Preview',
			messageBody: 'Message',
			deliveryConfig: {},
			recipientConfig: { decisionMakers: recipients },
			embeddingVersion: 'test-v1',
			status: 'published',
			isPublic: true,
			verifiedSends: 0,
			uniqueDistricts: 0,
			endorsementCount: 0,
			flaggedByModeration: false,
			consensusApproved: true,
			reputationDelta: 0,
			reputationApplied: false,
			updatedAt: NOW
		})
	);
}

async function readDetail(t: Harness, templateId: Id<'templates'>) {
	return t.run(async (ctx) => {
		const row = await ctx.db
			.query('publicTemplateDetailProjections')
			.withIndex('by_templateId', (q) => q.eq('templateId', templateId))
			.unique();
		return row?.detail as
			| {
					recipient_count: number;
					recipientEmails: string[];
					recipient_config: { emails: string[]; decisionMakers?: Array<{ email: string }> };
			  }
			| undefined;
	});
}

async function readProjectionRows(t: Harness, templateId: Id<'templates'>) {
	return t.run(async (ctx) => {
		const [source, detail, coordinate] = await Promise.all([
			ctx.db
				.query('publicTemplateDiscoverySources')
				.withIndex('by_templateId', (q) => q.eq('templateId', templateId))
				.unique(),
			ctx.db
				.query('publicTemplateDetailProjections')
				.withIndex('by_templateId', (q) => q.eq('templateId', templateId))
				.unique(),
			ctx.db
				.query('publicTemplatePageArtifactCoordinates')
				.withIndex('by_templateId', (q) => q.eq('templateId', templateId))
				.unique()
		]);
		return { source, detail, coordinate };
	});
}

describe('recipient-request suppression is terminal', () => {
	it('writes email_suppressed under its own source and overrides a complaint', async () => {
		const t = convexTest({ schema, modules });
		const contactHash = await computeGlobalEmailHash(ADDRESS_ONE);

		const authority = await t.run(async (ctx) => {
			await applyEmailAuthorityEvent(ctx, {
				kind: 'email_set_complained',
				contactHash,
				source: 'ses',
				now: NOW
			});
			return applyRecipientRequestSuppressionAuthority(ctx, { contactHash, now: NOW + 1 });
		});

		expect(authority.state).toBe('email_suppressed');
		expect(authority.source).toBe(RECIPIENT_REQUEST_SUPPRESSION_SOURCE);
	});

	it('cannot be moved off email_suppressed by any later email writer', async () => {
		const t = convexTest({ schema, modules });
		const contactHash = await computeGlobalEmailHash(ADDRESS_ONE);
		const userId = await seedUser(t, 'terminality');

		await t.run(async (ctx) => {
			await applyRecipientRequestSuppressionAuthority(ctx, { contactHash, now: NOW });
		});

		const kinds = [
			'email_set_bounced',
			'email_set_complained',
			'email_soft_bounce',
			'email_reset_soft_bounce'
		] as const;
		for (const kind of kinds) {
			const row = await t.run(async (ctx) =>
				applyEmailAuthorityEvent(ctx, { kind, contactHash, source: 'ses', now: NOW + 10 })
			);
			expect([kind, row.state, row.source]).toEqual([
				kind,
				'email_suppressed',
				RECIPIENT_REQUEST_SUPPRESSION_SOURCE
			]);
		}

		const manual = await t.run(async (ctx) =>
			applyManualEmailSuppressionAuthority(ctx, { contactHash, now: NOW + 20 })
		);
		expect(manual.state).toBe('email_suppressed');
		expect(manual.source).toBe(RECIPIENT_REQUEST_SUPPRESSION_SOURCE);

		// A supporter seed carrying a positive email status must not clear it either.
		const orgId = await t.run(async (ctx) =>
			ctx.db.insert('organizations', {
				name: 'Terminality org',
				slug: 'terminality-org',
				maxSeats: 5,
				maxTemplatesMonth: 10,
				dmCacheTtlDays: 30,
				countryCode: 'US',
				isPublic: false,
				updatedAt: NOW
			})
		);
		const seeded = await t.run(async (ctx) => {
			const supporterId = await ctx.db.insert('supporters', {
				orgId,
				encryptedEmail: 'sealed',
				emailHash: 'seed-hash',
				globalEmailHash: contactHash,
				verified: false,
				emailStatus: 'subscribed',
				smsStatus: 'none',
				source: 'import',
				updatedAt: NOW
			});
			const supporter = (await ctx.db.get(supporterId)) as Doc<'supporters'>;
			await seedContactAuthorityFromSupporter(ctx, supporter, NOW + 30);
			return readContactAuthority(ctx, 'email', contactHash);
		});
		expect(seeded?.state).toBe('email_suppressed');
		expect(seeded?.source).toBe(RECIPIENT_REQUEST_SUPPRESSION_SOURCE);
	});

	it('is inert for SMS: a STOP/START pair is byte-identical to the untouched baseline', async () => {
		const t = convexTest({ schema, modules });
		const emailHash = await computeGlobalEmailHash(ADDRESS_ONE);
		const phoneHash = 'f'.repeat(64);
		const orgId = await t.run(async (ctx) =>
			ctx.db.insert('organizations', {
				name: 'Sms org',
				slug: 'sms-org',
				maxSeats: 5,
				maxTemplatesMonth: 10,
				dmCacheTtlDays: 30,
				countryCode: 'US',
				isPublic: false,
				updatedAt: NOW
			})
		);

		const comparable = (row: Doc<'contactAuthorities'> | null) =>
			row && {
				channel: row.channel,
				contactHash: row.contactHash,
				scopeOrgId: row.scopeOrgId ?? null,
				state: row.state,
				source: row.source
			};

		const baseline = await t.run(async (ctx) => {
			await applySmsAuthorityEvent(ctx, { kind: 'sms_stop', contactHash: phoneHash, now: NOW });
			await applySmsAuthorityEvent(ctx, {
				kind: 'sms_start',
				contactHash: phoneHash,
				scopeOrgId: orgId,
				now: NOW + 1
			});
			return {
				global: comparable(await readContactAuthority(ctx, 'sms', phoneHash)),
				scoped: comparable(await readContactAuthority(ctx, 'sms', phoneHash, orgId))
			};
		});

		// Suppress the EMAIL contact, then replay the same SMS pair. The guard is
		// keyed on the email row and must not reach across the channel.
		const afterSuppression = await t.run(async (ctx) => {
			await applyRecipientRequestSuppressionAuthority(ctx, { contactHash: emailHash, now: NOW });
			await applySmsAuthorityEvent(ctx, { kind: 'sms_stop', contactHash: phoneHash, now: NOW + 2 });
			await applySmsAuthorityEvent(ctx, {
				kind: 'sms_start',
				contactHash: phoneHash,
				scopeOrgId: orgId,
				now: NOW + 3
			});
			return {
				global: comparable(await readContactAuthority(ctx, 'sms', phoneHash)),
				scoped: comparable(await readContactAuthority(ctx, 'sms', phoneHash, orgId))
			};
		});

		expect(afterSuppression).toEqual(baseline);
	});

	it('leaves an email row suppressed by any other source fully mutable', async () => {
		const t = convexTest({ schema, modules });
		const contactHash = await computeGlobalEmailHash(ADDRESS_TWO);
		const row = await t.run(async (ctx) => {
			await applyManualEmailSuppressionAuthority(ctx, { contactHash, now: NOW });
			return applyEmailAuthorityEvent(ctx, {
				kind: 'email_set_complained',
				contactHash,
				source: 'ses',
				now: NOW + 1
			});
		});
		expect(row.state).toBe('email_complained');
		expect(row.source).toBe('ses');
	});
});

describe('suppression readers need no contact-authority migration row', () => {
	it('reads and filters with the migrations table empty', async () => {
		const t = convexTest({ schema, modules });
		const suppressed = await computeGlobalEmailHash(ADDRESS_ONE);
		const clean = await computeGlobalEmailHash(ADDRESS_TWO);

		const result = await t.run(async (ctx) => {
			const migrations = await ctx.db.query('contactAuthorityMigrations').collect();
			await applyRecipientRequestSuppressionAuthority(ctx, {
				contactHash: suppressed,
				now: NOW
			});
			return {
				migrationRows: migrations.length,
				suppressed: await isEmailContactSuppressed(ctx, suppressed),
				clean: await isEmailContactSuppressed(ctx, clean),
				denied: [...(await filterSuppressedEmailContactHashes(ctx, [suppressed, clean]))]
			};
		});

		expect(result.migrationRows).toBe(0);
		expect(result.suppressed).toBe(true);
		expect(result.clean).toBe(false);
		expect(result.denied).toEqual([suppressed]);
	});

	it('returns exactly the denied subset and refuses an oversized batch', async () => {
		const t = convexTest({ schema, modules });
		const suppressed = await computeGlobalEmailHash(ADDRESS_ONE);
		await t.run(async (ctx) => {
			await applyRecipientRequestSuppressionAuthority(ctx, { contactHash: suppressed, now: NOW });
		});

		const others = Array.from({ length: 10 }, (_, index) =>
			index.toString(16).padStart(64, '0')
		).filter((hash) => hash !== suppressed);

		await expect(
			t.query(api.email.filterSuppressedContactHashes, {
				_secret: SECRET,
				contactHashes: [suppressed, ...others]
			})
		).resolves.toEqual([suppressed]);

		await expect(
			t.query(api.email.filterSuppressedContactHashes, {
				_secret: SECRET,
				contactHashes: Array.from({ length: 65 }, (_, index) =>
					index.toString(16).padStart(64, '0')
				)
			})
		).rejects.toThrow(/RECIPIENT_SUPPRESSION_BATCH_TOO_LARGE/);
	});
});

describe('the write endpoint is not an enumeration oracle', () => {
	it('answers identically for a known, an unknown and an already-suppressed hash', async () => {
		const t = convexTest({ schema, modules });
		const known = await computeGlobalEmailHash(ADDRESS_ONE);
		const unknown = await computeGlobalEmailHash('nobody-here@agency.example.test');
		await t.run(async (ctx) => {
			await applyEmailAuthorityEvent(ctx, {
				kind: 'email_soft_bounce',
				contactHash: known,
				source: 'ses',
				now: NOW
			});
		});

		const first = await t.mutation(api.email.suppressRecipientByRequest, {
			_secret: SECRET,
			contactHash: known
		});
		const second = await t.mutation(api.email.suppressRecipientByRequest, {
			_secret: SECRET,
			contactHash: known
		});
		const third = await t.mutation(api.email.suppressRecipientByRequest, {
			_secret: SECRET,
			contactHash: unknown
		});

		expect(first).toEqual({ suppressed: true });
		expect(second).toEqual(first);
		expect(third).toEqual(first);
	});
});

describe('a suppressed address never reaches a public projection', () => {
	it('is dropped on the fresh-verify path despite a valid provenance MAC', async () => {
		const t = convexTest({ schema, modules });
		const userId = await seedUser(t, 'fresh-path');
		const suppressed = await computeGlobalEmailHash(ADDRESS_ONE);
		const recipients = [
			await attestedRecipient(userId, ADDRESS_ONE),
			await attestedRecipient(userId, ADDRESS_TWO)
		];

		const projected = await t.run(async (ctx) => {
			await applyRecipientRequestSuppressionAuthority(ctx, { contactHash: suppressed, now: NOW });
			const denied = await filterSuppressedEmailContactHashes(ctx, [
				suppressed,
				await computeGlobalEmailHash(ADDRESS_TWO)
			]);
			return projectPublicDetailRecipientConfig(
				{ decisionMakers: recipients },
				String(userId),
				[SECRET],
				Date.now(),
				(contactHash) => !denied.has(contactHash)
			);
		});

		expect(projected.emails).toEqual([ADDRESS_TWO]);
		expect(projected.decisionMakers?.map((member) => member.email)).toEqual([ADDRESS_TWO]);

		// The detail projection's own recipient-consistency assertion has to keep
		// holding on the filtered roster.
		const templateId = await seedTemplate(t, userId, 'fresh-path', recipients);
		const detail = await t.run(async (ctx) =>
			buildPublicTemplateDetailProjection(
				(await ctx.db.get(templateId)) as Doc<'templates'>,
				projected
			)
		);
		expect(detail.recipient_count).toBe(detail.recipient_config.decisionMakers?.length ?? 0);
		expect(detail.recipientEmails).toEqual([ADDRESS_TWO]);
	});

	it('is dropped on the cached-reuse path, where nothing is re-verified', async () => {
		const t = convexTest({ schema, modules });
		const userId = await seedUser(t, 'cached-path');
		const suppressed = await computeGlobalEmailHash(ADDRESS_ONE);
		const templateId = await seedTemplate(t, userId, 'cached-path', [
			await attestedRecipient(userId, ADDRESS_ONE),
			await attestedRecipient(userId, ADDRESS_TWO)
		]);

		await t.run(async (ctx) => {
			const template = (await ctx.db.get(templateId)) as Doc<'templates'>;
			await syncCompactPublicDiscoveryProjection(ctx, template);
		});
		expect((await readDetail(t, templateId))?.recipient_count).toBe(2);

		// Past the provenance TTL every MAC is expired, so the fresh path would
		// publish nothing at all. Anything surviving now came from the cache.
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(Date.now() + PROVENANCE_TTL_MS + 60_000);

		await t.run(async (ctx) => {
			await applyRecipientRequestSuppressionAuthority(ctx, {
				contactHash: suppressed,
				now: Date.now()
			});
			const template = (await ctx.db.get(templateId)) as Doc<'templates'>;
			await syncCompactPublicDiscoveryProjection(ctx, template);
		});

		const detail = await readDetail(t, templateId);
		expect(detail?.recipient_config.decisionMakers?.map((member) => member.email)).toEqual([
			ADDRESS_TWO
		]);
		expect(detail?.recipient_config.emails).toEqual([ADDRESS_TWO]);
		expect(detail?.recipientEmails).toEqual([ADDRESS_TWO]);
		expect(detail?.recipient_count).toBe(1);

		const rows = await readProjectionRows(t, templateId);
		expect(rows.source?.source.recipientCount).toBe(1);
	});
});

describe('already-published projections are rebuilt, not deleted', () => {
	it('re-projects only the matching template, bumps its revision, and is idempotent', async () => {
		const t = convexTest({ schema, modules });
		const userId = await seedUser(t, 'reproject');
		const suppressed = await computeGlobalEmailHash(ADDRESS_ONE);
		const matchingId = await seedTemplate(t, userId, 'reproject-match', [
			await attestedRecipient(userId, ADDRESS_ONE),
			await attestedRecipient(userId, ADDRESS_TWO)
		]);
		const untouchedId = await seedTemplate(t, userId, 'reproject-other', [
			await attestedRecipient(userId, ADDRESS_TWO)
		]);

		await t.run(async (ctx) => {
			for (const templateId of [matchingId, untouchedId]) {
				const template = (await ctx.db.get(templateId)) as Doc<'templates'>;
				await syncCompactPublicDiscoveryProjection(ctx, template);
			}
			await applyRecipientRequestSuppressionAuthority(ctx, { contactHash: suppressed, now: NOW });
		});

		const beforeMatch = await readProjectionRows(t, matchingId);
		const beforeOther = await readProjectionRows(t, untouchedId);

		const first = await t.mutation(internal.email.reprojectSuppressedRecipientTemplates, {
			contactHash: suppressed,
			cursor: null
		});
		expect(first).toEqual({ reprojected: 1, done: true });

		const afterMatch = await readProjectionRows(t, matchingId);
		// All three rows survive and stay mutually consistent: a deleted detail row
		// under a surviving coordinate is a hard materialization failure, not a gap.
		expect(afterMatch.source).not.toBeNull();
		expect(afterMatch.detail).not.toBeNull();
		expect(afterMatch.coordinate).not.toBeNull();
		expect(afterMatch.source?.source.recipientCount).toBe(1);
		expect((await readDetail(t, matchingId))?.recipientEmails).toEqual([ADDRESS_TWO]);
		expect(afterMatch.coordinate!.artifactRevision).toBeGreaterThan(
			beforeMatch.coordinate!.artifactRevision
		);

		// Non-matching row untouched.
		const afterOther = await readProjectionRows(t, untouchedId);
		expect(afterOther.detail).toEqual(beforeOther.detail);
		expect(afterOther.source).toEqual(beforeOther.source);
		expect(afterOther.coordinate).toEqual(beforeOther.coordinate);

		// A second pass matches nothing: the address is already gone.
		const second = await t.mutation(internal.email.reprojectSuppressedRecipientTemplates, {
			contactHash: suppressed,
			cursor: null
		});
		expect(second).toEqual({ reprojected: 0, done: true });
		expect(await readProjectionRows(t, matchingId)).toEqual(afterMatch);
	});
});
