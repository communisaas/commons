import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$env/dynamic/private', () => ({
	env: {
		PSEUDONYMOUS_ID_SALT: '',
		SUBMISSION_ANONYMIZATION_SALT: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'
	}
}));

import { computePseudonymousId } from '$lib/core/privacy/pseudonymous-id';
import { env } from '$env/dynamic/private';

const VALID_SALT = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
const ALT_SALT =   'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';

describe('computePseudonymousId', () => {
	beforeEach(() => {
		(env as Record<string, string>).PSEUDONYMOUS_ID_SALT = '';
		(env as Record<string, string>).SUBMISSION_ANONYMIZATION_SALT = VALID_SALT;
	});

	it('should return a 64-character hex string', () => {
		const result = computePseudonymousId('user-123');
		expect(result).toHaveLength(64);
		expect(result).toMatch(/^[0-9a-f]{64}$/);
	});

	it('should be deterministic (same userId produces same output)', () => {
		const result1 = computePseudonymousId('user-456');
		const result2 = computePseudonymousId('user-456');
		expect(result1).toBe(result2);
	});

	it('should produce different outputs for different userIds', () => {
		const result1 = computePseudonymousId('user-aaa');
		const result2 = computePseudonymousId('user-bbb');
		expect(result1).not.toBe(result2);
	});

	it('should throw error when no salt is set', () => {
		(env as Record<string, string>).PSEUDONYMOUS_ID_SALT = '';
		(env as Record<string, string>).SUBMISSION_ANONYMIZATION_SALT = '';
		expect(() => computePseudonymousId('user-789')).toThrow(/PSEUDONYMOUS_ID_SALT/);
	});

	it('should throw error when active salt is less than 32 characters', () => {
		(env as Record<string, string>).SUBMISSION_ANONYMIZATION_SALT = 'tooshort';
		expect(() => computePseudonymousId('user-000')).toThrow(/PSEUDONYMOUS_ID_SALT/);
	});

	it('prefers PSEUDONYMOUS_ID_SALT over the legacy name when both are set', () => {
		// Compute with legacy name only
		(env as Record<string, string>).PSEUDONYMOUS_ID_SALT = '';
		(env as Record<string, string>).SUBMISSION_ANONYMIZATION_SALT = VALID_SALT;
		const legacyOnly = computePseudonymousId('user-precedence');

		// Now set the canonical name to a different value; output must change
		(env as Record<string, string>).PSEUDONYMOUS_ID_SALT = ALT_SALT;
		// legacy still set, but canonical takes precedence
		const canonicalWins = computePseudonymousId('user-precedence');
		expect(canonicalWins).not.toBe(legacyOnly);

		// And the canonical-only path matches when legacy is unset
		(env as Record<string, string>).SUBMISSION_ANONYMIZATION_SALT = '';
		const canonicalOnly = computePseudonymousId('user-precedence');
		expect(canonicalOnly).toBe(canonicalWins);
	});

	it('falls back to SUBMISSION_ANONYMIZATION_SALT when PSEUDONYMOUS_ID_SALT is unset', () => {
		(env as Record<string, string>).PSEUDONYMOUS_ID_SALT = '';
		(env as Record<string, string>).SUBMISSION_ANONYMIZATION_SALT = VALID_SALT;
		// Should not throw — legacy name is the operative salt
		expect(() => computePseudonymousId('user-legacy')).not.toThrow();
	});
});
