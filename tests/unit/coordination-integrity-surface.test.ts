import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/lib/components/org/CoordinationIntegrity.svelte', 'utf8');

describe('CoordinationIntegrity surface contract', () => {
	it('surfaces identical-content pressure as an explicit ALD threshold', () => {
		expect(source).toContain('IDENTICAL_CONTENT_ALD_THRESHOLD = 0.5');
		expect(source).toContain('packet.ald !== null && packet.ald < IDENTICAL_CONTENT_ALD_THRESHOLD');
		expect(source).toContain('Identical-content threshold crossed');
		expect(source).toContain('computeALD threshold');
		expect(source).toContain("score.key === 'ald' && identicalContentWarning");
	});

	it('surfaces absent geography when actions have no district signal', () => {
		expect(source).toContain("'total' | 'districtCount'");
		expect(source).toContain('packet.total > 0 && packet.districtCount === 0');
		expect(source).toContain('Geographic signal absent');
		expect(source).toContain('computeVerificationPacketCached districtCount');
		expect(source).toContain("score.key === 'gds' && absentGeographyWarning");
	});
});
