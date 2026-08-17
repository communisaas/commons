/**
 * The sole-proprietor hole, as a standing regression.
 *
 * `CLOSED_SEAT_LOCAL_PARTS` (`src/lib/core/agents/seat-route.ts:4-60`) matches
 * the LOCAL PART and discards the domain (`classifySeatRoute`). `office`, `info`,
 * `contact`, `admin`, `legal`, `press`, `board`, `clerk` are exactly the default
 * catch-all mailboxes of sole proprietors, landlords and one-person practices,
 * so a bare lexicon hit used to buy the permissive hazard set for a message
 * aimed at a private person's only mailbox — even when that person's own name
 * was published beside the address, because `classifySeatRoute`'s
 * `nameTokenMatch` only fires when the name appears INSIDE the local part.
 *
 * Every case below asserts through `blockingHazardsForAudience`, not the label:
 * a relabel that does not actually restore S5/S7/S10 must fail here. Both
 * directions are tested — a fix that collapses the axis to all-unevaluable is
 * not a fix, it is a dead axis, so the reach set must survive untouched.
 *
 * The two directions are kept in two describes with two different standards of
 * evidence, and the difference is the point:
 *
 *  - The abuse direction is probed on hand-built `AudienceRoute[]` literals.
 *    Those are UNIT PROBES of the fold's precedence order, not artifacts: the
 *    strict verdict is what is being pinned, and a stricter verdict on a shape
 *    the reader would refuse still costs no reach.
 *  - The reach direction may not be probed that way. Reach asserted on a shape
 *    production cannot publish is reach that does not exist, so every
 *    `institutional` claim in this file is measured through the real producer
 *    and the real public reader before the policy is asked.
 *
 * This file also pins the hole shut against a future widening of the lexicon:
 * adding a word to `CLOSED_SEAT_LOCAL_PARTS` can no longer silently re-open it.
 */
import { describe, expect, it } from 'vitest';
import {
	blockingHazardsForAudience,
	deriveAudience,
	type AudienceRoute
} from '$lib/core/server/moderation/audience';
// One producer chain exists in this directory, in `audience-producer-harness.ts`
// — the module that owns the publish → read → parse → fold sequence and the two
// hazard sets. A second verbatim copy is free to drift from the census that
// grades reach, which is how the measurement in this file diverged once already.
import {
	audienceFor,
	publishRoster,
	INSTITUTIONAL_HAZARDS,
	type PublishedRow
} from './audience-producer-harness';

/** The hazards a natural person is owed on top of the universal S1/S4 floor. */
const PERSON_FLOOR = ['S5', 'S7', 'S10'] as const;

/**
 * Hand-built rosters, probing the fold's precedence order directly.
 *
 * Read every `name: null` in this describe as an INTERMEDIATE state, not as an
 * artifact. `publishedRosterRoutes` seeds each `emails[]` address with `null`
 * and then upgrades it from the matching decision maker (`publishedRosterRoutes`'s
 * `publish` closure),
 * and the public reader independently requires a non-empty `name` on every
 * decision maker (`readPublicRecipientConfig`'s `decisionMakers` provenance gate)
 * plus an `emails[]` array equal to the deduped decision-maker addresses
 * elementwise and in order (its `recipient_config.email-derivation` refusal). So no reader-accepted artifact ever carries a null-named
 * route into `deriveAudience`; `null` is simply the only value that satisfies the
 * required `AudienceRoute.name` field without a cast.
 * These rows therefore pin FUNCTION BEHAVIOUR — the order of the precedence
 * checks in `deriveAudience`'s pass 3 — and claim nothing about a publishable
 * artifact. The producer-valid pin at the bottom closes the same hole on a shape
 * the reader does accept.
 */
describe('deriveAudience — precedence probes on hand-built rosters (not publishable artifacts), closed by one producer-valid pin', () => {
	it.each<[string, AudienceRoute[]]>([
		[
			'A1 landlord, name published beside the catch-all',
			[{ email: 'office@smithproperties.com', name: 'John Smith' }]
		],
		[
			'A2 landlord, name withheld — single mailbox on the domain',
			[{ email: 'office@smithproperties.com', name: null }]
		],
		['A3 consumer mailbox', [{ email: 'contact@gmail.com', name: null }]],
		[
			'A4 forged switchboard on a consumer provider',
			[
				{ email: 'board@gmail.com', name: null },
				{ email: 'press@gmail.com', name: null }
			]
		],
		[
			'A5 one-person practice',
			[{ email: 'info@drjanegoodall.com', name: 'Jane Goodall' }]
		],
		['A6 sole practitioner', [{ email: 'legal@smithlaw.com', name: 'John Smith' }]],
		[
			'A7 owner-operated small business',
			[{ email: 'admin@mariasbakery.com', name: 'Maria Lopez' }]
		],
		[
			'A8 named human beats a two-mailbox domain',
			[
				{ email: 'office@smithproperties.com', name: 'John Smith' },
				{ email: 'info@smithproperties.com', name: null }
			]
		],
		[
			'A9 lone role mailbox, non-registry domain (accepted reach cost)',
			[{ email: 'clerk@townofx.us', name: null }]
		],
		[
			'A10 plus-tag evasion of the local-part normalizer',
			[{ email: 'office+outreach@smithproperties.com', name: 'John Smith' }]
		],
		[
			'A11 one natural person carries a mixed roster',
			[
				{ email: 'press@hospital.org', name: null },
				{ email: 'jane@hospital.org', name: 'Jane Smith' }
			]
		]
	])('refuses the permissive set for %s', (_label, roster) => {
		const verdict = deriveAudience(roster);
		expect(['person-form', 'unevaluable']).toContain(verdict.form);

		// The floor is RESTORED, not merely relabeled.
		const hazards = blockingHazardsForAudience(verdict);
		expect(hazards).toEqual(expect.arrayContaining(['S1', 'S4', ...PERSON_FLOOR]));
	});

	it('reports the sole-proprietor decline under its own countable reason', () => {
		// A unit probe of `deriveAudience`'s pass-3 precedence order: a route
		// whose `name` key is present and null takes the indeterminate arm, while a
		// route that omits the key entirely takes the unattested one — an ordering
		// no reader-accepted artifact can exercise, since a published roster always
		// carries a name. `seat-lexicon-unattested` on a producer-valid shape is
		// measured by the pin at the bottom of this describe.
		expect(deriveAudience([{ email: 'office@smithproperties.com', name: null }])).toEqual({
			form: 'unevaluable',
			reason: 'indeterminate-route',
			routes: 1
		});
		expect(deriveAudience([{ email: 'contact@gmail.com', name: null }])).toMatchObject({
			reason: 'indeterminate-route'
		});
	});

	it('vetoes the consumer provider BEFORE counting the switchboard', () => {
		// Two lexicon local parts on `gmail.com` satisfy the count; the provider
		// veto is checked first, so the pair cannot forge an office. The reported
		// reason is the indeterminate arm because both probes declare `name: null`
		// — the intermediate state, not an artifact shape — and what is pinned here
		// is the order of the two checks, not the reason a published roster carries.
		expect(
			deriveAudience([
				{ email: 'board@gmail.com', name: null },
				{ email: 'press@gmail.com', name: null }
			])
		).toEqual({
			form: 'unevaluable',
			reason: 'indeterminate-route',
			routes: 2
		});
	});

	it('lets one published name at a domain refuse promotion for every seat on it', () => {
		// The name is weaker evidence than a token match inside the local part, so
		// it declines rather than forcing `person-form`. It still declines.
		const named = deriveAudience([
			{ email: 'board@hospital.org', name: 'Alice Ng' },
			{ email: 'press@hospital.org', name: null },
			{ email: 'legal@hospital.org', name: null }
		]);
		// The reason is the indeterminate arm rather than the unattested one only
		// because the two other probes declare `name: null`, which is the
		// intermediate state inside `publishedRosterRoutes` and never a shape a
		// reader-accepted artifact carries. The decline itself — the fact being
		// pinned — is unchanged, and makes no claim about a publishable artifact.
		expect(named).toMatchObject({ form: 'unevaluable', reason: 'indeterminate-route' });

		// The mirror-image case — the same three hospital seats attesting an office
		// once no human is named at the domain — is a REACH claim, so it is asserted
		// in the reach describe below, on row R3, through the real public reader.
	});

	it('counts normalized local parts, so one mailbox cannot spell itself into two', () => {
		// `office@`, `Office+x@` and `off.ice@` all normalize to `office`
		// (`classifySeatRoute` strips `+tag` and `._-` before the lookup); the
		// domain still published exactly one seat.
		// The three spellings declare `name: null` because that is the only value
		// satisfying the required field without a cast — an intermediate state of
		// the fold, not an artifact — so what this pins is the de-duplication, and
		// the reported reason is a consequence of the probe shape.
		expect(
			deriveAudience([
				{ email: 'office@smithproperties.com', name: null },
				{ email: 'Office+outreach@smithproperties.com', name: null },
				{ email: 'off.ice@smithproperties.com', name: null }
			])
		).toMatchObject({ form: 'unevaluable', reason: 'indeterminate-route', routes: 3 });
	});

	it('scopes the evidence per domain — one domain never attests for another', () => {
		// Two lexicon hits, but on two different single-mailbox domains, so neither
		// domain attests an office. The `name: null` on each is the fold's
		// intermediate state rather than a publishable shape; the per-domain
		// scoping is the behaviour pinned, and no artifact claim is made.
		expect(
			deriveAudience([
				{ email: 'office@smithproperties.com', name: null },
				{ email: 'legal@smithlaw.com', name: null }
			])
		).toMatchObject({ form: 'unevaluable', reason: 'indeterminate-route', routes: 2 });
	});

	it('pins the sole-proprietor decline on a shape the public reader accepts', () => {
		// `seat-lexicon-unattested` used to be asserted on `{ email }` with no `name`
		// key at all. `readPublicTemplateDetailProjection` rejects that artifact with
		// `PUBLIC_TEMPLATE_DETAIL_PROJECTION_INVALID:recipient_config.decisionMakers.0.provenance`
		// (`readPublicRecipientConfig`), so the countable reason was pinned on
		// something production cannot emit. The reader requires a non-empty `name`
		// on every decision maker and an `emails[]` array equal to the deduped
		// decision-maker addresses elementwise and in order (its
		// `recipient_config.email-derivation` refusal); `publishedRosterRoutes` seeds
		// the `emails[]` pass with `null` and then upgrades it from the matching
		// decision maker, so `null` is an intermediate state inside the fold
		// and never terminal for a reader-accepted config. The production-reachable
		// shape is therefore a NAMED seat on a domain that attests no office, which
		// is what runs here — real producer, real reader, real policy. The reader
		// is driven by `audience-producer-harness.ts`, which calls
		// `readPublicTemplateDetailProjection` on the built projection before any
		// route reaches the policy, so this row is publishable or it throws.
		const verdict = audienceFor(
			publishRoster(
				[
					{
						email: 'office@smithproperties.com',
						name: 'John Smith',
						organization: 'Smith Properties'
					}
				],
				'email'
			),
			'email'
		);
		expect(verdict).toEqual({
			form: 'unevaluable',
			reason: 'seat-lexicon-unattested',
			routes: 1
		});
		expect(blockingHazardsForAudience(verdict)).toEqual(
			expect.arrayContaining(['S1', 'S4', ...PERSON_FLOOR])
		);
	});
});

/**
 * The institutional reach that survives the real public reader.
 *
 * Every row is published through `publishRoster` before the policy sees it, so
 * a verdict here is reach production can actually deliver. Four rows resolve
 * institutional on the email lane. R2 resolves differently per lane and is
 * asserted on both, because the lane is a stored column value and a claim
 * measured on one lane says nothing about the other.
 */
describe('the institutional reach that survives the real public reader', () => {
	it.each<[string, PublishedRow[], string]>([
		[
			'R1 registry press office',
			[{ email: 'press@senate.gov', name: 'Press Office', organization: 'US Senate' }],
			'government-registry'
		],
		[
			'R3 published switchboard, no human named',
			[
				{ email: 'board@hospital.org', name: 'Board', organization: 'Example Hospital' },
				{ email: 'press@hospital.org', name: 'Press Office', organization: 'Example Hospital' },
				{ email: 'legal@hospital.org', name: 'Legal', organization: 'Example Hospital' }
			],
			'seat-lexicon'
		],
		[
			'R4 registry grant survives a published name',
			[{ email: 'mayor@cityofx.gov', name: 'Jane Doe', organization: 'City of X' }],
			'government-registry'
		],
		[
			'R5 registry beside a switchboard reports the weaker basis',
			[
				{ email: 'press@senate.gov', name: 'Press Office', organization: 'US Senate' },
				{ email: 'board@hospital.org', name: 'Board', organization: 'Example Hospital' },
				{ email: 'press@hospital.org', name: 'Press Office', organization: 'Example Hospital' }
			],
			'seat-lexicon'
		]
	])('keeps the institutional verdict for %s', (_label, rows, basis) => {
		// R1 and R4 previously asserted the same grants on nameless hand-built
		// routes; R3 and R5 asserted the same switchboards the same way. All four
		// survive publication — the reader accepts a desk labelled with its own
		// function, and `nameIsRoleLabel` keeps that label
		// from counting as a human at the domain — so the reach they claimed is real,
		// and it is now measured on the shape an anonymous page load would carry.
		const verdict = audienceFor(publishRoster(rows, 'email'), 'email');
		expect(verdict).toMatchObject({ form: 'institutional', basis });
		// Through the resolver, never through the label.
		expect(blockingHazardsForAudience(verdict)).toEqual(INSTITUTIONAL_HAZARDS);
	});

	it('R2 registry route naming a human — refused on the email lane, granted on the certified relay lane', () => {
		// `constituentservices@house.gov` sits outside `CLOSED_SEAT_LOCAL_PARTS`, so
		// the registry carve-out is the only thing that could grant it. That
		// carve-out (the `certifiedRelay` branch inside `deriveAudience`'s registry
		// arm) is a three-term conjunction, and its FIRST
		// term is `options?.certifiedRelay !== true` — the relay short-circuits the
		// name veto before `route.name !== null` is ever consulted. The second and
		// third terms are what the domain-evidence pass one screen earlier does NOT
		// use: that pass reads `!nameIsRoleLabel(route.name)`, so on
		// the email lane a registry local part outside the lexicon is refused
		// whatever label is published beside it — a role label, a role label plus a
		// noun, or a plain human name, all three measured below.
		//
		// The lane is not a caller preference. The endpoint derives it from the
		// artifact's persisted `deliveryMethod` through `isCongressionalDelivery`
		// (`convex/lib/templateDeliveryMethod.ts:54`) at
		// `src/routes/api/moderation/personalization/+server.ts:103,109`. So both
		// verdicts below are producer-valid: the same roster stored under a
		// different column value. The certified grant surviving a published human
		// name is the settled ruling — the relay is a third-party attestation that
		// the channel is an official intake — and it is pinned here, not questioned.
		for (const name of ['Constituent Services', 'Constituent Services Office', 'Elena Marsh']) {
			const onEmail = audienceFor(
				publishRoster(
					[{ email: 'constituentservices@house.gov', name, organization: 'US House' }],
					'email'
				),
				'email'
			);
			expect(onEmail).toEqual({
				form: 'unevaluable',
				reason: 'registry-route-names-a-human',
				routes: 1
			});
			expect(blockingHazardsForAudience(onEmail)).toEqual(['S1', 'S4', ...PERSON_FLOOR]);

			const onCertifiedRelay = audienceFor(
				publishRoster(
					[{ email: 'constituentservices@house.gov', name, organization: 'US House' }],
					'cwc'
				),
				'cwc'
			);
			expect(onCertifiedRelay).toEqual({
				form: 'institutional',
				basis: 'government-registry',
				routes: 1
			});
			expect(blockingHazardsForAudience(onCertifiedRelay)).toEqual(INSTITUTIONAL_HAZARDS);
		}
	});

	it('collapses the whole switchboard when one desk is labelled with a word outside the lexicon', () => {
		// R3's three seats, with the board mailbox labelled "Board of Directors"
		// instead of "Board". `nameIsRoleLabel` requires every non-stopword token to
		// be a `SEAT_LOCAL_PARTS` member, and `directors` is not one — so the very
		// exemplar named in the doc comments at `audience.ts` and `seat-route.ts` is
		// the label that registers a human at the domain and demotes the office to
		// person-form. The label set is a convention the projection never enforces,
		// so an author spelling the same desk one word longer loses the narrowed
		// hazard set.
		//
		// HISTORY, kept because the attempted fix is more instructive than the
		// defect. Rejoining the raw tokens across the dropped connective DOES reach
		// `boardofdirectors`, which is a lexicon member, and it moved this case plus
		// one census row to institutional. It was reverted: the same rejoin promotes
		// a natural person. `nameIsRoleLabel('Medi A')` returns true under a
		// stopword-guarded join (`a` is a connective; `medi`+`a` spells the member
		// `media`), and the unguarded form promotes `le.gal@univ.fr` "Le Gal" to a
		// seat on `legal`. The list serves two tokenizations — a one-token local part
		// and a multi-token published name — and joining the name into local-part
		// space is what lets a person's name concatenate into a role word.
		const verdict = audienceFor(
			publishRoster(
				[
					{
						email: 'board@hospital.org',
						name: 'Board of Directors',
						organization: 'Example Hospital'
					},
					{ email: 'press@hospital.org', name: 'Press Office', organization: 'Example Hospital' },
					{ email: 'legal@hospital.org', name: 'Legal', organization: 'Example Hospital' }
				],
				'email'
			),
			'email'
		);
		expect(verdict).toMatchObject({ form: 'person-form', basis: 'name-token-match' });
		// Through the resolver, never through the label.
		expect(blockingHazardsForAudience(verdict)).toEqual(['S1', 'S4', ...PERSON_FLOOR]);
	});

	it('exempts the registry grant from the name veto — the registrar is not the author', () => {
		// R4 is the load-bearing case: a `.gov` grant comes from a third-party
		// registrar, so a name the AUTHOR published beside it cannot demote it.
		// The same name on a private domain does demote, and it declines under the
		// countable reason rather than merely failing to be institutional. Both
		// halves run through the real producer and the real reader.
		const registry = audienceFor(
			publishRoster(
				[{ email: 'mayor@cityofx.gov', name: 'Jane Doe', organization: 'City of X' }],
				'email'
			),
			'email'
		);
		expect(registry).toMatchObject({ form: 'institutional', basis: 'government-registry' });
		expect(blockingHazardsForAudience(registry)).toEqual(INSTITUTIONAL_HAZARDS);

		const privateDomain = audienceFor(
			publishRoster(
				[{ email: 'mayor@cityofx.com', name: 'Jane Doe', organization: 'City of X' }],
				'email'
			),
			'email'
		);
		expect(privateDomain).toMatchObject({
			form: 'unevaluable',
			reason: 'seat-lexicon-unattested'
		});
		expect(blockingHazardsForAudience(privateDomain)).toEqual(['S1', 'S4', ...PERSON_FLOOR]);
	});
});
