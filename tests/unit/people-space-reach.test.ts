import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	NO_PEOPLE_SENTENCE,
	NO_SOURCE_RECORDS_SENTENCE,
	PEOPLE_UNAVAILABLE_SENTENCE,
	describeEmailReach,
	describePeopleOnFile,
	describeTextReach
} from '$lib/components/org/os/people-reach';
import { PLATFORM_SYNC_PATH_SENTENCE } from '$lib/data/org-limit-sentences';
import type { BaseSpaceData } from '$lib/components/org/os/spaces';

function makeEmailHealth(
	overrides: Partial<BaseSpaceData['emailHealth']> = {}
): BaseSpaceData['emailHealth'] {
	return { subscribed: 1204, unsubscribed: 18, bounced: 2, complained: 1, ...overrides };
}

function makeSmsHealth(
	overrides: Partial<BaseSpaceData['smsHealth']> = {}
): BaseSpaceData['smsHealth'] {
	return { subscribed: 342, unsubscribed: 10, stopped: 4, none: 1784, phonePresent: 612, ...overrides };
}

describe('your list sentence', () => {
	it('reads the total and funnel in plain words with locale formatting', () => {
		expect(
			describePeopleOnFile({ total: 2140, postalResolved: 1890, identityVerified: 412 })
		).toBe('2,140 people · 1,890 with usable addresses · 412 identity-verified');
	});

	it('omits zero stages instead of rendering bare zeros', () => {
		expect(describePeopleOnFile({ total: 12, postalResolved: 0, identityVerified: 0 })).toBe(
			'12 people'
		);
	});

	it('uses the singular for a list of one', () => {
		expect(describePeopleOnFile({ total: 1, postalResolved: 1, identityVerified: 0 })).toBe(
			'1 person · 1 with usable addresses'
		);
	});
});

describe('email reach sentence', () => {
	it('traces each number to the summary list-health fields', () => {
		expect(describeEmailReach(makeEmailHealth())).toBe(
			'1,204 reachable by email · 18 unsubscribed · 3 bounced or complained'
		);
	});

	it('omits zero buckets instead of rendering them', () => {
		expect(
			describeEmailReach(makeEmailHealth({ unsubscribed: 0, bounced: 0, complained: 0 }))
		).toBe('1,204 reachable by email');
	});

	it('phrases zero reachable as a sentence, not a zero', () => {
		const sentence = describeEmailReach(
			makeEmailHealth({ subscribed: 0, unsubscribed: 5, bounced: 1, complained: 0 })
		);
		expect(sentence).toMatch(/^No one is reachable by email/);
		expect(sentence).toContain('5 unsubscribed');
	});

	it('phrases a list with no recorded reach as a quiet sentence', () => {
		expect(
			describeEmailReach(
				makeEmailHealth({ subscribed: 0, unsubscribed: 0, bounced: 0, complained: 0 })
			)
		).toMatch(/^No email reach recorded yet/);
	});
});

describe('text reach sentence', () => {
	it('groups opted-out and stopped, and counts phones on file', () => {
		expect(describeTextReach(makeSmsHealth())).toBe(
			'342 opted in to texts · 14 opted out · 612 with a phone number on file'
		);
	});

	it('phrases a list with no phone numbers as a sentence about the missing column', () => {
		expect(describeTextReach(makeSmsHealth({ phonePresent: 0 }))).toMatch(
			/^No phone numbers on file/
		);
	});

	it('phrases zero opt-ins as a sentence, not a zero', () => {
		expect(describeTextReach(makeSmsHealth({ subscribed: 0 }))).toMatch(
			/^No text opt-ins recorded yet/
		);
	});
});

describe('plain absence sentences', () => {
	it('phrases empty, unavailable, and unrecorded states as quiet sentences', () => {
		expect(NO_PEOPLE_SENTENCE).toBe('No people yet — import your first list.');
		expect(PEOPLE_UNAVAILABLE_SENTENCE).toMatch(/not zero/);
		expect(NO_SOURCE_RECORDS_SENTENCE).toMatch(/^No source records yet/);
	});
});

describe('platform sync path sentence', () => {
	it('names the live sync path and the CSV path in one plain sentence', () => {
		expect(PLATFORM_SYNC_PATH_SENTENCE).toMatch(/syncs directly/);
		expect(PLATFORM_SYNC_PATH_SENTENCE).toMatch(/CSV/);
	});
});

describe('People surface contract', () => {
	const source = readFileSync('src/lib/components/org/os/BaseSpace.svelte', 'utf8');

	it('sections the surface by the org questions in plain words', () => {
		expect(source).toContain('Your list');
		expect(source).toContain('Where they came from');
		expect(source).toContain('Can you reach them');
		expect(source).toContain('Permission on file');
		expect(source).toContain('Saved segments');
	});

	it('keeps the verification funnel mounted and the deep links resolvable', () => {
		expect(source).toContain("'$lib/components/org/VerificationPipeline.svelte'");
		expect(source).toContain('{base}/supporters/import');
		expect(source).toContain('{base}/supporters/import/platform-api');
		expect(source).toContain('{base}/supporters#people-segments');
	});

	it('sources the platform-sync bound from the shared limit-sentence module', () => {
		expect(source).toContain("from '$lib/data/org-limit-sentences'");
		expect(source).toContain('PLATFORM_SYNC_PATH_SENTENCE');
	});

	it('labels import origins through the shared source-label formatter', () => {
		expect(source).toContain("from '$lib/data/platform-export-profiles'");
		expect(source).toContain('formatPeopleSourceLabel');
	});

	// Excised vocabulary is assembled from fragments so it never appears
	// verbatim in this file either.
	const MACHINERY_IMPORTS = new RegExp(
		[
			'capability-hyper' + 'graph',
			'capability-state-' + 'labels',
			'capability-' + 'clusters',
			'WorkspaceCapability' + 'Strip',
			'GateEvi' + 'dence',
			'Readi' + 'ness'
		].join('|')
	);
	const ED = 'ed';
	const INTERNAL_VOCABULARY = new RegExp(
		`\\b(arm${ED}|not arm${ED}|bound${ED}|draft-on${'ly'}|gat${ED}|postur${'e'}|handof${'f'})\\b`,
		'i'
	);

	it('imports none of the internal capability machinery', () => {
		expect(source).not.toMatch(MACHINERY_IMPORTS);
	});

	it('carries no internal state vocabulary or planning identifiers', () => {
		expect(source).not.toMatch(INTERNAL_VOCABULARY);
		expect(source).not.toMatch(/\bCP-/);
		expect(source).not.toMatch(/\bT\d+-\d+\b/);
	});

	it('keeps provenance whispers off the surface', () => {
		expect(source).not.toMatch(new RegExp('cite' + '='));
	});
});
