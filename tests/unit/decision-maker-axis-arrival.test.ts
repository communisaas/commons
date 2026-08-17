// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';

import PowerLandscape from '$lib/components/action/PowerLandscape.svelte';
import { mergeLandscape } from '$lib/utils/landscapeMerge';
import type { Template } from '$lib/types/template';
import { issuePublicRecipientProvenance } from '$convex/lib/publicRecipientProvenance';
import {
	buildPublicTemplateDetailProjection,
	projectPublicDetailRecipientConfig,
	readPublicTemplateDetailProjection
} from '$convex/lib/publicTemplateDiscoverySource';

/**
 * ARRIVAL GATE — the decision-maker classification axes vs. a STRANGER.
 *
 * A stranger is a person who did not author the page and arrives from a shared
 * link at `/s/[slug]`. Their copy of a decision-maker is not the author's
 * object: it is rebuilt field-by-field from an HMAC-verified claim set, so this
 * file drives the REAL producer and the REAL reader rather than hand-writing
 * the projected shape, then renders the same component the page mounts.
 *
 * The arrival route, in order:
 *   src/routes/s/[slug]/+layout.server.ts:26   getCachedPublicTemplatePageArtifact
 *   convex/lib/publicTemplateDiscoverySource.ts   projectPublicDetailRecipientConfig
 *   convex/lib/publicTemplateDiscoverySource.ts   buildPublicTemplateDetailProjection
 *   convex/lib/publicTemplateDiscoverySource.ts   readPublicTemplateDetailProjection
 *   convex/lib/publicTemplateDiscoverySource.ts   per-recipient hasOnlyKeys allow-list
 *   src/routes/s/[slug]/+page.server.ts:375    parseRecipientConfig
 *   src/routes/s/[slug]/+page.svelte:1268      <PowerLandscape decisionMakers={...}>
 *   src/lib/utils/landscapeMerge.ts:154        LandscapeMember
 *   src/lib/components/action/DecisionMakerLandscapeCard.svelte:98-108,136
 *
 * Executed in this file, not merely named: the projector, the builder, the reader
 * (which runs the per-recipient allow-list), `mergeLandscape`, and a server render
 * of `PowerLandscape`. The three SvelteKit load hops are the route this evidence
 * stands for; they are named as route context and are not claimed to be driven
 * here.
 *
 * No author session exists anywhere in this file: the render is driven with
 * `viewerIsConstituent: false` and no user, which is what a guest gets.
 *
 * A second axis briefly crossed and no longer does. A per-recipient `reaches`
 * judgment was signed into the attestation and admitted onto this surface for a
 * while; it has been removed from the row, the crossing and the preimage,
 * because nothing downstream consumed it. The allow-list below LOST that key,
 * which is the strict direction: a stored row still carrying it now takes the
 * whole detail down instead of publishing it. `emailGrounded` remains the only
 * axis that crosses, and it crosses as a checkable source link.
 */

const SECRET = 'arrival-sweep-public-recipient-secret-32-bytes';
const AUTHOR_ID = 'users:author-who-is-not-the-reader';
const NOW = 1_800_000_000_000;

/** Every axis this sweep covers. */
const NINE_AXES = [
	'contactRoute',
	'standing',
	'seatRoute',
	'routeProvenance',
	'deliveryTier',
	'governmentalClass',
	'inputWindow',
	'relevanceRank',
	'emailGrounded'
] as const;

/**
 * The consume-side allow-list, verbatim from the per-recipient `hasOnlyKeys`
 * call in `convex/lib/publicTemplateDiscoverySource.ts`. Nine keys, of which
 * `role`, `shortName` and `roleCategory` are optional claims
 * (`convex/lib/publicRecipientProvenance.ts`).
 *
 * Neither `reaches` nor `reachesLabel` is here, and their absence is the whole
 * enforcement: the allow-list refuses the key outright and takes the detail
 * down, rather than stripping it somewhere a later reader could quietly restore.
 */
const PROJECTED_KEY_ALLOW_LIST = [
	'name',
	'title',
	'role',
	'shortName',
	'organization',
	'roleCategory',
	'email',
	'emailGrounded',
	'emailSource'
] as const;

/**
 * An author-side row carrying ALL NINE axes populated, in the shapes their real
 * producers emit (`src/lib/core/agents/agents/decision-maker.ts:742-760,862,893-899`).
 * If a future change lets an axis cross the boundary, it crosses from here.
 */
function authoredRow(overrides: Record<string, unknown>) {
	return {
		name: 'Ada Lovelace',
		title: 'Director of Public Works',
		organization: 'City of Example',
		roleCategory: 'executes',
		isAiResolved: true,
		emailGrounded: true,
		publicEmailGrounding: {
			version: 1,
			method: 'page-read',
			source: 'https://example.gov/contact'
		},
		emailSource: 'https://example.gov/contact',
		// --- the nine axes, all populated ---
		contactRoute: { status: 'routed' },
		standing: { standing: 'administers', basis: 'title-inferred' },
		seatRoute: { form: 'seat', localPart: 'info', nameTokenMatch: false, lexiconHit: 'info' },
		routeProvenance: { provenance: 'for-office', source: 'https://example.gov/contact' },
		deliveryTier: 'unestablished-official-channel',
		governmentalClass: { governmental: true, basis: 'us-registry' },
		inputWindow: { state: 'open', closesOn: '2099-01-01', source: 'https://example.gov/contact' },
		relevanceRank: 1,
		// --- author-only payload that must also never cross ---
		reasoning: 'Runs the program the request concerns.',
		provenance: 'verified against the department directory',
		confidence: 0.92,
		personalPrompt: 'private authoring prompt',
		...overrides
	};
}

async function attested(row: Record<string, unknown>) {
	const publicRecipientProvenance = await issuePublicRecipientProvenance(
		row,
		AUTHOR_ID,
		SECRET,
		NOW
	);
	expect(publicRecipientProvenance).not.toBeNull();
	return { ...row, publicRecipientProvenance };
}

async function projectRows(rows: readonly Record<string, unknown>[]) {
	return projectPublicDetailRecipientConfig(
		{ reach: 'location-specific', decisionMakers: rows },
		AUTHOR_ID,
		[SECRET],
		NOW
	);
}

/**
 * Drive the real producer. `info@` is in both the public-admission lexicon
 * (`convex/lib/publicRoleAddress.ts:46`) and the seat lexicon
 * (`src/lib/core/agents/seat-route.ts:45`); `publiccomment@` is in the public
 * one only (`publicRoleAddress.ts:52`). The pair is what makes the rendered
 * route sentence DISCRIMINATE rather than print a constant.
 */
async function strangerDecisionMakers() {
	const rows = await Promise.all([
		attested(authoredRow({ email: 'info@example.gov' })),
		attested(
			authoredRow({
				name: 'Bureau of Example',
				email: 'publiccomment@example.gov',
				title: 'Public Comment Desk'
			})
		),
		attested(
			authoredRow({
				email: 'clerk@example.gov',
				name: 'Records Office',
				title: 'Clerk of the Council',
				emailReachesClaim: 'seat',
				emailReachesLabel: 'Office of the City Clerk'
			})
		)
	]);
	return projectRows(rows);
}

/**
 * The exact rows the boundary emits for the three fixtures above, written by hand
 * ON PURPOSE. Comparing a projector's output against another output of the same
 * projector moves with any widening; comparing against this literal does not.
 */
const EXPECTED_STRANGER_ROWS = [
	{
		email: 'info@example.gov',
		emailGrounded: true,
		emailSource: 'https://example.gov/contact',
		name: 'Ada Lovelace',
		title: 'Director of Public Works',
		organization: 'City of Example',
		roleCategory: 'executes'
	},
	{
		email: 'publiccomment@example.gov',
		emailGrounded: true,
		emailSource: 'https://example.gov/contact',
		name: 'Bureau of Example',
		title: 'Public Comment Desk',
		organization: 'City of Example',
		roleCategory: 'executes'
	},
	{
		email: 'clerk@example.gov',
		emailGrounded: true,
		emailSource: 'https://example.gov/contact',
		name: 'Records Office',
		title: 'Clerk of the Council',
		organization: 'City of Example',
		roleCategory: 'executes'
	}
];

const TEMPLATE = {
	id: 't1',
	slug: 'example-slug',
	title: 'Fix the intersection',
	description: 'A grievance',
	deliveryMethod: 'email',
	message_body: 'body'
} as unknown as Template;

/**
 * The stored template row the consume-side hops rebuild a public detail from.
 * Both delivery lanes are driven, because the same stored recipient shape is
 * rebuilt for a direct-email page and for a congressional one.
 */
function templateFixture(
	deliveryMethod: 'email' | 'cwc' = 'email'
): Parameters<typeof buildPublicTemplateDetailProjection>[0] {
	return {
		_id: 'templates:axis-arrival-fixture',
		_creationTime: NOW,
		slug: 'axis-arrival-fixture',
		title: 'Fix the intersection',
		description: 'A grievance.',
		domain: 'civic',
		domainHue: 210,
		type: 'email',
		deliveryMethod,
		messageBody: 'Please consider this request.',
		sources: [],
		researchLog: [],
		preview: 'Please consider this request.',
		verifiedSends: 0,
		uniqueDistricts: 0,
		topics: []
	} as unknown as Parameters<typeof buildPublicTemplateDetailProjection>[0];
}

/**
 * A stored detail whose row at `index` carries one extra field. The producer ran
 * first and its output is the input here, so this is a stored blob a later
 * reader picks up — not a hand-built object that never crossed the boundary.
 */
function withPoison(
	projected: Awaited<ReturnType<typeof projectPublicDetailRecipientConfig>>,
	index: number,
	extra: Record<string, unknown>,
	deliveryMethod: 'email' | 'cwc' = 'email'
) {
	const rows = (projected.decisionMakers ?? []).map((row, at) =>
		at === index ? { ...row, ...extra } : row
	);
	return buildPublicTemplateDetailProjection(templateFixture(deliveryMethod), {
		...projected,
		decisionMakers: rows as never
	});
}

/**
 * Copy each axis would print if it reached this surface, byte-identical to the
 * renderer that emits it. A probe that no renderer can produce is a vacuous
 * negative, so only real strings appear here.
 *
 * `standing`, `seatRoute`, `governmentalClass` and `relevanceRank` have no probe
 * because they have no renderer: `grep -rn` over `src convex tests` returns, for
 * `governmentalClass`, its declaration (`src/lib/types/template.ts:312`), its one
 * write (`src/lib/core/agents/agents/decision-maker.ts:742`) and one unit test;
 * for `relevanceRank`, its declaration (`template.ts:357`), its write
 * (`decision-maker.ts:862`) and draft/bridge/wire passthrough. Neither reaches a
 * component, and neither does `standing` or `seatRoute`. Their only possible
 * tripwire is the key-set assertion below, not a copy probe.
 */
const AXIS_VOCABULARY: ReadonlyArray<[string, string]> = [
	// src/lib/core/agents/contact-route-verdict.ts:102
	['contactRoute', 'Public email route found'],
	// src/lib/core/agents/contact-route-verdict.ts:113
	['contactRoute', 'The contact route could not be determined from this run'],
	// src/lib/core/agents/delivery-tier-copy.ts:37
	['deliveryTier', 'This address was not established as an official channel for this decision.'],
	// src/lib/core/agents/input-window.ts:163-173 — substring covering all four states
	['inputWindow', 'input window']
];

/**
 * The two route sentences the stranger's card prints, verbatim from
 * `src/lib/core/agents/reach-census.ts:53,55` via `describeMeasuredRoute` (:127-129),
 * called from `DecisionMakerLandscapeCard.svelte:98-108`.
 */
const ROUTE_FOR_OFFICE = 'Address published for an office';
const ROUTE_ON_PAGE_UNCLASSIFIED = 'Address published on a page, route form unclassified';
const ROUTE_PERSON_FORM = 'Person-form address published without a page tie';
const EVERY_ROUTE_SENTENCE = [
	ROUTE_FOR_OFFICE,
	ROUTE_ON_PAGE_UNCLASSIFIED,
	ROUTE_PERSON_FORM
] as const;

/**
 * The sentence each rendered row must print, keyed by the name it prints under.
 * `info@` and `clerk@` are both in the seat lexicon
 * (`src/lib/core/agents/seat-route.ts:44,54`) and read for-office; `publiccomment@`
 * is in the public-admission lexicon only and reads unclassified.
 */
const ROW_ROUTE_SENTENCES: ReadonlyArray<readonly [string, string]> = [
	['Ada Lovelace', ROUTE_FOR_OFFICE],
	['Bureau of Example', ROUTE_ON_PAGE_UNCLASSIFIED],
	['Records Office', ROUTE_FOR_OFFICE]
];

describe('axis arrival sweep — what a stranger at /s/[slug] receives', () => {
	it('projects exactly the public claim shape: eight of nine axes never cross the boundary', async () => {
		const projected = await strangerDecisionMakers();
		expect(projected.decisionMakers).toHaveLength(3);

		for (const row of projected.decisionMakers ?? []) {
			const keys = new Set(Object.keys(row));
			// The exact set guards the PRODUCER — `publicDecisionMakerFromClaims` —
			// whose return is what the reader's per-recipient allow-list then
			// re-checks. Seven keys on every row: `role` and `shortName` are optional
			// claims (convex/lib/publicRecipientProvenance.ts) spread only when
			// defined, and these fixtures carry neither.
			const expectedKeys = [
				'email',
				'emailGrounded',
				'emailSource',
				'name',
				'organization',
				'roleCategory',
				'title'
			];
			expect([...keys].sort()).toEqual(expectedKeys.sort());
			expect(keys.has('reaches')).toBe(false);
			expect(keys.has('reachesLabel')).toBe(false);
			for (const key of keys) {
				expect(PROJECTED_KEY_ALLOW_LIST).toContain(key);
			}
			for (const axis of NINE_AXES) {
				if (axis === 'emailGrounded') continue;
				expect(keys.has(axis)).toBe(false);
			}
			// The one axis that does cross is a lane marker, not a measurement: the
			// producer hard-codes it (publicTemplateDiscoverySource.ts:462). That
			// constant is an ENFORCED issuance precondition, not a fabrication —
			// `issuePublicRecipientProvenance` refuses to mint a claim unless the
			// author row already carried `emailGrounded === true` with a `page-read`
			// grounding whose source equals `emailSource`
			// (convex/lib/publicRecipientProvenance.ts:161-180).
			expect(row.emailGrounded).toBe(true);
		}
	});

	it('emits the full nine-key set, and no more, when the optional claims are present', async () => {
		const projected = await projectRows([
			await attested(
				authoredRow({
					name: 'Records Office',
					email: 'clerk@example.gov',
					title: 'Records Office',
					role: 'Clerk of the Council',
					shortName: 'Records',
					// Still minted on the row by the producer, and still crossing
					// nothing: the projected key set below is the whole allow-list and
					// neither of these appears in it.
					emailReachesClaim: 'seat',
					emailReachesLabel: 'Office of the City Clerk'
				})
			)
		]);
		expect(projected.decisionMakers).toHaveLength(1);
		const keys = Object.keys(projected.decisionMakers?.[0] ?? {});
		expect([...keys].sort()).toEqual([...PROJECTED_KEY_ALLOW_LIST].sort());
		for (const axis of NINE_AXES) {
			if (axis === 'emailGrounded') continue;
			expect(keys).not.toContain(axis);
		}
	});

	it('drops author-only judgment payload as well as the axes', async () => {
		const projected = await strangerDecisionMakers();
		for (const row of projected.decisionMakers ?? []) {
			for (const field of [
				'reasoning',
				'provenance',
				'confidence',
				'personalPrompt',
				'publicEmailGrounding',
				'publicRecipientProvenance',
				'isAiResolved'
			]) {
				expect(Object.prototype.hasOwnProperty.call(row, field)).toBe(false);
			}
		}
	});

	it('carries exactly one axis into the LandscapeMember a stranger renders', async () => {
		const projected = await strangerDecisionMakers();
		const landscape = mergeLandscape(
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(projected.decisionMakers ?? []) as any,
			[],
			false
		);
		const members = landscape.roleGroups.flatMap((group) => group.members);
		expect(members).toHaveLength(3);
		for (const member of members) {
			const keys = new Set(Object.keys(member));
			expect(keys.has('emailGrounded')).toBe(true);
			// This loop guards the fixed object literal at
			// src/lib/utils/landscapeMerge.ts:154-175, not the input rows: that
			// constructor rebuilds the member field by field, so leaking an axis into
			// its INPUT cannot move this assertion. What moves it is the literal
			// itself growing an axis key.
			for (const axis of NINE_AXES) {
				if (axis === 'emailGrounded') continue;
				expect(keys.has(axis)).toBe(false);
			}
			expect(member.emailGrounded).toBe(true);
			expect(member.emailSource).toBe('https://example.gov/contact');
		}
	});

	it("renders the stranger's HTML with a route sentence that discriminates between the rows", async () => {
		const projected = await strangerDecisionMakers();
		const { body } = render(PowerLandscape, {
			props: {
				template: TEMPLATE,
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				decisionMakers: (projected.decisionMakers ?? []) as any,
				districtOfficials: [],
				// A guest. Not the author, no district, no possessive framing.
				viewerIsConstituent: false,
				onWriteTo: () => {},
				onBatchRegister: () => {}
			}
		});

		// The stranger DID arrive at a rendered roster.
		expect(body).toContain('Ada Lovelace');
		expect(body).toContain('Bureau of Example');
		expect(body).toContain('Records Office');
		// Guest framing, not the author's.
		expect(body).not.toContain('YOUR REPRESENTATIVES');

		// `emailGrounded` reaches them as a checkable source link, never as a badge
		// or the word "verified" (DecisionMakerLandscapeCard.svelte:136-146).
		expect(body).toContain('https://example.gov/contact');
		expect(body).toContain('example.gov');
		expect(body).not.toMatch(/verified/i);
		expect(body).not.toMatch(/grounded/i);

		// The route sentence is recomputed from published fields alone
		// (DecisionMakerLandscapeCard.svelte:98-108 → target-order.ts:47-57 →
		// seat-route.ts:157-182 → reach-census.ts:127-129), so it crosses no claim
		// boundary. Assert POSITIVELY that it VARIES: `info@` and `clerk@` hit the
		// seat lexicon and read for-office; `publiccomment@` does not and reads
		// unclassified. A constant sentence — the failure mode a wired axis is
		// judged against — cannot satisfy both halves.
		//
		// Sliced by measured position rather than by a fixed order: `mergeLandscape`
		// groups by role, so the array order the projector emits is not the DOM
		// order, and a card whose span is assumed rather than measured would let one
		// row's sentence be read as another's. The card prints its name before its
		// route sentence (DecisionMakerLandscapeCard.svelte:134-149), so each row's
		// span runs from its own name to the next name in the body.
		const rowSpans = ROW_ROUTE_SENTENCES.map(([name, sentence]) => {
			const at = body.indexOf(name);
			expect(at, `${name} is missing from the rendered roster`).toBeGreaterThan(-1);
			return { name, sentence, at };
		}).sort((left, right) => left.at - right.at);
		rowSpans.forEach((row, index) => {
			const span = body.slice(row.at, rowSpans[index + 1]?.at ?? body.length);
			expect(span, `${row.name} must print its own route sentence`).toContain(row.sentence);
			for (const other of EVERY_ROUTE_SENTENCE) {
				if (other === row.sentence) continue;
				expect(span, `${row.name} must not print ${other}`).not.toContain(other);
			}
		});
		// No row is a named person, so none may be labelled one.
		expect(body).not.toContain(ROUTE_PERSON_FORM);

		// No other axis is on this surface. If a future change wires one, this
		// fails and the axis sweep must be re-measured.
		for (const [axis, phrase] of AXIS_VOCABULARY) {
			expect(body, `${axis} vocabulary leaked to the stranger surface`).not.toContain(phrase);
		}
	});

	it('holds the tripwire: the projected rows equal a fixed literal, so any widening is red', async () => {
		const withAxes = await strangerDecisionMakers();
		// Fixed expectation, not a second projector run: adding a key to
		// `publicDecisionMakerFromClaims` (publicTemplateDiscoverySource.ts)
		// turns this red.
		expect(withAxes.decisionMakers).toStrictEqual(EXPECTED_STRANGER_ROWS);

		// Subordinate: the same three rows authored WITHOUT any axis (and without
		// the author-only payload) project to the identical rows. The two inputs
		// differ in author-only fields as well as axes, so this is not an axis-only
		// mutation — it is the weaker statement that none of that payload survives.
		// The third row keeps its reach claim, because that claim is not author
		// payload: it is admitted once at issuance and read back off the
		// attestation, so dropping it here would be changing the input, not
		// stripping the judgment.
		const withoutAxes = await projectRows(
			await Promise.all([
				attested({
					name: 'Ada Lovelace',
					title: 'Director of Public Works',
					organization: 'City of Example',
					roleCategory: 'executes',
					isAiResolved: true,
					emailGrounded: true,
					publicEmailGrounding: {
						version: 1,
						method: 'page-read',
						source: 'https://example.gov/contact'
					},
					emailSource: 'https://example.gov/contact',
					email: 'info@example.gov'
				}),
				attested({
					name: 'Bureau of Example',
					title: 'Public Comment Desk',
					organization: 'City of Example',
					roleCategory: 'executes',
					isAiResolved: true,
					emailGrounded: true,
					publicEmailGrounding: {
						version: 1,
						method: 'page-read',
						source: 'https://example.gov/contact'
					},
					emailSource: 'https://example.gov/contact',
					email: 'publiccomment@example.gov'
				}),
				attested({
					name: 'Records Office',
					title: 'Clerk of the Council',
					organization: 'City of Example',
					roleCategory: 'executes',
					isAiResolved: true,
					emailGrounded: true,
					publicEmailGrounding: {
						version: 1,
						method: 'page-read',
						source: 'https://example.gov/contact'
					},
					emailSource: 'https://example.gov/contact',
					email: 'clerk@example.gov',
					emailReachesClaim: 'seat',
					emailReachesLabel: 'Office of the City Clerk'
				})
			])
		);
		expect(withoutAxes.decisionMakers).toStrictEqual(withAxes.decisionMakers);
	});

	it('survives the consume-side rebuild, and a poisoned axis takes the whole detail down', async () => {
		const projected = await strangerDecisionMakers();

		// The builder then the reader — the pair the anonymous loader runs
		// (src/lib/server/public-template-detail-cache.ts:223). Both delivery lanes
		// rebuild the same stored recipient shape.
		for (const lane of ['email', 'cwc'] as const) {
			const detail = readPublicTemplateDetailProjection(
				buildPublicTemplateDetailProjection(templateFixture(lane), projected)
			);
			expect(detail.recipient_config.decisionMakers, lane).toStrictEqual(EXPECTED_STRANGER_ROWS);
		}

		// A stored row poisoned with an axis is not silently stripped: the
		// per-recipient allow-list calls `invalidDetail`, which throws and takes the
		// page down rather than rendering one bad row.
		expect(() => readPublicTemplateDetailProjection(withPoison(projected, 0, { standing: { standing: 'administers', basis: 'title-inferred' } }))).toThrow(
			/^PUBLIC_TEMPLATE_DETAIL_PROJECTION_INVALID:recipient_config\.decisionMakers\.0/
		);

		// The judgment came off this surface, so the allow-list refuses it again —
		// as it refuses the label it never admitted. Both go down as a whole-detail
		// refusal, never a strip: an allow-list that only ever LOSES keys can only
		// make an anonymous surface smaller.
		for (const stored of [{ reaches: 'seat' }, { reachesLabel: 'Office of the City Clerk' }]) {
			expect(() =>
				readPublicTemplateDetailProjection(withPoison(projected, 0, stored))
			).toThrow(/^PUBLIC_TEMPLATE_DETAIL_PROJECTION_INVALID:recipient_config\.decisionMakers\.0/);
		}
	});

	/**
	 * The removal, driven end to end rather than read. Every value the reader once
	 * sorted into admitted-or-refused now lands on the SAME outcome — the whole
	 * detail is refused — because the key left the allow-list rather than gaining a
	 * stricter comparison. That is the property worth pinning: a surface shrinks by
	 * losing a key, not by learning a better rule for one.
	 */
	it('refuses every stored reach term, including the one issuance once carried, on both lanes', async () => {
		const projected = await strangerDecisionMakers();
		const refusedPoisons: ReadonlyArray<Record<string, unknown>> = [
			{ reaches: 'seat' },
			{ reaches: 'person' },
			{ reaches: 'general' },
			{ reaches: 'Call Jane Doe at 555-0134, home addr 12 Elm St' },
			{ reaches: 'x'.repeat(200) },
			{ reaches: '' },
			{ reaches: 7 },
			{ reaches: null },
			{ reaches: { nested: true } }
		];
		for (const lane of ['email', 'cwc'] as const) {
			for (const poison of refusedPoisons) {
				const label = `${lane}:${JSON.stringify(poison)}`;
				expect(() =>
					readPublicTemplateDetailProjection(withPoison(projected, 0, poison, lane)),
					label
				).toThrow(
					/^PUBLIC_TEMPLATE_DETAIL_PROJECTION_INVALID:recipient_config\.decisionMakers\.0$/
				);
			}
			// And the clean roster still publishes, with the key absent as an
			// own-property on every row rather than present-and-undefined.
			const detail = readPublicTemplateDetailProjection(
				buildPublicTemplateDetailProjection(templateFixture(lane), projected)
			);
			const rows = detail.recipient_config.decisionMakers ?? [];
			expect(rows).toHaveLength(3);
			for (const row of rows) {
				expect(Object.prototype.hasOwnProperty.call(row, 'reaches'), lane).toBe(false);
			}
		}
	});
});
