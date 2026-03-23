/**
 * Tests for findSupporterByEmail helper (S-6)
 *
 * Verifies email_hash-first lookup with plaintext fallback.
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
	describe('email_hash primary lookup', () => {
		it('should find supporter by orgId + email_hash', async () => {
			mockDbSupporter.findUnique.mockResolvedValueOnce(SUPPORTER);

			const result = await findSupporterByEmail(ORG_ID, EMAIL);

			expect(result).toBe(SUPPORTER);
			expect(mockDbSupporter.findUnique).toHaveBeenCalledWith({
				where: { orgId_email_hash: { orgId: ORG_ID, email_hash: EMAIL_HASH } }
			});
			// Should NOT fall back to plaintext
			expect(mockDbSupporter.findUnique).toHaveBeenCalledTimes(1);
		});

		it('should normalize email before hashing', async () => {
			mockDbSupporter.findUnique.mockResolvedValueOnce(SUPPORTER);

			await findSupporterByEmail(ORG_ID, '  ALICE@Example.COM  ');

			expect(mockComputeEmailHash).toHaveBeenCalledWith('alice@example.com');
		});
	});

	describe('plaintext fallback', () => {
		it('should fall back to orgId_email when hash lookup returns null', async () => {
			mockDbSupporter.findUnique
				.mockResolvedValueOnce(null) // hash lookup
				.mockResolvedValueOnce(SUPPORTER); // plaintext lookup

			const result = await findSupporterByEmail(ORG_ID, EMAIL);

			expect(result).toBe(SUPPORTER);
			expect(mockDbSupporter.findUnique).toHaveBeenCalledTimes(2);
			expect(mockDbSupporter.findUnique).toHaveBeenNthCalledWith(2, {
				where: { orgId_email: { orgId: ORG_ID, email: 'alice@example.com' } }
			});
		});

		it('should skip hash lookup when computeEmailHash returns null', async () => {
			mockComputeEmailHash.mockResolvedValue(null);
			mockDbSupporter.findUnique.mockResolvedValueOnce(SUPPORTER);

			const result = await findSupporterByEmail(ORG_ID, EMAIL);

			expect(result).toBe(SUPPORTER);
			// Only plaintext lookup, no hash lookup
			expect(mockDbSupporter.findUnique).toHaveBeenCalledTimes(1);
			expect(mockDbSupporter.findUnique).toHaveBeenCalledWith({
				where: { orgId_email: { orgId: ORG_ID, email: 'alice@example.com' } }
			});
		});
	});

	describe('not found', () => {
		it('should return null when neither lookup finds a supporter', async () => {
			const result = await findSupporterByEmail(ORG_ID, EMAIL);

			expect(result).toBeNull();
			expect(mockDbSupporter.findUnique).toHaveBeenCalledTimes(2);
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

		it('should pass select to plaintext fallback', async () => {
			const select = { id: true } as const;
			mockDbSupporter.findUnique
				.mockResolvedValueOnce(null)
				.mockResolvedValueOnce({ id: 'sup-001' });

			await findSupporterByEmail(ORG_ID, EMAIL, select);

			expect(mockDbSupporter.findUnique).toHaveBeenNthCalledWith(2, {
				where: { orgId_email: { orgId: ORG_ID, email: 'alice@example.com' } },
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

		it('should fall back to plaintext on custom client', async () => {
			const txSupporter = { findUnique: vi.fn() };
			txSupporter.findUnique
				.mockResolvedValueOnce(null)
				.mockResolvedValueOnce(SUPPORTER);

			const result = await findSupporterByEmail(ORG_ID, EMAIL, undefined, txSupporter);

			expect(result).toBe(SUPPORTER);
			expect(txSupporter.findUnique).toHaveBeenCalledTimes(2);
			expect(mockDbSupporter.findUnique).not.toHaveBeenCalled();
		});
	});
});
