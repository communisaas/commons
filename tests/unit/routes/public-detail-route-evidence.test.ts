/**
 * What a stranger's page can say about a published address.
 *
 * The rows a logged-out reader gets are whatever `readPublicTemplateDetailProjection`
 * admits — the same validator the anonymous loader runs. So the sentence a card
 * renders is derived here from PROJECTED rows, never from hand-built ones: if the
 * projection ever stopped carrying a field the sentence reads, this file fails
 * before the component one does.
 */
import { describe, expect, it } from 'vitest';
import {
	buildPublicTemplateDetailProjection,
	readPublicTemplateDetailProjection
} from '../../../convex/lib/publicTemplateDiscoverySource';
import { routeEvidenceFor } from '$lib/core/agents/target-order';
import { describeMeasuredRoute } from '$lib/core/agents/reach-census';

const NOW = 1_800_000_000_000;

const ALLOWED_RECIPIENT_KEYS = [
	'name',
	'title',
	'role',
	'shortName',
	'organization',
	'roleCategory',
	'email',
	'emailGrounded',
	'emailSource'
];

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

const SEAT_ROW = {
	name: 'Records Office',
	title: 'Records Office',
	organization: 'Example Agency',
	email: 'clerk@example.gov',
	emailGrounded: true as const,
	emailSource: 'https://example.gov/contact'
};

const UNCLASSIFIED_ROW = {
	name: 'Records Access',
	title: 'Records Access',
	organization: 'Example Agency',
	email: 'foia@example.gov',
	emailGrounded: true as const,
	emailSource: 'https://example.gov/contact'
};

/** The emails array must derive from the roster, in order (`recipient_config.email-derivation`). */
function projectedRows(
	decisionMakers: readonly Record<string, unknown>[] = [SEAT_ROW, UNCLASSIFIED_ROW]
) {
	const detail = readPublicTemplateDetailProjection(
		buildPublicTemplateDetailProjection(templateFixture(), {
			emails: decisionMakers.map((row) => row.email as string),
			decisionMakers: decisionMakers as never
		})
	);
	return detail.recipient_config.decisionMakers ?? [];
}

/** Read a roster whose first row is expected to be refused. */
function readRoster(decisionMakers: readonly Record<string, unknown>[]) {
	return () =>
		readPublicTemplateDetailProjection(
			buildPublicTemplateDetailProjection(templateFixture(), {
				emails: decisionMakers.map((row) => row.email as string),
				decisionMakers: decisionMakers as never
			})
		);
}

const REFUSED_ROW = /^PUBLIC_TEMPLATE_DETAIL_PROJECTION_INVALID:recipient_config\.decisionMakers\.0\.provenance/;

describe('the sentence a stranger sees is derived from the projected row', () => {
	it('projects both role-form rows and carries no tier field', () => {
		const rows = projectedRows();

		expect(rows).toHaveLength(2);
		for (const row of rows) {
			for (const key of Object.keys(row)) {
				expect(ALLOWED_RECIPIENT_KEYS).toContain(key);
			}
			expect(Object.keys(row)).not.toContain('deliveryTier');
		}
	});

	it('rejects the whole projection when a tier field is smuggled onto a row', () => {
		const poisoned = [{ ...SEAT_ROW, deliveryTier: 'C' }, UNCLASSIFIED_ROW];
		const built = buildPublicTemplateDetailProjection(templateFixture(), {
			emails: poisoned.map((row) => row.email),
			decisionMakers: poisoned as never
		});

		expect(() => readPublicTemplateDetailProjection(built)).toThrow(
			/^PUBLIC_TEMPLATE_DETAIL_PROJECTION_INVALID:recipient_config\.decisionMakers\.0/
		);
	});

	/**
	 * The three ways a row could arrive without a measured route. Each is REFUSED
	 * by the reader, which is why the card renders its sentence unconditionally:
	 * the card has no ungrounded row to be silent about.
	 *
	 * Mutation that kills the first: delete `candidate.emailGrounded !== true ||`
	 * (`publicTemplateDiscoverySource.ts:760`).
	 * Mutation that kills the second: delete `!emailSource ||` (`:761`).
	 * Mutation that kills the third: relax `publicHttpUrl`'s https check (`:261-271`).
	 */
	it('refuses a row whose address was never grounded in a page read', () => {
		expect(readRoster([{ ...SEAT_ROW, emailGrounded: false }, UNCLASSIFIED_ROW])).toThrow(
			REFUSED_ROW
		);
	});

	it('refuses a row that names no source page at all', () => {
		const { emailSource: _dropped, ...sourceless } = SEAT_ROW;
		expect(readRoster([sourceless, UNCLASSIFIED_ROW])).toThrow(REFUSED_ROW);
	});

	it('refuses a row whose source page is not https', () => {
		expect(
			readRoster([
				{ ...SEAT_ROW, emailSource: 'http://example.gov/contact' },
				UNCLASSIFIED_ROW
			])
		).toThrow(REFUSED_ROW);
	});

	/**
	 * The positive half of the same contract: whatever the reader DOES admit has a
	 * route, so the unconditional sentence in
	 * `DecisionMakerLandscapeCard.svelte` can never print the census's
	 * `route-unmeasured` label on the anonymous path. Dies under the `!emailSource`
	 * deletion above, which admits a sourceless row whose provenance is `none`.
	 */
	it('admits no row without a measured route', () => {
		const rows = projectedRows();

		expect(rows.length).toBeGreaterThan(0);
		for (const row of rows) {
			const evidence = routeEvidenceFor(row);
			expect(evidence.routeProvenance.provenance).not.toBe('none');
			expect(describeMeasuredRoute(evidence)).not.toBe(
				'Address publication route not established this run'
			);
		}
	});

	it('says how each projected address was published', () => {
		const rows = projectedRows();

		expect(describeMeasuredRoute(routeEvidenceFor(rows[0]))).toBe(
			'Address published for an office'
		);
		expect(describeMeasuredRoute(routeEvidenceFor(rows[1]))).toBe(
			'Address published on a page, route form unclassified'
		);
	});

	it('measures no route for a district-shaped row', () => {
		const evidence = routeEvidenceFor({
			name: 'Ada Representative',
			email: undefined,
			emailGrounded: false,
			emailSource: undefined
		});

		expect(evidence.routeProvenance.provenance).toBe('none');
	});

	it('reads a person whose own name is the mailbox as person-form, lexicon notwithstanding', () => {
		// The seat lexicon contains `clerk`, so the naive read of this address is
		// "office". The name-token match runs first and wins: a person named Clerk
		// at clerk@ is a person, and the sentence must not promote them to a seat.
		const evidence = routeEvidenceFor({
			name: 'Clark Clerk',
			email: 'clerk@example.gov',
			emailGrounded: true,
			emailSource: 'https://example.gov/contact'
		});

		expect(evidence.seatRoute?.form).toBe('person-form');
		expect(describeMeasuredRoute(evidence)).toBe(
			'Person-form address published without a page tie'
		);
	});
});
