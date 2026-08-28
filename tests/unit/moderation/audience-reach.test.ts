/**
 * How many real institutions the audience policy can actually reach.
 *
 * The send-time moderation policy picks its hazard set from one verdict: an
 * `institutional` audience blocks `['S1','S4']`, everything else blocks
 * `['S1','S4','S5','S7','S10']`. Narrowing that set is the whole reason the
 * audience axis exists, and until this file there was nothing in the tree that
 * counted how often the narrowing actually fires. `audience.ts` invents
 * `seat-lexicon-unattested` so an operator "can COUNT exactly how much reach the
 * attestation rule costs", and `seat-route.ts` writes down that "a decline costs
 * reach" — both state the requirement and neither supplies a counter. This is
 * the counter.
 *
 * Reach is a gate, not a hope. A change that closes a hole by collapsing the
 * axis to all-unevaluable is not a fix; it is a dead axis wearing a green suite.
 * So the surviving institutional rows are pinned individually and resolved
 * through `blockingHazardsForAudience`, never through the label alone: a relabel
 * that does not really restore `['S1','S4']` fails here.
 *
 * Every fixture is fed to the real public reader before the policy sees it. A
 * row is assembled as a full `decisionMakers[]` entry and published by
 * `audience-producer-harness.ts` — the one producer chain in this directory,
 * which validates through the same reader an anonymous page load runs — and only
 * then parsed and folded into routes. That ordering is the
 * point: measured on `deriveAudience` in isolation, a census will happily report
 * reach for an artifact production can never emit. One row here proves it, since
 * its address is refused at publication and never reaches the audience question
 * at all; it is counted as a publication refusal, separately from audience
 * misses, so a later change to the publication lexicon has to come to this file
 * and say so — as one just did, which is why this paragraph says one row and not
 * two (see `PUBLICATION_REFUSED_BASELINE`).
 *
 * The rows that resolve strict today are counted rather than pinned, precisely
 * so an honest improvement turns this file green instead of red. The reach
 * counter is a floor. What is pinned hard is the other direction: three
 * producer-valid abuse rows — a sole proprietor, a one-person practice, and a
 * forged switchboard on a consumer provider — keep the full person floor, so
 * "reach went up" can never be bought by promoting a natural person.
 *
 * Every row is measured ONCE, as an author publishes it today. This table used to
 * run a second pass with an HMAC-covered `reaches: 'seat'` term stapled onto every
 * row, and the two passes reported the identical number on the identical set of
 * rows — the term was measured at exactly +0 and was then deleted from the row,
 * the publication crossing and the signed preimage. The second pass is gone with
 * it: a census pass that can only ever restate the first is not a measurement.
 */
import { describe, expect, it } from 'vitest';
import {
	audienceFor,
	publishRoster,
	INSTITUTIONAL_HAZARDS,
	PERSON_HAZARDS,
	type DeliveryMethod,
	type PublishedRow
} from './audience-producer-harness';
import {
	blockingHazardsForAudience,
	type AudienceVerdict
} from '$lib/core/server/moderation/audience';

/** The number of table rows that resolve `institutional` today. A FLOOR. */
export const INSTITUTIONAL_REACH_BASELINE = 4;

/**
 * Table rows the publication lexicon refuses before the axis is consulted. EXACT.
 *
 * It was 2 and is now 1. R10 (`boardofeducation@exampleschools.org`) MOVED:
 * `boardofeducation` was already a member of the seat lexicon while being refused
 * at publication, and `convex/lib/publicRoleAddress.ts` admitted it — along with
 * eleven other words in the same position — so the row now publishes and gets a
 * verdict instead of a throw. R9 (`alcalde@ciudaddeejemplo.mx`) is the survivor:
 * `alcalde` is in NEITHER list, and that admission added no non-English
 * vocabulary, so the non-English refusal this table records is untouched.
 */
export const PUBLICATION_REFUSED_BASELINE = 2;

/**
 * The reader's refusal, matched on its prefix. Measured, not assumed: the throw
 * fires at the `emails` array gate before any `decisionMakers` row is read, so
 * the message carries no `.decisionMakers.<i>.provenance` suffix. Kept loose on
 * purpose — if the check order ever moves, this still records a refusal at
 * publication rather than going red for the wrong reason.
 */
const PUBLICATION_REFUSED = /^PUBLIC_TEMPLATE_DETAIL_PROJECTION_INVALID:recipient_config/;

type ReachExpectation = 'institutional' | 'currently-strict' | 'publication-refused';

type ReachRow = {
	id: string;
	label: string;
	deliveryMethod: DeliveryMethod;
	expect: ReachExpectation;
	rows: PublishedRow[];
};

/**
 * Eleven institutional targets a real campaign would name. Each address is
 * published exactly as an author would publish it, with a name beside it — the
 * public projection requires one.
 */
const REACH_TABLE: ReachRow[] = [
	{
		id: 'R1',
		label: 'county board of commissioners',
		deliveryMethod: 'email',
		expect: 'currently-strict',
		rows: [
			{
				email: 'commissioners@countyofexample.gov',
				name: 'Board of Commissioners',
				organization: 'Example County'
			}
		]
	},
	{
		id: 'R2',
		label: 'hospital switchboard',
		deliveryMethod: 'email',
		expect: 'currently-strict',
		rows: [
			{
				email: 'patientrelations@stmaryshealth.org',
				name: 'Patient Relations',
				organization: "St Mary's Health"
			},
			{
				email: 'info@stmaryshealth.org',
				name: 'Information Desk',
				organization: "St Mary's Health"
			}
		]
	},
	{
		id: 'R3',
		label: 'municipal utility',
		deliveryMethod: 'email',
		expect: 'currently-strict',
		rows: [
			{
				email: 'customerservice@exampleutility.com',
				name: 'Customer Service',
				organization: 'Example Utility'
			},
			{ email: 'billing@exampleutility.com', name: 'Billing', organization: 'Example Utility' }
		]
	},
	{
		id: 'R4',
		label: 'university provost and registrar',
		deliveryMethod: 'email',
		expect: 'institutional',
		rows: [
			{
				email: 'provost@example.edu',
				name: 'Office of the Provost',
				organization: 'Example University'
			},
			{
				email: 'registrar@example.edu',
				name: 'Office of the Registrar',
				organization: 'Example University'
			}
		]
	},
	{
		id: 'R5',
		label: 'school board',
		deliveryMethod: 'email',
		expect: 'currently-strict',
		rows: [
			{
				email: 'board@exampleschools.org',
				name: 'Board of Education',
				organization: 'Example Schools'
			}
		]
	},
	{
		id: 'R6',
		label: 'city hall clerk',
		deliveryMethod: 'email',
		expect: 'institutional',
		rows: [
			{ email: 'cityclerk@cityofexample.gov', name: 'City Clerk', organization: 'City of Example' }
		]
	},
	{
		// STRICT, and the honest reason is a residual rather than a rule. Both local
		// parts are closed-lexicon seats (`investorrelations`, `press`), so the
		// desks really are there; what declines is VETO 2 reading the published
		// NAME. `nameIsRoleLabel` tokenizes "Investor Relations" into `investor` +
		// `relations`, drops `relations` as a connective stopword, and is left with
		// `investor` — not a seat word — so a human is counted at the domain.
		// Rejoining the tokens across the dropped connective would read the label as
		// the closed compound `investorrelations` it spells, and that was TRIED and
		// REVERTED: the same guarded join promotes `nameIsRoleLabel('Medi A')` to
		// true off `media`, and a natural person loses the floor. This row stays
		// strict on purpose, and recovering it needs a name-side vocabulary that
		// preserves word boundaries — not a join into local-part space.
		id: 'R7',
		label: 'corporate investor and press desks',
		deliveryMethod: 'email',
		expect: 'currently-strict',
		rows: [
			{
				email: 'investorrelations@examplecorp.com',
				name: 'Investor Relations',
				organization: 'Example Corp'
			},
			{ email: 'press@examplecorp.com', name: 'Press Office', organization: 'Example Corp' }
		]
	},
	{
		// `cwc`, not `certified`. `TEMPLATE_DELIVERY_METHODS` is the closed set
		// `['cwc','email']`; `certified` is an authoring CHANNEL id that collapses
		// to `cwc` before it is stored, so a `certified` fixture would describe a
		// column value production cannot emit — the exact error this file exists to
		// prevent one level up.
		id: 'R8',
		label: 'congressional intake via the certified relay',
		deliveryMethod: 'cwc',
		expect: 'institutional',
		rows: [{ email: 'info@house.gov', name: 'Constituent Services', organization: 'US House' }]
	},
	{
		id: 'R9',
		label: 'non-English mayoral office',
		deliveryMethod: 'email',
		expect: 'publication-refused',
		rows: [
			{
				email: 'alcalde@ciudaddeejemplo.mx',
				name: 'Oficina del Alcalde',
				organization: 'Ciudad de Ejemplo'
			}
		]
	},
	{
		// MOVED off `publication-refused`. `boardofeducation` is now a
		// `PUBLIC_ROLE_LOCAL_PARTS` member, so the reader publishes the row and the
		// audience question is finally asked of it. MEASURED verdict:
		// `unevaluable / seat-lexicon-unattested`. It classifies as a SEAT — it was
		// a `CLOSED_SEAT_LOCAL_PARTS` member the whole time — and it still does not
		// reach, because `domainAttestsAnOffice`'s `>= 2` distinct-desk COUNT is not
		// met: `boardofeducation@` is the ONLY desk local part on
		// `exampleschools.org` in this row. (R5 publishes `board@` at the same
		// domain, but each row is measured as its own roster, exactly as an author
		// publishes it.) The unmet count is measured to be independently sufficient:
		// republished with a pure role label ("Board"), which clears VETO 2, the one
		// desk still resolves `unevaluable / seat-lexicon-unattested`, and adding a
		// second desk at the domain is what flips it to `institutional`. As actually
		// published here VETO 2 fires first and also declines, since
		// `nameIsRoleLabel('Board of Education')` is false — `education` is not a
		// seat word. Either way the audience policy did not change: admission bought
		// PUBLICATION, not reach, and reading this move as an institutional gain
		// would be a misreading.
		id: 'R10',
		label: 'unlisted compound role word',
		deliveryMethod: 'email',
		expect: 'publication-refused',
		rows: [
			{
				email: 'boardofeducation@exampleschools.org',
				name: 'Board of Education',
				organization: 'Example Schools'
			}
		]
	},
	{
		id: 'R11',
		label: 'press office at a .gov',
		deliveryMethod: 'email',
		expect: 'institutional',
		rows: [{ email: 'press@example.gov', name: 'Press Office', organization: 'Example Agency' }]
	}
];

type RowOutcome =
	| { kind: 'verdict'; verdict: AudienceVerdict }
	| { kind: 'refused'; message: string };

/**
 * Run one row all the way through. A publication refusal is a countable outcome;
 * ANY other error is a broken fixture and reaches the runner unchanged, so this
 * census can never report a number it did not actually measure.
 */
function measure(row: ReachRow): RowOutcome {
	let routes: ReturnType<typeof publishRoster>;
	try {
		routes = publishRoster(row.rows, row.deliveryMethod);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (!PUBLICATION_REFUSED.test(message)) throw error;
		return { kind: 'refused', message };
	}
	return { kind: 'verdict', verdict: audienceFor(routes, row.deliveryMethod) };
}

const PINNED_INSTITUTIONAL = REACH_TABLE.filter((row) => row.expect === 'institutional');
const CURRENTLY_STRICT = REACH_TABLE.filter((row) => row.expect === 'currently-strict');
const REFUSED_AT_PUBLICATION = REACH_TABLE.filter((row) => row.expect === 'publication-refused');

describe('the institutional reach the audience policy actually has', () => {
	it.each(PINNED_INSTITUTIONAL.map((row) => [`${row.id} ${row.label}`, row] as const))(
		'keeps %s institutional, with the narrowed hazard set',
		(_label, row) => {
			const outcome = measure(row);

			expect(outcome.kind).toBe('verdict');
			if (outcome.kind !== 'verdict') return;
			expect(outcome.verdict.form).toBe('institutional');
			// Through the resolver, never through the label: a verdict that says
			// "institutional" and does not actually narrow the set fails here.
			expect(blockingHazardsForAudience(outcome.verdict)).toEqual(INSTITUTIONAL_HAZARDS);
		}
	);

	it.each(CURRENTLY_STRICT.map((row) => [`${row.id} ${row.label}`, row] as const))(
		'resolves %s to one of the two real hazard sets',
		(_label, row) => {
			const outcome = measure(row);

			expect(outcome.kind).toBe('verdict');
			if (outcome.kind !== 'verdict') return;
			// Deliberately NOT pinned strict. These rows are the reach a future
			// entity-level signal would have to win back honestly; when one does, this
			// file goes green. What is required is that a verdict was measured at all —
			// an absent or malformed one cannot be quietly counted as reach.
			const hazards = blockingHazardsForAudience(outcome.verdict);
			expect([INSTITUTIONAL_HAZARDS, PERSON_HAZARDS]).toContainEqual(hazards);
		}
	);

	it.each(REFUSED_AT_PUBLICATION.map((row) => [`${row.id} ${row.label}`, row] as const))(
		'never lets %s reach the audience question — the reader refuses it',
		(_label, row) => {
			expect(() => publishRoster(row.rows, row.deliveryMethod)).toThrow(PUBLICATION_REFUSED);
		}
	);

	it('reports institutional reach as a number, and holds it as a floor', () => {
		const outcomes = REACH_TABLE.map((row) => ({ row, outcome: measure(row) }));

		const institutional = outcomes.filter(
			({ outcome }) => outcome.kind === 'verdict' && outcome.verdict.form === 'institutional'
		);
		const refused = outcomes.filter(({ outcome }) => outcome.kind === 'refused');

		// A floor, so an honest improvement passes and a silent collapse does not.
		expect(institutional.length).toBeGreaterThanOrEqual(INSTITUTIONAL_REACH_BASELINE);

		// Exact: a node that changes the publication lexicon must come here and say
		// so, in either direction.
		expect(refused.length).toBe(PUBLICATION_REFUSED_BASELINE);

		// Every row is accounted for — nothing disappears between the two counts.
		expect(outcomes).toHaveLength(11);
		expect(
			outcomes.filter(({ outcome }) => outcome.kind === 'verdict').length + refused.length
		).toBe(outcomes.length);
	});

	it('names which rows carry the reach, so a swap cannot hide behind the total', () => {
		const institutionalIds = REACH_TABLE.filter((row) => {
			const outcome = measure(row);
			return outcome.kind === 'verdict' && outcome.verdict.form === 'institutional';
		}).map((row) => row.id);

		// EXACT, not `arrayContaining`. The total is a floor and can honestly rise;
		// the NAMES are what stop a future rule trading one of these rows away for
		// two others and reporting it as a gain. Four rows, matching
		// `INSTITUTIONAL_REACH_BASELINE` beside it.
		expect(institutionalIds).toEqual(['R4', 'R6', 'R8', 'R11']);
	});
});

/**
 * The counterweight. Every local part below is publishable, so each really can
 * appear on a public page — which is what makes them the honest test of whether
 * a reach gain was bought by promoting a natural person.
 */
describe('reach that must never be bought by promoting a natural person', () => {
	it.each<[string, PublishedRow[]]>([
		[
			'a sole proprietor behind a catch-all',
			[
				{
					email: 'office@smithproperties.com',
					name: 'John Smith',
					organization: 'Smith Properties'
				}
			]
		],
		[
			'a one-person practice',
			[{ email: 'info@drjanegoodall.com', name: 'Jane Goodall', organization: 'Goodall Practice' }]
		],
		[
			'a forged switchboard on a consumer provider',
			[
				{ email: 'board@gmail.com', name: 'Board of Directors', organization: 'Example Group' },
				{ email: 'press@gmail.com', name: 'Press Office', organization: 'Example Group' }
			]
		]
	])('keeps the full person floor for %s', (_label, rows) => {
		const verdict = audienceFor(publishRoster(rows, 'email'), 'email');

		// Asserted THROUGH the resolver and only through it. These three decline for
		// three different reasons — two are unevaluable, one is person-form — and
		// pinning the form would make this file go red on correct behavior. What may
		// never change is the protection.
		expect(blockingHazardsForAudience(verdict)).toEqual(PERSON_HAZARDS);
	});
});
