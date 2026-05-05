import { describe, expect, it } from 'vitest';
import {
	computePRFSaltId,
	decryptGroundVaultPayload,
	encodeGroundVaultAAD,
	encryptGroundVaultPayload,
	generateGroundVaultDEK,
	generateGroundVaultPRFSalt,
	GROUND_VAULT_HKDF_INFO,
	unwrapGroundVaultDEK,
	wrapGroundVaultDEK
} from '$lib/core/identity/ground-vault-crypto';

describe('ground vault crypto', () => {
	it('encrypts and decrypts a normalized address with authenticated metadata', async () => {
		const dek = generateGroundVaultDEK();
		const aad = encodeGroundVaultAAD({
			userId: 'user_123'
		});
		const payload = {
			address: {
				street: '123 Main St',
				city: 'San Francisco',
				state: 'CA',
				zip: '94102'
			},
			district: 'CA-11',
			cellId: '872830828ffffff',
			normalizedAt: '2026-05-01T00:00:00.000Z'
		};

		const encrypted = await encryptGroundVaultPayload(payload, dek, aad);
		const decrypted = await decryptGroundVaultPayload(encrypted, dek);

		expect(decrypted).toEqual(payload);
		expect(encrypted.aeadAssociatedData).toBe(aad);
		expect(encrypted.associatedDataHash).toMatch(/^[A-Za-z0-9_-]+$/);
	});

	it('rejects decryption when associated data changes', async () => {
		const dek = generateGroundVaultDEK();
		const encrypted = await encryptGroundVaultPayload(
			{
				address: { street: '123 Main St', city: 'SF', state: 'CA', zip: '94102' },
				normalizedAt: '2026-05-01T00:00:00.000Z'
			},
			dek,
			encodeGroundVaultAAD({
				userId: 'user_123'
			})
		);

		await expect(
			decryptGroundVaultPayload(
				{
					...encrypted,
					aeadAssociatedData: encodeGroundVaultAAD({
						userId: 'different_user'
					})
				},
				dek
			)
		).rejects.toThrow();
	});

	it('does not bind ciphertext readability to rotating district credentials', () => {
		expect(
			encodeGroundVaultAAD({
				userId: 'user_123'
			})
		).toBe(
			encodeGroundVaultAAD({
				userId: 'user_123'
			})
		);
	});

	it('wraps and unwraps the vault DEK with PRF-derived key material', async () => {
		const dek = generateGroundVaultDEK();
		const prfOutput = new Uint8Array(32);
		prfOutput.fill(7);

		const wrapped = await wrapGroundVaultDEK(dek, prfOutput);
		const unwrapped = await unwrapGroundVaultDEK(wrapped, prfOutput);

		expect([...unwrapped]).toEqual([...dek]);
		expect(wrapped).toMatch(/^[A-Za-z0-9_-]+$/);
		expect(GROUND_VAULT_HKDF_INFO).toContain('ground-vault');
	});

	it('computes stable non-secret PRF salt ids', async () => {
		const salt = generateGroundVaultPRFSalt();

		await expect(computePRFSaltId(salt)).resolves.toBe(await computePRFSaltId(salt));
		await expect(computePRFSaltId(new Uint8Array(31))).rejects.toThrow('PRF salt');
	});
});
