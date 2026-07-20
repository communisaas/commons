import { describe, expect, it, vi } from 'vitest';

import {
	readBoundedResponseJson,
	readBoundedResponseText
} from '../../../src/lib/server/bounded-response.mjs';

describe('bounded HTTP response reader', () => {
	it('parses a response whose streamed body stays within the byte limit', async () => {
		const response = new Response(
			new ReadableStream<Uint8Array>({
				start(controller) {
					controller.enqueue(new TextEncoder().encode('{"ok":'));
					controller.enqueue(new TextEncoder().encode('true}'));
					controller.close();
				}
			})
		);

		await expect(readBoundedResponseJson(response, 'Fixture', 16)).resolves.toEqual({ ok: true });
	});

	it('cancels a lengthless stream as soon as its cumulative bytes exceed the limit', async () => {
		const cancel = vi.fn();
		const response = new Response(
			new ReadableStream<Uint8Array>({
				cancel,
				start(controller) {
					controller.enqueue(new Uint8Array(6));
					controller.enqueue(new Uint8Array(6));
				}
			})
		);

		await expect(readBoundedResponseText(response, 'Lengthless fixture', 8)).rejects.toThrow(
			'exceeds 8 bytes'
		);
		expect(cancel).toHaveBeenCalledOnce();
	});

	it('rejects an oversized or malformed declared length before consuming the body', async () => {
		const oversized = new Response('{"ok":true}', {
			headers: { 'content-length': '9' }
		});
		await expect(readBoundedResponseJson(oversized, 'Declared fixture', 8)).rejects.toThrow(
			'exceeds 8 bytes'
		);

		const malformed = new Response('{}', { headers: { 'content-length': '02' } });
		await expect(readBoundedResponseJson(malformed, 'Malformed fixture', 8)).rejects.toThrow(
			'content-length is invalid'
		);
	});

	it('rejects invalid UTF-8 and invalid JSON without reflecting response bytes', async () => {
		await expect(
			readBoundedResponseText(new Response(new Uint8Array([0xff])), 'UTF-8 fixture', 8)
		).rejects.toThrow('UTF-8 fixture is not valid UTF-8');
		await expect(readBoundedResponseJson(new Response('{'), 'JSON fixture', 8)).rejects.toThrow(
			'JSON fixture is not valid JSON'
		);
	});
});
