import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProcessedDecisionMaker } from '$lib/types/template';
import type { DecisionMakerResult, ResolveContext } from '$lib/core/agents/providers/types';

const { resolveProvider, verifyEmailBatch, updateContactVerification, accountability } = vi.hoisted(
	() => ({
		resolveProvider: vi.fn(),
		verifyEmailBatch: vi.fn(),
		updateContactVerification: vi.fn(),
		accountability: vi.fn()
	})
);

vi.mock('$lib/core/agents/providers', () => ({
	decisionMakerRouter: { resolve: resolveProvider }
}));

vi.mock('$lib/server/email-verification', () => ({ verifyEmailBatch }));

vi.mock('$lib/core/agents/utils/contact-cache', () => ({
	updateContactVerification,
	getCachedContacts: vi.fn().mockResolvedValue([]),
	upsertResolvedContacts: vi.fn().mockResolvedValue(undefined),
	normalizeOrgKey: (value: string) => value.toLowerCase()
}));

vi.mock('$lib/core/agents/agents/decision-maker-accountability', () => ({
	generateAccountabilityOpeners: accountability
}));

import { classifyGovernmentalAddress } from '$lib/core/agents/governmental-class';
import { resolveDecisionMakers } from '$lib/core/agents/agents/decision-maker';

const context: ResolveContext = {
	targetType: 'local_government',
	targetEntity: 'Example City',
	subjectLine: 'Fund safer crossings',
	coreMessage: 'Please fund safer crossings this year.',
	topics: ['street safety']
};

function candidate(
	name: string,
	email?: string,
	overrides: Partial<ProcessedDecisionMaker> = {}
): ProcessedDecisionMaker {
	return {
		name,
		title: 'Official',
		organization: 'Example City',
		email,
		provenance: 'Public source',
		reasoning: 'Has authority over the requested decision.',
		isAiResolved: true,
		...overrides
	};
}

function providerResult(): DecisionMakerResult {
	return {
		decisionMakers: [
			candidate('Government Registry', 'office@city.gov'),
			candidate('Private Registry', 'contact@example.com'),
			candidate('No Address')
		],
		provider: 'fixture',
		cacheHit: false,
		latencyMs: 1,
		metadata: {}
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	resolveProvider.mockImplementation(async () => providerResult());
	verifyEmailBatch.mockResolvedValue(
		new Map([
			[
				'office@city.gov',
				{ email: 'office@city.gov', verdict: 'deliverable', mxObserved: true }
			],
			[
				'contact@example.com',
				{ email: 'contact@example.com', verdict: 'deliverable', mxObserved: true }
			]
		])
	);
	updateContactVerification.mockResolvedValue(undefined);
	accountability.mockResolvedValue({ openers: new Map(), personalPrompt: '' });
});

describe('governmental address registry classification', () => {
	it('distinguishes a completed no-address observation from a negative registry finding', () => {
		expect(classifyGovernmentalAddress(undefined)).toEqual({
			governmental: false,
			reason: 'no-address'
		});
		expect(classifyGovernmentalAddress('person@example.com')).toEqual({
			governmental: false,
			reason: 'not-a-government-registry'
		});
	});

	it('treats a blank final address as no-address', () => {
		expect(classifyGovernmentalAddress('  ')).toEqual({
			governmental: false,
			reason: 'no-address'
		});
	});

	it('recognizes the restricted .gov matcher and records its registry domain', () => {
		expect(classifyGovernmentalAddress('person@mail.city.gov')).toEqual({
			governmental: true,
			basis: 'us-federal-registry',
			registryDomain: 'gov'
		});
	});

	it('recognizes the restricted .mil matcher', () => {
		expect(classifyGovernmentalAddress('person@mail.army.mil')).toEqual({
			governmental: true,
			basis: 'us-federal-registry',
			registryDomain: 'mil'
		});
	});

	it('recognizes the RFC 1480 FED branch', () => {
		expect(classifyGovernmentalAddress('person@agency.fed.us')).toEqual({
			governmental: true,
			basis: 'us-federal-registry',
			registryDomain: 'fed.us'
		});
	});

	it('recognizes every closed state and territory code in the RFC 1480 STATE branch', () => {
		const expectedCodes = [
			'al', 'ak', 'az', 'ar', 'ca', 'co', 'ct', 'de', 'fl', 'ga', 'hi', 'id', 'il', 'in',
			'ia', 'ks', 'ky', 'la', 'me', 'md', 'ma', 'mi', 'mn', 'ms', 'mo', 'mt', 'ne', 'nv',
			'nh', 'nj', 'nm', 'ny', 'nc', 'nd', 'oh', 'ok', 'or', 'pa', 'ri', 'sc', 'sd', 'tn',
			'tx', 'ut', 'vt', 'va', 'wa', 'wv', 'wi', 'wy', 'dc', 'as', 'gu', 'mp', 'pr', 'vi'
		];

		for (const code of expectedCodes) {
			expect(classifyGovernmentalAddress(`person@agency.state.${code}.us`)).toEqual({
				governmental: true,
				basis: 'us-state-registry',
				registryDomain: `state.${code}.us`
			});
		}
	});

	it('recognizes the RFC 1480 city-government CI branch', () => {
		expect(classifyGovernmentalAddress('person@fire.ci.sacramento.ca.us')).toEqual({
			governmental: true,
			basis: 'us-state-registry',
			registryDomain: 'ci.sacramento.ca.us'
		});
	});

	it('recognizes the RFC 1480 county-government CO branch', () => {
		expect(classifyGovernmentalAddress('person@sheriff.co.san-diego.ca.us')).toEqual({
			governmental: true,
			basis: 'us-state-registry',
			registryDomain: 'co.san-diego.ca.us'
		});
	});

	it.each([
		['gov.uk', 'person@department.gov.uk'],
		['gc.ca', 'person@department.gc.ca'],
		['govt.nz', 'person@department.govt.nz'],
		['gov.au', 'person@department.gov.au']
	])('recognizes the closed foreign %s registry matcher', (registryDomain, email) => {
		expect(classifyGovernmentalAddress(email)).toEqual({
			governmental: true,
			basis: 'foreign-government-registry',
			registryDomain
		});
	});

	it('classifies city.gov.uk as foreign rather than mistaking its interior .gov label for .gov', () => {
		expect(classifyGovernmentalAddress('person@city.gov.uk')).toEqual({
			governmental: true,
			basis: 'foreign-government-registry',
			registryDomain: 'gov.uk'
		});
	});

	it.each([
		['rejects notagov.com rather than substring matching', 'person@notagov.com'],
		['rejects a city-gov lookalike label', 'person@city-gov.example.com'],
		['rejects gov.attacker.com rather than interior-label matching', 'person@gov.attacker.com'],
		['rejects foo.gov.attacker.com rather than interior-label matching', 'person@foo.gov.attacker.com'],
		['rejects gov.uk.attacker.com rather than interior-suffix matching', 'person@gov.uk.attacker.com'],
		['rejects agency.gov.evil rather than interior-suffix matching', 'person@agency.gov.evil'],
		['rejects a fake state code under .us', 'person@agency.state.zz.us'],
		['rejects an ordinary locality branch under .us', 'person@private.sacramento.ca.us']
	])('%s', (_name, email) => {
		expect(classifyGovernmentalAddress(email)).toEqual({
			governmental: false,
			reason: 'not-a-government-registry'
		});
	});

	it('rejects a nonempty address with no at-sign', () => {
		expect(classifyGovernmentalAddress('person.city.gov')).toEqual({
			governmental: false,
			reason: 'not-a-government-registry'
		});
	});

	it('rejects an address with two at-signs', () => {
		expect(classifyGovernmentalAddress('person@city.gov@attacker.com')).toEqual({
			governmental: false,
			reason: 'not-a-government-registry'
		});
	});

	it('does not confuse registry membership with officeholder or person status', () => {
		expect(classifyGovernmentalAddress('info@city.gov')).toEqual({
			governmental: true,
			basis: 'us-federal-registry',
			registryDomain: 'gov'
		});
	});

	it('populates every resolved candidate without changing cardinality or email', async () => {
		const result = await resolveDecisionMakers(context, vi.fn());

		expect(result.decisionMakers).toHaveLength(3);
		expect(result.decisionMakers.map((dm) => dm.email)).toEqual([
			'office@city.gov',
			'contact@example.com',
			undefined
		]);
		expect(result.decisionMakers.map((dm) => dm.governmentalClass)).toEqual([
			{ governmental: true, basis: 'us-federal-registry', registryDomain: 'gov' },
			{ governmental: false, reason: 'not-a-government-registry' },
			{ governmental: false, reason: 'no-address' }
		]);
	});
});
