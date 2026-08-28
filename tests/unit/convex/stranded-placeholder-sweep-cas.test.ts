import { describe, expect, it } from 'vitest';

import { matchesStrandedPlaceholderSweepCas } from '../../../convex/lib/strandedPlaceholderSweep';

describe.each(['supporters', 'donations'])('%s one-shot sweep overlap CAS', (table) => {
	it('allows the first page save and rejects a delayed rewind/completion', () => {
		const loaded = {
			activeVersion: 1,
			activeRunToken: `${table}:run-1`,
			cursorRevision: 7,
			cursor: 'cursor-c'
		};
		const expectation = {
			version: 1,
			runToken: loaded.activeRunToken,
			expectedRevision: 7,
			expectedCursor: 'cursor-c'
		};
		expect(matchesStrandedPlaceholderSweepCas(loaded, expectation)).toBe(true);

		const advancedByFasterTick = {
			...loaded,
			cursorRevision: 8,
			cursor: 'cursor-d'
		};
		expect(matchesStrandedPlaceholderSweepCas(advancedByFasterTick, expectation)).toBe(false);
		expect(
			matchesStrandedPlaceholderSweepCas(
				{ ...advancedByFasterTick, activeVersion: undefined, activeRunToken: undefined },
				expectation
			)
		).toBe(false);
	});

	it('rejects a cursor match from another activation run', () => {
		expect(
			matchesStrandedPlaceholderSweepCas(
				{
					activeVersion: 1,
					activeRunToken: `${table}:run-2`,
					cursorRevision: 7,
					cursor: 'cursor-c'
				},
				{
					version: 1,
					runToken: `${table}:run-1`,
					expectedRevision: 7,
					expectedCursor: 'cursor-c'
				}
			)
		).toBe(false);
	});
});
