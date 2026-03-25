/**
 * Unit tests for Passkey Settings Page + Management API
 *
 * Tests:
 *   - Security page server loader: auth requirement, passkey data shape
 *   - Passkey DELETE endpoint: auth requirement, clears all passkey fields
 *   - Edge cases: no passkey registered, unauthenticated access
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mockDbUser = vi.hoisted(() => ({
	findUnique: vi.fn(),
	update: vi.fn()
}));

const mockDb = vi.hoisted(() => ({
	user: mockDbUser
}));

vi.mock('$lib/core/db', () => ({
	db: mockDb
}));

// Mock SvelteKit
const mockRedirect = vi.hoisted(() => vi.fn());
const mockError = vi.hoisted(() => vi.fn());
const mockJson = vi.hoisted(() => vi.fn());

vi.mock('@sveltejs/kit', () => ({
	redirect: (...args: unknown[]) => {
		mockRedirect(...args);
		throw { status: args[0], location: args[1] };
	},
	error: (...args: unknown[]) => {
		mockError(...args);
		throw { status: args[0], body: { message: args[1] } };
	},
	json: (data: unknown) => {
		mockJson(data);
		return new Response(JSON.stringify(data), {
			headers: { 'Content-Type': 'application/json' }
		});
	}
}));

// ---------------------------------------------------------------------------
// Test imports (after mocks)
// ---------------------------------------------------------------------------

// We test the loader and endpoint logic by importing after mocks
// Note: SvelteKit route modules need careful import handling

describe('Security Settings Page Loader', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('redirects unauthenticated users to home', async () => {
		const { load } = await import(
			'../../../src/routes/profile/security/+page.server'
		);

		await expect(
			load({
				locals: { user: null }
			} as never)
		).rejects.toMatchObject({ status: 302, location: '/' });
	});

	it('returns null when user has no passkey', async () => {
		mockDbUser.findUnique.mockResolvedValue({
			passkey_credential_id: null,
			passkey_created_at: null,
			passkey_last_used_at: null
		});

		const { load } = await import(
			'../../../src/routes/profile/security/+page.server'
		);

		const result = await load({
			locals: { user: { id: 'user-123', email: 'test@example.com', name: 'Test' } }
		} as never);

		expect(result.passkey).toBeNull();
		expect(mockDbUser.findUnique).toHaveBeenCalledWith({
			where: { id: 'user-123' },
			select: {
				passkey_credential_id: true,
				passkey_created_at: true,
				passkey_last_used_at: true
			}
		});
	});

	it('returns passkey data when user has a registered passkey', async () => {
		const createdAt = new Date('2026-03-20T10:00:00Z');
		const lastUsed = new Date('2026-03-22T14:30:00Z');

		mockDbUser.findUnique.mockResolvedValue({
			passkey_credential_id: 'cred-abc123',
			passkey_created_at: createdAt,
			passkey_last_used_at: lastUsed
		});

		const { load } = await import(
			'../../../src/routes/profile/security/+page.server'
		);

		const result = await load({
			locals: { user: { id: 'user-456', email: 'test@example.com', name: 'Test' } }
		} as never);

		expect(result.passkey).not.toBeNull();
		expect(result.passkey!.createdAt).toBe(createdAt.toISOString());
		expect(result.passkey!.lastUsedAt).toBe(lastUsed.toISOString());
	});

	it('handles passkey without last_used_at', async () => {
		mockDbUser.findUnique.mockResolvedValue({
			passkey_credential_id: 'cred-abc123',
			passkey_created_at: new Date('2026-03-20T10:00:00Z'),
			passkey_last_used_at: null
		});

		const { load } = await import(
			'../../../src/routes/profile/security/+page.server'
		);

		const result = await load({
			locals: { user: { id: 'user-789', email: 'test@example.com', name: 'Test' } }
		} as never);

		expect(result.passkey).not.toBeNull();
		expect(result.passkey!.lastUsedAt).toBeNull();
	});

	it('returns null when user record not found', async () => {
		mockDbUser.findUnique.mockResolvedValue(null);

		const { load } = await import(
			'../../../src/routes/profile/security/+page.server'
		);

		const result = await load({
			locals: { user: { id: 'nonexistent', email: 'test@example.com', name: 'Test' } }
		} as never);

		expect(result.passkey).toBeNull();
	});
});

describe('Passkey DELETE Endpoint', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('rejects unauthenticated requests', async () => {
		const { DELETE } = await import(
			'../../../src/routes/api/auth/passkey/+server'
		);

		await expect(
			DELETE({
				locals: { user: null }
			} as never)
		).rejects.toMatchObject({ status: 401 });
	});

	it('returns 404 when no passkey is registered', async () => {
		mockDbUser.findUnique.mockResolvedValue({
			passkey_credential_id: null
		});

		const { DELETE } = await import(
			'../../../src/routes/api/auth/passkey/+server'
		);

		await expect(
			DELETE({
				locals: { user: { id: 'user-123' } }
			} as never)
		).rejects.toMatchObject({ status: 404 });
	});

	it('clears all passkey fields on successful delete', async () => {
		mockDbUser.findUnique.mockResolvedValue({
			passkey_credential_id: 'cred-abc123'
		});
		mockDbUser.update.mockResolvedValue({});

		const { DELETE } = await import(
			'../../../src/routes/api/auth/passkey/+server'
		);

		const response = await DELETE({
			locals: { user: { id: 'user-123' } }
		} as never);

		expect(response).toBeInstanceOf(Response);
		const body = await response.json();
		expect(body.success).toBe(true);

		expect(mockDbUser.update).toHaveBeenCalledWith({
			where: { id: 'user-123' },
			data: {
				passkey_credential_id: null,
				passkey_public_key_jwk: null,
				passkey_created_at: null,
				passkey_last_used_at: null,
				did_key: null
			}
		});
	});
});
