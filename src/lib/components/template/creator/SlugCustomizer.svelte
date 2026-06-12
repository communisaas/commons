<script lang="ts">
	import { Link2, Sparkles, RefreshCw, CheckCircle2, AlertCircle } from '@lucide/svelte';
	import { fade, fly } from 'svelte/transition';
	import { page } from '$app/stores';
	import type { TemplateCreationContext } from '$lib/types/template';

	interface Props {
		title?: string;
		slug?: string;
		aiGenerated?: boolean;
		context?: TemplateCreationContext | undefined;
		/** Exposes slug readiness: true = valid & available, false = invalid or taken, null = checking/unknown */
		slugReady?: boolean | null;
	}

	let {
		title = '',
		slug = $bindable(''),
		aiGenerated = false,
		context = undefined,
		slugReady = $bindable(null)
	}: Props = $props();

	let __isChecking = false;
	let isAvailable: boolean | null = $state(null);
	let suggestions: string[] = $state([]);
	let customSlug = $state('');
	let showCustomInput = $state(false);

	// Generate slug from title
	function slugify(text: string): string {
		return text
			.toString()
			.toLowerCase()
			.replace(/\s+/g, '-')
			.replace(/[^\w-]+/g, '')
			.replace(/--+/g, '-')
			.replace(/^-+/, '')
			.replace(/-+$/, '');
	}

	// Generate creative variations
	function generateSuggestions(baseSlug: string): string[] {
		const variations = [];

		// Action-oriented prefixes
		const actionPrefixes = ['act', 'support', 'defend', 'protect', 'save', 'help'];
		const randomPrefix = actionPrefixes[Math.floor(Math.random() * actionPrefixes.length)];
		variations.push(`${randomPrefix}-${baseSlug}`);

		// Year suffix for templates
		const year = new Date().getFullYear();
		variations.push(`${baseSlug}-${year}`);

		// Shortened version
		const words = baseSlug.split('-');
		if (words.length > 3) {
			variations.push(words.slice(0, 3).join('-'));
		}

		// Acronym version if multi-word
		if (words.length > 1) {
			const acronym = words.map((w) => w[0]).join('');
			variations.push(`${acronym}-template`);
		}

		return variations.slice(0, 3);
	}

	// Check slug availability
	async function checkAvailability(slugToCheck: string) {
		__isChecking = true;
		isAvailable = null;

		try {
			// Convert channelId to deliveryMethod for API
			const deliveryMethod =
				context?.channelId === 'certified'
					? 'cwc'
					: context?.channelId === 'cwc'
						? 'cwc'
						: 'direct';

			const params = new URLSearchParams({
				slug: slugToCheck,
				...(title && { title }),
				deliveryMethod
			});

			const { api } = await import('$lib/core/api/client');
			const result = await api.get(`/templates/check-slug?${params}`);
			if (!result.success) throw new Error(result.error);
			const data = result.data as { available: boolean; suggestions?: string[] };
			isAvailable = data.available;

			if (!isAvailable && slugToCheck === slug) {
				// Use server-provided suggestions that are guaranteed to be available
				suggestions = data.suggestions || [];
			} else if (isAvailable && slugToCheck === slug) {
				// Clear suggestions if slug is available
				suggestions = [];
			}
		} catch {
			/* Ignore slug check errors - slug availability remains unknown */
		} finally {
			__isChecking = false;
		}
	}

	// Auto-generate slug from title for manual input
	let lastAutoSlug = $state('');
	$effect(() => {
		if (title && !aiGenerated) {
			const newSlug = slugify(title);
			if (!slug || (slug === lastAutoSlug && newSlug !== slug)) {
				slug = newSlug;
				lastAutoSlug = newSlug;
			}
		}
	});

	// Check availability whenever slug changes and is valid
	let lastCheckedSlug = '';
	$effect(() => {
		const currentSlug = slug;
		if (currentSlug && /^[a-z0-9-]+$/.test(currentSlug) && currentSlug !== lastCheckedSlug) {
			lastCheckedSlug = currentSlug;
			checkAvailability(currentSlug);
		}
	});

	// Handle custom slug input
	function handleCustomSlug() {
		if (customSlug) {
			slug = slugify(customSlug);
			checkAvailability(slug);
			showCustomInput = false;
			customSlug = '';
		}
	}

	// Regenerate suggestions by fetching from server
	async function regenerateSuggestions() {
		if (!title) return;

		try {
			// Convert channelId to deliveryMethod for API
			const deliveryMethod =
				context?.channelId === 'certified'
					? 'cwc'
					: context?.channelId === 'cwc'
						? 'cwc'
						: 'direct';

			const params = new URLSearchParams({
				slug: slug,
				title: title,
				deliveryMethod
			});

			const { api } = await import('$lib/core/api/client');
			const result = await api.get(`/templates/check-slug?${params}`);
			if (!result.success) throw new Error(result.error);
			const data = result.data as { available: boolean; suggestions?: string[] };

			if (!data.available) {
				suggestions = data.suggestions || [];
			}
		} catch {
			// Fallback to client-side generation if server fails
			suggestions = generateSuggestions(slug);
		}
	}

	// Select a suggestion
	function selectSuggestion(suggestion: string) {
		slug = suggestion;
		checkAvailability(slug);
		// Don't clear suggestions here - let checkAvailability handle it
	}

	// Full URL for preview using dynamic hostname
	const _fullUrl = $derived(`${$page.url.origin}/${slug}`);
	const isValidSlug = $derived(slug.length > 0 && /^[a-z0-9-]+$/.test(slug));

	// Sync slugReady bindable: true = valid & available, false = invalid/taken, null = checking/unknown
	$effect(() => {
		if (!slug || !isValidSlug) {
			slugReady = false;
		} else if (isAvailable === true) {
			slugReady = true;
		} else if (isAvailable === false) {
			slugReady = false;
		} else {
			// null = still checking or not yet checked
			slugReady = null;
		}
	});
</script>

<div class="space-y-2 md:space-y-4">
	<!-- Header -->
	<p class="flex items-start gap-1.5 text-xs text-participation-primary-600/70 md:text-sm">
		<Link2 class="mt-0.5 h-3 w-3 flex-shrink-0 md:h-3.5 md:w-3.5" aria-hidden="true" />
		<span>
			<span class="font-medium text-participation-primary-700">Action page link</span> —
			after you publish, this link opens the page where readers review, send, and get their receipt.
		</span>
	</p>

	<!-- URL Preview with inline availability -->
	<div class="slug-link-preview rounded-lg p-2 md:p-3">
		<div class="flex flex-wrap items-center gap-1 font-mono text-xs md:gap-1.5 md:text-sm">
			<span class="break-all text-participation-primary-400">{$page.url.origin}/</span>
			<span class="font-semibold text-slate-900">{slug || 'your-template'}</span>
			{#if isAvailable === true}
				<CheckCircle2 class="h-3.5 w-3.5 text-green-600 md:h-4 md:w-4" aria-label="Available" />
			{:else if isAvailable === false}
				<AlertCircle class="h-3.5 w-3.5 text-amber-600 md:h-4 md:w-4" aria-label="Taken" />
			{/if}
		</div>
	</div>

	<!-- Validation Messages -->
	{#if slug && !isValidSlug}
		<p class="text-xs text-red-600 md:text-xs">
			Links can only contain lowercase letters, numbers, and hyphens
		</p>
	{/if}

	<!-- Suggestions when slug is taken -->
	{#if isAvailable === false && suggestions.length > 0}
		<div class="space-y-1 md:space-y-2" in:fly={{ y: 10, duration: 200 }}>
			<p class="text-xs text-slate-600 md:text-xs">Try one of these alternatives:</p>
			<div class="flex flex-wrap gap-1 md:gap-2">
				{#each suggestions as suggestion}
					<button
						type="button"
						onclick={() => selectSuggestion(suggestion)}
						class="inline-flex items-center gap-1 rounded-full bg-participation-primary-50 px-2 py-1 text-xs font-medium text-participation-primary-700 transition-colors hover:bg-participation-primary-100 md:gap-1 md:px-3 md:py-1 md:text-xs"
					>
						<Sparkles class="h-3 w-3 md:h-3 md:w-3" />
						{suggestion}
					</button>
				{/each}
				<button
					type="button"
					onclick={regenerateSuggestions}
					class="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-200 md:gap-1 md:px-3 md:py-1 md:text-xs"
				>
					<RefreshCw class="h-3 w-3 md:h-3 md:w-3" />
					More
				</button>
			</div>
		</div>
	{/if}

	<!-- Custom slug input -->
	{#if showCustomInput}
		<div class="flex gap-1 md:gap-2" in:fly={{ y: -10, duration: 200 }}>
			<input
				type="text"
				bind:value={customSlug}
				onkeydown={(e) => e.key === 'Enter' && handleCustomSlug()}
				placeholder="enter-custom-link"
				class="flex-1 rounded border-slate-300 px-2 py-1 text-xs shadow-sm focus:border-participation-primary-500 focus:ring-participation-primary-500 md:text-sm"
			/>
			<button
				type="button"
				onclick={handleCustomSlug}
				class="rounded bg-participation-primary-600 px-2 py-1 text-xs text-white hover:bg-participation-primary-700 md:px-3 md:text-sm"
			>
				Set
			</button>
			<button
				type="button"
				onclick={() => (showCustomInput = false)}
				class="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 md:px-3 md:text-sm"
			>
				Cancel
			</button>
		</div>
	{:else}
		<button
			type="button"
			onclick={() => (showCustomInput = true)}
			class={isAvailable === false
				? 'rounded bg-participation-primary-600 px-3 py-1.5 text-xs text-white hover:bg-participation-primary-700'
				: 'text-xs text-participation-primary-600 hover:text-participation-primary-700 md:text-xs'}
		>
			{isAvailable === false ? 'Create Custom Link' : 'Customize link'}
		</button>
	{/if}

</div>

<style>
	.slug-link-preview {
		border: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.8));
		background: var(--surface-raised, oklch(0.985 0.004 60));
	}
</style>
