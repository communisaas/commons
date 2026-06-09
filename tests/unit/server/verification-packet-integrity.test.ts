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
	atlasVersion: string | null;
}> = {}) {
	return {
		verified: true,
		engagementTier: 1,
		districtHash: 'd1',
		h3Cell: null,
		messageHash: 'm1',
		sentAt: Date.UTC(2026, 0, 1, 12),
		trustTier: 2,
		compositionMode: null,
		atlasVersion: null,
		...overrides
	};
}

describe('verification packet integrity metrics', () => {
	it('computes ALD from unique message hashes over hashed actions', () => {
		const actions = [
			...Array.from({ length: 4 }, () => action({ messageHash: 'same-message' })),
			action({ messageHash: 'one-edit' })
		];

		const packet = computePacket(actions);

		expect(packet.ald).toBe(0.4);
		expect(packet.authorship.shared).toBe(4);
		expect(packet.authorship.individual).toBe(1);
	});

	it('preserves absent geography as zero districts without fabricating GDS', () => {
		const actions = Array.from({ length: 5 }, (_, index) =>
			action({
				districtHash: null,
				messageHash: `unique-message-${index}`,
				sentAt: Date.UTC(2026, 0, 1, 12 + index)
			})
		);

		const packet = computePacket(actions);

		expect(packet.total).toBe(5);
		expect(packet.districtCount).toBe(0);
		expect(packet.geography).toBeNull();
		expect(packet.gds).toBeNull();
	});

	it('computes atlas drift only from action rows carrying atlas evidence', () => {
		const actions = [
			action({ atlasVersion: 'atlas-v2', h3Cell: '872830828ffffff' }),
			action({ atlasVersion: 'atlas-v2', h3Cell: '872830829ffffff' }),
			action({ atlasVersion: 'atlas-v1', h3Cell: '87283082affffff' }),
			action({ atlasVersion: null, h3Cell: null })
		];

		const packet = computePacket(actions);

		expect(packet.driftCount).toBe(1);
		expect(packet.driftPct).toBe(25);
	});
});
