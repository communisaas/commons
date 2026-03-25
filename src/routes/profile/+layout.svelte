<script lang="ts">
	/**
	 * Profile Layout — Atmospheric shell for the civic passport.
	 *
	 * The background breathes with the person's standing.
	 * Content expands to inhabit the viewport:
	 *   mobile: tight, stacked
	 *   tablet: comfortable reading column
	 *   desktop: wider field, zones spread to use the space
	 */
	import { ArrowLeft, LogOut as LogOutIcon } from '@lucide/svelte';
	import { performLogout } from '$lib/core/identity/cache-invalidation';
	import type { LayoutData } from './$types';
	import type { Snippet } from 'svelte';

	let {
		children,
		data
	}: {
		children: Snippet;
		data: LayoutData;
	} = $props();

	const user = $derived(data.user);
	const tier = $derived(Math.max(0, Math.min(4, Math.floor((user as Record<string, unknown>)?.trust_tier as number ?? 0))));

	const tierTints = [
		'oklch(0.993 0.003 60)',   // 0: neutral warm cream
		'oklch(0.988 0.008 250)',  // 1: faint blue wash
		'oklch(0.988 0.012 160)',  // 2: faint emerald warmth
		'oklch(0.988 0.012 300)',  // 3: faint purple depth
		'oklch(0.985 0.015 270)', // 4: faint indigo weight
	];
</script>

<div
	class="profile-atmosphere min-h-screen"
	style="background: radial-gradient(ellipse 120% 80% at 50% 0%, {tierTints[tier]}, oklch(0.993 0.003 60) 70%);
	       transition: background 700ms ease"
>
	<!-- Navigation -->
	<nav class="mx-auto flex max-w-3xl items-center justify-between px-5 py-5 sm:px-8 lg:max-w-4xl">
		<a
			href="/"
			class="group flex items-center gap-2 text-slate-500 transition-colors hover:text-slate-800"
		>
			<ArrowLeft class="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
			<span class="text-sm font-medium">Home</span>
		</a>

		<div class="flex items-center gap-4">
			<span class="text-sm text-slate-500">{user?.name?.split(' ')[0] || ''}</span>
			<button
				type="button"
				onclick={(e) => { e.preventDefault(); performLogout(); }}
				class="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-slate-500 transition-colors hover:bg-slate-100/60 hover:text-slate-700 border-none bg-transparent cursor-pointer"
				title="Sign out"
			>
				<LogOutIcon class="h-3.5 w-3.5" />
				<span class="hidden sm:inline">Sign out</span>
			</button>
		</div>
	</nav>

	<!-- Content — responsive width: comfortable on mobile, expansive on desktop -->
	<div class="mx-auto max-w-3xl px-5 pb-16 pt-2 sm:px-8 lg:max-w-4xl">
		{@render children()}
	</div>
</div>
