<script lang="ts">
	/**
	 * Bubble.svelte — THE living bubble.
	 *
	 * SVG circle overlay on MapLibre terrain. Captures all gestures.
	 * Position + scale via CSS transform: translate() scale() — compositor-thread only.
	 * No SVG attribute mutation in the render loop.
	 *
	 * The bubble is the user's geographic identity object.
	 */

	import { onMount } from 'svelte';
	import { bubbleState } from '$lib/core/bubble/bubble-state.svelte';
	import { BubbleGestures, type GestureCallbacks } from './bubble-gestures';
	import { animateBubbleBirth, startInertia, stopInertia, type InertiaState } from './bubble-spring';
	import type BubbleTerrain from './BubbleTerrain.svelte';

	let {
		terrain
	}: {
		terrain: ReturnType<typeof BubbleTerrain> | null;
	} = $props();

	let circleEl = $state<SVGCircleElement | null>(null);
	let gestureEl = $state<HTMLDivElement | null>(null);

	// Store outside $state for teardown closure correctness
	let currentInertia: InertiaState | null = null;
	let currentAnimation: Animation | null = null;

	const BASE_R = 50;

	// Glow intensity (0-1, increases near fences)
	const glowIntensity = $derived.by(() => {
		const geo = bubbleState.geometryResult;
		if (!geo) return 0.15;
		const fenceCount = geo.insideFenceIds.size;
		return Math.min(0.5, 0.15 + fenceCount * 0.12);
	});

	// rAF loop: apply transform directly to DOM (no Svelte re-render)
	let rafId = 0;
	let prevGlowIntensity = -1; // track to avoid per-frame filter string construction

	function syncPosition() {
		// Don't spin rAF during idle/loading — nothing to render
		if (bubbleState.phase === 'idle' || bubbleState.phase === 'loading') {
			rafId = requestAnimationFrame(syncPosition);
			return;
		}

		const center = bubbleState.center;
		if (!center || !terrain || !circleEl) {
			rafId = requestAnimationFrame(syncPosition);
			return;
		}

		const p = terrain.project(center.lng, center.lat);
		if (!p) {
			rafId = requestAnimationFrame(syncPosition);
			return;
		}

		// Compute pixel scale
		const p2 = terrain.project(center.lng + 0.00001, center.lat);
		let scale = 1;
		if (p2) {
			const pxPerDeg = Math.abs(p2.x - p.x) / 0.00001;
			const degreesPerMeter = 1 / (111_320 * Math.cos(center.lat * Math.PI / 180));
			const pxPerMeter = pxPerDeg * degreesPerMeter;
			scale = (pxPerMeter * bubbleState.radius) / BASE_R;
		}

		// Compositor-only: translate + scale via style.transform (no cx/cy mutation)
		circleEl.style.transform = `translate(${p.x}px, ${p.y}px) scale(${scale})`;

		// Only recompute filter string when glow intensity actually changes
		if (glowIntensity !== prevGlowIntensity) {
			circleEl.style.filter = `drop-shadow(0 0 8px rgba(59, 130, 246, ${glowIntensity}))`;
			prevGlowIntensity = glowIntensity;
		}

		rafId = requestAnimationFrame(syncPosition);
	}

	onMount(() => {
		rafId = requestAnimationFrame(syncPosition);

		if (circleEl && bubbleState.phase === 'ready') {
			currentAnimation = animateBubbleBirth(circleEl);
		}

		return () => {
			cancelAnimationFrame(rafId);
			if (currentInertia) stopInertia(currentInertia);
			currentAnimation?.cancel();
		};
	});

	// Cancel previous animation before starting a new one
	function cancelPrevAnimation() {
		currentAnimation?.cancel();
		currentAnimation = null;
	}

	// Gesture setup
	$effect(() => {
		if (!gestureEl) return;

		const callbacks: GestureCallbacks = {
			onPinchScale(scale: number) {
				const newRadius = bubbleState.radius * scale;
				const clamped = Math.max(100, Math.min(50_000, newRadius));
				bubbleState.setRadius(clamped);
			},

			onDragDelta(dx: number, dy: number) {
				if (currentInertia) {
					stopInertia(currentInertia);
					currentInertia = null;
				}

				const center = bubbleState.center;
				if (!center || !terrain) return;

				const map = terrain.getMap();
				if (!map) return;
				const p = terrain.project(center.lng, center.lat);
				if (!p) return;
				const from = map.unproject([p.x, p.y]);
				const to = map.unproject([p.x - dx, p.y - dy]);
				bubbleState.setCenter({
					lat: center.lat + (to.lat - from.lat),
					lng: center.lng + (to.lng - from.lng)
				});
			},

			onDragEnd(vx: number, vy: number) {
				if (Math.abs(vx) < 1 && Math.abs(vy) < 1) return;

				currentInertia = startInertia(
					vx,
					vy,
					(dx, dy) => {
						const center = bubbleState.center;
						if (!center || !terrain) return;
						const map = terrain.getMap();
						if (!map) return;
						const p = terrain.project(center.lng, center.lat);
						if (!p) return;
						const from = map.unproject([p.x, p.y]);
						const to = map.unproject([p.x - dx, p.y - dy]);
						bubbleState.setCenter({
							lat: center.lat + (to.lat - from.lat),
							lng: center.lng + (to.lng - from.lng)
						});
					},
					() => {
						currentInertia = null;
					}
				);
			},

			onWheelRadius(delta: number) {
				const newRadius = bubbleState.radius * (1 + delta);
				const clamped = Math.max(100, Math.min(50_000, newRadius));
				cancelPrevAnimation();
				bubbleState.setRadius(clamped);
			},

			onKeyRadius(delta: number) {
				const newRadius = bubbleState.radius * (1 + delta);
				const clamped = Math.max(100, Math.min(50_000, newRadius));
				bubbleState.setRadius(clamped);
			},

			onKeyMove(dx: number, dy: number) {
				const center = bubbleState.center;
				if (!center) return;
				const offsetM = bubbleState.radius / 10;
				const latDelta = (offsetM / 111_320) * dy;
				const lngDelta =
					(offsetM / (111_320 * Math.cos(center.lat * Math.PI / 180))) * dx;
				bubbleState.setCenter({
					lat: center.lat - latDelta,
					lng: center.lng + lngDelta
				});
			},

			onConfirm() {
				navigator.vibrate?.([15, 10, 15]);
			}
		};

		const g = new BubbleGestures(gestureEl, callbacks);

		return () => {
			g.destroy();
		};
	});

	// Haptic + glow pulse on fence crossing
	let prevFenceCount = $state(0);
	$effect(() => {
		const geo = bubbleState.geometryResult;
		if (!geo) return;
		const count = geo.insideFenceIds.size;
		if (count > prevFenceCount && circleEl) {
			navigator.vibrate?.([15, 10, 15]);
			cancelPrevAnimation();
			currentAnimation = circleEl.animate(
				[
					{ filter: `drop-shadow(0 0 12px rgba(59, 130, 246, 0.6))` },
					{ filter: `drop-shadow(0 0 8px rgba(59, 130, 246, ${glowIntensity}))` }
				],
				{ duration: 300, easing: 'ease-out' }
			);
		}
		prevFenceCount = count;
	});
</script>

{#if bubbleState.phase !== 'idle'}
	<!-- SVG overlay: pointer-events on circle only -->
	<svg
		class="absolute inset-0 z-10 overflow-visible"
		style="pointer-events: none;"
	>
		<defs>
			<radialGradient id="bubble-fill" cx="50%" cy="50%" r="50%">
				<stop offset="0%" stop-color="transparent" />
				<stop offset="85%" stop-color="rgba(59, 130, 246, 0.04)" />
				<stop offset="100%" stop-color="rgba(59, 130, 246, 0.08)" />
			</radialGradient>
		</defs>

		<!-- Circle at origin, positioned via transform: translate() scale() — compositor only -->
		<circle
			bind:this={circleEl}
			cx="0"
			cy="0"
			r={BASE_R}
			fill="url(#bubble-fill)"
			stroke="rgba(59, 130, 246, 0.25)"
			stroke-width="1.5"
			style="
				will-change: transform, filter;
				pointer-events: all;
			"
			aria-label="Your geographic bubble covering {bubbleState.radius < 1000
				? `${Math.round(bubbleState.radius)}m`
				: `${(bubbleState.radius / 1000).toFixed(1)}km`} radius"
		/>
	</svg>

	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<!-- Gesture capture layer -->
	<div
		bind:this={gestureEl}
		class="absolute inset-0 z-20"
		style="touch-action: none;"
		tabindex="0"
		role="application"
		aria-label="Bubble gesture area. Pinch to resize, drag to move."
		aria-keyshortcuts="+ - ArrowUp ArrowDown ArrowLeft ArrowRight Enter Escape"
	></div>
{/if}
