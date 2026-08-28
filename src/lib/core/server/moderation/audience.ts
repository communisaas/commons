/**
 * Audience derivation for the send-time safety policy.
 *
 * The moderation policy turns on ONE question: does this message land in an
 * institutional role mailbox, or in front of a natural person? That is not the
 * same question as "is the domain a government registry". A registry grant is
 * one way to establish an institutional role — it is no longer the axis.
 *
 * Three states, and only positive evidence earns the permissive one:
 *   institutional — every route is an ATTESTED closed-lexicon seat, a
 *                   registration-restricted government namespace, or the
 *                   certified relay.
 *   person-form   — at least one route carries a natural person's name tokens.
 *   unevaluable   — anything else, including every failure to resolve.
 *
 * `basis: 'seat-lexicon'` does NOT mean "the local part is a role word". It
 * means "a closed-lexicon local part on a domain that published a switchboard
 * and named no human". A role word alone is the default catch-all of a sole
 * proprietor, a landlord, a one-person practice: `office@`, `info@`,
 * `contact@`, `admin@`, `legal@` reach a private person on their only mailbox.
 * The lexicon (`seat-route.ts:4-60`) matches the local part and discards the
 * domain (`classifySeatRoute` normalizes and strips it before the lookup), so
 * attribution has to be decided here — this is the only function in the tree
 * that holds a whole roster at once.
 *
 * Two vetoes and a count, applied in that order (`domainAttestsAnOffice`):
 *   VETO 1  a consumer provider is never an office. Reuses the existing
 *           measured deny-set — `registry/transform.ts:23-26` records that
 *           118 of 987 current-year WA PDC rows (12.0%) are consumer
 *           mailboxes, so this refusal removes real reach and is not
 *           decoration. Checked FIRST, so a pair of role mailboxes on a shared
 *           provider cannot forge a switchboard.
 *   VETO 2  a HUMAN named at this domain. It counts HUMANS, not names: a role
 *           label ("Board of Directors") is not one and is not counted at all,
 *           or the veto would fire on every institution that labels its own
 *           switchboard. So a published name is NOT by itself a refusal — the
 *           test is `nameIsRoleLabel`, and a label whose every identity-bearing
 *           token is a lexicon seat word passes straight through it. When a
 *           human IS counted, the name published beside an address is weaker
 *           evidence than a name token inside the local part (`classifySeatRoute`
 *           demotes on proximity and never promotes), so it refuses promotion
 *           rather than forcing `person-form`. On a registry grant it applies
 *           only when the local part is not itself a lexicon seat: the registrar attests the
 *           OFFICE, so `mayor@` is a desk however it is labelled, while
 *           `caseworker3@` beside "Elena Marsh" is a person staffing one.
 *   COUNT   >= 2 distinct desk `localPart` values on the domain. A sole
 *           proprietor has one catch-all; an institution publishes a board of
 *           them. The count is not asking whether a mailbox is a seat; it is
 *           asking whether an ORGANIZATION rather than a natural person stands
 *           behind the domain, and a judgment about ONE mailbox cannot answer
 *           that.
 *
 * REMOVED, and recorded so the next program does not rebuild it. An attested
 * per-recipient term — a server judgment, signed into the public recipient
 * attestation, that a mailbox `reaches` a seat — was carried to this function
 * for a while and consumed by nothing. It is gone from every layer: the row
 * field, the publication crossing and the signed preimage. Do not re-add it
 * without first reopening one of the three sockets below, because those sockets
 * are what make the term useless, and they are shut by measurement:
 *   - FEED THE COUNT. Measured unsafe. A one-person firm's second alias is
 *     genuinely a second desk by page evidence and still one human, so letting
 *     an attestation supply a desk took `info@onepersonfirm.com` "Office of the
 *     Clerk" beside an attested `support@` from the full person floor to S1,S4
 *     on both delivery lanes.
 *   - PROMOTE ALONE. Refused by construction: `domainAttestsAnOffice` requires
 *     at least one desk standing on evidence that is not itself an attestation,
 *     so a domain whose only office evidence is attestations promotes nothing.
 *   - SUPPRESS VETO 2. The X4 break. An attestation counts DESKS; VETO 2 counts
 *     HUMANS. Buying off the second with the first costs a two-mailbox sole
 *     proprietor S5, S7 and S10.
 * Because all three are shut, a better signal buys nothing — the census measured
 * the term at exactly +0 institutional rows over the absence pass, on the same
 * eleven-row table, and it promoted the identical set of rows either way. The
 * producer still mints the judgment; it simply never arrives here.
 *
 * ACCEPTED RESIDUAL, recorded here rather than fixed. The roster this function
 * reads is author-supplied — it is the `recipient_config` an author wrote, and
 * this tree has no out-of-artifact signal that a domain is an institution. Because
 * VETO 2 counts HUMANS by word list, a person who labels their own two mailboxes
 * with office-shaped names — `office@` "Press Office" beside `legal@` "Legal" —
 * publishes no human the veto can see, meets the count, and earns the narrowed
 * hazard set: S5, S7 and S10 come off, on both delivery lanes, with no attestation
 * involved. That is accepted, not overlooked. The loss is attributable to an
 * author, legible on the public page beside the addresses that caused it, and
 * reversible through the suppression track — and it is accepted, never desired.
 * The permanent assertion lives at
 * `tests/unit/moderation/audience-attested-reach.test.ts`; the size of the class
 * is set by `nameIsRoleLabel` and `SEAT_LOCAL_PARTS`.
 *
 * This transcribes the closed-lexicon note beside `CLOSED_SEAT_LOCAL_PARTS`: a
 * decline costs reach, a false promotion strips a natural person's protection.
 * So a decline is the answer, never a reason to widen the matcher.
 */

import { classifyGovernmentalAddress, emailDomain } from '$lib/core/agents/governmental-class';
import { CONSUMER_MAILBOX_DOMAINS } from '$lib/core/agents/record-blocks';
import {
	classifySeatRoute,
	nameIsRoleLabel,
	type SeatRouteVerdict
} from '$lib/core/agents/seat-route';
import { normalizeAddress } from '$lib/server/addressed-recipients';
import { BLOCKING_HAZARDS, PERSON_BLOCKING_HAZARDS, type MLCommonsHazard } from './types';

/** The policy axis. Three states, exhaustively handled by the hazard resolver. */
export type AudienceForm = 'institutional' | 'person-form' | 'unevaluable';

/** Positive evidence that earned an institutional verdict. */
export type AudienceInstitutionalBasis = 'government-registry' | 'seat-lexicon';

/** Why no verdict could be measured. Every one of these resolves strict. */
export type AudienceUnevaluableReason =
	| 'no-roster'
	| 'no-slug'
	/** The request named no usable addressed set, so no send was measured at all. */
	| 'no-addressed-recipients'
	| 'artifact-unavailable'
	/** An addressed mailbox is absent from the roster this slug publishes. */
	| 'addressee-not-published'
	| 'indeterminate-route'
	/**
	 * A governmental address published a human name beside a local part that is
	 * not itself a closed-lexicon seat. The registry grant attests an OFFICE, not
	 * whoever staffs it: `mayor@` keeps the grant, `caseworker3@` published beside
	 * "Elena Marsh" does not. Without this the name veto was exempted on the whole
	 * registry path and a named public employee lost S5/S7/S10 on the TLD alone,
	 * which is the one thing the audience axis exists to prevent.
	 */
	| 'registry-route-names-a-human'
	/**
	 * A route hit the closed seat lexicon but its domain attested no office —
	 * consumer provider, a human named at the domain, or a single catch-all. Kept
	 * distinct from `indeterminate-route` so the operator can COUNT exactly how
	 * much reach the attestation rule costs instead of burying it.
	 */
	| 'seat-lexicon-unattested'
	| 'roster-too-large';

/**
 * A typed three-state verdict that carries its own basis or reason. Never a
 * bare boolean, never a scalar, never a bare string a caller must re-parse.
 */
export type AudienceVerdict =
	| { form: 'institutional'; basis: AudienceInstitutionalBasis; routes: number }
	| { form: 'person-form'; basis: 'name-token-match'; routes: number }
	| { form: 'unevaluable'; reason: AudienceUnevaluableReason; routes: number };

/**
 * One published route. `null` means the artifact published no name beside this
 * address. The field is required so a policy call site cannot silently omit
 * that safety-relevant fact.
 */
export type AudienceRoute = {
	email?: string;
	name: string | null;
};

/**
 * Roster ceiling, mirroring `DO_NOT_CONTACT_LINK_MAX` at
 * `src/routes/api/do-not-contact/links/+server.ts:39`. A large published config
 * must cost bounded CPU on a send-time path, and it must fail STRICT: above the
 * ceiling nothing is classified at all, so no oversized roster can buy the
 * permissive set by burying one office address among many.
 */
export const AUDIENCE_ROSTER_MAX = 20;

function plainRecord(value: unknown): Record<string, unknown> | undefined {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null
		? (value as Record<string, unknown>)
		: undefined;
}

/**
 * Fold a published `recipient_config` into one route per distinct normalized
 * address, carrying the first non-blank name published beside that address.
 *
 * `emails` is a denormalization of `decisionMakers[].email`; the public artifact
 * reader enforces that invariant: `readPublicRecipientConfig` refuses the whole
 * detail with `recipient_config.email-derivation` unless `emails` equals the
 * deduped `decisionMakers[].email` list elementwise and in order. Treating the two arrays
 * as separate lanes discarded every name and doubled the bounded roster. Invalid
 * entries remain visible as indeterminate routes rather than disappearing.
 */
export function publishedRosterRoutes(recipientConfig: unknown): AudienceRoute[] {
	const config = plainRecord(recipientConfig);
	if (!config) return [];

	const routesByAddress = new Map<string, AudienceRoute>();
	const malformedRoutes: AudienceRoute[] = [];

	const publish = (emailValue: unknown, publishedName: string | null): void => {
		const address = normalizeAddress(emailValue);
		if (!address) {
			malformedRoutes.push({ email: undefined, name: null });
			return;
		}

		const email = emailValue as string;
		const existing = routesByAddress.get(address);
		if (!existing) {
			routesByAddress.set(address, { email, name: publishedName });
			return;
		}
		if (existing.name === null && publishedName !== null) {
			routesByAddress.set(address, { ...existing, name: publishedName });
		}
	};

	if (Array.isArray(config.emails)) {
		for (const email of config.emails) publish(email, null);
	}
	if (Array.isArray(config.decisionMakers)) {
		for (const entry of config.decisionMakers) {
			const decisionMaker = plainRecord(entry);
			if (!decisionMaker) {
				malformedRoutes.push({ email: undefined, name: null });
				continue;
			}
			const name =
				typeof decisionMaker.name === 'string' && decisionMaker.name.trim() !== ''
					? decisionMaker.name
					: null;
			publish(decisionMaker.email, name);
		}
	}

	return [...routesByAddress.values(), ...malformedRoutes];
}

/**
 * What the roster itself says about one domain. Observable without trusting a
 * single author-declared class: `emailGrounded`, `emailSource`, `organization`,
 * `seatRoute` and `governmentalClass` all live in the author-writable
 * `recipient_config` blob and are deliberately not read
 * (`src/routes/api/moderation/personalization/+server.ts:30-34`).
 */
type DomainEvidence = {
	publishesAName: boolean;
	/**
	 * Every distinct desk local part observed at this domain, on ONE kind of
	 * evidence: the closed seat lexicon's own verdict. There is no second source
	 * and no union — a local part the lexicon has no word for contributes
	 * nothing to the `>= 2` switchboard count, whatever else the artifact says
	 * about it.
	 */
	seatLocalParts: Set<string>;
};

/**
 * May a closed-lexicon hit on this domain count toward `institutional`?
 *
 * Veto order is load-bearing; see the two vetoes and the count in the module
 * comment. Every absence answers `false` — a domain that could not be measured
 * never attests.
 */
function domainAttestsAnOffice(
	domain: string | undefined,
	evidence: DomainEvidence | undefined
): boolean {
	if (domain === undefined || evidence === undefined) return false;
	if (CONSUMER_MAILBOX_DOMAINS.has(domain)) return false;
	if (evidence.publishesAName) return false;
	return evidence.seatLocalParts.size >= 2;
}

/**
 * Fold a published roster into one verdict.
 *
 * A certified relay is not a basis at all. It attests the LANE a send travels,
 * never the roster an artifact published, so it is consumed at exactly one
 * place below — the registry name veto — where it corroborates that a named
 * officeholder is reached at an office intake. It classifies nothing on its own.
 *
 * Order is load-bearing:
 *   1. An empty roster is `unevaluable` — absence is never a verdict.
 *   2. An over-ceiling roster is `unevaluable` before any per-route work.
 *   3. Any person-form route makes the whole roster person-form, wherever it
 *      sits in the list — one natural person among ten offices still gets a
 *      natural person's protection.
 *   4. Any route that neither hits the closed seat lexicon nor sits in a
 *      government registry (including a malformed address, which classifies to
 *      `undefined`) makes the roster `unevaluable`. A lexicon hit buys a hearing
 *      here, never a verdict: the route still has to clear
 *      `domainAttestsAnOffice`.
 *   5. A nameless lexicon hit is indeterminate unless its domain independently
 *      attests an office. A named hit whose domain does not attest is
 *      `seat-lexicon-unattested` — the role word is heard, and it is not believed.
 *   6. Only then, with every route positively accounted for, `institutional`.
 *
 * Cost: one bounded pass over the evidence roster and two bounded passes over
 * the classification set (each `<= AUDIENCE_ROSTER_MAX`), plus one `Map`. No
 * network call, no provider call, no Convex function.
 */
export function deriveAudience(
	routes: ReadonlyArray<AudienceRoute>,
	options?: {
		certifiedRelay?: boolean;
		/**
		 * Caller-independent roster evidence used to attest a route's domain.
		 *
		 * The routes being classified may be an addressed subset, but a caller
		 * must not be able to erase the second mailbox that proves a published
		 * switchboard. The endpoint supplies the full published roster here after
		 * first applying that roster's strict verdict as a policy floor.
		 */
		evidenceRoutes?: ReadonlyArray<AudienceRoute>;
	}
): AudienceVerdict {
	const count = routes.length;
	if (count === 0) return { form: 'unevaluable', reason: 'no-roster', routes: 0 };
	if (count > AUDIENCE_ROSTER_MAX) {
		return { form: 'unevaluable', reason: 'roster-too-large', routes: count };
	}
	const evidenceRoutes = options?.evidenceRoutes ?? routes;
	if (evidenceRoutes.length > AUDIENCE_ROSTER_MAX) {
		return {
			form: 'unevaluable',
			reason: 'roster-too-large',
			routes: evidenceRoutes.length
		};
	}

	// Pass 1 — index the caller-independent evidence roster by domain. The routes
	// classified below may be a subset, but evidence never is: otherwise a caller
	// could turn `[board@, press@]` into an unattested `[board@]` by omission.
	// Nothing is decided here; this pass only measures what the artifact published.
	const evidenceByDomain = new Map<string, DomainEvidence>();
	for (const route of evidenceRoutes) {
		const seat = classifySeatRoute(route.email, { candidateName: route.name ?? undefined });
		const domain = emailDomain(route.email ?? '');
		if (domain === undefined) continue;

		let evidence = evidenceByDomain.get(domain);
		if (!evidence) {
			evidence = { publishesAName: false, seatLocalParts: new Set<string>() };
			evidenceByDomain.set(domain, evidence);
		}
		// VETO 2 counts HUMANS, not labels. The public projection requires a name
		// beside every published address, so counting any name at all made the veto
		// fire on every institution that labels its own switchboard — which is the
		// whole non-governmental institutional lane. A desk labelled with its own
		// function ("Board of Directors") is not a human named at this domain.
		if (
			typeof route.name === 'string' &&
			route.name.trim() !== '' &&
			!nameIsRoleLabel(route.name)
		) {
			evidence.publishesAName = true;
		}
		// `seat.localPart` is already NFKC-normalized, `+tag`-stripped and `._-`
		// removed by `classifySeatRoute`, so one mailbox cannot inflate the
		// switchboard by spelling itself several ways. This is the only thing that
		// adds a desk: an `undefined` verdict never counts (a malformed address has
		// no normalized local part), and a `person-form` verdict is never converted
		// into one.
		if (seat?.form === 'seat') evidence.seatLocalParts.add(seat.localPart);
	}

	// Pass 2 — classify only the routes whose verdict is requested.
	const classified: Array<{
		route: AudienceRoute;
		domain: string | undefined;
		seat: SeatRouteVerdict | undefined;
		nameWasDeclared: boolean;
	}> = [];

	for (const route of routes) {
		// The classifier's guard proves only that the `candidateName` KEY was
		// supplied (`classifySeatRoute` opens with a `hasOwnProperty` check that
		// throws, not a truthiness test). Whether the
		// artifact actually published a name is measured here at the policy boundary.
		const publishedName = route.name?.trim() ? route.name : null;
		const seat = classifySeatRoute(route.email, {
			candidateName: publishedName ?? undefined
		});
		// Not trimmed on purpose: `emailDomain` rejects any whitespace and returns
		// `undefined`, and `undefined` must never attest. No-trim is the strict
		// direction, so the untrimmed address is the one that gets asked.
		const domain = emailDomain(route.email ?? '');
		classified.push({
			route: { ...route, name: publishedName },
			domain,
			seat,
			nameWasDeclared: Object.prototype.hasOwnProperty.call(route, 'name')
		});
	}

	let everyRouteIsRegistryGrant = true;
	let sawIndeterminateRoute = false;
	let sawRegistryRouteNamingAHuman = false;
	let sawUnattestedSeat = false;

	// Pass 3 — decide, in the original order, with the same precedence as before.
	for (const { route, domain, seat, nameWasDeclared } of classified) {
		if (seat?.form === 'person-form') {
			return { form: 'person-form', basis: 'name-token-match', routes: count };
		}

		// The registry survives as evidence, not as a branch: it can cover a route
		// the closed lexicon declines, and it never overrides a person-form hit.
		// It is also exempt from the name veto — the grant comes from a third-party
		// registrar, not from the author, so a published name cannot demote it.
		if (classifyGovernmentalAddress(route.email).governmental === true) {
			// The grant attests the OFFICE, not whoever staffs it. A published human
			// name is the author's own evidence that this address reaches a person,
			// and it is not overridden by the registrar unless the local part is
			// itself a closed-lexicon seat — `mayor@` is a desk however it is
			// labelled, `caseworker3@` beside "Elena Marsh" is a person at a desk.
			// ...unless the send goes through the certified relay. That is a
			// third-party attestation that this is an official channel to an
			// official desk — the CWC lane reaches an office intake, not a personal
			// mailbox — so a named officeholder there keeps the grant. Without the
			// relay the only evidence is the author's own roster, and a name beside
			// a non-seat local part is evidence of a person.
			if (options?.certifiedRelay !== true && route.name !== null && seat?.form !== 'seat') {
				sawRegistryRouteNamingAHuman = true;
			}
			continue;
		}

		everyRouteIsRegistryGrant = false;
		// Anything the closed lexicon has no word for is INDETERMINATE, full stop.
		// There is no second source of a seat verdict here and no fallback: a
		// role-form local part the word list does not hold declines, and declining
		// costs reach on purpose.
		if (seat?.form !== 'seat') {
			sawIndeterminateRoute = true;
			continue;
		}

		// The lexicon said "seat", or the issuer did. Domain evidence is consulted
		// before missing-name evidence: a published switchboard can attest a nameless
		// office route, while one nameless catch-all cannot promote itself.
		const evidence = domain === undefined ? undefined : evidenceByDomain.get(domain);
		if (domainAttestsAnOffice(domain, evidence)) continue;

		if (route.name === null && nameWasDeclared) {
			sawIndeterminateRoute = true;
			continue;
		}

		// `AudienceRoute.name` is required and the production fold always declares
		// absence as `null`. Keeping a runtime omission strict under D1's countable
		// reason preserves the pre-type-boundary contract without granting anything.
		sawUnattestedSeat = true;
	}

	// Checked FIRST: a named human at a registry address is the most specific fact
	// the roster carries, and reporting it under its own reason keeps it countable
	// against the two declines D1 already measures.
	if (sawRegistryRouteNamingAHuman) {
		return { form: 'unevaluable', reason: 'registry-route-names-a-human', routes: count };
	}
	if (sawIndeterminateRoute) {
		return { form: 'unevaluable', reason: 'indeterminate-route', routes: count };
	}
	if (sawUnattestedSeat) {
		return { form: 'unevaluable', reason: 'seat-lexicon-unattested', routes: count };
	}

	// The weaker basis wins the label: a roster is only reported as registry-borne
	// when every route in it actually sits inside a restricted namespace.
	return {
		form: 'institutional',
		basis: everyRouteIsRegistryGrant ? 'government-registry' : 'seat-lexicon',
		routes: count
	};
}

/**
 * Resolve the blocking policy from the derived audience.
 *
 * The permissive branch NARROWS the set; it never empties the floor. S1 and S4
 * block in every branch, for every audience, with no flag and no override.
 */
export function blockingHazardsForAudience(verdict: AudienceVerdict): MLCommonsHazard[] {
	return verdict.form === 'institutional' ? BLOCKING_HAZARDS : PERSON_BLOCKING_HAZARDS;
}
