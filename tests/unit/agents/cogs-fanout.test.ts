/**
 * COGS-fanout guard for decision-maker resolution (guard a).
 *
 * Per-message COGS scales ~linearly with the number of roles Phase 1 enumerates:
 * each role drives an Exa identity search + a per-identity contact search +
 * chunked Gemini synthesis (Firecrawl reads are separately capped at 20). Phase 1
 * is an UNBOUNDED LLM enumeration, so without a bound a broad subject could fan
 * out far enough to blow past the budgeted ~$0.22 per-message ceiling.
 *
 * `capFanout` bounds the role count BEFORE the fanout begins so the downstream
 * external-API spend is deterministically bounded. These tests pin:
 *   - the bound is applied (length never exceeds the cap),
 *   - lists at/under the cap pass through unchanged,
 *   - guided (explicitly-targeted) roles are kept first so precise targeting is
 *     never truncated in favor of speculative breadth,
 *   - it is pure (does not mutate the input).
 */

import { describe, it, expect } from 'vitest';
import { capFanout, MAX_DECISION_MAKER_FANOUT } from '$lib/core/agents/cogs-fanout';

interface Role {
	position: string;
	guided?: boolean;
}

function roles(n: number, guided = false): Role[] {
	return Array.from({ length: n }, (_, i) => ({ position: `role-${i}`, guided }));
}

describe('MAX_DECISION_MAKER_FANOUT', () => {
	it('is a small positive bound (keeps per-message COGS within the ~$0.22 ceiling)', () => {
		expect(MAX_DECISION_MAKER_FANOUT).toBeGreaterThan(0);
		expect(MAX_DECISION_MAKER_FANOUT).toBeLessThanOrEqual(20);
	});
});

describe('capFanout', () => {
	it('passes a list AT the cap through unchanged', () => {
		const input = roles(MAX_DECISION_MAKER_FANOUT);
		expect(capFanout(input)).toHaveLength(MAX_DECISION_MAKER_FANOUT);
	});

	it('passes a list UNDER the cap through unchanged', () => {
		const input = roles(3);
		const out = capFanout(input);
		expect(out).toHaveLength(3);
		expect(out).toEqual(input);
	});

	it('BOUNDS a list over the cap to exactly the cap', () => {
		const out = capFanout(roles(100));
		expect(out).toHaveLength(MAX_DECISION_MAKER_FANOUT);
	});

	it('never exceeds the cap regardless of how many roles Phase 1 enumerates', () => {
		for (const n of [0, 1, 12, 13, 50, 500]) {
			expect(capFanout(roles(n)).length).toBeLessThanOrEqual(MAX_DECISION_MAKER_FANOUT);
		}
	});

	it('keeps GUIDED (explicitly-targeted) roles first when truncating', () => {
		// 2 guided + many speculative; cap must retain BOTH guided roles.
		const guided = roles(2, true).map((r, i) => ({ ...r, position: `guided-${i}` }));
		const speculative = roles(50, false);
		const out = capFanout([...speculative, ...guided], MAX_DECISION_MAKER_FANOUT);
		expect(out).toHaveLength(MAX_DECISION_MAKER_FANOUT);
		const keptGuided = out.filter((r) => r.guided === true);
		expect(keptGuided).toHaveLength(2);
		expect(keptGuided.map((r) => r.position).sort()).toEqual(['guided-0', 'guided-1']);
	});

	it('respects an explicit max argument', () => {
		expect(capFanout(roles(20), 5)).toHaveLength(5);
	});

	it('is pure — does not mutate the input array', () => {
		const input = roles(50);
		const snapshot = [...input];
		capFanout(input);
		expect(input).toEqual(snapshot);
		expect(input).toHaveLength(50);
	});
});
