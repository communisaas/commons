import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	buildTemplateCreateResponse,
	type TemplateAuthoringRecord
} from '$lib/server/templates/authoring-response';

const RESPONSE_KEYS = [
	'id',
	'slug',
	'title',
	'description',
	'domain',
	'topics',
	'type',
	'deliveryMethod',
	'subject',
	'message_body',
	'sources',
	'research_log',
	'preview',
	'coordinationScale',
	'isNew',
	'verified_sends',
	'unique_districts',
	'send_count',
	'delivery_config',
	'cwc_config',
	'recipient_config',
	'campaign_id',
	'status',
	'is_public',
	'jurisdiction_level',
	'applicable_countries',
	'specific_locations',
	'jurisdictions',
	'scope',
	'scopes',
	'createdAt',
	'updatedAt'
];

function makeRecord(overrides: Partial<TemplateAuthoringRecord> = {}): TemplateAuthoringRecord {
	return {
		_id: 'k17template',
		_creationTime: 1_700_000_000_000,
		slug: 'protect-the-watershed',
		title: 'Protect the watershed',
		description: 'Ask the county to fund the watershed study.',
		domain: 'environment',
		category: 'General',
		topics: ['water', 'county'],
		type: 'advocacy',
		deliveryMethod: 'email',
		messageBody: 'Dear representative, please fund the study.',
		sources: [{ url: 'https://example.org/study' }],
		researchLog: [{ step: 'read the county budget' }],
		preview: 'Ask the county to fund the watershed study.',
		verifiedSends: 12,
		uniqueDistricts: 4,
		deliveryConfig: { channel: 'email' },
		cwcConfig: null,
		recipientConfig: { targets: ['county-board'] },
		campaignId: 'campaign-1',
		status: 'published',
		isPublic: true,
		scopes: [{ level: 'county' }],
		updatedAt: 1_700_000_500_000,
		deduplicated: false,
		...overrides
	};
}

/** Payload fragments that must exist only inside the shared helper. */
const HAND_WRITTEN_FRAGMENTS = [
	'jurisdiction_level: null',
	'applicable_countries: null',
	'specific_locations: null',
	'coordinationScale: 0',
	'scopes: []',
	'finalDomain',
	'finalTopics'
];

const dup = makeRecord({ deduplicated: true });
const fresh = makeRecord({ deduplicated: false });

describe('buildTemplateCreateResponse key contract', () => {
	it('emits exactly the 32 contract keys in order', () => {
		const keys = Object.keys(buildTemplateCreateResponse(fresh));
		expect(keys).toEqual(RESPONSE_KEYS);
		expect(keys).toHaveLength(32);
	});

	it('emits the same key list in the same order for both call shapes', () => {
		const duplicateKeys = Object.keys(
			buildTemplateCreateResponse(dup, { domain: 'housing', topics: ['zoning'] })
		);
		const createdKeys = Object.keys(buildTemplateCreateResponse(fresh));
		expect(duplicateKeys).toEqual(createdKeys);
		expect(duplicateKeys).toEqual(RESPONSE_KEYS);
	});

	it('differs between the duplicate and created records only in isNew', () => {
		const duplicatePayload: Record<string, unknown> = { ...buildTemplateCreateResponse(dup) };
		const createdPayload: Record<string, unknown> = { ...buildTemplateCreateResponse(fresh) };
		const differing = RESPONSE_KEYS.filter(
			(key) => JSON.stringify(duplicatePayload[key]) !== JSON.stringify(createdPayload[key])
		);
		expect(differing).toEqual(['isNew']);
	});
});

describe('buildTemplateCreateResponse isNew derivation', () => {
	it('reports a deduplicated record as not new', () => {
		expect(buildTemplateCreateResponse(dup).isNew).toBe(false);
	});

	it('reports a freshly inserted record as new', () => {
		expect(buildTemplateCreateResponse(fresh).isNew).toBe(true);
	});
});

describe('buildTemplateCreateResponse domain ladder', () => {
	it('prefers the requested domain over the stored one', () => {
		expect(buildTemplateCreateResponse(fresh, { domain: 'housing' }).domain).toBe('housing');
	});

	it('falls back to the stored domain when none was requested', () => {
		expect(buildTemplateCreateResponse(fresh, { domain: '' }).domain).toBe('environment');
		expect(buildTemplateCreateResponse(fresh).domain).toBe('environment');
	});

	it('falls back to a meaningful category when no domain exists', () => {
		const record = makeRecord({ domain: undefined, category: 'Housing' });
		expect(buildTemplateCreateResponse(record, { domain: '' }).domain).toBe('Housing');
	});

	it('treats the placeholder category as no domain at all', () => {
		const record = makeRecord({ domain: undefined, category: 'General' });
		expect(buildTemplateCreateResponse(record).domain).toBe('');
	});

	it('yields an empty domain when neither domain nor category exists', () => {
		const record = makeRecord({ domain: undefined, category: undefined });
		expect(buildTemplateCreateResponse(record).domain).toBe('');
	});
});

describe('buildTemplateCreateResponse topics ladder', () => {
	it('prefers a non-empty requested topic list', () => {
		expect(buildTemplateCreateResponse(fresh, { topics: ['zoning'] }).topics).toEqual(['zoning']);
	});

	it('falls back to the stored topics when the requested list is empty', () => {
		expect(buildTemplateCreateResponse(fresh, { topics: [] }).topics).toEqual(['water', 'county']);
	});

	it('yields an empty list when the record carries no topics', () => {
		const record = makeRecord({ topics: undefined });
		expect(buildTemplateCreateResponse(record).topics).toEqual([]);
	});
});

describe('buildTemplateCreateResponse constants, aliases and defaults', () => {
	it('emits the fixed jurisdiction placeholders', () => {
		const payload = buildTemplateCreateResponse(fresh);
		expect(payload.coordinationScale).toBe(0);
		expect(payload.jurisdiction_level).toBeNull();
		expect(payload.applicable_countries).toBeNull();
		expect(payload.specific_locations).toBeNull();
		expect(payload.scope).toBeNull();
		expect(payload.jurisdictions).toEqual([]);
		expect(payload.scopes).toEqual([]);
	});

	it('emits an empty scope array even when the record carries stored scopes', () => {
		const record = makeRecord({
			scopes: [
				{
					countryCode: 'US',
					regionCode: 'CA',
					displayText: 'California',
					scopeLevel: 'region',
					confidence: 1.0,
					extractionMethod: 'gemini_inline'
				}
			]
		});
		expect(buildTemplateCreateResponse(record).scopes).toEqual([]);
	});

	it('aliases subject to the title and send_count to verified_sends', () => {
		const payload = buildTemplateCreateResponse(fresh);
		expect(payload.subject).toBe(fresh.title);
		expect(payload.message_body).toBe(fresh.messageBody);
		expect(payload.verified_sends).toBe(12);
		expect(payload.send_count).toBe(payload.verified_sends);
		expect(payload.unique_districts).toBe(4);
	});

	it('zeroes the reach counters when the record omits them', () => {
		const record = makeRecord({ verifiedSends: undefined, uniqueDistricts: undefined });
		const payload = buildTemplateCreateResponse(record);
		expect(payload.verified_sends).toBe(0);
		expect(payload.send_count).toBe(0);
		expect(payload.unique_districts).toBe(0);
	});

	it('emits empty arrays for the optional JSON columns', () => {
		const record = makeRecord({ sources: undefined, researchLog: undefined, scopes: undefined });
		const payload = buildTemplateCreateResponse(record);
		expect(payload.sources).toEqual([]);
		expect(payload.research_log).toEqual([]);
		expect(payload.scopes).toEqual([]);
	});

	it('nulls the campaign link when the record omits it', () => {
		const record = makeRecord({ campaignId: undefined });
		expect(buildTemplateCreateResponse(record).campaign_id).toBeNull();
		expect(buildTemplateCreateResponse(fresh).campaign_id).toBe('campaign-1');
	});

	it('maps the Convex identifiers onto the API names', () => {
		const payload = buildTemplateCreateResponse(fresh);
		expect(payload.id).toBe(fresh._id);
		expect(payload.createdAt).toBe(fresh._creationTime);
		expect(payload.updatedAt).toBe(fresh.updatedAt);
		expect(payload.slug).toBe(fresh.slug);
		expect(payload.status).toBe(fresh.status);
		expect(payload.is_public).toBe(true);
	});
});

/**
 * One record whose every field carries its own recognizable value, so a key
 * emitted from the wrong field lands on a value that belongs to another key.
 */
const SENTINEL_FIELDS: Partial<TemplateAuthoringRecord> = {
	_id: 'sentinel-id',
	_creationTime: 1_111_111_111_111,
	slug: 'sentinel-slug',
	title: 'sentinel-title',
	description: 'sentinel-description',
	domain: 'sentinel-domain',
	category: 'sentinel-category',
	topics: ['sentinel-topic'],
	type: 'sentinel-type',
	deliveryMethod: 'sentinel-delivery-method',
	messageBody: 'sentinel-message-body',
	sources: [{ marker: 'sentinel-sources' }],
	researchLog: [{ marker: 'sentinel-research-log' }],
	preview: 'sentinel-preview',
	verifiedSends: 3141,
	uniqueDistricts: 2718,
	deliveryConfig: { marker: 'sentinel-delivery-config' },
	cwcConfig: { marker: 'sentinel-cwc-config' },
	recipientConfig: { marker: 'sentinel-recipient-config' },
	campaignId: 'sentinel-campaign-id',
	status: 'sentinel-status',
	isPublic: true,
	scopes: [{ marker: 'sentinel-scopes' }],
	updatedAt: 1_222_222_222_222,
	deduplicated: false
};

const SENTINEL = makeRecord(SENTINEL_FIELDS);

/** The expected value of every contract key, named by the field it comes from. */
const SENTINEL_PAYLOAD: Record<string, unknown> = {
	id: SENTINEL._id,
	slug: SENTINEL.slug,
	title: SENTINEL.title,
	description: SENTINEL.description,
	domain: SENTINEL.domain,
	topics: SENTINEL.topics,
	type: SENTINEL.type,
	deliveryMethod: SENTINEL.deliveryMethod,
	subject: SENTINEL.title,
	message_body: SENTINEL.messageBody,
	sources: SENTINEL.sources,
	research_log: SENTINEL.researchLog,
	preview: SENTINEL.preview,
	coordinationScale: 0,
	isNew: true,
	verified_sends: SENTINEL.verifiedSends,
	unique_districts: SENTINEL.uniqueDistricts,
	send_count: SENTINEL.verifiedSends,
	delivery_config: SENTINEL.deliveryConfig,
	cwc_config: SENTINEL.cwcConfig,
	recipient_config: SENTINEL.recipientConfig,
	campaign_id: SENTINEL.campaignId,
	status: SENTINEL.status,
	is_public: true,
	jurisdiction_level: null,
	applicable_countries: null,
	specific_locations: null,
	jurisdictions: [],
	scope: null,
	scopes: [],
	createdAt: SENTINEL._creationTime,
	updatedAt: SENTINEL.updatedAt
};

describe('buildTemplateCreateResponse value sourcing', () => {
	it('draws every record field from a value no other field shares', () => {
		const serialized = Object.values(SENTINEL)
			.filter((value) => typeof value !== 'boolean')
			.map((value) => JSON.stringify(value));
		expect(new Set(serialized).size).toBe(serialized.length);
	});

	it('states an expected value for every key in the contract', () => {
		expect(Object.keys(SENTINEL_PAYLOAD)).toEqual(RESPONSE_KEYS);
	});

	it('reads each response key from its own record field', () => {
		const payload: Record<string, unknown> = { ...buildTemplateCreateResponse(SENTINEL) };
		for (const key of RESPONSE_KEYS) {
			expect(payload[key]).toStrictEqual(SENTINEL_PAYLOAD[key]);
		}
		expect(payload).toStrictEqual(SENTINEL_PAYLOAD);
	});

	it('reads is_public and isNew from separate record fields', () => {
		const cases = [
			{ isPublic: false, deduplicated: false, is_public: false, isNew: true },
			{ isPublic: true, deduplicated: true, is_public: true, isNew: false }
		];
		for (const { isPublic, deduplicated, is_public, isNew } of cases) {
			const record = makeRecord({ ...SENTINEL_FIELDS, isPublic, deduplicated });
			const payload: Record<string, unknown> = { ...buildTemplateCreateResponse(record) };
			expect(payload).toStrictEqual({ ...SENTINEL_PAYLOAD, is_public, isNew });
		}
	});

	it('lets the submitted domain and topics replace only their own keys', () => {
		const payload: Record<string, unknown> = {
			...buildTemplateCreateResponse(SENTINEL, {
				domain: 'sentinel-requested-domain',
				topics: ['sentinel-requested-topic']
			})
		};
		expect(payload).toStrictEqual({
			...SENTINEL_PAYLOAD,
			domain: 'sentinel-requested-domain',
			topics: ['sentinel-requested-topic']
		});
	});
});

describe('POST /api/templates builds its payload only through the helper', () => {
	const routeSource = readFileSync('src/routes/api/templates/+server.ts', 'utf8');

	it('calls the helper from both success exits', () => {
		expect(routeSource.split('buildTemplateCreateResponse(').length - 1).toBe(2);
	});

	it('retains no hand-written copy of the payload', () => {
		expect(HAND_WRITTEN_FRAGMENTS).toHaveLength(7);
		for (const fragment of HAND_WRITTEN_FRAGMENTS) {
			expect(routeSource.split(fragment).length - 1).toBe(0);
		}
	});
});
