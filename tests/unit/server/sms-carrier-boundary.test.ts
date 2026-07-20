import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	TEXT_DISPATCH_ONE_SHOT_CLAIMS_READY,
	getTextDispatchReadiness
} from '../../../src/lib/server/sms/text-dispatch-readiness';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('outbound SMS carrier launch boundary', () => {
	it('cannot be armed by flags, credentials, or caller-provided plaintext before one-shot claims exist', () => {
		expect(TEXT_DISPATCH_ONE_SHOT_CLAIMS_READY).toBe(false);
		const readiness = getTextDispatchReadiness(
			{
				TWILIO_ACCOUNT_SID: 'AC-test',
				TWILIO_AUTH_TOKEN: 'test-token',
				TWILIO_PHONE_NUMBER: '+15550000000'
			},
			{
				featureEnabled: true,
				runnerImplemented: true,
				clientDecryptorMounted: true,
				clientBatchRouteMounted: true
			}
		);
		expect(readiness).toMatchObject({
			ready: false,
			runtimeFlag: 'open_without_one_shot_claims',
			oneShotClaimsReady: false
		});
		expect(readiness.missing).toContain(
			'per-recipient one-shot carrier claim and outcome evidence'
		);
	});

	it('evaluates the non-overridable readiness tombstone before cohort reads or Twilio calls', () => {
		const readiness = source('src/lib/server/sms/text-dispatch-readiness.ts');
		const route = source('src/routes/api/org/[slug]/sms/[id]/+server.ts');
		expect(readiness).toMatch(/TEXT_DISPATCH_ONE_SHOT_CLAIMS_READY\s*=\s*false/);
		expect(readiness).not.toMatch(/oneShotClaimsReady\?:/);
		const gate = route.indexOf('if (!readiness.ready) return textDispatchBoundary(readiness)');
		const cohort = route.indexOf('api.sms.getEncryptedRecipientsForBlast');
		const carrier = route.indexOf('await sendSms(');
		expect(gate).toBeGreaterThanOrEqual(0);
		expect(cohort).toBeGreaterThan(gate);
		expect(carrier).toBeGreaterThan(cohort);
	});
});
