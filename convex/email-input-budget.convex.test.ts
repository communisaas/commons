/// <reference types="vite/client" />

import { describe, expect, it } from 'vitest';
import { convexTest, type TestConvex } from 'convex-test';

import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema from './schema';

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts']);

type Harness = TestConvex<typeof schema>;

function newHarness(): Harness {
	return convexTest(schema, modules);
}

async function createAuthenticatedUser(t: Harness) {
	const tokenIdentifier = 'https://issuer.example|email-input-budget-editor';
	const userId = await t.run((ctx) =>
		ctx.db.insert('users', {
			tokenIdentifier,
			updatedAt: Date.now(),
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
		})
	);
	return {
		userId,
		authenticated: t.withIdentity({
			subject: 'email-input-budget-editor',
			issuer: 'https://issuer.example',
			tokenIdentifier
		})
	};
}

async function createEditorOrg(t: Harness, userId: Id<'users'>): Promise<Id<'organizations'>> {
	const orgId = await t.run((ctx) =>
		ctx.db.insert('organizations', {
			name: 'Budget Org',
			slug: 'budget-org',
			maxSeats: 5,
			maxTemplatesMonth: 10,
			dmCacheTtlDays: 7,
			countryCode: 'US',
			isPublic: false,
			updatedAt: Date.now()
		})
	);
	await t.run((ctx) =>
		ctx.db.insert('orgMemberships', {
			userId,
			orgId,
			role: 'editor',
			joinedAt: Date.now()
		})
	);
	return orgId;
}

function validDraftArgs() {
	return {
		orgSlug: 'budget-org',
		subject: 'Bounded subject',
		bodyHtml: '<p>ok</p>',
		fromName: 'Org Team',
		fromEmail: 'team@example.org'
	};
}

function validAbDraftArgs() {
	return {
		orgSlug: 'budget-org',
		subjectA: 'Bounded subject A',
		subjectB: 'Bounded subject B',
		bodyHtmlA: '<p>A</p>',
		bodyHtmlB: '<p>B</p>',
		fromName: 'Org Team',
		fromEmail: 'team@example.org',
		recipientFilter: {},
		abParentId: 'ab-parent-1',
		abTestConfig: { payload: 'ok' },
		variantAEmailHashes: ['a'.repeat(64)],
		variantBEmailHashes: ['b'.repeat(64)],
		remainderEmailHashes: []
	};
}

describe('email draft input budgets', () => {
	it('rejects an oversized subject before auth', async () => {
		const t = newHarness();

		await expect(
			t.mutation(api.email.createBlast, {
				...validDraftArgs(),
				subject: 'x'.repeat(513)
			})
		).rejects.toThrow(/EMAIL_SUBJECT_INVALID/);
	});

	it('rejects CRLF header injection in the from address', async () => {
		const t = newHarness();

		await expect(
			t.mutation(api.email.createBlast, {
				...validDraftArgs(),
				fromEmail: 'evil@example.org\r\nbcc: victim@example.org'
			})
		).rejects.toThrow(/EMAIL_FROM_ADDRESS_INVALID/);
	});

	it('creates a bounded draft for an authenticated editor', async () => {
		const t = newHarness();
		const { authenticated, userId } = await createAuthenticatedUser(t);
		await createEditorOrg(t, userId);

		const created = await authenticated.mutation(api.email.createBlast, validDraftArgs());

		expect(created.id).toBeDefined();
		await t.run(async (ctx) => {
			const row = await ctx.db.get(created.id);
			expect(row).toMatchObject({
				subject: 'Bounded subject',
				status: 'draft'
			});
		});
	});

	it('rejects an oversized draft patch without changing the row', async () => {
		const t = newHarness();
		const { authenticated, userId } = await createAuthenticatedUser(t);
		await createEditorOrg(t, userId);
		const created = await authenticated.mutation(api.email.createBlast, validDraftArgs());

		await expect(
			authenticated.mutation(api.email.updateBlast, {
				orgSlug: 'budget-org',
				blastId: created.id,
				subject: 'x'.repeat(513)
			})
		).rejects.toThrow(/EMAIL_SUBJECT_INVALID/);

		await expect(
			authenticated.mutation(api.email.updateBlast, {
				orgSlug: 'budget-org',
				blastId: created.id,
				fromName: 'Org\r\nBcc: attacker@example.com'
			})
		).rejects.toThrow(/EMAIL_FROM_NAME_INVALID/);

		await t.run(async (ctx) => {
			const row = await ctx.db.get(created.id);
			expect(row).toMatchObject({
				subject: 'Bounded subject',
				bodyHtml: '<p>ok</p>',
				status: 'draft'
			});
		});
	});

	it('rejects oversized A/B metadata and invalid A/B parent ids', async () => {
		const t = newHarness();
		const { authenticated, userId } = await createAuthenticatedUser(t);
		await createEditorOrg(t, userId);

		await expect(
			authenticated.mutation(api.email.createAbTestDrafts, {
				...validAbDraftArgs(),
				abTestConfig: { payload: 'x'.repeat(33 * 1024) }
			})
		).rejects.toThrow(/EMAIL_AB_CONFIG_INVALID/);
		await expect(
			authenticated.mutation(api.email.createAbTestDrafts, {
				...validAbDraftArgs(),
				abParentId: 'not/allowed chars'
			})
		).rejects.toThrow(/EMAIL_AB_PARENT_ID_INVALID/);
	});

	it('rejects bodyHtml over 256 KiB before auth', async () => {
		const t = newHarness();

		await expect(
			t.mutation(api.email.createBlast, {
				...validDraftArgs(),
				bodyHtml: 'x'.repeat(256 * 1024 + 1)
			})
		).rejects.toThrow(/EMAIL_BODY_HTML_INVALID/);
	});
});
