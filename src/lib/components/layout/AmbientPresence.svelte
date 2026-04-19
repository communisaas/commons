<script lang="ts">
	/**
	 * AmbientPresence - Floating header elements for homepage
	 *
	 * Perceptual Engineering: No header bar on homepage.
	 * Brand lives in hero content. Only identity floats in peripheral vision.
	 *
	 * Appears after 1.5s OR after 80px scroll for first-time visitors.
	 * Always visible for returning/authenticated users.
	 */
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { ChevronDown, User, LogOut } from '@lucide/svelte';
	import { modalActions } from '$lib/stores/modalSystem.svelte';
	import type { HeaderUser } from '$lib/types/any-replacements';
	import { performLogout } from '$lib/core/identity/cache-invalidation';

	let {
		user = null,
		isScrolled: _isScrolled = false
	}: {
		user?: HeaderUser | null;
		isScrolled?: boolean;
	} = $props();

	// Org memberships — bridge from individual to org layer
	const orgMemberships = $derived(user?.orgMemberships ?? []);

	function handleOrgClick(event: MouseEvent, slug: string): void {
		event.preventDefault();
		isDropdownOpen = false;
		goto(`/org/${slug}`);
	}

	let isVisible = $state(false);
	let isDropdownOpen = $state(false);
	let dropdownRef = $state<HTMLDivElement | null>(null);
	// SSR always renders sign-in pill; client swaps to user pill post-mount.
	// Avoids Svelte 5 hydration DOM-walk mismatch in the authenticated branch.
	let mounted = $state(false);

	// Reveal logic: show after delay or scroll
	onMount(() => {
		mounted = true;

		// If authenticated, show immediately
		if (user) {
			isVisible = true;
			return;
		}

		// Show after 1.5s delay
		const timer = setTimeout(() => {
			isVisible = true;
		}, 1500);

		// OR show after 80px scroll
		function handleScroll(): void {
			if (window.scrollY > 80) {
				isVisible = true;
				window.removeEventListener('scroll', handleScroll);
			}
		}

		window.addEventListener('scroll', handleScroll, { passive: true });

		return () => {
			clearTimeout(timer);
			window.removeEventListener('scroll', handleScroll);
		};
	});

	// Close dropdown on outside click
	function handleClickOutside(event: MouseEvent): void {
		if (dropdownRef && !dropdownRef.contains(event.target as Node)) {
			isDropdownOpen = false;
		}
	}

	// Close on Escape
	function handleKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape' && isDropdownOpen) {
			isDropdownOpen = false;
		}
	}

	$effect(() => {
		if (browser && isDropdownOpen) {
			document.addEventListener('click', handleClickOutside);
			document.addEventListener('keydown', handleKeydown);
		}
		return () => {
			if (browser) {
				document.removeEventListener('click', handleClickOutside);
				document.removeEventListener('keydown', handleKeydown);
			}
		};
	});

	// Identity decryption state — name comes from client-side decryption only
	const displayName = $derived(user?.name ?? null);
	const identityResolved = $derived(!!displayName);
	const firstName = $derived(displayName?.split(' ')[0] ?? null);
	const initials = $derived.by(() => {
		if (!displayName) return null;
		const parts = displayName.split(' ');
		if (parts.length >= 2) {
			return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
		}
		return parts[0][0]?.toUpperCase() ?? null;
	});

	function handleSignIn(): void {
		modalActions.openModal('sign-in-modal', 'sign-in');
	}

	// Navigate to profile — explicit goto avoids race with dropdown lifecycle
	function handleProfileClick(event: MouseEvent): void {
		event.preventDefault();
		isDropdownOpen = false;
		goto('/profile');
	}

	// Handle logout with cache clearing
	async function handleLogout(event: MouseEvent): Promise<void> {
		event.preventDefault();
		isDropdownOpen = false;
		await performLogout();
	}
</script>

<!--
  Ambient Presence: floating pill in top-right corner.
  No header bar - just a floating identity indicator.
-->

<div class="ambient-presence" class:ambient-presence--visible={isVisible}>
	{#if mounted && user}
		<!-- Authenticated: User pill with dropdown -->
		<div class="ambient-user-container" bind:this={dropdownRef}>
			<button
				class="ambient-user"
				onclick={() => (isDropdownOpen = !isDropdownOpen)}
				aria-expanded={isDropdownOpen}
				aria-haspopup="menu"
				aria-label={firstName ? `Account menu for ${firstName}` : 'Account menu'}
			>
				{#if user.picture}
					<img src={user.picture} alt="" class="ambient-user-avatar" />
				{:else if initials}
					<div class="ambient-user-avatar ambient-user-avatar--fallback">
						{initials}
					</div>
				{:else}
					<div class="ambient-user-avatar ambient-user-avatar--unlocking"></div>
				{/if}
				{#if firstName}
					<span class="ambient-user-name ambient-user-name--resolved">{firstName}</span>
				{/if}
				<ChevronDown class="ambient-user-chevron" />
			</button>

			{#if isDropdownOpen}
				<div class="ambient-dropdown" role="menu" aria-label="Account options">
					<a href="/profile" class="ambient-dropdown-item" role="menuitem" onclick={handleProfileClick}>
						<User class="ambient-dropdown-icon" />
						<span>Profile</span>
					</a>
					{#if orgMemberships.length > 0}
						<div class="ambient-dropdown-divider"></div>
						{#each orgMemberships as org}
							<a
								href="/org/{org.orgSlug}"
								class="ambient-dropdown-item ambient-dropdown-item--org"
								role="menuitem"
								onclick={(e) => handleOrgClick(e, org.orgSlug)}
							>
								{#if org.orgAvatar}
									<img src={org.orgAvatar} alt="" class="ambient-org-avatar" />
								{:else}
									<div class="ambient-org-avatar ambient-org-avatar--fallback">
										{org.orgName.charAt(0).toUpperCase()}
									</div>
								{/if}
								<div class="ambient-org-info">
									<span class="ambient-org-name">{org.orgName}</span>
									<span class="ambient-org-meta">
										{org.role}{#if org.activeCampaignCount > 0}<span class="ambient-org-dot"></span>{org.activeCampaignCount} campaign{org.activeCampaignCount !== 1 ? 's' : ''}{/if}
									</span>
								</div>
							</a>
						{/each}
					{/if}
					<div class="ambient-dropdown-divider"></div>
					<button
						type="button"
						onclick={handleLogout}
						class="ambient-dropdown-item"
						role="menuitem"
					>
						<LogOut class="ambient-dropdown-icon" />
						<span>Sign out</span>
					</button>
				</div>
			{/if}
		</div>
	{:else}
		<!-- Anonymous: Sign in pill -->
		<button class="ambient-auth-pill" onclick={handleSignIn} aria-label="Sign in to your account">
			Sign in
		</button>
	{/if}
</div>

<style>
	.ambient-presence {
		position: fixed;
		top: 20px;
		right: 20px;
		z-index: 100;

		opacity: 0;
		transform: translateY(-8px);
		pointer-events: none;
		transition:
			opacity var(--header-transition-slow) var(--header-easing),
			transform var(--header-transition-slow) var(--header-easing);
	}

	.ambient-presence--visible {
		opacity: 1;
		transform: translateY(0);
		pointer-events: auto;
	}

	/* Sign in pill (anonymous) */
	.ambient-auth-pill {
		padding: 8px 16px;
		border-radius: 20px;
		background: oklch(0 0 0 / 0.04);
		backdrop-filter: blur(8px);
		-webkit-backdrop-filter: blur(8px);
		border: 1px solid oklch(0 0 0 / 0.06);
		cursor: pointer;

		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.875rem;
		font-weight: 500;
		color: oklch(0.4 0.02 250);

		opacity: 0.7;
		transition: all var(--header-transition-normal) ease-out;
	}

	.ambient-auth-pill:hover {
		opacity: 1;
		background: oklch(1 0 0 / 0.9);
		box-shadow: 0 2px 8px oklch(0 0 0 / 0.08);
		transform: translateY(-1px);
	}

	.ambient-auth-pill:focus-visible {
		outline: none;
		box-shadow: 0 0 0 2px var(--header-focus-ring);
		opacity: 1;
	}

	/* User pill (authenticated) */
	.ambient-user-container {
		position: relative;
	}

	.ambient-user {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 4px 4px 4px 12px;
		border-radius: 24px;
		background: oklch(1 0 0 / 0.85);
		backdrop-filter: blur(12px);
		-webkit-backdrop-filter: blur(12px);
		border: 1px solid oklch(0 0 0 / 0.06);
		cursor: pointer;

		opacity: 0.85;
		transition: all var(--header-transition-normal) ease-out;
	}

	.ambient-user:hover {
		opacity: 1;
		box-shadow: 0 4px 12px oklch(0 0 0 / 0.1);
	}

	.ambient-user[aria-expanded='true'] {
		opacity: 1;
	}

	.ambient-user:focus-visible {
		outline: none;
		box-shadow: 0 0 0 2px var(--header-focus-ring);
		opacity: 1;
	}

	.ambient-user-avatar {
		width: 32px;
		height: 32px;
		border-radius: 50%;
		border: 1.5px solid oklch(0.7 0.02 260);
		object-fit: cover;
		flex-shrink: 0;
	}

	.ambient-user-avatar--fallback {
		display: flex;
		align-items: center;
		justify-content: center;
		background: oklch(0.92 0.02 250);
		color: var(--header-text-secondary);
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.75rem;
		font-weight: 600;
	}

	.ambient-user-avatar--unlocking {
		background: oklch(0.92 0.02 250);
		animation: identity-pulse 1.8s ease-in-out infinite;
	}

	@keyframes identity-pulse {
		0%, 100% { opacity: 0.5; }
		50% { opacity: 0.9; }
	}

	.ambient-user-name--resolved {
		animation: identity-resolve 300ms ease-out;
	}

	@keyframes identity-resolve {
		from { opacity: 0; transform: translateY(2px); }
		to { opacity: 1; transform: translateY(0); }
	}

	.ambient-user-name {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.875rem;
		font-weight: 500;
		color: oklch(0.25 0.02 250);
		max-width: 100px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.ambient-user :global(.ambient-user-chevron) {
		width: 16px;
		height: 16px;
		color: var(--header-text-muted);
		margin-right: 4px;
		transition: transform var(--header-transition-fast) var(--header-easing);
	}

	.ambient-user[aria-expanded='true'] :global(.ambient-user-chevron) {
		transform: rotate(180deg);
	}

	/* Dropdown */
	.ambient-dropdown {
		position: absolute;
		top: calc(100% + 8px);
		right: 0;
		min-width: 160px;
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
		animation: ambient-dropdown-enter 150ms var(--header-easing);
	}

	@keyframes ambient-dropdown-enter {
		from {
			opacity: 0;
			transform: scale(0.95) translateY(-4px);
		}
		to {
			opacity: 1;
			transform: scale(1) translateY(0);
		}
	}

	.ambient-dropdown-item {
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

	.ambient-dropdown-item:hover {
		background: oklch(0.95 0.01 250);
		color: var(--header-text-primary);
	}

	.ambient-dropdown-item :global(.ambient-dropdown-icon) {
		width: 18px;
		height: 18px;
		opacity: 0.7;
	}

	.ambient-dropdown-divider {
		height: 1px;
		margin: 6px 0;
		background: var(--header-border);
	}

	/* Org bridge — identity-integrated org membership */
	.ambient-dropdown-item--org {
		gap: 10px;
		padding: 8px 12px;
	}

	.ambient-org-avatar {
		width: 28px;
		height: 28px;
		border-radius: 7px;
		object-fit: cover;
		flex-shrink: 0;
	}

	.ambient-org-avatar--fallback {
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

	.ambient-org-info {
		display: flex;
		flex-direction: column;
		gap: 1px;
		min-width: 0;
	}

	.ambient-org-name {
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--header-text-primary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.ambient-org-meta {
		font-size: 0.6875rem;
		color: var(--header-text-muted);
		white-space: nowrap;
		text-transform: capitalize;
	}

	.ambient-org-dot {
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
		.ambient-presence,
		.ambient-auth-pill,
		.ambient-user {
			transition: none;
		}

		.ambient-user :global(.ambient-user-chevron) {
			transition: none;
		}

		.ambient-dropdown,
		.ambient-user-avatar--unlocking,
		.ambient-user-name--resolved {
			animation: none;
		}

		.ambient-auth-pill:hover,
		.ambient-user:hover {
			transform: none;
		}
	}
</style>
