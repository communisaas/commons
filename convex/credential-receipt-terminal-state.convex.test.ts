/// <reference types="vite/client" />
// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { convexTest, type TestConvex } from 'convex-test';
import { render } from 'svelte/server';

import { api } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import schema from './schema';

const { mockServerQuery } = vi.hoisted(() => ({
	mockServerQuery: vi.fn()
}));

vi.mock('$lib/server/convex-work-budget', () => ({
	serverQuery: (...args: unknown[]) => mockServerQuery(...args)
}));

vi.mock('$lib/convex', () => ({
	api: {
		campaigns: {
			getStats: 'campaigns.getStats',
			getCampaignPacketSummary: 'campaigns.getCampaignPacketSummary'
		},
		users: { resolveCredentialHash: 'users.resolveCredentialHash' }
	}
}));

vi.mock('$lib/server/internal/secret-auth', () => ({
	getInternalSecret: () => 'terminal-state-render-secret'
}));

import VerifyPage from '../src/routes/v/[hash]/+page.svelte';
import { load } from '../src/routes/v/[hash]/+page.server';

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts']);
const NOW = Date.parse('2026-07-19T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const SECRET = 'credential-terminal-state-test-secret';
type Harness = TestConvex<typeof schema>;

type TerminalStatus = 'lapsed' | 'superseded' | 'operator_retired' | 'retired_reason_unrecorded';

function userValue(
	suffix: string,
	options: { trustTier?: number } = {}
): Omit<Doc<'users'>, '_id' | '_creationTime'> {
	return {
		tokenIdentifier: `https://issuer.example|${suffix}`,
		email: `${suffix}@example.test`,
		updatedAt: NOW,
		isVerified: true,
		authorityLevel: options.trustTier ?? 1,
		trustTier: options.trustTier ?? 1,
		trustScore: 0,
		reputationTier: 'new',
		districtVerified: false,
		templatesContributed: 0,
		templateAdoptionRate: 0,
		peerEndorsements: 0,
		activeMonths: 0,
		profileVisibility: 'private'
	};
}

function credentialValue(
	userId: Id<'users'>,
	suffix: string,
	overrides: Partial<Omit<Doc<'districtCredentials'>, '_id' | '_creationTime'>> = {}
): Omit<Doc<'districtCredentials'>, '_id' | '_creationTime'> {
	return {
		userId,
		credentialType: 'district_residency',
		congressionalDistrict: 'CA-12',
		verificationMethod: 'postal',
		issuedAt: NOW - 30 * DAY,
		expiresAt: NOW + 365 * DAY,
		credentialHash: `credential-${suffix}`,
		...overrides
	};
}

function harness(): Harness {
	return convexTest({
		schema,
		modules,
		transactionLimits: { documentsRead: 2, databaseQueries: 2, bytesRead: 30_000 }
	});
}

async function resolve(t: Harness, credentialHash: string) {
	return t.query(api.users.resolveCredentialHash, {
		_secret: SECRET,
		credentialHash,
		asOf: NOW
	});
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(NOW);
	vi.stubEnv('INTERNAL_API_SECRET', SECRET);
	vi.stubEnv('INTERNAL_API_SECRET_PREVIOUS', '');
	mockServerQuery.mockReset();
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllEnvs();
});

describe('credential receipt terminal-state resolution', () => {
	it('grades known hashes while preserving the facts captured on each credential row', async () => {
		const t = harness();
		const userId = await t.run((ctx) =>
			ctx.db.insert('users', userValue('graded', { trustTier: 5 }))
		);
		const supersededIssuedAt = NOW - 100 * DAY;
		const supersededRevokedAt = NOW - 20 * DAY;
		const lapsedAt = NOW - DAY;

		await t.run(async (ctx) => {
			await ctx.db.insert(
				'districtCredentials',
				credentialValue(userId, 'superseded', {
					congressionalDistrict: 'OR-03',
					issuedAt: supersededIssuedAt,
					revokedAt: supersededRevokedAt,
					retirementReason: 'superseded_by_reissue',
					trustTier: 2,
					boundaryAsOf: '2025-01-15',
					officialsAsOf: '2025-02-20',
					tigerVintage: 'TIGER2024',
					resolutionConfidence: 0.91
				})
			);
			await ctx.db.insert(
				'districtCredentials',
				credentialValue(userId, 'lapsed', { expiresAt: lapsedAt })
			);
			await ctx.db.insert(
				'districtCredentials',
				credentialValue(userId, 'unrecorded', { revokedAt: NOW - 10 * DAY })
			);
			await ctx.db.insert(
				'districtCredentials',
				credentialValue(userId, 'operator', {
					revokedAt: NOW - 5 * DAY,
					retirementReason: 'operator_cutover'
				})
			);
			await ctx.db.insert('districtCredentials', credentialValue(userId, 'active'));
		});

		await expect(resolve(t, 'credential-superseded')).resolves.toMatchObject({
			status: 'superseded',
			retiredAt: supersededRevokedAt,
			congressionalDistrict: 'OR-03',
			issuedAt: supersededIssuedAt,
			trustTier: 2,
			boundaryAsOf: '2025-01-15',
			officialsAsOf: '2025-02-20',
			tigerVintage: 'TIGER2024',
			resolutionConfidence: 0.91
		});
		await expect(resolve(t, 'credential-lapsed')).resolves.toMatchObject({
			status: 'lapsed',
			retiredAt: lapsedAt
		});
		await expect(resolve(t, 'credential-unrecorded')).resolves.toMatchObject({
			status: 'retired_reason_unrecorded',
			retiredAt: NOW - 10 * DAY
		});
		await expect(resolve(t, 'credential-operator')).resolves.toMatchObject({
			status: 'operator_retired',
			retiredAt: NOW - 5 * DAY
		});
		await expect(resolve(t, 'credential-active')).resolves.toMatchObject({
			status: 'active',
			retiredAt: null
		});
		await expect(resolve(t, 'credential-unknown')).resolves.toBeNull();
	});

	it('never leaks any successor credential value through a retired hash', async () => {
		const t = harness();
		const userId = await t.run((ctx) => ctx.db.insert('users', userValue('anti-oracle')));
		const successor = credentialValue(userId, 'successor', {
			credentialHash: 'successor-hash-that-must-not-leak',
			congressionalDistrict: 'WA-09',
			stateSenateDistrict: 'successor-senate-47',
			stateAssemblyDistrict: 'successor-assembly-47A',
			issuedAt: NOW - DAY
		});

		await t.run(async (ctx) => {
			await ctx.db.insert(
				'districtCredentials',
				credentialValue(userId, 'retired', {
					credentialHash: 'retired-public-hash',
					congressionalDistrict: 'CA-12',
					stateSenateDistrict: 'retired-senate-11',
					stateAssemblyDistrict: 'retired-assembly-11A',
					issuedAt: NOW - 200 * DAY,
					revokedAt: NOW - 2 * DAY,
					retirementReason: 'superseded_by_reissue'
				})
			);
			await ctx.db.insert('districtCredentials', successor);
		});

		const result = await resolve(t, 'retired-public-hash');
		expect(result).not.toBeNull();
		const resolvedValues = Object.values(result ?? {});
		const successorValues = [
			successor.credentialHash,
			successor.congressionalDistrict,
			successor.stateSenateDistrict,
			successor.stateAssemblyDistrict,
			successor.issuedAt
		];
		for (const successorValue of successorValues) {
			expect(resolvedValues).not.toContain(successorValue);
		}
	});
});

interface RenderCredential {
	status: 'active' | TerminalStatus;
	retiredAt: number | null;
	trustTier: number | null;
	verificationMethod: string;
	congressionalDistrict: string | null;
	stateSenateDistrict: string | null;
	stateAssemblyDistrict: string | null;
	countyFips: string | null;
	congressionalDistrictSource: string | null;
	stateSenateDistrictSource: string | null;
	stateAssemblyDistrictSource: string | null;
	countyFipsSource: string | null;
	issuedAt: number;
	expiresAt: number;
	hasDistrictCommitment: boolean;
	boundaryAsOf: string | null;
	officialsAsOf: string | null;
	tigerVintage: string | null;
	resolutionConfidence: number | null;
}

const RENDER_CREDENTIAL: RenderCredential = {
	status: 'active',
	retiredAt: null,
	trustTier: 2,
	verificationMethod: 'postal',
	congressionalDistrict: 'CA-12',
	stateSenateDistrict: null,
	stateAssemblyDistrict: null,
	countyFips: null,
	congressionalDistrictSource: 'self-reported',
	stateSenateDistrictSource: null,
	stateAssemblyDistrictSource: null,
	countyFipsSource: null,
	issuedAt: NOW - 30 * DAY,
	expiresAt: NOW + 150 * DAY,
	hasDistrictCommitment: false,
	boundaryAsOf: null,
	officialsAsOf: null,
	tigerVintage: null,
	resolutionConfidence: null
};

async function renderCredential(overrides: Partial<RenderCredential>): Promise<string> {
	const credential = { ...RENDER_CREDENTIAL, ...overrides };
	mockServerQuery.mockImplementation(async (reference: unknown) => {
		if (reference === 'campaigns.getStats') return null;
		if (reference === 'users.resolveCredentialHash') return credential;
		throw new Error(`unexpected query: ${String(reference)}`);
	});

	const data = await load({ params: { hash: 'terminal-receipt-hash' } } as Parameters<
		typeof load
	>[0]);
	return render(VerifyPage, { props: { data } as never }).body;
}

describe('/v/[hash] terminal-state rendering', () => {
	it.each([
		[
			'superseded',
			'This record stopped standing on July 18, 2026. The sender re-verified their address; this page does not link to the newer record.'
		],
		[
			'operator_retired',
			'This record was retired by Commons on July 18, 2026 during a credential rotation.'
		],
		[
			'retired_reason_unrecorded',
			'This record was retired on July 18, 2026. The reason was not recorded.'
		],
		[
			'lapsed',
			'This record lapsed on July 18, 2026. It was accurate when issued and has not been renewed.'
		]
	] as const)(
		'renders the exact %s terminal line and no present-tense verification',
		async (status, line) => {
			const body = await renderCredential({
				status,
				retiredAt: Date.parse('2026-07-18T12:00:00.000Z')
			});

			expect(body).toContain(line);
			expect(body).toContain('The sender had verified their address when this record was issued.');
			expect(body).not.toContain(
				'The person who sent you this message verified their address before sending.'
			);
			expect(body).not.toContain('text-channel-verified-700');
			expect(body).not.toContain('m9 12 2 2 4-4');
		}
	);

	it('renders an unknown tier as a neutral record without coercing it to tier zero', async () => {
		const body = await renderCredential({ trustTier: null });

		expect(body).toContain('Sender record');
		expect(body).toContain(
			'This page records the sender information captured when the record was issued.'
		);
		expect(body).not.toContain('Unverified Sender');
		expect(body).not.toContain('This sender has not completed verification.');
	});
});
