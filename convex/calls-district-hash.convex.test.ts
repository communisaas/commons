/// <reference types="vite/client" />

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { convexTest, type TestConvex } from 'convex-test';

import { api } from './_generated/api';
import schema from './schema';
import { hashDistrictCode, hashPostalCode } from './lib/districtHash';
import type { Id } from './_generated/dataModel';

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts']);
const NOW = Date.parse('2026-07-19T12:00:00.000Z');
const HASH_KEY = 'test-district-hash-key-calls';
type Harness = TestConvex<typeof schema>;

function identity(subject: string, email: string) {
	return {
		subject,
		issuer: 'https://issuer.example',
		tokenIdentifier: `https://issuer.example|${subject}`,
		email
	};
}

async function seedOrg(t: Harness, slug: string) {
	return t.run((ctx) =>
		ctx.db.insert('organizations', {
			name: `Calls Org ${slug}`,
			slug,
			maxSeats: 10,
			maxTemplatesMonth: 10,
			dmCacheTtlDays: 30,
			countryCode: 'US',
			isPublic: false,
			updatedAt: NOW
		})
	);
}

async function seedEditor(t: Harness, orgId: Id<'organizations'>, subject: string, email: string) {
	return t.run(async (ctx) => {
		const userId = await ctx.db.insert('users', {
			tokenIdentifier: `https://issuer.example|${subject}`,
			email,
			identityCommitment: `identity-${subject}`,
			updatedAt: NOW,
			isVerified: true,
			authorityLevel: 3,
			trustTier: 3,
			trustScore: 100,
			reputationTier: 'veteran',
			districtVerified: true,
			templatesContributed: 0,
			templateAdoptionRate: 0,
			peerEndorsements: 0,
			activeMonths: 1,
			profileVisibility: 'private'
		});
		await ctx.db.insert('orgMemberships', { userId, orgId, role: 'editor', joinedAt: NOW });
		return userId;
	});
}

async function seedSupporter(
	t: Harness,
	orgId: Id<'organizations'>,
	label: string,
	geography: { congressionalDistrict?: string; postalCode?: string }
) {
	return t.run((ctx) =>
		ctx.db.insert('supporters', {
			orgId,
			encryptedEmail: JSON.stringify({ ciphertext: `enc-${label}` }),
			emailHash: `hash-${label}`,
			verified: true,
			emailStatus: 'subscribed',
			smsStatus: 'subscribed',
			updatedAt: NOW,
			...geography
		})
	);
}

const CALL_ARGS = {
	callerPhone: '+15551230000',
	targetPhone: '+15551239999'
};

describe('patch-through call district hash derivation', () => {
	beforeEach(() => {
		vi.stubEnv('DISTRICT_HASH_KEY', HASH_KEY);
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it('derives the stored hash from the supporter district with the keyed producer', async () => {
		const t = convexTest(schema, modules);
		const orgId = await seedOrg(t, 'calls-district-org');
		await seedEditor(t, orgId, 'calls-district-editor', 'district-editor@example.test');
		const supporterId = await seedSupporter(t, orgId, 'district', {
			congressionalDistrict: 'CA-12'
		});

		const asEditor = t.withIdentity(
			identity('calls-district-editor', 'district-editor@example.test')
		);
		const { _id } = await asEditor.mutation(api.calls.createCall, {
			slug: 'calls-district-org',
			supporterId,
			...CALL_ARGS
		});

		const stored = await t.run((ctx) => ctx.db.get(_id));
		const expected = await hashDistrictCode('CA-12');

		expect(stored?.districtHash).toBe(expected);
		expect(stored?.districtHash).toMatch(/^[0-9a-f]{64}$/);
		expect(stored?.districtHash).not.toBe(await hashDistrictCode('CA-11'));
	});

	it('falls back to the postal producer, domain-separated from district hashes', async () => {
		const t = convexTest(schema, modules);
		const orgId = await seedOrg(t, 'calls-postal-org');
		await seedEditor(t, orgId, 'calls-postal-editor', 'postal-editor@example.test');
		const supporterId = await seedSupporter(t, orgId, 'postal', { postalCode: '94110' });

		const asEditor = t.withIdentity(identity('calls-postal-editor', 'postal-editor@example.test'));
		const { _id } = await asEditor.mutation(api.calls.createCall, {
			slug: 'calls-postal-org',
			supporterId,
			...CALL_ARGS
		});

		const stored = await t.run((ctx) => ctx.db.get(_id));
		const expected = await hashPostalCode('94110');

		expect(stored?.districtHash).toBe(expected);
		expect(stored?.districtHash).not.toBe(await hashDistrictCode('CA-12'));
	});

	it('stores no hash and reads no key when the supporter has no geography', async () => {
		const t = convexTest(schema, modules);
		const orgId = await seedOrg(t, 'calls-nogeo-org');
		await seedEditor(t, orgId, 'calls-nogeo-editor', 'nogeo-editor@example.test');
		const supporterId = await seedSupporter(t, orgId, 'nogeo', {});

		// An absent key makes every producer throw. A call that still succeeds
		// proves the key is only consulted when there is geography to hash.
		vi.stubEnv('DISTRICT_HASH_KEY', '');

		const asEditor = t.withIdentity(identity('calls-nogeo-editor', 'nogeo-editor@example.test'));
		const { _id } = await asEditor.mutation(api.calls.createCall, {
			slug: 'calls-nogeo-org',
			supporterId,
			...CALL_ARGS
		});

		const stored = await t.run((ctx) => ctx.db.get(_id));
		expect(stored?.districtHash).toBeUndefined();
	});

	it('refuses a supporter owned by another organization', async () => {
		const t = convexTest(schema, modules);
		const orgId = await seedOrg(t, 'calls-tenant-org');
		const otherOrgId = await seedOrg(t, 'calls-other-org');
		await seedEditor(t, orgId, 'calls-tenant-editor', 'tenant-editor@example.test');
		const foreignSupporterId = await seedSupporter(t, otherOrgId, 'foreign', {
			congressionalDistrict: 'CA-12'
		});

		const asEditor = t.withIdentity(identity('calls-tenant-editor', 'tenant-editor@example.test'));
		await expect(
			asEditor.mutation(api.calls.createCall, {
				slug: 'calls-tenant-org',
				supporterId: foreignSupporterId,
				...CALL_ARGS
			})
		).rejects.toThrow('Supporter does not belong to this organization');

		const rows = await t.run((ctx) => ctx.db.query('patchThroughCalls').collect());
		expect(rows).toHaveLength(0);
	});

	it('rejects a caller-supplied district hash at argument validation', async () => {
		const t = convexTest(schema, modules);
		const orgId = await seedOrg(t, 'calls-forgery-org');
		await seedEditor(t, orgId, 'calls-forgery-editor', 'forgery-editor@example.test');
		const supporterId = await seedSupporter(t, orgId, 'forgery', {
			congressionalDistrict: 'CA-12'
		});

		const asEditor = t.withIdentity(
			identity('calls-forgery-editor', 'forgery-editor@example.test')
		);
		await expect(
			asEditor.mutation(api.calls.createCall, {
				slug: 'calls-forgery-org',
				supporterId,
				...CALL_ARGS,
				// @ts-expect-error createCall has no districtHash argument — the value is derived server-side.
				districtHash: 'forged-value'
			})
		).rejects.toThrow(/Unexpected field `districtHash`/);

		const rows = await t.run((ctx) => ctx.db.query('patchThroughCalls').collect());
		expect(rows.some((row) => row.districtHash === 'forged-value')).toBe(false);
	});
});
