import { absent, blocked, present, withheld, type Fact } from '$lib/core/fact';
import type {
	ContactRouteStatus,
	ContactRouteVerdict
} from '$lib/core/agents/contact-route-verdict';
import type {
	RouteProvenance,
	RouteProvenanceClass,
	SeatRouteForm,
	SeatRouteVerdict
} from '$lib/core/agents/seat-route';

export type ReachCensusRow = { key: string; label: string; count: number };
export type ReachCensus = { observed: number; rows: ReachCensusRow[] };

type ReachCensusCandidate = {
	contactRoute?: ContactRouteVerdict;
	seatRoute?: SeatRouteVerdict;
	routeProvenance?: RouteProvenance;
};

type RoutedRowKey =
	| 'route-beside-person'
	| 'route-for-office'
	| 'route-on-page-person-form'
	| 'route-on-page-unclassified'
	| 'route-unmeasured';

type AbsenceRowKey =
	| 'absence-blocked'
	| 'absence-absent'
	| 'absence-ungrounded'
	| 'absence-undeliverable'
	| 'absence-unknown';

type ReachCensusKey = RoutedRowKey | AbsenceRowKey;

const PROVENANCE_ROW_KEYS = {
	'beside-person': 'route-beside-person',
	'for-office': 'route-for-office',
	'on-page-untied': 'route-on-page-unclassified',
	none: 'route-unmeasured'
} satisfies Record<RouteProvenanceClass, RoutedRowKey>;

const ON_PAGE_FORM_ROW_KEYS = {
	seat: 'route-on-page-unclassified',
	'person-form': 'route-on-page-person-form',
	indeterminate: 'route-on-page-unclassified'
} satisfies Record<SeatRouteForm, RoutedRowKey>;

const ROUTED_LABELS = {
	'route-beside-person': 'Address published beside a named person',
	'route-for-office': 'Address published for an office',
	'route-on-page-person-form': 'Person-form address published without a page tie',
	'route-on-page-unclassified': 'Address published on a page, route form unclassified',
	'route-unmeasured': 'Address publication route not established this run'
} satisfies Record<RoutedRowKey, string>;

const CONTACT_ROUTE_ROW_KEYS = {
	routed: 'route-unmeasured',
	blocked: 'absence-blocked',
	absent: 'absence-absent',
	ungrounded: 'absence-ungrounded',
	undeliverable: 'absence-undeliverable',
	unknown: 'absence-unknown'
} satisfies Record<ContactRouteStatus, ReachCensusKey>;

const CONTACT_ROUTE_LABELS = {
	routed: 'Published route',
	blocked: 'Retrieval blocked',
	absent: 'No address published',
	ungrounded: 'Address claimed but not contained in a page read this run',
	undeliverable: 'Address rejected by its own mail server',
	unknown: 'Undetermined'
} satisfies Record<ContactRouteStatus, string>;

const ROW_ORDER = [
	'route-beside-person',
	'route-for-office',
	'route-on-page-person-form',
	'route-on-page-unclassified',
	'route-unmeasured',
	'absence-blocked',
	'absence-absent',
	'absence-ungrounded',
	'absence-undeliverable',
	'absence-unknown'
] as const satisfies readonly ReachCensusKey[];

const ROW_ORDER_INDEX = new Map<ReachCensusKey, number>(
	ROW_ORDER.map((key, index) => [key, index])
);

type MutableBucket = { label: string; count: number };

function addToBucket(
	buckets: Map<ReachCensusKey, MutableBucket>,
	key: ReachCensusKey,
	label: string
): void {
	const bucket = buckets.get(key);
	if (bucket) {
		if (bucket.label !== label) {
			throw new Error(`Reach census label mismatch for ${key}`);
		}
		bucket.count += 1;
		return;
	}
	buckets.set(key, { label, count: 1 });
}

function measuredRouteRow(candidate: ReachCensusCandidate): RoutedRowKey {
	const provenance = candidate.routeProvenance?.provenance;
	const form = candidate.seatRoute?.form;
	if (!provenance || !form) return 'route-unmeasured';
	if (provenance === 'for-office' && form !== 'seat') return 'route-unmeasured';
	if (provenance !== 'on-page-untied') return PROVENANCE_ROW_KEYS[provenance];

	return ON_PAGE_FORM_ROW_KEYS[form];
}

/**
 * The single sentence for one addressed row, drawn verbatim from the census's
 * existing label vocabulary. No new copy: a per-row sentence and a census row
 * must never describe the same measurement in two different words.
 */
export function describeMeasuredRoute(candidate: ReachCensusCandidate): string {
	return ROUTED_LABELS[measuredRouteRow(candidate)];
}

/**
 * A disjoint, fixed-order census of one resolution run. The two upstream axes
 * remain categorical: no confidence, weight, division, or count-derived score
 * participates in choosing a row.
 */
export function reachCensus(candidates: readonly ReachCensusCandidate[]): ReachCensus {
	const buckets = new Map<ReachCensusKey, MutableBucket>();

	for (const candidate of candidates) {
		const verdict = candidate.contactRoute;
		if (!verdict) {
			throw new Error('Reach census candidate is missing its contact-route verdict');
		}

		if (verdict.status === 'routed') {
			const key = measuredRouteRow(candidate);
			addToBucket(buckets, key, ROUTED_LABELS[key]);
			continue;
		}

		addToBucket(
			buckets,
			CONTACT_ROUTE_ROW_KEYS[verdict.status],
			CONTACT_ROUTE_LABELS[verdict.status]
		);
	}

	const rows = ROW_ORDER.flatMap((key) => {
		const bucket = buckets.get(key);
		return bucket && bucket.count > 0 ? [{ key, label: bucket.label, count: bucket.count }] : [];
	});
	const observed = candidates.length;
	const rowTotal = rows.reduce((sum, row) => sum + row.count, 0);
	if (rowTotal !== observed) {
		throw new Error(`Reach census invariant failed: ${rowTotal} rows for ${observed} candidates`);
	}

	return { observed, rows };
}

function cloneReachCensus(census: ReachCensus): ReachCensus {
	return {
		observed: census.observed,
		rows: census.rows.map((row) => ({ ...row }))
	};
}

export function isReachCensus(value: unknown): value is ReachCensus {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const candidate = value as Partial<ReachCensus>;
	if (!Number.isInteger(candidate.observed) || Number(candidate.observed) < 0) return false;
	if (!Array.isArray(candidate.rows)) return false;

	let previousIndex = -1;
	let rowTotal = 0;
	const seen = new Set<ReachCensusKey>();
	for (const row of candidate.rows) {
		if (!row || typeof row !== 'object' || Array.isArray(row)) return false;
		const raw = row as Partial<ReachCensusRow>;
		if (typeof raw.key !== 'string' || !ROW_ORDER_INDEX.has(raw.key as ReachCensusKey)) {
			return false;
		}
		const key = raw.key as ReachCensusKey;
		const index = ROW_ORDER_INDEX.get(key)!;
		if (index <= previousIndex || seen.has(key)) return false;
		if (typeof raw.label !== 'string' || raw.label.trim().length === 0) return false;
		if (!Number.isInteger(raw.count) || Number(raw.count) <= 0) return false;

		previousIndex = index;
		seen.add(key);
		rowTotal += Number(raw.count);
	}

	return rowTotal === candidate.observed;
}

/**
 * Read a census across the SSE/device boundary without turning a missing or
 * malformed observation into null, an empty census, or a fabricated zero.
 */
export function parseReachCensusFact(value: unknown, blockedWhy: string): Fact<ReachCensus> {
	if (isReachCensus(value)) return present(cloneReachCensus(value));
	if (!value || typeof value !== 'object' || Array.isArray(value)) return blocked(blockedWhy);

	const fact = value as { state?: unknown; value?: unknown; why?: unknown };
	switch (fact.state) {
		case 'present':
			return isReachCensus(fact.value)
				? present(cloneReachCensus(fact.value))
				: blocked(blockedWhy);
		case 'absent':
			return absent();
		case 'withheld':
			return typeof fact.why === 'string' && fact.why.trim()
				? withheld(fact.why)
				: blocked(blockedWhy);
		case 'blocked':
			return typeof fact.why === 'string' && fact.why.trim()
				? blocked(fact.why)
				: blocked(blockedWhy);
		default:
			return blocked(blockedWhy);
	}
}

export function cloneReachCensusFact(fact: Fact<ReachCensus>): Fact<ReachCensus> {
	return parseReachCensusFact(fact, 'Stored reach census was malformed');
}
