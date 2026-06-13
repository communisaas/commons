import type { PlatformApiSource } from '$lib/server/platform-api-token-custody';
import { actionNetworkAdapter } from './action-network';
import {
	PlatformSyncError,
	type NormalizedPlatformSupporter,
	type PlatformSyncAdapter
} from './types';

/**
 * Adapters with a real paginated fetch behind them. Every other platform
 * profile stays a held verb: CSV export intake remains its live migration
 * path until its adapter lands here.
 */
export const PLATFORM_SYNC_ADAPTERS: ReadonlyMap<PlatformApiSource, PlatformSyncAdapter> = new Map([
	[actionNetworkAdapter.source, actionNetworkAdapter]
]);

export const ARMED_PLATFORM_SYNC_SOURCES: readonly PlatformApiSource[] = [
	...PLATFORM_SYNC_ADAPTERS.keys()
];

export function isArmedPlatformSyncSource(source: string): source is PlatformApiSource {
	return PLATFORM_SYNC_ADAPTERS.has(source as PlatformApiSource);
}

/**
 * Bounded slice geometry. Each route-action invocation fetches at most
 * MAX_PAGES_PER_SLICE vendor pages, then persists a continuation checkpoint.
 * This keeps every slice far inside request limits regardless of org size;
 * >5K-supporter syncs complete across multiple checkpointed slices.
 *
 * Known limitation: checkpoints are vendor page offsets, so records that move
 * across a page boundary between slices (insertions/deletions upstream) can be
 * skipped or refetched. Refetches are harmless (imports dedup by org-scoped
 * email hash); skips are healed by a periodic full re-sync.
 */
export const MAX_PAGES_PER_SLICE = 4;

/** Action Network allows 4 req/s; one fetch every 300ms stays under it. */
export const PAGE_DELAY_MS = 300;

export type PlatformSyncSliceResult = {
	records: NormalizedPlatformSupporter[];
	nextCursor: string | null;
	totalRecords: number | null;
	pagesFetched: number;
	droppedNoEmail: number;
};

export async function runPlatformApiSyncSlice(options: {
	source: string;
	apiKey: string;
	checkpoint: string | null;
	modifiedSince?: string;
	fetchImpl?: typeof fetch;
	delayImpl?: (ms: number) => Promise<void>;
	maxPages?: number;
}): Promise<PlatformSyncSliceResult> {
	const adapter = PLATFORM_SYNC_ADAPTERS.get(options.source as PlatformApiSource);
	if (!adapter) {
		throw new PlatformSyncError(
			`No direct sync adapter is armed for '${options.source}'. CSV export intake remains the live migration path.`,
			'http_error'
		);
	}

	const delay =
		options.delayImpl ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
	const maxPages = options.maxPages ?? MAX_PAGES_PER_SLICE;

	const records: NormalizedPlatformSupporter[] = [];
	let cursor: string | null = options.checkpoint;
	let totalRecords: number | null = null;
	let pagesFetched = 0;
	let droppedNoEmail = 0;

	while (pagesFetched < maxPages) {
		if (pagesFetched > 0) await delay(PAGE_DELAY_MS);
		const page = await adapter.fetchPage(options.apiKey, {
			cursor,
			modifiedSince: options.modifiedSince,
			fetchImpl: options.fetchImpl
		});
		pagesFetched += 1;
		records.push(...page.records);
		droppedNoEmail += page.droppedNoEmail;
		if (page.totalRecords !== null) totalRecords = page.totalRecords;
		cursor = page.nextCursor;
		if (cursor === null) break;
	}

	return { records, nextCursor: cursor, totalRecords, pagesFetched, droppedNoEmail };
}
