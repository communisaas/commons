/**
 * recipient_config vocabulary contract.
 *
 * One JSON blob is persisted on a template describing who the message reaches.
 * It has exactly one interface (`RecipientConfig`), one parser
 * (`parseRecipientConfig`), one read-side email extractor
 * (`recipientEmailsFromConfig`) and one build-side collector
 * (`collectRecipientEmails`). These tests pin that collapse — both the runtime
 * surface and the source text — and pin the read/presentation behavior the
 * blob's consumers depend on.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import type {
	CustomRecipient,
	ProcessedDecisionMaker,
	RecipientConfig,
	Template
} from '$lib/types/template';
import { parseRecipientConfig, recipientEmailsFromConfig } from '$lib/types/template';
import * as derive from '$lib/utils/deriveTargetPresentation';
import { deriveTargetPresentation } from '$lib/utils/deriveTargetPresentation';
import * as templateConfig from '$lib/types/templateConfig';
import * as dmProcessing from '$lib/utils/decision-maker-processing';
import { collectRecipientEmails } from '$lib/utils/decision-maker-processing';
import { mergeLandscape } from '$lib/utils/landscapeMerge';

// ============================================================================
// Fixtures
// ============================================================================

function makeTemplate(overrides: Partial<Template> = {}): Template {
	return {
		id: 'template-1',
		slug: 'template-1',
		title: 'Title',
		description: 'Description',
		domain: 'advocacy',
		type: 'direct',
		deliveryMethod: 'email',
		message_body: 'Body',
		delivery_config: {},
		recipient_config: {},
		coordinationScale: 0,
		isNew: false,
		status: 'published',
		is_public: true,
		send_count: 0,
		preview: 'Preview',
		createdAt: new Date(0),
		updatedAt: new Date(0),
		...overrides
	};
}

function makeProcessedDecisionMaker(
	overrides: Partial<ProcessedDecisionMaker> & { name: string }
): ProcessedDecisionMaker {
	return {
		title: 'Director',
		organization: 'Agency',
		provenance: '',
		reasoning: '',
		isAiResolved: true,
		...overrides
	};
}

// ============================================================================
// Single vocabulary — runtime
// ============================================================================

describe('single recipient_config vocabulary at runtime', () => {
	it('exposes the parser from the types module only', () => {
		expect('parseRecipientConfig' in derive).toBe(false);
		expect(typeof parseRecipientConfig).toBe('function');
	});

	it('drops the recipient guard and extractor from the config module', () => {
		expect('extractRecipientEmails' in templateConfig).toBe(false);
		expect('isValidRecipientConfig' in templateConfig).toBe(false);
		expect('isValidDeliveryConfig' in templateConfig).toBe(true);
	});

	it('names the build-side collector distinctly from the read-side extractor', () => {
		expect('extractRecipientEmails' in dmProcessing).toBe(false);
		expect('collectRecipientEmails' in dmProcessing).toBe(true);
	});
});

// ============================================================================
// Single vocabulary — source text
// ============================================================================

describe('single recipient_config vocabulary in source', () => {
	const FILES = {
		template: 'src/lib/types/template.ts',
		templateConfig: 'src/lib/types/templateConfig.ts',
		anyReplacements: 'src/lib/types/any-replacements.ts',
		derivePresentation: 'src/lib/utils/deriveTargetPresentation.ts',
		decisionMakerProcessing: 'src/lib/utils/decision-maker-processing.ts'
	} as const;

	const sources = Object.fromEntries(
		Object.entries(FILES).map(([key, path]) => [key, readFileSync(path, 'utf8')])
	) as Record<keyof typeof FILES, string>;

	const occurrences = (haystack: string, needle: string) => haystack.split(needle).length - 1;

	it('declares the interface exactly once, in the types module', () => {
		const total = Object.values(sources).reduce(
			(sum, source) => sum + occurrences(source, 'export interface RecipientConfig'),
			0
		);
		expect(total).toBe(1);
		expect(occurrences(sources.template, 'export interface RecipientConfig')).toBe(1);
	});

	it('retains no superseded recipient shapes or guards', () => {
		for (const name of ['DisplayRecipientConfig', 'TemplateRecipientConfig', 'isValidRecipientConfig']) {
			for (const [file, source] of Object.entries(sources)) {
				expect(`${file}:${occurrences(source, name)}`).toBe(`${file}:0`);
			}
		}
	});
});

// ============================================================================
// Producer parity — the two shapes actually written
// ============================================================================

describe('producer shapes typecheck and round-trip', () => {
	const creatorShape: RecipientConfig = {
		reach: 'location-specific',
		emails: ['mayor@city.gov'],
		decisionMakers: [
			makeProcessedDecisionMaker({
				name: 'London Breed',
				title: 'Mayor',
				organization: 'City of San Francisco',
				email: 'mayor@city.gov'
			})
		],
		cwcRouting: undefined
	};

	const seedShape: RecipientConfig = {
		reach: 'district-based',
		chambers: ['house', 'senate'],
		cwcRouting: true,
		decisionMakers: [
			{
				name: 'Peter Kaboli',
				role: 'Executive Director, Office of Rural Health',
				shortName: 'Kaboli',
				organization: 'U.S. Department of Veterans Affairs',
				email: 'VAQS@va.gov',
				roleCategory: 'executes'
			}
		]
	};

	it('round-trips the creator publish payload', () => {
		expect(parseRecipientConfig(creatorShape)).toEqual(creatorShape);
	});

	it('round-trips a seed fixture payload', () => {
		expect(parseRecipientConfig(seedShape)).toEqual(seedShape);
	});

	it('rejects keys no producer writes', () => {
		// @ts-expect-error `recipientEmails` is not a persisted recipient_config key
		const withRecipientEmails: RecipientConfig = { recipientEmails: [] };
		// @ts-expect-error `includesCongress` is form state, never persisted on the blob
		const withIncludesCongress: RecipientConfig = { includesCongress: true };
		expect(withRecipientEmails).toBeDefined();
		expect(withIncludesCongress).toBeDefined();
	});
});

// ============================================================================
// Read side
// ============================================================================

describe('recipientEmailsFromConfig', () => {
	it.each([
		[null, []],
		[undefined, []],
		[{}, []],
		[{ emails: [] }, []],
		[{ emails: 'a@b.c' }, []],
		// junk elements are dropped individually, never all-or-nothing
		[{ emails: ['a@b.c', 123, null] }, ['a@b.c']],
		[{ emails: ['a@b.c'] }, ['a@b.c']],
		[[], []],
		[
			{
				reach: 'district-based',
				decisionMakers: [
					{ name: 'First', email: 'first@agency.gov' },
					{ name: 'No email' },
					{ name: 'Second', email: 'second@agency.gov' }
				]
			},
			['first@agency.gov', 'second@agency.gov']
		],
		[{ emails: [], decisionMakers: [{ name: 'X' }] }, []]
	])('extracts %p as %p', (input, expected) => {
		expect(recipientEmailsFromConfig(input)).toEqual(expected);
	});

	it('parses a JSON string blob', () => {
		expect(recipientEmailsFromConfig(JSON.stringify({ emails: ['a@b.c'] }))).toEqual(['a@b.c']);
	});

	it('returns nothing for an unparseable string blob', () => {
		expect(recipientEmailsFromConfig('{not json')).toEqual([]);
	});

	it('ignores a stray form-state key on the blob', () => {
		const withStray = { emails: ['a@b.c'], includesCongress: true };
		expect(recipientEmailsFromConfig(withStray)).toEqual(['a@b.c']);
		expect(parseRecipientConfig(withStray)).toEqual(withStray);
		expect(deriveTargetPresentation(makeTemplate({ recipient_config: withStray }))).toEqual(
			deriveTargetPresentation(makeTemplate({ recipient_config: { emails: ['a@b.c'] } }))
		);
	});
});

// ============================================================================
// Presentation
// ============================================================================

describe('deriveTargetPresentation', () => {
	it('presents congressional plus local reach as multi-level', () => {
		const presentation = deriveTargetPresentation(
			makeTemplate({
				recipient_config: {
					cwcRouting: true,
					decisionMakers: [{ name: 'London Breed', organization: 'City of San Francisco' }]
				}
			})
		);
		expect(presentation.type).toBe('multi-level');
	});

	it('presents a congressional template with no decision-makers as district-based', () => {
		const presentation = deriveTargetPresentation(
			makeTemplate({ deliveryMethod: 'cwc', recipient_config: {} })
		);
		expect(presentation).toMatchObject({
			type: 'district-based',
			primary: 'Your 3 representatives'
		});
	});

	it('presents decision-makers alone as location-specific', () => {
		const presentation = deriveTargetPresentation(
			makeTemplate({
				recipient_config: {
					decisionMakers: [
						{ name: 'London Breed', organization: 'City of San Francisco' },
						{ name: 'Board Member', organization: 'City of San Francisco' }
					]
				}
			})
		);
		expect(presentation).toMatchObject({
			type: 'location-specific',
			primary: 'City of San Francisco',
			secondary: '+1 more'
		});
	});

	it('presents emails alone as a decision-maker count', () => {
		const presentation = deriveTargetPresentation(
			makeTemplate({ recipient_config: { emails: ['a@b.c', 'd@e.f'] } })
		);
		expect(presentation).toMatchObject({
			type: 'location-specific',
			primary: '2 decision-makers'
		});
	});

	it('presents an empty blob as universal direct delivery', () => {
		const presentation = deriveTargetPresentation(makeTemplate({ recipient_config: {} }));
		expect(presentation).toMatchObject({
			type: 'universal',
			primary: 'Direct delivery'
		});
	});

	it('resolves a JSON string blob to its real presentation', () => {
		const presentation = deriveTargetPresentation(
			makeTemplate({
				recipient_config: JSON.stringify({
					decisionMakers: [{ name: 'London Breed', organization: 'City of San Francisco' }]
				})
			})
		);
		expect(presentation).toMatchObject({
			type: 'location-specific',
			primary: 'City of San Francisco'
		});
	});
});

// ============================================================================
// Landscape merge over the persisted decision-maker shape
// ============================================================================

describe('mergeLandscape over hand-authored decision-makers', () => {
	it('falls back to the human role label and tolerates a missing organization', () => {
		const landscape = mergeLandscape([{ name: 'London Breed', role: 'Mayor' }]);
		const members = landscape.roleGroups.flatMap((group) => group.members);
		expect(members).toHaveLength(1);
		expect(members[0]).toMatchObject({
			name: 'London Breed',
			title: 'Mayor',
			organization: ''
		});
	});
});

// ============================================================================
// Build side
// ============================================================================

describe('collectRecipientEmails', () => {
	const decisionMakers: ProcessedDecisionMaker[] = [
		makeProcessedDecisionMaker({ name: 'First', email: 'first@agency.gov' }),
		makeProcessedDecisionMaker({ name: 'No email' }),
		makeProcessedDecisionMaker({ name: 'Second', email: 'second@agency.gov' })
	];
	const customRecipients: CustomRecipient[] = [{ name: 'Custom', email: 'custom@example.org' }];

	it('orders decision-makers, then custom recipients, then the congressional relay', () => {
		expect(collectRecipientEmails(decisionMakers, customRecipients, true)).toEqual([
			'first@agency.gov',
			'second@agency.gov',
			'custom@example.org',
			'congress@commons.email'
		]);
	});

	it('omits the congressional relay when the template does not route to Congress', () => {
		expect(collectRecipientEmails(decisionMakers, customRecipients, false)).toEqual([
			'first@agency.gov',
			'second@agency.gov',
			'custom@example.org'
		]);
	});
});
