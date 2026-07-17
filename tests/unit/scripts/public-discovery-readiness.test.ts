import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockConvexQuery } = vi.hoisted(() => ({
	mockConvexQuery: vi.fn()
}));

vi.mock('convex/browser', () => ({
	ConvexHttpClient: class MockConvexHttpClient {
		readonly query = mockConvexQuery;

		constructor(url: string) {
			void url;
		}
	}
}));

import {
	DEFAULT_MAX_SNAPSHOT_AGE_MS,
	validatePublicDiscoveryReadiness,
	verifyPublicDiscoveryReadiness
} from '../../../scripts/verify-public-discovery-readiness.mjs';

const NOW = Date.UTC(2026, 6, 16, 14);
const LIST_UPDATED_AT = NOW - 60 * 60 * 1000;
const RELATIONS_UPDATED_AT = NOW - 30 * 60 * 1000;

type ReadinessState = {
	ready: boolean;
	revision: number;
	updatedAt: number | null;
};

type ListPayload = {
	revision: number;
	updatedAt: number;
	templates: Array<Record<string, unknown>>;
};

type RelationsPayload = {
	revision: number;
	updatedAt: number;
	twinEdges: unknown[];
	conceptRelations: {
		edges: unknown[];
		conceptMap: Record<string, string>;
	};
};

type ReadinessFixture = {
	manifest: {
		list: ReadinessState;
		relations: ReadinessState;
	};
	allList: ListPayload;
	excludeCwcList: ListPayload;
	allRelations: RelationsPayload;
	excludeCwcRelations: RelationsPayload;
};

function readyFixture(): ReadinessFixture {
	return {
		manifest: {
			list: { ready: true, revision: 4, updatedAt: LIST_UPDATED_AT },
			relations: { ready: true, revision: 7, updatedAt: RELATIONS_UPDATED_AT }
		},
		allList: {
			revision: 4,
			updatedAt: LIST_UPDATED_AT,
			templates: [
				{ id: 'a', deliveryMethod: 'email' },
				{ id: 'b', deliveryMethod: 'cwc' },
				{ id: 'c', deliveryMethod: 'email' }
			]
		},
		excludeCwcList: {
			revision: 4,
			updatedAt: LIST_UPDATED_AT,
			templates: [{ id: 'a', deliveryMethod: 'email' }]
		},
		allRelations: {
			revision: 7,
			updatedAt: RELATIONS_UPDATED_AT,
			twinEdges: [{ a: 'a', b: 'b' }],
			conceptRelations: { edges: [{ a: 'a', b: 'c' }], conceptMap: { topic: 'Topic' } }
		},
		excludeCwcRelations: {
			revision: 7,
			updatedAt: RELATIONS_UPDATED_AT,
			twinEdges: [],
			conceptRelations: { edges: [], conceptMap: {} }
		}
	};
}

describe('public discovery producer readiness', () => {
	beforeEach(() => {
		mockConvexQuery.mockReset();
	});

	it('accepts matched, ready, fresh, bounded materializations', () => {
		expect(validatePublicDiscoveryReadiness(readyFixture(), { now: NOW })).toMatchObject({
			listRevision: 4,
			relationsRevision: 7,
			listAgeMs: 60 * 60 * 1000,
			relationsAgeMs: 30 * 60 * 1000,
				allCount: 3,
			excludeCwcCount: 1,
			allTwinEdgeCount: 1,
			allConceptEdgeCount: 1,
			excludeCwcTwinEdgeCount: 0,
			excludeCwcConceptEdgeCount: 0,
			sizes: {
				allRelations: expect.any(Number),
				excludeCwcRelations: expect.any(Number)
			}
		});
	});

	it('rejects a cold manifest', () => {
		const fixture = readyFixture();
		fixture.manifest.list = { ready: false, revision: 0, updatedAt: null };
		expect(() => validatePublicDiscoveryReadiness(fixture, { now: NOW })).toThrow(
			/PUBLIC_DISCOVERY_NOT_READY:[\s\S]*manifest\.list\.ready is not true/
		);
	});

	it('rejects payload and manifest revision skew', () => {
		const fixture = readyFixture();
		fixture.allRelations.revision = 6;
		expect(() => validatePublicDiscoveryReadiness(fixture, { now: NOW })).toThrow(
			/allRelations\.revision does not match manifest\.relations\.revision/
		);
	});

	it('rejects the exclude-CWC payload when its timestamp does not match the shared manifest', () => {
		const fixture = readyFixture();
		fixture.excludeCwcRelations.updatedAt -= 1;
		expect(() => validatePublicDiscoveryReadiness(fixture, { now: NOW })).toThrow(
			/excludeCwcRelations\.updatedAt does not match manifest\.relations\.updatedAt/
		);
	});

	it('shape-checks both relation variants', () => {
		const fixture = readyFixture();
		fixture.excludeCwcRelations.conceptRelations.conceptMap = null as unknown as Record<
			string,
			string
		>;
		expect(() => validatePublicDiscoveryReadiness(fixture, { now: NOW })).toThrow(
			/excludeCwcRelations\.conceptRelations\.conceptMap is not an object/
		);
	});

	it('rejects a CWC template in the exclude-CWC list', () => {
		const fixture = readyFixture();
		fixture.excludeCwcList.templates.push({ id: 'hidden', deliveryMethod: 'cwc' });
		expect(() => validatePublicDiscoveryReadiness(fixture, { now: NOW })).toThrow(
			/excludeCwcList\.templates\[1\] leaks a CWC template/
		);
	});

	it('rejects relation endpoints that are absent from the matching list', () => {
		const fixture = readyFixture();
		fixture.excludeCwcRelations.twinEdges = [{ a: 'a', b: 'hidden-cwc' }];
		expect(() => validatePublicDiscoveryReadiness(fixture, { now: NOW })).toThrow(
			/excludeCwcRelations\.twinEdges\[0\] endpoint hidden-cwc is absent from its matching list/
		);
	});

	it('rejects a snapshot older than the 26-hour production bound', () => {
		const fixture = readyFixture();
		const staleUpdatedAt = NOW - DEFAULT_MAX_SNAPSHOT_AGE_MS - 1;
		fixture.manifest.list.updatedAt = staleUpdatedAt;
		fixture.allList.updatedAt = staleUpdatedAt;
		fixture.excludeCwcList.updatedAt = staleUpdatedAt;

		expect(() => validatePublicDiscoveryReadiness(fixture, { now: NOW })).toThrow(
			/manifest\.list\.updatedAt is stale by 1ms/
		);
	});

	it('honors a deliberately tighter configured age bound', () => {
		expect(() =>
			validatePublicDiscoveryReadiness(readyFixture(), {
				now: NOW,
				maxAgeMs: 45 * 60 * 1000
			})
		).toThrow(/manifest\.list\.updatedAt is stale/);
	});

	it('rejects a serialized snapshot above the document safety bound', () => {
		const fixture = readyFixture();
		fixture.allList.templates = [{ messageBody: 'x'.repeat(900_000) }];

		expect(() => validatePublicDiscoveryReadiness(fixture, { now: NOW })).toThrow(
			/allList serialized payload is \d+ bytes, above 900000/
		);
	});

	it('size-checks the exclude-CWC relation variant independently', () => {
		const fixture = readyFixture();
		fixture.excludeCwcRelations.conceptRelations.conceptMap = {
			oversized: 'x'.repeat(900_000)
		};

		expect(() => validatePublicDiscoveryReadiness(fixture, { now: NOW })).toThrow(
			/excludeCwcRelations serialized payload is \d+ bytes, above 900000/
		);
	});

	it('requires content for production but supports a deliberate empty corpus', () => {
		const fixture = readyFixture();
		fixture.allList.templates = [];
		fixture.excludeCwcList.templates = [];
		fixture.allRelations.twinEdges = [];
		fixture.allRelations.conceptRelations.edges = [];
		expect(() => validatePublicDiscoveryReadiness(fixture, { now: NOW })).toThrow(
			/populated production release/
		);
		expect(
			validatePublicDiscoveryReadiness(fixture, { requireContent: false, now: NOW })
		).toMatchObject({ allCount: 0, excludeCwcCount: 0 });
	});

	it.each([
		['non-HTTPS protocol', 'http://valid-deployment.convex.cloud'],
		['non-Convex hostname', 'https://convex.cloud.evil.example'],
		['embedded credentials', 'https://user:pass@valid-deployment.convex.cloud'],
		['non-root path', 'https://valid-deployment.convex.cloud/attacker-path'],
		['query parameters', 'https://valid-deployment.convex.cloud?target=attacker'],
		['URL fragment', 'https://valid-deployment.convex.cloud#attacker']
	])('rejects a Convex URL with %s before making a request', async (_label, url) => {
		await expect(verifyPublicDiscoveryReadiness(url)).rejects.toThrow(
			'A valid https://*.convex.cloud URL is required'
		);
		expect(mockConvexQuery).not.toHaveBeenCalled();
	});

	it('accepts a root HTTPS Convex URL and queries every readiness payload', async () => {
		const fixture = readyFixture();
		mockConvexQuery
			.mockResolvedValueOnce(fixture.manifest)
			.mockResolvedValueOnce(fixture.allList)
			.mockResolvedValueOnce(fixture.excludeCwcList)
			.mockResolvedValueOnce(fixture.allRelations)
			.mockResolvedValueOnce(fixture.excludeCwcRelations);

		await expect(
			verifyPublicDiscoveryReadiness('https://valid-deployment.convex.cloud', { now: NOW })
		).resolves.toMatchObject({
			listRevision: 4,
			relationsRevision: 7,
				allCount: 3,
			excludeCwcCount: 1,
			allTwinEdgeCount: 1,
			excludeCwcTwinEdgeCount: 0
		});
		expect(mockConvexQuery).toHaveBeenCalledTimes(5);
		expect(mockConvexQuery.mock.calls.map(([, args]) => args)).toEqual([
			{},
			{ excludeCwc: false },
			{ excludeCwc: true },
			{ excludeCwc: false },
			{ excludeCwc: true }
		]);
	});
});
