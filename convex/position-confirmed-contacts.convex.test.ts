/// <reference types="vite/client" />

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { convexTest, type TestConvex } from 'convex-test';

import { api } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import schema from './schema';

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts']);
const SECRET = 'confirmed-contacts-secret-with-32-byte-floor';
const PSEUDONYMOUS_ID = 'b'.repeat(64);
const OTHER_PSEUDONYMOUS_ID = 'c'.repeat(64);
type Harness = TestConvex<typeof schema>;
type TemplateValue = Omit<Doc<'templates'>, '_id' | '_creationTime'>;

function templateValue(slug: string, overrides: Partial<TemplateValue> = {}): TemplateValue {
	return {
		slug,
		title: slug,
		description: 'Confirmed contact fixture',
		topics: [],
		type: 'email',
		deliveryMethod: 'email',
		preview: 'Preview',
		messageBody: 'Body',
		deliveryConfig: {},
		recipientConfig: {},
		status: 'published',
		isPublic: true,
		verifiedSends: 0,
		uniqueDistricts: 0,
		embeddingVersion: 'test',
		flaggedByModeration: false,
		consensusApproved: true,
		reputationDelta: 0,
		reputationApplied: false,
		updatedAt: 1,
		...overrides
	};
}

async function template(t: Harness, slug: string): Promise<Id<'templates'>> {
	return t.run((ctx) => ctx.db.insert('templates', templateValue(slug)));
}

function readArgs(templateId: Id<'templates'>, pseudonymousId = PSEUDONYMOUS_ID) {
	return { _secret: SECRET, pseudonymousId, templateId };
}

async function record(
	t: Harness,
	templateId: Id<'templates'>,
	recipients: Array<{ name: string; deliveryMethod: string }>,
	pseudonymousId = PSEUDONYMOUS_ID
) {
	return t.mutation(api.positions.recordDirectDeliveries, {
		_secret: SECRET,
		pseudonymousId,
		templateId,
		recipients
	});
}

beforeEach(() => {
	vi.stubEnv('INTERNAL_API_SECRET', SECRET);
	vi.stubEnv('INTERNAL_API_SECRET_PREVIOUS', '');
	vi.useFakeTimers();
	vi.setSystemTime(new Date('2026-07-21T00:00:30.000Z'));
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllEnvs();
});

describe('viewer-confirmed direct contacts', () => {
	it('returns what the writer wrote, as the writer wrote it', async () => {
		const t = convexTest({ schema, modules });
		const templateId = await template(t, 'confirmed-roundtrip');
		await record(t, templateId, [{ name: 'Rep. Jane Doe', deliveryMethod: 'email' }]);

		const rows = await t.query(api.positions.listViewerConfirmedContacts, readArgs(templateId));
		expect(rows).toHaveLength(1);
		expect(rows[0].recipientName).toBe('Rep. Jane Doe');
		expect(rows[0].deliveryStatus).toBe('user_confirmed');
		expect(typeof rows[0].confirmedAt).toBe('number');
	});

	it('never shows one viewer another viewer history', async () => {
		const t = convexTest({ schema, modules });
		const templateId = await template(t, 'confirmed-isolation');
		await record(t, templateId, [{ name: 'Rep. Jane Doe', deliveryMethod: 'email' }]);

		await expect(
			t.query(
				api.positions.listViewerConfirmedContacts,
				readArgs(templateId, OTHER_PSEUDONYMOUS_ID)
			)
		).resolves.toEqual([]);
	});

	it('returns only the three fields the page renders', async () => {
		const t = convexTest({ schema, modules });
		const templateId = await template(t, 'confirmed-projection');
		await record(t, templateId, [{ name: 'Rep. Jane Doe', deliveryMethod: 'email' }]);

		const rows = await t.query(api.positions.listViewerConfirmedContacts, readArgs(templateId));
		expect(Object.keys(rows[0]).sort()).toEqual(['confirmedAt', 'deliveryStatus', 'recipientName']);
	});

	it('excludes the reserved mailto-confirmation system identity', async () => {
		const t = convexTest({ schema, modules });
		const templateId = await template(t, 'confirmed-system-key');
		await record(t, templateId, [{ name: 'Rep. Jane Doe', deliveryMethod: 'email' }]);
		await t.run((ctx) =>
			ctx.db.insert('positionDeliveries', {
				pseudonymousId: PSEUDONYMOUS_ID,
				templateId,
				recipientName: 'Commons mailto confirmation',
				recipientKey: 'system:mailto-confirmation:v1',
				deliveryMethod: 'mailto_confirmed',
				deliveryStatus: 'user_confirmed'
			})
		);

		const rows = await t.query(api.positions.listViewerConfirmedContacts, readArgs(templateId));
		expect(rows.map((row) => row.recipientName)).toEqual(['Rep. Jane Doe']);
	});

	it('reports a legacy pending status verbatim rather than collapsing it', async () => {
		const t = convexTest({ schema, modules });
		const templateId = await template(t, 'confirmed-legacy-status');
		await t.run((ctx) =>
			ctx.db.insert('positionDeliveries', {
				pseudonymousId: PSEUDONYMOUS_ID,
				templateId,
				recipientName: 'Rep. Legacy Row',
				recipientKey: 'rep-legacy-row',
				deliveryMethod: 'email',
				deliveryStatus: 'pending'
			})
		);

		const rows = await t.query(api.positions.listViewerConfirmedContacts, readArgs(templateId));
		expect(rows).toHaveLength(1);
		expect(rows[0].deliveryStatus).toBe('pending');
	});

	it('reads no more rows than the writer lifetime ceiling admits', async () => {
		const t = convexTest({ schema, modules });
		const templateId = await template(t, 'confirmed-bound');
		await t.run(async (ctx) => {
			for (let index = 0; index < 25; index += 1) {
				await ctx.db.insert('positionDeliveries', {
					pseudonymousId: PSEUDONYMOUS_ID,
					templateId,
					recipientName: `Recipient ${index}`,
					recipientKey: `recipient-${index}`,
					deliveryMethod: 'email',
					deliveryStatus: 'user_confirmed'
				});
			}
		});

		const rows = await t.query(api.positions.listViewerConfirmedContacts, readArgs(templateId));
		expect(rows).toHaveLength(20);
	});
});
