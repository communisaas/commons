/// <reference types="vite/client" />

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { convexTest, type TestConvex } from 'convex-test';

import { api } from './_generated/api';
import { emptyCampaignReadModel } from './lib/campaignReadModel';
import schema from './schema';

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts']);
const NOW = Date.parse('2026-07-19T12:00:00.000Z');
const SECRET = 'campaign-public-stats-secret-32-byte-padding';
type Harness = TestConvex<typeof schema>;

function harness(): Harness {
	return convexTest({
		schema,
		modules,
		transactionLimits: {
			bytesRead: 32 * 1024,
			documentsRead: 3,
			databaseQueries: 3
		}
	});
}

async function seedCampaign(t: Harness, migrationStatus: 'ready' | 'pending') {
	return t.run(async (ctx) => {
		const orgId = await ctx.db.insert('organizations', {
			name: 'Public stats org',
			slug: 'public-stats-org',
			maxSeats: 10,
			maxTemplatesMonth: 10,
			dmCacheTtlDays: 30,
			countryCode: 'US',
			isPublic: true,
			updatedAt: NOW
		});
		const campaignId = await ctx.db.insert('campaigns', {
			orgId,
			type: 'LETTER',
			title: 'Projected public campaign',
			status: 'ACTIVE',
			debateEnabled: false,
			debateThreshold: 50,
			raisedAmountCents: 0,
			donorCount: 0,
			targetCountry: 'US',
			actionCount: 20_000,
			verifiedActionCount: 15_000,
			tier3VerifiedActionCount: 9_000,
			updatedAt: NOW
		});
		await ctx.db.insert('campaignReadModelMigrations', {
			key: 'v1',
			status: migrationStatus,
			phase: 'deliveries',
			actionsScanned: 20_000,
			actionsAdopted: 20_000,
			deliveriesScanned: 0,
			deliveriesAdopted: 0,
			updatedAt: NOW
		});
		await ctx.db.insert('campaignReadModels', {
			campaignId,
			orgId,
			state: {
				...emptyCampaignReadModel(NOW),
				actionCount: 20_000,
				verifiedActionCount: 15_000,
				districtActionCount: 15_000,
				districtCount: 321
			}
		});
		return campaignId;
	});
}

describe('public campaign stats projection', () => {
	beforeEach(() => {
		vi.stubEnv('INTERNAL_API_SECRET', SECRET);
		vi.stubEnv('INTERNAL_API_SECRET_PREVIOUS', '');
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it('serves high-cardinality stats within three compact document reads', async () => {
		const t = harness();
		const campaignId = await seedCampaign(t, 'ready');

		await expect(t.query(api.campaigns.getStats, { _secret: SECRET, campaignId })).resolves.toEqual(
			{
				verifiedActions: 15_000,
				totalActions: 20_000,
				uniqueDistricts: 321,
				tier3VerifiedActions: 9_000,
				tier3UniqueDistricts: null
			}
		);
	});

	it('fails closed until the read-model migration is activated', async () => {
		const t = harness();
		const campaignId = await seedCampaign(t, 'pending');

		await expect(t.query(api.campaigns.getStats, { _secret: SECRET, campaignId })).rejects.toThrow(
			'CAMPAIGN_READ_MODEL_NOT_READY'
		);
	});
});
