import { describe, expect, it } from 'vitest';
import {
	normalizeReachesClaim,
	resolveEmailReachesClaim
} from '$lib/core/agents/utils/email-reaches';
import {
	CONTACT_SYNTHESIS_PROMPT,
	ROLE_DISCOVERY_PROMPT
} from '$lib/core/agents/prompts/decision-maker';

describe('normalizeReachesClaim', () => {
	it.each([
		['person', 'person'],
		[' SEAT ', 'seat'],
		['gEnErAl', 'general']
	] as const)('normalizes %j to %j', (raw, expected) => {
		expect(normalizeReachesClaim(raw)).toBe(expected);
	});

	it.each([undefined, null, '', 42, {}, 'PERSONAL'])('fails closed for %j', (raw) => {
		expect(normalizeReachesClaim(raw)).toBe('general');
	});
});

describe('resolveEmailReachesClaim', () => {
	it('keeps a grounded seat label with case-insensitive byte containment', () => {
		expect(
			resolveEmailReachesClaim({
				raw: ' SEAT ',
				rawLabel: ' media RELATIONS ',
				groundedPageText: 'Contact the Media Relations team for assistance.'
			})
		).toEqual({ claim: 'seat', label: 'media RELATIONS' });
	});

	it('downgrades an invented seat label and drops the label', () => {
		expect(
			resolveEmailReachesClaim({
				raw: 'seat',
				rawLabel: 'Office of the Superintendent',
				groundedPageText: 'General inquiries are accepted at contact@example.org.'
			})
		).toEqual({ claim: 'general' });
	});

	it('downgrades a seat claim without grounding-page text', () => {
		expect(
			resolveEmailReachesClaim({
				raw: 'seat',
				rawLabel: 'Planning Department',
				groundedPageText: undefined
			})
		).toEqual({ claim: 'general' });
	});

	it('downgrades a seat label longer than 160 characters', () => {
		const label = 'a'.repeat(161);
		expect(
			resolveEmailReachesClaim({
				raw: 'seat',
				rawLabel: label,
				groundedPageText: label
			})
		).toEqual({ claim: 'general' });
	});

	it('passes through an unvalidated person claim without a label', () => {
		expect(
			resolveEmailReachesClaim({
				raw: 'person',
				rawLabel: 'Planning Department',
				groundedPageText: undefined
			})
		).toEqual({ claim: 'person' });
	});
});

describe('contact synthesis prompt invariants', () => {
	it('removes the contradictory absolute instructions', () => {
		expect(CONTACT_SYNTHESIS_PROMPT).not.toContain('Never return NO_EMAIL_FOUND');
		expect(CONTACT_SYNTHESIS_PROMPT).not.toContain(
			'ANY level is better than NO_EMAIL_FOUND'
		);
		expect(CONTACT_SYNTHESIS_PROMPT).not.toContain('When a link is broken');
	});

	it('declares all reach classifications and the seat label', () => {
		expect(CONTACT_SYNTHESIS_PROMPT).toContain('"person"');
		expect(CONTACT_SYNTHESIS_PROMPT).toContain('"seat"');
		expect(CONTACT_SYNTHESIS_PROMPT).toContain('"general"');
		expect(CONTACT_SYNTHESIS_PROMPT).toContain('reaches_label');
	});

	it('keeps names forbidden during role discovery', () => {
		expect(ROLE_DISCOVERY_PROMPT).toContain("Do NOT include any person's name");
	});
});
