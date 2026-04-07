<!--
	BalanceDisplay.svelte

	Displays an EVM address's USDC balance as a formatted dollar amount.
	Fetches from /api/wallet/balance and auto-refreshes on a 30-second interval.

	Two variants:
	  compact  — inline pill for header use, shows "$20.00" only
	  full     — card with balance + optional "Add Funds" button

	No direct chain calls: delegates to the server-side balance endpoint
	which reads from Scroll via ethers. This keeps the client bundle free
	of ethers and avoids CORS / RPC key exposure.
-->

<script lang="ts">
	import { onDestroy } from 'svelte';

	// ── Props ─────────────────────────────────────────────────────────────────

	interface Props {
		address: string | null;
		compact?: boolean;
		refreshInterval?: number;
		onAddFunds?: () => void;
	}

	let {
		address,
		compact = false,
		refreshInterval = 30_000,
		onAddFunds
	}: Props = $props();

	// ── State ─────────────────────────────────────────────────────────────────

	let balance = $state<string | null>(null);
	let loading = $state(true);
	let error = $state<string | null>(null);

	// ── Derived display values ────────────────────────────────────────────────

	const displayBalance = $derived(
		balance != null ? `$${balance}` : '--'
	);

	const isZero = $derived(
		balance != null && parseFloat(balance) === 0
	);

	const hasBalance = $derived(
		balance != null && parseFloat(balance) > 0
	);

	// ── Balance fetching ──────────────────────────────────────────────────────

	async function fetchBalance() {
		if (!address) {
			balance = null;
			loading = false;
			error = null;
			return;
		}

		try {
			const res = await fetch(`/api/wallet/balance?address=${encodeURIComponent(address)}`);

			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				throw new Error((body as { error?: string }).error || `HTTP ${res.status}`);
			}

			const data = (await res.json()) as { formatted: string };
			balance = data.formatted;
			error = null;
		} catch (err) {
			console.error('[BalanceDisplay] fetch failed:', err);
			error = err instanceof Error ? err.message : 'Failed to load balance';
			// Keep showing the last known balance if we had one
			if (balance == null) {
				balance = null;
			}
		} finally {
			loading = false;
		}
	}

	// ── Auto-refresh via $effect with cleanup ─────────────────────────────────

	$effect(() => {
		if (address) {
			// Reset state for new address
			loading = true;
			error = null;

			fetchBalance();

			const interval = setInterval(fetchBalance, refreshInterval);
			return () => clearInterval(interval);
		} else {
			balance = null;
			loading = false;
			error = null;
		}
	});
</script>

{#if compact}
	<!-- Compact variant: inline pill for header strip -->
	<span
		class="bal"
		class:bal--loading={loading}
		class:bal--error={error != null && balance == null}
		role="status"
		aria-label={loading ? 'Loading balance' : `Balance: ${displayBalance}`}
	>
		{#if loading && balance == null}
			<span class="bal__skeleton" aria-hidden="true"></span>
		{:else}
			<span
				class="bal__amount"
				class:bal__amount--zero={isZero}
				class:bal__amount--positive={hasBalance}
			>
				{displayBalance}
			</span>
		{/if}
	</span>
{:else}
	<!-- Full variant: card with balance and optional Add Funds -->
	<div
		class="bal-card"
		class:bal-card--loading={loading}
		class:bal-card--error={error != null && balance == null}
	>
		<div class="bal-card__header">
			<span class="bal-card__label">USDC Balance</span>
			{#if error && balance != null}
				<span class="bal-card__stale" title="Using cached balance; refresh failed">
					Stale
				</span>
			{/if}
		</div>

		<div class="bal-card__value-row" role="status" aria-label={loading ? 'Loading balance' : `Balance: ${displayBalance}`}>
			{#if loading && balance == null}
				<span class="bal-card__skeleton" aria-hidden="true"></span>
			{:else}
				<span
					class="bal-card__amount"
					class:bal-card__amount--zero={isZero}
					class:bal-card__amount--positive={hasBalance}
				>
					{displayBalance}
				</span>
			{/if}
		</div>

		{#if error && balance == null}
			<p class="bal-card__error">{error}</p>
		{/if}

		{#if onAddFunds}
			<button
				type="button"
				class="bal-card__add-funds"
				onclick={onAddFunds}
			>
				Add Funds
			</button>
		{/if}
	</div>
{/if}

<style>
	/* ── Compact variant (header pill) ─────────────────────────────────────── */

	.bal {
		display: inline-flex;
		align-items: center;
		padding: 4px 10px;
		border-radius: 20px;
		border: 1px solid oklch(0.85 0.02 250 / 0.6);
		background: oklch(0.97 0.01 250 / 0.55);
		height: 32px;
	}

	.bal__amount {
		font-family: 'Berkeley Mono', 'Cascadia Code', ui-monospace, monospace;
		font-size: 0.8125rem;
		font-weight: 600;
		letter-spacing: 0.02em;
		color: oklch(0.6 0.01 260);
	}

	.bal__amount--positive {
		color: oklch(0.45 0.18 160);
	}

	.bal__amount--zero {
		color: oklch(0.6 0.01 260);
	}

	.bal__skeleton {
		display: inline-block;
		width: 56px;
		height: 13px;
		border-radius: 4px;
		background: oklch(0.88 0.01 250 / 0.6);
		animation: bal-pulse 1.5s ease-in-out infinite;
	}

	/* ── Full variant (card) ───────────────────────────────────────────────── */

	.bal-card {
		border-radius: 12px;
		padding: 20px;
		border: 1px solid oklch(0.85 0.02 250 / 0.6);
		background: oklch(0.99 0.005 250 / 0.5);
	}

	.bal-card__header {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 8px;
	}

	.bal-card__label {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.8125rem;
		font-weight: 500;
		color: oklch(0.45 0.02 250);
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}

	.bal-card__stale {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.6875rem;
		font-weight: 600;
		color: oklch(0.6 0.15 85);
		padding: 2px 7px;
		border-radius: 20px;
		background: oklch(0.75 0.15 85 / 0.12);
	}

	.bal-card__value-row {
		margin-bottom: 16px;
	}

	.bal-card__amount {
		font-family: 'Berkeley Mono', 'Cascadia Code', ui-monospace, monospace;
		font-size: 1.75rem;
		font-weight: 700;
		letter-spacing: -0.01em;
		color: oklch(0.6 0.01 260);
		line-height: 1.2;
	}

	.bal-card__amount--positive {
		color: oklch(0.4 0.18 160);
	}

	.bal-card__amount--zero {
		color: oklch(0.6 0.01 260);
	}

	.bal-card__skeleton {
		display: inline-block;
		width: 100px;
		height: 34px;
		border-radius: 6px;
		background: oklch(0.88 0.01 250 / 0.6);
		animation: bal-pulse 1.5s ease-in-out infinite;
	}

	.bal-card__error {
		margin: 0 0 12px;
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.8125rem;
		color: oklch(0.5 0.2 25);
		line-height: 1.5;
	}

	/* ── Add Funds button ──────────────────────────────────────────────────── */

	.bal-card__add-funds {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 9px 18px;
		border-radius: 8px;
		border: none;
		background: oklch(0.5 0.18 260);
		color: oklch(1 0 0);
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.875rem;
		font-weight: 600;
		cursor: pointer;
		transition:
			background 150ms cubic-bezier(0.4, 0, 0.2, 1),
			transform 100ms cubic-bezier(0.4, 0, 0.2, 1),
			box-shadow 150ms cubic-bezier(0.4, 0, 0.2, 1);
	}

	.bal-card__add-funds:hover {
		background: oklch(0.44 0.2 260);
		box-shadow: 0 4px 12px oklch(0.5 0.18 260 / 0.3);
	}

	.bal-card__add-funds:active {
		transform: scale(0.98);
	}

	.bal-card__add-funds:focus-visible {
		outline: none;
		box-shadow: 0 0 0 3px oklch(0.5 0.18 260 / 0.35);
	}

	/* ── Skeleton pulse animation ──────────────────────────────────────────── */

	@keyframes bal-pulse {
		0%, 100% {
			opacity: 0.5;
		}
		50% {
			opacity: 1;
		}
	}

	/* ── Reduced motion ────────────────────────────────────────────────────── */

	@media (prefers-reduced-motion: reduce) {
		.bal__skeleton,
		.bal-card__skeleton {
			animation: none;
			opacity: 0.7;
		}

		.bal-card__add-funds {
			transition: none;
		}
	}
</style>
