import { describe, it, expect, beforeEach, vi } from 'vitest';
import { walletState, type PageUser } from '$lib/stores/walletState.svelte';

type WalletStatusResponse = {
	wallet_address?: string;
	wallet_type?: string;
	near_derived_scroll_address?: string;
};

vi.mock('$lib/core/wallet/evm-provider', () => ({
	connectInjectedWallet: vi.fn().mockResolvedValue({
		address: '0xTEST_ADDRESS',
		eip1193Provider: {},
		getChainId: vi.fn().mockResolvedValue(534351)
	}),
	subscribeToWalletEvents: vi.fn().mockReturnValue(() => {})
}));

beforeEach(async () => {
	global.fetch = vi.fn().mockResolvedValue({
		ok: true,
		json: vi.fn().mockResolvedValue({})
	});
	await walletState.disconnect();
});

async function flushWalletStatus(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
}

async function initFromWalletStatus(data: WalletStatusResponse | null): Promise<void> {
	global.fetch = vi.fn().mockResolvedValue({
		ok: true,
		json: vi.fn().mockResolvedValue(data)
	});

	const user: PageUser = { hasWallet: true };
	walletState.initFromPageData(user);
	await flushWalletStatus();
}

// ═══════════════════════════════════════════════════════════════════════════
// initFromPageData
// ═══════════════════════════════════════════════════════════════════════════

describe('initFromPageData', () => {
	it('hydrates EVM user from wallet status', async () => {
		await initFromWalletStatus({
			wallet_address: '0xABCDEF1234567890abcdef1234567890ABCDEF12',
			wallet_type: 'evm'
		});

		expect(walletState.connected).toBe(true);
		expect(walletState.address).toBe('0xABCDEF1234567890abcdef1234567890ABCDEF12');
		expect(walletState.walletType).toBe('evm');
		expect(walletState.error).toBeNull();
		expect(global.fetch).toHaveBeenCalledWith('/api/wallet/status');
	});

	it('hydrates NEAR user from wallet status', async () => {
		await initFromWalletStatus({
			near_derived_scroll_address: '0xNEAR_DERIVED_0000000000000000000000001'
		});

		expect(walletState.connected).toBe(true);
		expect(walletState.address).toBe('0xNEAR_DERIVED_0000000000000000000000001');
		expect(walletState.walletType).toBe('near');
		expect(walletState.error).toBeNull();
	});

	it('does NOT set connected when wallet status is inconsistent', async () => {
		await initFromWalletStatus({
			wallet_address: '0x1234',
			wallet_type: 'near'
		});

		expect(walletState.connected).toBe(false);
		expect(walletState.address).toBeNull();
	});

	it('resets to disconnected state for null user', async () => {
		await initFromWalletStatus({
			wallet_address: '0xABC',
			wallet_type: 'evm'
		});
		expect(walletState.connected).toBe(true);

		walletState.initFromPageData(null);

		expect(walletState.connected).toBe(false);
		expect(walletState.address).toBeNull();
		expect(walletState.walletType).toBeNull();
		expect(walletState.chainId).toBeNull();
		expect(walletState.balance).toBeNull();
		expect(walletState.balanceRaw).toBeNull();
		expect(walletState.connecting).toBe(false);
		expect(walletState.error).toBeNull();
	});

	it('calling initFromPageData twice resets previous state', async () => {
		await initFromWalletStatus({
			wallet_address: '0xFIRST',
			wallet_type: 'evm'
		});
		expect(walletState.address).toBe('0xFIRST');
		expect(walletState.walletType).toBe('evm');

		await initFromWalletStatus({
			near_derived_scroll_address: '0xSECOND'
		});
		expect(walletState.address).toBe('0xSECOND');
		expect(walletState.walletType).toBe('near');
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// Derived getters
// ═══════════════════════════════════════════════════════════════════════════

describe('derived getters', () => {
	it('isEVM returns true only when walletType=evm', async () => {
		await initFromWalletStatus({ wallet_address: '0xABC', wallet_type: 'evm' });
		expect(walletState.isEVM).toBe(true);
		expect(walletState.isNEAR).toBe(false);
	});

	it('isNEAR returns true only when walletType=near', async () => {
		await initFromWalletStatus({ near_derived_scroll_address: '0xNEAR' });
		expect(walletState.isNEAR).toBe(true);
		expect(walletState.isEVM).toBe(false);
	});

	it('isEVM and isNEAR both false when disconnected', () => {
		expect(walletState.isEVM).toBe(false);
		expect(walletState.isNEAR).toBe(false);
	});

	it('displayAddress truncates long addresses', async () => {
		await initFromWalletStatus({
			wallet_address: '0x1234567890abcdef',
			wallet_type: 'evm'
		});
		expect(walletState.displayAddress).toBe('0x1234...cdef');
	});

	it('displayAddress returns null when no address', () => {
		expect(walletState.displayAddress).toBeNull();
	});

	it('displayAddress returns short addresses unchanged', async () => {
		await initFromWalletStatus({
			wallet_address: '0x12345678',
			wallet_type: 'evm'
		});
		// '0x12345678' is 10 chars, <= 12
		expect(walletState.displayAddress).toBe('0x12345678');
	});

	it('displayAddress returns 12-char address unchanged', async () => {
		await initFromWalletStatus({
			wallet_address: '0x1234567890',
			wallet_type: 'evm'
		});
		// '0x1234567890' is 12 chars, <= 12
		expect(walletState.displayAddress).toBe('0x1234567890');
	});

	it('displayAddress truncates 13-char address', async () => {
		await initFromWalletStatus({
			wallet_address: '0x12345678901',
			wallet_type: 'evm'
		});
		// '0x12345678901' is 13 chars, > 12
		expect(walletState.displayAddress).toBe('0x1234...8901');
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// disconnect
// ═══════════════════════════════════════════════════════════════════════════

describe('disconnect', () => {
	it('resets all state to defaults', async () => {
		await initFromWalletStatus({
			wallet_address: '0xABC',
			wallet_type: 'evm'
		});
		expect(walletState.connected).toBe(true);

		// disconnect() is async — it calls fetch('/api/wallet/disconnect') then resets state
		global.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: vi.fn().mockResolvedValue({})
		});

		await walletState.disconnect();

		expect(walletState.connected).toBe(false);
		expect(walletState.address).toBeNull();
		expect(walletState.chainId).toBeNull();
		expect(walletState.balance).toBeNull();
		expect(walletState.balanceRaw).toBeNull();
		expect(walletState.walletType).toBeNull();
		expect(walletState.connecting).toBe(false);
		expect(walletState.error).toBeNull();
		expect(walletState.provider).toBeNull();
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// refreshBalance
// ═══════════════════════════════════════════════════════════════════════════

describe('refreshBalance', () => {
	it('fetches and sets balance when connected', async () => {
		await initFromWalletStatus({
			wallet_address: '0xABCDEF1234567890abcdef1234567890ABCDEF12',
			wallet_type: 'evm'
		});

		global.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: vi.fn().mockResolvedValue({
				formatted: '10.50',
				balance: '10500000'
			})
		});

		await walletState.refreshBalance();

		expect(walletState.balance).toBe('10.50');
		expect(walletState.balanceRaw).toBe(10500000n);
		expect(global.fetch).toHaveBeenCalledWith(
			'/api/wallet/balance?address=0xABCDEF1234567890abcdef1234567890ABCDEF12'
		);
	});

	it('does not fetch when not connected', async () => {
		global.fetch = vi.fn();

		await walletState.refreshBalance();

		expect(global.fetch).not.toHaveBeenCalled();
	});

	it('does not throw when fetch returns ok: false', async () => {
		await initFromWalletStatus({
			wallet_address: '0xABC123',
			wallet_type: 'evm'
		});

		global.fetch = vi.fn().mockResolvedValue({
			ok: false,
			status: 500,
			json: vi.fn()
		});

		await expect(walletState.refreshBalance()).resolves.toBeUndefined();
		expect(walletState.balance).toBeNull();
	});

	it('does not throw when fetch rejects', async () => {
		await initFromWalletStatus({
			wallet_address: '0xABC123',
			wallet_type: 'evm'
		});

		global.fetch = vi.fn().mockRejectedValue(new Error('network error'));

		await expect(walletState.refreshBalance()).resolves.toBeUndefined();
		expect(walletState.balance).toBeNull();
	});

	it('preserves existing balance when fetch fails', async () => {
		await initFromWalletStatus({
			wallet_address: '0xABC123',
			wallet_type: 'evm'
		});

		// First successful fetch
		global.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: vi.fn().mockResolvedValue({
				formatted: '5.00',
				balance: '5000000'
			})
		});
		await walletState.refreshBalance();
		expect(walletState.balance).toBe('5.00');

		// Second fetch fails
		global.fetch = vi.fn().mockRejectedValue(new Error('timeout'));
		await walletState.refreshBalance();

		expect(walletState.balance).toBe('5.00');
		expect(walletState.balanceRaw).toBe(5000000n);
	});

	it('sets balanceRaw to null when response balance is null', async () => {
		await initFromWalletStatus({
			wallet_address: '0xABC123',
			wallet_type: 'evm'
		});

		global.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: vi.fn().mockResolvedValue({
				formatted: null,
				balance: null
			})
		});

		await walletState.refreshBalance();

		expect(walletState.balance).toBeNull();
		expect(walletState.balanceRaw).toBeNull();
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// handleChainChanged / handleAccountChanged
// ═══════════════════════════════════════════════════════════════════════════

describe('handleChainChanged', () => {
	it('sets chainId', () => {
		walletState.handleChainChanged(42);
		expect(walletState.chainId).toBe(42);
	});

	it('updates chainId on subsequent calls', () => {
		walletState.handleChainChanged(1);
		walletState.handleChainChanged(534351);
		expect(walletState.chainId).toBe(534351);
	});
});

describe('handleAccountChanged', () => {
	it('sets address and triggers refreshBalance', async () => {
		await initFromWalletStatus({
			wallet_address: '0xOLD',
			wallet_type: 'evm'
		});

		global.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: vi.fn().mockResolvedValue({
				formatted: '20.00',
				balance: '20000000'
			})
		});

		walletState.handleAccountChanged('0xNEW_ADDRESS');

		expect(walletState.address).toBe('0xNEW_ADDRESS');
		// refreshBalance is called (fire-and-forget), wait for it
		await vi.waitFor(() => {
			expect(global.fetch).toHaveBeenCalled();
		});
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// connectEVM
// ═══════════════════════════════════════════════════════════════════════════

describe('connectEVM', () => {
	it('returns immediately when window is undefined (SSR)', async () => {
		const originalWindow = globalThis.window;
		// @ts-expect-error — simulate SSR by deleting window
		delete globalThis.window;

		await walletState.connectEVM();

		expect(walletState.connected).toBe(false);
		expect(walletState.connecting).toBe(false);

		globalThis.window = originalWindow;
	});

	it('connects successfully and sets all state', async () => {
		const { connectInjectedWallet, subscribeToWalletEvents } = await import(
			'$lib/core/wallet/evm-provider'
		);

		// refreshBalance fetch
		global.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: vi.fn().mockResolvedValue({ formatted: '1.00', balance: '1000000' })
		});

		await walletState.connectEVM();

		expect(connectInjectedWallet).toHaveBeenCalled();
		expect(subscribeToWalletEvents).toHaveBeenCalled();
		expect(walletState.connected).toBe(true);
		expect(walletState.address).toBe('0xTEST_ADDRESS');
		expect(walletState.walletType).toBe('evm');
		expect(walletState.chainId).toBe(534351);
		expect(walletState.connecting).toBe(false);
		expect(walletState.error).toBeNull();
	});

	it('sets error and resets state on connection failure', async () => {
		const { connectInjectedWallet } = await import('$lib/core/wallet/evm-provider');
		vi.mocked(connectInjectedWallet).mockRejectedValueOnce(
			new Error('User rejected the request')
		);

		await walletState.connectEVM();

		expect(walletState.connected).toBe(false);
		expect(walletState.error).toBe('User rejected the request');
		expect(walletState.connecting).toBe(false);
		expect(walletState.address).toBeNull();
		expect(walletState.walletType).toBeNull();
		expect(walletState.chainId).toBeNull();
	});

	it('handles non-Error thrown values', async () => {
		const { connectInjectedWallet } = await import('$lib/core/wallet/evm-provider');
		vi.mocked(connectInjectedWallet).mockRejectedValueOnce('string error');

		await walletState.connectEVM();

		expect(walletState.connected).toBe(false);
		expect(walletState.error).toBe('Failed to connect wallet');
		expect(walletState.connecting).toBe(false);
	});
});
