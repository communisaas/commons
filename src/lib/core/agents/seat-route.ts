import type { ContactRouteVerdict } from '$lib/core/agents/contact-route-verdict';
import type { RoleCategory } from '$lib/types/template';

const CLOSED_SEAT_LOCAL_PARTS = [
	'president',
	'chancellor',
	'provost',
	'superintendent',
	'mayor',
	'premier',
	'governor',
	'board',
	'boardofdirectors',
	'boardofeducation',
	'trustees',
	'clerk',
	'cityclerk',
	'cityhall',
	'council',
	'citycouncil',
	'corporatesecretary',
	'secretary',
	'generalcounsel',
	'legal',
	'press',
	'media',
	'mediarelations',
	'news',
	'newsroom',
	'communications',
	'comms',
	'publicaffairs',
	'publicinformation',
	'governmentaffairs',
	'governmentrelations',
	'publicrelations',
	'investorrelations',
	'patientrelations',
	'patientexperience',
	'ombuds',
	'ombudsman',
	'ombudsoffice',
	'compliance',
	'ethics',
	'info',
	// Observed for Oregon Department of Corrections (convex/seedData.ts:458).
	'docinfo',
	'contact',
	'inquiries',
	'admin',
	'office',
	'executivedirector',
	'chiefofstaff',
	'registrar',
	'planning',
	'permits',
	'zoning',
	'publicworks',
	'sustainability'
] as const;

/**
 * A genuinely read-only Set surface. `Object.freeze(new Set(...))` freezes only
 * the wrapper object; its `add`, `delete`, and `clear` methods still mutate the
 * Set's internal data. This proxy never exposes those mutation methods or the
 * enclosed Set, while binding every read method to the real Set receiver.
 */
function closedReadonlySet<T>(values: Iterable<T>): ReadonlySet<T> {
	const members = new Set(values);
	const readonlyView = new Proxy(members, {
		get(target, property) {
			if (property === 'add' || property === 'delete' || property === 'clear') return undefined;

			const value: unknown = Reflect.get(target, property, target);
			return typeof value === 'function' ? value.bind(target) : value;
		}
	});

	return Object.freeze(readonlyView);
}

export const SEAT_LOCAL_PARTS: ReadonlySet<string> = closedReadonlySet(CLOSED_SEAT_LOCAL_PARTS);

export type SeatRouteForm = 'seat' | 'person-form' | 'indeterminate';

export type SeatRouteVerdict = {
	form: SeatRouteForm;
	localPart: string;
	nameTokenMatch: boolean;
	lexiconHit: string | null;
};

export type SeatRouteClassificationOptions = {
	candidateName: string | undefined;
	demote?: boolean;
};

// The lexicon is CLOSED and has bounded recall by construction. Compound
// role boxes (`pressoffice`, `MOComms`, `cdec_communications`, `TGHnews`) will
// decline to `indeterminate`. That is the intended failure mode: a decline
// costs reach, a false promotion publishes a private mailbox as an office.

// Proximity may DEMOTE, never promote. Measured on president.uconn.edu/contact:
// `rasid@uconn.edu` sits ~710 chars from "Office of the President" while
// `paige.rasid@uconn.edu` — the same person — has none within 1500. Any rule
// that promotes on proximity types one of one person's two mailboxes as a seat.

export function classifySeatRoute(
	email: string | undefined,
	opts: SeatRouteClassificationOptions
): SeatRouteVerdict | undefined {
	if (!opts || !Object.prototype.hasOwnProperty.call(opts, 'candidateName')) {
		throw new TypeError('classifySeatRoute requires explicit candidateName evidence');
	}
	if (!email || !email.includes('@')) return undefined;

	const rawLocalPart = email.slice(0, email.indexOf('@')).normalize('NFKC').toLowerCase();
	const untaggedLocalPart = rawLocalPart.split('+', 1)[0];
	const localPart = untaggedLocalPart.replace(/[._-]/g, '');
	const localPartTokens = new Set(
		untaggedLocalPart
			.split(/[._-]/)
			.map((token) => token.replace(/[^a-z]/g, ''))
			.filter(Boolean)
	);
	const nameTokens =
		opts.candidateName
			?.normalize('NFKC')
			.toLowerCase()
			.match(/[a-z]+/g) ?? [];
	const nameTokenMatch = nameTokens.some(
		(token) => token.length >= 3 && (localPartTokens.has(token) || token === localPart)
	);

	if (nameTokenMatch) {
		return { form: 'person-form', localPart, nameTokenMatch, lexiconHit: null };
	}

	if (SEAT_LOCAL_PARTS.has(localPart)) {
		return {
			form: opts.demote === true ? 'indeterminate' : 'seat',
			localPart,
			nameTokenMatch,
			lexiconHit: localPart
		};
	}

	return { form: 'indeterminate', localPart, nameTokenMatch, lexiconHit: null };
}

export type RouteProvenanceClass = 'beside-person' | 'for-office' | 'on-page-untied' | 'none';

export type RouteProvenance =
	| { provenance: 'beside-person' | 'for-office' | 'on-page-untied'; source: string }
	| { provenance: 'none'; reason: ContactRouteVerdict['status'] };

export function deriveRouteProvenance(input: {
	seat?: SeatRouteVerdict;
	emailGrounded?: boolean;
	emailSource?: string;
	contactRouteStatus?: ContactRouteVerdict['status'];
	blockScopedAssociation?: boolean;
}): RouteProvenance {
	const none: RouteProvenance = {
		provenance: 'none',
		reason: input.contactRouteStatus ?? 'unknown'
	};
	// A detached or malformed address has no route, even when stale grounding
	// metadata survives MX verification on the candidate object.
	if (!input.seat) return none;

	const source = input.emailSource?.trim();
	if (!source) return none;

	if (input.blockScopedAssociation === true) return { provenance: 'beside-person', source };
	if (input.emailGrounded === true && input.seat?.form === 'seat') {
		return { provenance: 'for-office', source };
	}
	if (input.emailGrounded === true) return { provenance: 'on-page-untied', source };

	return none;
}

export type StandingClass =
	| 'channel-of-record'
	| 'decides'
	| 'gates'
	| 'administers'
	| 'staffs-a-decider'
	| 'designated-subject-contact'
	| 'coalition'
	| 'in-the-building';

export type StandingBasis = 'page-stated' | 'registry-field' | 'title-inferred' | 'model-inferred';

export type StandingVerdict = { standing: StandingClass; basis: StandingBasis };

export const STANDING_ORDER: readonly StandingClass[] = Object.freeze([
	'channel-of-record',
	'decides',
	'gates',
	'administers',
	'staffs-a-decider',
	'designated-subject-contact',
	'coalition',
	'in-the-building'
]);

const ROLE_CATEGORY_STANDING: Readonly<Record<RoleCategory, StandingClass>> = Object.freeze({
	votes: 'decides',
	oversees: 'gates',
	funds: 'gates',
	executes: 'administers',
	shapes: 'coalition'
});

function standingFromRoleText(value: string, allowChannelOfRecord: boolean): StandingClass {
	if (allowChannelOfRecord && /\bchannel\s+of\s+record\b/i.test(value)) {
		return 'channel-of-record';
	}
	if (
		/\b(?:deputy\s+chief\s+of\s+staff|chief\s+of\s+staff|aide|legislative\s+assistant|district\s+director)\b/i.test(
			value
		)
	) {
		return 'staffs-a-decider';
	}
	if (
		/\b(?:ombuds|patient\s+relations|public\s+information\s+officer|press\s+secretary|communications\s+director)\b/i.test(
			value
		)
	) {
		return 'designated-subject-contact';
	}
	if (
		/\b(?:president|chancellor|provost|superintendent|mayor|governor|premier|director|commissioner|councilmember|supervisor|trustee)\b/i.test(
			value
		)
	) {
		return 'decides';
	}
	if (/\b(?:chair|chairman|chairwoman|speaker|committee)\b/i.test(value)) return 'gates';
	if (/\b(?:manager|administrator|registrar|clerk|coordinator|planner)\b/i.test(value)) {
		return 'administers';
	}
	return 'in-the-building';
}

export function deriveStanding(input: {
	title?: string;
	roleCategory?: RoleCategory;
	pageStatedRole?: string;
	registryRoleField?: string;
}): StandingVerdict {
	if (input.pageStatedRole?.trim()) {
		return {
			standing: standingFromRoleText(input.pageStatedRole, true),
			basis: 'page-stated'
		};
	}
	if (input.registryRoleField?.trim()) {
		return {
			standing: standingFromRoleText(input.registryRoleField, false),
			basis: 'registry-field'
		};
	}
	if (input.title?.trim()) {
		const standing = standingFromRoleText(input.title, false);
		if (standing !== 'in-the-building') return { standing, basis: 'title-inferred' };
	}
	if (input.roleCategory) {
		return { standing: ROLE_CATEGORY_STANDING[input.roleCategory], basis: 'model-inferred' };
	}
	return { standing: 'in-the-building', basis: 'model-inferred' };
}

// Two axes. Never multiplied into a scalar, never summed, never averaged, never
// colored green. `compareTargetOrder` returns -1/0/1 only; a real tie returns 0
// and the renderer must show it as a tie.

const PROVENANCE_ORDER: readonly RouteProvenanceClass[] = Object.freeze([
	'beside-person',
	'for-office',
	'on-page-untied',
	'none'
]);

function compareOrdinals(left: number, right: number): -1 | 0 | 1 {
	if (left < right) return -1;
	if (left > right) return 1;
	return 0;
}

export function compareTargetOrder(
	a: { standing?: StandingVerdict; clockRank?: number; routeProvenance?: RouteProvenance },
	b: { standing?: StandingVerdict; clockRank?: number; routeProvenance?: RouteProvenance }
): -1 | 0 | 1 {
	const standingOrder = compareOrdinals(
		a.standing ? STANDING_ORDER.indexOf(a.standing.standing) : STANDING_ORDER.length,
		b.standing ? STANDING_ORDER.indexOf(b.standing.standing) : STANDING_ORDER.length
	);
	if (standingOrder !== 0) return standingOrder;

	if (a.clockRank !== undefined && b.clockRank !== undefined) {
		const clockOrder = compareOrdinals(a.clockRank, b.clockRank);
		if (clockOrder !== 0) return clockOrder;
	}

	return compareOrdinals(
		a.routeProvenance
			? PROVENANCE_ORDER.indexOf(a.routeProvenance.provenance)
			: PROVENANCE_ORDER.length,
		b.routeProvenance
			? PROVENANCE_ORDER.indexOf(b.routeProvenance.provenance)
			: PROVENANCE_ORDER.length
	);
}
