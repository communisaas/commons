<script lang="ts">
	/**
	 * HeaderAvatar - User identity with dropdown menu
	 *
	 * Perceptual Engineering: Avatar IS identity confirmation.
	 * No verbose "Welcome back, X!" - the avatar speaks for itself.
	 * Dropdown reveals secondary actions only on demand.
	 */
	import { User, LogOut, ChevronDown, Wallet, ShieldCheck } from '@lucide/svelte';
	import type { HeaderUser } from '$lib/types/any-replacements';
	import { performLogout } from '$lib/core/identity/cache-invalidation';
	import { walletState } from '$lib/stores/walletState.svelte';
	import { modalActions } from '$lib/stores/modalSystem.svelte';
	import { FEATURES } from '$lib/config/features';
	import { goto } from '$app/navigation';

	let { user }: { user: HeaderUser } = $props();

	// Handle logout with cache clearing
	async function handleLogout(event: MouseEvent): Promise<void> {
		event.preventDefault();
		isOpen = false;
		await performLogout();
	}

	// Open wallet connect modal
	function handleConnectWallet(): void {
		isOpen = false;
		modalActions.openModal('wallet-connect-modal', 'wallet-connect', {});
	}

	let isOpen = $state(false);
	let dropdownRef = $state<HTMLDivElement | null>(null);

	// Close dropdown when clicking outside
	function handleClickOutside(event: MouseEvent): void {
		if (dropdownRef && !dropdownRef.contains(event.target as Node)) {
			isOpen = false;
		}
	}

	// Close on Escape
	function handleKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape' && isOpen) {
			isOpen = false;
		}
	}

	// Toggle dropdown
	function toggleDropdown(): void {
		isOpen = !isOpen;
	}

	// Attach/detach event listeners
	$effect(() => {
		if (isOpen) {
			document.addEventListener('click', handleClickOutside);
			document.addEventListener('keydown', handleKeydown);
		}
		return () => {
			document.removeEventListener('click', handleClickOutside);
			document.removeEventListener('keydown', handleKeydown);
		};
	});

	// Identity decryption state — name comes from client-side decryption only
	const displayName = $derived(user.name);
	const identityResolved = $derived(!!displayName);
	const firstName = $derived(displayName?.split(' ')[0] ?? null);

	// Generate initials — null when identity unresolved
	const initials = $derived.by(() => {
		if (!displayName) return null;
		const parts = displayName.split(' ');
		if (parts.length >= 2) {
			return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
		}
		return parts[0][0]?.toUpperCase() ?? null;
	});

	// Org memberships — the bridge between individual and org layers
	const orgMemberships = $derived(user.orgMemberships ?? []);

	function handleOrgClick(event: MouseEvent, slug: string): void {
		event.preventDefault();
		isOpen = false;
		goto(`/org/${slug}`);
	}
</script>

<div class="header-avatar-container" bind:this={dropdownRef}>
	<button
		class="header-avatar-button"
		onclick={toggleDropdown}
		aria-expanded={isOpen}
		aria-haspopup="menu"
		aria-label={firstName ? `Account menu for ${firstName}` : 'Account menu'}
	>
		{#if user.picture}
			<img src={user.picture} alt="" class="header-avatar" />
		{:else if initials}
			<div class="header-avatar header-avatar--fallback">
				{initials}
			</div>
		{:else}
			<div class="header-avatar header-avatar--unlocking"></div>
		{/if}
		{#if firstName}
			<span class="header-avatar-name header-avatar-name--resolved">{firstName}</span>
		{/if}
		<ChevronDown class="header-avatar-chevron" />
	</button>

	{#if isOpen}
		<div class="header-dropdown" role="menu" aria-label="Account options">
			<a href="/profile" class="header-dropdown-item" role="menuitem">
				<User class="header-dropdown-item-icon" />
				<span>Profile</span>
			</a>
			<a href="/profile/security" class="header-dropdown-item" role="menuitem">
				<ShieldCheck class="header-dropdown-item-icon" />
				<span>Security</span>
			</a>
			{#if orgMemberships.length > 0}
				<div class="header-dropdown-divider"></div>
				{#each orgMemberships as org}
					<a
						href="/org/{org.orgSlug}"
						class="header-dropdown-item header-dropdown-item--org"
						role="menuitem"
						onclick={(e) => handleOrgClick(e, org.orgSlug)}
					>
						{#if org.orgAvatar}
							<img src={org.orgAvatar} alt="" class="header-org-avatar" />
						{:else}
							<div class="header-org-avatar header-org-avatar--fallback">
								{org.orgName.charAt(0).toUpperCase()}
							</div>
						{/if}
						<div class="header-org-info">
							<span class="header-org-name">{org.orgName}</span>
							<span class="header-org-meta">
								{org.role}{#if org.activeCampaignCount > 0}<span class="header-org-dot"></span>{org.activeCampaignCount} campaign{org.activeCampaignCount !== 1 ? 's' : ''}{/if}
							</span>
						</div>
					</a>
				{/each}
			{/if}
			{#if FEATURES.WALLET}
				<div class="header-dropdown-divider"></div>
				{#if walletState.connected}
					<div class="header-dropdown-item header-dropdown-item--info" role="menuitem">
						<Wallet class="header-dropdown-item-icon" />
						<div>
							<span>Wallet</span>
							<span class="header-dropdown-wallet-address">{walletState.displayAddress}</span>
						</div>
					</div>
				{:else}
					<button type="button" onclick={handleConnectWallet} class="header-dropdown-item" role="menuitem">
						<Wallet class="header-dropdown-item-icon" />
						<span>Connect Wallet</span>
					</button>
				{/if}
			{/if}
			<div class="header-dropdown-divider"></div>
			<button type="button" onclick={handleLogout} class="header-dropdown-item" role="menuitem">
				<LogOut class="header-dropdown-item-icon" />
				<span>Sign out</span>
			</button>
		</div>
	{/if}
</div>

<style>
	.header-avatar-container {
		position: relative;
	}

	.header-avatar-button {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 4px 8px 4px 4px;
		border-radius: 24px;
		background: transparent;
		border: 1px solid transparent;
		cursor: pointer;
		transition: all var(--header-transition-fast) var(--header-easing);
	}

	.header-avatar-button:hover {
		background: oklch(0.95 0.01 250);
		border-color: var(--header-border);
	}

	.header-avatar-button[aria-expanded='true'] {
		background: oklch(0.95 0.01 250);
		border-color: var(--header-border);
	}

	.header-avatar-button:focus-visible {
		outline: none;
		box-shadow: 0 0 0 2px var(--header-focus-ring);
	}

	.header-avatar {
		width: 32px;
		height: 32px;
		border-radius: 50%;
		border: 1.5px solid oklch(0.7 0.02 260);
		object-fit: cover;
		flex-shrink: 0;
	}

	.header-avatar--fallback {
		display: flex;
		align-items: center;
		justify-content: center;
		background: oklch(0.92 0.02 250);
		color: var(--header-text-secondary);
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.75rem;
		font-weight: 600;
	}

	.header-avatar--unlocking {
		background: oklch(0.92 0.02 250);
		animation: identity-pulse 1.8s ease-in-out infinite;
	}

	@keyframes identity-pulse {
		0%, 100% { opacity: 0.5; }
		50% { opacity: 0.9; }
	}

	.header-avatar-name {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--header-text-primary);
	}

	.header-avatar-name--resolved {
		animation: identity-resolve 300ms ease-out;
	}

	@keyframes identity-resolve {
		from { opacity: 0; transform: translateY(2px); }
		to { opacity: 1; transform: translateY(0); }
	}

	/* Hide name on very small screens */
	@media (max-width: 400px) {
		.header-avatar-name {
			display: none;
		}
	}

	.header-avatar-button :global(.header-avatar-chevron) {
		width: 16px;
		height: 16px;
		color: var(--header-text-muted);
		transition: transform var(--header-transition-fast) var(--header-easing);
	}

	.header-avatar-button[aria-expanded='true'] :global(.header-avatar-chevron) {
		transform: rotate(180deg);
	}

	/* Dropdown menu */
	.header-dropdown {
		position: absolute;
		top: calc(100% + 8px);
		right: 0;
		min-width: 180px;
		padding: 6px;
		background: oklch(1 0 0 / 0.98);
		backdrop-filter: blur(12px);
		-webkit-backdrop-filter: blur(12px);
		border: 1px solid var(--header-border);
		border-radius: 12px;
		box-shadow:
			0 4px 6px oklch(0 0 0 / 0.05),
			0 10px 24px oklch(0 0 0 / 0.1);

		transform-origin: top right;
		animation: dropdown-enter 150ms var(--header-easing);
	}

	@keyframes dropdown-enter {
		from {
			opacity: 0;
			transform: scale(0.95) translateY(-4px);
		}
		to {
			opacity: 1;
			transform: scale(1) translateY(0);
		}
	}

	.header-dropdown-item {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		padding: 10px 12px;
		border-radius: 8px;
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.875rem;
		color: var(--header-text-secondary);
		text-decoration: none;
		transition: all 100ms ease-out;
	}

	.header-dropdown-item:hover {
		background: oklch(0.95 0.01 250);
		color: var(--header-text-primary);
	}

	.header-dropdown-item:focus-visible {
		outline: none;
		background: oklch(0.95 0.01 250);
		color: var(--header-text-primary);
	}

	.header-dropdown-item :global(.header-dropdown-item-icon) {
		width: 18px;
		height: 18px;
		opacity: 0.7;
		flex-shrink: 0;
	}

	.header-dropdown-divider {
		height: 1px;
		margin: 6px 0;
		background: var(--header-border);
	}

	.header-dropdown-item--info {
		cursor: default;
	}

	.header-dropdown-item--info:hover {
		background: transparent;
		color: var(--header-text-secondary);
	}

	.header-dropdown-wallet-address {
		display: block;
		font-size: 0.75rem;
		color: oklch(0.55 0.01 260);
		font-family: 'Berkeley Mono', monospace;
	}

	/* Org bridge — identity-integrated org membership */
	.header-dropdown-item--org {
		gap: 10px;
		padding: 8px 12px;
	}

	.header-org-avatar {
		width: 28px;
		height: 28px;
		border-radius: 7px;
		object-fit: cover;
		flex-shrink: 0;
	}

	.header-org-avatar--fallback {
		display: flex;
		align-items: center;
		justify-content: center;
		/* Teal accent — chromatic preview of the org dashboard world */
		background: oklch(0.92 0.06 180);
		color: oklch(0.4 0.12 180);
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.75rem;
		font-weight: 600;
	}

	.header-org-info {
		display: flex;
		flex-direction: column;
		gap: 1px;
		min-width: 0;
	}

	.header-org-name {
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--header-text-primary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.header-org-meta {
		font-size: 0.6875rem;
		color: var(--header-text-muted);
		white-space: nowrap;
		text-transform: capitalize;
	}

	.header-org-dot {
		display: inline-block;
		width: 3px;
		height: 3px;
		border-radius: 50%;
		background: oklch(0.65 0.02 250);
		margin: 0 5px;
		vertical-align: middle;
	}

	/* Reduced motion */
	@media (prefers-reduced-motion: reduce) {
		.header-dropdown {
			animation: none;
		}

		.header-avatar-button {
			transition: none;
		}

		.header-avatar-button :global(.header-avatar-chevron) {
			transition: none;
		}
	}
</style>
