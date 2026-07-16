import { describe, expect, it } from 'vitest';

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
	relations: RelationsPayload;
};

function readyFixture(): ReadinessFixture {
	return {
		manifest: {
			list: { ready: true, revision: 4, updatedAt: LIST_UPDATED_AT },
			relations: { ready: true, revision: 7, updatedAt: RELATIONS_UPDATED_AT }
		},
		allList: { revision: 4, updatedAt: LIST_UPDATED_AT, templates: [{ id: 'a' }] },
		excludeCwcList: { revision: 4, updatedAt: LIST_UPDATED_AT, templates: [{ id: 'a' }] },
		relations: {
			revision: 7,
			updatedAt: RELATIONS_UPDATED_AT,
			twinEdges: [],
			conceptRelations: { edges: [], conceptMap: {} }
		}
	};
}

describe('public discovery producer readiness', () => {
	it('accepts matched, ready, fresh, bounded materializations', () => {
		expect(validatePublicDiscoveryReadiness(readyFixture(), { now: NOW })).toMatchObject({
			listRevision: 4,
			relationsRevision: 7,
			listAgeMs: 60 * 60 * 1000,
			relationsAgeMs: 30 * 60 * 1000,
			allCount: 1,
			excludeCwcCount: 1
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
		fixture.relations.revision = 6;
		expect(() => validatePublicDiscoveryReadiness(fixture, { now: NOW })).toThrow(
			/relations\.revision does not match manifest\.relations\.revision/
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

	it('requires content for production but supports a deliberate empty corpus', () => {
		const fixture = readyFixture();
		fixture.allList.templates = [];
		fixture.excludeCwcList.templates = [];
		expect(() => validatePublicDiscoveryReadiness(fixture, { now: NOW })).toThrow(
			/populated production release/
		);
		expect(
			validatePublicDiscoveryReadiness(fixture, { requireContent: false, now: NOW })
		).toMatchObject({ allCount: 0, excludeCwcCount: 0 });
	});

	it('rejects a deceptive non-Convex URL before making a request', async () => {
		await expect(
			verifyPublicDiscoveryReadiness('https://example.com/fake.convex.cloud')
		).rejects.toThrow('A valid https://*.convex.cloud URL is required');
	});
});
