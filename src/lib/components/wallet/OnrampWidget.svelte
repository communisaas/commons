<!--
	OnrampWidget.svelte

	Fiat-to-USDC onramp via Transak's hosted widget (iframe embed).
	Configured for USDC on Scroll Sepolia (testnet) or Scroll (production).

	USDC is the correct target currency for all entry paths:
	  - USDC is the staking token for DebateMarket (approve + submitArgument).
	  - Gas (ETH) is sponsored via Pimlico paymaster for NEAR users (Path 1)
	    and is acquired separately by EVM users (Path 2).
	  - Do NOT change this to ETH without updating the staking flow.

	The iframe communicates back via window.postMessage. We listen for:
	  TRANSAK_ORDER_SUCCESSFUL — order completed, USDC on the way
	  TRANSAK_WIDGET_CLOSE    — user dismissed the widget

	ADDRESS SAFETY:
	  `walletAddress` must be a valid 0x EVM address (42 chars, hex).
	  For Path 1 (NEAR) users, this is `user.near_derived_scroll_address`.
	  For Path 2 (EVM) users, this is their MetaMask/injected address.
	  Both are resolved by `walletState.address` — callers should use that.
	  `disableWalletAddressForm: 'true'` prevents the user from changing the
	  target in the Transak UI, so a wrong address means lost funds.

	The Transak API key is a public key (safe to expose in browser).
	It is read from PUBLIC_TRANSAK_API_KEY, with a placeholder fallback.
-->

<script lang="ts">
	import { browser } from '$app/environment';
	import { env } from '$env/dynamic/public';

	// ── Props ─────────────────────────────────────────────────────────────────

	interface Props {
		walletAddress: string;
		defaultAmount?: number;
		onSuccess?: (data: { orderId: string; amount: number }) => void;
		onClose?: () => void;
	}

	let {
		walletAddress,
		defaultAmount = 20,
		onSuccess,
		onClose
	}: Props = $props();

	// ── Address validation ────────────────────────────────────────────────────
	// Guard against loading Transak with a bad address. Since
	// disableWalletAddressForm is true, the user cannot correct it in the UI.
	// For NEAR users (Path 1): walletState.address = user.near_derived_scroll_address
	// For EVM users (Path 2):  walletState.address = user.wallet_address (MetaMask)
	// Both must be valid 0x-prefixed, 42-char hex strings.

	const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
	const isValidAddress = $derived(
		!!walletAddress && ADDRESS_RE.test(walletAddress)
	);

	// ── State ─────────────────────────────────────────────────────────────────

	let iframeLoaded = $state(false);
	let visible = $state(true);
	let loadError = $state(false);

	// ── Transak configuration ─────────────────────────────────────────────────

	const apiKey = env.PUBLIC_TRANSAK_API_KEY || '';
	const hasValidApiKey = $derived(!!apiKey && apiKey !== 'TRANSAK_API_KEY_PLACEHOLDER');

	// Staging for testnet, production for mainnet
	const baseUrl = env.PUBLIC_TRANSAK_ENV === 'production'
		? 'https://global.transak.com/'
		: 'https://global-stg.transak.com/';

	const network = env.PUBLIC_TRANSAK_ENV === 'production' ? 'scroll' : 'scroll_sepolia';

	const widgetUrl = $derived(buildWidgetUrl());

	function buildWidgetUrl(): string {
		const params = new URLSearchParams({
			apiKey,
			// USDC is the DebateMarket staking token. Gas (ETH) is sponsored
			// via Pimlico paymaster for Path 1 users; Path 2 users bring their own.
			cryptoCurrencyCode: 'USDC',
			network,
			walletAddress,
			defaultFiatAmount: String(defaultAmount),
			fiatCurrency: 'USD',
			themeColor: '000000',
			hideMenu: 'true',
			// Locked: user cannot change the target address in Transak UI.
			// Relies on caller passing the correct address (walletState.address).
			disableWalletAddressForm: 'true'
		});

		return `${baseUrl}?${params.toString()}`;
	}

	// ── Transak postMessage listener ──────────────────────────────────────────

	const TRANSAK_ORIGINS = ['https://global.transak.com', 'https://global-stg.transak.com'];

	function handleMessage(event: MessageEvent) {
		// Only accept messages from exact Transak origins (not substring match)
		if (!TRANSAK_ORIGINS.includes(event.origin)) {
			return;
		}

		let data: { event_id?: string; data?: { id?: string; fiatAmount?: number; status?: string } };

		// Transak sends either a JSON string or a plain object
		if (typeof event.data === 'string') {
			try {
				data = JSON.parse(event.data);
			} catch {
				return;
			}
		} else {
			data = event.data;
		}

		if (!data?.event_id) return;

		switch (data.event_id) {
			case 'TRANSAK_ORDER_SUCCESSFUL':
				onSuccess?.({
					orderId: data.data?.id ?? 'unknown',
					amount: data.data?.fiatAmount ?? defaultAmount
				});
				break;

			case 'TRANSAK_WIDGET_CLOSE':
				handleClose();
				break;

			case 'TRANSAK_ORDER_FAILED':
				// Order failed but widget stays open; user can retry inside Transak
				console.warn('[OnrampWidget] Transak order failed:', data.data);
				break;
		}
	}

	// ── Lifecycle ─────────────────────────────────────────────────────────────

	$effect(() => {
		if (browser) {
			window.addEventListener('message', handleMessage);
			return () => window.removeEventListener('message', handleMessage);
		}
	});

	// ── Actions ───────────────────────────────────────────────────────────────

	function handleIframeLoad() {
		iframeLoaded = true;
		loadError = false;
	}

	function handleIframeError() {
		loadError = true;
		iframeLoaded = false;
	}

	function handleClose() {
		visible = false;
		onClose?.();
	}
</script>

{#if visible && hasValidApiKey}
	<div class="onramp" role="dialog" aria-label="Add funds with Transak">
		<!-- Header bar with close button -->
		<div class="onramp__header">
			<span class="onramp__title">Add Funds</span>
			<button
				type="button"
				class="onramp__close"
				onclick={handleClose}
				aria-label="Close onramp widget"
			>
				<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
					<path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
				</svg>
			</button>
		</div>

		<!-- Address validation error — prevents loading Transak with a bad target -->
		{#if !isValidAddress}
			<div class="onramp__error">
				<p class="onramp__error-text">
					{#if !walletAddress}
						No wallet address available. Connect a wallet first.
					{:else}
						Invalid wallet address. Expected a 0x Scroll address.
					{/if}
				</p>
			</div>
		{:else}
			<!-- Loading state -->
			{#if !iframeLoaded && !loadError}
				<div class="onramp__loading" role="status" aria-label="Loading payment widget">
					<div class="onramp__spinner"></div>
					<p class="onramp__loading-text">Loading payment widget...</p>
				</div>
			{/if}

			<!-- Error state -->
			{#if loadError}
				<div class="onramp__error">
					<p class="onramp__error-text">Failed to load payment widget.</p>
					<button
						type="button"
						class="onramp__retry"
						onclick={() => { loadError = false; iframeLoaded = false; }}
					>
						Try again
					</button>
				</div>
			{/if}

			<!-- Transak iframe — only rendered when address is valid -->
			{#if !loadError}
				<iframe
					src={widgetUrl}
					class="onramp__iframe"
					class:onramp__iframe--hidden={!iframeLoaded}
					title="Transak fiat onramp"
					allow="camera;microphone;fullscreen;payment"
					sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-popups-to-escape-sandbox"
					onload={handleIframeLoad}
					onerror={handleIframeError}
				></iframe>
			{/if}
		{/if}
	</div>
{/if}

<style>
	/* ── Container ─────────────────────────────────────────────────────────── */

	.onramp {
		position: relative;
		display: flex;
		flex-direction: column;
		border-radius: 12px;
		border: 1px solid oklch(0.85 0.02 250 / 0.6);
		background: oklch(0.99 0.005 250 / 0.95);
		overflow: hidden;

		/* Mobile: full width; Desktop: constrained */
		width: 100%;
		max-width: 480px;
		margin: 0 auto;
	}

	/* ── Header ────────────────────────────────────────────────────────────── */

	.onramp__header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 14px 16px;
		border-bottom: 1px solid oklch(0.85 0.02 250 / 0.6);
	}

	.onramp__title {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.9375rem;
		font-weight: 600;
		color: oklch(0.15 0.02 250);
	}

	.onramp__close {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		border-radius: 8px;
		border: none;
		background: transparent;
		color: oklch(0.45 0.02 250);
		cursor: pointer;
		transition:
			background 120ms ease-out,
			color 120ms ease-out;
	}

	.onramp__close:hover {
		background: oklch(0.93 0.02 250 / 0.7);
		color: oklch(0.25 0.02 250);
	}

	.onramp__close:focus-visible {
		outline: none;
		box-shadow: 0 0 0 2px oklch(0.6 0.15 270 / 0.5);
	}

	/* ── Loading state ─────────────────────────────────────────────────────── */

	.onramp__loading {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 48px 24px;
		gap: 16px;
	}

	.onramp__spinner {
		width: 28px;
		height: 28px;
		border: 2.5px solid oklch(0.88 0.01 250 / 0.6);
		border-top-color: oklch(0.5 0.18 260);
		border-radius: 50%;
		animation: onramp-spin 0.8s linear infinite;
	}

	.onramp__loading-text {
		margin: 0;
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.875rem;
		color: oklch(0.45 0.02 250);
	}

	@keyframes onramp-spin {
		to {
			transform: rotate(360deg);
		}
	}

	/* ── Error state ───────────────────────────────────────────────────────── */

	.onramp__error {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 48px 24px;
		gap: 12px;
	}

	.onramp__error-text {
		margin: 0;
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.875rem;
		color: oklch(0.5 0.2 25);
	}

	.onramp__retry {
		display: inline-flex;
		align-items: center;
		padding: 7px 14px;
		border-radius: 7px;
		border: 1px solid oklch(0.75 0.15 20 / 0.4);
		background: oklch(0.98 0.02 20 / 0.5);
		color: oklch(0.45 0.2 20);
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.8125rem;
		font-weight: 600;
		cursor: pointer;
		transition:
			background 120ms ease-out,
			border-color 120ms ease-out;
	}

	.onramp__retry:hover {
		background: oklch(0.94 0.04 20 / 0.6);
		border-color: oklch(0.65 0.2 20 / 0.5);
	}

	.onramp__retry:focus-visible {
		outline: none;
		box-shadow: 0 0 0 3px oklch(0.55 0.2 20 / 0.25);
	}

	/* ── Iframe ────────────────────────────────────────────────────────────── */

	.onramp__iframe {
		width: 100%;
		height: 600px;
		border: none;
		display: block;
	}

	.onramp__iframe--hidden {
		/* Keep in DOM for load event, but visually hidden */
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
	}

	/* ── Responsive ────────────────────────────────────────────────────────── */

	@media (max-width: 520px) {
		.onramp {
			max-width: 100%;
			border-radius: 0;
			border-left: none;
			border-right: none;
		}

		.onramp__iframe {
			height: 100vh;
			height: 100dvh;
			max-height: 700px;
		}
	}

	/* ── Reduced motion ────────────────────────────────────────────────────── */

	@media (prefers-reduced-motion: reduce) {
		.onramp__spinner {
			animation: none;
			opacity: 0.6;
		}

		.onramp__close,
		.onramp__retry {
			transition: none;
		}
	}
</style>
