/**
 * Tests for district credential hashing functions.
 */

import { describe, it, expect } from 'vitest';
import { hashDistrict } from '$lib/core/identity/district-credential';

describe('hashDistrict', () => {
	it('same district → same hash (deterministic)', async () => {
		const hash1 = await hashDistrict('CA-12');
		const hash2 = await hashDistrict('CA-12');
		expect(hash1).toBe(hash2);
	});

	it('different districts → different hashes', async () => {
		const hash1 = await hashDistrict('CA-12');
		const hash2 = await hashDistrict('NY-07');
		expect(hash1).not.toBe(hash2);
	});

	it('returns a 64-character lowercase hex string', async () => {
		const hash = await hashDistrict('CA-12');
		expect(hash).toMatch(/^[0-9a-f]{64}$/);
	});

	it('does not contain the plaintext district', async () => {
		const hash = await hashDistrict('CA-12');
		expect(hash).not.toContain('CA-12');
		expect(hash).not.toContain('CA');
	});
});
