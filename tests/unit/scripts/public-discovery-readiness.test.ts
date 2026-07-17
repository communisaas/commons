import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getFunctionName } from 'convex/server';

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
	readinessOptionsFromEnv,
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
	projectionVersion: number;
	revision: number;
	updatedAt: number;
	templates: Array<Record<string, unknown>>;
};

function publicCard(id: string, deliveryMethod: 'email' | 'cwc') {
	return {
		id,
		deliveryMethod,
		recipient_config: null,
		recipientEmails: [],
		recipient_count: 0
	};
}

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
	producerStatus: {
		ok: boolean;
		storageReadable: boolean;
		discoveryManifestPresent: boolean;
		discoveryProducerHealthy: boolean;
		discoveryProducerOverdueAt: number | null;
	};
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
		producerStatus: {
			ok: true,
			storageReadable: true,
			discoveryManifestPresent: true,
			discoveryProducerHealthy: true,
			discoveryProducerOverdueAt: null
		},
		manifest: {
			list: { ready: true, revision: 4, updatedAt: LIST_UPDATED_AT },
			relations: { ready: true, revision: 7, updatedAt: RELATIONS_UPDATED_AT }
		},
		allList: {
			projectionVersion: 4,
			revision: 4,
			updatedAt: LIST_UPDATED_AT,
			templates: [
				publicCard('a', 'email'),
				publicCard('b', 'cwc'),
				publicCard('c', 'email')
			]
		},
		excludeCwcList: {
			projectionVersion: 4,
			revision: 4,
			updatedAt: LIST_UPDATED_AT,
			templates: [publicCard('a', 'email')]
		},
		allRelations: {
			revision: 7,
			updatedAt: RELATIONS_UPDATED_AT,
			twinEdges: [{ a: 'a', b: 'b', score: 0.8, kind: 'twin' }],
			conceptRelations: {
				edges: [{ a: 'a', b: 'c', concept: 'Topic', kind: 'concept' }],
				conceptMap: { topic: 'Topic' }
			}
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

	it('rejects durable producer failure evidence even when every public snapshot looks ready', () => {
		const fixture = readyFixture();
		fixture.producerStatus.discoveryProducerHealthy = false;

		expect(() => validatePublicDiscoveryReadiness(fixture, { now: NOW })).toThrow(
			/producerStatus\.discoveryProducerHealthy is not true/
		);
	});

	it('rejects an overdue producer refresh but permits a scheduled future refresh', () => {
		const fixture = readyFixture();
		fixture.producerStatus.discoveryProducerOverdueAt = NOW - 1;
		expect(() => validatePublicDiscoveryReadiness(fixture, { now: NOW })).toThrow(
			/producerStatus\.discoveryProducerOverdueAt is overdue by 1ms/
		);

		fixture.producerStatus.discoveryProducerOverdueAt = NOW + 1;
		expect(validatePublicDiscoveryReadiness(fixture, { now: NOW })).toMatchObject({
			producerOverdueAt: NOW + 1
		});
	});

	it('rejects payload and manifest revision skew', () => {
		const fixture = readyFixture();
		fixture.allRelations.revision = 6;
		expect(() => validatePublicDiscoveryReadiness(fixture, { now: NOW })).toThrow(
			/allRelations\.revision does not match manifest\.relations\.revision/
		);
	});

	it('rejects a revision outside the runtime safe-integer contract', () => {
		const fixture = readyFixture();
		const unsafeRevision = Number.MAX_SAFE_INTEGER + 1;
		fixture.manifest.list.revision = unsafeRevision;
		fixture.manifest.relations.revision = unsafeRevision;
		fixture.allList.revision = unsafeRevision;
		fixture.excludeCwcList.revision = unsafeRevision;
		fixture.allRelations.revision = unsafeRevision;
		fixture.excludeCwcRelations.revision = unsafeRevision;

		expect(() => validatePublicDiscoveryReadiness(fixture, { now: NOW })).toThrow(
			/manifest\.list\.revision is not a positive safe integer/
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
		fixture.excludeCwcList.templates.push(publicCard('hidden', 'cwc'));
		expect(() => validatePublicDiscoveryReadiness(fixture, { now: NOW })).toThrow(
			/excludeCwcList\.templates\[1\] leaks a CWC template/
		);
	});

	it('rejects a legacy projection generation before an edge deploy', () => {
		const fixture = readyFixture();
		fixture.allList.projectionVersion = 0;
		expect(() => validatePublicDiscoveryReadiness(fixture, { now: NOW })).toThrow(
			/allList\.projectionVersion is not 4/
		);
	});

	it.each([
		['raw recipient config', { recipient_config: { recipients: ['private'] } }, /recipient_config is not null/],
		['recipient addresses', { recipientEmails: ['private@example.test'] }, /recipientEmails is not an empty array/],
		['invalid recipient count', { recipient_count: -1 }, /recipient_count is not a non-negative integer/]
	] as const)('rejects %s in a supposedly anonymous projection', (_label, patch, expected) => {
		const fixture = readyFixture();
		Object.assign(fixture.allList.templates[0], patch);
		expect(() => validatePublicDiscoveryReadiness(fixture, { now: NOW })).toThrow(expected);
	});

	it('rejects relation endpoints that are absent from the matching list', () => {
		const fixture = readyFixture();
		fixture.excludeCwcRelations.twinEdges = [
			{ a: 'a', b: 'hidden-cwc', score: 0.5, kind: 'twin' }
		];
		expect(() => validatePublicDiscoveryReadiness(fixture, { now: NOW })).toThrow(
			/excludeCwcRelations\.twinEdges\[0\] endpoint hidden-cwc is absent from its matching list/
		);
	});

	it('rejects oversized or duplicate public lists', () => {
		const oversized = readyFixture();
		oversized.allList.templates = Array.from({ length: 51 }, (_, index) =>
			publicCard(`template-${index}`, 'email')
		);
		expect(() => validatePublicDiscoveryReadiness(oversized, { now: NOW })).toThrow(
			/allList\.templates exceeds the 50-card public limit/
		);

		const duplicate = readyFixture();
		duplicate.allList.templates.push(publicCard('a', 'email'));
		expect(() => validatePublicDiscoveryReadiness(duplicate, { now: NOW })).toThrow(
			/allList\.templates\[3\] duplicates id a/
		);
	});

	it('rejects malformed relation fields before an edge deploy', () => {
		const fixture = readyFixture();
		fixture.allRelations.twinEdges = [{ a: 'a', b: 'b', score: Number.NaN, kind: 'twin' }];
		expect(() => validatePublicDiscoveryReadiness(fixture, { now: NOW })).toThrow(
			/allRelations\.twinEdges\[0\] has invalid twin fields/
		);

		fixture.allRelations.twinEdges = [];
		fixture.allRelations.conceptRelations.edges = [
			{ a: 'a', b: 'b', concept: 42, kind: 'concept' }
		];
		expect(() => validatePublicDiscoveryReadiness(fixture, { now: NOW })).toThrow(
			/allRelations\.conceptRelations\.edges\[0\] has invalid concept fields/
		);
	});

	it('enforces the runtime relation and recipient-count bounds at the release gate', () => {
		const unsafeCount = readyFixture();
		unsafeCount.allList.templates[0].recipient_count = Number.MAX_SAFE_INTEGER + 1;
		expect(() => validatePublicDiscoveryReadiness(unsafeCount, { now: NOW })).toThrow(
			/recipient_count is not a non-negative integer/
		);

		const tooManyEdges = readyFixture();
		tooManyEdges.allRelations.twinEdges = Array.from({ length: 10_001 }, () => ({
			a: 'a',
			b: 'b',
			score: 0.5,
			kind: 'twin'
		}));
		expect(() => validatePublicDiscoveryReadiness(tooManyEdges, { now: NOW })).toThrow(
			/allRelations\.twinEdges exceeds the 10000-edge public limit/
		);

		const malformedMap = readyFixture();
		malformedMap.allRelations.conceptRelations.conceptMap = {
			topic: 42
		} as unknown as Record<string, string>;
		expect(() => validatePublicDiscoveryReadiness(malformedMap, { now: NOW })).toThrow(
			/allRelations\.conceptRelations\.conceptMap\["topic"\] is not a string/
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

	it('permits stale timestamps only in explicit non-production contract-only mode', () => {
		const fixture = readyFixture();
		const staleUpdatedAt = NOW - DEFAULT_MAX_SNAPSHOT_AGE_MS - 1;
		fixture.manifest.list.updatedAt = staleUpdatedAt;
		fixture.allList.updatedAt = staleUpdatedAt;
		fixture.excludeCwcList.updatedAt = staleUpdatedAt;

		expect(
			validatePublicDiscoveryReadiness(fixture, {
				contractOnly: true,
				requireContent: false,
				now: NOW
			})
		).toMatchObject({ listRevision: 4 });
		fixture.producerStatus.discoveryProducerHealthy = false;
		expect(() =>
			validatePublicDiscoveryReadiness(fixture, {
				contractOnly: true,
				requireContent: false,
				now: NOW
			})
		).toThrow(/producerStatus\.discoveryProducerHealthy is not true/);
		fixture.producerStatus.discoveryProducerHealthy = true;
		fixture.excludeCwcList.projectionVersion = 3;
		expect(() =>
			validatePublicDiscoveryReadiness(fixture, {
				contractOnly: true,
				requireContent: false,
				now: NOW
			})
		).toThrow(/excludeCwcList\.projectionVersion is not 4/);
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

	it('parses production and contract-only deploy policy from exact boolean env values', () => {
		expect(readinessOptionsFromEnv({})).toEqual({
			maxAgeMs: DEFAULT_MAX_SNAPSHOT_AGE_MS,
			requireContent: true,
			contractOnly: false
		});
		expect(
			readinessOptionsFromEnv({
				PUBLIC_DISCOVERY_MAX_AGE_HOURS: '12',
				PUBLIC_DISCOVERY_REQUIRE_CONTENT: 'false',
				PUBLIC_DISCOVERY_CONTRACT_ONLY: 'true'
			})
		).toEqual({
			maxAgeMs: 12 * 60 * 60 * 1000,
			requireContent: false,
			contractOnly: true
		});
		expect(() =>
			readinessOptionsFromEnv({ PUBLIC_DISCOVERY_CONTRACT_ONLY: '1' })
		).toThrow(/PUBLIC_DISCOVERY_CONTRACT_ONLY must be true or false/);
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
			.mockResolvedValueOnce(fixture.excludeCwcRelations)
			.mockResolvedValueOnce(fixture.manifest)
			.mockResolvedValueOnce(fixture.producerStatus);

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
		expect(mockConvexQuery).toHaveBeenCalledTimes(7);
		expect(mockConvexQuery.mock.calls.map(([, args]) => args)).toEqual([
			{},
			{ excludeCwc: false },
			{ excludeCwc: true },
			{ excludeCwc: false },
			{ excludeCwc: true },
			{},
			{}
		]);
		expect(mockConvexQuery.mock.calls.map(([reference]) => getFunctionName(reference))).toEqual([
			'templates:publicDiscoveryManifest',
			'templates:publicDiscoveryList',
			'templates:publicDiscoveryList',
			'templates:publicDiscoveryRelations',
			'templates:publicDiscoveryRelations',
			'templates:publicDiscoveryManifest',
			'observability:servicePing'
		]);
	});

	it('retries a publication race and validates only a coherently bracketed generation', async () => {
		const oldFixture = readyFixture();
		const nextFixture = readyFixture();
		nextFixture.manifest.list.revision = 5;
		nextFixture.manifest.relations.revision = 8;
		nextFixture.allList.revision = 5;
		nextFixture.excludeCwcList.revision = 5;
		nextFixture.allRelations.revision = 8;
		nextFixture.excludeCwcRelations.revision = 8;

		mockConvexQuery
			.mockResolvedValueOnce(oldFixture.manifest)
			.mockResolvedValueOnce(oldFixture.allList)
			.mockResolvedValueOnce(oldFixture.excludeCwcList)
			.mockResolvedValueOnce(oldFixture.allRelations)
			.mockResolvedValueOnce(oldFixture.excludeCwcRelations)
			.mockResolvedValueOnce(nextFixture.manifest)
			.mockResolvedValueOnce(nextFixture.manifest)
			.mockResolvedValueOnce(nextFixture.allList)
			.mockResolvedValueOnce(nextFixture.excludeCwcList)
			.mockResolvedValueOnce(nextFixture.allRelations)
			.mockResolvedValueOnce(nextFixture.excludeCwcRelations)
			.mockResolvedValueOnce(nextFixture.manifest)
			.mockResolvedValueOnce(nextFixture.producerStatus);

		await expect(
			verifyPublicDiscoveryReadiness('https://valid-deployment.convex.cloud', { now: NOW })
		).resolves.toMatchObject({ listRevision: 5, relationsRevision: 8 });
		expect(mockConvexQuery).toHaveBeenCalledTimes(13);
	});

	it('fails closed after three continuously changing publication generations', async () => {
		const fixture = readyFixture();
		for (let attempt = 0; attempt < 3; attempt += 1) {
			const before = structuredClone(fixture.manifest);
			const after = structuredClone(fixture.manifest);
			after.list.revision += attempt + 1;
			mockConvexQuery
				.mockResolvedValueOnce(before)
				.mockResolvedValueOnce(fixture.allList)
				.mockResolvedValueOnce(fixture.excludeCwcList)
				.mockResolvedValueOnce(fixture.allRelations)
				.mockResolvedValueOnce(fixture.excludeCwcRelations)
				.mockResolvedValueOnce(after);
		}

		await expect(
			verifyPublicDiscoveryReadiness('https://valid-deployment.convex.cloud', { now: NOW })
		).rejects.toThrow(/publication changed during 3 coherent-read attempts/);
		expect(mockConvexQuery).toHaveBeenCalledTimes(18);
	});
});
