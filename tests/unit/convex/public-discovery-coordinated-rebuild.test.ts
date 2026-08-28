import { describe, expect, it, vi } from 'vitest';

import {
	PUBLIC_DISCOVERY_COORDINATED_REBUILD_LEASE_EXPIRED,
	PUBLIC_DISCOVERY_COORDINATED_REBUILD_LOCK_TTL_MS,
	supervisePublicDiscoveryCoordinatedRebuildLease,
	supervisePublicDiscoveryCoordinatedRebuildWatchdog
} from '../../../convex/lib/publicDiscovery';

type SupervisorCtx = Parameters<typeof supervisePublicDiscoveryCoordinatedRebuildLease>[0];
type WatchdogCtx = Parameters<typeof supervisePublicDiscoveryCoordinatedRebuildWatchdog>[0];

type MutableManifest = {
	_id: string;
	_creationTime: number;
	key: 'public';
	listReady: boolean;
	relationsReady: boolean;
	listRevision: number;
	relationsRevision: number;
	coordinatedRebuildToken?: string;
	coordinatedRebuildStartedAt?: number;
	coordinatedRebuildKind?: 'clearSeed' | 'reseedTemplates';
	coordinatedRebuildLeaseExpiresAt?: number;
	coordinatedRebuildAttempt?: number;
	coordinatedRebuildWatchdogScheduledAt?: number;
	coordinatedRebuildRetryAt?: number;
	coordinatedRebuildFailureAt?: number;
	coordinatedRebuildFailureCode?: string;
};

function manifest(overrides: Partial<MutableManifest> = {}): MutableManifest {
	return {
		_id: 'manifest-id',
		_creationTime: 1,
		key: 'public',
		listReady: false,
		relationsReady: false,
		listRevision: 4,
		relationsRevision: 7,
		coordinatedRebuildToken: 'owner-token',
		coordinatedRebuildStartedAt: 1_000,
		coordinatedRebuildLeaseExpiresAt: 2_000,
		coordinatedRebuildAttempt: 3,
		coordinatedRebuildKind: 'clearSeed',
		...overrides
	};
}

function harness(row: MutableManifest | null) {
	const unique = vi.fn(async () => row);
	const withIndex = vi.fn(
		(_index: string, configure: (query: { eq: (field: string, value: string) => object }) => object) => {
			configure({ eq: () => ({}) });
			return { unique };
		}
	);
	const patch = vi.fn(async (_id: string, value: Partial<MutableManifest>) => {
		if (row) Object.assign(row, value);
	});
	const query = vi.fn(() => ({ withIndex }));
	const runAt = vi.fn(async () => 'scheduled-function-id');
	const ctx = {
		db: {
			query,
			patch
		},
		scheduler: { runAt }
	} as unknown as SupervisorCtx & WatchdogCtx;
	return { ctx, patch, query, runAt };
}

describe('public discovery coordinated-rebuild lease supervision', () => {
	it('classifies idle, active, and unclassifiable locks without writing', async () => {
		const idle = harness(null);
		await expect(supervisePublicDiscoveryCoordinatedRebuildLease(idle.ctx, 5_000)).resolves.toEqual({
			status: 'idle',
			shouldAlert: false
		});
		expect(idle.patch).not.toHaveBeenCalled();

		const active = harness(manifest({ coordinatedRebuildLeaseExpiresAt: 5_001 }));
		await expect(
			supervisePublicDiscoveryCoordinatedRebuildLease(active.ctx, 5_000)
		).resolves.toEqual({
			status: 'active',
			shouldAlert: false,
			leaseExpiresAt: 5_001
		});
		expect(active.patch).not.toHaveBeenCalled();

		const unclassified = harness(
			manifest({
				coordinatedRebuildStartedAt: undefined,
				coordinatedRebuildLeaseExpiresAt: undefined
			})
		);
		await expect(
			supervisePublicDiscoveryCoordinatedRebuildLease(unclassified.ctx, 5_000)
		).resolves.toEqual({ status: 'unclassified', shouldAlert: false });
		expect(unclassified.patch).not.toHaveBeenCalled();
	});

	it('stamps stale evidence once, emits one alert signal, and preserves the lock', async () => {
		const row = manifest();
		const { ctx, patch } = harness(row);

		await expect(supervisePublicDiscoveryCoordinatedRebuildLease(ctx, 2_000)).resolves.toEqual({
			status: 'stale',
			shouldAlert: true,
			leaseExpiresAt: 2_000,
			failureAt: 2_000,
			failureCode: PUBLIC_DISCOVERY_COORDINATED_REBUILD_LEASE_EXPIRED,
			retryAt: 2_000,
			kind: 'clearSeed',
			attempt: 3
		});
		expect(patch).toHaveBeenCalledTimes(1);
		expect(patch).toHaveBeenCalledWith('manifest-id', {
			coordinatedRebuildFailureAt: 2_000,
			coordinatedRebuildFailureCode: PUBLIC_DISCOVERY_COORDINATED_REBUILD_LEASE_EXPIRED,
			coordinatedRebuildRetryAt: 2_000
		});
		expect(row).toMatchObject({
			coordinatedRebuildToken: 'owner-token',
			listReady: false,
			relationsReady: false,
			listRevision: 4,
			relationsRevision: 7
		});

		await expect(supervisePublicDiscoveryCoordinatedRebuildLease(ctx, 9_000)).resolves.toEqual({
			status: 'stale',
			shouldAlert: false,
			leaseExpiresAt: 2_000,
			failureAt: 2_000,
			failureCode: PUBLIC_DISCOVERY_COORDINATED_REBUILD_LEASE_EXPIRED,
			retryAt: 2_000,
			kind: 'clearSeed',
			attempt: 3
		});
		expect(patch).toHaveBeenCalledTimes(1);
	});

	it('classifies legacy started-at leases at the exact expiry boundary', async () => {
		const startedAt = 10_000;
		const expiresAt = startedAt + PUBLIC_DISCOVERY_COORDINATED_REBUILD_LOCK_TTL_MS;
		const legacy = harness(
			manifest({
				coordinatedRebuildStartedAt: startedAt,
				coordinatedRebuildLeaseExpiresAt: undefined
			})
		);

		await expect(
			supervisePublicDiscoveryCoordinatedRebuildLease(legacy.ctx, expiresAt - 1)
		).resolves.toEqual({ status: 'active', shouldAlert: false, leaseExpiresAt: expiresAt });
		await expect(
			supervisePublicDiscoveryCoordinatedRebuildLease(legacy.ctx, expiresAt)
		).resolves.toMatchObject({
			status: 'stale',
			shouldAlert: true,
			leaseExpiresAt: expiresAt,
			failureAt: expiresAt,
			retryAt: expiresAt
		});
	});

	it('re-arms one exact owner slot after renewal and rejects duplicates before I/O', async () => {
		const row = manifest({
			coordinatedRebuildLeaseExpiresAt: 5_000,
			coordinatedRebuildWatchdogScheduledAt: 2_000
		});
		const { ctx, patch, query, runAt } = harness(row);
		const coordinates = {
			coordinatedRebuildToken: 'owner-token',
			coordinatedRebuildAttempt: 3,
			scheduledAt: 2_000
		};

		await expect(
			supervisePublicDiscoveryCoordinatedRebuildWatchdog(ctx, coordinates, 1_999)
		).resolves.toEqual({ status: 'early', shouldAlert: false, scheduledAt: 2_000 });
		expect(patch).not.toHaveBeenCalled();
		expect(runAt).not.toHaveBeenCalled();

		await expect(
			supervisePublicDiscoveryCoordinatedRebuildWatchdog(ctx, coordinates, 2_000)
		).resolves.toEqual({ status: 'rescheduled', shouldAlert: false, scheduledAt: 5_000 });
		expect(patch).toHaveBeenCalledTimes(1);
		expect(patch).toHaveBeenCalledWith('manifest-id', {
			coordinatedRebuildWatchdogScheduledAt: 5_000
		});
		expect(runAt).toHaveBeenCalledTimes(1);
		expect(runAt).toHaveBeenCalledWith(5_000, expect.anything(), {
			...coordinates,
			scheduledAt: 5_000
		});

		await expect(
			supervisePublicDiscoveryCoordinatedRebuildWatchdog(ctx, coordinates, 2_001)
		).resolves.toEqual({ status: 'superseded', shouldAlert: false });
		expect(patch).toHaveBeenCalledTimes(1);
		expect(runAt).toHaveBeenCalledTimes(1);
		expect(query).toHaveBeenCalledTimes(3);

		await expect(
			supervisePublicDiscoveryCoordinatedRebuildWatchdog(
				ctx,
				{ ...coordinates, coordinatedRebuildAttempt: 0 },
				2_001
			)
		).resolves.toEqual({ status: 'superseded', shouldAlert: false });
		expect(query).toHaveBeenCalledTimes(3);
	});

	it('consumes an expired slot once without touching a cleared or successor owner', async () => {
		const row = manifest({ coordinatedRebuildWatchdogScheduledAt: 2_000 });
		const { ctx, patch, runAt } = harness(row);
		const coordinates = {
			coordinatedRebuildToken: 'owner-token',
			coordinatedRebuildAttempt: 3,
			scheduledAt: 2_000
		};

		await expect(
			supervisePublicDiscoveryCoordinatedRebuildWatchdog(ctx, coordinates, 2_000)
		).resolves.toEqual({
			status: 'stale',
			shouldAlert: true,
			leaseExpiresAt: 2_000,
			failureAt: 2_000,
			failureCode: PUBLIC_DISCOVERY_COORDINATED_REBUILD_LEASE_EXPIRED,
			retryAt: 2_000,
			kind: 'clearSeed',
			attempt: 3
		});
		expect(patch).toHaveBeenCalledTimes(1);
		expect(patch).toHaveBeenCalledWith('manifest-id', {
			coordinatedRebuildFailureAt: 2_000,
			coordinatedRebuildFailureCode: PUBLIC_DISCOVERY_COORDINATED_REBUILD_LEASE_EXPIRED,
			coordinatedRebuildRetryAt: 2_000,
			coordinatedRebuildWatchdogScheduledAt: undefined
		});
		expect(runAt).not.toHaveBeenCalled();

		await expect(
			supervisePublicDiscoveryCoordinatedRebuildWatchdog(ctx, coordinates, 9_000)
		).resolves.toEqual({ status: 'superseded', shouldAlert: false });
		Object.assign(row, {
			coordinatedRebuildToken: 'successor-token',
			coordinatedRebuildAttempt: 4,
			coordinatedRebuildWatchdogScheduledAt: 12_000
		});
		await expect(
			supervisePublicDiscoveryCoordinatedRebuildWatchdog(ctx, coordinates, 12_000)
		).resolves.toEqual({ status: 'superseded', shouldAlert: false });
		expect(patch).toHaveBeenCalledTimes(1);
	});
});
