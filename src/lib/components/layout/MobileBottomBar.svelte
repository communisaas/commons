<script lang="ts">
	/**
	 * MobileBottomBar - Primary actions in thumb zone
	 *
	 * Perceptual Engineering: Mobile users have different motor patterns.
	 * Primary actions must be in thumb zone (bottom of screen).
	 * Share (secondary) | Send (primary)
	 */
	import { Share2 } from '@lucide/svelte';
	import { page } from '$app/stores';
	import { analyzeEmailFlow } from '$lib/services/emailService';
	import { toEmailServiceUser } from '$lib/types/user';
	import type { HeaderTemplate, HeaderUser, TemplateUseEvent } from '$lib/types/any-replacements';
	import { getJurisdictionLabels } from '$lib/core/locale/jurisdiction';

	const labels = getJurisdictionLabels();

	let {
		template,
		user = null,
		onTemplateUse = null
	}: {
		template: HeaderTemplate;
		user?: HeaderUser | null;
		onTemplateUse?: ((event: TemplateUseEvent) => void) | null;
	} = $props();

	const shareUrl = $derived($page.url.href);

	// Determine primary action
	const isCongressional = $derived(template.deliveryMethod === 'cwc');

	// Share functionality
	async function handleShare(): Promise<void> {
		const shareData = {
			title: template.title,
			text: `Check out "${template.title}" on Commons`,
			url: shareUrl
		};

		// Use native share if available
		if (navigator.share) {
			try {
				await navigator.share(shareData);
			} catch {
				// User cancelled or share failed - fall back to clipboard
				await navigator.clipboard.writeText(shareUrl);
			}
		} else {
			// Fallback: copy to clipboard
			await navigator.clipboard.writeText(shareUrl);
		}
	}

	// Primary action
	function handlePrimaryAction(): void {
		if (!onTemplateUse) return;

		const emailFlow = analyzeEmailFlow(template, toEmailServiceUser(user as Record<string, unknown> | null), { trustTier: (user as Record<string, unknown> | null)?.trust_tier as number ?? 0 });
		onTemplateUse({
			template,
			requiresAuth: emailFlow.requiresAuth
		});
	}

	// Primary button text
	const primaryText = $derived.by(() => {
		if (!user) {
			return 'Sign in to send';
		}
		return isCongressional ? `Contact ${labels.legislativeBody}` : 'Send message';
	});
</script>

<!--
  Mobile bottom bar - only visible on small screens.
  Uses safe-area-inset for notch devices.
-->

<div class="mobile-bottom-bar">
	<div class="mobile-bottom-bar__inner">
		<!-- Secondary: Share -->
		<button class="bottom-bar-secondary" onclick={handleShare} aria-label="Share this template">
			<Share2 class="bottom-bar-icon" />
			<span>Share</span>
		</button>

		<!-- Primary: Send action -->
		<button
			class="bottom-bar-primary"
			class:bottom-bar-primary--congress={isCongressional}
			onclick={handlePrimaryAction}
		>
			{primaryText}
		</button>
	</div>
</div>

<style>
	.mobile-bottom-bar {
		position: fixed;
		bottom: 0;
		left: 0;
		right: 0;
		z-index: 100;

		/* Height + safe area for notch devices */
		padding-bottom: env(safe-area-inset-bottom, 0);

		background: oklch(1 0 0 / 0.98);
		backdrop-filter: blur(12px);
		-webkit-backdrop-filter: blur(12px);
		border-top: 1px solid var(--header-border);
	}

	.mobile-bottom-bar__inner {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 8px 16px;
	}

	.bottom-bar-secondary {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		height: 44px;
		padding: 0 16px;
		border-radius: 10px;
		background: oklch(0.95 0.01 250);
		border: none;
		cursor: pointer;
		transition: all var(--header-transition-fast) var(--header-easing);
	}

	.bottom-bar-secondary span {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--header-text-secondary);
	}

	.bottom-bar-secondary:hover {
		background: oklch(0.92 0.02 250);
	}

	.bottom-bar-secondary:active {
		background: oklch(0.9 0.02 250);
		transform: scale(0.98);
	}

	.bottom-bar-secondary:focus-visible {
		outline: none;
		box-shadow: 0 0 0 2px var(--header-focus-ring);
	}

	.bottom-bar-secondary :global(.bottom-bar-icon) {
		width: 18px;
		height: 18px;
		color: var(--header-text-muted);
	}

	.bottom-bar-primary {
		flex: 1;
		height: 48px;
		padding: 0 24px;
		border-radius: 12px;
		border: none;
		cursor: pointer;

		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 1rem;
		font-weight: 500;
		color: white;
		background: var(--header-action-primary);

		transition: all var(--header-transition-fast) var(--header-easing);
	}

	.bottom-bar-primary--congress {
		background: var(--header-action-congress);
	}

	.bottom-bar-primary:hover {
		background: var(--header-action-primary-hover);
	}

	.bottom-bar-primary--congress:hover {
		background: var(--header-action-congress-hover);
	}

	.bottom-bar-primary:active {
		transform: scale(0.98);
	}

	.bottom-bar-primary:focus-visible {
		outline: none;
		box-shadow: 0 0 0 2px var(--header-focus-ring);
	}

	/* Only show on mobile (< 640px) */
	@media (min-width: 640px) {
		.mobile-bottom-bar {
			display: none;
		}
	}

	/* Reduced motion */
	@media (prefers-reduced-motion: reduce) {
		.bottom-bar-secondary,
		.bottom-bar-primary {
			transition: none;
		}

		.bottom-bar-secondary:active,
		.bottom-bar-primary:active {
			transform: none;
		}
	}
</style>
