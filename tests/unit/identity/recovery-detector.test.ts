import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

vi.mock('$lib/core/identity/session-credentials', () => ({
	getSessionCredential: vi.fn()
}));

const usableCredential = {
	userId: 'user-1',
	identityCommitment: '0x' + '1'.repeat(64),
	leafIndex: 1,
	merklePath: ['0x' + '2'.repeat(64)],
	merkleRoot: '0x' + '3'.repeat(64),
	congressionalDistrict: 'CA-12',
	credentialType: 'three-tree',
	cellId: '0x' + '4'.repeat(64),
	cellMapRoot: '0x' + '5'.repeat(64),
	cellMapPath: ['0x' + '6'.repeat(64)],
	cellMapPathBits: [0],
	districts: Array.from({ length: 24 }, (_, index) => '0x' + String(index + 1).padStart(64, '0')),
	districtCommitment: '0x' + '7'.repeat(64),
	userSecret: '0x' + '8'.repeat(64),
	registrationSalt: '0x' + '9'.repeat(64),
	authorityLevel: 5,
	verificationMethod: 'digital-credentials-api',
	createdAt: new Date(),
	expiresAt: new Date(Date.now() + 1000)
};

describe('needsCredentialRecovery', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('does not recover users below mDL tier', async () => {
		const { getSessionCredential } = await import('$lib/core/identity/session-credentials');
		const { needsCredentialRecovery } = await import('$lib/core/identity/recovery-detector');

		(getSessionCredential as Mock).mockResolvedValue(null);

		await expect(needsCredentialRecovery('user-1', 4)).resolves.toBe(false);
		expect(getSessionCredential).not.toHaveBeenCalled();
	});

	it('does not recover when a current local proof credential exists', async () => {
		const { getSessionCredential } = await import('$lib/core/identity/session-credentials');
		const { needsCredentialRecovery } = await import('$lib/core/identity/recovery-detector');

		(getSessionCredential as Mock).mockResolvedValue(usableCredential);

		await expect(needsCredentialRecovery('user-1', 5)).resolves.toBe(false);
	});

	it('requires recovery when the local credential is not proof-ready', async () => {
		const { getSessionCredential } = await import('$lib/core/identity/session-credentials');
		const { needsCredentialRecovery } = await import('$lib/core/identity/recovery-detector');

		(getSessionCredential as Mock).mockResolvedValue({
			...usableCredential,
			districtCommitment: undefined
		});

		await expect(needsCredentialRecovery('user-1', 5)).resolves.toBe(true);
	});

	it('requires recovery when the local proof credential is under-authorized', async () => {
		const { getSessionCredential } = await import('$lib/core/identity/session-credentials');
		const { needsCredentialRecovery } = await import('$lib/core/identity/recovery-detector');

		(getSessionCredential as Mock).mockResolvedValue({
			...usableCredential,
			authorityLevel: 4
		});

		await expect(needsCredentialRecovery('user-1', 5)).resolves.toBe(true);
	});

	it('requires recovery when the local credential was not issued by the Digital Credentials flow', async () => {
		const { getSessionCredential } = await import('$lib/core/identity/session-credentials');
		const { needsCredentialRecovery } = await import('$lib/core/identity/recovery-detector');

		(getSessionCredential as Mock).mockResolvedValue({
			...usableCredential,
			verificationMethod: 'self.xyz'
		});

		await expect(needsCredentialRecovery('user-1', 5)).resolves.toBe(true);
	});

	it('requires recovery when tier 5 has no current local proof credential', async () => {
		const { getSessionCredential } = await import('$lib/core/identity/session-credentials');
		const { needsCredentialRecovery } = await import('$lib/core/identity/recovery-detector');

		(getSessionCredential as Mock).mockResolvedValue(null);

		await expect(needsCredentialRecovery('user-1', 5)).resolves.toBe(true);
	});
});
