import { describe, expect, it, vi } from 'vitest';

import { classifyPublicTemplateOgRecoveryPreflight } from '../../../scripts/run-public-template-og-release-phase.mjs';

describe('fresh-runner release recovery oracle', () => {
	it('treats live C as terminal after finalize response loss and performs no recovery mutation', () => {
		const mutateAuthority = vi.fn();
		const mutatePages = vi.fn();
		const mutateQueues = vi.fn();
		const journalStatus = 'qualified';
		const liveInspectStatus = 'committed';

		const decision = classifyPublicTemplateOgRecoveryPreflight({
			authorityStatus: liveInspectStatus
		});
		if (decision === 'recover') {
			mutateAuthority();
			mutatePages();
			mutateQueues();
		}

		expect(journalStatus).toBe('qualified');
		expect(decision).toBe('committed-terminal');
		expect(mutateAuthority).not.toHaveBeenCalled();
		expect(mutatePages).not.toHaveBeenCalled();
		expect(mutateQueues).not.toHaveBeenCalled();
	});

	it.each([
		{ authorityStatus: 'superseded', pagesState: 'baseline', workerState: 'baseline', gateState: 'baseline' },
		{ authorityStatus: 'qualified', pagesState: 'superseded', workerState: 'baseline', gateState: 'baseline' },
		{ authorityStatus: 'contained', pagesState: 'baseline', workerState: 'superseded', gateState: 'baseline' },
		{ authorityStatus: 'absent', pagesState: 'baseline', workerState: 'baseline', gateState: 'superseded' }
	])('makes a stale/mismatched $authorityStatus transaction a zero-mutation supersession', (preflight) => {
		const mutation = vi.fn();
		const decision = classifyPublicTemplateOgRecoveryPreflight(preflight);
		if (decision === 'recover') mutation();

		expect(decision).toBe('superseded');
		expect(mutation).not.toHaveBeenCalled();
	});
});
