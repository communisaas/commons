/**
 * Unit tests for passkey settings loader and management endpoint.
 *
 * Current API shape:
 * - The security page reads passkey state from Convex users.getProfile.
 * - The DELETE endpoint clears passkeys through Convex users.clearPasskey.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type SecuritySettingsLoadData = {
	passkey: {
		createdAt: string | null;
		lastUsedAt: string | null;
	} | null;
};

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockServerQuery, mockServerMutation, mockApi } = vi.hoisted(() => ({
	mockServerQuery: vi.fn(),
	mockServerMutation: vi.fn(),
	mockApi: {
		users: {
			getProfile: 'users:getProfile',
			clearPasskey: 'users:clearPasskey'
		}
	}
}));

vi.mock('convex-sveltekit', () => ({
	serverQuery: (...args: unknown[]) => mockServerQuery(...args),
	serverMutation: (...args: unknown[]) => mockServerMutation(...args)
}));

vi.mock('$lib/convex', () => ({
	api: mockApi
}));

vi.mock('$convex/_generated/api', () => ({
	api: mockApi
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
	json: (data: unknown, init?: ResponseInit) => {
		mockJson(data, init);
		return new Response(JSON.stringify(data), {
			status: init?.status ?? 200,
			headers: { 'Content-Type': 'application/json' }
		});
	}
}));

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

		expect(mockServerQuery).not.toHaveBeenCalled();
	});

	it('returns null when Convex profile has no passkey', async () => {
		mockServerQuery.mockResolvedValue({ hasPasskey: false });

		const { load } = await import(
			'../../../src/routes/profile/security/+page.server'
		);

		const result = (await load({
			locals: { user: { id: 'user-123', email: 'test@example.com', name: 'Test' } }
		} as never)) as SecuritySettingsLoadData;

		expect(result.passkey).toBeNull();
		expect(mockServerQuery).toHaveBeenCalledWith(mockApi.users.getProfile, {});
	});

	it('returns passkey placeholder metadata when Convex profile has a passkey', async () => {
		mockServerQuery.mockResolvedValue({ hasPasskey: true });

		const { load } = await import(
			'../../../src/routes/profile/security/+page.server'
		);

		const result = (await load({
			locals: { user: { id: 'user-456', email: 'test@example.com', name: 'Test' } }
		} as never)) as SecuritySettingsLoadData;

		expect(result.passkey).toEqual({
			createdAt: null,
			lastUsedAt: null
		});
	});

	it('returns null when Convex profile is missing', async () => {
		mockServerQuery.mockResolvedValue(null);

		const { load } = await import(
			'../../../src/routes/profile/security/+page.server'
		);

		const result = (await load({
			locals: { user: { id: 'nonexistent', email: 'test@example.com', name: 'Test' } }
		} as never)) as SecuritySettingsLoadData;

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

		expect(mockServerMutation).not.toHaveBeenCalled();
	});

	it('returns 404 when no passkey is registered', async () => {
		mockServerMutation.mockRejectedValue(new Error('No passkey registered'));

		const { DELETE } = await import(
			'../../../src/routes/api/auth/passkey/+server'
		);

		await expect(
			DELETE({
				locals: { user: { id: 'user-123' } }
			} as never)
		).rejects.toMatchObject({ status: 404 });
	});

	it('clears passkey state through Convex on successful delete', async () => {
		mockServerMutation.mockResolvedValue(null);

		const { DELETE } = await import(
			'../../../src/routes/api/auth/passkey/+server'
		);

		const response = await DELETE({
			locals: { user: { id: 'user-123' } }
		} as never);

		expect(response).toBeInstanceOf(Response);
		await expect(response.json()).resolves.toEqual({ success: true });
		expect(mockServerMutation).toHaveBeenCalledWith(mockApi.users.clearPasskey, {
			userId: 'user-123'
		});
	});

	it('maps unexpected Convex failures to 500', async () => {
		mockServerMutation.mockRejectedValue(new Error('Convex unavailable'));

		const { DELETE } = await import(
			'../../../src/routes/api/auth/passkey/+server'
		);

		await expect(
			DELETE({
				locals: { user: { id: 'user-123' } }
			} as never)
		).rejects.toMatchObject({ status: 500 });
	});
});
