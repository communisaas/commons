/**
 * Legislative deposition guard (A5).
 *
 * The vote-tracking / bill-relevance / alert producers are stubs with zero
 * callers, so their surfaces must show an explicit "not yet available" gated on
 * the LEGISLATIVE_INTELLIGENCE_LIVE capability constant (not a runtime
 * length===0 check, which would mislabel a genuinely-empty-but-working list once
 * E1 ships). This locks the gate and the depositioned doc copy.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FEATURES } from '../../../src/lib/config/features';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('legislative deposition', () => {
	it('LEGISLATIVE_INTELLIGENCE_LIVE is off (producers are stubs)', () => {
		expect(FEATURES.LEGISLATIVE_INTELLIGENCE_LIVE).toBe(false);
	});

	it('the relevance section gates capability-FIRST, then data (reversible for E1)', () => {
		const page = read('src/routes/org/[slug]/legislation/+page.svelte');
		const notLive = page.indexOf('!FEATURES.LEGISLATIVE_INTELLIGENCE_LIVE');
		const lengthCheck = page.indexOf('data.relevant.length === 0');
		expect(notLive).toBeGreaterThan(-1);
		expect(lengthCheck).toBeGreaterThan(-1);
		// capability branch must precede the length branch so flag-ON+empty shows the
		// transient copy, not "not available".
		expect(notLive).toBeLessThan(lengthCheck);
	});

	it('the scorecard Alignment sort is capability-gated', () => {
		const dash = read('src/lib/components/org/ScorecardDashboard.svelte');
		const gate = dash.indexOf('FEATURES.LEGISLATIVE_INTELLIGENCE_LIVE');
		const alignmentBtn = dash.indexOf("sortBy = 'alignment'");
		expect(gate).toBeGreaterThan(-1);
		// the Alignment button sits inside the capability gate
		expect(gate).toBeLessThan(alignmentBtn);
	});

	it('competitive-analysis prices no unbuilt Commons legislative capability', () => {
		const row = read('docs/research/competitive-analysis.md')
			.split('\n')
			.find((l) => l.includes('**Legislative intelligence (bills, votes, alerts)**'));
		expect(row).toBeDefined();
		// Must not sell legislative intelligence as priced / spec'd / shipped-built.
		expect(row).not.toMatch(/6\.50|Spec'd|\bBuilt\b/);
		// Must read as an honest trail / substrate-stub, not a Commons strength.
		expect(row).toMatch(/Trail|substrate\/stub|Commons trails|credibility floor/);
	});
});
