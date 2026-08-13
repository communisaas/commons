import { describe, expect, it } from 'vitest';

import {
	PROVIDER_ERROR_MAX_BYTES,
	sanitizeProviderControlledText,
	sanitizeProviderErrorMessage
} from '$lib/core/agents/provider-error';

describe('provider error sanitizer', () => {
	it('removes control characters and redacts provider credentials', () => {
		const googleKey = `AIza${'a'.repeat(35)}`;
		const bearer = `Bearer ${'b'.repeat(48)}`;
		const genericKey = `GEMINI_API_KEY=${'c'.repeat(40)}`;
		const sanitized = sanitizeProviderErrorMessage(
			`upstream\r\n${googleKey}\u0000 ${bearer}\t${genericKey}`
		);

		expect(sanitized).not.toContain(googleKey);
		expect(sanitized).not.toContain(bearer);
		expect(sanitized).not.toContain('c'.repeat(40));
		expect(sanitized).toContain('[redacted-credential]');
		expect(sanitized).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/u);
	});

	it('caps huge multi-byte messages by UTF-8 bytes', () => {
		const sanitized = sanitizeProviderErrorMessage(`provider said ${'\ud83d\udea8'.repeat(10_000)}`);

		expect(new TextEncoder().encode(sanitized).byteLength).toBeLessThanOrEqual(
			PROVIDER_ERROR_MAX_BYTES
		);
		expect(sanitized.endsWith('…')).toBe(true);
	});

	it('applies tighter byte ceilings to non-error provider fields', () => {
		const key = `fc-${'k'.repeat(40)}`;
		const sanitized = sanitizeProviderControlledText(
			`title\r\n${key}\u0000${'\ud83d\udea8'.repeat(1_000)}`,
			120
		);

		expect(new TextEncoder().encode(sanitized).byteLength).toBeLessThanOrEqual(120);
		expect(sanitized).not.toContain(key);
		expect(sanitized).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/u);
	});

	it.each([0, 1, 2])('honors tiny byte ceilings without ellipsis overflow (%i bytes)', (limit) => {
		const sanitized = sanitizeProviderControlledText('abcdef', limit);

		expect(new TextEncoder().encode(sanitized).byteLength).toBeLessThanOrEqual(limit);
	});
});
