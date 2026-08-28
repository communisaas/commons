/// <reference types="vite/client" />

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { convexTest } from 'convex-test';

import { api, internal } from './_generated/api';
import schema from './schema';
import {
	PUBLIC_DISCOVERY_MANIFEST_AUTHORITY_MAX_BYTES,
	PUBLIC_DISCOVERY_MANIFEST_AUTHORITY_NOT_READY,
	commitPublicDiscoveryListPublication,
	commitPublicDiscoveryRelationsPublication,
	invalidatePublicDiscoveryForCoordinatedRebuild,
	publicDiscoveryManifestAuthoritySerializedBytes,
	toPublicDiscoveryManifestAuthorityProjection,
	toPublicDiscoveryManifestPayloadFromAuthority
} from './lib/publicDiscovery';

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts']);
const SECRET = 'manifest-authority-test-secret-32-bytes';
const NOW = 1_900_000_000_000;

beforeEach(() => {
	vi.stubEnv('INTERNAL_API_SECRET', SECRET);
	vi.stubEnv('INTERNAL_API_SECRET_PREVIOUS', '');
});

afterEach(() => vi.unstubAllEnvs());

describe('public discovery manifest authority', () => {
	it('has a fixed ten-scalar projection comfortably below the hard byte ceiling', () => {
		const projection = toPublicDiscoveryManifestAuthorityProjection({
			listReady: true,
			listRetiredRevision: Number.MAX_SAFE_INTEGER - 1,
			listRevision: Number.MAX_SAFE_INTEGER,
			listUpdatedAt: Number.MAX_SAFE_INTEGER,
			listWithdrawalEpoch: Number.MAX_SAFE_INTEGER,
			relationsReady: true,
			relationsRetiredRevision: Number.MAX_SAFE_INTEGER - 1,
			relationsRevision: Number.MAX_SAFE_INTEGER,
			relationsUpdatedAt: Number.MAX_SAFE_INTEGER,
			relationsWithdrawalEpoch: Number.MAX_SAFE_INTEGER
		});

		expect(Object.keys(projection).sort()).toEqual(
			[
				'key',
				'projectionVersion',
				'listReady',
				'listRetiredRevision',
				'listRevision',
				'listUpdatedAt',
				'listWithdrawalEpoch',
				'relationsReady',
				'relationsRetiredRevision',
				'relationsRevision',
				'relationsUpdatedAt',
				'relationsWithdrawalEpoch'
			].sort()
		);
		expect(publicDiscoveryManifestAuthoritySerializedBytes(projection)).toBeLessThanOrEqual(
			PUBLIC_DISCOVERY_MANIFEST_AUTHORITY_MAX_BYTES
		);
		expect(toPublicDiscoveryManifestPayloadFromAuthority(projection)).toMatchObject({
			list: { ready: true, revision: Number.MAX_SAFE_INTEGER },
			relations: { ready: true, revision: Number.MAX_SAFE_INTEGER }
		});
	});

	it('fails closed before activation and never falls back to the wide control row', async () => {
		const t = convexTest({ schema, modules });
		await t.run((ctx) =>
			ctx.db.insert('publicDiscoveryManifest', {
				key: 'public',
				listReady: true,
				listRetiredRevision: 6,
				listRevision: 7,
				listUpdatedAt: NOW,
				listWithdrawalEpoch: 2,
				relationsReady: true,
				relationsRetiredRevision: 8,
				relationsRevision: 9,
				relationsUpdatedAt: NOW + 1,
				relationsWithdrawalEpoch: 3,
				listFailureCode: 'wide-only:' + 'x'.repeat(100_000),
				relationsFailureCode: 'wide-only:' + 'y'.repeat(100_000),
				endorsementCountMigrationCursor: 'z'.repeat(100_000)
			})
		);

		await expect(
			t.query(api.templates.publicDiscoveryManifest, { _secret: SECRET })
		).rejects.toThrow(PUBLIC_DISCOVERY_MANIFEST_AUTHORITY_NOT_READY);
		await expect(t.query(api.templates.publicDiscoveryManifestAuthorityStatus, {})).rejects.toThrow(
			'Unauthorized'
		);

		const activation = await t.mutation(
			internal.templates.migratePublicDiscoveryManifestAuthority,
			{}
		);
		expect(activation).toMatchObject({ activated: true, created: true });
		expect(activation.bytes).toBeLessThanOrEqual(PUBLIC_DISCOVERY_MANIFEST_AUTHORITY_MAX_BYTES);
		await expect(
			t.query(api.templates.publicDiscoveryManifestAuthorityStatus, { _secret: SECRET })
		).resolves.toMatchObject({ ready: true, matches: true });
		await expect(
			t.query(internal.templates.publicDiscoveryManifestAuthorityOperatorStatus, {})
		).resolves.toMatchObject({ ready: true, matches: true });
		await expect(
			t.query(api.templates.publicDiscoveryManifest, { _secret: SECRET })
		).resolves.toEqual({
			list: {
				ready: true,
				retiredRevision: 6,
				revision: 7,
				updatedAt: NOW,
				withdrawalEpoch: 2
			},
			relations: {
				ready: true,
				retiredRevision: 8,
				revision: 9,
				updatedAt: NOW + 1,
				withdrawalEpoch: 3
			}
		});

		const compact = await t.run((ctx) =>
			ctx.db
				.query('publicDiscoveryManifestAuthority')
				.withIndex('by_key', (q) => q.eq('key', 'public'))
				.unique()
		);
		expect(compact).not.toBeNull();
		expect(compact).not.toHaveProperty('listFailureCode');
		expect(compact).not.toHaveProperty('endorsementCountMigrationCursor');
		expect(new TextEncoder().encode(JSON.stringify(compact)).byteLength).toBeLessThanOrEqual(
			PUBLIC_DISCOVERY_MANIFEST_AUTHORITY_MAX_BYTES
		);

		await t.run(async (ctx) => {
			const wide = await ctx.db
				.query('publicDiscoveryManifest')
				.withIndex('by_key', (q) => q.eq('key', 'public'))
				.unique();
			if (!wide) throw new Error('missing wide manifest');
			await ctx.db.patch(wide._id, { listRevision: 99 });
		});
		const publicAfterWideTamper = await t.query(api.templates.publicDiscoveryManifest, {
			_secret: SECRET
		});
		expect(publicAfterWideTamper.list.revision).toBe(7);
		await expect(
			t.query(api.templates.publicDiscoveryManifestAuthorityStatus, { _secret: SECRET })
		).resolves.toMatchObject({ ready: false, matches: false });

		const repair = await t.mutation(internal.templates.migratePublicDiscoveryManifestAuthority, {});
		expect(repair).toMatchObject({ activated: true, created: false });
		expect(
			await t.run((ctx) => ctx.db.query('publicDiscoveryManifestAuthority').collect())
		).toHaveLength(1);
		expect(
			(await t.query(api.templates.publicDiscoveryManifest, { _secret: SECRET })).list.revision
		).toBe(99);
	});

	it('mirrors publication and destructive withdrawal coordinates transactionally after activation', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(NOW + 2);
		try {
			const t = convexTest({ schema, modules });
			await t.mutation(internal.templates.migratePublicDiscoveryManifestAuthority, {});

			await t.run((ctx) =>
				commitPublicDiscoveryListPublication(ctx, { revision: 1, updatedAt: NOW })
			);
			await t.run((ctx) =>
				commitPublicDiscoveryRelationsPublication(ctx, { revision: 1, updatedAt: NOW + 1 })
			);
			await expect(
				t.query(api.templates.publicDiscoveryManifest, { _secret: SECRET })
			).resolves.toMatchObject({
				list: { ready: true, revision: 1, withdrawalEpoch: 0 },
				relations: { ready: true, revision: 1, withdrawalEpoch: 0 }
			});

			await t.run((ctx) =>
				invalidatePublicDiscoveryForCoordinatedRebuild(
					ctx,
					{ list: true, relations: true },
					'test-coordinated-rebuild',
					NOW + 2,
					{ kind: 'clearSeed' }
				)
			);
			await expect(
				t.query(api.templates.publicDiscoveryManifest, { _secret: SECRET })
			).resolves.toMatchObject({
				list: { ready: false, retiredRevision: 1, revision: 1, withdrawalEpoch: 1 },
				relations: { ready: false, retiredRevision: 1, revision: 1, withdrawalEpoch: 1 }
			});
			await expect(
				t.query(api.templates.publicDiscoveryManifestAuthorityStatus, { _secret: SECRET })
			).resolves.toMatchObject({ ready: true, matches: true });
		} finally {
			vi.useRealTimers();
		}
	});
});
