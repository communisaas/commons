/**
 * Tests for safeUserId — audit-safe pseudonymous logging.
 */

import { describe, it, expect } from 'vitest';
import { safeUserId } from '$lib/core/server/security';

describe('safeUserId', () => {
	it('returns a 16-character hex string', () => {
		const result = safeUserId('clxxxxxxxxxxxxxxxxxxxxxxxxx');
		expect(result).toMatch(/^[0-9a-f]{16}$/);
	});

	it('same userId → same pseudonym (deterministic)', () => {
		const a = safeUserId('user-abc-123');
		const b = safeUserId('user-abc-123');
		expect(a).toBe(b);
	});

	it('different userIds → different pseudonyms', () => {
		const a = safeUserId('user-abc-123');
		const b = safeUserId('user-xyz-789');
		expect(a).not.toBe(b);
	});

	it('does not contain the original userId', () => {
		const id = 'clxxxxxxxxxxxxxxxxxxxxxxxxx';
		const result = safeUserId(id);
		expect(result).not.toContain(id);
		expect(result).not.toContain(id.slice(0, 8));
	});
});
