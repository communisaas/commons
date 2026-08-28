/**
 * What the audience policy may and may not conclude from a published roster,
 * measured on the shapes an attested per-recipient term was once expected to move.
 *
 * The term is GONE — deleted from the row, the publication crossing and the
 * signed preimage, because `deriveAudience` read it nowhere and F16 proved every
 * socket it could have entered was already shut. What survives here is the part
 * that was never about the term: these rosters are the shapes where a desk
 * judgment and a person judgment collide, and the rules they pin are the reason
 * no such term may be consumed if one is ever built again.
 *
 * Two rules, and everything below is one of them:
 *   1. Nothing may answer whether a published NAME is a human except VETO 2.
 *      Suppressing it with desk evidence is the X4 break — a two-mailbox sole
 *      proprietor loses S5/S7/S10.
 *   2. Desk evidence is strictly ADDITIVE. A roster promotes nothing unless
 *      `domainAttestsAnOffice` finds at least one desk standing on the closed
 *      lexicon alone.
 *
 * Every roster is published through `audience-producer-harness.ts` — the same
 * producer → reader → `parseRecipientConfig` → `publishedRosterRoutes` chain the
 * send-time endpoint walks — so no shape here is one production cannot emit. Every
 * verdict is resolved through `blockingHazardsForAudience` and never through the
 * verdict label: a relabel that does not really restore the person floor fails
 * here. Every shape is measured on BOTH delivery lanes, because `certifiedRelay`
 * is a live term of the registry name veto and a rule proven on one lane is a
 * universal negative generalized from one sample.
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

const LANES: DeliveryMethod[] = ['email', 'cwc'];

/** Publish a roster on one lane and resolve the policy it actually gets. */
function hazardsFor(rows: readonly PublishedRow[], lane: DeliveryMethod): string[] {
	return blockingHazardsForAudience(audienceFor(publishRoster(rows, lane), lane));
}

function verdictFor(rows: readonly PublishedRow[], lane: DeliveryMethod): AudienceVerdict {
	return audienceFor(publishRoster(rows, lane), lane);
}

describe('desk evidence may not answer a question about the published NAME', () => {
	/**
	 * The X4 shape, and the one the earlier spec could not see.
	 *
	 * Both mailboxes are publishable and both hit the closed seat lexicon — and
	 * one of them publishes a human's name. If desk evidence were ever allowed to
	 * suppress `publishesAName`, this roster would promote to `institutional` and
	 * John Smith would lose S5, S7 and S10 on his own two mailboxes. `legal@`
	 * really does reach a legal desk. It is simply not evidence about the name
	 * beside `contact@`.
	 */
	const SOLE_PROPRIETOR_PAIR: PublishedRow[] = [
		{ email: 'contact@smithproperties.com', name: 'John Smith', organization: 'Smith Properties' },
		{ email: 'legal@smithproperties.com', name: 'Legal', organization: 'Smith Properties' }
	];

	it.each(LANES)('keeps the person floor for the two-mailbox sole proprietor on %s', (lane) => {
		expect(hazardsFor(SOLE_PROPRIETOR_PAIR, lane)).toEqual(PERSON_HAZARDS);
		// S5 by name: the assertion above is the whole floor, and this is the term
		// the X4 break removes.
		expect(hazardsFor(SOLE_PROPRIETOR_PAIR, lane)).toContain('S5');
	});

	/**
	 * The lone row is kept because it is the shape the earlier adversarial corpus
	 * tested, and it is INSUFFICIENT on its own: a single mailbox has one lexicon
	 * local part, so `domainAttestsAnOffice` refuses it at the COUNT before the
	 * name veto is ever consulted. Any rule that gates `publishesAName` on desk
	 * evidence leaves this row exactly where it is, which is why it cannot see
	 * the break and the pair above must stay beside it.
	 */
	const SOLE_PROPRIETOR_LONE: PublishedRow[] = [
		{ email: 'office@smithproperties.com', name: 'John Smith', organization: 'Smith Properties' }
	];

	it.each(LANES)('keeps the person floor for the lone sole-proprietor row on %s', (lane) => {
		expect(hazardsFor(SOLE_PROPRIETOR_LONE, lane)).toEqual(PERSON_HAZARDS);
	});

	/**
	 * X7's ruling, both halves in ONE test so the closure and its carve-out cannot
	 * drift apart in a later edit that only reads one of them.
	 *
	 * `casework@` is a publishable role address inside a registry namespace, and
	 * the artifact publishes a human's name beside it. Off the certified relay the
	 * roster is the author's own evidence that this address reaches a person, and
	 * no evidence about the MAILBOX answers that. On the relay a third party
	 * attests an official intake, and the grant survives.
	 */
	const REGISTRY_NAMING_A_HUMAN: PublishedRow[] = [
		{ email: 'casework@cityofx.gov', name: 'Elena Marsh', organization: 'City of X' }
	];

	it('keeps X7 closed on mailto and its relay carve-out open on cwc', () => {
		expect(hazardsFor(REGISTRY_NAMING_A_HUMAN, 'email')).toEqual(PERSON_HAZARDS);
		expect(verdictFor(REGISTRY_NAMING_A_HUMAN, 'email')).toEqual({
			form: 'unevaluable',
			reason: 'registry-route-names-a-human',
			routes: 1
		});

		expect(hazardsFor(REGISTRY_NAMING_A_HUMAN, 'cwc')).toEqual(INSTITUTIONAL_HAZARDS);
	});

	/**
	 * A REFUSAL, and NOT the pin for D1's residual — the comment that once claimed
	 * otherwise was wrong about what this shape measures.
	 *
	 * Measured on both lanes: `{ form: 'person-form', basis: 'name-token-match',
	 * routes: 2 }`. Each published label equals its own local part ("Office" beside
	 * `office@`), so the pass-3 `person-form` early return fires before any domain
	 * evidence is consulted.
	 *
	 * MEASURED on the current word lists: `nameIsRoleLabel('Office')` is FALSE.
	 * `office` is a `ROLE_LABEL_STOPWORDS` connective, so the stopword filter
	 * empties the token list and the function returns false on an empty set rather
	 * than vacuously true. `Information Desk` also reads as a human: `desk` is a
	 * connective and `information` alone is not a seat word. A rule that would have
	 * made both read as labels — joining a label's tokens back into local-part
	 * space — was tried and reverted: it promotes `nameIsRoleLabel('Medi A')` to
	 * true, and `Le Gal` at `le.gal@` to a seat.
	 *
	 * The refusal this test asserts does not depend on either reading: the pass-3
	 * `person-form` early return fires before `publishesAName` is ever consulted.
	 * That is why the explanation is corrected here rather than the expectation.
	 *
	 * D1's residual as originally written published NO name beside either address,
	 * and `readPublicTemplateDetailProjection` refuses that shape outright (its
	 * `decisionMakers` provenance gate requires a non-empty bounded `name`), so
	 * this fixture could never have carried it. The shape that DOES carry it is
	 * `ROLE_LABELLED_SOLE_PRACTITIONER`, pinned in the last block of this file. This
	 * fixture stays because the refusal it asserts is real and worth holding.
	 */
	const D1_VICTIM_PAIR: PublishedRow[] = [
		{ email: 'office@victim.com', name: 'Office', organization: 'Victim Co' },
		{ email: 'info@victim.com', name: 'Information', organization: 'Victim Co' }
	];

	it.each(LANES)('refuses the label-equals-local-part pair at the person floor on %s', (lane) => {
		expect(hazardsFor(D1_VICTIM_PAIR, lane)).toEqual(PERSON_HAZARDS);
	});

	/** The census counterweight, re-asked here on both lanes. */
	it.each<[string, PublishedRow[]]>([
		[
			'a sole proprietor behind a catch-all',
			[{ email: 'office@smithproperties.com', name: 'John Smith', organization: 'Smith Properties' }]
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
	])('keeps the full person floor for %s on both lanes', (_label, rows) => {
		for (const lane of LANES) {
			expect(hazardsFor(rows, lane)).toEqual(PERSON_HAZARDS);
		}
	});
});

describe('desk evidence is strictly additive — it never carries a domain alone', () => {
	/**
	 * Two publishable desks whose local parts the audience lexicon does NOT know
	 * (`foia` and `procurement` are in `PUBLIC_ROLE_LOCAL_PARTS` and are absent
	 * from `SEAT_LOCAL_PARTS`), each labelled with a pure role label so
	 * `nameIsRoleLabel` is true and VETO 2 does NOT fire. That is deliberate: if
	 * the names read as humans this roster would refuse for the wrong reason and
	 * the guard under test would be invisible. What refuses this roster is the
	 * COUNT: neither local part is a closed-lexicon seat, so the domain reaches
	 * ZERO desk local parts however the artifact labels them, and no evidence
	 * outside that word list is admitted to supply one.
	 */
	const ATTESTED_ONLY_DESKS: PublishedRow[] = [
		{ email: 'foia@northgatetrust.org', name: 'Office of the Clerk', organization: 'Northgate Trust' },
		{
			email: 'procurement@northgatetrust.org',
			name: 'Office of the Secretary',
			organization: 'Northgate Trust'
		}
	];

	it.each(LANES)('refuses two non-lexicon desks on a private domain on %s', (lane) => {
		expect(hazardsFor(ATTESTED_ONLY_DESKS, lane)).toEqual(PERSON_HAZARDS);
	});

	/**
	 * Two lexicon desks and one named human at the same domain. The count is met;
	 * the human is still named, and VETO 2 is not a thing any amount of desk
	 * evidence may buy off.
	 */
	const DESKS_PLUS_A_HUMAN: PublishedRow[] = [
		{
			email: 'provost@example.edu',
			name: 'Office of the Provost',
			organization: 'Example University'
		},
		{
			email: 'registrar@example.edu',
			name: 'Office of the Registrar',
			organization: 'Example University'
		},
		{ email: 'casework@example.edu', name: 'Elena Marsh', organization: 'Example University' }
	];

	it.each(LANES)('refuses two desks beside one named human on %s', (lane) => {
		expect(hazardsFor(DESKS_PLUS_A_HUMAN, lane)).toEqual(PERSON_HAZARDS);
	});

	/**
	 * The count is per DOMAIN and does not pool across them: one desk on each of
	 * two domains is two rosters of one, not a switchboard.
	 */
	const DESKS_ON_TWO_DOMAINS: PublishedRow[] = [
		{ email: 'foia@northgatetrust.org', name: 'Office of the Clerk', organization: 'Northgate Trust' },
		{ email: 'procurement@eastbanktrust.org', name: 'Office of the Secretary', organization: 'Eastbank Trust' }
	];

	it.each(LANES)('refuses desks split across two domains on %s', (lane) => {
		expect(hazardsFor(DESKS_ON_TWO_DOMAINS, lane)).toEqual(PERSON_HAZARDS);
	});

	/**
	 * VETO 1 is checked before the count and before any desk evidence is reached.
	 * Both names are pure role labels, so neither route is `person-form` and
	 * neither trips VETO 2 — the consumer provider is doing the refusing.
	 */
	const CONSUMER_PROVIDER_PAIR: PublishedRow[] = [
		{ email: 'clerk@gmail.com', name: 'Office of the Clerk', organization: 'Example Group' },
		{ email: 'legal@gmail.com', name: 'Legal', organization: 'Example Group' }
	];

	it.each(LANES)('refuses a role-labelled pair on a consumer provider on %s', (lane) => {
		expect(hazardsFor(CONSUMER_PROVIDER_PAIR, lane)).toEqual(PERSON_HAZARDS);
	});
});

describe('a lone route is never a switchboard', () => {
	const LONE_PRIVATE: PublishedRow[] = [
		{ email: 'foia@northgatetrust.org', name: 'Office of the Clerk', organization: 'Northgate Trust' }
	];
	const LONE_CONSUMER: PublishedRow[] = [
		{ email: 'clerk@gmail.com', name: 'Office of the Clerk', organization: 'Example Group' }
	];
	/**
	 * The one class where a lone route resolves `institutional`, and it does so on
	 * the registry grant alone — never on anything the roster says about itself.
	 */
	const LONE_REGISTRY: PublishedRow[] = [
		{ email: 'press@example.gov', name: 'Press Office', organization: 'Example Agency' }
	];

	it.each(LANES)('refuses a lone route on a private domain on %s', (lane) => {
		expect(hazardsFor(LONE_PRIVATE, lane)).toEqual(PERSON_HAZARDS);
	});

	it.each(LANES)('refuses a lone route on a consumer provider on %s', (lane) => {
		expect(hazardsFor(LONE_CONSUMER, lane)).toEqual(PERSON_HAZARDS);
	});

	it.each(LANES)('grants the lone registry route on %s', (lane) => {
		expect(hazardsFor(LONE_REGISTRY, lane)).toEqual(INSTITUTIONAL_HAZARDS);
	});
});

describe('the absence path is byte-identical to its pre-A1 verdict', () => {
	/**
	 * The verdicts this tree produced BEFORE the attested term was ever built, and
	 * the ones it produces now that the term is gone from every layer. Written out
	 * in full rather than compared to a recomputation of themselves, because this
	 * block is what proves the carrier's removal cost no reach and moved no
	 * verdict: every row below resolves exactly as it did with the term present.
	 */
	it.each<[string, PublishedRow[], DeliveryMethod, AudienceVerdict]>([
		[
			'a university switchboard',
			[
				{ email: 'provost@example.edu', name: 'Office of the Provost', organization: 'Example University' },
				{
					email: 'registrar@example.edu',
					name: 'Office of the Registrar',
					organization: 'Example University'
				}
			],
			'email',
			{ form: 'institutional', basis: 'seat-lexicon', routes: 2 }
		],
		[
			'a lone registry press office',
			[{ email: 'press@example.gov', name: 'Press Office', organization: 'Example Agency' }],
			'email',
			{ form: 'institutional', basis: 'government-registry', routes: 1 }
		],
		[
			'congressional intake on the certified relay',
			[{ email: 'info@house.gov', name: 'Constituent Services', organization: 'US House' }],
			'cwc',
			{ form: 'institutional', basis: 'government-registry', routes: 1 }
		],
		[
			'a hospital switchboard whose published names read as humans',
			[
				{
					email: 'patientrelations@stmaryshealth.org',
					name: 'Patient Relations',
					organization: "St Mary's Health"
				},
				{ email: 'info@stmaryshealth.org', name: 'Information Desk', organization: "St Mary's Health" }
			],
			'email',
			{ form: 'unevaluable', reason: 'seat-lexicon-unattested', routes: 2 }
		],
		[
			'a named caseworker inside a registry namespace',
			[{ email: 'casework@cityofx.gov', name: 'Elena Marsh', organization: 'City of X' }],
			'email',
			{ form: 'unevaluable', reason: 'registry-route-names-a-human', routes: 1 }
		],
		[
			'a two-mailbox sole proprietor',
			[
				{ email: 'contact@smithproperties.com', name: 'John Smith', organization: 'Smith Properties' },
				{ email: 'legal@smithproperties.com', name: 'Legal', organization: 'Smith Properties' }
			],
			'email',
			{ form: 'unevaluable', reason: 'seat-lexicon-unattested', routes: 2 }
		],
		[
			'two publishable desks the audience lexicon does not know',
			[
				{
					email: 'foia@northgatetrust.org',
					name: 'Office of the Clerk',
					organization: 'Northgate Trust'
				},
				{
					email: 'procurement@northgatetrust.org',
					name: 'Office of the Secretary',
					organization: 'Northgate Trust'
				}
			],
			'email',
			{ form: 'unevaluable', reason: 'indeterminate-route', routes: 2 }
		]
	])('resolves %s exactly as it did', (_label, rows, lane, expected) => {
		expect(verdictFor(rows, lane)).toEqual(expected);
	});
});

describe('a self-applied office label strips the person floor', () => {
	/**
	 * ACCEPTED RESIDUAL
	 *
	 * This roster PROMOTES. That is not a bug awaiting a fix and this block is not a
	 * refusal written backwards — it is the permanent record of a person-floor LOSS
	 * the operator accepted, held green so nobody rediscovers it as news.
	 *
	 * The roster is author-supplied: it comes out of the `recipient_config` an
	 * author wrote, and this tree has no out-of-artifact signal that a domain is an
	 * institution. VETO 2 counts HUMANS by word list (`nameIsRoleLabel`) — every
	 * identity-bearing token in "Press Office" and "Legal" is itself a lexicon
	 * seat word (`press` and `legal` are `CLOSED_SEAT_LOCAL_PARTS` members;
	 * `office` is a `ROLE_LABEL_STOPWORDS` connective and drops out), so a
	 * role-SHAPED label is not a name to the veto, `publishesAName` stays false
	 * and VETO 2 never fires. Both local parts are closed-lexicon seats,
	 * so the `>= 2` desk count is met and `domainAttestsAnOffice` grants. A sole
	 * practitioner who labels their own two mailboxes this way therefore loses S5,
	 * S7 and S10 on their own two mailboxes, on both delivery lanes, with no
	 * attestation involved at all.
	 *
	 * Accepted because the loss is attributable to an author, legible on the public
	 * page beside the addresses that caused it, and reversible through the
	 * suppression track. Accepted is not desired: nothing below should be read as a
	 * behaviour worth preserving for its own sake.
	 *
	 * Lineage: `FINDINGS.md` F14 records the measured shape, F15 downgrades it to a
	 * widening of D1's already-accepted residual in `commons-exploit-live`. The SIZE
	 * of this class is set by `nameIsRoleLabel` and `SEAT_LOCAL_PARTS`; narrowing
	 * that word list narrows this class without creating a new one, and this
	 * assertion is what moves when it does.
	 *
	 * THE CLASS IS EXACTLY AS WIDE AS IT WAS. It covers labels spelled as SINGLE
	 * lexicon words — "Press Office", "Legal" — and nothing else. A rule that would
	 * have widened it to CONNECTIVE-SPELLED COMPOUNDS ("Investor Relations" →
	 * `investorrelations`, "Board of Directors" → `boardofdirectors`) was tried and
	 * REVERTED: joining a label's tokens back into local-part space promotes
	 * `nameIsRoleLabel('Medi A')` to true even when guarded on a stopword being
	 * present, because `a` is a connective and `medi`+`a` spells the lexicon member
	 * `media`; unguarded it promotes `Le Gal` at `le.gal@univ.fr` to a seat. Both
	 * are natural people. The compounds therefore stay unreachable as published
	 * NAMES — "Investor Relations" leaves `investor`, not a seat word, and declines.
	 * `Le Gal` is pinned in `tests/unit/agents/seat-route.test.ts`.
	 */
	const ROLE_LABELLED_SOLE_PRACTITIONER: PublishedRow[] = [
		{ email: 'office@smithlaw.com', name: 'Press Office', organization: 'Smith Law' },
		{ email: 'legal@smithlaw.com', name: 'Legal', organization: 'Smith Law' }
	];

	it.each(LANES)('promotes the role-labelled sole practitioner on %s', (lane) => {
		expect(verdictFor(ROLE_LABELLED_SOLE_PRACTITIONER, lane)).toEqual({
			form: 'institutional',
			basis: 'seat-lexicon',
			routes: 2
		});
		// The narrowed set, on a roster one natural person controls.
		expect(hazardsFor(ROLE_LABELLED_SOLE_PRACTITIONER, lane)).toEqual(INSTITUTIONAL_HAZARDS);
	});
});
