import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
				groundedPageText: 'Contact the Media Relations team for assistance.',
				hasPublicGroundingBasis: true
			})
		).toEqual({ claim: 'seat', label: 'media RELATIONS' });
	});

	it('downgrades an invented seat label and drops the label', () => {
		expect(
			resolveEmailReachesClaim({
				raw: 'seat',
				rawLabel: 'Office of the Superintendent',
				groundedPageText: 'General inquiries are accepted at contact@example.org.',
				hasPublicGroundingBasis: true
			})
		).toEqual({ claim: 'general' });
	});

	it('downgrades a seat claim without grounding-page text', () => {
		expect(
			resolveEmailReachesClaim({
				raw: 'seat',
				rawLabel: 'Planning Department',
				groundedPageText: undefined,
				hasPublicGroundingBasis: true
			})
		).toEqual({ claim: 'general' });
	});

	it('downgrades a seat claim whose grounding basis is absent', () => {
		expect(
			resolveEmailReachesClaim({
				raw: 'seat',
				rawLabel: 'Planning Department',
				groundedPageText: 'Reach the Planning Department at planning@city.gov.',
				hasPublicGroundingBasis: false
			})
		).toEqual({ claim: 'general' });
	});

	it('downgrades a seat label longer than 160 characters', () => {
		const label = 'a'.repeat(161);
		expect(
			resolveEmailReachesClaim({
				raw: 'seat',
				rawLabel: label,
				groundedPageText: label,
				hasPublicGroundingBasis: true
			})
		).toEqual({ claim: 'general' });
	});

	it('downgrades a single-character label that any page trivially contains', () => {
		expect(
			resolveEmailReachesClaim({
				raw: 'seat',
				rawLabel: ' A ',
				groundedPageText: 'A department page mentioning many letters.',
				hasPublicGroundingBasis: true
			})
		).toEqual({ claim: 'general' });
	});

	it('passes through an unvalidated person claim without a label', () => {
		expect(
			resolveEmailReachesClaim({
				raw: 'person',
				rawLabel: 'Planning Department',
				groundedPageText: undefined,
				hasPublicGroundingBasis: false
			})
		).toEqual({ claim: 'person' });
	});

	describe('non-English office pages', () => {
		it('verifies a Spanish office label', () => {
			expect(
				resolveEmailReachesClaim({
					raw: 'seat',
					rawLabel: 'Alcaldía Municipal',
					groundedPageText:
						'Alcaldía Municipal de San Miguel — escriba a alcaldia@sanmiguel.gob.sv para trámites.',
					hasPublicGroundingBasis: true
				})
			).toEqual({ claim: 'seat', label: 'Alcaldía Municipal' });
		});

		it('refuses a French label the page wrapped across a newline — a wrapped label is unverifiable', () => {
			// This reach is given up deliberately: separating one phrase a page
			// wrapped mid-line from two adjacent navigation items requires a
			// capitalization or line-length heuristic this module refuses to carry,
			// so the hard break wins and the claim falls back to 'general'.
			const label = "Mairie — Service de l'urbanisme";
			expect(
				resolveEmailReachesClaim({
					raw: 'seat',
					rawLabel: label,
					groundedPageText: "Mairie — Service\nde l'urbanisme\nurbanisme@ville.fr",
					hasPublicGroundingBasis: true
				})
			).toEqual({ claim: 'general' });
		});

		it('verifies a non-English seat label that the page prints inline', () => {
			expect(
				resolveEmailReachesClaim({
					raw: 'seat',
					rawLabel: 'Alcaldía Municipal',
					groundedPageText: 'Alcaldía Municipal de San Juan — alcalde@sanjuan.gob.mx',
					hasPublicGroundingBasis: true
				})
			).toEqual({ claim: 'seat', label: 'Alcaldía Municipal' });
		});

		it('verifies a German label supplied NFC against an NFD page', () => {
			const label = 'Bürgermeisterbüro'.normalize('NFC');
			const result = resolveEmailReachesClaim({
				raw: 'seat',
				rawLabel: label,
				groundedPageText:
					'Das Bürgermeisterbüro erreichen Sie unter buergermeister@stadt.de.'.normalize('NFD'),
				hasPublicGroundingBasis: true
			});
			expect(result).toEqual({ claim: 'seat', label });
			// The emitted label is the model's verbatim string, not the fold.
			expect(result.label).toBe(label);
		});

		it('verifies a German label supplied NFD against an NFC page', () => {
			const label = 'Bürgermeisterbüro'.normalize('NFD');
			const result = resolveEmailReachesClaim({
				raw: 'seat',
				rawLabel: label,
				groundedPageText:
					'Das Bürgermeisterbüro erreichen Sie unter buergermeister@stadt.de.'.normalize('NFC'),
				hasPublicGroundingBasis: true
			});
			expect(result).toEqual({ claim: 'seat', label });
			expect(result.label).toBe(label);
		});
	});

	describe('containment may not cross a hard line break', () => {
		const navigationList = 'Departments\nPlanning\nDepartment of Health\nParks';

		it('refuses a label assembled from two adjacent navigation items', () => {
			expect(
				resolveEmailReachesClaim({
					raw: 'seat',
					rawLabel: 'Planning Department',
					groundedPageText: navigationList,
					hasPublicGroundingBasis: true
				})
			).toEqual({ claim: 'general' });
		});

		it.each([
			['CR', '\r'],
			['CRLF', '\r\n'],
			['NEL U+0085', '\u0085'],
			// VT and FF were glue until this table covered them: a page that
			// separates list items with either one used to fold into a single
			// line, and 'Planning Department' matched a phrase never printed.
			['VERTICAL TAB U+000B', '\v'],
			['FORM FEED U+000C', '\f'],
			['LINE SEPARATOR U+2028', '\u2028'],
			['PARAGRAPH SEPARATOR U+2029', '\u2029']
		] as const)('refuses the same navigation list broken by %s', (_name, br) => {
			expect(
				resolveEmailReachesClaim({
					raw: 'seat',
					rawLabel: 'Planning Department',
					groundedPageText: `Departments${br}Planning${br}Department of Health${br}Parks`,
					hasPublicGroundingBasis: true
				})
			).toEqual({ claim: 'general' });
		});

		it('refuses a label that carries its own hard break', () => {
			expect(
				resolveEmailReachesClaim({
					raw: 'seat',
					rawLabel: 'Planning\nDepartment',
					groundedPageText: navigationList,
					hasPublicGroundingBasis: true
				})
			).toEqual({ claim: 'general' });
		});

		it('still folds a multi-space run inside one line', () => {
			expect(
				resolveEmailReachesClaim({
					raw: 'seat',
					rawLabel: 'Planning  Department',
					groundedPageText: 'Contact the Planning Department at planning@cityofx.gov',
					hasPublicGroundingBasis: true
				})
			).toEqual({ claim: 'seat', label: 'Planning  Department' });
		});
	});

	describe('claims the page does not support', () => {
		const soleProprietorPage =
			'Dr. Amara Osei has practiced family medicine here since 2011. ' +
			'Appointments and questions: office@oseifamilymed.example.';

		it('refuses a seat claim on a sole-proprietor page with no label', () => {
			expect(
				resolveEmailReachesClaim({
					raw: 'seat',
					rawLabel: undefined,
					groundedPageText: soleProprietorPage,
					hasPublicGroundingBasis: true
				})
			).toEqual({ claim: 'general' });
		});

		it('refuses a seat claim on a sole-proprietor page with an unmatched label', () => {
			expect(
				resolveEmailReachesClaim({
					raw: 'seat',
					rawLabel: 'Practice Administration Office',
					groundedPageText: soleProprietorPage,
					hasPublicGroundingBasis: true
				})
			).toEqual({ claim: 'general' });
		});

		it('gives a seat-shaped local part no vote when the label is absent from the page', () => {
			// `clerk@` is a lexicon word; the page never names a clerk's office,
			// so the label — not the mailbox spelling — decides.
			expect(
				resolveEmailReachesClaim({
					raw: 'seat',
					rawLabel: 'Office of the Clerk',
					groundedPageText: 'Write to clerk@county.example with questions about the meeting.',
					hasPublicGroundingBasis: true
				})
			).toEqual({ claim: 'general' });
		});
	});
});

describe('claim path lexicon independence', () => {
	it('imports no word list that could decide a seat claim', () => {
		const source = readFileSync(
			join(process.cwd(), 'src/lib/core/agents/utils/email-reaches.ts'),
			'utf8'
		);

		for (const symbol of ['SEAT_LOCAL_PARTS', 'CLOSED_SEAT_LOCAL_PARTS', 'PUBLIC_ROLE_LOCAL_PARTS']) {
			expect(source).not.toContain(symbol);
		}
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
