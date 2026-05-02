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

	it('shows re-entry copy for a verified address that is not currently readable', async () => {
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
			expect(getByText(/address needs re-entry/i)).toBeTruthy();
		});

		await fireEvent.click(getByTestId('ground-i-moved'));
		expect(onChangeAddress).toHaveBeenCalledTimes(1);
	});

	it('does not throttle address re-entry when only the local readable ground is missing', async () => {
		const onRestoreAddress = vi.fn();
		const onChangeAddress = vi.fn();
		const { getByTestId, getByText } = render(GroundCard, {
			props: {
				userId: 'user_123',
				trustTier: 2,
				serverAddressVerified: true,
				embedded: true,
				budget: {
					tierBypass: false,
					nextAllowedAt: Date.now() + 23 * 60 * 60 * 1000,
					recentCount: 1,
					periodCap: 6,
					windowMs: 180 * 24 * 60 * 60 * 1000,
					emailSybilTripped: false
				},
				onRestoreAddress,
				onChangeAddress
			}
		});

		await waitFor(() => {
			expect(getByText(/address needs re-entry/i)).toBeTruthy();
		});

		const button = getByTestId('ground-i-moved') as HTMLButtonElement;
		expect(button.disabled).toBe(false);
		await fireEvent.click(button);
		expect(onRestoreAddress).toHaveBeenCalledTimes(1);
		expect(onChangeAddress).not.toHaveBeenCalled();
	});

	it('still throttles re-grounding when a readable address is already present', async () => {
		const { getConstituentAddress } = await import('$lib/core/identity/constituent-address');
		(getConstituentAddress as Mock).mockResolvedValue({
			street: '12 Mint Plaza',
			city: 'San Francisco',
			state: 'CA',
			zip: '94103',
			district: 'CA-11'
		});
		const onChangeAddress = vi.fn();
		const { getByTestId, getByText } = render(GroundCard, {
			props: {
				userId: 'user_123',
				trustTier: 2,
				serverAddressVerified: true,
				embedded: true,
				budget: {
					tierBypass: false,
					nextAllowedAt: Date.now() + 23 * 60 * 60 * 1000,
					recentCount: 1,
					periodCap: 6,
					windowMs: 180 * 24 * 60 * 60 * 1000,
					emailSybilTripped: false
				},
				onChangeAddress
			}
		});

		await waitFor(() => {
			expect(getByText(/12 Mint Plaza/i)).toBeTruthy();
		});
		expect(getByText(/address saved for official delivery/i)).toBeTruthy();

		const button = getByTestId('ground-i-moved') as HTMLButtonElement;
		expect(button.disabled).toBe(true);
		await fireEvent.click(button);
		expect(onChangeAddress).not.toHaveBeenCalled();
	});
});
