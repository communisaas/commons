import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/core/identity/constituent-address', () => ({
	getConstituentAddress: vi.fn()
}));

vi.mock('$lib/core/identity/ground-vault-unlock', () => ({
	requestCurrentPasskeyPRF: vi.fn()
}));

import { getConstituentAddress } from '$lib/core/identity/constituent-address';
import { requestCurrentPasskeyPRF } from '$lib/core/identity/ground-vault-unlock';
import { backfillActiveGroundVaultPasskeyWrapper } from '$lib/core/identity/ground-vault-persistence';

const activeGroundState = {
	vault: {
		_id: 'ground_vault_123',
		status: 'active'
	},
	cell: {
		cellId: '872830828ffffff',
		h3Cell: '872830828ffffff',
		districts: ['CA-11']
	},
	wrappers: []
};

function jsonResponse(body: unknown, ok = true): Response {
	return {
		ok,
		json: vi.fn().mockResolvedValue(body)
	} as unknown as Response;
}

describe('backfillActiveGroundVaultPasskeyWrapper', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.stubGlobal('navigator', { credentials: {} });
		vi.spyOn(console, 'warn').mockImplementation(() => undefined);
	});

	it('re-encrypts the active vault from the local address cache and posts a PRF wrapper', async () => {
		vi.mocked(getConstituentAddress).mockResolvedValue({
			street: '123 Main St',
			city: 'San Francisco',
			state: 'ca',
			zip: '94102',
			district: 'CA-11'
		});
		vi.mocked(requestCurrentPasskeyPRF).mockResolvedValue({
			prfOutput: new Uint8Array(32).fill(7).buffer,
			credentialId: 'cred_123'
		});

		const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
			if (url === '/api/ground/state') return jsonResponse(activeGroundState);
			if (url === '/api/ground/wrapper') {
				const body = JSON.parse(String(init?.body));
				expect(body.groundVaultId).toBe('ground_vault_123');
				expect(body.vault.ciphertext).toMatch(/^[A-Za-z0-9_-]+$/);
				expect(body.vault.nonce).toMatch(/^[A-Za-z0-9_-]+$/);
				expect(body.vault.aeadAssociatedData).toContain('user_123');
				expect(body.wrapper.passkeyCredentialId).toBe('cred_123');
				expect(body.wrapper.wrappedDek).toMatch(/^[A-Za-z0-9_-]+$/);
				return jsonResponse({
					groundVaultId: 'ground_vault_123',
					passkeyVaultWrapperId: 'wrapper_123'
				});
			}
			throw new Error(`Unexpected fetch: ${url}`);
		});
		vi.stubGlobal('fetch', fetchMock);

		await expect(backfillActiveGroundVaultPasskeyWrapper({ userId: 'user_123' })).resolves.toEqual({
			status: 'wrapper-added',
			groundVaultId: 'ground_vault_123',
			passkeyVaultWrapperId: 'wrapper_123'
		});
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('leaves Option D available when no plaintext address is locally readable', async () => {
		vi.mocked(getConstituentAddress).mockResolvedValue(null);
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(activeGroundState)));

		await expect(backfillActiveGroundVaultPasskeyWrapper({ userId: 'user_123' })).resolves.toEqual({
			status: 'address-unavailable'
		});
		expect(requestCurrentPasskeyPRF).not.toHaveBeenCalled();
	});

	it('does not mutate the server when the passkey PRF ceremony is unavailable', async () => {
		vi.mocked(getConstituentAddress).mockResolvedValue({
			street: '123 Main St',
			city: 'San Francisco',
			state: 'CA',
			zip: '94102'
		});
		vi.mocked(requestCurrentPasskeyPRF).mockRejectedValue(new Error('Passkey unlock was cancelled.'));
		const fetchMock = vi.fn().mockResolvedValue(jsonResponse(activeGroundState));
		vi.stubGlobal('fetch', fetchMock);

		await expect(backfillActiveGroundVaultPasskeyWrapper({ userId: 'user_123' })).resolves.toEqual({
			status: 'wrapper-unavailable'
		});
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('does not assume an existing wrapper belongs to the newly registered passkey', async () => {
		vi.mocked(getConstituentAddress).mockResolvedValue({
			street: '123 Main St',
			city: 'San Francisco',
			state: 'CA',
			zip: '94102'
		});
		vi.mocked(requestCurrentPasskeyPRF).mockResolvedValue({
			prfOutput: new Uint8Array(32).fill(9).buffer,
			credentialId: 'new_cred_456'
		});

		const fetchMock = vi.fn(async (url: string) => {
			if (url === '/api/ground/state') {
				return jsonResponse({
					...activeGroundState,
					wrappers: [{ status: 'active', passkeyCredentialId: 'old_cred_123', wrappedDek: 'old' }]
				});
			}
			if (url === '/api/ground/wrapper') {
				return jsonResponse({
					status: 'wrapper-added',
					groundVaultId: 'ground_vault_123',
					passkeyVaultWrapperId: 'wrapper_456'
				});
			}
			throw new Error(`Unexpected fetch: ${url}`);
		});
		vi.stubGlobal('fetch', fetchMock);

		await expect(backfillActiveGroundVaultPasskeyWrapper({ userId: 'user_123' })).resolves.toEqual({
			status: 'wrapper-added',
			groundVaultId: 'ground_vault_123',
			passkeyVaultWrapperId: 'wrapper_456'
		});
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('does not overwrite the active vault from a local address for a different district', async () => {
		vi.mocked(getConstituentAddress).mockResolvedValue({
			street: '123 Main St',
			city: 'San Francisco',
			state: 'CA',
			zip: '94102',
			district: 'CA-12'
		});
		const fetchMock = vi.fn().mockResolvedValue(jsonResponse(activeGroundState));
		vi.stubGlobal('fetch', fetchMock);

		await expect(backfillActiveGroundVaultPasskeyWrapper({ userId: 'user_123' })).resolves.toEqual({
			status: 'address-unavailable'
		});
		expect(requestCurrentPasskeyPRF).not.toHaveBeenCalled();
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
});
