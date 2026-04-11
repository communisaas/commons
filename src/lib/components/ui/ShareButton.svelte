<script lang="ts">
	import { spring } from 'svelte/motion';
	import { fade, scale } from 'svelte/transition';
	import { backOut } from 'svelte/easing';
	import { Share2, CheckCircle, Sparkles, Heart, Zap } from '@lucide/svelte';
	import SimpleTooltip from './SimpleTooltip.svelte';

	let {
		url,
		_title = 'Share',
		message = '',
		variant = 'primary',
		size = 'default',
		classNames = ''
	}: {
		url: string;
		_title?: string;
		/** Optional share text for navigator.share(). When provided, mobile triggers native share sheet instead of clipboard copy. */
		message?: string;
		variant?: 'primary' | 'secondary' | 'magical';
		size?: 'sm' | 'default' | 'lg';
		classNames?: string;
	} = $props();

	let copied = $state(false);
	let animating = $state(false);
	let _showMenu = $state(false);
	let hovered = $state(false);
	let buttonRef: HTMLButtonElement;

	// Spring animations for smooth interactions - simplified for reliability
	let buttonScale = spring(1, { stiffness: 0.4, damping: 0.85 });
	let glowIntensity = spring(0, { stiffness: 0.2, damping: 0.9 });
	let particleSpring = spring(0, { stiffness: 0.3, damping: 0.8 });
	let copiedGlow = spring(0, { stiffness: 0.3, damping: 0.9 });

	// Reactive particles for magical effect
	let particles = $state<Array<{ id: number; x: number; y: number }>>([]);

	$effect(() => {
		// Block all hover effects during the entire animation sequence
		if (animating || copied) {
			// Keep it looking active while animating/showing success
			glowIntensity.set(0.7);
			particles = [];
			return;
		}

		if (hovered) {
			buttonScale.set(1.05);
			glowIntensity.set(1);

			// Create particles on hover
			if (variant === 'magical') {
				const interval = setInterval(() => {
					if (hovered && particles.length < 8) {
						particles = [
							...particles,
							{
								id: Date.now() + Math.random(),
								x: Math.random() * 100 - 50,
								y: Math.random() * 100 - 50
							}
						];
					}
				}, 200);

				return () => clearInterval(interval);
			}
		} else {
			buttonScale.set(1);
			glowIntensity.set(0);
			particles = [];
		}
	});

	// Clean up old particles
	$effect(() => {
		if (particles.length > 0) {
			const timeout = setTimeout(() => {
				particles = particles.slice(-5);
			}, 1000);
			return () => clearTimeout(timeout);
		}
	});

	async function handleShare() {
		// Native share sheet when message is provided and platform supports it
		if (message && typeof navigator !== 'undefined' && navigator.share) {
			const shareData = { title: _title, text: message, url };
			try {
				if (navigator.canShare?.(shareData)) {
					await navigator.share(shareData);
					return;
				}
			} catch (err) {
				if (err instanceof Error && err.name === 'AbortError') return;
				// Fall through to clipboard copy
			}
		}
		await copyToClipboard();
	}

	async function copyToClipboard() {
		try {
			await navigator.clipboard.writeText(url);
			copied = true;
			animating = true; // Start animation lock
			hovered = false; // Hide tooltip immediately

			// Trigger copy animation with perfect timing
			buttonScale.set(0.95);
			copiedGlow.set(1);
			setTimeout(() => buttonScale.set(1.08), 100);
			setTimeout(() => buttonScale.set(1), 250);

			// Trigger particle burst
			particleSpring.set(1);

			setTimeout(() => {
				particleSpring.set(0);
				copiedGlow.set(0);
			}, 400);

			setTimeout(() => {
				copied = false;
				// Small delay before re-enabling hover
				setTimeout(() => {
					animating = false; // Animation complete, re-enable hover
				}, 200);
			}, 2000);
		} catch (error) {
			console.error('[ShareButton] copyToClipboard failed:', error instanceof Error ? error.message : String(error));
		}
	}

	// Size classes
	const sizeClasses = {
		sm: 'px-3 py-1.5 text-sm gap-1.5',
		default: 'px-4 py-2 text-base gap-2',
		lg: 'px-6 py-3 text-lg gap-2.5'
	};

	const iconSizes = {
		sm: 'h-3.5 w-3.5',
		default: 'h-4 w-4',
		lg: 'h-5 w-5'
	};

	// Variant classes - base styles without hover (we control hover via state)
	const variantClasses = {
		primary: `
			bg-gradient-to-r from-participation-primary-500 to-participation-primary-600 
			text-white shadow-lg shadow-participation-primary-500/25
			border border-participation-primary-400/20
		`,
		secondary: `
			bg-white
			text-slate-700
			border border-slate-200
			shadow-md
		`,
		magical: `
			bg-gradient-to-r from-indigo-600 via-blue-600 to-purple-600
			text-white shadow-md
			shadow-purple-500/30
			relative overflow-hidden
			border border-white/20
		`
	};

	// Hover variant classes - only applied when not animating
	const hoverClasses = {
		primary: `
			hover:from-participation-primary-600 hover:to-participation-primary-700
		`,
		secondary: `
			hover:bg-slate-50
			hover:text-slate-900
			hover:border-slate-300
			hover:shadow-lg
		`,
		magical: `
			hover:from-indigo-700 hover:via-blue-700 hover:to-purple-700
			hover:shadow-purple-500/40
		`
	};
</script>

<div class="relative z-20 inline-block">
	<!-- Glow effect for magical variant -->
	{#if variant === 'magical'}
		<div
			class="absolute inset-0 rounded-full bg-gradient-to-r from-indigo-400 via-blue-400 to-purple-400 opacity-50 blur-xl"
			style="transform: scale({1 + $glowIntensity * 0.3}); opacity: {0.3 + $glowIntensity * 0.4}"
		></div>
	{/if}

	<!-- Particles for magical variant -->
	{#if variant === 'magical'}
		{#each particles as particle (particle.id)}
			<div
				class="pointer-events-none absolute"
				style="
					left: 50%; 
					top: 50%; 
					transform: translate({particle.x}px, {particle.y}px) scale({1 - $particleSpring});
				"
				in:scale={{ duration: 300, easing: backOut }}
				out:fade={{ duration: 800 }}
			>
				{#if Math.random() > 0.66}
					<Sparkles class="h-3 w-3 animate-pulse text-yellow-300" />
				{:else if Math.random() > 0.33}
					<Heart class="h-3 w-3 animate-pulse text-pink-300" />
				{:else}
					<Zap class="h-3 w-3 animate-pulse text-blue-300" />
				{/if}
			</div>
		{/each}
	{/if}

	<button
		bind:this={buttonRef}
		onclick={handleShare}
		onmouseenter={() => !animating && !copied && (hovered = true)}
		onmouseleave={() => !animating && !copied && (hovered = false)}
		class="
			relative inline-flex transform-gpu cursor-pointer items-center
			justify-center rounded-full
			font-brand font-medium transition-all
			duration-200 ease-out
			{sizeClasses[size]}
			{variantClasses[variant]}
			{!(animating || copied) ? hoverClasses[variant] : ''}
			{classNames}
		"
		style="
			transform: scale({$buttonScale});
			box-shadow:
				0 4px 6px -1px rgba(0, 0, 0, 0.1),
				0 2px 4px -1px rgba(0, 0, 0, 0.06),
				0 0 {20 * $glowIntensity}px rgba(79, 70, 229, {0.3 * $glowIntensity}),
				0 0 {30 * $copiedGlow}px rgba(34, 197, 94, {0.2 * $copiedGlow});
		"
		aria-label={copied ? 'Link copied!' : 'Share this template'}
	>
		<!-- Success shimmer on copy (celebratory sweep) -->
		{#if copied}
			<div
				class="animate-shimmer-once absolute inset-0 z-0 rounded-full bg-gradient-to-r from-transparent via-white/30 to-transparent"
			></div>
		{/if}

		<!-- Content container with fixed layout (z-10 to stay above overlays) -->
		<div class="relative z-10 flex items-center gap-2">
			<!-- Icon container - morphing animation with both icons -->
			<div
				class="relative inline-flex items-center justify-center"
				style="width: 18px; height: 18px;"
			>
				<!-- Share icon -->
				<div
					class="absolute inset-0 flex items-center justify-center"
					style="
						opacity: {copied ? 0 : 1};
						transform: scale({copied ? 0.3 : 1});
						transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
					"
				>
					<Share2 class="{iconSizes[size]} text-current" />
				</div>

				<!-- Check icon -->
				<div
					class="absolute inset-0 flex items-center justify-center"
					style="
						opacity: {copied ? 1 : 0};
						transform: scale({copied ? 1 : 1.5});
						transition: all 0.4s cubic-bezier(0.68, -0.55, 0.265, 1.55);
					"
				>
					<CheckCircle class="{iconSizes[size]} text-current" />
				</div>
			</div>

			<!-- Text container - completely isolated -->
			<div class="relative inline-flex items-center justify-center" style="min-width: 65px;">
				<span
					class="absolute inset-0 flex items-center justify-center transition-opacity duration-200"
					style="opacity: {copied ? 0 : 1};"
				>
					Share
				</span>
				<span
					class="absolute inset-0 flex items-center justify-center transition-opacity duration-200"
					style="opacity: {copied ? 1 : 0};"
				>
					Copied!
				</span>
			</div>
		</div>
	</button>

	<!-- Reusable tooltip component -->
	<SimpleTooltip content="Copy link" placement="bottom" show={hovered && !copied} />
</div>

<style>
	@keyframes shimmer-once {
		0% {
			transform: translateX(-100%);
		}
		100% {
			transform: translateX(100%);
		}
	}

	.animate-shimmer-once {
		animation: shimmer-once 0.6s ease-out forwards;
	}
</style>
