import { describe, expect, it } from 'vitest';
import { orderTargetsForDisplay, routeEvidenceFor } from '$lib/core/agents/target-order';
import type { ContactRouteVerdict } from '$lib/core/agents/contact-route-verdict';
import type { StandingVerdict } from '$lib/core/agents/seat-route';

/**
 * Every fixture is built in the shape the SSE projection actually emits
 * (`src/routes/api/agents/stream-decision-makers/+server.ts:352-376`), including
 * its falsy-empty-string conventions: `email: dm.email || ''`,
 * `emailSource: dm.emailSource || ''`, `contactRoute: dm.contactRoute ?? { status: 'unknown' }`.
 */
type WireRow = {
	name: string;
	title: string;
	organization: string;
	email: string;
	emailGrounded: boolean;
	emailSource: string;
	contactRoute: ContactRouteVerdict;
	standing?: StandingVerdict;
};

function wireRow(overrides: Partial<WireRow> & { name: string }): WireRow {
	return {
		title: 'Title',
		organization: 'City of Example',
		email: '',
		emailGrounded: false,
		emailSource: '',
		contactRoute: { status: 'unknown' },
		...overrides
	};
}

// `clerk` is in the closed seat lexicon and shares no token with the candidate
// name, so this classifies `seat`, not `person-form`.
const officeBox = wireRow({
	name: 'Dana Whitfield',
	email: 'clerk@city.gov',
	emailGrounded: true,
	emailSource: 'https://city.gov/clerk',
	contactRoute: { status: 'routed' }
});

const personForm = wireRow({
	name: 'Marta Reyes',
	email: 'marta.reyes@city.gov',
	emailGrounded: true,
	emailSource: 'https://city.gov/staff',
	contactRoute: { status: 'routed' }
});

const noAddress = wireRow({
	name: 'Owen Park',
	contactRoute: { status: 'absent', readSource: 'https://city.gov/contact' }
});

describe('orderTargetsForDisplay', () => {
	it('orders an office box above a person-form address above a row with no address', () => {
		const ordered = orderTargetsForDisplay([noAddress, personForm, officeBox]);

		expect(ordered.map((row) => row.name)).toEqual([
			officeBox.name,
			personForm.name,
			noAddress.name
		]);
	});

	it('never ranks one contact-route absence against another', () => {
		// `blocked` and `absent` both collapse to RouteProvenance{provenance:'none'},
		// a single ordering index — so they tie and hold input order either way.
		const blockedRow = wireRow({
			name: 'Blocked Row',
			contactRoute: { status: 'blocked', hosts: ['city.gov'] }
		});
		const absentRow = wireRow({
			name: 'Absent Row',
			contactRoute: { status: 'absent', readSource: 'https://city.gov/contact' }
		});

		expect(orderTargetsForDisplay([blockedRow, absentRow]).map((r) => r.name)).toEqual([
			'Blocked Row',
			'Absent Row'
		]);
		expect(orderTargetsForDisplay([absentRow, blockedRow]).map((r) => r.name)).toEqual([
			'Absent Row',
			'Blocked Row'
		]);
	});

	it('orders identically whether or not an inferred standing is present', () => {
		const inferred: StandingVerdict = { standing: 'decides', basis: 'title-inferred' };
		const withStanding = [
			{ ...noAddress, standing: inferred },
			{ ...personForm, standing: inferred },
			{ ...officeBox, standing: inferred }
		];
		const withoutStanding = [noAddress, personForm, officeBox];

		expect(orderTargetsForDisplay(withStanding).map((r) => r.name)).toEqual(
			orderTargetsForDisplay(withoutStanding).map((r) => r.name)
		);
	});

	it('also refuses a model-inferred standing as an ordering key', () => {
		const inferred: StandingVerdict = { standing: 'decides', basis: 'model-inferred' };
		// The most "important"-sounding standing sits on the row with no address:
		// if inference were ordering anything, this row would rise.
		const ordered = orderTargetsForDisplay([
			{ ...noAddress, standing: inferred },
			personForm,
			officeBox
		]);

		expect(ordered.map((r) => r.name)).toEqual([officeBox.name, personForm.name, noAddress.name]);
	});

	it('does not move a hand-typed address that no page read produced', () => {
		// `emailSource: ''` is exactly what the wire sends for an address the author
		// typed. `deriveRouteProvenance` returns `none` for it, so it ties with the
		// other unmeasured rows and must not jump under the author's cursor.
		const handTyped = wireRow({ name: 'Hand Typed', email: 'someone@city.gov' });
		const ordered = orderTargetsForDisplay([noAddress, handTyped, personForm]);

		expect(ordered.map((r) => r.name)).toEqual([personForm.name, noAddress.name, 'Hand Typed']);
	});

	it('returns the same object references in a new array and never mutates the input', () => {
		const input = [noAddress, personForm, officeBox];
		const snapshot = [...input];
		const ordered = orderTargetsForDisplay(input);

		expect(ordered).not.toBe(input);
		expect(ordered[0]).toBe(officeBox);
		expect(ordered[1]).toBe(personForm);
		expect(ordered[2]).toBe(noAddress);
		expect(input).toEqual(snapshot);
		expect(input[0]).toBe(snapshot[0]);
	});
});

describe('routeEvidenceFor', () => {
	it('reports a grounded seat-lexicon address as published for an office', () => {
		const evidence = routeEvidenceFor(officeBox);

		expect(evidence.seatRoute?.form).toBe('seat');
		expect(evidence.routeProvenance.provenance).toBe('for-office');
	});

	it('reports a grounded person-form address as on-page but untied', () => {
		const evidence = routeEvidenceFor(personForm);

		expect(evidence.seatRoute?.form).toBe('person-form');
		expect(evidence.routeProvenance.provenance).toBe('on-page-untied');
	});

	it('agrees on an absent contactRoute and the wire unknown verdict', () => {
		const withoutVerdict = routeEvidenceFor({ name: 'Owen Park' });
		const withUnknown = routeEvidenceFor({ name: 'Owen Park', contactRoute: { status: 'unknown' } });

		expect(withoutVerdict).toEqual(withUnknown);
		expect(withoutVerdict.routeProvenance).toEqual({ provenance: 'none', reason: 'unknown' });
	});

	it('keeps the absence reason the row actually carries', () => {
		expect(routeEvidenceFor(noAddress).routeProvenance).toEqual({
			provenance: 'none',
			reason: 'absent'
		});
	});
});
