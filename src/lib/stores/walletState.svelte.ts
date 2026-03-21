/**
 * Wallet State Store — Svelte 5 runes
 *
 * Manages wallet connection state (EVM injected or NEAR-derived Scroll address).
 * Provides reactive state for balance display, connection flow, and chain/account
 * change handling.
 *
 * Pattern follows debateState.svelte.ts (factory function, exported singleton).
 */

import type { EVMWalletProvider } from '$lib/core/wallet/evm-provider';

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

/** Minimal user shape from page data — boolean flags only (PII stays server-side). */
export interface PageUser {
	hasWallet?: boolean;
}

export type WalletType = 'evm' | 'near';

export interface WalletState {
	connected: boolean;
	address: string | null;
	chainId: number | null;
	balance: string | null;
	balanceRaw: bigint | null;
	walletType: WalletType | null;
	connecting: boolean;
	error: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// STORE
// ═══════════════════════════════════════════════════════════════════════════

function createWalletState() {
	let connected = $state(false);
	let address = $state<string | null>(null);
	let chainId = $state<number | null>(null);
	let balance = $state<string | null>(null);
	let balanceRaw = $state<bigint | null>(null);
	let walletType = $state<WalletType | null>(null);
	let connecting = $state(false);
	let error = $state<string | null>(null);

	// Internal: hold reference to EVM provider for event cleanup
	let evmProvider = $state<EVMWalletProvider | null>(null);
	let eventCleanup: (() => void) | null = null;

	/** Reset all state to disconnected defaults. */
	function resetState() {
		connected = false;
		address = null;
		chainId = null;
		balance = null;
		balanceRaw = null;
		walletType = null;
		connecting = false;
		error = null;
		evmProvider = null;
		if (eventCleanup) {
			eventCleanup();
			eventCleanup = null;
		}
	}

	return {
		// ── Getters ──────────────────────────────────────────────────────
		get connected() {
			return connected;
		},
		get address() {
			return address;
		},
		get chainId() {
			return chainId;
		},
		get balance() {
			return balance;
		},
		get balanceRaw() {
			return balanceRaw;
		},
		get walletType() {
			return walletType;
		},
		get connecting() {
			return connecting;
		},
		get error() {
			return error;
		},

		// ── Derived ──────────────────────────────────────────────────────
		get isEVM() {
			return walletType === 'evm';
		},
		get isNEAR() {
			return walletType === 'near';
		},
		/** Truncated address for display (0x1234...abcd) */
		get displayAddress(): string | null {
			if (!address) return null;
			if (address.length <= 12) return address;
			return `${address.slice(0, 6)}...${address.slice(-4)}`;
		},

		// ── Internal provider access (for signing operations) ────────────
		get provider() {
			return evmProvider;
		},

		// ── Actions ──────────────────────────────────────────────────────

		/**
		 * Initialize wallet state from server-provided page data.
		 * Layout provides boolean `hasWallet` flag only (addresses are PII).
		 * When hasWallet is true, fetches actual wallet details from /api/wallet/status.
		 */
		initFromPageData(user: PageUser | null) {
			if (!user || !user.hasWallet) {
				resetState();
				return;
			}

			// User has a wallet — fetch details from authenticated API
			if (typeof globalThis.fetch === 'function') {
				globalThis.fetch('/api/wallet/status')
					.then((res) => {
						if (!res.ok) {
							resetState();
							return null;
						}
						return res.json();
					})
					.then((data: { wallet_address?: string; wallet_type?: string; near_derived_scroll_address?: string } | null) => {
						if (!data) return;

						if (data.wallet_address && data.wallet_type === 'evm') {
							connected = true;
							address = data.wallet_address;
							walletType = 'evm';
							error = null;
						} else if (data.near_derived_scroll_address && !data.wallet_address) {
							connected = true;
							address = data.near_derived_scroll_address;
							walletType = 'near';
							error = null;
						} else {
							resetState();
						}
					})
					.catch(() => {
						resetState();
					});
			}
		},

		/**
		 * Connect to the user's injected EVM wallet (MetaMask, Coinbase, etc.)
		 * Triggers the wallet popup for account access.
		 */
		async connectEVM(): Promise<void> {
			if (typeof window === 'undefined') return;

			connecting = true;
			error = null;

			try {
				// Dynamic import avoids SSR failures — evm-provider uses window.ethereum
				const { connectInjectedWallet, subscribeToWalletEvents } = await import(
					'$lib/core/wallet/evm-provider'
				);

				const provider = await connectInjectedWallet();
				let providerChainId = await provider.getChainId();

				// Switch to Scroll Sepolia if on wrong chain
				if (providerChainId !== 534351) {
					const { switchToScrollSepolia } = await import(
						'$lib/core/wallet/evm-provider'
					);
					await switchToScrollSepolia(provider.eip1193Provider);
					providerChainId = await provider.getChainId();
				}

				// Success — update all state
				evmProvider = provider;
				connected = true;
				address = provider.address;
				walletType = 'evm';
				chainId = providerChainId;
				error = null;

				// Subscribe to wallet events (account switch, chain switch, disconnect)
				if (eventCleanup) eventCleanup();
				eventCleanup = subscribeToWalletEvents(provider.eip1193Provider, {
					onAccountsChanged: (accounts: string[]) => {
						if (accounts.length === 0) {
							resetState();
						} else {
							this.handleAccountChanged(accounts[0]);
						}
					},
					onChainChanged: (newChainId: number) => {
						this.handleChainChanged(newChainId);
					},
					onDisconnect: () => {
						resetState();
					}
				});

				// Fetch balance after connection
				await this.refreshBalance();
			} catch (err) {
				const message =
					err instanceof Error ? err.message : 'Failed to connect wallet';
				error = message;
				connected = false;
				address = null;
				walletType = null;
				chainId = null;
				evmProvider = null;
			} finally {
				connecting = false;
			}
		},

		/**
		 * Fetch current token balance from the server.
		 * Updates both the formatted balance string and raw bigint value.
		 */
		async refreshBalance(): Promise<void> {
			if (!connected || !address) return;

			try {
				const res = await fetch(
					`/api/wallet/balance?address=${encodeURIComponent(address)}`
				);
				if (!res.ok) {
					console.warn(
						`[wallet-state] Balance fetch failed (${res.status})`
					);
					return;
				}

				const data = await res.json();
				balance = data.formatted ?? null;
				balanceRaw =
					data.balance != null ? BigInt(data.balance) : null;
			} catch (err) {
				console.warn('[wallet-state] Balance fetch error:', err);
				// Non-fatal — leave existing balance in place
			}
		},

		/**
		 * Disconnect the wallet and reset all state.
		 * Notifies the server to unbind the wallet (best-effort),
		 * then clears client state regardless of server result.
		 */
		async disconnect(): Promise<void> {
			// Notify server to unbind wallet
			try {
				const res = await fetch('/api/wallet/disconnect', { method: 'DELETE' });
				if (!res.ok) {
					const data = await res.json().catch(() => ({}));
					console.warn(
						'[wallet-state] Server disconnect failed:',
						(data as { error?: string }).error
					);
				}
			} catch (err) {
				console.warn('[wallet-state] Server disconnect error:', err);
			}

			// Always clear client state regardless of server result
			resetState();
		},

		/**
		 * Handle a chain change event from the wallet provider.
		 * Updates chainId; balance is chain-dependent so refresh it.
		 */
		handleChainChanged(newChainId: number) {
			chainId = newChainId;
		},

		/**
		 * Handle an account change event from the wallet provider.
		 * Updates address and refreshes balance for the new account.
		 */
		handleAccountChanged(newAddress: string) {
			address = newAddress;
			this.refreshBalance();
		}
	};
}

export const walletState = createWalletState();
