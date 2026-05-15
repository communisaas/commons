import { describe, expect, it } from 'vitest';
import { computePacket } from '$lib/server/verification-packet';

function action(overrides: Partial<{
	verified: boolean;
	engagementTier: number;
	districtHash: string | null;
	h3Cell: string | null;
	messageHash: string | null;
	sentAt: number;
	trustTier: number | null;
	compositionMode: string | null;
}> = {}) {
	return {
		verified: true,
		engagementTier: 1,
		districtHash: 'd1',
		h3Cell: null,
		messageHash: null,
		sentAt: Date.UTC(2026, 0, 1, 12),
		trustTier: 2,
		compositionMode: null,
		...overrides
	};
}

describe('computeCellGeography sub-bucket K', () => {
	const CELL_A = '872a1072affffff';

	it('suppresses cell entirely when actions < 5', () => {
		const actions = Array.from({ length: 4 }, () => action({ h3Cell: CELL_A }));
		const packet = computePacket(actions);
		// Sub-K cells are dropped from the result; either null (when only cell)
		// or empty (when present cells are sub-K). Either way: no cell entry.
		expect(packet.cells ?? []).toEqual([]);
	});

	it('emits only h3 + count at K=5 (no sub-buckets ever)', () => {
		const actions = [
			action({ h3Cell: CELL_A, trustTier: 4 }),
			action({ h3Cell: CELL_A, trustTier: 2 }),
			action({ h3Cell: CELL_A, trustTier: 2 }),
			action({ h3Cell: CELL_A, trustTier: 2 }),
			action({ h3Cell: CELL_A, trustTier: 2 }),
			action({ h3Cell: CELL_A, trustTier: 1 })
		];
		const packet = computePacket(actions);
		expect(packet.cells).not.toBeNull();
		const cell = packet.cells![0];
		expect(cell.h3).toBe(CELL_A);
		expect(cell.count).toBe(6);
		expect(cell.identity).toBeUndefined();
		expect(cell.authorship).toBeUndefined();
		expect(cell.temporalBins).toBeUndefined();
	});

	it('does NOT emit cell sub-buckets even at K=10 (padding bypass defense)', () => {
		// Attacker pad: 3 govId + 3 address + 3 email sockpuppets, then victim adds +1.
		// {4, 3, 3} or {3, 4, 3} or {3, 3, 4} would satisfy any L=3 diversity check,
		// letting the attacker subtract padding to recover the victim's category.
		// The defense is to never publish per-cell category counts at all.
		const actions = [
			action({ h3Cell: CELL_A, trustTier: 4 }),
			action({ h3Cell: CELL_A, trustTier: 4 }),
			action({ h3Cell: CELL_A, trustTier: 4 }),
			action({ h3Cell: CELL_A, trustTier: 2 }),
			action({ h3Cell: CELL_A, trustTier: 2 }),
			action({ h3Cell: CELL_A, trustTier: 2 }),
			action({ h3Cell: CELL_A, trustTier: 1 }),
			action({ h3Cell: CELL_A, trustTier: 1 }),
			action({ h3Cell: CELL_A, trustTier: 1 }),
			action({ h3Cell: CELL_A, trustTier: 4 })
		];
		const packet = computePacket(actions);
		const cell = packet.cells![0];
		expect(cell.count).toBe(10);
		expect(cell.identity).toBeUndefined();
		expect(cell.authorship).toBeUndefined();
		expect(cell.temporalBins).toBeUndefined();
	});
});
