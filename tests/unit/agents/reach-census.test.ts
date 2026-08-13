import { describe, expect, it } from 'vitest';
import type { ContactRouteVerdict } from '$lib/core/agents/contact-route-verdict';
import {
	isReachCensus,
	parseReachCensusFact,
	reachCensus
} from '$lib/core/agents/reach-census';
import {
	classifySeatRoute,
	deriveRouteProvenance,
	type RouteProvenance,
	type SeatRouteVerdict,
	type StandingVerdict
} from '$lib/core/agents/seat-route';
import { absent, blocked, present, withheld } from '$lib/core/fact';

type Candidate = {
	contactRoute: ContactRouteVerdict;
	seatRoute?: SeatRouteVerdict;
	routeProvenance?: RouteProvenance;
	standing?: StandingVerdict;
};

function routed({
	email = 'info@example.gov',
	name = 'Alex Rivera',
	emailGrounded = true,
	emailSource = 'https://example.gov/contact',
	blockScopedAssociation = false,
	standing = { standing: 'decides', basis: 'title-inferred' }
}: {
	email?: string;
	name?: string;
	emailGrounded?: boolean;
	emailSource?: string;
	blockScopedAssociation?: boolean;
	standing?: StandingVerdict;
} = {}): Candidate {
	const seatRoute = classifySeatRoute(email, { candidateName: name });
	return {
		contactRoute: { status: 'routed' },
		seatRoute,
		routeProvenance: deriveRouteProvenance({
			seat: seatRoute,
			emailGrounded,
			emailSource,
			contactRouteStatus: 'routed',
			blockScopedAssociation
		}),
		standing
	};
}

const nonRouted = {
	blocked: { contactRoute: { status: 'blocked', hosts: ['blocked.example.org'] } },
	absent: {
		contactRoute: { status: 'absent', readSource: 'https://read.example.org/officials' }
	},
	ungrounded: { contactRoute: { status: 'ungrounded' } },
	undeliverable: { contactRoute: { status: 'undeliverable' } },
	unknown: { contactRoute: { status: 'unknown' } }
} satisfies Record<Exclude<ContactRouteVerdict['status'], 'routed'>, Candidate>;

describe('reachCensus', () => {
	it('works at n=1 without a floor or suppression', () => {
		const census = reachCensus([routed()]);

		expect(census).toEqual({
			observed: 1,
			rows: [
				{ key: 'route-for-office', label: 'Address published for an office', count: 1 }
			]
		});
	});

	it('lands every candidate in exactly one row', () => {
		const candidates: Candidate[] = [
			routed({
				email: 'alex.rivera@example.gov',
				blockScopedAssociation: true
			}),
			routed(),
			routed({ email: 'alex.rivera@example.gov' }),
			routed({ email: 'public.comment@example.gov' }),
			routed({ emailGrounded: false, emailSource: '' }),
			nonRouted.blocked,
			nonRouted.absent,
			nonRouted.ungrounded,
			nonRouted.undeliverable,
			nonRouted.unknown
		];
		const census = reachCensus(candidates);

		expect(census.rows.reduce((sum, row) => sum + row.count, 0)).toBe(census.observed);
		expect(census.observed).toBe(candidates.length);
	});

	it('keeps fixed order through ties and when a later row has more members', () => {
		const census = reachCensus([
			routed({ email: 'alex.rivera@example.gov', blockScopedAssociation: true }),
			routed(),
			nonRouted.blocked,
			nonRouted.blocked,
			nonRouted.blocked,
			nonRouted.unknown
		]);

		expect(census.rows.map((row) => row.key)).toEqual([
			'route-beside-person',
			'route-for-office',
			'absence-blocked',
			'absence-unknown'
		]);
		expect(census.rows.find((row) => row.key === 'absence-blocked')?.count).toBe(3);
	});

	it('maps every upstream contact-route verdict to its own row', () => {
		const census = reachCensus([
			routed(),
			nonRouted.blocked,
			nonRouted.absent,
			nonRouted.ungrounded,
			nonRouted.undeliverable,
			nonRouted.unknown
		]);

		expect(census.rows.map((row) => row.key)).toEqual([
			'route-for-office',
			'absence-blocked',
			'absence-absent',
			'absence-ungrounded',
			'absence-undeliverable',
			'absence-unknown'
		]);
		expect(new Set(census.rows.map((row) => row.key)).size).toBe(6);
	});

	it('uses measured address form and page association instead of inferred standing', () => {
		const census = reachCensus([
			// A mayor title must not turn the measured office box into a person-bound route.
			routed({
				email: 'info@example.gov',
				name: 'Mayor Rivera',
				standing: { standing: 'decides', basis: 'title-inferred' }
			}),
			// R3's could-not-classify standing default must not become a front-desk finding.
			routed({
				email: 'public.comment@example.gov',
				name: 'Casey Lee',
				standing: { standing: 'in-the-building', basis: 'model-inferred' }
			})
		]);

		expect(census.rows).toEqual([
			{ key: 'route-for-office', label: 'Address published for an office', count: 1 },
			{
				key: 'route-on-page-unclassified',
				label: 'Address published on a page, route form unclassified',
				count: 1
			}
		]);
		expect(census.rows.map((row) => row.key)).not.toContain('route-person-bound-seat');
		expect(census.rows.map((row) => row.key)).not.toContain('route-front-desk');
	});

	it('keeps each producer-emitted publication shape in its own route row', () => {
		const census = reachCensus([
			routed({ email: 'alex.rivera@example.gov', blockScopedAssociation: true }),
			routed(),
			routed({ email: 'alex.rivera@example.gov' }),
			routed({ email: 'public.comment@example.gov' }),
			routed({ emailGrounded: false, emailSource: '' })
		]);

		expect(census.rows.map((row) => row.key)).toEqual([
			'route-beside-person',
			'route-for-office',
			'route-on-page-person-form',
			'route-on-page-unclassified',
			'route-unmeasured'
		]);
	});

	it('omits every zero-count row', () => {
		const census = reachCensus([nonRouted.absent]);

		expect(census.rows).toEqual([
			{ key: 'absence-absent', label: 'No address published', count: 1 }
		]);
		expect(census.rows.every((row) => row.count > 0)).toBe(true);
	});

	it('returns integer counts and no ratio-shaped field', () => {
		const census = reachCensus([routed(), nonRouted.blocked, nonRouted.unknown]);
		const keys: string[] = [];
		const visit = (value: unknown): void => {
			if (!value || typeof value !== 'object') return;
			for (const [key, nested] of Object.entries(value)) {
				keys.push(key);
				visit(nested);
			}
		};
		visit(census);

		expect(census.rows.every((row) => Number.isInteger(row.count) && row.count >= 0)).toBe(true);
		expect(keys).not.toContainEqual(expect.stringMatching(/pct|percent|rate|ratio|score/i));
	});

	it('rejects a missing route verdict and records missing publication evidence as unmeasured', () => {
		expect(() => reachCensus([{}])).toThrow('missing its contact-route verdict');
		expect(reachCensus([{ contactRoute: { status: 'routed' } }])).toEqual({
			observed: 1,
			rows: [
				{
					key: 'route-unmeasured',
					label: 'Address publication route not established this run',
					count: 1
				}
			]
		});
	});
});

describe('reach census Fact boundary', () => {
	it('preserves all three non-present facts instead of manufacturing a zero', () => {
		expect(parseReachCensusFact(blocked('upstream stopped'), 'fallback')).toEqual(
			blocked('upstream stopped')
		);
		expect(parseReachCensusFact(withheld('policy route'), 'fallback')).toEqual(
			withheld('policy route')
		);
		expect(parseReachCensusFact(absent(), 'fallback')).toEqual(absent());
	});

	it('accepts a well-formed present census and blocks malformed telemetry', () => {
		const census = reachCensus([routed()]);

		expect(parseReachCensusFact(present(census), 'malformed')).toEqual(present(census));
		expect(isReachCensus(census)).toBe(true);
		expect(parseReachCensusFact({ observed: 1, rows: [] }, 'malformed')).toEqual(
			blocked('malformed')
		);
	});
});
