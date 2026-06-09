import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const packetSource = readFileSync('src/lib/components/org/VerificationPacket.svelte', 'utf8');

describe('VerificationPacket surface contracts', () => {
	it('renders computed engagement depth without exposing suppressed counts as negative numbers', () => {
		expect(packetSource).toContain('Engagement depth');
		expect(packetSource).toContain('engagementTiers');
		expect(packetSource).toContain('computeTierDistribution');
		expect(packetSource).toContain('&lt;5');
		expect(packetSource).toContain('{@const visible = tier.count > 0}');
		expect(packetSource).toContain('class:vp__tier-count--suppressed={!visible}');
		expect(packetSource).toContain('{#if visible}');
	});
});
