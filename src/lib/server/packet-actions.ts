/**
 * Shared cursor-loop over `campaigns.getActionsForPacket`.
 *
 * The Convex query is paginated (sub-class A must-enumerate): a single
 * `.collect()` over a campaign's `campaignActions` throws past the per-query
 * document cap once the campaign passes ~16K actions. This helper walks every
 * page from the start cursor to exhaustion and concatenates them, so callers
 * that need the full action set (packet computation, analytics) get it without
 * the scan-cliff and without dropping any row across a page boundary.
 */

import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { Id } from '$convex/_generated/dataModel';

export interface PacketAction {
	verified: boolean;
	engagementTier: number;
	districtHash: string | null;
	h3Cell: string | null;
	messageHash: string | null;
	sentAt: number;
	trustTier: number | null;
	compositionMode: string | null;
	atlasVersion?: string | null;
}

// Hard ceiling on the number of pages walked, as a runaway guard. At 4000
// rows/page this bounds a single packet build to 4M actions — far beyond any
// realistic campaign, but finite so a cursor bug can never loop forever.
const MAX_PACKET_PAGES = 1000;

/**
 * Enumerate ALL packet actions for a campaign across paginated reads.
 */
export async function fetchAllPacketActions(
	campaignId: Id<'campaigns'>
): Promise<PacketAction[]> {
	const all: PacketAction[] = [];
	let cursor: string | null = null;
	for (let page = 0; page < MAX_PACKET_PAGES; page++) {
		const result = (await serverQuery(api.campaigns.getActionsForPacket, {
			campaignId,
			cursor,
			numItems: 4000
		})) as { actions: PacketAction[]; continueCursor: string | null; isDone: boolean };
		all.push(...result.actions);
		if (result.isDone || result.continueCursor === null) break;
		cursor = result.continueCursor;
	}
	return all;
}
