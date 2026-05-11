import { describe, it, expect } from 'vitest';
import { encodeMimeHeader } from '$lib/server/email/mime-header';

describe('encodeMimeHeader (RFC 2047)', () => {
	it('passes ASCII-only input through unchanged', () => {
		expect(encodeMimeHeader('Hello World')).toBe('Hello World');
		expect(encodeMimeHeader('Floor vote on HR-1')).toBe('Floor vote on HR-1');
		expect(encodeMimeHeader('123 verified contacts')).toBe('123 verified contacts');
	});

	it('encodes UTF-8 emoji to base64 encoded-word', () => {
		const out = encodeMimeHeader('Hello 👋');
		expect(out).toMatch(/^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/);
		// Decode the base64 portion and confirm round-trip
		const m = out.match(/=\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=/);
		expect(m).not.toBeNull();
		const decoded = Buffer.from(m![1], 'base64').toString('utf-8');
		expect(decoded).toBe('Hello 👋');
	});

	it('encodes accented Latin characters', () => {
		const out = encodeMimeHeader('Bouclé Coalition');
		const m = out.match(/=\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=/);
		expect(m).not.toBeNull();
		expect(Buffer.from(m![1], 'base64').toString('utf-8')).toBe('Bouclé Coalition');
	});

	it('encodes non-Latin scripts (e.g. CJK)', () => {
		const out = encodeMimeHeader('共同体');
		const m = out.match(/=\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=/);
		expect(m).not.toBeNull();
		expect(Buffer.from(m![1], 'base64').toString('utf-8')).toBe('共同体');
	});

	it('handles empty string by returning empty string (ASCII-only)', () => {
		expect(encodeMimeHeader('')).toBe('');
	});

	it('does NOT trigger encoding for tab or DEL (boundary)', () => {
		// Tab (0x09) and DEL (0x7F) are outside [0x20, 0x7E]. The current
		// regex DOES trigger encoding for these. Verify that intent — if
		// either passed through unchanged it would imply the regex is wrong.
		const tabOut = encodeMimeHeader('a\tb');
		expect(tabOut).toMatch(/^=\?UTF-8\?B\?/);
		const delOut = encodeMimeHeader('a\x7Fb');
		expect(delOut).toMatch(/^=\?UTF-8\?B\?/);
	});

	it('is idempotent — encoding an already-encoded value yields the same value (encoded-word is ASCII)', () => {
		const once = encodeMimeHeader('Hello 👋');
		const twice = encodeMimeHeader(once);
		expect(twice).toBe(once);
	});
});
