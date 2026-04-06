<script lang="ts">
	/**
	 * IdentityStrip - Minimal 48px header for template pages
	 *
	 * Perceptual Engineering: Working memory constraint (4±1 chunks).
	 * Only 3 elements: Back navigation | Brand | User identity
	 *
	 * Layout: [Back] -------- [TrustTier | Wallet | Avatar/SignIn]
	 */
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { browser } from '$app/environment';
	import HeaderBackButton from './header/HeaderBackButton.svelte';
	import HeaderAvatar from './header/HeaderAvatar.svelte';
	import HeaderSignIn from './header/HeaderSignIn.svelte';
	import BalanceDisplay from '$lib/components/wallet/BalanceDisplay.svelte';
	import WalletStatus from '$lib/components/wallet/WalletStatus.svelte';
	import TrustTierIndicator from '$lib/components/identity/TrustTierIndicator.svelte';
	import { walletState } from '$lib/stores/walletState.svelte';
	import type { HeaderUser, HeaderTemplate, TemplateUseEvent } from '$lib/types/any-replacements';
	import type { TrustTier } from '$lib/core/identity/authority-level';
	import type { SessionCredentialForPolicy } from '$lib/core/identity/credential-policy';
	import { FEATURES } from '$lib/config/features';

	let {
		user = null,
		template = null,
		isScrolled = false,
		isHidden = false,
		onTemplateUse: _onTemplateUse = null
	}: {
		user?: HeaderUser | null;
		template?: HeaderTemplate | null;
		isScrolled?: boolean;
		isHidden?: boolean;
		onTemplateUse?: ((event: TemplateUseEvent) => void) | null;
	} = $props();

	// ── Trust tier from server-provided user data ────────────────────────
	const trustTier = $derived((user?.trust_tier ?? 0) as TrustTier);

	// ── Session credential from IndexedDB (async, client-only) ──────────
	let credential: SessionCredentialForPolicy | null = $state(null);

	$effect(() => {
		if (!browser || !user?.id) {
			credential = null;
			return;
		}

		let cancelled = false;
		const userId = user.id;
		import('$lib/core/identity/session-credentials').then(async ({ getSessionCredential }) => {
			const cred = await getSessionCredential(userId);
			if (cancelled) return;
			credential = cred ? {
				userId: cred.userId,
				createdAt: cred.createdAt,
				expiresAt: cred.expiresAt,
				congressionalDistrict: cred.congressionalDistrict
			} : null;
		}).catch(() => {
			if (!cancelled) credential = null;
		});

		return () => { cancelled = true; };
	});

	// Derive back navigation from context
	const backConfig = $derived.by(() => {
		const routeId = $page.route?.id;

		if (routeId === '/s/[slug]' && template) {
			return {
				show: true,
				href: '/',
				label: 'All Templates'
			};
		}

		// Other pages: show home link if not on homepage
		if (routeId !== '/') {
			return {
				show: true,
				href: '/',
				label: 'Home'
			};
		}

		return { show: false, href: '/', label: '' };
	});
</script>

<header
	class="identity-strip"
	class:identity-strip--scrolled={isScrolled}
	class:identity-strip--hidden={isHidden}
	aria-label="Site header"
>
	<nav class="identity-strip__inner" aria-label="Primary navigation">
		<!-- Left: Back navigation or brand -->
		<div class="identity-strip__left">
			{#if backConfig.show}
				<HeaderBackButton href={backConfig.href} label={backConfig.label} />
			{:else}
				<a href="/" class="identity-strip__brand"> Commons </a>
			{/if}
		</div>

		<!-- Center: Empty (flexible space) -->
		<div class="identity-strip__center"></div>

		<!-- Right: Trust tier + wallet + avatar -->
		<div class="identity-strip__right">
			{#if user}
				{#if FEATURES.CONGRESSIONAL}
					<TrustTierIndicator
						tier={trustTier}
						{credential}
						onUpgrade={() => goto('/profile')}
					/>
				{/if}
				{#if FEATURES.DEBATE && FEATURES.WALLET}
					<div class="identity-strip__wallet-group">
						{#if walletState.connected}
							<span class="identity-strip__balance-wrap">
								<BalanceDisplay address={walletState.address} compact={true} />
							</span>
							<WalletStatus
								address={walletState.address}
								chainId={walletState.chainId}
								ondisconnect={() => walletState.disconnect()}
							/>
						{:else}
							<button
								type="button"
								class="wallet-connect-pill"
								onclick={() => walletState.connectEVM()}
								disabled={walletState.connecting}
							>
								{#if walletState.connecting}
									Connecting...
								{:else}
									Connect
								{/if}
							</button>
						{/if}
					</div>
				{/if}
				<HeaderAvatar {user} />
			{:else}
				<HeaderSignIn />
			{/if}
		</div>
	</nav>
</header>

<style>
	.identity-strip {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		height: 48px;
		z-index: 100;

		background: var(--header-bg);
		backdrop-filter: blur(12px);
		-webkit-backdrop-filter: blur(12px);
		border-bottom: 1px solid var(--header-border);

		transform: translateY(0);
		transition:
			transform var(--header-transition-normal) var(--header-easing),
			box-shadow var(--header-transition-normal) var(--header-easing);
	}

	.identity-strip--scrolled {
		box-shadow: var(--header-shadow-scrolled);
	}

	.identity-strip--hidden {
		transform: translateY(-100%);
	}

	.identity-strip__inner {
		display: grid;
		grid-template-columns: auto 1fr auto;
		align-items: center;
		gap: 16px;
		height: 100%;
		max-width: 80rem;
		margin: 0 auto;
		padding: 0 16px;
	}

	@media (min-width: 640px) {
		.identity-strip__inner {
			padding: 0 24px;
		}
	}

	.identity-strip__left {
		display: flex;
		align-items: center;
	}

	.identity-strip__center {
		/* Flexible spacer */
	}

	.identity-strip__right {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 8px;
	}

	/* ── Wallet group (balance + status or connect pill) ──────────────── */

	.identity-strip__wallet-group {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	/* Hide BalanceDisplay below 640px to save header space on mobile */
	.identity-strip__balance-wrap {
		display: none;
	}

	@media (min-width: 640px) {
		.identity-strip__balance-wrap {
			display: contents;
		}
	}

	/* ── Connect wallet pill button ──────────────────────────────────── */

	.wallet-connect-pill {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 4px 12px;
		height: 28px;
		border-radius: 14px;
		font-size: 0.75rem;
		font-weight: 500;
		font-family: 'Satoshi', system-ui, sans-serif;
		background: oklch(0.95 0.01 250);
		color: oklch(0.45 0.02 260);
		border: 1px solid oklch(0.88 0.01 250);
		cursor: pointer;
		transition: all 150ms ease-out;
	}

	.wallet-connect-pill:hover {
		background: oklch(0.92 0.02 250);
		border-color: oklch(0.82 0.02 250);
	}

	.wallet-connect-pill:disabled {
		opacity: 0.6;
		cursor: default;
	}

	.identity-strip__brand {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-weight: 600;
		font-size: 1.125rem;
		letter-spacing: -0.01em;
		color: var(--header-text-primary);
		text-decoration: none;
		transition: opacity var(--header-transition-fast) var(--header-easing);
	}

	.identity-strip__brand:hover {
		opacity: 0.8;
	}

	/* Reduced motion support */
	@media (prefers-reduced-motion: reduce) {
		.identity-strip {
			transition: none;
		}

		.identity-strip--hidden {
			visibility: hidden;
		}

		.wallet-connect-pill {
			transition: none;
		}
	}
</style>
