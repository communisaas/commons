/**
 * A logged-out reader lands on a shared template and sees, per row, how that
 * address was published — or sees nothing when nothing was measured.
 *
 * This mounts the landscape at the same seam the public page mounts it, with the
 * prop set an anonymous viewer produces: no user, `viewerIsConstituent: false`,
 * and recipient rows that are literally the output of the public projection
 * reader the anonymous loader runs. Assertions are on rendered DOM, because the
 * sentence only exists if a stranger reads it.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import {
	buildPublicTemplateDetailProjection,
	readPublicTemplateDetailProjection
} from '../../../convex/lib/publicTemplateDiscoverySource';
import type { DistrictOfficialInput } from '$lib/utils/landscapeMerge';
import { describeMeasuredRoute } from '$lib/core/agents/reach-census';

// svelte/motion reads prefers-reduced-motion via window.matchMedia at module
// evaluation — before the shared beforeEach mock from tests/config/setup.ts
// applies. Shim it first, then import the component dynamically.
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
	Object.defineProperty(window, 'matchMedia', {
		value: (query: string) => ({
			matches: false,
			media: query,
			onchange: null,
			addEventListener: () => {},
			removeEventListener: () => {},
			addListener: () => {},
			removeListener: () => {},
			dispatchEvent: () => false
		}),
		writable: true,
		configurable: true
	});
}

const PowerLandscape = (await import('$lib/components/action/PowerLandscape.svelte')).default;

const NOW = 1_800_000_000_000;

function templateFixture(): Parameters<typeof buildPublicTemplateDetailProjection>[0] {
	return {
		_id: 'templates:route-evidence-fixture',
		_creationTime: NOW,
		slug: 'route-evidence-fixture',
		title: 'Route evidence fixture',
		description: 'A public projection fixture.',
		domain: 'civic',
		domainHue: 210,
		type: 'email',
		deliveryMethod: 'email',
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
 * The rows the stranger's page actually carries: built by the public detail
 * builder and admitted by the reader, then handed to the landscape untouched.
 */
const PROJECTED_ROWS = (() => {
	const rows = [
		{
			name: 'Records Office',
			title: 'Records Office',
			organization: 'Example Agency',
			email: 'clerk@example.gov',
			emailGrounded: true as const,
			emailSource: 'https://example.gov/contact'
		},
		{
			name: 'Records Access',
			title: 'Records Access',
			organization: 'Example Agency',
			email: 'foia@example.gov',
			emailGrounded: true as const,
			emailSource: 'https://example.gov/contact'
		}
	];
	const detail = readPublicTemplateDetailProjection(
		buildPublicTemplateDetailProjection(templateFixture(), {
			emails: rows.map((row) => row.email),
			decisionMakers: rows as never
		})
	);
	const projected = detail.recipient_config.decisionMakers ?? [];
	if (projected.length !== rows.length) throw new Error('TEST_PROJECTION_DROPPED_ROWS');
	return projected;
})();

const DISTRICT_OFFICIAL: DistrictOfficialInput = {
	name: 'Ada Representative',
	title: 'Representative',
	organization: 'House of Representatives',
	bioguideId: 'A000001',
	cwcCode: 'CA01',
	chamber: 'house',
	phone: '202-555-0100',
	contactFormUrl: 'https://example.house.gov/contact',
	websiteUrl: 'https://example.house.gov'
};

/**
 * The SAME person the projection admitted, re-entered through the district lane.
 * `mergeLandscape` hard-sets `emailGrounded: false` / `emailSource: null` on a
 * district member (`src/lib/utils/landscapeMerge.ts:214-216`), so this row's
 * route provenance is `none` — exactly the shape the card no longer guards
 * against. It stays silent only because `RoleGroup.svelte:60` sends it to
 * `DistrictOfficialCard` instead.
 */
const SAME_PERSON_AS_DISTRICT: DistrictOfficialInput = {
	name: PROJECTED_ROWS[0].name,
	title: PROJECTED_ROWS[0].title,
	organization: PROJECTED_ROWS[0].organization,
	bioguideId: 'R000001',
	cwcCode: 'CA02',
	chamber: 'house',
	phone: '202-555-0101',
	contactFormUrl: 'https://example.house.gov/contact',
	websiteUrl: 'https://example.house.gov'
};

/**
 * The closed route vocabulary, derived by calling the census's own describer —
 * never re-typed here, so this file cannot drift into a second wording of the
 * same measurement. One shape per `RoutedRowKey`
 * (`src/lib/core/agents/reach-census.ts:81-90`).
 */
const SEAT = { form: 'seat', localPart: 'clerk', nameTokenMatch: false, lexiconHit: 'clerk' } as const;
const PERSON_FORM = {
	form: 'person-form',
	localPart: 'adalovelace',
	nameTokenMatch: true,
	lexiconHit: null
} as const;
const SOURCE = 'https://example.gov/contact';
const ROUTED_LABELS = [
	...new Set(
		[
			{ routeProvenance: { provenance: 'beside-person', source: SOURCE }, seatRoute: SEAT },
			{ routeProvenance: { provenance: 'for-office', source: SOURCE }, seatRoute: SEAT },
			{ routeProvenance: { provenance: 'on-page-untied', source: SOURCE }, seatRoute: PERSON_FORM },
			{ routeProvenance: { provenance: 'on-page-untied', source: SOURCE }, seatRoute: SEAT },
			{ routeProvenance: { provenance: 'none', reason: 'unknown' }, seatRoute: SEAT }
		].map((candidate) => describeMeasuredRoute(candidate as never))
	)
];
const UNMEASURED_LABEL = describeMeasuredRoute({
	routeProvenance: { provenance: 'none', reason: 'unknown' },
	seatRoute: SEAT
} as never);

type MountOverrides = {
	decisionMakers?: readonly unknown[];
	districtOfficials?: readonly DistrictOfficialInput[];
};

function mountLandscape(overrides: MountOverrides = {}) {
	return render(PowerLandscape, {
		props: {
			// Non-congressional delivery, so the landscape renders rows rather than
			// the address-verification empty state.
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			template: { deliveryMethod: 'email' } as any,
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			decisionMakers: (overrides.decisionMakers ?? PROJECTED_ROWS) as any,
			districtOfficials: (overrides.districtOfficials ?? [DISTRICT_OFFICIAL]) as DistrictOfficialInput[],
			contactedRecipients: new Set<string>(),
			departingRecipients: new Set<string>(),
			priorContactIds: new Set<string>(),
			viewerIsConstituent: false,
			onWriteTo: () => {},
			onBatchRegister: () => {}
		}
	});
}

function occurrences(haystack: string, needle: string): number {
	return haystack.split(needle).length - 1;
}

describe('the public landscape says how each address was published', () => {
	it('says it once per addressed row, in the census vocabulary', () => {
		const { container } = mountLandscape();
		const text = container.textContent ?? '';

		expect(occurrences(text, 'Address published for an office')).toBe(1);
		expect(occurrences(text, 'Address published on a page, route form unclassified')).toBe(1);
	});

	/**
	 * ROUTING pin, not a card-branch pin. The card now renders its sentence
	 * unconditionally, so the only reason an unrouted district row prints nothing
	 * is that `RoleGroup.svelte:60` never hands it to `DecisionMakerLandscapeCard`.
	 *
	 * Executed mutation this dies under: change that condition to route
	 * `member.source === 'district'` rows into `DecisionMakerLandscapeCard`.
	 */
	it('keeps the unrouted district row out of the card that speaks about routes', () => {
		const { container } = mountLandscape();

		// Dies under the RoleGroup mutation: the district member's provenance is
		// `none`, so the card would print the census's unmeasured label.
		expect(occurrences(container.innerHTML, UNMEASURED_LABEL)).toBe(0);
	});

	/**
	 * The same person down both lanes. The projected copy of them has a measured
	 * route and says so; the district copy of them has none of the five route
	 * sentences at all — not because the row was filtered out (their name is on
	 * screen) but because a different component renders it.
	 */
	it('says it for the projected copy of a person and not for the district copy', () => {
		// Self-check: the vocabulary really is the five closed labels.
		expect(ROUTED_LABELS).toHaveLength(5);

		const projectedOnly = mountLandscape({
			decisionMakers: [PROJECTED_ROWS[0]],
			districtOfficials: []
		});
		const projectedText = projectedOnly.container.textContent ?? '';
		// Dies if the card stops rendering the sentence, or renders the wrong one.
		expect(projectedText).toContain(PROJECTED_ROWS[0].name);
		expect(occurrences(projectedText, 'Address published for an office')).toBe(1);

		const districtOnly = mountLandscape({
			decisionMakers: [],
			districtOfficials: [SAME_PERSON_AS_DISTRICT]
		});
		const districtHtml = districtOnly.container.innerHTML;
		// The row is on screen …
		expect(districtHtml).toContain(SAME_PERSON_AS_DISTRICT.name);
		// … and says nothing about a route. Dies under the RoleGroup mutation for
		// the unmeasured label, and under any wiring that gave a district member a
		// grounded source for the other four.
		for (const label of ROUTED_LABELS) {
			expect(occurrences(districtHtml, label), `${label} reached a district row`).toBe(0);
		}
	});

	it('gates nothing — every write affordance is still offered', () => {
		const { container } = mountLandscape();
		const text = container.textContent ?? '';

		expect(occurrences(text, 'Write to them')).toBeGreaterThanOrEqual(2);
	});
});
