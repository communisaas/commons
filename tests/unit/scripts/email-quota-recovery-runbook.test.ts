import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const runbook = readFileSync(
	resolve(process.cwd(), 'docs/ops/EMAIL-QUOTA-RESERVATION-RECOVERY.md'),
	'utf8'
);

describe('email quota reservation recovery runbook', () => {
	it('requires evidence before reconciliation and exact repair afterward', () => {
		const status = runbook.indexOf('planUsage:reservationStatus');
		const ingest = runbook.indexOf('planUsage:ingestCarrierEvidence');
		const reconcile = runbook.indexOf('planUsage:reconcileBlockedReservation');
		const repair = runbook.indexOf('planUsage:repairStatus');

		expect(status).toBeGreaterThan(-1);
		expect(ingest).toBeGreaterThan(status);
		expect(reconcile).toBeGreaterThan(ingest);
		expect(repair).toBeGreaterThan(reconcile);
		expect(runbook).toContain('absoluteSentCount + absoluteFailedCount = requestedCount');
		expect(runbook).toContain('does not clear the organization block');
	});

	it('forbids unsafe zero inference, manual counter edits, and blind resend', () => {
		expect(runbook).toContain('Never resend');
		expect(runbook).toContain('Never patch organization counters');
		expect(runbook).toContain('Never infer zero sends');
		expect(runbook).toContain('leave the reservation blocked');
	});
});
