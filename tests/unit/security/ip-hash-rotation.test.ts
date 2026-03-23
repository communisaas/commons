/**
 * IP Hash Salt Rotation Tests
 *
 * Validates daily HKDF-based salt rotation for privacy-preserving IP hashing.
 * Ensures same-day consistency (rate limiting works) and cross-day decorrelation
 * (prevents long-term IP tracking).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { hashIPAddress } from '$lib/core/server/security';

const TEST_SALT = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';

describe('IP Hash Salt Rotation', () => {
	let originalSalt: string | undefined;
	let originalEnv: string | undefined;

	beforeEach(() => {
		originalSalt = process.env.IP_HASH_SALT;
		originalEnv = process.env.NODE_ENV;
		process.env.IP_HASH_SALT = TEST_SALT;
	});

	afterEach(() => {
		if (originalSalt === undefined) {
			delete process.env.IP_HASH_SALT;
		} else {
			process.env.IP_HASH_SALT = originalSalt;
		}
		if (originalEnv === undefined) {
			delete process.env.NODE_ENV;
		} else {
			process.env.NODE_ENV = originalEnv;
		}
	});

	describe('same-day consistency', () => {
		it('same IP + same date produces identical hash', () => {
			const hash1 = hashIPAddress('192.168.1.1', '2026-03-21');
			const hash2 = hashIPAddress('192.168.1.1', '2026-03-21');
			expect(hash1).toBe(hash2);
		});

		it('different IPs on same date produce different hashes', () => {
			const hash1 = hashIPAddress('192.168.1.1', '2026-03-21');
			const hash2 = hashIPAddress('10.0.0.1', '2026-03-21');
			expect(hash1).not.toBe(hash2);
		});

		it('returns a 64-character hex string', () => {
			const hash = hashIPAddress('192.168.1.1', '2026-03-21');
			expect(hash).toMatch(/^[0-9a-f]{64}$/);
		});
	});

	describe('cross-day decorrelation', () => {
		it('same IP + different date produces different hash', () => {
			const hash1 = hashIPAddress('192.168.1.1', '2026-03-21');
			const hash2 = hashIPAddress('192.168.1.1', '2026-03-22');
			expect(hash1).not.toBe(hash2);
		});

		it('same IP + dates far apart produce different hashes', () => {
			const hash1 = hashIPAddress('10.0.0.1', '2026-01-01');
			const hash2 = hashIPAddress('10.0.0.1', '2026-12-31');
			expect(hash1).not.toBe(hash2);
		});

		it('adjacent dates always produce different hashes for same IP', () => {
			const ip = '172.16.0.100';
			const hashes = new Set<string>();
			for (let day = 1; day <= 7; day++) {
				const date = `2026-03-${String(day).padStart(2, '0')}`;
				hashes.add(hashIPAddress(ip, date));
			}
			// All 7 days should produce unique hashes
			expect(hashes.size).toBe(7);
		});
	});

	describe('missing ENV key fallback', () => {
		it('works without IP_HASH_SALT in non-production (fallback)', () => {
			delete process.env.IP_HASH_SALT;
			process.env.NODE_ENV = 'test';

			const hash = hashIPAddress('192.168.1.1', '2026-03-21');
			expect(hash).toMatch(/^[0-9a-f]{64}$/);
		});

		it('fallback still provides same-day consistency', () => {
			delete process.env.IP_HASH_SALT;
			process.env.NODE_ENV = 'development';

			const hash1 = hashIPAddress('192.168.1.1', '2026-03-21');
			const hash2 = hashIPAddress('192.168.1.1', '2026-03-21');
			expect(hash1).toBe(hash2);
		});

		it('fallback still provides cross-day decorrelation', () => {
			delete process.env.IP_HASH_SALT;
			process.env.NODE_ENV = 'development';

			const hash1 = hashIPAddress('192.168.1.1', '2026-03-21');
			const hash2 = hashIPAddress('192.168.1.1', '2026-03-22');
			expect(hash1).not.toBe(hash2);
		});

		it('throws in production without IP_HASH_SALT', () => {
			delete process.env.IP_HASH_SALT;
			process.env.NODE_ENV = 'production';

			expect(() => hashIPAddress('192.168.1.1', '2026-03-21')).toThrow(
				'IP_HASH_SALT environment variable not configured'
			);
		});
	});

	describe('HKDF properties', () => {
		it('different master salts produce different hashes', () => {
			process.env.IP_HASH_SALT = 'salt-a-0000000000000000000000000000000000000000000000000000';
			const hash1 = hashIPAddress('192.168.1.1', '2026-03-21');

			process.env.IP_HASH_SALT = 'salt-b-0000000000000000000000000000000000000000000000000000';
			const hash2 = hashIPAddress('192.168.1.1', '2026-03-21');

			expect(hash1).not.toBe(hash2);
		});

		it('hash is deterministic given same inputs', () => {
			// Run multiple times to confirm determinism
			const results = Array.from({ length: 5 }, () =>
				hashIPAddress('10.0.0.1', '2026-06-15')
			);
			expect(new Set(results).size).toBe(1);
		});
	});
});
