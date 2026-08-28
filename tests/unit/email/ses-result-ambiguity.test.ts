import { afterEach, describe, expect, it, vi } from 'vitest';

import { sendViaSesWithResult } from '../../../convex/email';

const args = [
	'recipient@example.test',
	'sender@example.test',
	'Commons',
	'Subject',
	'<p>Body</p>',
	'AKIATEST',
	'test-secret',
	'us-east-1'
] as const;

afterEach(() => vi.unstubAllGlobals());

describe('generic SES outcome classification', () => {
	it('preserves transport timeouts as ambiguous', async () => {
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('request timed out')));
		await expect(sendViaSesWithResult(...args)).resolves.toMatchObject({
			ok: false,
			ambiguous: true,
			error: 'request timed out'
		});
	});

	it('preserves non-2xx responses as ambiguous after the carrier POST', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('upstream error', { status: 500 })));
		await expect(sendViaSesWithResult(...args)).resolves.toMatchObject({
			ok: false,
			ambiguous: true,
			status: 500
		});
	});

	it('requires an exact acceptance message id on 2xx', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(
				new Response('{}', {
					status: 200,
					headers: { 'content-type': 'application/json' }
				})
			)
		);
		await expect(sendViaSesWithResult(...args)).resolves.toMatchObject({
			ok: false,
			ambiguous: true,
			error: 'SES_ACCEPTANCE_RECEIPT_MISSING'
		});
	});

	it('settles only an exact 2xx acceptance receipt', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(
				new Response(JSON.stringify({ MessageId: 'ses-message-1' }), {
					status: 200,
					headers: { 'content-type': 'application/json' }
				})
			)
		);
		await expect(sendViaSesWithResult(...args)).resolves.toEqual({
			ok: true,
			ambiguous: false,
			status: 200,
			messageId: 'ses-message-1'
		});
	});
});
