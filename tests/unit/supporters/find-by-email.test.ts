/**
 * Tests for findSupporterByEmail helper (S-6)
 *
 * Verifies email_hash-only lookup (post-backfill — no plaintext fallback).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mockComputeEmailHash = vi.hoisted(() => vi.fn());
const mockDbSupporter = vi.hoisted(() => ({
	findUnique: vi.fn()
}));
const mockDb = vi.hoisted(() => ({
	supporter: mockDbSupporter
}));

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('$lib/core/db', () => ({ db: mockDb }));
vi.mock('$lib/core/crypto/user-pii-encryption', () => ({
	computeEmailHash: mockComputeEmailHash
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { findSupporterByEmail } from '$lib/server/supporters/find-by-email';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ORG_ID = 'org-001';
const EMAIL = 'alice@example.com';
const EMAIL_HASH = 'abc123hash';

const SUPPORTER = {
	id: 'sup-001',
	orgId: ORG_ID,
	email: EMAIL,
	email_hash: EMAIL_HASH,
	name: 'Alice',
};

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
	vi.clearAllMocks();
	mockComputeEmailHash.mockResolvedValue(EMAIL_HASH);
	mockDbSupporter.findUnique.mockResolvedValue(null);
});

afterEach(() => {
	vi.restoreAllMocks();
});

// ============================================================================
// Tests
// ============================================================================

describe('findSupporterByEmail', () => {
	describe('email_hash lookup', () => {
		it('should find supporter by orgId + email_hash', async () => {
			mockDbSupporter.findUnique.mockResolvedValueOnce(SUPPORTER);

			const result = await findSupporterByEmail(ORG_ID, EMAIL);

			expect(result).toBe(SUPPORTER);
			expect(mockDbSupporter.findUnique).toHaveBeenCalledWith({
				where: { orgId_email_hash: { orgId: ORG_ID, email_hash: EMAIL_HASH } }
			});
			expect(mockDbSupporter.findUnique).toHaveBeenCalledTimes(1);
		});

		it('should normalize email before hashing', async () => {
			mockDbSupporter.findUnique.mockResolvedValueOnce(SUPPORTER);

			await findSupporterByEmail(ORG_ID, '  ALICE@Example.COM  ');

			expect(mockComputeEmailHash).toHaveBeenCalledWith('alice@example.com');
		});
	});

	describe('missing EMAIL_LOOKUP_KEY', () => {
		it('should throw when computeEmailHash returns null', async () => {
			mockComputeEmailHash.mockResolvedValue(null);

			await expect(findSupporterByEmail(ORG_ID, EMAIL)).rejects.toThrow(
				'EMAIL_LOOKUP_KEY not set'
			);
			// No DB lookup should be attempted
			expect(mockDbSupporter.findUnique).not.toHaveBeenCalled();
		});
	});

	describe('not found', () => {
		it('should return null when hash lookup finds nothing', async () => {
			const result = await findSupporterByEmail(ORG_ID, EMAIL);

			expect(result).toBeNull();
			expect(mockDbSupporter.findUnique).toHaveBeenCalledTimes(1);
		});
	});

	describe('select parameter', () => {
		it('should pass select to hash lookup', async () => {
			const select = { id: true, email: true } as const;
			mockDbSupporter.findUnique.mockResolvedValueOnce({ id: 'sup-001', email: EMAIL });

			await findSupporterByEmail(ORG_ID, EMAIL, select);

			expect(mockDbSupporter.findUnique).toHaveBeenCalledWith({
				where: { orgId_email_hash: { orgId: ORG_ID, email_hash: EMAIL_HASH } },
				select
			});
		});
	});

	describe('custom client parameter (for transactions)', () => {
		it('should use custom client instead of default db when provided', async () => {
			const txSupporter = { findUnique: vi.fn() };
			txSupporter.findUnique.mockResolvedValueOnce(SUPPORTER);

			const result = await findSupporterByEmail(ORG_ID, EMAIL, undefined, txSupporter);

			expect(result).toBe(SUPPORTER);
			expect(txSupporter.findUnique).toHaveBeenCalledWith({
				where: { orgId_email_hash: { orgId: ORG_ID, email_hash: EMAIL_HASH } }
			});
			// Default db should NOT have been called
			expect(mockDbSupporter.findUnique).not.toHaveBeenCalled();
		});
	});
});
