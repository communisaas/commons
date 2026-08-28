/**
 * Moderated ⊇ publicly-served.
 *
 * Every author-written string the public projections can emit must either appear
 * in the string the moderation classifiers review, or be listed in
 * `KNOWN_UNCOVERED` with a stated reason. The covered set is derived by running
 * the real projection builders, so a new published field cannot quietly escape
 * review.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
	mockClassifySafety,
	mockDetectPromptInjection,
	mockEnforceLLMRateLimit,
	mockGenerateBatchEmbeddings,
	mockGetCachedPublicTemplates,
	mockModerateTemplate,
	mockProjectToHue,
	mockRateLimitResponse,
	mockServerMutation,
	mockServerQuery
} = vi.hoisted(() => ({
	mockClassifySafety: vi.fn(),
	mockDetectPromptInjection: vi.fn(),
	mockEnforceLLMRateLimit: vi.fn(),
	mockGenerateBatchEmbeddings: vi.fn(),
	mockGetCachedPublicTemplates: vi.fn(),
	mockModerateTemplate: vi.fn(),
	mockProjectToHue: vi.fn(),
	mockRateLimitResponse: vi.fn(),
	mockServerMutation: vi.fn(),
	mockServerQuery: vi.fn()
}));

vi.mock('$lib/core/server/moderation/prompt-guard', () => ({
	detectPromptInjection: mockDetectPromptInjection,
	isPromptInjection: async (content: string) => !(await mockDetectPromptInjection(content)).safe
}));
vi.mock('$lib/core/server/moderation/llama-guard', () => ({
	classifySafety: mockClassifySafety
}));

// The spy records the exact input the route hands over, then delegates to the
// real pipeline so route-level and pipeline-level assertions share one path.
vi.mock('$lib/core/server/moderation', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/core/server/moderation')>();
	return {
		...actual,
		moderateTemplate: async (
			input: Parameters<typeof actual.moderateTemplate>[0],
			options?: Parameters<typeof actual.moderateTemplate>[1]
		) => {
			mockModerateTemplate(input, options);
			return actual.moderateTemplate(input, options);
		}
	};
});

vi.mock('convex-sveltekit', () => ({
	serverQuery: mockServerQuery,
	serverMutation: mockServerMutation
}));
vi.mock('$lib/server/public-template-queries', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/public-template-queries')>();
	return { ...actual, getCachedPublicTemplates: mockGetCachedPublicTemplates };
});
vi.mock('$lib/config/features', () => ({ FEATURES: { CONGRESSIONAL: false } }));
vi.mock('$lib/core/search/gemini-embeddings', () => ({
	generateBatchEmbeddings: mockGenerateBatchEmbeddings
}));
vi.mock('$lib/utils/domain-hue-projection', () => ({ projectToHue: mockProjectToHue }));
vi.mock('$lib/server/internal/secret-auth', () => ({
	getInternalSecret: vi.fn(() => 'test-internal-secret')
}));
vi.mock('$lib/server/llm-cost-protection', () => ({
	enforceLLMRateLimit: mockEnforceLLMRateLimit,
	rateLimitResponse: mockRateLimitResponse
}));

import {
	buildTemplateModerationContent,
	moderateTemplate
} from '$lib/core/server/moderation';
import { PROMPT_GUARD_MAX_CHARACTERS } from '$lib/core/server/moderation/prompt-guard-budget';
import type { PromptGuardResult, SafetyResult } from '$lib/core/server/moderation';
import {
	buildCompactPublicTemplateSource,
	buildPublicTemplateDetailProjection
} from '../../convex/lib/publicTemplateDiscoverySource';
import type { Doc } from '../../convex/_generated/dataModel';
import { POST } from '../../src/routes/api/templates/+server';

// =============================================================================
// PROJECTION COVERAGE
// =============================================================================

/** Author-text fields the classifiers review, by their moderation-input name. */
const COVERED = {
	title: 'sentinelalphatitle',
	description: 'sentinelalphadescription',
	preview: 'sentinelalphapreview',
	messageBody: 'sentinelalphamessagebody'
} as const;

/**
 * Author text the public projections publish that moderation does not classify.
 * Each entry is a deliberate exclusion, not an oversight:
 * - domain/category/slug/topics are short taxonomy labels, separately bounded
 *   and canonicalized, and are not free-form prose.
 * - source titles, credibility rationales and research-log entries are
 *   agent-produced citation metadata rather than author-composed advocacy.
 * Anything that appears in neither map is newly published author text and must
 * be classified into one of them.
 */
const KNOWN_UNCOVERED = {
	domain: 'sentinelbetadomain',
	category: 'sentinelbetacategory',
	slug: 'sentinelbetaslug',
	topics: 'sentinelbetatopic',
	sourceTitle: 'sentinelbetasourcetitle',
	sourceRationale: 'sentinelbetasourcerationale',
	researchLogEntry: 'sentinelbetaresearchlogentry'
} as const;

const ALL_SENTINELS = { ...COVERED, ...KNOWN_UNCOVERED } as Record<string, string>;

function sentinelTemplate(): Doc<'templates'> {
	return {
		_id: 'templates:sentinel',
		_creationTime: 1_800_000_000_000,
		slug: KNOWN_UNCOVERED.slug,
		title: COVERED.title,
		description: COVERED.description,
		preview: COVERED.preview,
		messageBody: COVERED.messageBody,
		domain: KNOWN_UNCOVERED.domain,
		category: KNOWN_UNCOVERED.category,
		topics: [KNOWN_UNCOVERED.topics],
		type: 'petition',
		deliveryMethod: 'email',
		sources: [
			{
				num: 1,
				title: KNOWN_UNCOVERED.sourceTitle,
				url: 'https://example.gov/report',
				type: 'government',
				credibility_rationale: KNOWN_UNCOVERED.sourceRationale
			}
		],
		researchLog: [KNOWN_UNCOVERED.researchLogEntry],
		verifiedSends: 12,
		uniqueDistricts: 7,
		status: 'published',
		isPublic: true
	} as unknown as Doc<'templates'>;
}

/** Keys the detail projection always emits. Adding one is a review decision. */
const DETAIL_KEYS = [
	'id',
	'slug',
	'title',
	'description',
	'domain',
	'domainHue',
	'type',
	'deliveryMethod',
	'subject',
	'message_body',
	'sources',
	'research_log',
	'preview',
	'is_public',
	'verified_sends',
	'unique_districts',
	'send_count',
	'delivery_config',
	'cwc_config',
	'recipient_config',
	'recipient_count',
	'recipientEmails',
	'topics',
	'createdAt'
];

/** Keys the compact discovery source always emits. */
const COMPACT_KEYS = [
	'_id',
	'_creationTime',
	'slug',
	'title',
	'description',
	'domain',
	'category',
	'domainHue',
	'topics',
	'type',
	'deliveryMethod',
	'messageBody',
	'preview',
	'orgId',
	'endorsementCount',
	'verifiedSends',
	'uniqueDistricts',
	'dailyArrivals',
	'dailyArrivalsLastDay',
	'districtCounts',
	'districtCountsSuppressedDistricts',
	'districtCountsSuppressedCount',
	'tierCounts',
	'recipientCount',
	'campaignId',
	'status',
	'isPublic',
	'countryCode',
	'jurisdictions',
	'scopes'
];

describe('public projections publish nothing moderation did not read', () => {
	const template = sentinelTemplate();
	const detail = buildPublicTemplateDetailProjection(template, { emails: [] });
	const compact = buildCompactPublicTemplateSource(template);
	const published = `${JSON.stringify(detail)}\n${JSON.stringify(compact)}`;

	it('emits exactly the covered and knowingly-uncovered author strings', () => {
		const survivors = Object.entries(ALL_SENTINELS)
			.filter(([, sentinel]) => published.includes(sentinel))
			.map(([field]) => field)
			.sort();

		expect(survivors).toEqual([...Object.keys(COVERED), ...Object.keys(KNOWN_UNCOVERED)].sort());
	});

	// Sentinel survival alone cannot see a field that was newly ADDED to a
	// builder: an unset field on a synthetic document is `undefined` and simply
	// never appears. Freezing the key sets makes a new published field fail here,
	// forcing it into COVERED or KNOWN_UNCOVERED.
	it('freezes the published key sets so a new field cannot slip through', () => {
		expect(Object.keys(detail).sort()).toEqual([...DETAIL_KEYS].sort());
		expect(Object.keys(compact).sort()).toEqual([...COMPACT_KEYS].sort());
	});

	it('places every covered sentinel inside the classified content', () => {
		const content = buildTemplateModerationContent({
			title: COVERED.title,
			description: COVERED.description,
			preview: COVERED.preview,
			message_body: COVERED.messageBody
		});

		for (const sentinel of Object.values(COVERED)) {
			expect(content).toContain(sentinel);
		}
	});
});

// =============================================================================
// COMPOSER BEHAVIOUR
// =============================================================================

describe('buildTemplateModerationContent', () => {
	const title = 'Fund the branch library';
	const message_body =
		'The council should restore the branch library budget before the vote in March.';

	it('costs nothing when the preview repeats the message body', () => {
		const preview = message_body.slice(0, 40);
		const description = 'An independent core message about branch funding.';

		const withPrefix = buildTemplateModerationContent({
			title,
			description,
			preview,
			message_body
		});
		const withoutPreview = buildTemplateModerationContent({
			title,
			description,
			preview: '',
			message_body
		});

		expect(withPrefix).toBe(withoutPreview);
		expect(withPrefix.length).toBe(withoutPreview.length);
	});

	it('costs nothing when the description is the default preview slice', () => {
		const preview = message_body.slice(0, 40);
		const description = preview.substring(0, 160);

		const composed = buildTemplateModerationContent({
			title,
			description,
			preview,
			message_body
		});

		expect(composed).toBe(`${title}\n\n${message_body}`);
	});

	it('classifies independent description and preview text', () => {
		const composed = buildTemplateModerationContent({
			title,
			description: 'Independent core message',
			preview: 'Independent preview line',
			message_body
		});

		expect(composed).toBe(
			`${title}\n\n${message_body}\n\nIndependent core message\n\nIndependent preview line`
		);
	});

	it('skips blank fields without emitting empty separators', () => {
		expect(
			buildTemplateModerationContent({
				title,
				description: '   ',
				preview: '',
				message_body
			})
		).toBe(`${title}\n\n${message_body}`);
	});
});

// =============================================================================
// PIPELINE: DESCRIPTION AND PREVIEW ARE ADVERSARIAL SURFACES
// =============================================================================

const FLAGGED = 'FLAGGED-BY-THE-CLASSIFIER';

function promptGuardResult(safe: boolean, score: number): PromptGuardResult {
	return {
		safe,
		score,
		threshold: 0.5,
		timestamp: new Date().toISOString(),
		model: 'llama-prompt-guard-2-86m'
	};
}

function safetyResult(safe: boolean): SafetyResult {
	return {
		safe,
		hazards: safe ? [] : ['S1'],
		blocking_hazards: safe ? [] : ['S1'],
		hazard_descriptions: safe ? [] : ['Violent Crimes'],
		reasoning: safe ? 'clean' : 'blocking hazard',
		timestamp: new Date().toISOString(),
		model: 'openai/gpt-oss-safeguard-20b'
	};
}

const BENIGN_TITLE = 'Support the transit levy';
const BENIGN_BODY = 'Please vote yes on the transit levy at the next session.';

describe('moderation pipeline reviews description and preview', () => {
	beforeEach(() => {
		mockDetectPromptInjection.mockReset();
		mockClassifySafety.mockReset();
		mockModerateTemplate.mockClear();
		vi.spyOn(console, 'log').mockImplementation(() => {});
	});

	it('rejects flagged description text while title and body are benign', async () => {
		mockDetectPromptInjection.mockImplementation(async (content: string) =>
			promptGuardResult(!content.includes(FLAGGED), content.includes(FLAGGED) ? 0.97 : 0.02)
		);
		mockClassifySafety.mockResolvedValue(safetyResult(true));

		const result = await moderateTemplate({
			title: BENIGN_TITLE,
			description: `Core message ${FLAGGED}`,
			preview: 'Transit levy summary',
			message_body: BENIGN_BODY
		});

		expect(result.approved).toBe(false);
		expect(result.rejection_reason).toBe('prompt_injection');
	});

	it('rejects flagged preview text while title and body are benign', async () => {
		mockDetectPromptInjection.mockResolvedValue(promptGuardResult(true, 0.02));
		mockClassifySafety.mockImplementation(async (content: string) =>
			safetyResult(!content.includes(FLAGGED))
		);

		const result = await moderateTemplate({
			title: BENIGN_TITLE,
			description: 'Transit levy core message',
			preview: `Summary ${FLAGGED}`,
			message_body: BENIGN_BODY
		});

		expect(result.approved).toBe(false);
		expect(result.rejection_reason).toBe('safety_violation');
	});
});

// =============================================================================
// ROUTE: WHAT IS PERSISTED IS WHAT WAS MODERATED
// =============================================================================

const ROUTE_DESCRIPTION = 'sentinel route core message about branch funding';
const ROUTE_PREVIEW = 'sentinel route preview line for branch funding';

function postEvent(template: Record<string, unknown>) {
	return {
		request: new Request('https://commons.email/api/templates', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(template)
		}),
		locals: {
			user: { id: 'user_1', is_verified: false, trust_score: 100 },
			session: { userId: 'user_1' }
		}
	} as never;
}

function createdTemplate(args: Record<string, unknown>) {
	return {
		_id: 'templates:created',
		_creationTime: 1_800_000_000_000,
		slug: args.slug,
		title: args.title,
		description: args.description,
		domain: '',
		category: 'General',
		topics: [],
		type: args.type,
		deliveryMethod: args.deliveryMethod,
		messageBody: args.messageBody,
		sources: [],
		researchLog: [],
		preview: args.preview,
		verifiedSends: 0,
		uniqueDistricts: 0,
		deliveryConfig: {},
		cwcConfig: {},
		recipientConfig: {},
		status: 'draft',
		isPublic: false,
		scopes: [],
		updatedAt: 1_800_000_000_000,
		deduplicated: false
	};
}

/** Compose a create payload whose classified content is exactly `composedLength`. */
function windowPayload(composedLength: number) {
	const title = 'Window boundary probe';
	const description = 'd'.repeat(120);
	const preview = 'p'.repeat(120);
	const separators = 6;
	const message_body = 'm'.repeat(
		composedLength - title.length - description.length - preview.length - separators
	);
	return { title, description, preview, message_body, type: 'petition', deliveryMethod: 'email' };
}

describe('POST /api/templates moderates exactly what it persists', () => {
	beforeEach(() => {
		mockDetectPromptInjection.mockReset().mockResolvedValue(promptGuardResult(true, 0.02));
		mockClassifySafety.mockReset().mockResolvedValue(safetyResult(true));
		mockModerateTemplate.mockClear();
		mockServerQuery.mockReset().mockResolvedValue({ outcome: 'allowed' });
		mockGenerateBatchEmbeddings.mockReset();
		mockProjectToHue.mockReset();
		mockRateLimitResponse
			.mockReset()
			.mockImplementation(() => new Response('{"error":"rate limited"}', { status: 429 }));
		mockEnforceLLMRateLimit.mockReset().mockResolvedValue({
			allowed: true,
			remaining: 2,
			limit: 3,
			resetAt: new Date('2026-07-21T01:00:00.000Z'),
			tier: 'authenticated'
		});
		mockServerMutation.mockReset().mockImplementation(async (_ref: unknown, args: never) => {
			const call = args as unknown as Record<string, unknown>;
			if ('messageBody' in call) return createdTemplate(call);
			if ('token' in call) return { outcome: 'claimed', expiresAt: Date.now() + 60_000 };
			return { released: true };
		});
		vi.spyOn(console, 'log').mockImplementation(() => {});
	});

	it('hands the persisted description and preview to moderation', async () => {
		const response = await POST(
			postEvent({
				title: 'Protect the public library',
				message_body: 'Please preserve funding for the public library.',
				description: ROUTE_DESCRIPTION,
				preview: ROUTE_PREVIEW,
				type: 'petition',
				deliveryMethod: 'email'
			})
		);

		expect(response.status).toBe(200);
		expect(mockModerateTemplate).toHaveBeenCalledWith(
			expect.objectContaining({
				title: 'Protect the public library',
				message_body: 'Please preserve funding for the public library.',
				description: ROUTE_DESCRIPTION,
				preview: ROUTE_PREVIEW
			}),
			expect.anything()
		);

		const createCall = mockServerMutation.mock.calls.find(
			([, args]) => args && typeof args === 'object' && 'messageBody' in args
		);
		expect(createCall).toBeDefined();
		expect(createCall?.[1]).toMatchObject({
			description: ROUTE_DESCRIPTION,
			preview: ROUTE_PREVIEW
		});
	});

	it('rejects a composed surface past the reviewed window before any provider call', async () => {
		const payload = windowPayload(PROMPT_GUARD_MAX_CHARACTERS + 1);
		expect(buildTemplateModerationContent(payload).length).toBe(PROMPT_GUARD_MAX_CHARACTERS + 1);

		const response = await POST(postEvent(payload));

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toMatchObject({
			success: false,
			errors: [{ field: 'message_body', code: 'VALIDATION_TOO_LONG' }]
		});
		expect(mockModerateTemplate).not.toHaveBeenCalled();
		expect(mockDetectPromptInjection).not.toHaveBeenCalled();
		expect(mockEnforceLLMRateLimit).not.toHaveBeenCalled();
	});

	it('admits a composed surface exactly at the reviewed window', async () => {
		const payload = windowPayload(PROMPT_GUARD_MAX_CHARACTERS);
		expect(buildTemplateModerationContent(payload).length).toBe(PROMPT_GUARD_MAX_CHARACTERS);

		const response = await POST(postEvent(payload));

		expect(response.status).toBe(200);
		expect(mockModerateTemplate).toHaveBeenCalledOnce();
	});
});
