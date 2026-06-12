/**
 * SMS client-dispatch batch bound parity.
 *
 * The bound lives in two places by structural necessity: Convex modules
 * cannot import from src/lib, so `SMS_CLIENT_DISPATCH_BATCH_LIMIT`
 * (convex/sms.ts — enforcement) and `MAX_DECRYPTED_SMS_DISPATCH`
 * (src/lib/data/org-limit-sentences.ts — the sentence shown to org members)
 * are intentional duplicates. This test pins them equal so the copy can
 * never drift from the enforcement.
 */

import { describe, it, expect } from 'vitest';
import { SMS_CLIENT_DISPATCH_BATCH_LIMIT } from '../../../convex/sms';
import { MAX_DECRYPTED_SMS_DISPATCH } from '../../../src/lib/data/org-limit-sentences';

describe('SMS batch bound parity', () => {
	it('Convex enforcement bound equals the sentence-module bound', () => {
		expect(SMS_CLIENT_DISPATCH_BATCH_LIMIT).toBe(MAX_DECRYPTED_SMS_DISPATCH);
	});

	it('the bound is a positive integer', () => {
		expect(Number.isInteger(SMS_CLIENT_DISPATCH_BATCH_LIMIT)).toBe(true);
		expect(SMS_CLIENT_DISPATCH_BATCH_LIMIT).toBeGreaterThan(0);
	});
});
