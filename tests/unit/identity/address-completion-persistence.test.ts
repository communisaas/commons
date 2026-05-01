import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';

vi.mock('$lib/core/identity/constituent-address', () => ({
	storeConstituentAddress: vi.fn()
}));

import { storeConstituentAddress } from '$lib/core/identity/constituent-address';
import { persistAddressCompletion } from '$lib/core/identity/address-completion-persistence';

describe('persistAddressCompletion', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('stores the encrypted local address cache with a normalized district from representatives', async () => {
		await persistAddressCompletion('user_123', {
			streetAddress: '1 Apple Park Way',
			city: 'Cupertino',
			state: 'ca',
			zip: '95014',
			representatives: [
				{ name: 'Senator A', chamber: 'senate', state: 'CA', district: 'CA' },
				{ name: 'Representative B', chamber: 'house', state: 'CA', district: '17' }
			]
		});

		expect(storeConstituentAddress).toHaveBeenCalledWith('user_123', {
			street: '1 Apple Park Way',
			city: 'Cupertino',
			state: 'CA',
			zip: '95014',
			district: 'CA-17'
		});
	});

	it('prefers and normalizes the server-returned district override', async () => {
		await persistAddressCompletion(
			'user_123',
			{
				streetAddress: '123 Burnside Ave',
				city: 'Portland',
				state: 'OR',
				zip: '97214'
			},
			'OR-3'
		);

		expect(storeConstituentAddress).toHaveBeenCalledWith('user_123', {
			street: '123 Burnside Ave',
			city: 'Portland',
			state: 'OR',
			zip: '97214',
			district: 'OR-03'
		});
	});

	it('does not write an incomplete address cache', async () => {
		await persistAddressCompletion('user_123', {
			streetAddress: '123 Burnside Ave',
			city: '',
			state: 'OR',
			zip: '97214'
		});

		expect(storeConstituentAddress as Mock).not.toHaveBeenCalled();
	});
});
