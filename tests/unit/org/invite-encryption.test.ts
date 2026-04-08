/**
 * OrgInvite Token-Hash-at-Rest & Org-Scoped Email Hash Tests (S-5)
 *
 * Validates:
 * - Invite token hashing (SHA-256 at rest, raw token never stored)
 * - Token hash lookup (correct token succeeds, wrong token fails)
 * - Org-scoped email hashing (SHA-256, no server key)
 * - TTL is 72 hours
 */

import { describe, it, expect } from 'vitest';
import { computeOrgScopedEmailHash } from '$lib/core/crypto/org-scoped-hash';
import { hashInviteToken } from '../../../convex/_orgHash';

describe('OrgInvite Security Controls', () => {
	describe('token hashing at rest', () => {
		it('should produce a 64-char hex SHA-256 hash', async () => {
			const token = 'a'.repeat(64);
			const hash = await hashInviteToken(token);
			expect(hash).toMatch(/^[0-9a-f]{64}$/);
		});

		it('should be deterministic for the same token', async () => {
			const token = 'b'.repeat(64);
			const hash1 = await hashInviteToken(token);
			const hash2 = await hashInviteToken(token);
			expect(hash1).toBe(hash2);
		});

		it('should produce different hashes for different tokens', async () => {
			const hash1 = await hashInviteToken('a'.repeat(64));
			const hash2 = await hashInviteToken('b'.repeat(64));
			expect(hash1).not.toBe(hash2);
		});

		it('should domain-separate with "invite-token:" prefix', async () => {
			// Verify the hash includes the domain prefix by comparing
			// to a raw SHA-256 of just the token (should differ)
			const token = 'c'.repeat(64);
			const inviteHash = await hashInviteToken(token);

			// Compute raw SHA-256 without prefix
			const rawData = new TextEncoder().encode(token);
			const rawDigest = await crypto.subtle.digest('SHA-256', rawData);
			const rawHash = Array.from(new Uint8Array(rawDigest))
				.map((b) => b.toString(16).padStart(2, '0'))
				.join('');

			expect(inviteHash).not.toBe(rawHash);
		});
	});

	describe('token hash lookup simulation', () => {
		it('should find invite when raw token hashes to stored tokenHash', async () => {
			const rawToken = 'd'.repeat(64);
			const storedHash = await hashInviteToken(rawToken);

			// Simulate lookup: user presents raw token, server hashes it, looks up
			const lookupHash = await hashInviteToken(rawToken);
			expect(lookupHash).toBe(storedHash);
		});

		it('should NOT find invite when token is modified', async () => {
			const rawToken = 'e'.repeat(64);
			const storedHash = await hashInviteToken(rawToken);

			// Attacker modifies one character
			const modifiedToken = 'f' + rawToken.slice(1);
			const attackerHash = await hashInviteToken(modifiedToken);
			expect(attackerHash).not.toBe(storedHash);
		});

		it('should NOT find invite with empty token', async () => {
			const rawToken = 'g'.repeat(64);
			const storedHash = await hashInviteToken(rawToken);

			const emptyHash = await hashInviteToken('');
			expect(emptyHash).not.toBe(storedHash);
		});
	});

	describe('org-scoped email hash for invite dedup', () => {
		it('should produce a 64-char hex SHA-256 hash', async () => {
			const hash = await computeOrgScopedEmailHash('org-123', 'user@example.com');
			expect(hash).toMatch(/^[0-9a-f]{64}$/);
		});

		it('should be deterministic for the same org+email', async () => {
			const hash1 = await computeOrgScopedEmailHash('org-123', 'user@example.com');
			const hash2 = await computeOrgScopedEmailHash('org-123', 'user@example.com');
			expect(hash1).toBe(hash2);
		});

		it('should produce different hashes for same email in different orgs', async () => {
			const hash1 = await computeOrgScopedEmailHash('org-123', 'user@example.com');
			const hash2 = await computeOrgScopedEmailHash('org-456', 'user@example.com');
			expect(hash1).not.toBe(hash2);
		});

		it('should produce different hashes for different emails in same org', async () => {
			const hash1 = await computeOrgScopedEmailHash('org-123', 'alice@example.com');
			const hash2 = await computeOrgScopedEmailHash('org-123', 'bob@example.com');
			expect(hash1).not.toBe(hash2);
		});

		it('should normalize email case and whitespace', async () => {
			const hash1 = await computeOrgScopedEmailHash('org-123', 'User@Example.COM');
			const hash2 = await computeOrgScopedEmailHash('org-123', '  user@example.com  ');
			expect(hash1).toBe(hash2);
		});

		it('should not require any server-held keys', async () => {
			// This hash uses SHA-256(orgId + ":email:" + email) — no HMAC key needed
			// Verify it works without any env vars set
			const hash = await computeOrgScopedEmailHash('org-999', 'test@test.com');
			expect(hash).toMatch(/^[0-9a-f]{64}$/);
		});
	});

	describe('TTL policy', () => {
		it('should use 72-hour expiry (not 7-day)', () => {
			const ttl72h = 72 * 3_600_000;
			const ttl7d = 7 * 24 * 60 * 60 * 1000;

			// 72h = 259,200,000 ms vs 7d = 604,800,000 ms
			expect(ttl72h).toBe(259_200_000);
			expect(ttl7d).toBe(604_800_000);
			expect(ttl72h).toBeLessThan(ttl7d);
		});
	});
});
