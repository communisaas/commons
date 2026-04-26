import { describe, expect, it } from 'vitest';
import { readBoundedJson } from '$lib/server/bounded-json';

describe('readBoundedJson', () => {
	it('parses JSON bodies within the byte cap', async () => {
		const request = new Request('https://example.test', {
			method: 'POST',
			body: JSON.stringify({ ok: true })
		});

		await expect(readBoundedJson(request, 1024)).resolves.toEqual({ ok: true });
	});

	it('rejects oversized bodies from Content-Length before JSON parsing', async () => {
		const request = new Request('https://example.test', {
			method: 'POST',
			headers: { 'content-length': '2048' },
			body: '{'
		});

		await expect(readBoundedJson(request, 1024)).rejects.toMatchObject({ status: 413 });
	});

	it('rejects streamed bodies that exceed the byte cap', async () => {
		const request = new Request('https://example.test', {
			method: 'POST',
			body: JSON.stringify({ data: 'x'.repeat(2048) })
		});

		await expect(readBoundedJson(request, 1024)).rejects.toMatchObject({ status: 413 });
	});
});
