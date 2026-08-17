/**
 * The audience axis: institutional role mailbox vs natural person.
 *
 * The policy question is no longer "is this a government domain". It is "can a
 * natural person be on the receiving end". A registry grant survives as one
 * BASIS for an institutional verdict — never as a branch condition in the
 * hazard resolver, and never as the only way to earn the permissive set.
 *
 * The load-bearing property is asymmetric: only positive evidence promotes.
 * Every failure to measure — empty roster, malformed address, lexicon miss,
 * oversized roster — must land on `unevaluable` and the strict set.
 */
import { describe, expect, it } from 'vitest';
import {
	AUDIENCE_ROSTER_MAX,
	blockingHazardsForAudience,
	deriveAudience,
	publishedRosterRoutes,
	type AudienceForm,
	type AudienceRoute,
	type AudienceVerdict
} from '$lib/core/server/moderation/audience';

const ALL_FORMS = ['institutional', 'person-form', 'unevaluable'] as const;

describe('publishedRosterRoutes', () => {
	it('declares a nameless emails-only route explicitly', () => {
		expect(publishedRosterRoutes({ emails: ['office@victim.example'] })).toEqual([
			{ email: 'office@victim.example', name: null }
		]);
	});

	it('joins the denormalized emails lane to the first published name', () => {
		expect(
			publishedRosterRoutes({
				emails: ['board@hospital.org'],
				decisionMakers: [
					{ email: ' Board@Hospital.org ', name: 'Dana Ruiz' },
					{ email: 'board@hospital.org', name: 'Second Name' }
				]
			})
		).toEqual([{ email: 'board@hospital.org', name: 'Dana Ruiz' }]);
	});

	it('does not halve the roster ceiling by counting both producer lanes', () => {
		const emails = Array.from({ length: 11 }, (_, index) => `board@org${index}.example`);
		const decisionMakers = emails.map((email, index) => ({ email, name: `Person ${index}` }));
		expect(publishedRosterRoutes({ emails, decisionMakers })).toHaveLength(11);
	});

	it('keeps malformed evidence visible as an indeterminate route', () => {
		expect(publishedRosterRoutes({ emails: [42] })).toEqual([{ email: undefined, name: null }]);
	});
});

/** One representative verdict per branch of the union, built exhaustively. */
function verdictFor(form: AudienceForm): AudienceVerdict {
	switch (form) {
		case 'institutional':
			return { form, basis: 'seat-lexicon', routes: 1 };
		case 'person-form':
			return { form, basis: 'name-token-match', routes: 1 };
		case 'unevaluable':
			return { form, reason: 'no-roster', routes: 0 };
		default: {
			const unreachable: never = form;
			throw new Error(`unhandled audience form ${String(unreachable)}`);
		}
	}
}

describe('deriveAudience — institutional', () => {
	it.each([
		['board@hospital.org', 'a hospital board'],
		['press@utility.com', 'a utility press office'],
		['ombuds@university.edu', 'a university ombuds office'],
		['cityclerk@townofx.us', 'a municipal clerk outside any registry namespace']
	])('refuses a nameless role mailbox on %s — absence is not office evidence', (email) => {
		// The lexicon can classify the local part, but a route with no published
		// name cannot make a safety-policy claim about who reads the mailbox.
		expect(deriveAudience([{ email, name: null }])).toEqual({
			form: 'unevaluable',
			reason: 'indeterminate-route',
			routes: 1
		});
	});

	it('lets independent domain evidence attest a nameless published switchboard', () => {
		expect(
			deriveAudience([
				{ email: 'board@hospital.org', name: null },
				{ email: 'press@hospital.org', name: null }
			])
		).toEqual({ form: 'institutional', basis: 'seat-lexicon', routes: 2 });
	});

	it('keeps the government registry as a BASIS, covering a route the lexicon declines', () => {
		// `constituentservices` is not in the closed lexicon. Left to the lexicon
		// alone this route is indeterminate; the registry grant is what carries it.
		expect(deriveAudience([{ email: 'constituentservices@house.gov', name: null }])).toEqual({
			form: 'institutional',
			basis: 'government-registry',
			routes: 1
		});
	});

	it('reports the weaker seat basis when a registry route accompanies an attested switchboard', () => {
		expect(
			deriveAudience([
				{ email: 'press@senate.gov', name: null },
				{ email: 'board@hospital.org', name: null },
				{ email: 'press@hospital.org', name: null }
			])
		).toEqual({ form: 'institutional', basis: 'seat-lexicon', routes: 3 });
	});

	it('classifies a roster exactly at the ceiling', () => {
		const roster: AudienceRoute[] = Array.from({ length: AUDIENCE_ROSTER_MAX }, (_, index) => ({
			email: `board@org${index}.gov`,
			name: null
		}));
		expect(deriveAudience(roster)).toMatchObject({ form: 'institutional', routes: 20 });
	});
});

describe('deriveAudience — person-form', () => {
	it('derives person-form from a name-token match on a private-employer mailbox', () => {
		expect(deriveAudience([{ email: 'jane.smith@hospital.org', name: 'Jane Smith' }])).toEqual({
			form: 'person-form',
			basis: 'name-token-match',
			routes: 1
		});
	});

	it.each([
		[
			'person last',
			[
				{ email: 'board@hospital.org', name: null },
				{ email: 'jane.smith@hospital.org', name: 'Jane Smith' }
			]
		],
		[
			'person first',
			[
				{ email: 'jane.smith@hospital.org', name: 'Jane Smith' },
				{ email: 'board@hospital.org', name: null }
			]
		]
	])('lets one natural person carry a mixed roster (%s)', (_label, roster) => {
		expect(deriveAudience(roster)).toMatchObject({ form: 'person-form', routes: 2 });
	});

	it('lets a person-form route outrank an indeterminate one wherever it sits', () => {
		expect(
			deriveAudience([
				{ email: 'jsmith@acme.com', name: null },
				{ email: 'jane.smith@hospital.org', name: 'Jane Smith' }
			])
		).toMatchObject({ form: 'person-form' });
	});
});

describe('deriveAudience — unevaluable', () => {
	it('never promotes an indeterminate route to institutional', () => {
		expect(deriveAudience([{ email: 'jsmith@acme.com', name: null }])).toEqual({
			form: 'unevaluable',
			reason: 'indeterminate-route',
			routes: 1
		});
	});

	it('treats an empty roster as no verdict at all', () => {
		expect(deriveAudience([])).toEqual({ form: 'unevaluable', reason: 'no-roster', routes: 0 });
	});

	it.each([
		['a malformed address', { email: 'not-an-address', name: null }],
		['a missing address', { name: null }]
	])('declines on %s', (_label, route) => {
		expect(deriveAudience([route])).toMatchObject({
			form: 'unevaluable',
			reason: 'indeterminate-route'
		});
	});

	it('fails strict rather than classifying an over-ceiling roster', () => {
		// Every entry would classify institutional on its own. Above the ceiling
		// the roster is not classified at all — a big config costs bounded CPU and
		// buys no policy relaxation.
		const roster: AudienceRoute[] = Array.from(
			{ length: AUDIENCE_ROSTER_MAX + 1 },
			(_, index) => ({ email: `board@org${index}.gov`, name: null })
		);
		expect(deriveAudience(roster)).toEqual({
			form: 'unevaluable',
			reason: 'roster-too-large',
			routes: AUDIENCE_ROSTER_MAX + 1
		});
		expect(blockingHazardsForAudience(deriveAudience(roster))).toEqual(
			expect.arrayContaining(['S1', 'S4', 'S5', 'S7', 'S10'])
		);
	});
});

describe('blockingHazardsForAudience', () => {
	it('narrows to exactly S1/S4 for an institutional audience', () => {
		expect(blockingHazardsForAudience(verdictFor('institutional'))).toEqual(['S1', 'S4']);
	});

	it.each(['person-form', 'unevaluable'] as const)(
		'blocks exactly S1/S4/S5/S7/S10 for %s',
		(form) => {
			expect(blockingHazardsForAudience(verdictFor(form))).toEqual(['S1', 'S4', 'S5', 'S7', 'S10']);
		}
	);

	it('keeps S1 and S4 in every branch of the AudienceForm union', () => {
		// Exhaustion: `verdictFor` has a `never` default, so a fourth form cannot be
		// added to the union without failing to compile here.
		expect(ALL_FORMS).toHaveLength(3);
		for (const form of ALL_FORMS) {
			expect(blockingHazardsForAudience(verdictFor(form))).toEqual(
				expect.arrayContaining(['S1', 'S4'])
			);
		}
	});

	it('resolves on the FORM alone — basis and reason do not move the policy', () => {
		const seatBorne = blockingHazardsForAudience({
			form: 'institutional',
			basis: 'seat-lexicon',
			routes: 1
		});
		const registryBorne = blockingHazardsForAudience({
			form: 'institutional',
			basis: 'government-registry',
			routes: 1
		});
		// The count is not evidence either: the same basis over a wider roster
		// resolves identically.
		const wideRegistry = blockingHazardsForAudience({
			form: 'institutional',
			basis: 'government-registry',
			routes: AUDIENCE_ROSTER_MAX
		});
		expect(registryBorne).toEqual(seatBorne);
		expect(wideRegistry).toEqual(seatBorne);

		const noRoster = blockingHazardsForAudience({
			form: 'unevaluable',
			reason: 'no-roster',
			routes: 0
		});
		const indeterminate = blockingHazardsForAudience({
			form: 'unevaluable',
			reason: 'indeterminate-route',
			routes: 1
		});
		expect(indeterminate).toEqual(noRoster);

		// Same basis-invariance, but now the form moved: the policy must move too.
		expect(blockingHazardsForAudience(verdictFor('person-form'))).not.toEqual(seatBorne);
		expect(noRoster).not.toEqual(seatBorne);
	});
});
