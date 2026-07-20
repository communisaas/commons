import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { api, mockGetInternalSecret, mockGetOfficials, mockServerQuery } = vi.hoisted(() => ({
	api: {
		positions: {
			getExisting: 'positions.getExisting',
			getViewerDistrictMetric: 'positions.getViewerDistrictMetric'
		},
		templatePage: {
			getViewerMessageDistrictCount: 'templatePage.getViewerMessageDistrictCount',
			getUserDmRelation: 'templatePage.getUserDmRelation',
			getViewerAuthorRelation: 'templatePage.getViewerAuthorRelation'
		},
		users: { getActiveCredentialHash: 'users.getActiveCredentialHash' }
	},
	mockGetInternalSecret: vi.fn(() => 'public-page-test-secret'),
	mockGetOfficials: vi.fn(),
	mockServerQuery: vi.fn()
}));

vi.mock('convex-sveltekit', () => ({ serverQuery: mockServerQuery }));
vi.mock('$lib/convex', () => ({ api }));
vi.mock('$lib/core/shadow-atlas/client', () => ({ getOfficials: mockGetOfficials }));
vi.mock('$lib/server/internal/secret-auth', () => ({
	getInternalSecret: mockGetInternalSecret
}));
vi.mock('$env/dynamic/private', () => ({
	env: { INTERNAL_API_SECRET: 'viewer-relation-test-secret' }
}));

import { clearPublicDiscoveryCache } from '$lib/server/public-discovery-cache';
import {
	buildPublicTemplatePageAggregate,
	readPublicTemplatePageAggregate
} from '$lib/server/public-template-page-cache';
import { load } from '../../../src/routes/s/[slug]/+page.server';

const NOW = 1_800_000_000_000;
const TEMPLATE_ID = 'template_123';
const TEMPLATE_SLUG = 'clean-water';

function publicMessageMetrics(totalDistricts = 1) {
	return {
		districtCounts: { 'public-district-hash': 5 },
		totalDistricts,
		viewerDistrictCount: 0
	};
}

function publicPositionMetrics() {
	return {
		counts: { support: 5, oppose: null, districts: null },
		engagement: {
			template_id: TEMPLATE_ID,
			districts: [
				{
					district_code: 'CA-12',
					support: 5,
					oppose: 0,
					total: 5,
					support_percent: 100,
					is_user_district: false
				}
			],
			aggregate: {
				total_districts: null,
				total_positions: 5,
				total_support: 5,
				total_oppose: null
			}
		}
	};
}

function publicDebate() {
	return {
		_id: 'debate_123',
		_creationTime: NOW,
		templateId: TEMPLATE_ID,
		debateIdOnchain: null,
		propositionText: 'Should clean water protections be strengthened?',
		propositionHash: '0x1234',
		actionDomain: '0xabcd',
		deadline: NOW + 86_400_000,
		jurisdictionSize: 1,
		status: 'active',
		argumentCount: null,
		uniqueParticipants: null,
		totalStake: 1,
		winningArgumentIndex: null,
		winningStance: null,
		resolvedAt: null,
		resolutionMethod: null,
		aiResolution: {
			source: 'miner_panel',
			minerCount: 2,
			evaluatedAt: '2027-01-15T08:00:00.000Z',
			models: ['model-a', 'model-b'],
			minerEvaluations: [{ minerId: 'private-miner-evidence' }]
		},
		aiSignatureCount: null,
		aiPanelConsensus: null,
		appealDeadline: null,
		governanceJustification: null,
		updatedAt: NOW,
		argumentCursor: null,
		hasMoreArguments: false,
		arguments: [
			{
				_id: 'argument_123',
				_creationTime: NOW,
				argumentIndex: 0,
				stance: 'SUPPORT',
				body: 'Public evidence supports stronger clean-water protections.',
				amendmentText: null,
				stakeAmount: 1,
				engagementTier: 1,
				weightedScore: 1,
				totalStake: 1,
				coSignCount: null,
				verificationStatus: 'verified',
				currentPrice: null,
				priceHistory: null,
				positionCount: null,
				aiScores: null,
				aiWeighted: null,
				finalScore: null,
				modelAgreement: null
			}
		]
	};
}

let aggregateTotalDistricts = 1;

function parentData() {
	return {
		template: {
			id: TEMPLATE_ID,
			slug: TEMPLATE_SLUG,
			recipient_config: {}
		},
		channel: { country: 'US', locale: 'en-US' },
		publicPageAggregate: buildPublicTemplatePageAggregate({
			templateId: TEMPLATE_ID,
			messageMetrics: publicMessageMetrics(aggregateTotalDistricts),
			debate: publicDebate(),
			positionMetrics: publicPositionMetrics()
		})
	};
}

function loadEvent(user: Record<string, unknown> | null = null) {
	return {
		locals: { user },
		parent: async () => parentData(),
		platform: undefined,
		url: new URL(`https://commons.example/s/${TEMPLATE_SLUG}`)
	} as never;
}

type LoadedRecipientPage = {
	totalDistricts: number;
	userDistrictCount: number;
	userDistrictCode: string | null;
	viewerIsAuthor: boolean;
	existingPosition: { stance: string; registrationId: string } | null;
	engagementByDistrict: {
		districts: Array<{ district_code: string; is_user_district: boolean }>;
	} | null;
};

async function loadPage(
	user: Record<string, unknown> | null = null
): Promise<LoadedRecipientPage> {
	return (await load(loadEvent(user))) as unknown as LoadedRecipientPage;
}

describe('anonymous public-template page aggregate', () => {
	beforeEach(() => {
		clearPublicDiscoveryCache();
		aggregateTotalDistricts = 1;
		mockGetInternalSecret.mockClear();
		mockGetOfficials.mockReset();
		mockGetOfficials.mockResolvedValue({ officials: [] });
		mockServerQuery.mockReset();
	});

	afterEach(() => {
		clearPublicDiscoveryCache();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it('performs zero Convex reads for every anonymous page load', async () => {
		mockServerQuery.mockRejectedValue(new Error('anonymous Convex read forbidden'));
		const [first, concurrent] = await Promise.all([loadPage(), loadPage()]);
		const repeated = await loadPage();

		expect(first.totalDistricts).toBe(1);
		expect(concurrent.totalDistricts).toBe(1);
		expect(repeated.totalDistricts).toBe(1);
		expect(mockServerQuery).not.toHaveBeenCalled();
	});

	it('adopts the next producer-published aggregate without querying Convex', async () => {
		const first = await loadPage();
		aggregateTotalDistricts = 2;
		const refreshed = await loadPage();

		expect(first.totalDistricts).toBe(1);
		expect(refreshed.totalDistricts).toBe(2);
		expect(mockServerQuery).not.toHaveBeenCalled();
	});

	it('consumes only the exhaustive public projection and never raw miner evidence', async () => {
		const serializedAggregate = JSON.stringify(parentData().publicPageAggregate);
		const result = await loadPage();

		expect(result.engagementByDistrict?.districts[0]).toMatchObject({
			district_code: 'CA-12'
		});
		expect(result.engagementByDistrict?.districts[0]).not.toHaveProperty('is_user_district');
		expect(serializedAggregate).toContain('public-district-hash');
		expect(serializedAggregate).not.toMatch(
			/viewerUserId|viewerDistrictHash|viewerDistrictCount|userDistrictCode|identityCommitment|is_user_district|minerEvaluations|private-miner-evidence/
		);
	});

	it('cannot invoke a legacy anonymous origin query on repeated requests', async () => {
		mockServerQuery.mockRejectedValue(new Error('legacy anonymous origin forbidden'));
		const first = await loadPage();
		const repeated = await loadPage();

		expect(first).toMatchObject({ totalDistricts: 1 });
		expect(repeated).toMatchObject({ totalDistricts: 1 });
		expect(mockServerQuery).not.toHaveBeenCalled();
	});

	it('adds only indexed viewer overlays for authenticated requests', async () => {
		mockServerQuery.mockImplementation(async (reference: string) => {
			if (reference === api.templatePage.getViewerMessageDistrictCount) return 5;
			if (reference === api.positions.getExisting) {
				return { _id: 'position_private', stance: 'support' };
			}
			if (reference === api.templatePage.getUserDmRelation) {
				return { districtCode: 'CA-12' };
			}
			if (reference === api.templatePage.getViewerAuthorRelation) {
				return { viewerIsAuthor: true, baseRateRelation: 'same' };
			}
			if (reference === api.positions.getViewerDistrictMetric) {
				return {
					district_code: 'CA-12',
					support: 5,
					oppose: 0,
					total: 5,
					support_percent: 100,
					is_user_district: true
				};
			}
			if (reference === api.users.getActiveCredentialHash) {
				return { credentialHash: 'private-credential-hash' };
			}
			throw new Error(`Unexpected authenticated query: ${reference}`);
		});

		const authenticated = await loadPage({
				id: 'user_private',
				name: 'Private Viewer',
				email: 'viewer@example.test',
				avatar: null,
				trust_tier: 3,
				is_verified: true,
				verification_method: 'mdl',
				district_hash: 'private-district-hash',
				identity_commitment: 'private-identity-commitment'
			});
		const authenticatedCalls = mockServerQuery.mock.calls.slice();
		mockServerQuery.mockClear();
		const anonymousAgain = await loadPage();

		expect(authenticated).toMatchObject({
			userDistrictCount: 5,
			userDistrictCode: 'CA-12',
			viewerIsAuthor: true,
			existingPosition: { stance: 'support', registrationId: 'position_private' }
		});
		expect(authenticatedCalls).toHaveLength(6);
		expect(mockServerQuery).not.toHaveBeenCalled();
		// The anonymous follow-up performs no overlays and receives the immutable base.
		expect(anonymousAgain.userDistrictCount).toBe(0);
		expect(parentData().publicPageAggregate.messageMetrics).not.toHaveProperty(
			'viewerDistrictCount'
		);
		expect(authenticatedCalls).toContainEqual([
			api.templatePage.getViewerMessageDistrictCount,
			{
				_secret: 'public-page-test-secret',
				templateId: TEMPLATE_ID,
				viewerDistrictHash: 'private-district-hash'
			}
		]);
		expect(authenticatedCalls).toContainEqual([
			api.positions.getViewerDistrictMetric,
			{
				_secret: 'public-page-test-secret',
				templateId: TEMPLATE_ID,
				userDistrictCode: 'CA-12'
			}
		]);
		expect(authenticatedCalls).toContainEqual(
			expect.arrayContaining([
				api.templatePage.getViewerAuthorRelation,
				expect.objectContaining({ viewerUserId: 'user_private' })
			])
		);
	});

	it('rejects viewer-shaped candidates before they can enter the shared cache', () => {
		expect(() =>
			buildPublicTemplatePageAggregate({
				templateId: TEMPLATE_ID,
				messageMetrics: { ...publicMessageMetrics(), viewerDistrictCount: 5 },
				debate: null,
				positionMetrics: publicPositionMetrics()
			})
		).toThrow('PUBLIC_TEMPLATE_PAGE_CACHE_INVALID:viewer-message-metric');

		const viewerPositionMetrics = publicPositionMetrics();
		viewerPositionMetrics.engagement.districts[0].is_user_district = true;
		expect(() =>
			buildPublicTemplatePageAggregate({
				templateId: TEMPLATE_ID,
				messageMetrics: publicMessageMetrics(),
				debate: null,
				positionMetrics: viewerPositionMetrics
			})
		).toThrow('PUBLIC_TEMPLATE_PAGE_CACHE_INVALID:viewer-position-metric');
	});

	it('rejects unknown nested keys when reconstructing a persisted value', () => {
		const projected = buildPublicTemplatePageAggregate({
			templateId: TEMPLATE_ID,
			messageMetrics: publicMessageMetrics(),
			debate: null,
			positionMetrics: publicPositionMetrics()
		});

		expect(() =>
			readPublicTemplatePageAggregate({
				...projected,
				messageMetrics: {
					...projected.messageMetrics,
					viewerDistrictHash: 'cache-poison-attempt'
				}
			})
		).toThrow('PUBLIC_TEMPLATE_PAGE_CACHE_INVALID:message-metrics-unknown-key');
	});

	it('preserves byte-bounded empty text accepted by valid legacy debate rows', () => {
		const debate: Record<string, any> = publicDebate();
		debate.debateIdOnchain = '';
		debate.propositionText = '';
		debate.propositionHash = '';
		debate.actionDomain = '';
		debate.deadline = '';
		debate.winningStance = '';
		debate.resolutionMethod = '';
		debate.governanceJustification = '';
		debate.arguments[0].body = '';
		debate.arguments[0].amendmentText = '';
		debate.aiResolution.source = '';
		debate.aiResolution.evaluatedAt = '';
		const positionMetrics = publicPositionMetrics();
		positionMetrics.engagement.districts[0].district_code = '';

		const projected = buildPublicTemplatePageAggregate({
			templateId: TEMPLATE_ID,
			messageMetrics: {
				districtCounts: { '': 5 },
				totalDistricts: 1,
				viewerDistrictCount: 0
			},
			debate,
			positionMetrics
		});
		const reconstructed = readPublicTemplatePageAggregate(projected);

		expect(reconstructed.messageMetrics.districtCounts).toEqual({ '': 5 });
		expect(reconstructed.debate).toMatchObject({
			debateIdOnchain: '',
			propositionText: '',
			propositionHash: '',
			actionDomain: '',
			deadline: '',
			winningStance: '',
			resolutionMethod: '',
			governanceJustification: '',
			aiResolution: { source: '', evaluatedAt: '' },
			arguments: [{ body: '', amendmentText: '' }]
		});
		expect(reconstructed.positionMetrics.engagement?.districts[0].district_code).toBe('');
	});

	it('still rejects empty Convex identifiers', () => {
		expect(() =>
			buildPublicTemplatePageAggregate({
				templateId: '',
				messageMetrics: publicMessageMetrics(),
				debate: null,
				positionMetrics: publicPositionMetrics()
			})
		).toThrow('PUBLIC_TEMPLATE_PAGE_CACHE_INVALID:template-id');
	});
});
