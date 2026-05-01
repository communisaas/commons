import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/svelte';
import GroundCard from '$lib/components/profile/GroundCard.svelte';

vi.mock('$lib/core/identity/constituent-address', () => ({
	getConstituentAddress: vi.fn()
}));

vi.mock('$lib/core/identity/session-credentials', () => ({
	getSessionCredential: vi.fn()
}));

vi.mock('$lib/core/identity/recovery-detector', () => ({
	needsCredentialRecovery: vi.fn()
}));

describe('GroundCard', () => {
	beforeEach(async () => {
		vi.clearAllMocks();
		const { getConstituentAddress } = await import('$lib/core/identity/constituent-address');
		const { getSessionCredential } = await import('$lib/core/identity/session-credentials');
		const { needsCredentialRecovery } = await import('$lib/core/identity/recovery-detector');
		(getConstituentAddress as Mock).mockResolvedValue(null);
		(getSessionCredential as Mock).mockResolvedValue(null);
		(needsCredentialRecovery as Mock).mockResolvedValue(false);
	});

	it('shows a change-address affordance for a server-verified address even when the local address cache is missing', async () => {
		const onChangeAddress = vi.fn();
		const { getByTestId, getByText } = render(GroundCard, {
			props: {
				userId: 'user_123',
				trustTier: 2,
				serverAddressVerified: true,
				embedded: true,
				onChangeAddress
			}
		});

		await waitFor(() => {
			expect(getByText(/address verified/i)).toBeTruthy();
		});

		await fireEvent.click(getByTestId('ground-i-moved'));
		expect(onChangeAddress).toHaveBeenCalledTimes(1);
	});
});
