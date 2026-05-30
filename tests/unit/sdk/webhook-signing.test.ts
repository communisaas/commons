/**
 * Cross-verifies the webhook signature contract: signing on one side, the SDK
 * verify helper on the other. If these ever drift apart, the test breaks —
 * receivers integrating against our SDK get the same answer as the dispatcher
 * computes in `convex/orgWebhooks.ts`.
 */
import { describe, it, expect } from 'vitest';
import { verifyWebhookSignature } from '../../../packages/sdk-typescript/src/index.js';

const enc = new TextEncoder();

async function signMessage(secret: string, payload: string, ts: number): Promise<string> {
	const key = await crypto.subtle.importKey(
		'raw',
		enc.encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	const macBuf = await crypto.subtle.sign('HMAC', key, enc.encode(`${ts}.${payload}`));
	const mac = Array.from(new Uint8Array(macBuf))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
	return `t=${ts},v1=${mac}`;
}

describe('webhook signing', () => {
	it('verifies a freshly signed payload', async () => {
		const secret = 'whsec_test_0123456789abcdef';
		const payload = JSON.stringify({ event: 'donation.completed', amount: 100 });
		const ts = Date.now();
		const header = await signMessage(secret, payload, ts);
		const ok = await verifyWebhookSignature({ payload, header, secrets: secret });
		expect(ok).toBe(true);
	});

	it('rejects a payload signed with a different secret', async () => {
		const payload = JSON.stringify({ event: 'supporter.created' });
		const ts = Date.now();
		const header = await signMessage('whsec_wrong', payload, ts);
		const ok = await verifyWebhookSignature({
			payload,
			header,
			secrets: 'whsec_right'
		});
		expect(ok).toBe(false);
	});

	it('rejects a tampered payload', async () => {
		const secret = 'whsec_test';
		const original = JSON.stringify({ event: 'donation.completed', amount: 100 });
		const tampered = JSON.stringify({ event: 'donation.completed', amount: 1000 });
		const header = await signMessage(secret, original, Date.now());
		const ok = await verifyWebhookSignature({ payload: tampered, header, secrets: secret });
		expect(ok).toBe(false);
	});

	it('rejects deliveries outside the freshness tolerance', async () => {
		const secret = 'whsec_test';
		const payload = JSON.stringify({ event: 'event.rsvp_created' });
		const stale = Date.now() - 10 * 60 * 1000; // 10 min ago, 5 min default tolerance
		const header = await signMessage(secret, payload, stale);
		const ok = await verifyWebhookSignature({
			payload,
			header,
			secrets: secret,
			toleranceSeconds: 300
		});
		expect(ok).toBe(false);
	});

	it('accepts the previous secret during a rotation window', async () => {
		const oldSecret = 'whsec_old';
		const newSecret = 'whsec_new';
		const payload = JSON.stringify({ event: 'supporter.updated' });
		// Sender still signing with the old secret — receiver supplies both.
		const header = await signMessage(oldSecret, payload, Date.now());
		const ok = await verifyWebhookSignature({
			payload,
			header,
			secrets: [newSecret, oldSecret]
		});
		expect(ok).toBe(true);
	});

	it('handles malformed headers without throwing', async () => {
		for (const bad of ['', 'garbage', 't=,v1=', 'v1=abc', 't=notnumeric,v1=abc']) {
			const ok = await verifyWebhookSignature({
				payload: 'x',
				header: bad,
				secrets: 'whsec_test'
			});
			expect(ok).toBe(false);
		}
	});
});
