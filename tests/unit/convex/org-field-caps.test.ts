/**
 * Org free-text field caps + websiteUrl scheme-allowlist (D4).
 */
import { describe, it, expect } from 'vitest';
import { capOrThrow, parseHttpUrlOrThrow, ORG_FIELD_CAPS } from '../../../convex/_validators';

describe('org field caps', () => {
	it('capOrThrow rejects over-cap, accepts at the boundary (strict >)', () => {
		expect(() => capOrThrow('name', 'x'.repeat(ORG_FIELD_CAPS.name + 1))).toThrow(
			'ORG_NAME_TOO_LARGE'
		);
		expect(() => capOrThrow('name', 'x'.repeat(ORG_FIELD_CAPS.name))).not.toThrow();
		expect(() => capOrThrow('description', 'x'.repeat(ORG_FIELD_CAPS.description + 1))).toThrow(
			'ORG_DESCRIPTION_TOO_LARGE'
		);
		expect(() => capOrThrow('mission', 'ok')).not.toThrow();
	});

	it('parseHttpUrlOrThrow accepts http(s) and clears empty', () => {
		expect(parseHttpUrlOrThrow('websiteUrl', 'https://example.org')).toBe('https://example.org');
		expect(parseHttpUrlOrThrow('websiteUrl', 'http://a.b')).toBe('http://a.b');
		expect(parseHttpUrlOrThrow('websiteUrl', '')).toBe(''); // clear
	});

	it('parseHttpUrlOrThrow rejects dangerous schemes, protocol-relative, and malformed', () => {
		for (const bad of [
			'javascript:alert(1)',
			'data:text/html,<script>x</script>',
			'vbscript:x',
			'//evil.com',
			'not a url'
		]) {
			expect(() => parseHttpUrlOrThrow('websiteUrl', bad), bad).toThrow('ORG_WEBSITEURL_INVALID');
		}
	});

	it('over-cap websiteUrl throws before parse (length first)', () => {
		expect(() => parseHttpUrlOrThrow('websiteUrl', 'https://' + 'a'.repeat(3000))).toThrow(
			'ORG_WEBSITEURL_TOO_LARGE'
		);
	});
});
