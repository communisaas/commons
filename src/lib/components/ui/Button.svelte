<script lang="ts">
	import { spring } from 'svelte/motion';
	// // import { fade } from 'svelte/transition';
	import { Send, ChevronsDown, ChevronsRight } from '@lucide/svelte';

	let {
		variant = 'primary',
		size = 'default',
		type = 'button',
		cursor = 'pointer',
		classNames = '',
		text = undefined,
		href = undefined,
		rel = undefined,
		buttonElement = $bindable(),
		testId = undefined,
		disabled = false,
		loading = false,
		enableFlight = false,
		flightDirection = 'default',
		flightState = $bindable('ready'),
		animationType = 'flight',
		icon = undefined,
		user = null,
		onclick,
		onmouseover,
		onmouseenter,
		onmouseleave,
		onfocus,
		onblur,
		children
	}: {
		variant?: 'primary' | 'secondary' | 'magical' | 'verified' | 'community' | 'danger';
		size?: 'sm' | 'default' | 'lg';
		type?: 'button' | 'submit';
		cursor?: 'default' | 'help' | 'alias' | 'pointer';
		classNames?: string;
		text?: string | undefined;
		href?: string | undefined;
		rel?: string | undefined;
		buttonElement?: HTMLButtonElement | undefined;
		testId?: string | undefined;
		disabled?: boolean;
		loading?: boolean;
		enableFlight?: boolean;
		flightDirection?: 'default' | 'down-right' | 'up-right';
		flightState?: 'ready' | 'taking-off' | 'flying' | 'sent' | 'departing' | 'returning';
		animationType?: 'flight' | 'chevrons';
		icon?: 'send' | 'chevrons-down' | undefined;
		user?: { id: string; name: string | null } | null;
		onclick?: (__event: MouseEvent) => void;
		onmouseover?: (__event: MouseEvent) => void;
		onmouseenter?: (__event: MouseEvent) => void;
		onmouseleave?: (__event: MouseEvent) => void;
		onfocus?: (__event: FocusEvent) => void;
		onblur?: (__event: FocusEvent) => void;
		children?: import('svelte').Snippet;
	} = $props();

	let hovered = $state(false);
	let clicked = $state(false);
	let isLargeViewport = $state(false);

	// Always use downward chevrons (no responsive swap)
	$effect(() => {
		isLargeViewport = false;
	});

	// Select icon component based on prop and viewport
	const iconComponents = {
		send: Send,
		'chevrons-down': ChevronsDown,
		'chevrons-right': ChevronsRight
	};
	const IconComponent = $derived(icon ? iconComponents[icon] : undefined);

	// Dynamic paper plane flight animation with realistic physics
	// CRITICAL: All springs must have IDENTICAL physics for unified motion
	const flightPhysics = { stiffness: 0.08, damping: 0.85 };
	let planeX = spring(0, flightPhysics);
	let planeY = spring(0, flightPhysics);
	let planeOpacity = spring(1, flightPhysics);
	let planeRotation = spring(0, flightPhysics);
	let planeScale = spring(1, flightPhysics);
	let planeBlur = spring(0, flightPhysics);

	// Chevrons animation for scroll/reveal action
	let chevronsX = spring(0, { stiffness: 0.3, damping: 0.8 }); // For horizontal movement
	let chevronsY = spring(0, { stiffness: 0.3, damping: 0.8 }); // For vertical movement
	let chevronsScale = spring(1, { stiffness: 0.3, damping: 0.8 });
	let chevronsOpacity = spring(1, { stiffness: 0.4, damping: 0.9 });

	// Second plane for diverging animation (Hero button only)
	let _plane2X = $state(0);
	let _plane2Y = $state(0);
	let _plane2Opacity = spring(0, { stiffness: 0.4, damping: 0.8 });
	let _plane2Rotation = spring(0, { stiffness: 0.35, damping: 0.6 });
	let _plane2Scale = spring(0, { stiffness: 0.3, damping: 0.7 });
	let _showSecondPlane = $state(false);

	// Target calculation for sublime flight paths
	function calculateTargetPositions() {
		if (typeof window === 'undefined') return { certified: null, direct: null };

		// Find the channel cards by looking for their identifying content
		const channelCards = document.querySelectorAll('[role="button"]');
		let certifiedCard: HTMLElement | null = null;
		let directCard: HTMLElement | null = null;

		channelCards.forEach((card) => {
			const text = card.textContent || '';
			if (text.includes('Verified Delivery')) {
				certifiedCard = card as HTMLElement;
			} else if (text.includes('Community Outreach')) {
				directCard = card as HTMLElement;
			}
		});

		const buttonRect = buttonElement?.getBoundingClientRect();
		if (!buttonRect) return { certified: null, direct: null };

		let certified = null;
		if (certifiedCard !== null) {
			const card = certifiedCard as HTMLElement;
			const rect = card.getBoundingClientRect();
			certified = {
				element: rect,
				target: {
					x: rect.left + rect.width * 0.25,
					y: rect.top + rect.height * 0.3
				}
			};
		}

		let direct = null;
		if (directCard !== null) {
			const card = directCard as HTMLElement;
			const rect = card.getBoundingClientRect();
			direct = {
				element: rect,
				target: {
					x: rect.left + rect.width * 0.25,
					y: rect.top + rect.height * 0.3
				}
			};
		}

		return { certified, direct, buttonRect };
	}

	// Calculate parabolic trajectory for sublime flight paths
	function _calculateFlightPath(
		target: { x: number; y: number },
		buttonRect: DOMRect,
		progress: number
	) {
		const startX = buttonRect.right - 20; // Start from icon position
		const startY = buttonRect.top + buttonRect.height / 2;

		// Calculate relative position from button
		const deltaX = target.x - startX;
		const deltaY = target.y - startY;

		// Create a true parabolic arc that goes up then down
		const arcHeight = Math.max(Math.abs(deltaY), 100) + 60; // Ensure sufficient upward arc
		const peakProgress = 0.35; // Peak slightly earlier for more natural descent

		let x, y;

		if (progress <= peakProgress) {
			// Rising arc - elegant upward motion
			const t = progress / peakProgress;
			x = deltaX * t * 0.25; // Even slower horizontal start
			y = deltaY * t * 0.1 - arcHeight * (t - t * t * 0.5); // Strong upward emphasis
		} else {
			// Descending arc - graceful dive toward target
			const t = (progress - peakProgress) / (1 - peakProgress);
			x = deltaX * (0.25 + 0.75 * t); // Accelerated horizontal movement
			y = deltaY * (0.1 + 0.9 * t) - arcHeight * (1 - t) * (1 - t); // True parabolic descent
		}

		// Calculate rotation for natural banking during arc
		let rotation;
		if (progress <= peakProgress) {
			// During ascent - gentle banking
			rotation = -5 + (progress / peakProgress) * 15;
		} else {
			// During descent - diving angle
			const t = (progress - peakProgress) / (1 - peakProgress);
			const diveAngle = (Math.atan2(deltaY * 0.9, deltaX * 0.75) * 180) / Math.PI;
			rotation = 10 + diveAngle * t;
		}

		return { x, y, rotation };
	}

	$effect(() => {
		if (hovered && !disabled) {
			if (animationType === 'chevrons') {
				if (isLargeViewport) {
					chevronsX.set(1);
				} else {
					chevronsY.set(1);
				}
				chevronsScale.set(1.02);
			} else if (animationType === 'flight') {
				if (!enableFlight || flightState === 'ready') {
					planeX.set(3);
					planeY.set(-2);
					planeRotation.set(-5);
					planeScale.set(1.05);
				}
			}
		} else {
			chevronsX.set(0);
			chevronsY.set(0);
			chevronsScale.set(1);
			chevronsOpacity.set(1);
			if (animationType === 'flight' && (!enableFlight || flightState === 'ready')) {
				planeX.set(0);
				planeY.set(0);
				planeRotation.set(0);
				planeScale.set(1);
			}
		}
	});

	// Paper plane flight - simple, elegant, unified physics
	$effect(() => {
		if (enableFlight) {
			switch (flightState) {
				case 'taking-off':
					// Gentle lift - plane tips up and begins moving
					planeX.set(20);
					planeY.set(-8);
					planeRotation.set(-15);
					planeScale.set(1.05);
					planeOpacity.set(1);
					planeBlur.set(0);
					break;
				case 'flying':
					// Soaring arc - smooth rightward and upward motion
					planeX.set(80);
					planeY.set(-30);
					planeRotation.set(10);
					planeScale.set(1);
					planeOpacity.set(0.9);
					planeBlur.set(0.5);
					break;
				case 'sent':
				case 'departing':
					// Gliding away - continues trajectory, fades out
					planeX.set(180);
					planeY.set(-45);
					planeRotation.set(20);
					planeScale.set(0.85);
					planeOpacity.set(0);
					planeBlur.set(1);
					break;
				case 'returning':
					// Quick reset
					planeX.set(0, { hard: true });
					planeY.set(0, { hard: true });
					planeRotation.set(0, { hard: true });
					planeScale.set(1, { hard: true });
					planeOpacity.set(1, { hard: true });
					planeBlur.set(0, { hard: true });
					break;
				default: // 'ready'
					planeX.set(0);
					planeY.set(0);
					planeRotation.set(0);
					planeScale.set(1);
					planeOpacity.set(1);
					planeBlur.set(0);
			}
		}
	});

	function handleClick(__event: MouseEvent) {
		if (!disabled && !loading) {
			clicked = true;
			const isSignedIn = user && user.id;

			if (animationType === 'chevrons') {
				if (isLargeViewport) {
					chevronsX.set(4);
				} else {
					chevronsY.set(4);
				}
				chevronsScale.set(0.98);
				chevronsOpacity.set(0.7);

				setTimeout(() => {
					if (isLargeViewport) {
						chevronsX.set(6);
					} else {
						chevronsY.set(6);
					}
					chevronsScale.set(1.05);
					chevronsOpacity.set(1);
				}, 150);

				setTimeout(() => {
					chevronsX.set(0);
					chevronsY.set(0);
					chevronsScale.set(1);
					chevronsOpacity.set(1);
					clicked = false;
				}, 350);

				onclick?.(__event);
			} else if (enableFlight && isSignedIn && flightState === 'ready') {
				flightState = 'taking-off';

				setTimeout(() => {
					clicked = false;
				}, 150);

				setTimeout(() => {
					if (flightState === 'taking-off') flightState = 'flying';
				}, 400);

				setTimeout(() => {
					if (flightState === 'flying') flightState = 'sent';
				}, 800);

				setTimeout(() => {
					if (flightState === 'sent') flightState = 'departing';
				}, 1200);

				setTimeout(() => {
					if (flightState === 'departing') flightState = 'returning';
				}, 1900);

				setTimeout(() => {
					if (flightState === 'returning') flightState = 'ready';
				}, 2300);

				// Redirect early — user sees takeoff then page transitions
				setTimeout(() => {
					onclick?.(__event);
				}, 120);
			} else if (icon === 'send') {
				// Plane pulses — eager forward motion
				planeX.set(8);
				planeY.set(-3);
				planeRotation.set(-8);
				planeScale.set(1.1);

				setTimeout(() => {
					planeX.set(0);
					planeY.set(0);
					planeRotation.set(0);
					planeScale.set(1);
				}, 150);

				setTimeout(() => {
					clicked = false;
				}, 250);

				onclick?.(__event);
			} else {
				setTimeout(() => {
					clicked = false;
				}, 200);

				onclick?.(__event);
			}
		}
	}

	function handleMouseEnter(__event: MouseEvent) {
		if (!disabled) {
			hovered = true;
			onmouseenter?.(__event);
		}
	}

	function handleMouseLeave(__event: MouseEvent) {
		if (!disabled) {
			hovered = false;
			onmouseleave?.(__event);
		}
	}

	// Size classes - cleaner with monospace vibes
	const sizeClasses = {
		sm: 'px-3 py-1.5 text-xs gap-1.5',
		default: 'px-4 py-2 text-sm gap-2',
		lg: 'px-6 py-3 text-base gap-2.5'
	};

	// Variant classes - governance-neutral participation aesthetic
	const variantClasses = {
		primary: `
			bg-participation-primary-500 hover:bg-participation-primary-600
			text-white border border-participation-primary-600
			transition-colors duration-150
		`,
		secondary: `
			bg-white hover:bg-slate-50
			text-participation-primary-700 hover:text-participation-primary-800
			border border-slate-200 hover:border-slate-300
			transition-colors duration-150
		`,
		magical: `
			bg-participation-primary-600 hover:bg-participation-primary-700
			text-white font-semibold
			border border-participation-primary-700
			transition-colors duration-150
		`,
		verified: `
			bg-verified-500 hover:bg-verified-600
			text-white border border-verified-600
			transition-colors duration-150
		`,
		community: `
			bg-community-50 hover:bg-community-100
			text-community-700 hover:text-community-800
			border border-community-200
			transition-colors duration-150
		`,
		danger: `
			bg-red-500 hover:bg-red-600
			text-white border border-red-600
			transition-colors duration-150
		`
	};
</script>

<div class="relative inline-block">
	<!-- Glow removed — solid color transitions are sufficient -->

	<!-- Icon element - different rendering based on animation type -->
	{#if IconComponent && animationType !== 'chevrons'}
		<!-- Flight icon - uses two overlapping icons for color transition effect -->
		{@const isFlying = enableFlight && flightState !== 'ready' && flightState !== 'returning'}
		{@const isWhiteText =
			variant === 'primary' ||
			variant === 'magical' ||
			variant === 'verified' ||
			variant === 'danger'}
		{@const baseColor = isWhiteText ? 'white' : 'rgb(71, 85, 105)'}
		{@const buttonEdge = 30}
		{@const transitionProgress = Math.max(0, Math.min(1, ($planeX - buttonEdge) / 50))}

		<!-- Base layer: starts as button color, fades as plane exits -->
		<span
			class="pointer-events-none absolute z-50"
			style="
				top: 50%;
				right: {size === 'lg' ? '24px' : size === 'sm' ? '12px' : '16px'};
				transform: translate({$planeX}px, calc(-50% + {$planeY}px)) rotate({$planeRotation}deg) scale({$planeScale});
				opacity: {(enableFlight ? $planeOpacity : 1) * (1 - transitionProgress)};
				filter: blur({enableFlight ? $planeBlur : 0}px);
				transform-origin: center;
				color: {baseColor};
			"
		>
			<IconComponent class="h-4 w-4" />
		</span>

		<!-- Dark layer: appears as plane exits button -->
		{#if transitionProgress > 0}
			<span
				class="pointer-events-none absolute z-50"
				style="
					top: 50%;
					right: {size === 'lg' ? '24px' : size === 'sm' ? '12px' : '16px'};
					transform: translate({$planeX}px, calc(-50% + {$planeY}px)) rotate({$planeRotation}deg) scale({$planeScale});
					opacity: {$planeOpacity * transitionProgress};
					filter: blur({$planeBlur}px) drop-shadow(0 4px 10px rgba(0, 0, 0, {isFlying ? 0.4 : 0}));
					transform-origin: center;
					color: rgb(15, 23, 42);
				"
			>
				<IconComponent class="h-4 w-4" />
			</span>
		{/if}
	{/if}

	{#if href}
		<a
			{href}
			{rel}
			target={href.startsWith('mailto:') ? undefined : '_blank'}
			data-testid={testId}
			class="
				inline-flex transform-gpu items-center justify-center rounded-md
				font-medium transition-all duration-200 ease-out
				focus:outline-none focus:ring-2 focus:ring-offset-2
				disabled:cursor-not-allowed disabled:opacity-50
				cursor-{cursor}
				select-none no-underline
				{sizeClasses[size]}
				{variantClasses[variant]}
				{classNames}
			"
			class:opacity-50={disabled}
			class:cursor-not-allowed={disabled}
			style="
				transform-origin: center;
			"
			aria-label={text}
			onclick={handleClick}
			onmouseenter={handleMouseEnter}
			onmouseleave={handleMouseLeave}
			{onmouseover}
			{onfocus}
			{onblur}
		>
			<!-- Content -->
			<span class="relative flex items-center gap-2">
				{#if loading}
					<div
						class="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
					></div>
				{:else}
					<!-- Static text content - never changes -->
					{@render children?.()}
					{#if !children && text}{text}{/if}

					<!-- Icon rendering based on type -->
					{#if IconComponent && animationType === 'chevrons'}
						<!-- Chevrons inline with content for proper flexbox scaling -->
						<span
							class="-ml-1 -mr-1"
							style="
								transform: translate({$chevronsX}px, {$chevronsY}px) scale({$chevronsScale});
								opacity: {$chevronsOpacity};
								color: {variant === 'magical' || variant === 'verified' ? 'white' : 'currentColor'};
							"
						>
							<IconComponent class="h-5 w-5" />
						</span>
					{:else if IconComponent && (animationType === 'flight' || enableFlight)}
						<!-- Placeholder for absolute positioned flight icon -->
						<span class="relative inline-block h-4 w-5">
							<!-- Empty space - plane rendered at root for flight animation -->
						</span>
					{/if}
				{/if}
			</span>

			<!-- Clean click feedback -->
			{#if clicked && !enableFlight}
				<div
					class="pointer-events-none absolute inset-0 rounded-md bg-white/10"
					style="animation: fadeOut 0.3s ease-out forwards"
				></div>
			{/if}
		</a>
	{:else}
		<button
			bind:this={buttonElement}
			{type}
			{disabled}
			data-testid={testId}
			class="
				inline-flex transform-gpu items-center justify-center rounded-md
				font-medium transition-all duration-200 ease-out
				focus:outline-none focus:ring-2 focus:ring-offset-2
				disabled:cursor-not-allowed disabled:opacity-50
				{sizeClasses[size]}
				{variantClasses[variant]}
				{classNames}
			"
			class:opacity-50={disabled}
			class:cursor-not-allowed={disabled}
			class:cursor-pointer={!disabled}
			style="
				transform-origin: center;
			"
			aria-label={text}
			onclick={handleClick}
			onmouseenter={handleMouseEnter}
			onmouseleave={handleMouseLeave}
			{onmouseover}
			{onfocus}
			{onblur}
		>
			<!-- Content -->
			<span class="relative flex items-center gap-2">
				{#if loading}
					<div
						class="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
					></div>
				{:else}
					<!-- Static text content - never changes -->
					{@render children?.()}
					{#if !children && text}{text}{/if}

					<!-- Icon rendering based on type -->
					{#if IconComponent && animationType === 'chevrons'}
						<!-- Chevrons inline with content for proper flexbox scaling -->
						<span
							class="-ml-1 -mr-1"
							style="
								transform: translate({$chevronsX}px, {$chevronsY}px) scale({$chevronsScale});
								opacity: {$chevronsOpacity};
								color: {variant === 'magical' || variant === 'verified' ? 'white' : 'currentColor'};
							"
						>
							<IconComponent class="h-5 w-5" />
						</span>
					{:else if IconComponent && (animationType === 'flight' || enableFlight)}
						<!-- Placeholder for absolute positioned flight icon -->
						<span class="relative inline-block h-4 w-5">
							<!-- Empty space - plane rendered at root for flight animation -->
						</span>
					{/if}
				{/if}
			</span>

			<!-- Clean click feedback -->
			{#if clicked && !enableFlight}
				<div
					class="pointer-events-none absolute inset-0 rounded-md bg-white/10"
					style="animation: fadeOut 0.3s ease-out forwards"
				></div>
			{/if}
		</button>
	{/if}
</div>

<style>
	@keyframes fadeOut {
		from {
			opacity: 0.2;
		}
		to {
			opacity: 0;
		}
	}
</style>
