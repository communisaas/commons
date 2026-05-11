/**
 * Webhook-handler idempotency invariants.
 *
 * Mirrors `convex/webhooks.ts:updateSmsStatus` and the Click case inside
 * `handleDeliveryEvent` using an in-memory mock ctx, since vitest can't
 * import Convex internals. The mocks reproduce the relevant `ctx.db`
 * surface (query → withIndex/filter → first / collect, get, patch) with
 * deterministic state.
 *
 * Drift-canary: any change to the production handler bodies should be
 * mirrored here. The test names describe the retry-inflation invariant
 * being pinned so a future refactor surfaces if it regresses.
 */

import { describe, it, expect, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// updateSmsStatus must not increment deliveredCount on retry (idempotency)
// ---------------------------------------------------------------------------

interface SmsMessage {
	_id: string;
	twilioSid: string;
	blastId: string;
	status: string;
	errorCode?: string;
}

interface SmsBlast {
	_id: string;
	deliveredCount?: number;
	updatedAt?: number;
}

class MockSmsState {
	messages = new Map<string, SmsMessage>();
	blasts = new Map<string, SmsBlast>();

	// Mirror of updateSmsStatus handler logic.
	async update(args: {
		twilioSid: string;
		status: string;
		errorCode?: string;
	}): Promise<void> {
		const message = Array.from(this.messages.values()).find(
			(m) => m.twilioSid === args.twilioSid
		);
		if (!message) return;

		const previousStatus = message.status;
		message.status = args.status;
		message.errorCode = args.errorCode;

		if (args.status === 'delivered' && previousStatus !== 'delivered') {
			const blast = this.blasts.get(message.blastId);
			if (blast) {
				blast.deliveredCount = (blast.deliveredCount ?? 0) + 1;
				blast.updatedAt = Date.now();
			}
		}
	}
}

describe('updateSmsStatus — retry-inflation guard', () => {
	let state: MockSmsState;

	beforeEach(() => {
		state = new MockSmsState();
		state.blasts.set('blast_1', { _id: 'blast_1', deliveredCount: 0 });
		state.messages.set('msg_1', {
			_id: 'msg_1',
			twilioSid: 'SM1',
			blastId: 'blast_1',
			status: 'sent'
		});
	});

	it('increments deliveredCount on the FIRST delivered callback', async () => {
		await state.update({ twilioSid: 'SM1', status: 'delivered' });
		expect(state.blasts.get('blast_1')!.deliveredCount).toBe(1);
		expect(state.messages.get('msg_1')!.status).toBe('delivered');
	});

	it('does NOT increment deliveredCount on a duplicate delivered callback', async () => {
		await state.update({ twilioSid: 'SM1', status: 'delivered' });
		await state.update({ twilioSid: 'SM1', status: 'delivered' });
		await state.update({ twilioSid: 'SM1', status: 'delivered' });
		expect(state.blasts.get('blast_1')!.deliveredCount).toBe(1);
	});

	it('handles transition sent → delivered → delivered correctly (single increment)', async () => {
		await state.update({ twilioSid: 'SM1', status: 'sent' });
		expect(state.blasts.get('blast_1')!.deliveredCount).toBe(0);
		await state.update({ twilioSid: 'SM1', status: 'delivered' });
		expect(state.blasts.get('blast_1')!.deliveredCount).toBe(1);
		await state.update({ twilioSid: 'SM1', status: 'delivered' });
		expect(state.blasts.get('blast_1')!.deliveredCount).toBe(1);
	});

	it('does not increment for non-delivered statuses (failed, undelivered)', async () => {
		await state.update({ twilioSid: 'SM1', status: 'failed', errorCode: '30007' });
		expect(state.blasts.get('blast_1')!.deliveredCount).toBe(0);
		expect(state.messages.get('msg_1')!.status).toBe('failed');
		expect(state.messages.get('msg_1')!.errorCode).toBe('30007');
	});
});

// ---------------------------------------------------------------------------
// handleDeliveryEvent Click case must not double-record on retry (idempotency)
// ---------------------------------------------------------------------------

interface AccountabilityResponse {
	type: string;
	detail?: string;
	confidence: string;
	occurredAt: number;
}

interface AccountabilityReceipt {
	_id: string;
	deliveryId: string;
	responses?: AccountabilityResponse[];
}

class MockReceiptState {
	receipts = new Map<string, AccountabilityReceipt>();

	// Mirror of handleDeliveryEvent's Click case.
	async recordClick(args: { deliveryId: string; linkUrl?: string }): Promise<void> {
		const receipt = Array.from(this.receipts.values()).find(
			(r) => r.deliveryId === args.deliveryId
		);
		if (!receipt) return;

		const responses = receipt.responses ?? [];
		const isVerifyClick = args.linkUrl?.includes('/verify/') ?? false;
		const newType = isVerifyClick ? 'clicked_verify' : 'opened';
		const newDetail = isVerifyClick ? args.linkUrl : undefined;

		const alreadyRecorded = isVerifyClick
			? responses.some((r) => r.type === newType && r.detail === newDetail)
			: responses.some((r) => r.type === 'opened');

		if (!alreadyRecorded) {
			receipt.responses = [
				...responses,
				{
					type: newType,
					detail: newDetail,
					confidence: 'observed',
					occurredAt: Date.now()
				}
			];
		}
	}
}

describe('handleDeliveryEvent Click case — retry-inflation guard', () => {
	let state: MockReceiptState;

	beforeEach(() => {
		state = new MockReceiptState();
		state.receipts.set('rec_1', { _id: 'rec_1', deliveryId: 'del_1' });
	});

	it('records a verify click on first delivery', async () => {
		await state.recordClick({
			deliveryId: 'del_1',
			linkUrl: 'https://commons.email/verify/abc123'
		});
		const responses = state.receipts.get('rec_1')!.responses!;
		expect(responses).toHaveLength(1);
		expect(responses[0].type).toBe('clicked_verify');
		expect(responses[0].detail).toBe('https://commons.email/verify/abc123');
	});

	it('does NOT double-record a duplicate verify-click for the same link', async () => {
		const url = 'https://commons.email/verify/abc123';
		await state.recordClick({ deliveryId: 'del_1', linkUrl: url });
		await state.recordClick({ deliveryId: 'del_1', linkUrl: url });
		await state.recordClick({ deliveryId: 'del_1', linkUrl: url });
		expect(state.receipts.get('rec_1')!.responses).toHaveLength(1);
	});

	it('records distinct verify-clicks on different links separately', async () => {
		await state.recordClick({
			deliveryId: 'del_1',
			linkUrl: 'https://commons.email/verify/aaa'
		});
		await state.recordClick({
			deliveryId: 'del_1',
			linkUrl: 'https://commons.email/verify/bbb'
		});
		expect(state.receipts.get('rec_1')!.responses).toHaveLength(2);
	});

	it('does NOT add a non-verify click when "opened" already exists', async () => {
		// Simulate Open event already recorded.
		state.receipts.get('rec_1')!.responses = [
			{ type: 'opened', confidence: 'observed', occurredAt: 1 }
		];
		await state.recordClick({
			deliveryId: 'del_1',
			linkUrl: 'https://example.com/news'
		});
		expect(state.receipts.get('rec_1')!.responses).toHaveLength(1);
	});

	it('records a non-verify click as "opened" when no prior open exists', async () => {
		await state.recordClick({
			deliveryId: 'del_1',
			linkUrl: 'https://example.com/news'
		});
		const responses = state.receipts.get('rec_1')!.responses!;
		expect(responses).toHaveLength(1);
		expect(responses[0].type).toBe('opened');
		expect(responses[0].detail).toBeUndefined();
	});

	it('non-verify and verify clicks coexist (different dedup buckets)', async () => {
		// First a non-verify click → records "opened"
		await state.recordClick({
			deliveryId: 'del_1',
			linkUrl: 'https://example.com/news'
		});
		// Then a verify click → records "clicked_verify"
		await state.recordClick({
			deliveryId: 'del_1',
			linkUrl: 'https://commons.email/verify/abc'
		});
		expect(state.receipts.get('rec_1')!.responses).toHaveLength(2);
		const types = state.receipts.get('rec_1')!.responses!.map((r) => r.type);
		expect(types).toEqual(['opened', 'clicked_verify']);
	});
});
